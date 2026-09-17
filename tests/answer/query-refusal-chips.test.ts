// Session 110 UX audit pass 3, rows 13 + 15
// (docs/session-briefs/2026-09-17-session-110-ux-audit-pass3.md), ADR 054
// addendum + ADR 029 #134(c) note.
//
// Row 13: "several regions AND several periods in one question" (ADR 011's
// one-varying-axis rule) was served as the GENERIC `internal` refusal, which
// PAGES THE OWNER (src/answer/audit/alerts.ts) for what is an honest,
// structural scope limit — the same class of bug D6's
// region_scope_on_national_measure fixed. This gives it its own subReason
// ('multi_region_multi_period') and honest wording, routed exactly like D6.
//
// Row 15: BOTH the D6 refusal's own "Ik kan je wel het landelijke cijfer
// geven" offer and row 13's new "one region over the period" fallback are
// turned into ONE takeable chip each, via the SAME #134(c) mechanism the
// forecast/causal refusal chips use (tests/answer/refusal-offer-chip.test.ts)
// — a servability-gated `BuiltRefusal.offerChip` candidate, dry-run through
// `buildOfferChip` (rescue.ts), riding the same chip-carrier `pending` shape.
//
// What is pinned here:
//  1. Both refusals' TEXT/classification: honest wording, NOT the internal
//     bucket, no owner alert, no digits, never ends in '?'.
//  2. Each carries exactly one takeable chip when the candidate dry-runs as
//     servable — byte-identical envelope (no `pending` key, empty
//     `suggestions`) when the flag is off, when there is no candidate to
//     build (a region CLASS ask names no single region for row 13), or when
//     the candidate does not resolve.
//  3. Taking either chip answers deterministically (zero LLM calls) through
//     the ordinary reply path, a REAL new validated result.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { respondToIntent, respondToClarificationReply } from '../../src/answer/respond/index.ts';
import { periodCodeToNl } from '../../src/answer/respond/period-nl.ts';
// Row 5 (session 110 UX audit pass 4, #269): the pure re-labelling step
// itself, unit-tested DB-free below (respond.ts is the only real caller).
import { relabelMultiRegionMultiPeriodOfferChip } from '../../src/answer/respond/refusals.ts';
import type { StructuredIntent } from '../../src/query/index.ts';
import type { ParseOutcome } from '../../src/answer/intent/types.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

const REFERENCE_DATE = '2026-09-17';

/** Fails the test if the phrasing/parse model is ever reached — every case
 * here must resolve deterministically (a hand-built intent skips the parser
 * entirely, and a click-take must never re-parse). */
class UnreachableLlmClient implements LlmClient {
  async complete(): Promise<LlmResponse> {
    throw new Error('this path must never reach an LLM');
  }
}

function stubIntent(question: string, intent: StructuredIntent): Extract<ParseOutcome, { kind: 'intent' }> {
  return {
    kind: 'intent',
    question,
    raw: {
      version: 3,
      kind: 'data_query',
      candidates: [],
      unmatchedMeasureTerm: null,
      nearestCanonicalKeys: [],
      note: null,
    },
    model: 'stub',
    usage: { inputTokens: 0, outputTokens: 0 },
    intent,
    confidence: 0.97,
    impliedRecency: false,
    ranked: [],
  };
}

async function respond(question: string, intent: StructuredIntent, clickOptionsEnabled?: boolean) {
  return respondToIntent(db, question, stubIntent(question, intent), {
    answerClient: new UnreachableLlmClient(),
    referenceDate: REFERENCE_DATE,
    ...(clickOptionsEnabled === undefined ? {} : { clickOptionsEnabled }),
  });
}

const NATIONAL_MEASURE_INTENT: StructuredIntent = {
  schemaVersion: 1,
  target: { kind: 'canonical', key: 'unemployment_rate_seasonally_adjusted' },
  period: { kind: 'codes', codes: ['2024KW04'] },
  derivation: 'none',
  regionSet: { kind: 'all_provincies' },
};

/** ADR 055 re-point: a 2-named-region range is no longer a refusal at all —
 * it is the `region_series` answer this feature exists to give. The row-13
 * refusal (and its chip) now lives on what is still OUTSIDE that shape, and
 * the case with the SAME shape of chip is the over-the-cap one: more named
 * regions than REGION_SERIES_MAX_REGIONS allows, which still names a first
 * region to fall back to. These are the 12 provincie codes of 03759ned, in
 * roster order (the same source tests/query/region-series-resolve.test.ts
 * uses); PV20 has a value at every year of the asked range, so the chip's
 * take-path answers with a real 5-period series. */
const OVER_CAP_REGIONS = ['PV20', 'PV21', 'PV22', 'PV23', 'PV24', 'PV25', 'PV26'];

function multiPeriodRegionsIntent(regions: string[]): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'population_on_1_january' },
    regions,
    period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
    derivation: 'none',
  };
}

describe('row 15 — region_scope_on_national_measure offer chip', () => {
  it('carries exactly one takeable chip: the same measure, national, at the asked period', async () => {
    const response = await respond('wat is de werkloosheid per provincie', NATIONAL_MEASURE_INTENT, true);
    if (response.kind !== 'refusal') throw new Error(`expected a refusal, got ${response.kind}`);
    expect(response.reason).toBe('region_scope_on_national_measure');
    expect(response.reason).not.toBe('internal');
    expect(response.internalNote).toBeNull();

    expect(response.suggestions).toHaveLength(1);
    expect(response.suggestions[0]).toBe(`Wat was de werkloosheid in ${periodCodeToNl('2024KW04')}?`);
    const clickOptions = response.pending?.clickOptions ?? [];
    expect(clickOptions).toHaveLength(1);
    expect(clickOptions[0]!.label).toBe(response.suggestions[0]);
    expect(clickOptions[0]!.intent.target).toEqual({ kind: 'canonical', key: 'unemployment_rate_seasonally_adjusted' });
    expect(clickOptions[0]!.intent.period).toEqual({ kind: 'codes', codes: ['2024KW04'] });
    expect(clickOptions[0]!.intent.regions).toBeUndefined();
    expect(clickOptions[0]!.intent.regionSet).toBeUndefined();
    expect(clickOptions[0]!.intent.derivation).toBe('none');
    expect(clickOptions[0]!.impliedRecency).toBe(false);
    expect(response.pending?.rescueOnly).toBe(true);
  });

  it('taking the chip answers WITHOUT an LLM call, the national figure at the asked period', async () => {
    const refusal = await respond('wat is de werkloosheid per provincie', NATIONAL_MEASURE_INTENT, true);
    if (refusal.kind !== 'refusal' || !refusal.pending) throw new Error('expected an offer-chip pending');
    const taken = await respondToClarificationReply(db, refusal.pending, refusal.suggestions[0]!, {
      intentClient: new UnreachableLlmClient(),
      answerClient: new UnreachableLlmClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
    });
    expect(taken.kind).toBe('answer');
    if (taken.kind !== 'answer') throw new Error('unreachable');
    expect(taken.result.cells).toHaveLength(1);
    expect(taken.result.cells[0]!.periodCode).toBe('2024KW04');
    expect(taken.result.intent.regions ?? []).toHaveLength(0);
    expect(taken.answer.source).toBe('template');
  });

  it('flag off: no chip, no pending key, byte-identical text', async () => {
    const flagOff = await respond('wat is de werkloosheid per provincie', NATIONAL_MEASURE_INTENT, false);
    const flagOn = await respond('wat is de werkloosheid per provincie', NATIONAL_MEASURE_INTENT, true);
    if (flagOff.kind !== 'refusal' || flagOn.kind !== 'refusal') throw new Error('unreachable');
    expect(flagOff.suggestions).toEqual([]);
    expect(Object.hasOwn(flagOff, 'pending')).toBe(false);
    expect(flagOn.text).toBe(flagOff.text);
    expect(flagOn.reason).toBe(flagOff.reason);
    expect(flagOn.offer).toBe(flagOff.offer);
  });
});

describe('row 13 — multi_region_multi_period refusal and its offer chip', () => {
  it('refuses honestly, not as an internal fault', async () => {
    const response = await respond(
      'hoe ontwikkelde de bevolking van zeven provincies zich van 2020 tot 2024',
      multiPeriodRegionsIntent(OVER_CAP_REGIONS),
    );
    if (response.kind !== 'refusal') throw new Error(`expected a refusal, got ${response.kind}`);
    expect(response.reason).toBe('multi_region_multi_period');
    expect(response.reason).not.toBe('internal');
    expect(response.internalNote).toBeNull();
    expect(response.text).not.toMatch(/\d/);
    expect(response.text.trim().endsWith('?')).toBe(false);
  });

  it('carries exactly one takeable chip: the FIRST named region, the full period range, as a trend, the region named by its REGISTRY LABEL (row 5, session 110 pass 4, #269) — never the bare CBS code', async () => {
    const response = await respond(
      'hoe ontwikkelde de bevolking van zeven provincies zich van 2020 tot 2024',
      multiPeriodRegionsIntent(OVER_CAP_REGIONS),
      true,
    );
    if (response.kind !== 'refusal') throw new Error(`expected a refusal, got ${response.kind}`);
    expect(response.suggestions).toHaveLength(1);
    // PV20's registry label is 'Groningen (PV)' (tests/fixtures/cbs/03759ned/
    // codes-RegioS.json); baseLabel strips the '(PV)' qualifier, same as the
    // #138 retry chip already does for buildRefusalSuggestions.
    expect(response.suggestions[0]).toMatch(/^Hoe ontwikkelde .+ in Groningen zich van .+ tot en met .+\?$/);
    expect(response.suggestions[0]).not.toContain('PV20');
    const clickOptions = response.pending?.clickOptions ?? [];
    expect(clickOptions).toHaveLength(1);
    expect(clickOptions[0]!.intent.target).toEqual({ kind: 'canonical', key: 'population_on_1_january' });
    // The TAKEABLE intent still carries the real CBS code — only the
    // DISPLAY label changed; the query layer needs the code, never the name.
    expect(clickOptions[0]!.intent.regions).toEqual(['PV20']);
    expect(clickOptions[0]!.intent.period).toEqual({ kind: 'range', from: '2020JJ00', to: '2024JJ00' });
    expect(clickOptions[0]!.intent.derivation).toBe('series');
    expect(clickOptions[0]!.impliedRecency).toBe(false);
  });

  it('taking the chip answers WITHOUT an LLM call, a real series over the first region alone', async () => {
    const refusal = await respond(
      'hoe ontwikkelde de bevolking van zeven provincies zich van 2020 tot 2024',
      multiPeriodRegionsIntent(OVER_CAP_REGIONS),
      true,
    );
    if (refusal.kind !== 'refusal' || !refusal.pending) throw new Error('expected an offer-chip pending');
    const taken = await respondToClarificationReply(db, refusal.pending, refusal.suggestions[0]!, {
      intentClient: new UnreachableLlmClient(),
      answerClient: new UnreachableLlmClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
    });
    expect(taken.kind).toBe('answer');
    if (taken.kind !== 'answer') throw new Error('unreachable');
    expect(taken.result.intent.regions).toEqual(['PV20']);
    expect(taken.result.cells.map((c) => c.periodCode)).toEqual([
      '2020JJ00',
      '2021JJ00',
      '2022JJ00',
      '2023JJ00',
      '2024JJ00',
    ]);
  });

  it('a region CLASS ask (regionSet, no explicit region) gets no chip — there is no single region to fall back to', async () => {
    const intent: StructuredIntent = {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'population_on_1_january' },
      regionSet: { kind: 'all_provincies' },
      period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
      derivation: 'none',
    };
    const response = await respond('hoe ontwikkelden alle provincies zich van 2020 tot 2024', intent, true);
    if (response.kind !== 'refusal') throw new Error(`expected a refusal, got ${response.kind}`);
    expect(response.reason).toBe('multi_region_multi_period');
    expect(response.suggestions).toEqual([]);
    expect(response.pending).toBeUndefined();
  });

  it('an unservable first-named region gets no chip — byte-identical envelope', async () => {
    // Still the over-the-cap refusal (8 named regions), so the chip CANDIDATE
    // is built and then dry-run — which is the gate under test here. Without
    // the cap the whole ask would now be answered, and an unknown region code
    // would refuse on the region axis instead, never reaching this gate.
    const response = await respond(
      'hoe ontwikkelde de bevolking van een onbekende regio en zeven provincies zich van 2020 tot 2024',
      multiPeriodRegionsIntent(['GM9999', ...OVER_CAP_REGIONS]),
      true,
    );
    if (response.kind !== 'refusal') throw new Error(`expected a refusal, got ${response.kind}`);
    expect(response.reason).toBe('multi_region_multi_period');
    expect(response.suggestions).toEqual([]);
    expect(response.pending).toBeUndefined();
  });

  it('flag off: no chip, no pending key, byte-identical text', async () => {
    const flagOff = await respond(
      'hoe ontwikkelde de bevolking van zeven provincies zich van 2020 tot 2024',
      multiPeriodRegionsIntent(OVER_CAP_REGIONS),
      false,
    );
    const flagOn = await respond(
      'hoe ontwikkelde de bevolking van zeven provincies zich van 2020 tot 2024',
      multiPeriodRegionsIntent(OVER_CAP_REGIONS),
      true,
    );
    if (flagOff.kind !== 'refusal' || flagOn.kind !== 'refusal') throw new Error('unreachable');
    expect(flagOff.suggestions).toEqual([]);
    expect(Object.hasOwn(flagOff, 'pending')).toBe(false);
    expect(flagOn.text).toBe(flagOff.text);
    expect(flagOn.reason).toBe(flagOff.reason);
    expect(flagOn.offer).toBe(flagOff.offer);
  });
});

// Row 5 (session 110 UX audit pass 4, #269): `relabelMultiRegionMultiPeriodOfferChip`
// (refusals.ts) is the pure function respond.ts calls once it has resolved a
// registry LABEL via `regionTermsFor` (context/build.ts) — unit-tested here
// DB-free, since the DB-aware wiring itself is already covered by the
// 'the region named by its REGISTRY LABEL' case above.
describe('relabelMultiRegionMultiPeriodOfferChip (row 5, #269) — pure re-labelling step', () => {
  const baseCandidate = {
    intent: {
      schemaVersion: 1 as const,
      target: { kind: 'canonical' as const, key: 'population_on_1_january' },
      regions: ['PV20'],
      period: { kind: 'range' as const, from: '2020JJ00', to: '2024JJ00' },
      derivation: 'series' as const,
    },
    label: 'Hoe ontwikkelde bevolking op 1 januari in PV20 zich van 2020 tot en met 2024?',
  };

  it('swaps the bare code for the resolved label, keeping the rest of the sentence and the intent untouched', () => {
    const relabelled = relabelMultiRegionMultiPeriodOfferChip(baseCandidate, 'Groningen');
    expect(relabelled.label).toBe(
      'Hoe ontwikkelde bevolking op 1 januari in Groningen zich van 2020 tot en met 2024?',
    );
    expect(relabelled.label).not.toContain('PV20');
    expect(relabelled.intent).toBe(baseCandidate.intent);
  });

  it('falls back to the candidate UNCHANGED when the intent no longer has the range-period/canonical-target shape this chip requires', () => {
    const codesCandidate = {
      intent: { ...baseCandidate.intent, period: { kind: 'codes' as const, codes: ['2020JJ00'] } },
      label: baseCandidate.label,
    };
    expect(relabelMultiRegionMultiPeriodOfferChip(codesCandidate, 'Groningen')).toBe(codesCandidate);
  });
});
