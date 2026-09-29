import { describe, expect, it } from 'vitest';
import { DENSE_LABEL_POINTS, lastLabelIndex } from './user-chart-parts.tsx';

describe('lastLabelIndex — dense lines label only their last point', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ a: i, b: i < n - 2 ? i : null }));
  it('labels every point of a sparse chart', () => {
    expect(lastLabelIndex(rows(DENSE_LABEL_POINTS), 'a')).toBeUndefined();
  });
  it('picks the last non-empty point of each series once the chart is dense', () => {
    const dense = rows(DENSE_LABEL_POINTS + 8);
    expect(lastLabelIndex(dense, 'a')).toBe(dense.length - 1);
    expect(lastLabelIndex(dense, 'b')).toBe(dense.length - 3);
  });
  it('returns undefined for a series with no points at all', () => {
    expect(lastLabelIndex(rows(30), 'zzz')).toBeUndefined();
  });
});
