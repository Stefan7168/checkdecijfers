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
import type { BreakdownDimension } from '../../query/breakdowns.ts';
import type { TableParseSchema } from './input.ts';
import type { TableParseResult } from './parse.ts';

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
    named[breakdown.name] = choice.code;
  }

  return { ok: true, named };
}
