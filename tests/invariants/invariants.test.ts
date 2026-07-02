// Invariant test suite — the R1-R11 anti-hallucination obligations from
// docs/05-data-rules.md. Each invariant's tests land with the work package
// that builds the code it checks. State after WP5 (deterministic query layer):
// the QUERY-LAYER half of R1/R4/R5/R9/R10/R11 is real below, exercised against
// the fixture-ingested hermetic database (ADR 009). The ANSWER-SIDE halves —
// scanning rendered text, prompt hygiene, chart specs, audit records — remain
// named todos with their owning work package, so a green run never overstates
// what is proven.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runQuery } from '../../src/query/index.ts';
import type { ValidatedResult } from '../../src/query/index.ts';
import { DERIVED_DATA_MARKING } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

let db: Db;
let close: () => Promise<void>;
// Shared probes: one single-cell result, one series, one comparison, one
// explicit derivation of each registered kind — together they exercise every
// result shape the query layer can produce.
let single: ValidatedResult;
let series: ValidatedResult;
let comparison: ValidatedResult;
let difference: ValidatedResult;
let max: ValidatedResult;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
  const outcome = async (o: Promise<import('../../src/query/index.ts').QueryOutcome>) => {
    const result = await o;
    if (!result.ok) throw new Error(`probe query refused: ${result.refusal.message}`);
    return result;
  };
  single = await outcome(runQuery(db, {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'solar_electricity_production' },
    period: { kind: 'codes', codes: ['2024JJ00'] },
    derivation: 'none',
  }));
  series = await outcome(runQuery(db, {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
    period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
    derivation: 'series',
  }));
  comparison = await outcome(runQuery(db, {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'population_on_1_january' },
    regions: ['GM0363', 'GM0599'],
    period: { kind: 'codes', codes: ['2024JJ00'] },
    derivation: 'none',
  }));
  difference = await outcome(runQuery(db, {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'population_on_1_january' },
    regions: ['NL01'],
    period: { kind: 'codes', codes: ['2024JJ00', '2025JJ00'] },
    derivation: 'difference',
  }));
  max = await outcome(runQuery(db, {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'population_on_1_january' },
    regions: ['GM0363', 'GM0599', 'GM0518', 'GM0344'],
    period: { kind: 'codes', codes: ['2025JJ00'] },
    derivation: 'max',
  }));
}, 300_000);

afterAll(async () => {
  await close();
});

function allResults(): ValidatedResult[] {
  return [single, series, comparison, difference, max];
}

describe('anti-hallucination invariants — query-layer halves, real since WP5 (docs/05-data-rules.md)', () => {
  it('R1 (query half): every cell carries a unique, deterministic result id; every derivation links only to real source cells and its value recomputes from them', () => {
    for (const result of allResults()) {
      const ids = result.cells.map((c) => c.resultId);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[0-9A-Za-z]+:.+:.+:.+:.+$/);

      const valueById = new Map(result.cells.map((c) => [c.resultId, c.value]));
      for (const d of result.derivations) {
        expect(d.sourceResultIds.length).toBeGreaterThan(0);
        for (const src of d.sourceResultIds) expect(valueById.has(src)).toBe(true);
        if (d.kind === 'difference') {
          expect(d.value).toBe(
            (valueById.get(d.minuendResultId) as number) - (valueById.get(d.subtrahendResultId) as number),
          );
        }
        if (d.kind === 'max') {
          expect(d.value).toBe(Math.max(...d.sourceResultIds.map((id) => valueById.get(id) as number)));
          expect(d.value).toBe(valueById.get(d.winnerResultId));
        }
        if (d.kind === 'direction') {
          expect(d.netChange).toBeCloseTo(
            (valueById.get(d.lastResultId) as number) - (valueById.get(d.firstResultId) as number),
            10,
          );
        }
      }
    }
  });

  it('R4 (query half): every result carries table ID, title, our sync date, and covered period — non-droppable attribution', () => {
    for (const result of allResults()) {
      expect(result.attribution.tableId).toBeTruthy();
      expect(result.attribution.tableTitle).toBeTruthy();
      expect(new Date(result.attribution.syncedAt).getTime()).not.toBeNaN();
      expect(result.attribution.coveredPeriods.from).toBe(result.cells[0]!.periodCode);
      expect(result.attribution.coveredPeriods.to).toBe(result.cells[result.cells.length - 1]!.periodCode);
      expect(result.attribution.license).toBe('CC BY 4.0');
    }
  });

  it('R5 (query half): derivations exist only as registered kinds, marked as bewerking, listing their source cells', () => {
    const registeredKinds = new Set(['difference', 'max', 'direction', 'first_last']);
    let derivationsSeen = 0;
    for (const result of allResults()) {
      for (const d of result.derivations) {
        derivationsSeen++;
        expect(registeredKinds.has(d.kind)).toBe(true);
        expect(d.marking).toBe(DERIVED_DATA_MARKING);
        expect(d.sourceResultIds.length).toBeGreaterThan(0);
      }
    }
    expect(derivationsSeen).toBeGreaterThan(0);
    // The intent-requested computations are flagged explicit — the flag the
    // answer layer's visible derived-marking (WP7) keys on.
    expect(difference.derivations.find((d) => d.kind === 'difference')?.explicit).toBe(true);
    expect(max.derivations.find((d) => d.kind === 'max')?.explicit).toBe(true);
  });

  it('R9 (query half): every series result pre-registers direction + first/last; every comparison a ranking — so honest trend/ranking prose has something to bind to', () => {
    expect(series.derivations.map((d) => d.kind).sort()).toEqual(['direction', 'first_last']);
    const comparisonMax = comparison.derivations.find((d) => d.kind === 'max');
    expect(comparisonMax).toBeDefined();
    expect(comparisonMax!.explicit).toBe(false);
    // Cells carry their full labeled coordinates — the binding targets.
    for (const result of allResults()) {
      for (const cell of result.cells) {
        expect(cell.periodLabel).toBeTruthy();
        if (cell.regionCode !== null) expect(cell.regionLabel).toBeTruthy();
        expect(Object.keys(cell.dimLabels).sort()).toEqual(Object.keys(cell.dims).sort());
      }
    }
  });

  it('R10 (query half): every cell carries verbatim unit metadata and decimals; one unit per result', () => {
    for (const result of allResults()) {
      const units = new Set(result.cells.map((c) => c.unit));
      expect(units.size).toBe(1);
      for (const cell of result.cells) {
        expect(cell.unit.length).toBeGreaterThan(0);
        expect(Number.isInteger(cell.decimals)).toBe(true);
      }
      for (const d of result.derivations) expect(d.unit).toBe(result.cells[0]!.unit);
    }
  });

  it('R11 (query half): status is required on every cell; non-Definitief sets the provisional flag (solar 2024 is NaderVoorlopig in the fixtures)', () => {
    for (const result of allResults()) {
      for (const cell of result.cells) {
        expect(cell.status.length).toBeGreaterThan(0);
        expect(cell.provisional).toBe(cell.status !== 'Definitief');
      }
    }
    expect(single.cells[0]!.status).toBe('NaderVoorlopig');
    expect(single.cells[0]!.provisional).toBe(true);
  });

  it('R11 (query half): a null value is served only with its CBS reason, never as a bare gap', async () => {
    const outcome = await runQuery(db, {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'population_on_1_january' },
      regions: ['GM0002'], // Aduard, dissolved — CBS publishes Impossible cells
      period: { kind: 'codes', codes: ['2024JJ00'] },
      derivation: 'none',
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.cells[0]!.value).toBeNull();
    expect(outcome.cells[0]!.valueAttribute).not.toBe('None');
  });
});

describe('anti-hallucination invariants — answer-side obligations (real tests land with their work package)', () => {
  it.todo('R1 (WP7): every numeric token in a rendered answer traces to a result ID or registered derivation in the audit record');
  it.todo('R2 (WP7): the answer-phrasing prompt serializes only ValidatedResult[] + attribution metadata, nothing else');
  it.todo('R3 (WP7): numbers in LLM output match result objects verbatim; Dutch number/scale words rejected unless derivation-backed; fail-closed to template');
  it.todo('R4 (WP7): every rendered answer displays table ID(s), title, last-sync date, covered period');
  it.todo('R5 (WP7): the visible derived-marking renders whenever the answer schema contains a derivation record');
  it.todo('R6 (WP8): chart specs built deterministically from validated results; renderer cannot compute or omit');
  // R7 (WP6, real since 2026-07-03): the threshold rules are unit-proven in
  // tests/answer/intent-policy.test.ts and the labelled ambiguous-question
  // set regresses over recorded model output in tests/answer/intent-parse
  // .test.ts (B15/B16 among them). The core rule is re-asserted here so the
  // invariant suite itself keeps teeth on R7:
  it('R7 (WP6): ambiguity or low confidence exits to clarification, never a best guess', async () => {
    const { decide, DEFAULT_PARSER_CONFIG } = await import('../../src/answer/intent/index.ts');
    const context = {
      question: 'invariant probe',
      raw: { version: 1 as const, kind: 'data_query' as const, candidates: [], unmatchedMeasureTerm: null, nearestCanonicalKeys: [], note: null },
      model: 'probe',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    const reading = (key: string, confidence: number) => ({
      intent: { schemaVersion: 1 as const, target: { kind: 'canonical' as const, key }, period: { kind: 'codes' as const, codes: ['2024JJ00'] }, derivation: 'none' as const },
      confidence,
      reading: key,
      impliedRecency: false,
    });
    // Low-confidence single reading → clarify.
    expect(decide(context, [reading('cpi_yearly_inflation', 0.3)], DEFAULT_PARSER_CONFIG).kind).toBe('clarification');
    // Two materially different plausible readings → clarify.
    expect(
      decide(context, [reading('cpi_yearly_inflation', 0.8), reading('average_existing_home_sale_price', 0.5)], DEFAULT_PARSER_CONFIG).kind,
    ).toBe('clarification');
    // One confident reading → answer.
    expect(decide(context, [reading('cpi_yearly_inflation', 0.95)], DEFAULT_PARSER_CONFIG).kind).toBe('intent');
  });
  it.todo('R8 (WP10): audit record (incl. final answer text + chart spec) written and reconstructable before the answer is shown');
  it.todo('R9 (WP7): prose values semantically bound to their coordinates; direction/comparison words match the pre-registered derivations; correct-prose fixtures must pass');
  it.todo('R10 (WP7): the unit displayed next to each number matches the result cell\'s unit metadata (factor-1000 and %-vs-procentpunt guards)');
  it.todo('R11 (WP7): provisional (voorlopig) figures visibly marked; null-with-reason cells state their CBS reason in the answer');
});

describe('doc consistency (keeps this scaffold honest)', () => {
  const dataRules = readFileSync(new URL('../../docs/05-data-rules.md', import.meta.url), 'utf8');

  it('docs/05-data-rules.md still defines all eleven invariants R1..R11', () => {
    for (let i = 1; i <= 11; i++) {
      expect(dataRules, `invariant R${i} missing from docs`).toMatch(new RegExp(`\\*\\*R${i}\\*\\*`));
    }
  });

  it('the obligations above cover every invariant the doc defines (no R12 slipped in unnoticed)', () => {
    expect(dataRules).not.toMatch(/\*\*R12\*\*/);
  });
});
