import { describe, expect, it, vi } from 'vitest';
import { resolveDerivedOverlays } from './chart-derived-overlay.ts';

describe('resolveDerivedOverlays', () => {
  it('resolves every pending request and keys the results by overlay id', async () => {
    const requester = vi.fn().mockResolvedValue({ ok: true, record: { kind: 'difference', value: 5, sourceResultIds: ['r1', 'r2'], unit: '', marking: 'CC BY', explicit: true, minuendResultId: 'r2', subtrahendResultId: 'r1' } });
    const results = await resolveDerivedOverlays(
      [{ id: 'd1', calcKind: 'difference', resultIds: ['r1', 'r2'] }],
      requester,
    );
    expect(requester).toHaveBeenCalledWith('difference', ['r1', 'r2']);
    expect(results.get('d1')).toEqual({ kind: 'difference', value: 5, sourceResultIds: ['r1', 'r2'], unit: '', marking: 'CC BY', explicit: true, minuendResultId: 'r2', subtrahendResultId: 'r1' });
  });

  it('a refused request is simply absent from the result map, never a thrown error', async () => {
    const requester = vi.fn().mockResolvedValue({ ok: false, reason: 'nope' });
    const results = await resolveDerivedOverlays([{ id: 'd1', calcKind: 'mean', resultIds: ['r1', 'r2'] }], requester);
    expect(results.has('d1')).toBe(false);
  });
});
