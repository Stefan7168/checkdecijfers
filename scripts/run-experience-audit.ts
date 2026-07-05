// Experience-audit runner (session 23) — drives the 110-question audience-
// grounded battery (benchmark/experience-audit-questions.json) through the
// AUDITED pipeline against the LIVE database + real Anthropic calls, exactly
// the run-validation-pass.ts pattern. Deliverable: the per-question dump this
// writes, graded on USER EXPERIENCE (not just correctness) into a ranked memo.
//
//   npm run audit:experience   live only. Spends real tokens (~124 turns) and
//                              writes REAL audit_answers rows (sourceTag
//                              'validation' — the same manual-pass tag).
//
// Deliberate differences from run-validation-pass.ts:
//  - Follow-up chains (items with a `followup`) are run as a REAL 2-turn
//    conversation: turn 1 answered, then buildConversationContext + validate
//    (mirroring web/app/actions.ts) feed turn 2 — so conversation memory is
//    measured honestly, not artificially failed by dropping context.
//  - Clarifications are recorded AS the outcome (no reply round), same as the
//    validation pass — the reply-merge was measured elsewhere; here the signal
//    is "did it needlessly ask / dead-end", visible from the clarification itself.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerQuestionAudited } from '../src/answer/audit/index.ts';
import type { AuditedResponse } from '../src/answer/audit/index.ts';
import { buildConversationContext, validateConversationContext } from '../src/answer/context/index.ts';
import { AnthropicLlmClient } from '../src/answer/llm/client.ts';
import { connectFromEnv } from '../src/db/client.ts';

const BATTERY_PATH = fileURLToPath(new URL('../benchmark/experience-audit-questions.json', import.meta.url));
const DUMP_PATH = fileURLToPath(new URL('../benchmark/experience-audit-run.json', import.meta.url));

/** Mirrors web/app/actions.ts — the deployed app's clock. */
function referenceDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

interface BatteryQuestion {
  id: string;
  segment: string;
  persona: string;
  probes: string;
  question: string;
  followup: string | null;
  good_outcome: string;
  answerable_today: string;
}

/** Compact, gradeable summary of one turn's envelope — the fields the memo
 * scores on. The FULL envelope is kept too, for anything the summary misses. */
function summarize(response: AuditedResponse['response']): Record<string, unknown> {
  const r = response as Record<string, unknown>;
  return {
    kind: r.kind,
    refusalReason: r.kind === 'refusal' ? (r.reason ?? null) : null,
    // The user-facing text is `text` for every kind (answer prose, clarification
    // question, or refusal message); `options` carries clarification choices.
    text: r.text ?? null,
    clarificationOptions: r.kind === 'clarification' ? (r.options ?? null) : null,
    hasChart: Boolean(r.chart ?? null),
  };
}

async function runTurn(
  db: ReturnType<typeof connectFromEnv>['db'],
  client: AnthropicLlmClient,
  question: string,
  refDate: string,
  conversationContext: unknown | null,
): Promise<{ outcome: AuditedResponse; latencyMs: number }> {
  const startedAt = performance.now();
  const outcome = await answerQuestionAudited(db, question, {
    referenceDate: refDate,
    intentClient: client,
    answerClient: client,
    sourceTag: 'validation',
    ...(conversationContext ? { conversationContext: conversationContext as never } : {}),
  });
  return { outcome, latencyMs: Math.round(performance.now() - startedAt) };
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.DATABASE_URL) {
    throw new Error('ANTHROPIC_API_KEY and DATABASE_URL must be set — run via: npm run audit:experience');
  }
  const refDate = referenceDate();
  const client = new AnthropicLlmClient();
  const { db, pool } = connectFromEnv();
  const battery = JSON.parse(readFileSync(BATTERY_PATH, 'utf8')) as { questions: BatteryQuestion[] };
  // Optional smoke-test filters (no arg = the full battery):
  //   --segment=followup-chains   only that segment
  //   --limit=2                   first N after the segment filter
  const segmentArg = process.argv.find((a) => a.startsWith('--segment='))?.split('=')[1];
  const limitArg = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1];
  let questions = battery.questions;
  if (segmentArg) questions = questions.filter((q) => q.segment === segmentArg);
  if (limitArg) questions = questions.slice(0, Number(limitArg));
  const runs: Record<string, unknown>[] = [];

  console.log(`experience audit: ${questions.length} questions, referenceDate ${refDate} (Europe/Amsterdam, live clock)`);
  try {
    for (const q of questions) {
      const t1 = await runTurn(db, client, q.question, refDate, null);
      const record: Record<string, unknown> = {
        id: q.id,
        segment: q.segment,
        persona: q.persona,
        probes: q.probes,
        answerable_today: q.answerable_today,
        good_outcome: q.good_outcome,
        question: q.question,
        followup: q.followup,
        turn1: {
          ...summarize(t1.outcome.response),
          auditId: t1.outcome.auditId,
          latencyMs: t1.latencyMs,
          response: t1.outcome.response,
        },
        turn2: null,
      };

      let t2Label = '';
      if (q.followup) {
        // Real 2-turn: build the ADR-021 context from turn 1, validate it
        // (both the app does), then answer the follow-up with it.
        let context: unknown | null = null;
        let contextBuilt = false;
        let contextError: string | null = null;
        try {
          const built = await buildConversationContext(db, t1.outcome.response);
          context = await validateConversationContext(db, (built ?? null) as never);
          contextBuilt = context !== null;
        } catch (error) {
          contextError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        }
        const t2 = await runTurn(db, client, q.followup, refDate, context);
        record.turn2 = {
          ...summarize(t2.outcome.response),
          auditId: t2.outcome.auditId,
          latencyMs: t2.latencyMs,
          contextBuilt,
          contextError,
          response: t2.outcome.response,
        };
        t2Label = ` | followup: ${(t2.outcome.response as Record<string, unknown>).kind}${contextBuilt ? ' (ctx)' : ' (NO ctx)'}`;
      }

      runs.push(record);
      const k1 = (t1.outcome.response as Record<string, unknown>).kind;
      const reason = (t1.outcome.response as Record<string, unknown>).reason;
      console.log(`  ${q.id} [${q.segment}] ${k1}${reason ? `/${reason}` : ''}${t2Label} (${t1.latencyMs} ms)`);
    }
  } finally {
    try {
      await pool.end();
    } catch (closeError) {
      console.error('warning: closing the database connection failed:', closeError);
    }
  }

  const bySegment: Record<string, Record<string, number>> = {};
  for (const run of runs) {
    const seg = run.segment as string;
    const kind = (run.turn1 as Record<string, unknown>).kind as string;
    bySegment[seg] ??= {};
    bySegment[seg][kind] = (bySegment[seg][kind] ?? 0) + 1;
  }
  const dump = {
    mode: 'experience-audit',
    generatedAt: new Date().toISOString(),
    referenceDate: refDate,
    questionCount: runs.length,
    bySegment,
    runs,
  };
  writeFileSync(DUMP_PATH, `${JSON.stringify(dump, null, 1)}\n`);
  console.log(`\nby segment:`, JSON.stringify(bySegment, null, 1));
  console.log(`dump written to benchmark/experience-audit-run.json`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
