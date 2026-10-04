// Owner decision 2026-10-04 (the Eurostat chip): when the reader has switched CBS OFF and kept Eurostat ON,
// the curated answer path — which only knows CBS tables — must never answer. This module is the one place
// that decides what happens to a parse outcome in that mode, so the rule is a function with a test, not
// a scatter of ifs in respond.ts.
//
// The rule, kind by kind (every ParseOutcome kind is decided explicitly; the `never` check below makes a
// new kind a compile error instead of a silent pass-through):
//   intent        a CURATED reading (every shape: one measure, compare, scatter, region set …) → would
//                 answer from curated CBS data → NOT answered. The whole question goes to the Eurostat-only
//                 finder instead.
//   clarification a CURATED clarification (offers CBS measures/regions) → same: not asked, routed.
//   refusal       forecast / causal / compound / smalltalk (incl. the meta router) / out_of_scope: not a data
//                 answer → passes through unchanged. (out_of_scope already had its Eurostat-only
//                 whole-question search inside the parse; a pick would have come back as 'onboarding'.)
//   onboarding    already routed by an Eurostat-only finder → passes through, but only when its table's source
//                 is among the selected sources (a belt: a deselected source never silently answers).
// "Routed" = routeWholeQuestion(context, finder): a confident pick becomes an 'onboarding' outcome (the
// table lane takes it from there, as for any finder pick). No pick, no finder (the reply path injects none),
// or a pick from a source that is not selected → `null`, which the caller turns into the
// no_eurostat_table refusal. Principle (c): a deselected source never answers; no pick means refuse.
import { CBS_SOURCE_KEY, EUROSTAT_SOURCE_KEY, sourceKeyForTableId } from '../../sources/registry.ts';
import type { SourceSelection } from '../../websearch/types.ts';
import { routeWholeQuestion, type OnboardingRouting, type TableFinder } from '../intent/policy.ts';
import type { ParseOutcome } from '../intent/types.ts';

/** CBS off, Eurostat on — the one selection shape this module acts on. Absent selection (benchmark, tests,
 * CLI, websearch off) is never Eurostat-only. */
export function isEurostatOnly(selection: SourceSelection | undefined): boolean {
  return (
    selection !== undefined &&
    !selection.sources.includes(CBS_SOURCE_KEY) &&
    selection.sources.includes(EUROSTAT_SOURCE_KEY)
  );
}

/** Wraps a finder so a repeat call for the same (term, question) returns the first call's answer. In
 * Eurostat-only mode the parse itself may already have run the whole-question search (out_of_scope, or an
 * unmatched topic that fell through to it); the override would then repeat the identical, paid search for the
 * same question. Per-turn scope: build a fresh one per respond call. `undefined` in, `undefined` out. */
export function memoizeFinder(finder: TableFinder | undefined): TableFinder | undefined {
  if (finder === undefined) return undefined;
  const seen = new Map<string, Promise<OnboardingRouting | null>>();
  return (term, question) => {
    const key = `${term}\u0000${question}`;
    let hit = seen.get(key);
    if (hit === undefined) {
      hit = finder(term, question);
      seen.set(key, hit);
    }
    return hit;
  };
}

/** The Eurostat-only override. Returns the outcome to continue with (the parse itself, or the 'onboarding'
 * outcome a confident Eurostat pick produced), or `null` = nothing may answer → the caller refuses with
 * `no_eurostat_table`. Only called when isEurostatOnly(selection). */
export async function eurostatOnlyOverride(
  parse: ParseOutcome,
  selection: SourceSelection,
  questionFinder: TableFinder | undefined,
): Promise<ParseOutcome | null> {
  const selected = (tableId: string): boolean => selection.sources.includes(sourceKeyForTableId(tableId));
  switch (parse.kind) {
    case 'refusal':
      return parse;
    case 'onboarding':
      return selected(parse.tableId) ? parse : null;
    case 'intent':
    case 'clarification': {
      if (questionFinder === undefined) return null;
      const routed = await routeWholeQuestion(
        { question: parse.question, raw: parse.raw, model: parse.model, usage: parse.usage },
        questionFinder,
      );
      if (routed === null || routed.kind !== 'onboarding') return null;
      return selected(routed.tableId) ? routed : null;
    }
    default: {
      const _exhaustive: never = parse;
      throw new Error(`internal: unhandled parse kind ${String((_exhaustive as ParseOutcome).kind)}`);
    }
  }
}
