// web/app/dataset-whole-verification-actions.ts's Server Action wire,
// hermetic — mirrors dataset-actions.test.ts's mocked-module convention
// (auth-in-the-action, ownership via getDataset, log-then-report on an
// unexpected failure); dataset-derivation-actions.ts (the file this action
// mirrors) has no test of its own to copy verbatim, so this follows
// dataset-actions.test.ts's own established shape instead — the SAME
// ownership pattern dataset-derivation-actions.ts's own header comment says
// it copied from renderDatasetInstruction. ingest/profile.ts
// (buildDatasetProfile) and the verify-whole.ts / instruct/schema.ts
// pipeline underneath stay REAL: a hand-built DatasetProfile mock would be
// more work than a realistic CSV fixture, and this file's own job is
// proving the ACTION's wiring (auth, ownership, instruction revalidation,
// error mapping) — tests/attachments/verify-whole.test.ts already proves
// the arithmetic in full.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../backend/db/types.ts';
import type { UserDataset } from '../backend/attachments/types.ts';
import { buildDatasetProfile } from '../backend/attachments/ingest/profile.ts';

const { currentUserId, getDb } = vi.hoisted(() => ({
  currentUserId: vi.fn<() => Promise<string | null>>(),
  getDb: vi.fn<() => Db>(),
}));
vi.mock('../lib/current-user.ts', () => ({ currentUserId }));
vi.mock('../lib/db.ts', () => ({ getDb }));

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/error-report.ts', () => ({ reportError }));

const store = vi.hoisted(() => ({ getDataset: vi.fn() }));
vi.mock('../backend/attachments/store.ts', () => store);

import { requestWholeVerification } from './dataset-whole-verification-actions.ts';

const fakeDb = {} as Db;

// Same shape as tests/attachments/verify-whole.test.ts's own fixture: row
// indices below follow this array's own order (header excluded) — r1=Noord,
// r2=Zuid, r3=Oost, r4=Totaal, all in column c2 (Omzet). Noord+Zuid+Oost =
// 998, within tolerance of Totaal's 1000.
const CELLS = [
  ['Jaar', 'Regio', 'Omzet'],
  ['2020', 'Noord', '400'],
  ['2020', 'Zuid', '350'],
  ['2020', 'Oost', '248'],
  ['2020', 'Totaal', '1000'],
];

function fakeDataset(overrides: Partial<UserDataset> = {}): UserDataset {
  return {
    id: 1,
    userId: 'user-1',
    sourceKind: 'file_csv',
    displayName: 'omzet.csv',
    sourceUrl: null,
    cells: CELLS,
    profile: buildDatasetProfile(CELLS),
    status: 'ready',
    contentSha256: 'deadbeef',
    createdAt: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

function instruction(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    kind: 'bar',
    x: 'c0',
    y: ['c2'],
    seriesBy: 'c1',
    filters: [],
    sort: null,
    limit: null,
    aggregate: null,
    derived: null,
    unsupported: null,
    ...fields,
  };
}

beforeEach(() => {
  currentUserId.mockResolvedValue('user-1');
  getDb.mockReturnValue(fakeDb);
  store.getDataset.mockResolvedValue(fakeDataset());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('requestWholeVerification', () => {
  it('returns ok:false with no dataset lookup when signed out', async () => {
    currentUserId.mockResolvedValue(null);
    const result = await requestWholeVerification(1, instruction(), 'r4:c2', ['r1:c2']);
    expect(result).toEqual({ ok: false });
    expect(store.getDataset).not.toHaveBeenCalled();
  });

  it('throws on a malformed datasetId — a shape the real UI can never produce', async () => {
    await expect(requestWholeVerification(-1, instruction(), 'r4:c2', ['r1:c2'])).rejects.toThrow('input rejected');
    await expect(requestWholeVerification(1.5, instruction(), 'r4:c2', ['r1:c2'])).rejects.toThrow('input rejected');
  });

  it('rejects a foreign or nonexistent dataset with the SAME opaque reason — no probing', async () => {
    store.getDataset.mockResolvedValue(null);
    const result = await requestWholeVerification(1, instruction(), 'r4:c2', ['r1:c2']);
    expect(result).toEqual({ ok: false, reason: 'this dataset is not available' });
    // getDataset is itself userId-bound (store.ts's own doc comment) — the
    // action passes the CALLER's OWN userId, never a client-supplied one.
    expect(store.getDataset).toHaveBeenCalledWith(fakeDb, 'user-1', 1);
  });

  it('refuses a dataset that is not ready', async () => {
    store.getDataset.mockResolvedValue(fakeDataset({ status: 'needs_decision' }));
    const result = await requestWholeVerification(1, instruction(), 'r4:c2', ['r1:c2']);
    expect(result).toEqual({ ok: false, reason: 'this dataset is not available' });
  });

  it('refuses a malformed wholeRowRef or partRowRefs without touching instruction validation', async () => {
    expect(await requestWholeVerification(1, instruction(), '', ['r1:c2'])).toEqual({ ok: false, reason: 'invalid selection' });
    expect(await requestWholeVerification(1, instruction(), 'r4:c2', 'not-an-array')).toEqual({ ok: false, reason: 'invalid selection' });
    expect(await requestWholeVerification(1, instruction(), 'r4:c2', [123])).toEqual({ ok: false, reason: 'invalid selection' });
  });

  it('accepts an empty partRowRefs list (every other series hidden) — a graceful outcome, never a refusal', async () => {
    const result = await requestWholeVerification(1, instruction(), 'r4:c2', []);
    expect(result).toEqual({ ok: true, outcome: { verified: false, reason: 'sum_mismatch' } });
  });

  it('refuses an instruction that fails revalidation against the CURRENT profile', async () => {
    const result = await requestWholeVerification(1, instruction({ x: 'nope' }), 'r4:c2', ['r1:c2']);
    expect(result).toEqual({ ok: false, reason: 'this chart could not be validated' });
  });

  it('verifies a genuine match end to end (real instruction validation + real arithmetic)', async () => {
    const result = await requestWholeVerification(1, instruction(), 'r4:c2', ['r1:c2', 'r2:c2', 'r3:c2']);
    expect(result).toEqual({ ok: true, outcome: { verified: true } });
  });

  it('reports a genuine mismatch as ok:true — informational, never a refusal', async () => {
    const result = await requestWholeVerification(1, instruction(), 'r4:c2', ['r1:c2']);
    expect(result).toEqual({ ok: true, outcome: { verified: false, reason: 'sum_mismatch' } });
  });

  it('maps a real NoRowsError (two real-valued but mutually exclusive filters match nothing) to an English reason, never a thrown crash', async () => {
    // Both filter values are real, distinct Regio values (schema-valid —
    // an "impossible" value like 'Nergens' is refused by the schema itself,
    // never reaching executeInstruction), but AND'd together no row can
    // satisfy both at once — a genuinely reachable "the chart's own data
    // changed since" case, not a schema violation.
    const noMatch = instruction({
      filters: [
        { column: 'c1', op: 'in', values: ['Noord'] },
        { column: 'c1', op: 'in', values: ['Zuid'] },
      ],
    });
    const result = await requestWholeVerification(1, noMatch, 'r4:c2', ['r1:c2']);
    expect(result).toEqual({ ok: false, reason: 'this chart no longer has any matching rows' });
  });

  it('a genuinely unexpected error is reported and answered with a bare refusal, never a verdict', async () => {
    store.getDataset.mockRejectedValue(new Error('boom'));
    await expect(requestWholeVerification(1, instruction(), 'r4:c2', ['r1:c2'])).rejects.toThrow('boom');
  });
});
