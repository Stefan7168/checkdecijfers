// Regional statistics part 2 (ADR 061 part 2, Task 2 fix round 1) — a
// registry-wide guard, not scoped to the 12 new figures.
//
// `subject()` (src/answer/compose/template.ts) embeds a canonical measure's
// `definitionLabel` VERBATIM into the scanned answer body, for both the
// single-region and region-set renderers ("... de hoogste waarde voor
// <definitionLabel>: ..."). R3 forbids a spelled-out Dutch quantity/cardinal
// word-form anywhere in that scanned body ("hoeveelheden alleen in cijfers")
// — found the hard way when `population_growth_per_1000`'s own label ("...per
// duizend van de beginbevolking...") broke every answer for that key (Task 2,
// this same session). This test is the guard that catches the NEXT such
// wording bug at registry-authoring time, for every measure, not just the
// one that happened to get exercised by a hermetic-DB test.
import { describe, expect, it } from 'vitest';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';
import { wordFormProblems } from '../../src/answer/compose/validate.ts';
import { normalizeForScan } from '../../src/answer/compose/format.ts';

describe('every CANONICAL_MEASURES definitionLabel passes the R3 word-form check', () => {
  it('no definitionLabel contains a spelled-out Dutch quantity/cardinal word form', () => {
    const offenders: string[] = [];
    for (const measure of CANONICAL_MEASURES) {
      if (measure.definitionLabel === null || measure.definitionLabel === undefined) continue;
      // wordFormProblems requires its input already normalizeForScan'd (its
      // own doc comment) — a no-op for the plain-ASCII labels in production,
      // but correct regardless of a future NFKC-foldable character.
      const problems = wordFormProblems(normalizeForScan(measure.definitionLabel));
      if (problems.length > 0) {
        offenders.push(`${measure.key}: ${problems.join('; ')} (label: "${measure.definitionLabel}")`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
