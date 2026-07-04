// The billing gate (ADR 006 seam 3, ADR 020): the reserved cost-estimation
// step from the Phase 0 architecture diagram (docs/04, "no-op returning 0")
// made real. Wraps the audited entry points (src/answer/audit/) from the
// OUTSIDE — nothing in src/answer/intent|compose, src/query, or src/chart
// changes; this is a brand-new top-level module, per the hard boundary.
//
// Owner-decided fail-closed rule (WP13 in-session decision, recorded in ADR
// 020): debit BEFORE the pipeline runs, with an automatic compensating entry
// whenever it does not return a real answer. Two different outcomes now get
// two different treatments (open-questions #58, decided mid-WP13 — a
// clarification round still costs Stefan real API spend, so it is no longer
// free like an outright refusal):
//   - any REFUSAL, or a thrown exception: compensate in FULL back to 0 —
//     "an unanswered question must never silently cost a credit."
//   - a CLARIFICATION: compensate the DIFFERENCE down to the flat
//     'clarification' price, never up (that price is configured <= the
//     estimated class, so the difference is always >= 0 — see migrations
//     005/006's CHECK constraints and src/billing/pricing-defaults.ts).
//
// Phase 1 always estimates the 'simple' action class for the pre-flight
// debit: no current pipeline output can be classified any other way
// (docs/08-build-plan.md WP13, open-questions #4), so there is no
// reconciliation-for-mismatched-ANSWER-class branch here — that would be
// dead code until a future WP (drill-down / claim verification) adds a real
// classifier.
import type { AuditedResponse } from '../answer/audit/index.ts';
import type { Db } from '../db/types.ts';
import { compensate, getActionClassPrice, reserveDebit } from './ledger.ts';
import type { GatedResponse } from './types.ts';

export async function chargeAndRun(
  db: Db,
  userId: string,
  requestId: string,
  run: () => Promise<AuditedResponse>,
): Promise<GatedResponse> {
  const required = await getActionClassPrice(db, 'simple');
  // reserveDebit checks the balance and debits atomically (a per-user
  // Postgres advisory lock, held only for this fast statement — never
  // across the pipeline call below) — an adversarial-review fix (WP13): the
  // previous separate getBalance-then-debitQuestion calls let two concurrent
  // requests with DIFFERENT requestIds both read the same pre-debit balance
  // and both pass the check.
  const reservation = await reserveDebit(db, userId, requestId, required);
  if (reservation.kind === 'insufficient') {
    return { kind: 'insufficient_credits', balance: reservation.balance, required };
  }
  if (reservation.kind === 'duplicate') {
    // Same (userId, requestId) already debited — a client retry (double
    // submit, network retry, React re-invocation). Never re-run the pipeline
    // for it: that would either double-charge or hand out a second free
    // answer, and there is no cached prior response to replay honestly.
    return { kind: 'duplicate_request' };
  }
  const debit = reservation.entry;

  try {
    const result = await run();
    // Compensate off the RETURNED response.kind — i.e. AFTER
    // respond-audited.ts's own fail-closed substitution (an audit-write
    // failure there already replaces an answer with an internal refusal
    // before this function ever sees it), never an intermediate pipeline
    // signal. This guarantees billing always matches exactly what the user
    // was shown. `netCost` mirrors the compensation actually applied below —
    // never computed independently of it, so the two can't drift apart.
    let netCost = required;
    if (result.response.kind === 'clarification') {
      const clarifyPrice = await getActionClassPrice(db, 'clarification');
      const refund = required - clarifyPrice;
      // refund <= 0 means the clarification price already equals (or
      // exceeds — a misconfiguration) the pre-debited amount: nothing to
      // compensate. Never charge MORE than the pre-flight debit; this gate
      // only ever refunds, by construction.
      if (refund > 0) {
        await compensate(db, userId, debit.id, refund, result.auditId);
        netCost = clarifyPrice;
      }
    } else if (result.response.kind !== 'answer') {
      // Every refusal reason: no value delivered, full refund.
      await compensate(db, userId, debit.id, required, result.auditId);
      netCost = 0;
    }
    return { kind: 'ok', ...result, netCost };
  } catch (error) {
    await compensate(db, userId, debit.id, required, null);
    throw error;
  }
}
