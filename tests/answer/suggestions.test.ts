// WP29 (#73, ADR 029): follow-up suggestion chips — hermetic, zero LLM.
//
// The generator tests drive buildSuggestions against the REAL ingested
// fixture db with the REAL echoServability dry-run (the strongest form of
// the D2 pin: what these tests accept is literally what production serves),
// plus stub-check unit tests for the R7 drop rule, the cap, priority order
// and fail-open. The envelope test replays B3 end-to-end and pins the
// R8-audited `text` byte-for-byte (modulo the injected sync date — the one
// legitimately run-dependent token) while `suggestions` ride alongside.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReplayLlmClient } from '../../src/answer/llm/client.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import type { ServabilityCheck } from '../../src/answer/intent/policy.ts';
import { respondToIntent, respondToQuestion } from '../../src/answer/respond/index.ts';
import {
  buildRefusalSuggestions,
  buildSuggestions,
  MAX_SUGGESTIONS,
  type RegionLabeler,
} from '../../src/answer/respond/suggestions.ts';
import { regionTermsFor } from '../../src/answer/context/build.ts';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';
import type { CanonicalMeasure } from '../../src/registry/types.ts';
import { echoServability, runQuery, INTENT_SCHEMA_VERSION } from '../../src/query/index.ts';
import type { QueryRefusal, RefusalKind, StructuredIntent, ValidatedResult } from '../../src/query/index.ts';
import type { ParseOutcome } from '../../src/answer/intent/types.ts';
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

/** #138 confinement pin for the region-less cases: the labeler must never be
 * consulted when the intent carries no regions — a throw here that still
 * yielded a chip would mean the fail-open swallowed a wrong consult. */
const neverLabels: RegionLabeler = async () => {
  throw new Error('labelRegions must not be consulted for a region-less intent');
};

/** The real labeler — the production wiring respond.ts constructs (#138):
 * registry/dimension_labels via regionTermsFor, never a cell. */
function realLabels(): RegionLabeler {
  return (key, codes) => regionTermsFor(db, key, codes);
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

// ---------------------------------------------------------------------------
// #134(a) (ADR 029, refusal-side variant): buildRefusalSuggestions — ONE
// servability-gated retry chip on a period-coverage refusal. Same harness as
// above: hand-built QueryRefusal fed to the generator, real fixture db + real
// dry-run for the positive cases (what these accept is what production serves),
// stub checks for the gate/fail-open, and a respondToIntent wiring test proving
// the chip rides the refusal envelope while the R8-audited text stays clean.
// ---------------------------------------------------------------------------

/** The CPI slice in the fixture db is 2010..2025 (probed): asking > 2025 →
 * freshness (freshestAvailable 2025); < 2010 → not_published, and since #134(b)
 * that too-OLD not_published carries the earliest-served floor (2010) as a chip
 * boundary too (run.ts sets nearestAlternative); the outside_loaded_slice PERIOD
 * refusal is exercised via a hand-built QueryRefusal whose boundary (2010) is
 * genuinely loaded, so the real dry-run serves it. */
const CPI = 'cpi_yearly_inflation';
const CPI_LABEL = 'inflatie (jaarmutatie CPI, alle bestedingen)';

function cpiIntent(regions?: string[]): StructuredIntent {
  return {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: { kind: 'canonical', key: CPI },
    ...(regions && regions.length > 0 ? { regions } : {}),
    period: { kind: 'codes', codes: ['2027JJ00'] },
    derivation: 'none',
  };
}

function refusalOf(
  kind: RefusalKind,
  overrides: Partial<QueryRefusal['refusal']> = {},
  intent: StructuredIntent = cpiIntent(),
): QueryRefusal {
  return {
    ok: false,
    refusal: { kind, message: `stub ${kind}`, ...overrides },
    intent,
  };
}

class ThrowingAnswerClient implements LlmClient {
  calls = 0;
  async complete(): Promise<LlmResponse> {
    this.calls += 1;
    throw new Error('composeAnswer must not run on a refusal turn');
  }
}

describe('buildRefusalSuggestions — the period-coverage retry chip (real db + real dry-run)', () => {
  it('freshness: offers the freshest-available period as a one-click retry', async () => {
    const refusal = refusalOf('freshness', {
      axis: 'period',
      freshness: { freshestAvailable: { periodCode: '2025JJ00', status: 'Definitief' }, freshestDefinitief: null },
      nearestAlternative: '2025JJ00',
    });
    expect(await buildRefusalSuggestions(refusal, realCheck(), neverLabels)).toEqual([
      `Wat was ${CPI_LABEL} in 2025?`,
    ]);
  });

  it('outside_loaded_slice (period axis): offers the loaded-slice floor', async () => {
    const refusal = refusalOf('outside_loaded_slice', { axis: 'period', nearestAlternative: '2010JJ00' });
    expect(await buildRefusalSuggestions(refusal, realCheck(), neverLabels)).toEqual([
      `Wat was ${CPI_LABEL} in 2010?`,
    ]);
  });

  it('chip copy carries no digit but the period year — never a data value (principle a/c belt)', async () => {
    const refusal = refusalOf('freshness', {
      axis: 'period',
      freshness: { freshestAvailable: { periodCode: '2025JJ00', status: 'Definitief' }, freshestDefinitief: null },
    });
    const chips = await buildRefusalSuggestions(refusal, realCheck(), neverLabels);
    expect(chips).toHaveLength(1);
    for (const token of chips[0]!.match(/\d+(?:[.,]\d+)?/g) ?? []) {
      expect(/^\d{4}$/.test(token), `token '${token}'`).toBe(true);
    }
  });
});

/** A CPI intent whose ASK was a period RANGE — the #137 range-chip input. The
 * fixture CPI slice is 2010..2025 (probed): [2010,2024] serves; 2050 is above
 * the ceiling; anything < 2010 is unloaded. */
function cpiRangeIntent(from: string, to: string): StructuredIntent {
  return {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: { kind: 'canonical', key: CPI },
    period: { kind: 'range', from, to },
    derivation: 'series',
  };
}

describe('buildRefusalSuggestions — #137 range-ask retry chip (real db + real dry-run)', () => {
  it('outside_loaded_slice from a RANGE partly below the floor: offers the WORKING sub-range as a trend chip', async () => {
    // Ask 2001–2024, floor 2010 → the clamped window [2010,2024] serves gap-free.
    const refusal = refusalOf(
      'outside_loaded_slice',
      { axis: 'period', nearestAlternative: '2010JJ00' },
      cpiRangeIntent('2001JJ00', '2024JJ00'),
    );
    expect(await buildRefusalSuggestions(refusal, realCheck(), neverLabels)).toEqual([
      `Hoe ontwikkelde ${CPI_LABEL} zich van 2010 tot en met 2024?`,
    ]);
  });

  it('range whose upper bound is ABOVE the loaded ceiling falls back to the single floor chip (the dry-run refuses the window)', async () => {
    // Ask 2001–2050; [2010,2050] is not gap-free (2050 unloaded) → single-period.
    const refusal = refusalOf(
      'outside_loaded_slice',
      { axis: 'period', nearestAlternative: '2010JJ00' },
      cpiRangeIntent('2001JJ00', '2050JJ00'),
    );
    expect(await buildRefusalSuggestions(refusal, realCheck(), neverLabels)).toEqual([
      `Wat was ${CPI_LABEL} in 2010?`,
    ]);
  });

  it('a whole-range-below-floor (backwards clamp) falls back to the single floor chip', async () => {
    // Ask 2001–2005, both below the 2010 floor → [2010,2005] runs backwards, the
    // dry-run refuses it → the single floor chip, never a broken "van 2010 tot 2005".
    const refusal = refusalOf(
      'outside_loaded_slice',
      { axis: 'period', nearestAlternative: '2010JJ00' },
      cpiRangeIntent('2001JJ00', '2005JJ00'),
    );
    expect(await buildRefusalSuggestions(refusal, realCheck(), neverLabels)).toEqual([
      `Wat was ${CPI_LABEL} in 2010?`,
    ]);
  });

  it('the range variant is outside_loaded_slice-only: a freshness refusal with a range ask still gives the single-period chip', async () => {
    const refusal = refusalOf(
      'freshness',
      {
        axis: 'period',
        freshness: { freshestAvailable: { periodCode: '2025JJ00', status: 'Definitief' }, freshestDefinitief: null },
      },
      cpiRangeIntent('2001JJ00', '2030JJ00'),
    );
    expect(await buildRefusalSuggestions(refusal, realCheck(), neverLabels)).toEqual([
      `Wat was ${CPI_LABEL} in 2025?`,
    ]);
  });

  it('degenerate floor===to is skipped (no "van X tot en met X"): the single-period chip is offered', async () => {
    const refusal = refusalOf(
      'outside_loaded_slice',
      { axis: 'period', nearestAlternative: '2024JJ00' },
      cpiRangeIntent('2001JJ00', '2024JJ00'),
    );
    expect(await buildRefusalSuggestions(refusal, realCheck(), neverLabels)).toEqual([
      `Wat was ${CPI_LABEL} in 2024?`,
    ]);
  });

  it('the range attempt is throw-isolated: a THROW in the range dry-run still yields the single-period chip, never [] (adversarial-review pin)', async () => {
    // The real dry-run REFUSES a malformed range rather than throwing, so this
    // stub forces the range branch to throw to prove its inner try/catch keeps
    // the single-period fallback (a mutant merging it into the outer catch would
    // return [] here). The single-period candidate is 'codes'-kind → SERVABLE.
    const check: ServabilityCheck = async (intent) => {
      if (intent.period.kind === 'range') throw new Error('range dry-run exploded');
      return SERVABLE;
    };
    const refusal = refusalOf(
      'outside_loaded_slice',
      { axis: 'period', nearestAlternative: '2010JJ00' },
      cpiRangeIntent('2001JJ00', '2024JJ00'),
    );
    expect(await buildRefusalSuggestions(refusal, check, neverLabels)).toEqual([`Wat was ${CPI_LABEL} in 2010?`]);
  });
});

describe('buildRefusalSuggestions — #134(b) too-old not_published chip (real db + real dry-run)', () => {
  it('a too-old SINGLE-period not_published: offers the earliest-served floor', async () => {
    // The owner's "inflatie 2001" shape asked as one year: run.ts set the 2010
    // floor as nearestAlternative; the real dry-run serves 2010.
    const refusal = refusalOf('not_published', { axis: 'period', nearestAlternative: '2010JJ00' });
    expect(await buildRefusalSuggestions(refusal, realCheck(), neverLabels)).toEqual([
      `Wat was ${CPI_LABEL} in 2010?`,
    ]);
  });

  it('a too-old RANGE not_published (the owner\'s literal "inflatie 2001–2024"): offers the WORKING sub-range as a trend chip', async () => {
    const refusal = refusalOf(
      'not_published',
      { axis: 'period', nearestAlternative: '2010JJ00' },
      cpiRangeIntent('2001JJ00', '2024JJ00'),
    );
    expect(await buildRefusalSuggestions(refusal, realCheck(), neverLabels)).toEqual([
      `Hoe ontwikkelde ${CPI_LABEL} zich van 2010 tot en met 2024?`,
    ]);
  });

  it('a too-old range whose upper bound is above the loaded ceiling falls back to the single floor chip', async () => {
    // Ask 2001–2050; [2010,2050] is not gap-free (2050 unloaded) → single-period,
    // exactly like the #137 outside_loaded_slice sibling (shared code path).
    const refusal = refusalOf(
      'not_published',
      { axis: 'period', nearestAlternative: '2010JJ00' },
      cpiRangeIntent('2001JJ00', '2050JJ00'),
    );
    expect(await buildRefusalSuggestions(refusal, realCheck(), neverLabels)).toEqual([
      `Wat was ${CPI_LABEL} in 2010?`,
    ]);
  });
});

// #138: the regional retry chip — real db + real dry-run + the REAL labeler
// (regionTermsFor over dimension_labels), exactly the production wiring. The
// fixture's 83625NED is a true GeoDimension table (745 RegioS codes) with
// GM0363 loaded 2015–2025, so the positive cases prove REGIONAL servability,
// not just national.
// ---------------------------------------------------------------------------

const HOUSE = 'average_home_sale_price_by_gemeente';
const HOUSE_LABEL =
  'gemiddelde verkoopprijs van bestaande koopwoningen, per gemeente/provincie (jaarcijfer)';

function houseIntent(
  regions: string[],
  period: StructuredIntent['period'] = { kind: 'codes', codes: ['2030JJ00'] },
  derivation: StructuredIntent['derivation'] = 'none',
): StructuredIntent {
  return {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: { kind: 'canonical', key: HOUSE },
    regions,
    period,
    derivation,
  };
}

describe('buildRefusalSuggestions — #138 regional retry chip (real db + real dry-run + real labeler)', () => {
  it('freshness on a region ask: offers the boundary WITH the registry-labelled region', async () => {
    const refusal = refusalOf(
      'freshness',
      {
        axis: 'period',
        freshness: { freshestAvailable: { periodCode: '2025JJ00', status: 'Definitief' }, freshestDefinitief: null },
      },
      houseIntent(['GM0363']),
    );
    expect(await buildRefusalSuggestions(refusal, realCheck(), realLabels())).toEqual([
      `Wat was ${HOUSE_LABEL} in Amsterdam in 2025?`,
    ]);
  });

  it('a RANGE ask partly below the floor keeps the region in the trend chip (the #137 shape, regional)', async () => {
    // Fixture slice floor for 83625NED is 2015; ask 2001–2024 for Amsterdam →
    // the clamped regional window [2015,2024] serves gap-free.
    const refusal = refusalOf(
      'outside_loaded_slice',
      { axis: 'period', nearestAlternative: '2015JJ00' },
      houseIntent(['GM0363'], { kind: 'range', from: '2001JJ00', to: '2024JJ00' }, 'series'),
    );
    expect(await buildRefusalSuggestions(refusal, realCheck(), realLabels())).toEqual([
      `Hoe ontwikkelde ${HOUSE_LABEL} in Amsterdam zich van 2015 tot en met 2024?`,
    ]);
  });

  it('an unlabelable region code fails CLOSED: no chip at all (drop-never-guess)', async () => {
    const refusal = refusalOf(
      'freshness',
      {
        axis: 'period',
        freshness: { freshestAvailable: { periodCode: '2025JJ00', status: 'Definitief' }, freshestDefinitief: null },
      },
      houseIntent(['GM9999']),
    );
    expect(await buildRefusalSuggestions(refusal, realCheck(), realLabels())).toEqual([]);
  });

  it('the dry-run proves the REGIONAL cells, not just the national ones (the candidate carries the region codes)', async () => {
    // A check that refuses any region-carrying candidate: if the generator
    // dropped the regions from its candidate (the national-proof mutant), the
    // stub would accept and a chip would wrongly surface.
    const regionBlindCheck: ServabilityCheck = async (intent) =>
      (intent.regions ?? []).length > 0 ? NOT_SERVABLE : SERVABLE;
    const refusal = refusalOf(
      'freshness',
      {
        axis: 'period',
        freshness: { freshestAvailable: { periodCode: '2025JJ00', status: 'Definitief' }, freshestDefinitief: null },
      },
      houseIntent(['GM0363']),
    );
    expect(await buildRefusalSuggestions(refusal, regionBlindCheck, realLabels())).toEqual([]);
  });

  it('a throwing labeler is fail-open: [] — never an exception on the refusal path', async () => {
    const refusal = refusalOf(
      'freshness',
      {
        axis: 'period',
        freshness: { freshestAvailable: { periodCode: '2025JJ00', status: 'Definitief' }, freshestDefinitief: null },
      },
      houseIntent(['GM0363']),
    );
    const exploding: RegionLabeler = async () => {
      throw new Error('labeler exploded');
    };
    expect(await buildRefusalSuggestions(refusal, async () => SERVABLE, exploding)).toEqual([]);
  });

  it('chip copy carries no digit but the period year — the principle a/c belt holds with a region present', async () => {
    const refusal = refusalOf(
      'freshness',
      {
        axis: 'period',
        freshness: { freshestAvailable: { periodCode: '2025JJ00', status: 'Definitief' }, freshestDefinitief: null },
      },
      houseIntent(['GM0363']),
    );
    const chips = await buildRefusalSuggestions(refusal, realCheck(), realLabels());
    expect(chips).toHaveLength(1);
    for (const token of chips[0]!.match(/\d+(?:[.,]\d+)?/g) ?? []) {
      expect(/^\d{4}$/.test(token), `token '${token}'`).toBe(true);
    }
  });
});

describe('#138 confinement: suggestions.ts still never sees the database', () => {
  it('imports no db module and names no Db type — region labels arrive ONLY through the injected closure', () => {
    // The design's structural guarantee (mirrors the dry-run confinement): the
    // chip module can never read a cell because it can never reach the db. A
    // future edit that imports db/ or types a Db parameter fails here loudly.
    const src = readFileSync(
      fileURLToPath(new URL('../../src/answer/respond/suggestions.ts', import.meta.url)),
      'utf-8',
    );
    expect(src).not.toMatch(/from '[^']*\/db\//);
    expect(src).not.toMatch(/\bDb\b/);
  });
});

describe('buildRefusalSuggestions — the gates and fail-open (stub checks)', () => {
  it('the DIMENSION outside_loaded_slice (axis=measure) is NOT a period chip — even with an always-servable check', async () => {
    // resolve.ts:383 refuses a pinned dimension coordinate on axis 'measure';
    // its nearestAlternative is a coordinate, never a period. Must drop.
    const refusal = refusalOf('outside_loaded_slice', { axis: 'measure', nearestAlternative: 'A048710' });
    expect(await buildRefusalSuggestions(refusal, async () => SERVABLE, neverLabels)).toEqual([]);
  });

  it('a MID-GAP not_published (no nearestAlternative — a hole between served periods) stays prose-only: no chip', async () => {
    // #134(b): run.ts sets nearestAlternative ONLY for the too-old case; a
    // mid-gap not_published carries none, so even an always-servable check
    // yields no chip — there is no single honest "try this" target.
    const refusal = refusalOf('not_published', { axis: 'period' });
    expect(await buildRefusalSuggestions(refusal, async () => SERVABLE, neverLabels)).toEqual([]);
  });

  it('a too-old not_published on a NON-period axis never chips (defensive: the boundary is only a period on the period axis)', async () => {
    const refusal = refusalOf('not_published', { axis: 'measure', nearestAlternative: '2010JJ00' });
    expect(await buildRefusalSuggestions(refusal, async () => SERVABLE, neverLabels)).toEqual([]);
  });

  it('#138 fail-closed: a region ask on a NO-GEO table (CPI) yields no chip — the real labeler nulls (no GeoDimension), never a guessed referent', async () => {
    // Pre-#138 this was the blanket region-less-v1 bailout; the behavior for
    // THIS case is deliberately byte-identical, but now for the honest reason:
    // regionTermsFor finds no GeoDimension on 86141NED and fails closed.
    const refusal = refusalOf(
      'freshness',
      { axis: 'period', freshness: { freshestAvailable: { periodCode: '2025JJ00', status: 'Definitief' }, freshestDefinitief: null } },
      cpiIntent(['GM0363']),
    );
    expect(await buildRefusalSuggestions(refusal, async () => SERVABLE, realLabels())).toEqual([]);
  });

  it('a non-canonical (explicit) target yields no chip (no registry label to name)', async () => {
    const explicit: StructuredIntent = {
      schemaVersion: INTENT_SCHEMA_VERSION,
      target: { kind: 'explicit', tableId: '86141NED', measure: 'M000001' },
      period: { kind: 'codes', codes: ['2027JJ00'] },
      derivation: 'none',
    };
    const refusal = refusalOf('freshness', { axis: 'period', nearestAlternative: '2025JJ00' }, explicit);
    expect(await buildRefusalSuggestions(refusal, async () => SERVABLE, neverLabels)).toEqual([]);
  });

  it('R7 gate: a boundary the dry-run rejects never chips (a retry that would dead-end is not offered)', async () => {
    const refusal = refusalOf('freshness', {
      axis: 'period',
      freshness: { freshestAvailable: { periodCode: '2025JJ00', status: 'Definitief' }, freshestDefinitief: null },
    });
    expect(await buildRefusalSuggestions(refusal, async () => NOT_SERVABLE, neverLabels)).toEqual([]);
  });

  it('no computed boundary (freshness without a payload / outside_loaded_slice without nearestAlternative) → []', async () => {
    expect(await buildRefusalSuggestions(refusalOf('freshness', { axis: 'period' }), async () => SERVABLE, neverLabels)).toEqual([]);
    expect(await buildRefusalSuggestions(refusalOf('outside_loaded_slice', { axis: 'period' }), async () => SERVABLE, neverLabels)).toEqual([]);
  });

  it('fail-open: a throwing check yields [] — never an exception on the refusal path', async () => {
    const refusal = refusalOf('freshness', {
      axis: 'period',
      freshness: { freshestAvailable: { periodCode: '2025JJ00', status: 'Definitief' }, freshestDefinitief: null },
    });
    const check: ServabilityCheck = async () => {
      throw new Error('dry-run exploded');
    };
    expect(await buildRefusalSuggestions(refusal, check, neverLabels)).toEqual([]);
  });
});

describe('the refusal envelope: the retry chip rides alongside, text is byte-untouched (R8)', () => {
  function stubIntent(codes: string[]): Extract<ParseOutcome, { kind: 'intent' }> {
    return {
      kind: 'intent',
      question: 'stub',
      raw: { version: 3, kind: 'data_query', candidates: [], unmatchedMeasureTerm: null, nearestCanonicalKeys: [], note: null },
      model: 'stub',
      usage: { inputTokens: 0, outputTokens: 0 },
      intent: {
        schemaVersion: INTENT_SCHEMA_VERSION,
        target: { kind: 'canonical', key: CPI },
        period: { kind: 'codes', codes },
        derivation: 'none',
      },
      confidence: 0.97,
      impliedRecency: false,
      ranked: [],
    };
  }

  function stubRangeIntent(from: string, to: string): Extract<ParseOutcome, { kind: 'intent' }> {
    return {
      kind: 'intent',
      question: 'stub',
      raw: { version: 3, kind: 'data_query', candidates: [], unmatchedMeasureTerm: null, nearestCanonicalKeys: [], note: null },
      model: 'stub',
      usage: { inputTokens: 0, outputTokens: 0 },
      intent: {
        schemaVersion: INTENT_SCHEMA_VERSION,
        target: { kind: 'canonical', key: CPI },
        period: { kind: 'range', from, to },
        derivation: 'series',
      },
      confidence: 0.97,
      impliedRecency: false,
      ranked: [],
    };
  }

  it('CPI 2027 refuses (freshness) AND carries the 2025 retry chip — the real respondToIntent wiring, no LLM reached', async () => {
    const answerClient = new ThrowingAnswerClient();
    const response = await respondToIntent(db, 'Wat was de inflatie in 2027?', stubIntent(['2027JJ00']), {
      answerClient,
      referenceDate: '2026-08-15',
    });
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('freshness');
    expect(response.suggestions).toEqual([`Wat was ${CPI_LABEL} in 2025?`]);
    // R8: the audited text is the refusal prose, unchanged — the chip never
    // leaks into it (it rides the structural field only).
    expect(response.text.length).toBeGreaterThan(0);
    expect(response.text).not.toContain(`Wat was ${CPI_LABEL} in 2025?`);
    expect(answerClient.calls).toBe(0);
  });

  it('#138: verkoopprijs Amsterdam 2030 refuses AND carries the REGIONAL retry chip — the real respondToIntent wiring incl. the injected labeler', async () => {
    const stub: Extract<ParseOutcome, { kind: 'intent' }> = {
      kind: 'intent',
      question: 'stub',
      raw: { version: 3, kind: 'data_query', candidates: [], unmatchedMeasureTerm: null, nearestCanonicalKeys: [], note: null },
      model: 'stub',
      usage: { inputTokens: 0, outputTokens: 0 },
      intent: houseIntent(['GM0363']),
      confidence: 0.97,
      impliedRecency: false,
      ranked: [],
    };
    const response = await respondToIntent(db, 'Wat kostte een huis in Amsterdam in 2030?', stub, {
      answerClient: new ThrowingAnswerClient(),
      referenceDate: '2026-08-15',
    });
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.suggestions).toEqual([`Wat was ${HOUSE_LABEL} in Amsterdam in 2025?`]);
    // R8: the chip rides the structural field only, never the audited text.
    expect(response.text).not.toContain(`in Amsterdam in 2025?`);
  });

  it('CPI 1990 refuses (not_published, too old) AND carries the 2010 floor chip — #134(b), the real respondToIntent wiring end to end', async () => {
    // The whole point of #134(b): this exercises run.ts diagnoseMissing setting
    // nearestAlternative for the too-old case → suggestions.ts → the chip. If
    // run.ts left it unset this would be [] (the old, pre-#134(b) behavior).
    const response = await respondToIntent(db, 'Wat was de inflatie in 1990?', stubIntent(['1990JJ00']), {
      answerClient: new ThrowingAnswerClient(),
      referenceDate: '2026-08-15',
    });
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('not_published');
    expect(response.suggestions).toEqual([`Wat was ${CPI_LABEL} in 2010?`]);
    // R8: the audited text is the not_published prose, unchanged — the chip
    // rides the structural field only, never leaking into the reconstructed text.
    expect(response.text.length).toBeGreaterThan(0);
    expect(response.text).not.toContain(`Wat was ${CPI_LABEL} in 2010?`);
  });

  it('CPI 1990 asked as a RANGE (1990–2024) carries the clamped working-range trend chip — #134(b) range shape end to end', async () => {
    const response = await respondToIntent(db, 'Wat was de inflatie tussen 1990 en 2024?', stubRangeIntent('1990JJ00', '2024JJ00'), {
      answerClient: new ThrowingAnswerClient(),
      referenceDate: '2026-08-15',
    });
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('not_published');
    expect(response.suggestions).toEqual([`Hoe ontwikkelde ${CPI_LABEL} zich van 2010 tot en met 2024?`]);
    expect(response.text).not.toContain('2010 tot en met 2024');
  });
});
