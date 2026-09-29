// Shared per-turn options for every server path that answers a question on a
// reader's behalf: askQuestion / replyToClarification (web/app/actions.ts),
// the onboarding-cron delivery re-run and the table-lane job
// (web/lib/table-lane-job-deps.ts). One copy, so a chat turn and a background
// answer can never drift apart (fix round 1 of breadth step 5 Task 4, M5).
// Server-only (constructs an Anthropic client when the checker is live).
import type { SemanticCheckOptions } from '../backend/answer/compose/index.ts';
import { AnthropicLlmClient, type LlmClient } from '../backend/answer/llm/client.ts';

// The one legitimate un-pinned clock in the codebase — every other call site
// (tests, hermetic CI, the benchmark runner) injects a fixed reference date.
// Computed in the product's own timezone (WP12 review): a plain UTC date is
// still yesterday for up to two hours after midnight in the Netherlands,
// which would skew relative-period resolution ("vorige maand").
export function referenceDate(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

// #144 (ADR 034): the semantic checker's construction seam — DORMANT until the
// owner-supervised go-live sets SEMANTIC_CHECK_ENABLED='1' (fixture-recorded
// calibration first; the RUNBOOK step). SEMANTIC_CHECK_FAILMODE carries the
// recorded owner decision on checker-call failures: 'closed' → a checker error
// rejects the body down the R3 ladder (template fallback); anything else →
// fail open (the body already passed the FULL deterministic validator — the
// checker is defense-in-depth, not the primary gate). While dormant, no path
// constructs the client (the factory is never called) and zero extra LLM calls
// or spend exist.
export function semanticCheckOptions(
  makeClient: () => LlmClient = () => new AnthropicLlmClient(),
): { semanticCheck: SemanticCheckOptions } | Record<string, never> {
  if (process.env.SEMANTIC_CHECK_ENABLED !== '1') return {};
  return {
    semanticCheck: {
      client: makeClient(),
      mode: process.env.SEMANTIC_CHECK_FAILMODE === 'closed' ? 'fail_closed' : 'fail_open',
    },
  };
}
