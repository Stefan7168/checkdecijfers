// The dataset-chat billing gate (WP202a, ADR 037 D12) — the
// src/billing/gate.ts `chargeAndRun` pattern, applied to askDataset turns.
// A brand-new sibling module: src/billing/gate.ts and every existing
// ledger function stay byte-untouched (the WP16/WP129 rule: never
// parameterise the hot path).
//
// Settlement (ADR 037 D12): a 'chart' keeps the full debit; a
// 'clarification' compensates down to the flat 'clarification' price
// (the SAME action class the CBS side uses — a deliberate simplification,
// see ActionClass's doc comment); a 'refusal' — OR the dataset being gone
// entirely (the D9 delete-vs-write race: writeTurn wrote no turn at all) —
// refunds in full. Every compensate() call here passes `auditAnswerId:
// null` — dataset turns live in dataset_turns, never audit_answers, so
// that FK has no valid target for them (migration 027's own documented
// warning, born from a mistake this design caught once already while
// drafting that migration).
import type { Db } from '../db/types.ts';
import { compensate, getActionClassPrice, reserveDatasetDebit } from './ledger.ts';
import type { AuditedDatasetTurn, GatedDatasetResponse } from './types.ts';

export async function chargeAndRunDataset(
  db: Db,
  userId: string,
  requestId: string,
  run: () => Promise<AuditedDatasetTurn>,
): Promise<GatedDatasetResponse> {
  const required = await getActionClassPrice(db, 'dataset_turn');
  const reservation = await reserveDatasetDebit(db, userId, requestId, required);
  if (reservation.kind === 'insufficient') {
    return { kind: 'insufficient_credits', balance: reservation.balance, required };
  }
  if (reservation.kind === 'duplicate') {
    // Same (userId, requestId) already debited — a client retry. Never
    // re-run the turn for it: no cached prior response exists to replay
    // honestly (the CBS-side chargeAndRun's own rule, applied here).
    return { kind: 'duplicate_request' };
  }
  const debit = reservation.entry;

  try {
    const result = await run();
    let netCost = required;
    if (result.datasetGone) {
      // The delete-vs-write race: no turn was written at all. Nothing was
      // delivered — full refund, same as a refusal, regardless of what
      // kind the (never-persisted) envelope would have been.
      await compensate(db, userId, debit.id, required, null);
      netCost = 0;
    } else if (result.envelope.kind === 'clarification') {
      const clarifyPrice = await getActionClassPrice(db, 'clarification');
      const refund = required - clarifyPrice;
      if (refund > 0) {
        await compensate(db, userId, debit.id, refund, null);
        netCost = clarifyPrice;
      }
    } else if (result.envelope.kind === 'refusal') {
      await compensate(db, userId, debit.id, required, null);
      netCost = 0;
    }
    // else: 'chart' — keeps the full debit, netCost stays `required`.
    return { kind: 'ok', ...result, netCost };
  } catch (error) {
    await compensate(db, userId, debit.id, required, null);
    throw error;
  }
}
