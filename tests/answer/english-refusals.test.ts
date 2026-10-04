// ADR 058 phase 2 (#332), Task 2: coverage tests for the English sibling
// (`BuiltRefusal.en`) every refusal/clarification builder now produces
// alongside its Dutch text. Mirrors tests/answer/respond-refusals.test.ts's
// fixture helpers (baseRaw/parseRefusal/dummyIntent/queryRefusal) so both
// suites construct the SAME shapes — deliberately duplicated rather than
// imported, since neither file exports its stub builders.
//
// Three invariants proven here, per the design doc and the task brief:
//  1. Every RefusalReason's builder produces an `en` sibling with the
//     expected English content (exact strings for the reasons the brief
//     names explicitly; structural checks for the rest).
//  2. `en.text` never introduces a digit the Dutch `text` does not already
//     carry (principle c: no unbacked number, in either language).
//  3. `en.text` never leaks an untranslated Dutch function word (outside
//     `untranslated` fragments — none of the builders below populate that
//     list, so the check is unconditional for all of them).
// The Dutch `text`/`offer`/`guidance` values themselves are NOT re-asserted
// here — tests/answer/respond-refusals.test.ts already pins those, and this
// task's invariant is that they stay byte-identical (proven by that suite
// staying green, not by duplicating its expectations).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import {
  buildNoEurostatTableRefusal,
  buildNoSourcesRefusal,
  buildParseRefusal,
  buildQueryRefusal,
  buildStillAmbiguousRefusal,
  buildWebOnlyRefusal,
  META_TEMPLATES,
} from '../../src/answer/respond/index.ts';
import type { BuiltRefusal } from '../../src/answer/respond/index.ts';
import {
  buildOnboardingRefusal,
  ONBOARDING_PENDING_TEXT,
  ONBOARDING_PENDING_TEXT_EUROSTAT,
  ONBOARDING_PENDING_TEXT_EUROSTAT_EN,
  ONBOARDING_ALREADY_PENDING_TEXT_EUROSTAT,
  ONBOARDING_ALREADY_PENDING_TEXT_EUROSTAT_EN,
  INTERNAL_REFUSAL_TEXT_EN,
  ONBOARDING_ALREADY_PENDING_TEXT_EN,
  ONBOARDING_PENDING_TEXT_EN,
  toInternalRefusal,
} from '../../src/answer/respond/refusals.ts';
import { loadedTopicsCompactEn, periodCodeToEn } from '../../src/answer/respond/english.ts';
import type { ParseOutcome } from '../../src/answer/intent/types.ts';
import { REFUSAL_KIND_BY_QUESTION_KIND } from '../../src/answer/intent/parse.ts';
import { freshestForCanonical } from '../../src/query/index.ts';
import type { QueryRefusal, RefusalKind, StructuredIntent } from '../../src/query/index.ts';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

// ---------------------------------------------------------------------------
// Stub builders — mirrors tests/answer/respond-refusals.test.ts exactly.
// ---------------------------------------------------------------------------

function baseRaw(overrides: Partial<ParseOutcome['raw']> = {}): ParseOutcome['raw'] {
  return {
    version: 4,
    kind: 'data_query',
    candidates: [],
    unmatchedMeasureTerm: null,
    nearestCanonicalKeys: [],
    note: null,
    ...overrides,
  };
}

function parseRefusal(
  refusalKind: (typeof REFUSAL_KIND_BY_QUESTION_KIND)[keyof typeof REFUSAL_KIND_BY_QUESTION_KIND],
  rawOverrides: Partial<ParseOutcome['raw']> = {},
  question = 'test question',
): Extract<ParseOutcome, { kind: 'refusal' }> {
  return {
    kind: 'refusal',
    question,
    raw: baseRaw({ kind: 'out_of_scope', ...rawOverrides }),
    model: 'stub',
    usage: { inputTokens: 0, outputTokens: 0 },
    refusalKind,
    note: null,
  };
}

const dummyIntent: StructuredIntent = {
  schemaVersion: 1,
  target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
  period: { kind: 'codes', codes: ['2024JJ00'] },
  derivation: 'none',
};

const explicitIntent: StructuredIntent = {
  schemaVersion: 1,
  target: { kind: 'explicit', tableId: '00000XYZ', measure: 'M000000' },
  period: { kind: 'codes', codes: ['2024JJ00'] },
  derivation: 'none',
};

function queryRefusal(
  kind: RefusalKind,
  overrides: Partial<QueryRefusal['refusal']> = {},
  intent: StructuredIntent = dummyIntent,
): QueryRefusal {
  return {
    ok: false,
    refusal: { kind, message: `stub message for ${kind}`, ...overrides },
    intent,
  };
}

// ---------------------------------------------------------------------------
// Structural belt — every collected BuiltRefusal is swept for both
// invariants (digit parity, Dutch-tell absence).
// ---------------------------------------------------------------------------

const DUTCH_TELLS = [' het ', ' een ', ' niet ', ' voor ', ' cijfers '];

function digitRuns(text: string): string[] {
  return [...text.matchAll(/\d+/g)].map((m) => m[0]);
}

function assertDigitParity(built: BuiltRefusal, label: string): void {
  const dutchRuns = new Set(digitRuns(built.text));
  for (const run of digitRuns(built.en.text)) {
    expect(
      dutchRuns.has(run),
      `${label}: English text has digit '${run}' not present in the Dutch text — Dutch: ${JSON.stringify(built.text)}, English: ${JSON.stringify(built.en.text)}`,
    ).toBe(true);
  }
}

function assertNoDutchTells(built: BuiltRefusal, label: string): void {
  let scanned = built.en.text;
  // Strip any verbatim-kept Dutch fragments before scanning (none of the
  // builders below populate `untranslated`, so this is currently a no-op —
  // kept so a future builder that DOES populate it is handled correctly).
  for (const fragment of built.en.untranslated) {
    scanned = scanned.split(fragment).join('');
  }
  for (const tell of DUTCH_TELLS) {
    expect(
      scanned.includes(tell),
      `${label}: English text contains Dutch tell '${tell}': ${JSON.stringify(built.en.text)}`,
    ).toBe(false);
  }
}

function assertEnglishSibling(built: BuiltRefusal, label: string): void {
  expect(built.en.text.length, `${label}: en.text must not be empty`).toBeGreaterThan(0);
  expect(built.en.text, `${label}: en.text must differ from the Dutch text`).not.toBe(built.text);
  assertDigitParity(built, label);
  assertNoDutchTells(built, label);
}

// ---------------------------------------------------------------------------
// Exact-text expectations for the reasons the task brief names explicitly.
// ---------------------------------------------------------------------------

describe('English refusal siblings — exact text for the reasons the brief names', () => {
  it('forecast: exact English body, no offer when nearestCanonicalKeys is empty', async () => {
    const built = await buildParseRefusal(db, parseRefusal('forecast', { nearestCanonicalKeys: [] }));
    expect(built.en.offer).toBeNull();
    expect(built.en.text).toBe(
      "CBS and Eurostat publish realized figures, not forecasts — I can't give a future figure.",
    );
    assertEnglishSibling(built, 'forecast (no offer)');
  });

  it('causal: exact English body, and the no-topic offer names the English topic list', async () => {
    const built = await buildParseRefusal(db, parseRefusal('causal', { nearestCanonicalKeys: [] }));
    const expectedOffer = 'I found no CBS or Eurostat table on this.';
    expect(built.en.offer).toBe(expectedOffer);
    expect(built.en.text).toBe(
      "I can't assess a causal relationship — the figures from CBS and Eurostat describe what was measured, not why it happened. " +
        expectedOffer,
    );
    assertEnglishSibling(built, 'causal (no offer)');
  });

  it('compound: exact English body + guidance', async () => {
    const built = await buildParseRefusal(db, parseRefusal('compound'));
    expect(built.en.text).toBe(
      "That's two (or more) questions at once — I answer one at a time. " +
        "Ask them one after another, and I'll take them one by one.",
    );
    assertEnglishSibling(built, 'compound');
  });

  it('freshness: exact English body + offer (no differs branch)', () => {
    const outcome = buildQueryRefusal(
      queryRefusal('freshness', {
        freshness: {
          freshestAvailable: { periodCode: '2026MM03', status: 'Voorlopig' },
          freshestDefinitief: null,
        },
      }),
    );
    if (outcome.kind !== 'refusal') throw new Error('unreachable');
    const built = outcome.refusal;
    expect(built.en.text).toBe(
      "I don't yet have figures on inflation (year-on-year change in the consumer price index, all spending categories) " +
        'that recent — the most recent period I have a figure for is March 2026 (provisional figure). ' +
        'I can give the figure for March 2026 (provisional figure) directly, feel free to ask for it.',
    );
    assertEnglishSibling(built, 'freshness');
  });

  it('freshness: differs branch names the definitive period in English too, with matching digits', () => {
    const outcome = buildQueryRefusal(
      queryRefusal('freshness', {
        freshness: {
          freshestAvailable: { periodCode: '2026MM03', status: 'Voorlopig' },
          freshestDefinitief: { periodCode: '2026MM01' },
        },
      }),
    );
    if (outcome.kind !== 'refusal') throw new Error('unreachable');
    const built = outcome.refusal;
    expect(built.en.offer).toContain('January 2026');
    expect(built.en.offer).toContain("CBS status 'definitive'");
    expect(built.en.offer).toContain('may still be revised later by CBS');
    assertEnglishSibling(built, 'freshness (differs)');
  });

  it('a Eurostat table names Eurostat, never CBS, in not_published / outside_loaded_slice / quarantined (session 153)', () => {
    const eu: StructuredIntent = { ...explicitIntent, target: { kind: 'explicit', tableId: 'eurostat:une_rt_q', measure: 'une_rt_q|PC_ACT' } };
    const sibling: StructuredIntent = { ...dummyIntent, target: { kind: 'canonical', key: 'eu_unemployment_rate_harmonised' } };
    for (const intent of [eu, sibling]) {
      for (const kind of ['not_published', 'outside_loaded_slice', 'table_quarantined'] as const) {
        const outcome = buildQueryRefusal(queryRefusal(kind, {}, intent));
        if (outcome.kind !== 'refusal') throw new Error(kind);
        expect(outcome.refusal.text, kind).toContain('Eurostat');
        expect(outcome.refusal.text, kind).not.toContain('CBS');
        expect(outcome.refusal.en.text, kind).toContain('Eurostat');
      }
    }
    // A CBS target is unchanged.
    const cbs = buildQueryRefusal(queryRefusal('not_published'));
    if (cbs.kind !== 'refusal') throw new Error('cbs');
    expect(cbs.refusal.text).toMatch(/^CBS heeft/);
  });

  it('not_published: exact English body naming the measure', () => {
    const outcome = buildQueryRefusal(queryRefusal('not_published'));
    if (outcome.kind !== 'refusal') throw new Error('unreachable');
    const built = outcome.refusal;
    expect(built.en.text).toBe(
      'CBS has not (yet) published a figure for this period for inflation (year-on-year change in the consumer price index, all spending categories).',
    );
    assertEnglishSibling(built, 'not_published');
  });

  it('not_published: falls back to the no-label sentence for an explicit (non-canonical) target', () => {
    const outcome = buildQueryRefusal(queryRefusal('not_published', {}, explicitIntent));
    if (outcome.kind !== 'refusal') throw new Error('unreachable');
    expect(outcome.refusal.en.text).toBe('CBS has not (yet) published a figure for this period.');
  });

  // M6 fix (2026-09-27 review): a CANONICAL target whose key has no static
  // CANONICAL_MEASURES entry (an onboarded/unknown key) must take the SAME
  // no-label fallback branch as the explicit-target case above — before the
  // fix, `englishMeasureLabel`'s own "these figures" fallback made this
  // return non-null, producing "CBS has not (yet) published a figure for
  // this period for these figures." instead of the plain sentence the Dutch
  // side (`definitionLabel` also null here) actually takes.
  it('not_published: falls back to the no-label sentence for an onboarded/unknown canonical key too', () => {
    const onboardedIntent: StructuredIntent = {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'onboarded:some_freshly_onboarded_measure' },
      period: { kind: 'codes', codes: ['2024JJ00'] },
      derivation: 'none',
    };
    const outcome = buildQueryRefusal(queryRefusal('not_published', {}, onboardedIntent));
    if (outcome.kind !== 'refusal') throw new Error('unreachable');
    expect(outcome.refusal.text).toBe('CBS heeft (nog) geen cijfer over deze periode gepubliceerd.');
    expect(outcome.refusal.en.text).toBe('CBS has not (yet) published a figure for this period.');
    expect(outcome.refusal.en.text).not.toContain('these figures');
  });

  it('outside_loaded_slice: exact English body + offer naming the nearest period', () => {
    const outcome = buildQueryRefusal(
      queryRefusal('outside_loaded_slice', { nearestAlternative: '2019JJ00' }),
    );
    if (outcome.kind !== 'refusal') throw new Error('unreachable');
    const built = outcome.refusal;
    expect(built.en.text).toBe(
      'CBS does publish figures on inflation (year-on-year change in the consumer price index, all spending categories), ' +
        'but the requested part lies outside what we have loaded. I can show figures from 2019 onwards.',
    );
    assertEnglishSibling(built, 'outside_loaded_slice');
  });

  it('quarantined: exact English body', () => {
    const outcome = buildQueryRefusal(queryRefusal('table_quarantined'));
    if (outcome.kind !== 'refusal') throw new Error('unreachable');
    expect(outcome.refusal.en.text).toBe(
      "This table is temporarily unavailable because we're re-checking the data (a quality check after a possible change at CBS).",
    );
    assertEnglishSibling(outcome.refusal, 'quarantined');
  });

  it('region_scope_on_national_measure: exact English body + offer + guidance', () => {
    const outcome = buildQueryRefusal(
      queryRefusal('invalid_intent', { subReason: 'region_scope_on_national_measure' }),
    );
    if (outcome.kind !== 'refusal') throw new Error('unreachable');
    const built = outcome.refusal;
    expect(built.en.text).toBe(
      'CBS publishes the figures on inflation (year-on-year change in the consumer price index, all spending categories) ' +
        'only nationally, for the Netherlands as a whole: this table has no breakdown by municipality, province or region. ' +
        'I can give you the national figure instead. ' +
        'A comparison between regions needs a topic that CBS does publish per region.',
    );
    assertEnglishSibling(built, 'region_scope_on_national_measure');
  });

  it('internal (invalid_intent, generic): exact English body', () => {
    const outcome = buildQueryRefusal(queryRefusal('invalid_intent'));
    if (outcome.kind !== 'refusal') throw new Error('unreachable');
    expect(outcome.refusal.en.text).toBe(
      "I couldn't turn this question into a valid query on our data. I'd rather give no answer than an unreliable one.",
    );
    assertEnglishSibling(outcome.refusal, 'internal (invalid_intent)');
  });

  it('internal: every internal RefusalKind gets its own distinct English wording', () => {
    const internalKinds: RefusalKind[] = [
      'table_not_registered',
      'no_data',
      'derivation_failed',
      'internal_inconsistency',
      'not_fetched',
    ];
    const texts = internalKinds.map((kind) => {
      const outcome = buildQueryRefusal(queryRefusal(kind));
      if (outcome.kind !== 'refusal') throw new Error('unreachable');
      assertEnglishSibling(outcome.refusal, `internal (${kind})`);
      return outcome.refusal.en.text;
    });
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('meta (sources template): English body + example question track the Dutch structure exactly', async () => {
    const template = META_TEMPLATES.find((t) => t.key === 'sources')!;
    const built = await buildParseRefusal(db, parseRefusal('smalltalk', {}, template.examples[0]!));
    expect(built.reason).toBe('meta');
    const freshest = await freshestForCanonical(db, 'cpi_yearly_inflation');
    const periodPhrase = freshest ? ` in ${periodCodeToEn(freshest.periodCode)}` : '';
    const expectedOffer = `For example, ask: "What was inflation${periodPhrase}?"`;
    const expectedBody =
      'My figures come from the official tables of CBS (the Netherlands) and Eurostat (Europe). ' +
      'We load those tables into our own database in advance, and every answer states which table the figure ' +
      'comes from and when we last synchronized that table with the source.';
    expect(built.en.offer).toBe(expectedOffer);
    expect(built.en.text).toBe(`${expectedBody} ${expectedOffer}`);
    assertEnglishSibling(built, 'meta (sources)');
  });
});

// ---------------------------------------------------------------------------
// Every remaining builder — structural belt only (digit parity + Dutch-tell
// absence), sweeping every RefusalReason not already exact-pinned above.
// ---------------------------------------------------------------------------

describe('English refusal siblings — structural belt over every remaining builder', () => {
  it('forecast/causal WITH a resolved offer stay digit-parity-clean and Dutch-tell-free', async () => {
    const forecast = await buildParseRefusal(
      db,
      parseRefusal('forecast', { nearestCanonicalKeys: ['cpi_yearly_inflation'] }),
    );
    assertEnglishSibling(forecast, 'forecast (with offer)');
    const causal = await buildParseRefusal(
      db,
      parseRefusal('causal', { nearestCanonicalKeys: ['bankruptcies_businesses'] }),
    );
    assertEnglishSibling(causal, 'causal (with offer)');
  });

  it('out_of_scope', async () => {
    const built = await buildParseRefusal(db, parseRefusal('out_of_scope'));
    expect(built.en.text).toMatch(/^I found no CBS or Eurostat table that answers this question/);
    expect(built.en.offer).toMatch(/^For example, ask: "What was /);
    assertEnglishSibling(built, 'out_of_scope');
  });

  it('smalltalk (generic, no meta match)', async () => {
    const built = await buildParseRefusal(db, parseRefusal('smalltalk'));
    expect(built.reason).toBe('smalltalk');
    assertEnglishSibling(built, 'smalltalk');
  });

  it('every meta template gets a matching, distinct English body', async () => {
    const seen = new Set<string>();
    for (const template of META_TEMPLATES) {
      const built = await buildParseRefusal(db, parseRefusal('smalltalk', {}, template.examples[0]!));
      expect(built.reason, template.key).toBe('meta');
      assertEnglishSibling(built, `meta (${template.key})`);
      expect(seen.has(built.en.text), `template ${template.key} body duplicates an earlier one`).toBe(false);
      seen.add(built.en.text);
    }
  });

  it('onboarding_pending / onboarding_already_pending: byte-exact English constants, no envelope key change', () => {
    const envelope = { tableId: '82610NED', topicTerm: 'zonnestroom', confidence: 0.91, candidateIds: ['82610NED'] };
    const pending = buildOnboardingRefusal(envelope, false);
    expect(pending.en.text).toBe(ONBOARDING_PENDING_TEXT_EN);
    expect(pending.en.offer).toBeNull();
    expect(pending.en.guidance).toBeNull();
    const already = buildOnboardingRefusal(envelope, true);
    expect(already.en.text).toBe(ONBOARDING_ALREADY_PENDING_TEXT_EN);
    // Neither onboarding text is wrapped in assertNotAQuestion (by design,
    // same as the Dutch originals) — no additional shape assertion needed
    // beyond the byte-exact checks above.
  });

  it('onboarding texts follow the picked table: a Eurostat pick names Eurostat, a CBS pick keeps the verbatim copy (session 154)', () => {
    const cbs = buildOnboardingRefusal({ tableId: '82610NED', topicTerm: 'x', confidence: 0.9, candidateIds: ['82610NED'] }, false);
    expect(cbs.text).toBe(ONBOARDING_PENDING_TEXT);
    const eu = { tableId: 'eurostat:tran_sf_roadus', topicTerm: 'x', confidence: 0.9, candidateIds: ['eurostat:tran_sf_roadus'] };
    const pending = buildOnboardingRefusal(eu, false);
    expect(pending.text).toBe(ONBOARDING_PENDING_TEXT_EUROSTAT);
    expect(pending.text).toContain('Eurostat');
    expect(pending.text).not.toContain('CBS');
    expect(pending.en.text).toBe(ONBOARDING_PENDING_TEXT_EUROSTAT_EN);
    const already = buildOnboardingRefusal(eu, true);
    expect(already.text).toBe(ONBOARDING_ALREADY_PENDING_TEXT_EUROSTAT);
    expect(already.en.text).toBe(ONBOARDING_ALREADY_PENDING_TEXT_EUROSTAT_EN);
  });

  it('outside_loaded_slice with no nearestAlternative: no offer', () => {
    const outcome = buildQueryRefusal(queryRefusal('outside_loaded_slice'));
    if (outcome.kind !== 'refusal') throw new Error('unreachable');
    expect(outcome.refusal.en.offer).toBeNull();
    assertEnglishSibling(outcome.refusal, 'outside_loaded_slice (no nearest)');
  });

  it('evicted', () => {
    const outcome = buildQueryRefusal(queryRefusal('table_evicted'));
    if (outcome.kind !== 'refusal') throw new Error('unreachable');
    expect(outcome.refusal.en.text).toMatch(/cleaned up/);
    expect(outcome.refusal.en.text).toMatch(/not gone at CBS/);
    assertEnglishSibling(outcome.refusal, 'evicted');
  });

  it('multi_region_multi_period: names the same cap word as the Dutch text', () => {
    const outcome = buildQueryRefusal(
      queryRefusal('invalid_intent', { subReason: 'multi_region_multi_period' }),
    );
    if (outcome.kind !== 'refusal') throw new Error('unreachable');
    expect(outcome.refusal.en.text).toMatch(/up to six explicitly named regions/);
    assertEnglishSibling(outcome.refusal, 'multi_region_multi_period');
  });

  it('needs_clarification: English question + option labels alongside the Dutch ones, envelope untouched', () => {
    const outcome = buildQueryRefusal(
      queryRefusal('needs_clarification', { axes: ['region', 'period'] }),
    );
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.questionEn).toBe('Could you specify for which region and period?');
    expect(outcome.optionsEn).toEqual([
      'the Netherlands as a whole (national figure)',
      'a specific municipality or province — name it',
    ]);
    // Dutch fields stay exactly what respond-refusals.test.ts already pins.
    expect(outcome.questionNl).toContain('voor welke regio en periode');
    expect(outcome.options[0]).toMatch(/Nederland/);
  });

  it('needs_clarification on a non-region axis: no options in either language', () => {
    const outcome = buildQueryRefusal(queryRefusal('needs_clarification', { axes: ['period'] }));
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.options).toEqual([]);
    expect(outcome.optionsEn).toEqual([]);
  });

  it('still_ambiguous', async () => {
    const built = await buildStillAmbiguousRefusal(db, ['region', 'period']);
    expect(built.en.guidance).toMatch(/^Try asking your question again in one sentence/);
    const questionMarksEn = (built.en.text.match(/\?/g) ?? []).length;
    expect(questionMarksEn).toBe(1);
    assertEnglishSibling(built, 'still_ambiguous');
  });

  it('no_sources', () => {
    const built = buildNoSourcesRefusal();
    expect(built.en.text).toBe('No sources selected — select at least one source to get an answer.');
    assertEnglishSibling(built, 'no_sources');
  });

  it('web_only', () => {
    const built = buildWebOnlyRefusal();
    expect(built.en.text).toMatch(/^You've turned off the official data sources for this question/);
    assertEnglishSibling(built, 'web_only');
  });

  it('no_eurostat_table', () => {
    const built = buildNoEurostatTableRefusal();
    expect(built.en.text).toBe(
      'I found no Eurostat table that answers this question. Switch CBS on as well if you want to use Dutch figures.',
    );
    assertEnglishSibling(built, 'no_eurostat_table');
  });

  it('toInternalRefusal: the exported INTERNAL_REFUSAL_TEXT_EN constant is produced next to the Dutch text, not wired into the envelope', () => {
    expect(INTERNAL_REFUSAL_TEXT_EN).toBe(
      "I can't reliably answer this question right now. I'd rather give no answer than an unreliable one.",
    );
    const dutchDigits = new Set(digitRuns(INTERNAL_REFUSAL_TEXT_EN));
    expect(dutchDigits.size).toBe(0);
    // Envelope invariant (Task 5's job, not this task's): toInternalRefusal's
    // RefusalResponse carries no 'english'/'en' key yet — the Dutch envelope
    // stays exactly the shape tests/audit's reconstruct fixtures already pin.
    const response = toInternalRefusal('q', 'note');
    expect(Object.keys(response)).not.toContain('english');
    expect(Object.keys(response)).not.toContain('en');
    expect(response.text).toBe(
      'Ik kan deze vraag nu niet betrouwbaar beantwoorden. Ik geef liever geen antwoord dan een onbetrouwbaar antwoord.',
    );
  });
});
