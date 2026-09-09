// ADR 041 / spec Part B3 "Live" mode (Task 6): parseStoredIntent's defensive
// validation, and rerunLive's end-to-end re-run of a STORED StructuredIntent
// through the live query pipeline. parseStoredIntent is modeled on
// web/app/chart-style-actions.ts's own parseBrandApplied — hand-rolled
// validation, never a bare cast — because AuditRecord.intent is typed
// `unknown | null` on purpose (promoted, freeform JSON from a row written
// possibly days or weeks ago) and this is the one place in the codebase that
// trusts it enough to feed straight into runQuery.
//
// Lives under tests/chart/ (not colocated as src/chart/embed-live.test.ts,
// despite the task plan's own file list) for a concrete, mechanical reason:
// this file needs tests/helpers/{pglite-db,ingested-db}.ts, and `web/backend`
// is a symlink to `../src` (⟨A3⟩) — the SAME relative import string resolves
// to two different real paths depending on whether tsc reaches this file via
// `src/chart/` (2 path segments from the repo root) or via `web/backend/chart/`
// (3 segments, same real directory, different apparent depth), which is
// exactly what `npm run web:typecheck` does today (it sweeps up every file
// under the symlink, tests included). A colocated version of this file broke
// that check with two TS2307 "cannot find module" errors. This mirrors every
// OTHER src/chart/*.ts module's own test location already: build.ts
// (tests/chart/build-spec.test.ts), brand-cache.ts, brandfetch.ts,
// user-styles.ts, annotations.ts, curated.ts, render.ts — none of them are
// colocated either, DB-touching or not; only src/chart/embed-token.ts (pure
// crypto, zero imports beyond node:crypto) and src/billing/pro.ts (pure env
// lookup) are colocated exceptions in this whole codebase, and neither of
// them needs anything from tests/helpers/. rerunLive's tests run the REAL
// runQuery/buildChartSpec against a real PGlite database rather than mocking
// the query layer out — matching this codebase's own convention (zero
// `vi.mock` calls anywhere in src/'s test suite; tests/query/last-queried.test.ts
// in particular already proves runQuery's `probe: true` behavior this exact
// way — by reading back last_queried_at, never by inspecting mock call args)
// rather than introducing the first mocked query-layer test in this codebase.
import { describe, expect, it } from 'vitest';
import { parseStoredIntent, rerunLive } from '../../src/chart/embed-live.ts';
import { CHART_SPEC_VERSION } from '../../src/chart/index.ts';
import { INTENT_SCHEMA_VERSION } from '../../src/query/index.ts';
import type { StructuredIntent } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import type { AuditRecord } from '../../src/answer/audit/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { createIngestedDb, tableIdForCanonicalKey } from '../helpers/ingested-db.ts';

// A real, well-formed StructuredIntent (src/query/types.ts) — canonical
// target, a single CBS period code, no derivation. The exact literals
// (schemaVersion, the target/period discriminant member names) are copied
// from that file directly, not paraphrased.
const VALID: StructuredIntent = {
  schemaVersion: INTENT_SCHEMA_VERSION,
  target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
  period: { kind: 'codes', codes: ['2024JJ00'] },
  derivation: 'none',
};

describe('parseStoredIntent', () => {
  it('accepts a well-formed StructuredIntent', () => {
    expect(parseStoredIntent(VALID)).toEqual(VALID);
  });

  it('accepts a well-formed StructuredIntent with an explicit target and a period range', () => {
    const explicit: StructuredIntent = {
      schemaVersion: INTENT_SCHEMA_VERSION,
      target: { kind: 'explicit', tableId: '82235NED', measure: 'M001' },
      period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
      derivation: 'series',
    };
    expect(parseStoredIntent(explicit)).toEqual(explicit);
  });

  it('accepts an explicit target whose optional dims is a well-formed string record', () => {
    const withDims: StructuredIntent = {
      schemaVersion: INTENT_SCHEMA_VERSION,
      target: { kind: 'explicit', tableId: '82235NED', measure: 'M001', dims: { Geslacht: 'T001038' } },
      period: { kind: 'codes', codes: ['2024JJ00'] },
      derivation: 'none',
    };
    expect(parseStoredIntent(withDims)).toEqual(withDims);
  });

  it('rejects null/undefined/non-object/array input', () => {
    expect(parseStoredIntent(null)).toBeNull();
    expect(parseStoredIntent(undefined)).toBeNull();
    expect(parseStoredIntent('a string')).toBeNull();
    expect(parseStoredIntent(42)).toBeNull();
    expect(parseStoredIntent(true)).toBeNull();
    expect(parseStoredIntent([])).toBeNull();
    expect(parseStoredIntent({})).toBeNull();
  });

  it('rejects a schemaVersion that does not match INTENT_SCHEMA_VERSION', () => {
    expect(parseStoredIntent({ ...VALID, schemaVersion: 2 })).toBeNull();
    expect(parseStoredIntent({ ...VALID, schemaVersion: '1' })).toBeNull();
    expect(parseStoredIntent({ ...VALID, schemaVersion: undefined })).toBeNull();
  });

  it('rejects a missing or malformed target', () => {
    expect(parseStoredIntent({ ...VALID, target: undefined })).toBeNull();
    expect(parseStoredIntent({ ...VALID, target: null })).toBeNull();
    expect(parseStoredIntent({ ...VALID, target: 'cpi_yearly_inflation' })).toBeNull();
    expect(parseStoredIntent({ ...VALID, target: { kind: 'not-a-real-kind' } })).toBeNull();
    expect(parseStoredIntent({ ...VALID, target: { kind: 'canonical', key: 42 } })).toBeNull();
    expect(parseStoredIntent({ ...VALID, target: { kind: 'canonical', key: '' } })).toBeNull();
    expect(parseStoredIntent({ ...VALID, target: { kind: 'canonical' } })).toBeNull();
    expect(parseStoredIntent({ ...VALID, target: { kind: 'explicit', tableId: '82235NED' } })).toBeNull();
    expect(parseStoredIntent({ ...VALID, target: { kind: 'explicit', measure: 'M001' } })).toBeNull();
  });

  it('rejects an explicit target whose optional dims is malformed', () => {
    expect(
      parseStoredIntent({
        ...VALID,
        target: { kind: 'explicit', tableId: '82235NED', measure: 'M001', dims: 'not-an-object' },
      }),
    ).toBeNull();
    expect(
      parseStoredIntent({
        ...VALID,
        target: { kind: 'explicit', tableId: '82235NED', measure: 'M001', dims: { Geslacht: 42 } },
      }),
    ).toBeNull();
    expect(
      parseStoredIntent({
        ...VALID,
        target: { kind: 'explicit', tableId: '82235NED', measure: 'M001', dims: null },
      }),
    ).toBeNull();
  });

  it('rejects a malformed period', () => {
    expect(parseStoredIntent({ ...VALID, period: { kind: 'codes', codes: 'not-an-array' } })).toBeNull();
    expect(parseStoredIntent({ ...VALID, period: { kind: 'codes', codes: [] } })).toBeNull();
    expect(parseStoredIntent({ ...VALID, period: { kind: 'codes', codes: ['2024JJ00', 42] } })).toBeNull();
    expect(parseStoredIntent({ ...VALID, period: { kind: 'range', from: '2020JJ00' } })).toBeNull();
    expect(parseStoredIntent({ ...VALID, period: { kind: 'range', to: '2020JJ00' } })).toBeNull();
    expect(parseStoredIntent({ ...VALID, period: { kind: 'not-a-real-kind' } })).toBeNull();
    expect(parseStoredIntent({ ...VALID, period: undefined })).toBeNull();
  });

  it('rejects an invalid derivation value', () => {
    expect(parseStoredIntent({ ...VALID, derivation: 'invent-a-number' })).toBeNull();
    expect(parseStoredIntent({ ...VALID, derivation: 42 })).toBeNull();
    expect(parseStoredIntent({ ...VALID, derivation: undefined })).toBeNull();
  });

  it('accepts an optional regions array (including empty), rejects a malformed one', () => {
    expect(parseStoredIntent({ ...VALID, regions: ['NL01'] })).toEqual({ ...VALID, regions: ['NL01'] });
    expect(parseStoredIntent({ ...VALID, regions: [] })).toEqual({ ...VALID, regions: [] });
    expect(parseStoredIntent({ ...VALID, regions: 'NL01' })).toBeNull();
    expect(parseStoredIntent({ ...VALID, regions: [42] })).toBeNull();
  });

  it('never throws, even on deeply adversarial input', () => {
    const nullProto = Object.create(null);
    expect(() => parseStoredIntent(nullProto)).not.toThrow();
    expect(parseStoredIntent(nullProto)).toBeNull();

    const circular: Record<string, unknown> = { schemaVersion: 1 };
    circular.self = circular;
    expect(() => parseStoredIntent(circular)).not.toThrow();
    expect(parseStoredIntent(circular)).toBeNull();
  });
});

describe('rerunLive', () => {
  function record(intent: unknown, overrides: Partial<AuditRecord> = {}): AuditRecord {
    return {
      id: 1,
      userId: null,
      createdAt: '2026-09-10T00:00:00.000Z',
      intent,
      ...overrides,
    } as unknown as AuditRecord;
  }

  // A real, always-servable series intent (yearly CPI inflation 2020-2024) —
  // the same canonical key/period shape tests/query/query.test.ts and
  // tests/helpers/benchmark-intents.ts's own B4 task already rely on being
  // ingested by the hermetic fixture build.
  const SERIES_INTENT: StructuredIntent = {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
    period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
    derivation: 'series',
  };

  it('returns null when the stored intent fails validation', async () => {
    const db = {} as Db; // never touched: parseStoredIntent rejects before any query runs
    expect(await rerunLive(db, record({ garbage: true }), { lang: 'nl' })).toBeNull();
  });

  it('returns null when the stored intent is entirely absent (null)', async () => {
    const db = {} as Db;
    expect(await rerunLive(db, record(null), { lang: 'nl' })).toBeNull();
  });

  it('returns null (never throws) when the database itself throws', async () => {
    const db: Db = {
      query: async () => {
        throw new Error('db down');
      },
      withTransaction: async () => {
        throw new Error('db down');
      },
    };
    await expect(rerunLive(db, record(VALID), { lang: 'nl' })).resolves.toBeNull();
  });

  it('returns null on a refusal outcome (e.g. an unknown canonical key)', async () => {
    const { db, close } = await createTestDb();
    try {
      const unresolvable: StructuredIntent = {
        schemaVersion: INTENT_SCHEMA_VERSION,
        target: { kind: 'canonical', key: 'not-a-real-canonical-key' },
        period: { kind: 'codes', codes: ['2024JJ00'] },
        derivation: 'none',
      };
      expect(await rerunLive(db, record(unresolvable), { lang: 'nl' })).toBeNull();
    } finally {
      await close();
    }
  });

  it('returns a fresh ChartSpec when the stored intent still resolves cleanly', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const spec = await rerunLive(db, record(SERIES_INTENT), { lang: 'nl' });
      expect(spec).not.toBeNull();
      expect(spec!.schemaVersion).toBe(CHART_SPEC_VERSION);
      expect(spec!.kind).toBe('line');
      expect(spec!.series.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  }, 300_000);

  it('passes { probe: true } to runQuery — a live embed re-render is not a billed/served turn', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const spec = await rerunLive(db, record(SERIES_INTENT), { lang: 'nl' });
      expect(spec).not.toBeNull(); // sanity: the call actually succeeded

      // #195 discipline (src/query/run.ts): only a DELIVERABLE read counts as
      // demand for the eviction GC. Proven the same way
      // tests/query/last-queried.test.ts's own "#195: a probe read... does
      // NOT stamp the table" case proves it — by reading back the real
      // last_queried_at column on a freshly-ingested (never-queried) fixture
      // — never by inspecting a mock's call arguments.
      const tableId = await tableIdForCanonicalKey(db, 'cpi_yearly_inflation');
      const { rows } = await db.query('select last_queried_at from cbs_tables where id = $1', [tableId]);
      expect(rows[0]!.last_queried_at).toBeNull();
    } finally {
      await close();
    }
  }, 300_000);
});
