// WP29 (#73, ADR 029): follow-up suggestion chips — hermetic, zero LLM.
//
// The generator tests drive buildSuggestions against the REAL ingested
// fixture db with the REAL echoServability dry-run (the strongest form of
// the D2 pin: what these tests accept is literally what production serves),
// plus stub-check unit tests for the R7 drop rule, the cap, priority order
// and fail-open. The envelope test replays B3 end-to-end and pins the
// R8-audited `text` byte-for-byte (modulo the injected sync date — the one
// legitimately run-dependent token) while `suggestions` ride alongside.
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReplayLlmClient } from '../../src/answer/llm/client.ts';
import type { ServabilityCheck } from '../../src/answer/intent/policy.ts';
import { respondToQuestion } from '../../src/answer/respond/index.ts';
import { buildSuggestions, MAX_SUGGESTIONS } from '../../src/answer/respond/suggestions.ts';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';
import type { CanonicalMeasure } from '../../src/registry/types.ts';
import { echoServability, runQuery, INTENT_SCHEMA_VERSION } from '../../src/query/index.ts';
import type { StructuredIntent, ValidatedResult } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

const INTENT_FIXTURES = fileURLToPath(new URL('../fixtures/llm/intent', import.meta.url));
const ANSWER_FIXTURES = fileURLToPath(new URL('../fixtures/llm/answer', import.meta.url));

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

/** The real dry-run — the production check respondToIntent constructs. */
function realCheck(): ServabilityCheck {
  return (intent) => echoServability(db, intent);
}

function intentOf(
  key: string,
  period: StructuredIntent['period'],
  regions?: string[],
  derivation: StructuredIntent['derivation'] = 'none',
): StructuredIntent {
  return {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: { kind: 'canonical', key },
    ...(regions && regions.length > 0 ? { regions } : {}),
    period,
    derivation,
  };
}

/** A real ValidatedResult for a hand-built intent — the same object the
 * respond layer holds when it calls buildSuggestions. */
async function answered(intent: StructuredIntent): Promise<ValidatedResult> {
  const outcome = await runQuery(db, intent);
  if (!outcome.ok) {
    throw new Error(`test fixture intent is not servable: ${JSON.stringify(intent)}`);
  }
  return outcome;
}

const SERVABLE = { servable: true } as const;
const NOT_SERVABLE = {
  servable: false,
  kind: 'no_data',
  axes: null,
  availability: { yearRange: null, freshest: null },
} as const;

describe('buildSuggestions — generators against the real fixture db + real dry-run', () => {
  it('sub-national single answer (population, Amsterdam 2024): adjacent-next, trend, and the national region chip — in priority order', async () => {
    const intent = intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0363']);
    const result = await answered(intent);
    const chips = await buildSuggestions(intent, result, realCheck());
    expect(chips).toEqual([
      'Wat was bevolking op 1 januari in Amsterdam in 2025?',
      'Hoe ontwikkelde bevolking op 1 januari in Amsterdam zich van 2020 tot en met 2024?',
      'Wat was bevolking op 1 januari in Nederland in 2024?',
    ]);
  });

  it('national answer at the LATEST loaded period (population, Nederland 2026): adjacent falls back to the PREVIOUS period; the region chip is the G4 comparison', async () => {
    const intent = intentOf('population_on_1_january', { kind: 'codes', codes: ['2026JJ00'] }, ['NL01']);
    const result = await answered(intent);
    const chips = await buildSuggestions(intent, result, realCheck());
    expect(chips).toEqual([
      'Wat was bevolking op 1 januari in Nederland in 2025?',
      'Hoe ontwikkelde bevolking op 1 januari in Nederland zich van 2022 tot en met 2026?',
      'Wat was bevolking op 1 januari in de gemeentes Amsterdam, Rotterdam, Den Haag en Utrecht in 2026?',
    ]);
  });

  it('national-only measure (CPI 2024) yields NO region chip — and no same-topic chip (each Phase-0 table has one canonical measure)', async () => {
    const intent = intentOf('cpi_yearly_inflation', { kind: 'codes', codes: ['2024JJ00'] });
    const result = await answered(intent);
    const chips = await buildSuggestions(intent, result, realCheck());
    expect(chips).toEqual([
      'Wat was inflatie (jaarmutatie CPI, alle bestedingen) in 2025?',
      'Hoe ontwikkelde inflatie (jaarmutatie CPI, alle bestedingen) zich van 2020 tot en met 2024?',
    ]);
    for (const chip of chips) expect(chip).not.toContain('Nederland');
  });

  it('a series answer does not get a trend chip (it would re-ask the answered question)', async () => {
    const intent = intentOf(
      'cpi_yearly_inflation',
      { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
      undefined,
      'series',
    );
    const result = await answered(intent);
    const chips = await buildSuggestions(intent, result, realCheck());
    expect(chips).toEqual(['Wat was inflatie (jaarmutatie CPI, alle bestedingen) in 2025?']);
  });

  it('chip copy carries no digits beyond period years — never a data value (principle a/c belt)', async () => {
    const intent = intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0363']);
    const result = await answered(intent);
    const chips = await buildSuggestions(intent, result, realCheck());
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      // Every numeric token must be a 4-digit year or the "1 januari" label
      // digit — nothing that could be a cell value.
      const tokens = chip.match(/\d+(?:[.,]\d+)?/g) ?? [];
      for (const token of tokens) {
        expect(token === '1' || /^\d{4}$/.test(token), `token '${token}' in chip '${chip}'`).toBe(true);
      }
    }
  });
});

describe('buildSuggestions — the R7 gate, cap, priority and fail-open (stub checks)', () => {
  let amsterdamIntent: StructuredIntent;
  let amsterdamResult: ValidatedResult;

  beforeAll(async () => {
    amsterdamIntent = intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0363']);
    amsterdamResult = await answered(amsterdamIntent);
  });

  it('R7 pin: when NO candidate is servable, NO chip surfaces (a chip that would dead-end never renders)', async () => {
    const check: ServabilityCheck = async () => NOT_SERVABLE;
    const chips = await buildSuggestions(amsterdamIntent, amsterdamResult, check);
    expect(chips).toEqual([]);
  });

  it('adjacent-period prefers NEXT and falls back to PREVIOUS exactly when the dry-run rejects next', async () => {
    const check: ServabilityCheck = async (intent) => {
      const codes = intent.period.kind === 'codes' ? intent.period.codes : [];
      return codes.includes('2025JJ00') ? NOT_SERVABLE : SERVABLE;
    };
    const chips = await buildSuggestions(amsterdamIntent, amsterdamResult, check);
    expect(chips[0]).toBe('Wat was bevolking op 1 januari in Amsterdam in 2023?');
  });

  it('cap: an always-servable check with all four generators firing yields exactly MAX_SUGGESTIONS chips, priority order, same-topic cut', async () => {
    const sibling: CanonicalMeasure = {
      key: 'population_average_test_only',
      tableId: '03759ned',
      measure: 'M000365',
      measureTitle: 'Gemiddelde bevolking',
      dims: {},
      definitionLabel: 'gemiddelde bevolking',
      everydayTerms: ['gemiddelde bevolking'],
    };
    const check: ServabilityCheck = async () => SERVABLE;
    const chips = await buildSuggestions(amsterdamIntent, amsterdamResult, check, [
      ...CANONICAL_MEASURES,
      sibling,
    ]);
    expect(chips).toHaveLength(MAX_SUGGESTIONS);
    expect(chips).toEqual([
      'Wat was bevolking op 1 januari in Amsterdam in 2025?',
      'Hoe ontwikkelde bevolking op 1 januari in Amsterdam zich van 2020 tot en met 2024?',
      'Wat was bevolking op 1 januari in Nederland in 2024?',
    ]);
    expect(chips.join(' ')).not.toContain('gemiddelde bevolking');
  });

  it('same-topic generator: a sibling measure on the SAME table surfaces with ITS everyday term when earlier candidates are unservable', async () => {
    const sibling: CanonicalMeasure = {
      key: 'population_average_test_only',
      tableId: '03759ned',
      measure: 'M000365',
      measureTitle: 'Gemiddelde bevolking',
      dims: {},
      definitionLabel: 'gemiddelde bevolking',
      everydayTerms: ['gemiddelde inwoners'],
    };
    const check: ServabilityCheck = async (intent) =>
      intent.target.kind === 'canonical' && intent.target.key === sibling.key
        ? SERVABLE
        : NOT_SERVABLE;
    const chips = await buildSuggestions(amsterdamIntent, amsterdamResult, check, [
      ...CANONICAL_MEASURES,
      sibling,
    ]);
    expect(chips).toEqual(['Hoeveel gemiddelde inwoners waren er in Amsterdam in 2024?']);
  });

  it('fail-open: a throwing check yields [] — never an exception, never a partial chip list', async () => {
    const check: ServabilityCheck = async () => {
      throw new Error('dry-run exploded');
    };
    const chips = await buildSuggestions(amsterdamIntent, amsterdamResult, check);
    expect(chips).toEqual([]);
  });
});

describe('the envelope: suggestions ride the response, text is byte-untouched (R8)', () => {
  it('B3 replayed end-to-end: kind answer, gated chips present, text re-assembles byte-identically around the injected sync date', async () => {
    const response = await respondToQuestion(db, 'Wat was de inflatie (CPI, jaargemiddelde) in 2024?', {
      intentClient: new ReplayLlmClient(INTENT_FIXTURES),
      answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
      referenceDate: '2026-08-15',
    });
    expect(response.kind).toBe('answer');
    if (response.kind !== 'answer') throw new Error('unreachable');

    // The golden envelope text, captured on the pre-WP29 tree (2026-07-11)
    // with the same fixtures and reference date. The sync date is the ONE
    // token that legitimately varies per ingest run; it is spliced from the
    // envelope's own STRUCTURAL attribution field — every other byte is the
    // frozen literal. Any suggestions-work leak into `text` fails here.
    const sync = response.result.attribution.syncedAt.slice(0, 10);
    expect(response.text).toBe(
      'De inflatie (jaarmutatie CPI, alle bestedingen) bedroeg in 2024 3,3%.\n\n' +
        'Definitie: inflatie (jaarmutatie CPI, alle bestedingen).\n' +
        `Bron: CBS StatLine, tabel 86141NED — Consumentenprijzen; CPI 2025=100, index en mutaties. ` +
        `Gegevens gesynchroniseerd op ${sync}. Periode: 2024. Licentie: CC BY 4.0.`,
    );

    // The chips ride the STRUCTURAL field (ADR 029 D4), each one dry-run
    // gated this request — the exact production wiring in respondToIntent.
    expect(response.suggestions).toEqual([
      'Wat was inflatie (jaarmutatie CPI, alle bestedingen) in 2025?',
      'Hoe ontwikkelde inflatie (jaarmutatie CPI, alle bestedingen) zich van 2020 tot en met 2024?',
    ]);
    // And none of them appears in the audited text.
    for (const chip of response.suggestions) {
      expect(response.text).not.toContain(chip);
    }
  });

  it('warn-and-serve STALE answers carry the same suggestions (adversarial-review pin, 2026-07-11: the stale branch shares the one assembly site — skipping chips there must fail loudly)', async () => {
    // Far-future reference date → staleness.stale with impliedRecency=false
    // (B3 names an absolute year): the docs/05 warn-and-serve branch. Same
    // clock trick as respond-pipeline.test.ts's staleness suite. A mutant
    // wrapping the buildSuggestions call in `if (!staleness.stale)` passed
    // every pre-pin test — this kills it.
    const response = await respondToQuestion(db, 'Wat was de inflatie (CPI, jaargemiddelde) in 2024?', {
      intentClient: new ReplayLlmClient(INTENT_FIXTURES),
      answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
      referenceDate: '2027-06-01',
    });
    expect(response.kind).toBe('answer');
    if (response.kind !== 'answer') throw new Error('unreachable');
    expect(response.stalenessWarning).not.toBeNull();
    // The dry-run gate is reference-date-independent (runQuery takes no
    // clock), so the stale answer offers exactly the fresh answer's chips.
    expect(response.suggestions).toEqual([
      'Wat was inflatie (jaarmutatie CPI, alle bestedingen) in 2025?',
      'Hoe ontwikkelde inflatie (jaarmutatie CPI, alle bestedingen) zich van 2020 tot en met 2024?',
    ]);
  });
});
