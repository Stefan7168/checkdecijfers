// The own-data derivation server action's input gate (#292(b), session 124):
// a selection naming the same point twice is refused before any dataset is
// read — a difference of a point with itself is an automatic 0, and a mean
// would count that point twice. Mocking pattern as in
// chart-derivation-actions.test.ts.
import { describe, expect, it, vi } from 'vitest';

const { currentUserId, getDb, getDataset } = vi.hoisted(() => ({
  currentUserId: vi.fn().mockResolvedValue('u1'),
  getDb: vi.fn(),
  getDataset: vi.fn(),
}));
vi.mock('../lib/current-user.ts', () => ({ currentUserId }));
vi.mock('../lib/db.ts', () => ({ getDb }));
vi.mock('../backend/attachments/store.ts', () => ({ getDataset }));
vi.mock('../lib/error-report.ts', () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { requestDatasetDerivation } from './dataset-derivation-actions.ts';

describe('requestDatasetDerivation — input gate', () => {
  it('refuses a difference of a point with itself, without reading the dataset', async () => {
    expect(await requestDatasetDerivation(1, {}, 'difference', ['r1:c2', 'r1:c2'])).toEqual({ ok: false, reason: 'invalid selection' });
    expect(getDataset).not.toHaveBeenCalled();
  });

  it('refuses a mean that names a point twice', async () => {
    expect(await requestDatasetDerivation(1, {}, 'mean', ['r1:c2', 'r2:c2', 'r1:c2'])).toEqual({ ok: false, reason: 'invalid selection' });
    expect(getDataset).not.toHaveBeenCalled();
  });

  it('distinct points pass the gate and reach the dataset lookup', async () => {
    getDataset.mockResolvedValue(null);
    expect(await requestDatasetDerivation(1, {}, 'difference', ['r1:c2', 'r2:c2'])).toEqual({ ok: false, reason: 'this dataset is not available' });
    expect(getDataset).toHaveBeenCalledTimes(1);
  });
});
