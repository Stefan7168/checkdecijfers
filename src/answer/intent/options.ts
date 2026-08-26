// The caller-supplied options shared by every intent-parsing entry point
// (fresh question, follow-up, clarification reply) — extracted after the
// three per-module interfaces drifted out of sync twice: #176, then #191.
// Both times a WP16/WP26 field was added to one interface and not the
// others, and the mismatch compiled cleanly — a type-checked call site that
// silently dropped a seam on that one turn, not a syntax error. respond.ts
// already relies on the fresh-question and follow-up shapes being IDENTICAL
// (it reuses one object across both `parseQuestion` and
// `parseFollowUpQuestion` calls); that reliance is now enforced by
// construction instead of by coincidence.
import type { IntentLlmClient } from './client.ts';
import type { OnboardedMeasure } from './prompt.ts';
import type { TableFinder } from './policy.ts';
import type { ParserConfig } from './types.ts';

/** Every entry point's LLM-call plumbing plus the WP16/WP26 seams that apply
 * regardless of which turn is being parsed. */
export interface IntentCallOptions {
  client: IntentLlmClient;
  config?: ParserConfig;
  model?: string;
  maxTokens?: number;
  /** WP16 sub-part 2 (ADR 026): OPTIONAL table-finder — present only when the
   * caller wants an unmatched topic to route to the on-demand fetch trigger.
   * Absent everywhere else (benchmark, tests, CLI, and — deliberately, see
   * respond.ts's `clarifyOptions` — the reply turn) → the plain B15
   * clarification, byte-identical. */
  tableFinder?: TableFinder;
  /** WP16 sub-part 2 (ADR 026, design §3.6/§0.4): OPTIONAL extra canonical
   * measures appended to the parser vocabulary — the on-demand-onboarded
   * measures registered by the fetch job. Absent/empty → the prompt bytes are
   * IDENTICAL to Phase-0-only (recorded fixtures + benchmark unaffected by
   * construction). */
  extraCanonicalMeasures?: OnboardedMeasure[];
  /** WP26 mechanism B (ADR 024): the `ANSWER_FIRST_ENABLED` rollout flag,
   * threaded into the dry-runs so an option is judged servable under the SAME
   * rules the answer turn will run under. Off/absent ⇒ byte-identical. */
  answerFirstEnabled?: boolean;
}

/** The two entry points that can start a FRESH clarification round — a
 * standalone question, or a follow-up — also need the reference clock and
 * WP26 mechanism A's click-options gate. A clarification REPLY doesn't:
 * mechanism A only ever attaches click options to a NEWLY offered
 * clarification, and a still-ambiguous reply always resolves to a
 * refusal-with-guidance, never a second clickable round (docs/05, R7 — see
 * clarify.ts's module comment). */
export interface FreshIntentParseOptions extends IntentCallOptions {
  /** YYYY-MM-DD "today" for relative periods ("vorige maand") — injected,
   * never read from the wall clock inside the pipeline. */
  referenceDate: string;
  /** WP26 mechanism A (ADR 024): the `CLARIFY_CLICK_ENABLED` rollout flag.
   * Off/absent → no dry-runs, no clickable options, byte-identical
   * clarifications. */
  clickOptionsEnabled?: boolean;
}
