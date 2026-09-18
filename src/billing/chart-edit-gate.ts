// The CBS/Eurostat chart-edit billing gate (co-pilot phase 3, session
// 114) — src/billing/gate.ts's `chargeAndRun` pattern (ADR 006 seam 3,
// ADR 020), applied to a chart chat-edit turn. A brand-new sibling module:
// gate.ts, dataset-gate.ts and every existing ledger function stay
// byte-untouched (the WP16/WP129 rule: never parameterise the hot path).
//
// PRICE CLASS REUSED, DELIBERATELY: this tier is priced at the existing
// 'clarification' action class (10 credits today) via the existing
// question_cost debit (reserveDebit) — NOT a new action class, and
// therefore no migration. Cheapest mechanism first: a chart edit is a
// narrow, schema-forced selection, materially the same shape of work as a
// clarification round, so reusing that price avoids a pricing-config
// change for a feature this new. Re-pricing the CBS chart edit with its
// own action class (which WOULD need a migration) is open-questions #285.
//
// SETTLEMENT: an 'edit' reply keeps the full debit (netCost = required).
// A 'clarification' or a 'refusal' delivered no chart change — full
// compensation, netCost 0 (both already equal the debited amount here,
// since both the debit and the clarification price are the SAME
// 'clarification' class — unlike gate.ts/dataset-gate.ts, there is no
// partial refund step). A thrown run() compensates in full then rethrows.
// Every compensate() call passes `auditAnswerId: null` — a chart edit
// NEVER writes audit_answers, so that FK has no valid target for it (the
// dataset-gate.ts precedent).
import type { Db } from '../db/types.ts';
import { compensateSplit, getActionClassPrice, reserveDebit } from './ledger.ts';
import type { GatedChartEditResponse } from './types.ts';
import type { CbsCopilotReply } from '../chart/copilot/types.ts';

export async function chargeAndRunChartEdit(
  db: Db,
  userId: string,
  requestId: string,
  run: () => Promise<CbsCopilotReply>,
): Promise<GatedChartEditResponse> {
  const required = await getActionClassPrice(db, 'clarification');
  const reservation = await reserveDebit(db, userId, requestId, required);
  if (reservation.kind === 'insufficient') {
    return { kind: 'insufficient_credits', balance: reservation.balance, required };
  }
  if (reservation.kind === 'duplicate') {
    // Same (userId, requestId) already debited — a client retry. Never
    // re-run the edit: nothing was cached to replay honestly.
    return { kind: 'duplicate_request' };
  }
  const split = reservation.split;

  try {
    const reply = await run();
    let netCost = required;
    if (reply.kind !== 'edit') {
      // 'clarification' or 'refusal' — no chart change was delivered.
      await compensateSplit(db, userId, split, required, null);
      netCost = 0;
    }
    return { kind: 'ok', reply, netCost };
  } catch (error) {
    await compensateSplit(db, userId, split, required, null);
    throw error;
  }
}
