// Harness-only intent injection (session 111, dev-harness Task 1). The local
// real-browser harness (scripts/dev-harness/) stubs the LLM by replaying
// recorded fixtures — so any answer shape the real parser cannot YET produce
// (today: region-set answers, ADR 054 — Task 9, the LLM-facing vocabulary, is
// deliberately NOT built) is unreachable in the harness the same way it is
// unreachable in production. This file adds ONE bypass, gated on an env flag
// the harness alone sets, so an audit can exercise `respondToIntent` with a
// hand-authored StructuredIntent without touching the parser prompt/schema at
// all (CLAUDE.md hard limit: nothing under src/answer/intent/prompt.ts or
// schema.ts changes for this).
//
// Reachable ONLY when HARNESS_INTENT_INJECT=1 (unset in production and in
// every other test/runner path). Flag off, or a question that doesn't use
// either magic prefix, returns null: the caller falls through to the ordinary
// parseQuestion/parseFollowUpQuestion path, byte-identical to before this
// file existed. See tests/answer/harness-intent.test.ts for the pin.
import { INTENT_SCHEMA_VERSION, type StructuredIntent } from '../../query/types.ts';
import { RAW_PARSE_VERSION, type ParseOutcome } from '../intent/types.ts';

export const HARNESS_INTENT_ENV_FLAG = 'HARNESS_INTENT_INJECT';

const NAMED_PREFIX = '!!regionset ';
const RAW_PREFIX = '!!intent ';

/** The two ready-made region-set questions documented in
 * scripts/dev-harness/README.md — deliberately the SAME canonical key,
 * period and scope as tests/query/region-set-run.test.ts's own "a complete
 * class" cases, so a harness screenshot and the hermetic suite agree on what
 * a region-set answer looks like. */
const NAMED_INTENTS: Record<string, StructuredIntent> = {
  provincies: {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: { kind: 'canonical', key: 'population_on_1_january' },
    period: { kind: 'codes', codes: ['2025JJ00'] },
    derivation: 'none',
    regionSet: { kind: 'all_provincies' },
  },
  'gemeenten-utrecht': {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: { kind: 'canonical', key: 'average_home_sale_price_by_gemeente' },
    period: { kind: 'codes', codes: ['2024JJ00'] },
    derivation: 'none',
    regionSet: { kind: 'gemeenten_in_provincie', parent: 'PV26' },
  },
};

function harnessInjectEnabled(): boolean {
  // Belt on top of the flag (parent review, session 110): a production build
  // (NODE_ENV=production on Vercel) never honours the flag even if someone
  // sets it there by mistake — the injector is a dev-harness tool only.
  return process.env[HARNESS_INTENT_ENV_FLAG] === '1' && process.env.NODE_ENV !== 'production';
}

/** A minimal, non-validating shape guard — this is a harness convenience, not
 * a public API surface. A malformed payload returns null (never throws), so
 * a typo'd `!!intent` question falls through to the ordinary parse (→ an
 * honest llm-stub MISS), rather than crashing respondToQuestion. */
function looksLikeStructuredIntent(value: unknown): value is Omit<StructuredIntent, 'schemaVersion'> {
  return (
    value !== null &&
    typeof value === 'object' &&
    'target' in value &&
    'period' in value &&
    'derivation' in value
  );
}

/** Returns the hand-authored intent a `!!regionset <name>` / `!!intent {json}`
 * question carries, or null (flag off, unknown name, unparsable JSON, or an
 * ordinary question). Exported separately from `harnessParseOutcome` so a
 * test can assert the flag-off / no-prefix cases return null without also
 * asserting the ParseOutcome shape. */
export function tryHarnessInjectedIntent(question: string): StructuredIntent | null {
  if (!harnessInjectEnabled()) return null;
  if (question.startsWith(NAMED_PREFIX)) {
    const name = question.slice(NAMED_PREFIX.length).trim();
    return NAMED_INTENTS[name] ?? null;
  }
  if (question.startsWith(RAW_PREFIX)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(question.slice(RAW_PREFIX.length));
    } catch {
      return null;
    }
    if (!looksLikeStructuredIntent(parsed)) return null;
    return { ...parsed, schemaVersion: INTENT_SCHEMA_VERSION };
  }
  return null;
}

/** Wraps an injected StructuredIntent into exactly the shape `parseQuestion`
 * returns on a real hit, so `respondToParseOutcome` (respond.ts) cannot tell
 * the difference — it falls straight through to `respondToIntent`.
 * `raw`/`model`/`usage` are harness placeholders: nothing downstream reads
 * them for anything but the audit record's echoed diagnostics (R8), and the
 * empty `raw.candidates`/`ranked` correctly record that no real LLM call
 * ran — the audited `llm_calls` row for this turn's intent role is honestly
 * absent, not faked. */
export function harnessParseOutcome(
  question: string,
  intent: StructuredIntent,
): Extract<ParseOutcome, { kind: 'intent' }> {
  return {
    kind: 'intent',
    question,
    raw: {
      version: RAW_PARSE_VERSION,
      kind: 'data_query',
      candidates: [],
      unmatchedMeasureTerm: null,
      nearestCanonicalKeys: [],
      note: `harness-injected intent (${HARNESS_INTENT_ENV_FLAG}=1) — no real LLM parse ran`,
    },
    model: 'harness-intent-inject',
    usage: { inputTokens: 0, outputTokens: 0 },
    intent,
    confidence: 1,
    impliedRecency: false,
    ranked: [],
  };
}
