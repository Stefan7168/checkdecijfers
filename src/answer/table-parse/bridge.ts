// Breadth step 4, Task 4 — the bridge from a validated TableParseResult
// (Task 3) into step 3's breakdown resolver input (src/query/breakdowns.ts
// resolveBreakdowns' `named: Record<dim, code>`).
//
// Pure and synchronous: no db, no ingestion import, no LLM call (principle
// a) — this module only re-shapes an already-validated result, it never
// makes a new judgment call about what the reader meant.
//
// Per-dimension mapping (Global Constraints, Task 3's TableParseBreakdownChoice):
//   'member'    -> named[dim] = code, but ONLY after re-checking that code
//                  against the table's FULL code list (fullDims), not just
//                  the (possibly pre-filtered) offered subset Task 3's
//                  validator already checked it against. Task 3's validator
//                  guarantees the code is one of TableParseSchema's OFFERED
//                  members for that dimension; since every offered member is
//                  itself drawn from the same table's full code list (Task
//                  2's buildBreakdown maps straight from `codeLists`), this
//                  second check should always succeed — it exists as a
//                  defense-in-depth seam against caller drift (e.g. a
//                  `fullDims` built from a different table or a stale code
//                  list), not because the first check is expected to fail.
//                  Final-review F5: when the picked code IS the dimension's
//                  own CBS grand total (step 3's findGrandTotal over the FULL
//                  list), the dimension is left OUT of `named` instead — the
//                  resolver then picks that same total itself AND records it
//                  as a StatedDefault, so the answer discloses the total
//                  ("Uitgangspunt: …") exactly as it does for a dimension
//                  the reader never mentioned. Same coordinate, never hidden.
//   'not_named' -> OMITTED from `named` entirely. resolveBreakdowns then
//                  decides for itself, per its own conservative rule: fall
//                  to CBS's own grand total when one uniquely exists, or ask
//                  (never a silent guess either way, principle c).
//   'other'     -> the FIRST such dimension, in the table's own order (Task
//                  2's `input.breakdowns` order), becomes a clarifying
//                  question for THAT dimension's FULL member list — never
//                  the total (Global Constraints: "the bridge turns 'anders'
//                  into a question for that dimension, NEVER into the CBS
//                  total"). Exactly one question at a time (principle c),
//                  so a second 'other' dimension elsewhere in the same parse
//                  is simply never reached this call — a later call (after
//                  the reader answers) resolves it in turn.
//
// Fix round 1 (task review, controller ruling): `parse.measureCode === null`
// ('geen' — no measure in the table answers the question) is NOT this
// module's concern at all. A refused measure must be handled by the CALLER
// (step 5) before it ever reaches namedFromParse — turning a 'geen' parse
// into a breakdown question would silently imply a measure exists and is
// just waiting on a dimension answer, which is false and would eventually
// produce a number for a question the table cannot actually answer
// (principle c: refuse, never guess/imply). This function therefore throws a
// plain Error on `measureCode === null`, the same "internal inconsistency,
// not reader ambiguity" treatment as its other invariant violations — a
// caller that reaches here with a 'geen' parse has a bug, not a design
// question to route through step 3.
import {
  eurostatGrandTotal,
  findGrandTotal,
  firstMemberTotalLike,
  type BreakdownDimension,
  type BreakdownMember,
  type TotalRule,
} from '../../query/breakdowns.ts';
import type { TableParseSchema } from './input.ts';
import type { TableParseResult } from './parse.ts';

/**
 * A parser pick that means "this dimension is not restricted" and is
 * therefore left to the resolver instead of being named:
 *   - the dimension's own unique CBS grand total (final-review F5) — the
 *     resolver lands on that same total and discloses it; or
 *   - session 153: the dimension's FIRST member, titled "Totaal …" (or a
 *     T00 code), on a dimension WITHOUT a unique grand total. The first live
 *     recording showed both the cheap and the mid-tier model picking
 *     "Totaal leeftijd" over "Totaal, gestandaardiseerd" for a question that
 *     never mentions age; choosing between two totals is the resolver's call
 *     (it asks), never the model's (principle c). Only the first member: a
 *     later "Totaal …" member is a sub-total a reader can name on purpose
 *     ("Totaal bedrijfsmotorvoertuigen") and stays named.
 */
export function isTotalPick(members: BreakdownMember[], code: string, rule?: TotalRule): boolean {
  // Session 153: a Eurostat dimension has no first-member convention — only its
  // own unique total (eurostatGrandTotal) is a total pick.
  const total = rule === 'eurostat' ? eurostatGrandTotal(members) : (findGrandTotal(members) ?? firstMemberTotalLike(members));
  return total !== null && total.code === code;
}

export type NamedFromParseResult =
  | { ok: true; named: Record<string, string> }
  | { ok: false; askDimension: string };

/**
 * Turns a validated table-scoped parse into step 3's `named` input. Throws
 * only on an internal inconsistency — a 'geen' parse (`measureCode === null`,
 * see the module doc comment above) reaching this function at all, or a
 * 'member' choice whose code is not found in `fullDims`'s own list for that
 * dimension — never on ordinary reader ambiguity, which is what 'other'
 * (-> ask) and the resolver's own no-total-ask path are for.
 */
export function namedFromParse(
  parse: TableParseResult,
  input: TableParseSchema,
  fullDims: BreakdownDimension[],
): NamedFromParseResult {
  if (parse.measureCode === null) {
    throw new Error(
      "namedFromParse: parse.measureCode is null ('geen') — a refused measure must be handled by the " +
        'caller BEFORE any breakdown handling; a geen parse must never be turned into a breakdown question',
    );
  }

  const fullByName = new Map(fullDims.map((d) => [d.name, d]));
  const named: Record<string, string> = {};

  for (const breakdown of input.breakdowns) {
    const choice = parse.breakdowns[breakdown.name];
    if (!choice) {
      // Task 3's validateTableParseOutput guarantees exactly one choice per
      // offered dimension — a missing entry here means the caller handed us
      // a TableParseResult that was never validated, or one built for a
      // different TableParseSchema. Either way this is a programming error,
      // not a data ambiguity (principle c is about the READER's data, not
      // about our own internal contracts).
      throw new Error(
        `namedFromParse: table-parse result is missing a choice for offered dimension '${breakdown.name}'`,
      );
    }

    if (choice.kind === 'other') {
      return { ok: false, askDimension: breakdown.name };
    }
    if (choice.kind === 'not_named') {
      continue;
    }

    // choice.kind === 'member' — re-check against the FULL code list.
    const fullDim = fullByName.get(breakdown.name);
    const fullMember = fullDim?.members.find((m) => m.code === choice.code);
    if (!fullMember) {
      throw new Error(
        `namedFromParse: member '${choice.code}' chosen for dimension '${breakdown.name}' was not found in ` +
          `that dimension's full code list — fullDims must be the SAME table's own dimensions as the ` +
          `TableParseSchema this result was validated against`,
      );
    }
    // F5: an explicit total pick goes through the resolver's own default
    // path, so it is disclosed as a stated default (see module doc).
    if (isTotalPick(fullDim!.members, choice.code, fullDim!.totalRule)) continue;
    named[breakdown.name] = choice.code;
  }

  return { ok: true, named };
}
