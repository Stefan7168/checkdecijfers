// dev-harness Task 1 (session 111): the harness-only intent-injection bypass
// (src/answer/respond/harness-intent.ts) that lets a local real-browser
// harness run exercise the region_set shape (ADR 054) whose LLM-facing
// vocabulary (Task 9) is not built yet — nothing a real parse can produce
// reaches it. Two things are pinned:
//
//  1. The pure prefix/JSON parsing (tryHarnessInjectedIntent /
//     harnessParseOutcome) — no db, no LLM.
//  2. The env-flag gate END TO END through respondToQuestion: flag ON makes
//     a `!!regionset <name>` question skip the parser and answer as a real
//     region_set result (byte-consistent with the roster
//     tests/query/region-set-run.test.ts pins); flag OFF (or deleted) makes
//     the exact same magic-prefixed text fall through to the ORDINARY parse
//     — i.e. the intent client is actually called — which is the guarantee
//     that this bypass is unreachable in production (HARNESS_INTENT_INJECT
//     is never set there).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { respondToQuestion } from '../../src/answer/respond/index.ts';
import {
  HARNESS_INTENT_ENV_FLAG,
  harnessParseOutcome,
  tryHarnessInjectedIntent,
} from '../../src/answer/respond/harness-intent.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import type { RawParse } from '../../src/answer/intent/types.ts';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

const REFERENCE_DATE = '2026-09-17';

/** Fails the test if ever called — composeAnswer's region_set path is
 * template-only by construction (ADR 054 D6), and a flag-off fallthrough in
 * these tests always exits before reaching compose (a smalltalk refusal). */
class NeverCalledClient implements LlmClient {
  calls = 0;
  async complete(): Promise<LlmResponse> {
    this.calls += 1;
    throw new Error('should not be called in this test');
  }
}

/** Records that it ran and returns a valid, schema-conforming smalltalk raw
 * parse — proves the ORDINARY parser actually executed (flag-off
 * fallthrough), without needing a real network call or a recorded fixture. */
class CountingSmalltalkClient implements LlmClient {
  calls = 0;
  async complete(): Promise<LlmResponse> {
    this.calls += 1;
    const raw: RawParse = {
      version: 3,
      kind: 'smalltalk_or_other',
      candidates: [],
      unmatchedMeasureTerm: null,
      nearestCanonicalKeys: [],
      note: null,
    };
    return { outputText: JSON.stringify(raw), model: 'stub', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

beforeEach(() => {
  delete process.env[HARNESS_INTENT_ENV_FLAG];
});

afterEach(() => {
  delete process.env[HARNESS_INTENT_ENV_FLAG];
});

describe('tryHarnessInjectedIntent (pure)', () => {
  it('the flag unset: every prefix, and plain text, returns null', () => {
    expect(tryHarnessInjectedIntent('!!regionset provincies')).toBeNull();
    expect(tryHarnessInjectedIntent('!!intent {"target":{"kind":"canonical","key":"x"}}')).toBeNull();
    expect(tryHarnessInjectedIntent('Hoeveel inwoners heeft Nederland?')).toBeNull();
  });

  describe('the flag set', () => {
    beforeEach(() => {
      process.env[HARNESS_INTENT_ENV_FLAG] = '1';
    });

    it('NODE_ENV=production disables the injector even with the flag set (parent belt, session 110)', () => {
      const before = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        expect(tryHarnessInjectedIntent('!!regionset provincies')).toBeNull();
      } finally {
        if (before === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = before;
      }
    });

    it('an ordinary question (no magic prefix) still returns null', () => {
      expect(tryHarnessInjectedIntent('Hoeveel inwoners heeft Nederland?')).toBeNull();
    });

    it('!!regionset provincies resolves the named population/all_provincies intent', () => {
      expect(tryHarnessInjectedIntent('!!regionset provincies')).toEqual({
        schemaVersion: 1,
        target: { kind: 'canonical', key: 'population_on_1_january' },
        period: { kind: 'codes', codes: ['2025JJ00'] },
        derivation: 'none',
        regionSet: { kind: 'all_provincies' },
      });
    });

    it('!!regionset gemeenten-utrecht resolves the named gemeenten-in-PV26 intent', () => {
      expect(tryHarnessInjectedIntent('!!regionset gemeenten-utrecht')).toEqual({
        schemaVersion: 1,
        target: { kind: 'canonical', key: 'average_home_sale_price_by_gemeente' },
        period: { kind: 'codes', codes: ['2024JJ00'] },
        derivation: 'none',
        regionSet: { kind: 'gemeenten_in_provincie', parent: 'PV26' },
      });
    });

    it('an unknown !!regionset name returns null, never a guess', () => {
      expect(tryHarnessInjectedIntent('!!regionset does-not-exist')).toBeNull();
    });

    it('!!intent accepts a hand-authored StructuredIntent as raw JSON, forcing schemaVersion', () => {
      const question =
        '!!intent {"schemaVersion":99,"target":{"kind":"canonical","key":"cpi_yearly_inflation"},"period":{"kind":"codes","codes":["2024JJ00"]},"derivation":"none"}';
      expect(tryHarnessInjectedIntent(question)).toEqual({
        schemaVersion: 1,
        target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
        period: { kind: 'codes', codes: ['2024JJ00'] },
        derivation: 'none',
      });
    });

    it('malformed JSON after !!intent returns null rather than throwing', () => {
      expect(() => tryHarnessInjectedIntent('!!intent {not json')).not.toThrow();
      expect(tryHarnessInjectedIntent('!!intent {not json')).toBeNull();
    });

    it('valid JSON missing target/period/derivation returns null', () => {
      expect(tryHarnessInjectedIntent('!!intent {"foo":"bar"}')).toBeNull();
    });
  });
});

describe('harnessParseOutcome (pure)', () => {
  it('wraps an intent as a kind:"intent" ParseOutcome with zero recorded LLM usage', () => {
    // The flag is unset in this describe block (top-level beforeEach) —
    // harnessParseOutcome is a pure wrapper with no flag check of its own,
    // called here directly with a literal intent.
    const outcome = harnessParseOutcome('!!regionset provincies', {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'population_on_1_january' },
      period: { kind: 'codes', codes: ['2025JJ00'] },
      derivation: 'none',
      regionSet: { kind: 'all_provincies' },
    });
    expect(outcome.kind).toBe('intent');
    expect(outcome.raw.candidates).toEqual([]);
    expect(outcome.raw.note).toContain(HARNESS_INTENT_ENV_FLAG);
    expect(outcome.ranked).toEqual([]);
    expect(outcome.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(outcome.model).toBe('harness-intent-inject');
  });
});

describe('respondToQuestion — the env-flag gate, end to end', () => {
  it('flag OFF: a "!!intent {...}" question is treated as ordinary text — the real parser runs', async () => {
    const client = new CountingSmalltalkClient();
    const response = await respondToQuestion(db, '!!intent {"target":{"kind":"canonical","key":"x"},"period":{"kind":"codes","codes":["2024JJ00"]},"derivation":"none"}', {
      intentClient: client,
      answerClient: new NeverCalledClient(),
      referenceDate: REFERENCE_DATE,
    });
    expect(client.calls).toBe(1);
    expect(response.kind).toBe('refusal');
    if (response.kind === 'refusal') expect(response.reason).toBe('smalltalk');
  });

  it('flag ON: "!!regionset provincies" skips the parser and answers as a real, complete region_set result', async () => {
    process.env[HARNESS_INTENT_ENV_FLAG] = '1';
    const intentClient = new NeverCalledClient();
    const response = await respondToQuestion(db, '!!regionset provincies', {
      intentClient,
      answerClient: new NeverCalledClient(), // region_set is template-only (ADR 054 D6)
      referenceDate: REFERENCE_DATE,
    });
    expect(intentClient.calls).toBe(0);
    expect(response.kind).toBe('answer');
    if (response.kind !== 'answer') throw new Error('unreachable');
    expect(response.result.shape).toBe('region_set');
    expect(response.result.cells).toHaveLength(12);
    expect(response.result.regionSet?.complete).toBe(true);
    expect(response.chart).not.toBeNull();
    // Structural coverage disclosure lands outside the R1-scanned body.
    expect(response.answer.regionSetLine).toBeTruthy();
  });

  it('flag ON but no magic prefix: an ordinary question still runs the real parser', async () => {
    process.env[HARNESS_INTENT_ENV_FLAG] = '1';
    const client = new CountingSmalltalkClient();
    const response = await respondToQuestion(db, 'Hallo, hoe gaat het?', {
      intentClient: client,
      answerClient: new NeverCalledClient(),
      referenceDate: REFERENCE_DATE,
    });
    expect(client.calls).toBe(1);
    expect(response.kind).toBe('refusal');
  });
});
