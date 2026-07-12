// WP9 refusal/clarification builder tests — exhaustive reason mapping for
// EVERY QueryRefusal kind and EVERY parse refusalKind (docs/05's
// failure-behaviour table), plus the structural no-numbers belt-check
// (principle c) over every built text.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import {
  buildNoSourcesRefusal,
  buildParseRefusal,
  buildQueryRefusal,
  buildStillAmbiguousRefusal,
  buildWebOnlyRefusal,
  matchMetaTemplate,
  META_TEMPLATES,
  respondToClarificationReply,
  respondToQuestion,
  RESPONSE_SCHEMA_VERSION,
} from '../../src/answer/respond/index.ts';
import type { BuiltRefusal, PendingClarification } from '../../src/answer/respond/index.ts';
import type { LlmClient } from '../../src/answer/llm/client.ts';
import type { ParseOutcome } from '../../src/answer/intent/types.ts';
import { REFUSAL_KIND_BY_QUESTION_KIND } from '../../src/answer/intent/parse.ts';
import { freshestForCanonical } from '../../src/query/index.ts';
import type { QueryRefusal, RefusalKind, StructuredIntent } from '../../src/query/index.ts';
import {
  findNumericTokens,
  normalizeForScan,
  numbersInText,
  periodCodeNumbers,
} from '../../src/answer/compose/format.ts';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

// ---------------------------------------------------------------------------
// Stub builders
// ---------------------------------------------------------------------------

function baseRaw(overrides: Partial<ParseOutcome['raw']> = {}): ParseOutcome['raw'] {
  return {
    version: 3,
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
  // 'test question' matches no meta pattern by design: the default keeps
  // every pre-WP18 assertion exercising the GENERIC smalltalk template.
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
// The no-numbers belt-check (principle c): every numeric token in a built
// text must be traceable to a structured source — periodCodeNumbers of
// period codes involved, or numbersInText of option/definition labels and
// sync dates. Never a raw cell value (these builders never see one).
// ---------------------------------------------------------------------------

function buildWhitelist(sources: {
  periodCodes?: string[];
  labels?: (string | null | undefined)[];
}): Set<number> {
  const numbers = new Set<number>();
  for (const code of sources.periodCodes ?? []) {
    for (const n of periodCodeNumbers(code)) numbers.add(n);
  }
  for (const label of sources.labels ?? []) {
    for (const n of numbersInText(label)) numbers.add(n);
  }
  return numbers;
}

function assertNoUnbackedNumbers(text: string, whitelist: Set<number>, context: string): void {
  const normalized = normalizeForScan(text);
  for (const token of findNumericTokens(normalized)) {
    expect(
      whitelist.has(token.value),
      `${context}: unbacked number '${token.token}' (${token.value}) in text: ${JSON.stringify(text)}`,
    ).toBe(true);
  }
}

/** Every canonical measure's definition label + all its everyday terms +
 * sync-date-shaped strings the builders might cite — the broad whitelist
 * used across the belt-check tests below (built ONLY from structured
 * registry/period sources, never a cell value). */
function fullLabelWhitelist(): Set<number> {
  const labels: string[] = [];
  for (const m of CANONICAL_MEASURES) {
    labels.push(m.definitionLabel, ...m.everydayTerms);
  }
  return buildWhitelist({ labels });
}

/** fullLabelWhitelist + every canonical measure's freshest-available period —
 * the structured source (freshestForCanonical) the forecast/causal offers and
 * the example questions cite. Still never a cell value: period + status only. */
async function fullLabelAndFreshestWhitelist(): Promise<Set<number>> {
  const whitelist = fullLabelWhitelist();
  for (const m of CANONICAL_MEASURES) {
    const freshest = await freshestForCanonical(db, m.key);
    if (freshest) {
      for (const n of periodCodeNumbers(freshest.periodCode)) whitelist.add(n);
    }
  }
  return whitelist;
}

// ---------------------------------------------------------------------------
// Parse refusals — every refusalKind
// ---------------------------------------------------------------------------

describe('buildParseRefusal — exhaustive over every ParseOutcome.refusalKind', () => {
  it('forecast: names CBS realized-vs-forecast, refuses without a number', async () => {
    const built = await buildParseRefusal(db, parseRefusal('forecast'));
    expect(built.reason).toBe('forecast');
    expect(built.text).not.toMatch(/\?\s*$/);
    expect(built.text).toContain('CBS publiceert gerealiseerde cijfers');
  });

  it('forecast: offers the realized statistic when nearestCanonicalKeys resolves', async () => {
    const built = await buildParseRefusal(
      db,
      parseRefusal('forecast', { nearestCanonicalKeys: ['cpi_yearly_inflation'] }),
    );
    expect(built.offer).not.toBeNull();
    expect(built.offer).toContain('inflatie (jaarmutatie CPI, alle bestedingen)');
  });

  it('forecast: no offer when nearestCanonicalKeys is empty', async () => {
    const built = await buildParseRefusal(db, parseRefusal('forecast', { nearestCanonicalKeys: [] }));
    expect(built.offer).toBeNull();
  });

  it('causal: refuses the interpretation explicitly', async () => {
    const built = await buildParseRefusal(db, parseRefusal('causal'));
    expect(built.reason).toBe('causal');
    expect(built.text).toMatch(/oorzakelijk/i);
    expect(built.text).not.toMatch(/\?\s*$/);
  });

  it('causal: offers descriptive stats only when nearestCanonicalKeys hits the registry', async () => {
    const withTopic = await buildParseRefusal(
      db,
      parseRefusal('causal', { nearestCanonicalKeys: ['bankruptcies_businesses'] }),
    );
    expect(withTopic.offer).toContain('faillissementen van bedrijven en instellingen');

    const withoutTopic = await buildParseRefusal(db, parseRefusal('causal', { nearestCanonicalKeys: [] }));
    expect(withoutTopic.offer).not.toBeNull();
    // Guidance naming loaded topics when nothing matched.
    expect(withoutTopic.offer).toMatch(/inwoners|bevolking/);
  });

  it('out_of_scope: names the scope limit compactly (first everyday term per canonical measure)', async () => {
    const built = await buildParseRefusal(db, parseRefusal('out_of_scope'));
    expect(built.reason).toBe('scope');
    for (const m of CANONICAL_MEASURES) {
      expect(built.text).toContain(m.everydayTerms[0]);
    }
  });

  it('out_of_scope: says explicitly the topic is not loaded, and offers a genuinely answerable example question', async () => {
    const built = await buildParseRefusal(db, parseRefusal('out_of_scope'));
    // "say so explicitly" (docs/02 B17): the refusal must negate the asked
    // topic, not only list what IS covered.
    expect(built.text).toMatch(/geen CBS-cijfers geladen/);
    expect(built.offer).not.toBeNull();
    // The example is a quoted question naming a loaded everyday term...
    expect(built.offer).toMatch(/Vraag bijvoorbeeld: "Wat was de .+\?"/);
    const namesALoadedTerm = CANONICAL_MEASURES.some((m) =>
      m.everydayTerms.some((t) => built.offer!.includes(t)),
    );
    expect(namesALoadedTerm).toBe(true);
    // ...INCLUDING a real period from the ingested data — regression pin for
    // the freshestForCanonical dims-merge bug (session review 2026-07-03:
    // querying with canonical dims alone, without the table's pinned default
    // coordinates, silently matched nothing and the example lost its period).
    expect(built.offer).toMatch(/ in .+\?"/);
  });

  it('compound: is a REFUSAL, not a clarification — no pending, phrased as a split', async () => {
    const built = await buildParseRefusal(db, parseRefusal('compound'));
    expect(built.reason).toBe('compound');
    expect(built.text).toMatch(/één vraag tegelijk|per keer/i);
    expect(built.guidance).not.toBeNull();
  });

  it('smalltalk: short product explanation + example question, no data claim', async () => {
    const built = await buildParseRefusal(db, parseRefusal('smalltalk'));
    expect(built.reason).toBe('smalltalk');
    expect(built.offer).toMatch(/Vraag bijvoorbeeld/);
  });

  it('every refusalKind maps to a distinct RefusalReason value', async () => {
    const kinds = Object.values(REFUSAL_KIND_BY_QUESTION_KIND);
    const reasons = await Promise.all(kinds.map((k) => buildParseRefusal(db, parseRefusal(k))));
    expect(reasons.map((r) => r.reason).sort()).toEqual(
      ['forecast', 'causal', 'scope', 'compound', 'smalltalk'].sort(),
    );
  });

  it('no-numbers belt-check: every built parse-refusal text is fully whitelisted', async () => {
    const whitelist = await fullLabelAndFreshestWhitelist();
    const kinds = Object.values(REFUSAL_KIND_BY_QUESTION_KIND);
    for (const kind of kinds) {
      const built = await buildParseRefusal(
        db,
        parseRefusal(kind, { nearestCanonicalKeys: ['cpi_yearly_inflation', 'bankruptcies_businesses'] }),
      );
      assertNoUnbackedNumbers(built.text, whitelist, `parse refusal ${kind}`);
    }
  });
});

// ---------------------------------------------------------------------------
// WP18 (F3) meta-question templates — every check below iterates the EXPORTED
// META_TEMPLATES table itself, so a template added later is swept
// automatically (routing, order-honesty, body-binding, no-numbers belt) or
// fails these tests by construction. The session-16 review lesson: a
// hand-enumerated belt goes stale the day a branch is added.
// ---------------------------------------------------------------------------

describe('meta-question templates (WP18/F3) — structural sweep over META_TEMPLATES', () => {
  it('every template ships with at least two example phrasings', () => {
    for (const t of META_TEMPLATES) {
      expect(t.examples.length, `template ${t.key}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('order-honesty: every example routes to its OWN template, never a shadowing earlier one', () => {
    for (const t of META_TEMPLATES) {
      for (const example of t.examples) {
        const matched = matchMetaTemplate(example);
        expect(matched?.key, `example ${JSON.stringify(example)} of template ${t.key}`).toBe(t.key);
      }
    }
  });

  it('every example builds reason "meta" with text BOUND to its template body (WP8 lesson: membership is not binding)', async () => {
    const topicsCompact = CANONICAL_MEASURES.map((m) => m.everydayTerms[0]).join(', ');
    for (const t of META_TEMPLATES) {
      for (const example of t.examples) {
        const built = await buildParseRefusal(db, parseRefusal('smalltalk', {}, example));
        expect(built.reason, `example ${JSON.stringify(example)}`).toBe('meta');
        expect(built.offer).toMatch(/Vraag bijvoorbeeld/);
        // Exact binding: the produced text IS this template's body + the
        // shared offer — not merely "contains a recognizable fragment".
        expect(built.text).toBe(`${t.buildBody({ topicsCompact })} ${built.offer}`);
        // Refusal-envelope rule: never ends in '?' (no pending state).
        expect(built.text.trimEnd().endsWith('?')).toBe(false);
      }
    }
  });

  it('no-numbers belt-check: every meta template text is whitelisted from ONLY the sources it may cite', async () => {
    // NARROW whitelist (adversarial-review finding 2026-07-04, executed
    // proof): the only period a meta text may legitimately cite is the one
    // measure the shared offer (exampleQuestionNl) resolves — pooling all 8
    // measures' freshest periods would pre-approve a wrong-measure
    // substitution. The selection below mirrors exampleQuestionNl's own.
    const offerMeasure =
      CANONICAL_MEASURES.find((m) => m.key === 'cpi_yearly_inflation') ?? CANONICAL_MEASURES[0]!;
    const whitelist = fullLabelWhitelist();
    const freshest = await freshestForCanonical(db, offerMeasure.key);
    if (freshest) {
      for (const n of periodCodeNumbers(freshest.periodCode)) whitelist.add(n);
    }
    for (const t of META_TEMPLATES) {
      for (const example of t.examples) {
        const built = await buildParseRefusal(db, parseRefusal('smalltalk', {}, example));
        assertNoUnbackedNumbers(built.text, whitelist, `meta template ${t.key}`);
      }
    }
  });

  it('content pins: each body carries its own load-bearing claim, no two templates share a body', async () => {
    // Independent per-key fragments (NOT derived from meta.ts) close the
    // body-binding test's blind spot: the binding test recomputes its
    // expectation from the same table, so a body copy-pasted across two
    // templates would pass it (adversarial-review finding 2026-07-04,
    // session-verified: both its skeptics died on a retry cap — a dead
    // verifier is missing coverage, never a clean pass).
    const FRAGMENT_BY_KEY: Record<string, string> = {
      missing_values: 'nooit zelf een schatting',
      reliability: 'vaste programmacode',
      freshness: 'hoe actueel het is',
      sources: 'CBS StatLine',
      capabilities: 'kan ik je helpen met cijfers over',
    };
    expect(Object.keys(FRAGMENT_BY_KEY).sort()).toEqual(META_TEMPLATES.map((t) => t.key).sort());
    const topicsCompact = CANONICAL_MEASURES.map((m) => m.everydayTerms[0]).join(', ');
    const bodies = META_TEMPLATES.map((t) => ({ key: t.key, body: t.buildBody({ topicsCompact }) }));
    for (const { key, body } of bodies) {
      // Own fragment present...
      expect(body, `body of ${key}`).toContain(FRAGMENT_BY_KEY[key]!);
      // ...and in NO other template's body (catches duplicated bodies).
      for (const other of bodies) {
        if (other.key === key) continue;
        expect(other.body, `fragment of ${key} leaked into ${other.key}`).not.toContain(
          FRAGMENT_BY_KEY[key]!,
        );
      }
    }
  });

  it('greetings and non-meta smalltalk fall through to the generic template (reason "smalltalk")', async () => {
    const nonMeta = ['hallo', 'Goedemorgen!', 'dank je wel', 'test question', 'fijne dag verder'];
    for (const q of nonMeta) {
      expect(matchMetaTemplate(q), `matchMetaTemplate(${JSON.stringify(q)})`).toBeNull();
      const built = await buildParseRefusal(db, parseRefusal('smalltalk', {}, q));
      expect(built.reason, q).toBe('smalltalk');
      expect(built.text).toMatch(/Ik beantwoord vragen over officiële CBS-cijfers/);
    }
  });

  it('zero-width characters cannot dodge the router (session-16 normalization lesson)', () => {
    // U+200B inside 'bronnen' — normalization must strip it before matching.
    const dodged = 'welke bro​nnen gebruik je?';
    expect(matchMetaTemplate(dodged)?.key).toBe('sources');
  });
});

// ---------------------------------------------------------------------------
// Query refusals — every kind
// ---------------------------------------------------------------------------

describe('buildQueryRefusal — exhaustive over every QueryRefusal.refusal.kind', () => {
  it('freshness: states the measure, the freshest available period + R11 status, and offers it', () => {
    const outcome = buildQueryRefusal(
      queryRefusal('freshness', {
        freshness: {
          freshestAvailable: { periodCode: '2026MM03', status: 'Voorlopig' },
          freshestDefinitief: null,
        },
      }),
    );
    expect(outcome.kind).toBe('refusal');
    if (outcome.kind !== 'refusal') throw new Error('unreachable');
    expect(outcome.refusal.reason).toBe('freshness');
    expect(outcome.refusal.text).toContain('maart 2026');
    expect(outcome.refusal.text).toContain('voorlopig cijfer');
    expect(outcome.refusal.offer).toContain('maart 2026');
  });

  it('freshness: mentions freshestDefinitief when it differs from freshestAvailable', () => {
    const outcome = buildQueryRefusal(
      queryRefusal('freshness', {
        freshness: {
          freshestAvailable: { periodCode: '2026MM03', status: 'Voorlopig' },
          freshestDefinitief: { periodCode: '2026MM01' },
        },
      }),
    );
    if (outcome.kind !== 'refusal') throw new Error('unreachable');
    expect(outcome.refusal.text).toContain('januari 2026');
    expect(outcome.refusal.offer).toContain('januari 2026');
  });

  it('freshness: does NOT mention freshestDefinitief when it equals freshestAvailable (Definitief, no status marking)', () => {
    const outcome = buildQueryRefusal(
      queryRefusal('freshness', {
        freshness: {
          freshestAvailable: { periodCode: '2024JJ00', status: 'Definitief' },
          freshestDefinitief: { periodCode: '2024JJ00' },
        },
      }),
    );
    if (outcome.kind !== 'refusal') throw new Error('unreachable');
    expect(outcome.refusal.text).not.toContain('voorlopig');
    // Should only mention the year once as the offered period, not a second
    // "laatste definitieve cijfer" aside.
    expect(outcome.refusal.text).not.toMatch(/laatste definitieve/);
  });

  it('freshness: NaderVoorlopig renders "nader voorlopig cijfer" (R11)', () => {
    const outcome = buildQueryRefusal(
      queryRefusal('freshness', {
        freshness: {
          freshestAvailable: { periodCode: '2024JJ00', status: 'NaderVoorlopig' },
          freshestDefinitief: null,
        },
      }),
    );
    if (outcome.kind !== 'refusal') throw new Error('unreachable');
    expect(outcome.refusal.text).toContain('nader voorlopig cijfer');
  });

  it('not_published vs outside_loaded_slice use DIFFERENT wording', () => {
    const notPublished = buildQueryRefusal(queryRefusal('not_published'));
    const outsideSlice = buildQueryRefusal(
      queryRefusal('outside_loaded_slice', { nearestAlternative: '2019JJ00' }),
    );
    if (notPublished.kind !== 'refusal' || outsideSlice.kind !== 'refusal') throw new Error('unreachable');
    expect(notPublished.refusal.reason).toBe('not_published');
    expect(outsideSlice.refusal.reason).toBe('outside_loaded_slice');
    expect(notPublished.refusal.text).not.toBe(outsideSlice.refusal.text);
    // not_published: CBS never published it.
    expect(notPublished.refusal.text).toMatch(/geen cijfer over deze periode gepubliceerd/i);
    // outside_loaded_slice: CBS DOES publish it, our slice doesn't reach it —
    // must use nearestAlternative when present, and phrase the limit as ours.
    expect(outsideSlice.refusal.text).toMatch(/publiceert de cijfers .*wel|publiceert deze cijfers wel/i);
    expect(outsideSlice.refusal.text).toMatch(/buiten wat wij hebben ingeladen/i);
    expect(outsideSlice.refusal.offer).toContain('2019');
  });

  it('table_quarantined -> reason "quarantined", honestly worded as temporary', () => {
    const outcome = buildQueryRefusal(queryRefusal('table_quarantined'));
    if (outcome.kind !== 'refusal') throw new Error('unreachable');
    expect(outcome.refusal.reason).toBe('quarantined');
    expect(outcome.refusal.text).toMatch(/tijdelijk/i);
  });

  it('needs_clarification -> a ClarificationResponse-shaped outcome; region axis gets concrete resolvable options', () => {
    const outcome = buildQueryRefusal(
      queryRefusal('needs_clarification', { axes: ['region', 'period'] }),
    );
    expect(outcome.kind).toBe('clarification');
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.axes).toEqual(['region', 'period']);
    // docs/05: options that actually resolve in the loaded data — "heel
    // Nederland" resolves; the gemeente/provincie preset mirrors docs/02 S3's
    // combined-preset example (adversarial-review fix, 2026-07-03).
    expect(outcome.options.length).toBeGreaterThan(0);
    expect(outcome.options[0]).toMatch(/Nederland/);
    // Merged phrasing: one "voor welke", not two (copy finding, same review).
    expect(outcome.questionNl).toContain('voor welke regio en periode');
  });

  it('needs_clarification on a non-region axis keeps free-form (empty) options', () => {
    const outcome = buildQueryRefusal(
      queryRefusal('needs_clarification', { axes: ['period'] }),
    );
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.options).toEqual([]);
  });

  it('needs_clarification falls back to [axis] when axes is absent', () => {
    const outcome = buildQueryRefusal(
      queryRefusal('needs_clarification', { axis: 'measure', axes: undefined }),
    );
    if (outcome.kind !== 'clarification') throw new Error('unreachable');
    expect(outcome.axes).toEqual(['measure']);
  });

  const internalKinds: RefusalKind[] = [
    'invalid_intent',
    'table_not_registered',
    'no_data',
    'derivation_failed',
    'internal_inconsistency',
  ];
  for (const kind of internalKinds) {
    it(`${kind} -> reason "internal", honest per-kind wording, internalNote carries refusal.message`, () => {
      const outcome = buildQueryRefusal(queryRefusal(kind, { message: `distinct message for ${kind}` }));
      if (outcome.kind !== 'refusal') throw new Error('unreachable');
      expect(outcome.refusal.reason).toBe('internal');
      expect(outcome.refusal.internalNote).toBe(`distinct message for ${kind}`);
      expect(outcome.refusal.text).not.toMatch(/\?\s*$/);
    });
  }

  it('every internal kind produces DISTINCT user-facing wording (not one generic string)', () => {
    const texts = internalKinds.map((kind) => {
      const outcome = buildQueryRefusal(queryRefusal(kind));
      if (outcome.kind !== 'refusal') throw new Error('unreachable');
      return outcome.refusal.text;
    });
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('a new QueryRefusal.refusal.kind would break compile (exhaustiveness, verified by code review of the switch)', () => {
    // The switch in buildQueryRefusal ends with `const _exhaustive: never =
    // refusal.refusal.kind` — a new RefusalKind member fails typecheck at
    // that line, not at runtime. This test documents the guarantee; the
    // actual enforcement is npm run typecheck (see WP9 verification loop).
    const allKnownKinds: RefusalKind[] = [
      'invalid_intent', 'needs_clarification', 'table_not_registered', 'table_quarantined',
      'outside_loaded_slice', 'not_published', 'freshness', 'no_data', 'derivation_failed',
      'internal_inconsistency',
    ];
    for (const kind of allKnownKinds) {
      expect(() => buildQueryRefusal(queryRefusal(kind))).not.toThrow();
    }
  });

  it('no-numbers belt-check: every built query-refusal text is fully whitelisted', () => {
    const whitelist = new Set([
      ...buildWhitelist({ periodCodes: ['2026MM03', '2026MM01', '2024JJ00', '2019JJ00'] }),
      ...fullLabelWhitelist(),
    ]);
    const cases: QueryRefusal[] = [
      queryRefusal('freshness', {
        freshness: {
          freshestAvailable: { periodCode: '2026MM03', status: 'Voorlopig' },
          freshestDefinitief: { periodCode: '2026MM01' },
        },
      }),
      queryRefusal('not_published'),
      queryRefusal('outside_loaded_slice', { nearestAlternative: '2019JJ00' }),
      queryRefusal('table_quarantined'),
      ...internalKinds.map((kind) => queryRefusal(kind)),
    ];
    for (const refusal of cases) {
      const outcome = buildQueryRefusal(refusal);
      if (outcome.kind === 'refusal') {
        assertNoUnbackedNumbers(outcome.refusal.text, whitelist, `query refusal ${refusal.refusal.kind}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Still-ambiguous-after-round (final round: refusal-with-guidance)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Source-selection pre-parse belt (WP129+130, #129/#130, ADR 032) — a
// deselected-CBS turn refuses DETERMINISTICALLY, before any parse/LLM.
// ---------------------------------------------------------------------------

describe('source-selection refusal builders (WP129+130)', () => {
  it('buildNoSourcesRefusal: reason no_sources, digit-free, never ends in a question', () => {
    const built = buildNoSourcesRefusal();
    expect(built.reason).toBe('no_sources');
    expect([...numbersInText(built.text)]).toHaveLength(0);
    expect(built.text.trimEnd().endsWith('?')).toBe(false);
  });

  it('buildWebOnlyRefusal: reason web_only, digit-free, never ends in a question', () => {
    const built = buildWebOnlyRefusal();
    expect(built.reason).toBe('web_only');
    expect([...numbersInText(built.text)]).toHaveLength(0);
    expect(built.text.trimEnd().endsWith('?')).toBe(false);
  });
});

describe('source-selection pre-parse belt — no LLM invoked, both entry points', () => {
  /** A spy client that would FAIL the test if the pipeline ever reached an LLM
   * call — the pre-parse belt must short-circuit before any parse. */
  function spyClient(): { client: LlmClient; calls: () => number } {
    let calls = 0;
    const client: LlmClient = {
      async complete() {
        calls += 1;
        throw new Error('LLM must not be called on a deselected-CBS turn');
      },
    };
    return { client, calls: () => calls };
  }

  function options(client: LlmClient, sourceSelection: { sources: string[]; web: boolean }) {
    return {
      intentClient: client,
      answerClient: client,
      referenceDate: '2025-01-01',
      sourceSelection,
    };
  }

  it('respondToQuestion + no sources at all ⇒ no_sources refusal, zero LLM calls', async () => {
    const { client, calls } = spyClient();
    const response = await respondToQuestion(db, 'wat is de inflatie?', options(client, { sources: [], web: false }));
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('no_sources');
    expect(calls()).toBe(0);
  });

  it('respondToQuestion + CBS deselected but Internet kept ⇒ web_only refusal, zero LLM calls', async () => {
    const { client, calls } = spyClient();
    const response = await respondToQuestion(db, 'wat is de inflatie?', options(client, { sources: [], web: true }));
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('web_only');
    expect(calls()).toBe(0);
  });

  it('respondToQuestion + an unknown non-CBS source + Internet ⇒ web_only (CBS is what gates a verified answer)', async () => {
    const { client, calls } = spyClient();
    const response = await respondToQuestion(db, 'wat is de inflatie?', options(client, { sources: ['weer'], web: true }));
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('web_only');
    expect(calls()).toBe(0);
  });

  it('respondToClarificationReply + no sources ⇒ no_sources refusal carrying the ORIGINAL question, zero LLM calls', async () => {
    const { client, calls } = spyClient();
    const pending: PendingClarification = {
      version: RESPONSE_SCHEMA_VERSION,
      question: 'Hoeveel mensen zitten in de bijstand?',
      referenceDate: '2025-01-01',
      axes: ['region'],
      questionNl: 'Voor welke regio?',
      options: ['heel Nederland'],
    };
    const response = await respondToClarificationReply(db, pending, 'heel Nederland', options(client, { sources: [], web: false }));
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('no_sources');
    expect(response.question).toBe(pending.question);
    expect(calls()).toBe(0);
  });
});

describe('buildStillAmbiguousRefusal', () => {
  it('names what stayed unresolved and gives ONE concrete example question, no pending', async () => {
    const built = await buildStillAmbiguousRefusal(db, ['region', 'period']);
    expect(built.reason).toBe('still_ambiguous');
    expect(built.text).not.toMatch(/\?\s*$/); // never ends in a question
    // Exactly one embedded example question (inside quotes) is allowed.
    const questionMarks = (built.text.match(/\?/g) ?? []).length;
    expect(questionMarks).toBe(1);
    expect(built.guidance).toContain('"Wat was de');
  });

  it('the example uses a loaded measure + the freshest available period so every digit is whitelistable', async () => {
    const built = await buildStillAmbiguousRefusal(db, ['measure']);
    // The whitelist holds EXACTLY the structured source the example cites —
    // the freshest-available period of the loaded measures — not a broad
    // year range that could bless a fabricated year (adversarial-review
    // finding, 2026-07-03: the old 2019-2026 loop made this check unfailable).
    const whitelist = await fullLabelAndFreshestWhitelist();
    assertNoUnbackedNumbers(built.text, whitelist, 'still-ambiguous example');
  });
});
