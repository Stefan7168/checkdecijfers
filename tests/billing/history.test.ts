// getQuestionHistory (src/billing/history.ts, migration 010): reconstructs a
// past question's net cost by joining audit_answers.request_id back to the
// credit ledger — the debit (by request_id) and any compensation (by
// audit_answer_id), exactly mirroring src/billing/gate.ts's own arithmetic.
//
// The core pin here is CONSISTENCY, not arithmetic: the first test drives the
// REAL chargeAndRun (with real pricing config) and asserts history reports the
// same netCost the gate returned — so a pricing change or a gate-math change
// can never silently desynchronize what a user was charged from what the
// dashboard tells them they were charged (adversarial-review finding: an
// earlier version hardcoded the refund amounts and would have missed exactly
// that drift).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AuditedResponse } from '../../src/answer/audit/index.ts';
import { chargeAndRun } from '../../src/billing/gate.ts';
import { getQuestionHistory } from '../../src/billing/history.ts';
import { compensate, reserveOnboardingDebit } from '../../src/billing/ledger.ts';
import { applyPricingDefaults } from '../../src/billing/pricing-apply.ts';
import type { Db } from '../../src/db/types.ts';
import { createPendingRequest, finalizeDelivered, finalizeFailed } from '../../src/ingestion/onboarding-store.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

/** Minimal audit_answers row -- a real ComposedResponse envelope has many
 * more fields than getQuestionHistory ever reads (it only selects question,
 * final_text, kind, created_at, request_id and the two questionNl paths the
 * WP19 round-grouping matches on), so this fixture deliberately stays narrow
 * rather than constructing a full valid envelope (that correctness is
 * src/answer/audit/'s own tests' job, not this join's).
 *
 * offeredQuestionNl: set on a kind='clarification' row -- lands at
 * response->'pending'->>'questionNl', where the real ClarificationResponse
 * envelope stores it. repliedQuestionNl + replyText: set together on a
 * reply-turn row (the reply_round_complete CHECK requires reply_text and
 * pending_clarification to be set together). */
async function insertAuditRow(
  db: Db,
  userId: string,
  opts: {
    kind: 'answer' | 'clarification' | 'refusal';
    question: string;
    finalText: string;
    requestId: string | null;
    offeredQuestionNl?: string;
    replyText?: string;
    repliedQuestionNl?: string;
  },
): Promise<number> {
  const response =
    opts.offeredQuestionNl === undefined ? {} : { pending: { questionNl: opts.offeredQuestionNl } };
  const pendingClarification =
    opts.repliedQuestionNl === undefined ? null : { question: opts.question, questionNl: opts.repliedQuestionNl };
  const { rows } = await db.query(
    `insert into audit_answers
       (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms, request_id, reply_text, pending_clarification)
     values (1, $1, 'user', $2, $3, '2026-01-01', $6::jsonb, $4, '{}'::jsonb, 100, $5, $7, $8::jsonb)
     returning id`,
    [
      userId,
      opts.kind,
      opts.question,
      opts.finalText,
      opts.requestId,
      JSON.stringify(response),
      opts.replyText ?? null,
      pendingClarification === null ? null : JSON.stringify(pendingClarification),
    ],
  );
  return Number(rows[0]!.id);
}

describe('getQuestionHistory — reconstruction matches what the gate actually charged', () => {
  // One test per outcome kind, each running the REAL chargeAndRun against the
  // REAL pricing config: whatever netCost the gate returns, history must
  // reconstruct the identical number from the ledger rows alone. No expected
  // values are hardcoded here on purpose — the pin is gate/history agreement,
  // which survives any future price change.
  for (const kind of ['answer', 'clarification', 'refusal'] as const) {
    it(`creditsCharged equals the gate's own netCost for a ${kind}`, async () => {
      await withDb(async (db) => {
        await applyPricingDefaults(db);
        const userId = randomUUID();
        await db.query('select public.grant_signup_credits($1)', [userId]);
        const requestId = randomUUID();
        // The audit row exists before the gate compensates (mirroring the real
        // wrap order: respond-audited writes the row inside run(), then the
        // gate compensates against its id).
        const auditId = await insertAuditRow(db, userId, {
          kind,
          question: 'Hoeveel inwoners heeft Nederland?',
          finalText: 'testantwoord',
          requestId,
        });
        const gated = await chargeAndRun(db, userId, requestId, async (): Promise<AuditedResponse> => ({
          response: { kind, question: 'test', text: 'testantwoord' } as unknown as AuditedResponse['response'],
          auditId,
        }));
        if (gated.kind !== 'ok') throw new Error(`expected ok, got ${gated.kind}`);

        const history = await getQuestionHistory(db, userId);
        const entry = history.find((h) => h.id === auditId);
        expect(entry).toBeDefined();
        expect(entry!.kind).toBe(kind);
        expect(entry!.creditsCharged).toBe(gated.netCost);
      });
    });
  }

  it('reports null cost when the row has no request_id (nothing to attribute a debit to)', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await insertAuditRow(db, userId, {
        kind: 'answer',
        question: 'Oude rij zonder request_id',
        finalText: 'test',
        requestId: null,
      });

      const history = await getQuestionHistory(db, userId);
      expect(history[0]).toMatchObject({ creditsCharged: null });
    });
  });

  it('orders most-recent-first and respects the limit', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      for (const question of ['eerste', 'tweede', 'derde']) {
        await insertAuditRow(db, userId, { kind: 'answer', question, finalText: 'x', requestId: null });
      }

      const history = await getQuestionHistory(db, userId, { limit: 2 });
      expect(history).toHaveLength(2);
      expect(history.map((h) => h.question)).toEqual(['derde', 'tweede']);
    });
  });

  it('never returns another user\'s rows', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const otherUserId = randomUUID();
      await insertAuditRow(db, otherUserId, { kind: 'answer', question: 'niet van mij', finalText: 'x', requestId: null });

      const history = await getQuestionHistory(db, userId);
      expect(history).toHaveLength(0);
    });
  });
});

// WP19 (open-questions #67): a clarification round -- the clarify row plus
// the reply row that answered it -- collapses into ONE history entry.
describe('getQuestionHistory — clarification-round grouping', () => {
  const QUESTION = 'Hoeveel inwoners heeft de gemeente?';
  const QUESTION_NL = 'Welke gemeente bedoel je?';

  it('collapses a full round into one entry whose cost is the SUM of the gate\'s own netCosts', async () => {
    await withDb(async (db) => {
      await applyPricingDefaults(db);
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);

      // Turn 1: the clarification, driven through the REAL gate (mirroring
      // the real wrap order: the audit row is written inside run(), then the
      // gate compensates against its id).
      const clarifyRequestId = randomUUID();
      const clarifyAuditId = await insertAuditRow(db, userId, {
        kind: 'clarification',
        question: QUESTION,
        finalText: QUESTION_NL,
        requestId: clarifyRequestId,
        offeredQuestionNl: QUESTION_NL,
      });
      const clarifyGated = await chargeAndRun(db, userId, clarifyRequestId, async (): Promise<AuditedResponse> => ({
        response: { kind: 'clarification', question: QUESTION, text: QUESTION_NL } as unknown as AuditedResponse['response'],
        auditId: clarifyAuditId,
      }));
      if (clarifyGated.kind !== 'ok') throw new Error(`expected ok, got ${clarifyGated.kind}`);

      // Turn 2: the reply, producing the final answer.
      const replyRequestId = randomUUID();
      const replyAuditId = await insertAuditRow(db, userId, {
        kind: 'answer',
        question: QUESTION,
        finalText: 'Amsterdam telt 931.298 inwoners.',
        requestId: replyRequestId,
        replyText: 'Amsterdam',
        repliedQuestionNl: QUESTION_NL,
      });
      const replyGated = await chargeAndRun(db, userId, replyRequestId, async (): Promise<AuditedResponse> => ({
        response: { kind: 'answer', question: QUESTION, text: 'Amsterdam telt 931.298 inwoners.' } as unknown as AuditedResponse['response'],
        auditId: replyAuditId,
      }));
      if (replyGated.kind !== 'ok') throw new Error(`expected ok, got ${replyGated.kind}`);

      const history = await getQuestionHistory(db, userId);
      expect(history).toHaveLength(1);
      const [entry] = history;
      expect(entry).toMatchObject({
        kind: 'answer',
        question: QUESTION,
        finalText: 'Amsterdam telt 931.298 inwoners.',
        clarification: { text: QUESTION_NL, reply: 'Amsterdam' },
      });
      // The consistency pin, extended to rounds: no expected number is
      // hardcoded -- whatever the gate charged across BOTH turns, history
      // must reconstruct the identical total from the ledger rows alone.
      expect(entry!.creditsCharged).toBe(clarifyGated.netCost + replyGated.netCost);
    });
  });

  it('keeps an unanswered clarification as its own entry', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await insertAuditRow(db, userId, {
        kind: 'clarification',
        question: QUESTION,
        finalText: QUESTION_NL,
        requestId: null,
        offeredQuestionNl: QUESTION_NL,
      });

      const history = await getQuestionHistory(db, userId);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ kind: 'clarification', clarification: null });
    });
  });

  it('keeps a reply row standalone when its clarification is not in the fetched window', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await insertAuditRow(db, userId, {
        kind: 'refusal',
        question: QUESTION,
        finalText: 'weigering',
        requestId: null,
        replyText: 'Beiden',
        repliedQuestionNl: QUESTION_NL,
      });

      const history = await getQuestionHistory(db, userId);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ kind: 'refusal', clarification: null });
    });
  });

  it('nulls the round total when either side has no attributable cost (never a partial sum)', async () => {
    await withDb(async (db) => {
      await applyPricingDefaults(db);
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);

      // Clarify turn: NO request_id (a pre-migration-010 row) -> null cost.
      await insertAuditRow(db, userId, {
        kind: 'clarification',
        question: QUESTION,
        finalText: QUESTION_NL,
        requestId: null,
        offeredQuestionNl: QUESTION_NL,
      });
      // Reply turn: a real gate-charged answer.
      const replyRequestId = randomUUID();
      const replyAuditId = await insertAuditRow(db, userId, {
        kind: 'answer',
        question: QUESTION,
        finalText: 'antwoord',
        requestId: replyRequestId,
        replyText: 'Amsterdam',
        repliedQuestionNl: QUESTION_NL,
      });
      const gated = await chargeAndRun(db, userId, replyRequestId, async (): Promise<AuditedResponse> => ({
        response: { kind: 'answer', question: QUESTION, text: 'antwoord' } as unknown as AuditedResponse['response'],
        auditId: replyAuditId,
      }));
      if (gated.kind !== 'ok') throw new Error(`expected ok, got ${gated.kind}`);

      const history = await getQuestionHistory(db, userId);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        kind: 'answer',
        clarification: { text: QUESTION_NL, reply: 'Amsterdam' },
        creditsCharged: null,
      });
    });
  });

  it('attaches a reply to the MOST RECENT open clarification with the same signature', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      // Two identical clarifications; only the second gets answered.
      const firstId = await insertAuditRow(db, userId, {
        kind: 'clarification', question: QUESTION, finalText: QUESTION_NL, requestId: null, offeredQuestionNl: QUESTION_NL,
      });
      const secondId = await insertAuditRow(db, userId, {
        kind: 'clarification', question: QUESTION, finalText: QUESTION_NL, requestId: null, offeredQuestionNl: QUESTION_NL,
      });
      await insertAuditRow(db, userId, {
        kind: 'answer', question: QUESTION, finalText: 'antwoord', requestId: null, replyText: 'Amsterdam', repliedQuestionNl: QUESTION_NL,
      });

      const history = await getQuestionHistory(db, userId);
      expect(history).toHaveLength(2);
      // Newest activity first: the collapsed round (built on the second
      // clarification), then the first clarification standing alone.
      expect(history[0]).toMatchObject({ id: secondId, kind: 'answer', clarification: { reply: 'Amsterdam', text: QUESTION_NL } });
      expect(history[1]).toMatchObject({ id: firstId, kind: 'clarification', clarification: null });
    });
  });

  // Pins the DOCUMENTED value-match limitation (history.ts header): two
  // identical open clarifications that BOTH get answered degrade gracefully
  // -- one collapsed round, one standalone clarify, one standalone reply --
  // never a crash, never a double-attached reply, costs untouched.
  it('degrades to standalone entries when two identical open rounds are both answered', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const firstClarifyId = await insertAuditRow(db, userId, {
        kind: 'clarification', question: QUESTION, finalText: QUESTION_NL, requestId: null, offeredQuestionNl: QUESTION_NL,
      });
      await insertAuditRow(db, userId, {
        kind: 'clarification', question: QUESTION, finalText: QUESTION_NL, requestId: null, offeredQuestionNl: QUESTION_NL,
      });
      await insertAuditRow(db, userId, {
        kind: 'answer', question: QUESTION, finalText: 'antwoord A', requestId: null, replyText: 'Amsterdam', repliedQuestionNl: QUESTION_NL,
      });
      await insertAuditRow(db, userId, {
        kind: 'answer', question: QUESTION, finalText: 'antwoord R', requestId: null, replyText: 'Rotterdam', repliedQuestionNl: QUESTION_NL,
      });

      const history = await getQuestionHistory(db, userId);
      expect(history).toHaveLength(3);
      // Exactly one collapsed round; each reply attached at most once.
      expect(history.filter((h) => h.clarification !== null)).toHaveLength(1);
      // The second reply stands alone (newest first), the first stranded
      // clarification stays honestly visible as unanswered.
      expect(history[0]).toMatchObject({ kind: 'answer', finalText: 'antwoord R', clarification: null });
      expect(history[2]).toMatchObject({ id: firstClarifyId, kind: 'clarification', clarification: null });
    });
  });

  it('caps ENTRIES, not rows: a collapsed round counts once against the limit', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await insertAuditRow(db, userId, { kind: 'answer', question: 'oudste', finalText: 'x', requestId: null });
      await insertAuditRow(db, userId, {
        kind: 'clarification', question: QUESTION, finalText: QUESTION_NL, requestId: null, offeredQuestionNl: QUESTION_NL,
      });
      await insertAuditRow(db, userId, {
        kind: 'answer', question: QUESTION, finalText: 'antwoord', requestId: null, replyText: 'Amsterdam', repliedQuestionNl: QUESTION_NL,
      });
      await insertAuditRow(db, userId, { kind: 'answer', question: 'nieuwste', finalText: 'x', requestId: null });

      const history = await getQuestionHistory(db, userId, { limit: 3 });
      expect(history.map((h) => h.question)).toEqual(['nieuwste', QUESTION, 'oudste']);
      expect(history[1]).toMatchObject({ kind: 'answer', clarification: { reply: 'Amsterdam', text: QUESTION_NL } });
    });
  });
});

// WP16 sub-part 2 (design §5-dashboard, ADR 026): the on-demand CBS table
// onboarding queue folded into the same dashboard timeline. Three states
// (pending, delivered, failed/refunded) -- each exercised through the REAL
// primitives (reserveOnboardingDebit, createPendingRequest, finalize*,
// compensate) rather than hand-set ledger rows, for the same
// consistency-not-arithmetic reason as the rest of this file.
describe('getQuestionHistory — onboarding queue (WP16 sub-part 2)', () => {
  it('shows an in-flight (pending) request with source "onboarding" and net 100', async () => {
    await withDb(async (db) => {
      await applyPricingDefaults(db);
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const requestId = randomUUID();
      const debit = await reserveOnboardingDebit(db, userId, requestId, 100);
      if (debit.kind !== 'debited') throw new Error(`expected debited, got ${debit.kind}`);
      await createPendingRequest(db, {
        userId,
        requestId,
        questionText: 'hoeveel zonnestroom werd er opgewekt in 2024',
        topicTerm: 'zonnestroom',
        tableId: '82610NED',
        finderConfidence: 0.91,
        debitTransactionId: debit.entry.id,
      });

      const history = await getQuestionHistory(db, userId);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        source: 'onboarding',
        kind: 'onboarding_pending',
        question: 'hoeveel zonnestroom werd er opgewekt in 2024',
        creditsCharged: 100,
        onboarding: { status: 'pending', topicTerm: 'zonnestroom', failureSummary: null },
      });
    });
  });

  it('shows a DELIVERED request as an ordinary answer entry with its real 100-credit cost, not twice', async () => {
    await withDb(async (db) => {
      await applyPricingDefaults(db);
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const requestId = randomUUID();
      const debit = await reserveOnboardingDebit(db, userId, requestId, 100);
      if (debit.kind !== 'debited') throw new Error(`expected debited, got ${debit.kind}`);
      const pending = await createPendingRequest(db, {
        userId,
        requestId,
        questionText: 'hoeveel zonnestroom werd er opgewekt in 2024',
        topicTerm: 'zonnestroom',
        tableId: '82610NED',
        finderConfidence: 0.91,
        debitTransactionId: debit.entry.id,
      });
      // The job's delivery re-run: same request_id, tagged 'onboarding_delivery'
      // (src/ingestion/onboarding.ts DELIVERY_SOURCE_TAG) -- NOT run through
      // chargeAndRun (design §3.7: "not through the gate, the 100 already
      // covers it"), so inserted directly as respond-audited.ts would.
      const { rows } = await db.query(
        `insert into audit_answers
           (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms, request_id)
         values (1, $1, 'onboarding_delivery', 'answer', $2, '2024-01-01', '{}'::jsonb, $3, '{}'::jsonb, 100, $4)
         returning id`,
        [userId, 'hoeveel zonnestroom werd er opgewekt in 2024', 'In 2024 werd 8.204 GWh zonnestroom opgewekt.', requestId],
      );
      const deliveryAuditId = Number(rows[0]!.id);
      await finalizeDelivered(db, pending.id, { deliveryAuditAnswerId: deliveryAuditId });

      const history = await getQuestionHistory(db, userId);
      // Exactly ONE entry for this question -- the onboarding-queue merge
      // must skip a 'delivered' row (it's already represented here).
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        id: deliveryAuditId,
        source: 'audit',
        kind: 'answer',
        finalText: 'In 2024 werd 8.204 GWh zonnestroom opgewekt.',
        creditsCharged: 100,
        onboarding: null,
      });
    });
  });

  it('shows a failed/refunded request with net 0 and the plain-language failure summary', async () => {
    await withDb(async (db) => {
      await applyPricingDefaults(db);
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const requestId = randomUUID();
      const debit = await reserveOnboardingDebit(db, userId, requestId, 100);
      if (debit.kind !== 'debited') throw new Error(`expected debited, got ${debit.kind}`);
      const pending = await createPendingRequest(db, {
        userId,
        requestId,
        questionText: 'q',
        topicTerm: 'niet-bestaand-onderwerp',
        tableId: 'AAAA',
        finderConfidence: 0.85,
        debitTransactionId: debit.entry.id,
      });
      await compensate(db, userId, debit.entry.id, 100, null);
      await finalizeFailed(db, pending.id, 'Onverwachte fout bij het ophalen: ECONNRESET');

      const history = await getQuestionHistory(db, userId);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        source: 'onboarding',
        kind: 'onboarding_pending',
        creditsCharged: 0,
        onboarding: {
          status: 'failed',
          failureSummary: 'Onverwachte fout bij het ophalen: ECONNRESET',
        },
      });
    });
  });

  it('does not let an onboarding entry collide in React-key space with an unrelated audit row sharing the same numeric id', async () => {
    await withDb(async (db) => {
      await applyPricingDefaults(db);
      const userId = randomUUID();
      await db.query('select public.grant_signup_credits($1)', [userId]);
      // An ordinary answered question, unrelated to onboarding.
      await insertAuditRow(db, userId, { kind: 'answer', question: 'gewone vraag', finalText: 'x', requestId: null });
      // A pending onboarding request -- pending_table_requests' own identity
      // sequence starts independently, so id collisions with audit_answers
      // are structurally possible; the two entries must both survive intact
      // (distinguished by `source`, per the type's own doc comment).
      const requestId = randomUUID();
      const debit = await reserveOnboardingDebit(db, userId, requestId, 100);
      if (debit.kind !== 'debited') throw new Error(`expected debited, got ${debit.kind}`);
      await createPendingRequest(db, {
        userId,
        requestId,
        questionText: 'onboarding vraag',
        topicTerm: 't',
        tableId: 'AAAA',
        finderConfidence: 0.9,
        debitTransactionId: debit.entry.id,
      });

      const history = await getQuestionHistory(db, userId);
      expect(history).toHaveLength(2);
      expect(history.map((h) => h.question).sort()).toEqual(['gewone vraag', 'onboarding vraag'].sort());
      expect(history.find((h) => h.question === 'gewone vraag')?.source).toBe('audit');
      expect(history.find((h) => h.question === 'onboarding vraag')?.source).toBe('onboarding');
    });
  });
});
