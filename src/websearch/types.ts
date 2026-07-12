// WP129+130 (ADR 032): the unverified web-search augmentation channel — a PURE
// LEAF (types + one policy const, no imports). Consumed by the backend (attach,
// the response envelope, audit reconstruct) and, transitively via the envelope,
// by client-bundled web code — so it must never pull the Anthropic SDK / module
// graph in (client.ts does that; this file must not).
//
// The separation IS the honesty model (ADR 032): a WebSection rides the audit
// envelope as an ADDITIVE structural field, stored VERBATIM (R8) and replayed
// on reconstruction — never re-derived (the web is non-deterministic). Its text
// NEVER enters response.text / answer.body / any validator input / attribution
// / chart data / the benchmark's fabrication scoring.

/** One web finding: a single short sentence + its citation link(s). Rendered as
 * plain, React-escaped text with domain-only anchors (never markdown). */
export interface WebFinding {
  text: string;
  citations: { url: string; title: string | null }[];
}

/** The augmentation outcome stored verbatim on the envelope. `ok` carries 1..4
 * cited findings; `failed` carries a machine code the UI maps to an honest
 * one-line note and the settlement step maps to "refund the add-on". */
export type WebSection =
  | {
      status: 'ok';
      findings: WebFinding[];
      model: string;
      searches: number;
      usage: { inputTokens: number; outputTokens: number };
      promptVersion: number;
    }
  | {
      status: 'failed';
      code: 'api_error' | 'no_findings' | 'stopped' | 'insufficient_balance' | 'not_configured';
    };

/** The #129 source-tags selection: a STRUCTURAL pipeline input (never prompt
 * text). `sources` are registry keys (e.g. 'cbs'); `web` is the "Internet" chip
 * (the augmentation channel, not a registry source). Rides the audit envelope
 * so R8 reconstructs WHAT was searched. */
export interface SourceSelection {
  sources: string[];
  web: boolean;
}

/** ⟨W3⟩ Refusal reasons that do NOT owe a web attempt: not data questions
 * (smalltalk/meta), an honest split (compound), internal errors (internal), the
 * empty-selection belt (no_sources — note web_only DOES owe: it is the web-only
 * mode), and the onboarding acknowledgments (fetch-underway info, not a data
 * refusal — including them created a 110-credit combined turn against
 * maybeTriggerOnboarding that evaporates by skipping). Every OTHER refusal
 * (forecast/causal/scope/freshness/staleness/not_published/outside_loaded_slice/
 * quarantined/still_ambiguous/web_only) DOES get the web section — a forecast
 * question is exactly where the web adds value. Shared by attach (owed-check)
 * and audit reconstruct check (d) so the two can never drift. Plain string
 * literals (no RefusalReason import) keep this a pure leaf. */
export const WEBSEARCH_SKIP_REASONS = [
  'smalltalk',
  'meta',
  'compound',
  'internal',
  'no_sources',
  'onboarding_pending',
  'onboarding_already_pending',
] as const;
