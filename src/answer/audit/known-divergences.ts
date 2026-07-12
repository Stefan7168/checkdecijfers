// #133(a) — the known-divergence register (docs/session-briefs/2026-07-12-
// smalls-133-brief.md §1, ADR 016's as-built addendum).
//
// Policy: `reconstructionReport` (reconstruct.ts) verifies a stored row
// against TODAY's deterministic builder rules, never the rules that were in
// force when the row was originally written. When a builder rule legitimately
// changes for the better — a safety fix like #64's non-contiguous-series
// chart refusal (session 22) or #115-lever-a's circular-title suppression
// (same day) — a row stored under the older, less-safe rule can start to
// diverge on fresh re-derivation, even though nothing about the row itself is
// wrong. R8's core promise is untouched by this: the STORED `final_text` /
// `response` still IS, verbatim, what the user actually saw. Divergence
// against a LATER, safer rule is a reconstruction-tooling artifact, not a
// data-integrity bug.
//
// The alternative — teaching `reconstructionReport` to replay each row's OWN
// historical rule set (a "which rule was live on this row's created_at"
// versioning mechanism) — was considered and rejected (design brief,
// 2026-07-12): it would mean keeping every superseded builder behavior alive
// forever, a machinery burden that only grows, for zero user-facing value
// (nobody wants a re-derivation to intentionally reproduce an OLDER, less
// safe chart/definition-line rule). All schema versions stay at 1;
// `reconstructionReport` stays reject-on-mismatch, unconditionally, for
// everyone who is not in this register.
//
// So a legitimate divergence is a DOCUMENTED, PINNED exception — never a
// blanket "old rows don't have to reconstruct" switch. Each entry names the
// exact row id, the exact substring(s) every one of its reported problems
// must contain, and the reason. Two consequences fall out of that shape:
//  - a row NOT listed here still fails today, full stop.
//  - a LISTED row whose reported problems don't ALL match its pinned
//    substring(s) ALSO still fails — the register narrows tolerance to one
//    specific, understood cause per row, never "this row is old, don't
//    bother checking it closely".
import type { AuditRecord } from './types.ts';

export interface KnownDivergence {
  /** The audit_answers.id this entry pins — one entry per row, never a range
   * or a pattern (a range would silently swallow a NEW, unrelated problem on
   * some other row that happens to fall inside it). */
  id: number;
  kind: AuditRecord['kind'];
  /** Every problem string `reconstructionReport` reports for this row must
   * contain at least one of these substrings for the divergence to count as
   * the documented, EXPECTED one (see `classifyKnownDivergence`) — any
   * problem matching none of them still fails the row, loudly. */
  expectProblemsContaining: string[];
  /** Plain-language reason this specific row no longer reconstructs under
   * today's rules, and which later change caused it — read by a human
   * auditing the register, not consumed by `classifyKnownDivergence`. */
  cause: string;
  /** ISO date (YYYY-MM-DD) this entry was recorded — for a future staleness
   * sweep of the register itself; not consumed by `classifyKnownDivergence`. */
  recordedDate: string;
}

// Exactly two entries today (#133, session 39) — both found + scoped during
// the 2026-07-12 A1 re-verification (open-questions #133), both already
// present in the row's stored `final_text`/`response.text` exactly as the
// user saw it; only fresh RE-DERIVATION diverges. The exact substrings below
// are copied verbatim from reconstruct.ts's `checkAnswerReconstruction` —
// never paraphrased, so a future wording change there is a loud 'unexpected'
// classification here rather than a silent miss.
export const KNOWN_DIVERGENCES: KnownDivergence[] = [
  {
    id: 76,
    kind: 'answer',
    expectProblemsContaining: ['chart spec does not re-derive from the stored result'],
    cause:
      "row stored before the #64 non-contiguous-series chart gate existed (session 22): today's " +
      "buildChartSpec now refuses to chart a series with the row's kind of period gap, so a fresh " +
      're-derivation from the stored result legitimately differs from the chart spec the row stored ' +
      'and the user actually saw.',
    recordedDate: '2026-07-12',
  },
  {
    id: 227,
    kind: 'answer',
    expectProblemsContaining: ['definition line does not re-derive from the stored attribution'],
    cause:
      "row stored before the #115-lever-a circular-title suppression existed (same day, later session): " +
      "today's buildDefinitionLine now suppresses a definition line that merely repeats the answer's own " +
      "title, so a fresh re-derivation legitimately differs from the definition line the row stored and " +
      'the user actually saw.',
    recordedDate: '2026-07-12',
  },
];

/** Classifies a fresh `reconstructionReport(record).problems` array against
 * one register entry. Pure — no I/O, no database, just the two arrays — so
 * `scripts/verify-audit-rows.ts` (and this module's own unit tests) can call
 * it directly.
 *
 *  - `'stale'`: `problems` is empty — the row reconstructs clean NOW (e.g. it
 *    was since GDPR-redacted, which strips the exact content the old rule
 *    diverged on, or the builder rule changed again in a way that happens to
 *    re-align). The register entry no longer describes a real divergence;
 *    `verify-audit-rows.ts` prints this as a housekeeping NOTE, never an
 *    error — a stale entry is a prompt to prune the register, not a bug.
 *  - `'matches'`: `problems` is non-empty and EVERY problem contains at least
 *    one of the entry's `expectProblemsContaining` substrings — exactly the
 *    documented, pinned cause and nothing else.
 *  - `'unexpected'`: `problems` is non-empty and at least one problem matches
 *    none of the expected substrings — a NEW, unpinned divergence hiding
 *    behind an old entry's row id. This must still fail loudly; the register
 *    narrows tolerance, it never widens it.
 */
export function classifyKnownDivergence(
  problems: string[],
  entry: KnownDivergence,
): 'matches' | 'unexpected' | 'stale' {
  if (problems.length === 0) return 'stale';
  const allExpected = problems.every((problem) =>
    entry.expectProblemsContaining.some((expected) => problem.includes(expected)),
  );
  return allExpected ? 'matches' : 'unexpected';
}
