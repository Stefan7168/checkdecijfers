// #260 (session 129): rounded bar corners — only the end AWAY from zero is
// rounded (the baseline side stays square, ADR 042's "never float a bar off
// zero" refusal), and a provisional bar keeps its square hatched outline.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { barClipId, roundedBarClipPath, SeriesBar } from './chart-parts.tsx';

describe('roundedBarClipPath', () => {
  it('rounds the top corners of an upward bar and keeps the baseline corners square', () => {
    const d = roundedBarClipPath(10, 20, 30, 100, 'top')!;
    // Starts and ends on the baseline corners with straight segments.
    expect(d.startsWith('M10,120L10,24')).toBe(true);
    expect(d).toContain('L40,120Z');
    // The two curves sit on the top edge (y = 20).
    expect(d).toContain('Q10,20 14,20');
    expect(d).toContain('Q40,20 40,24');
  });

  it('rounds the bottom corners of a downward (negative) bar; the top edge (the baseline) is straight', () => {
    const d = roundedBarClipPath(10, 20, 30, 100, 'bottom')!;
    expect(d.startsWith('M10,20L40,20')).toBe(true);
    expect(d).toContain('Q40,120 36,120');
  });

  it('rounds only the right end of a horizontal bar', () => {
    const d = roundedBarClipPath(0, 0, 200, 16, 'right')!;
    expect(d.startsWith('M0,0L196,0')).toBe(true);
    expect(d).toContain('L0,16Z');
  });

  it('caps the radius at half the bar and draws nothing for a sliver', () => {
    expect(roundedBarClipPath(0, 0, 4, 100, 'top')).toContain('Q0,0 2,0');
    expect(roundedBarClipPath(0, 0, 0.5, 100, 'top')).toBeNull();
  });

  it('normalises a negative height to the true rectangle', () => {
    expect(roundedBarClipPath(10, 120, 30, -100, 'bottom')).toBe(roundedBarClipPath(10, 20, 30, 100, 'bottom'));
  });

  it('builds DOM-safe ids', () => {
    expect(barClipId('hatch-:r1:-s0', 'clip', '2024JJ00')).toBe('hatch-_r1_-s0-clip-2024JJ00');
  });
});

function renderBar(value: number, provisional: boolean) {
  const payload = {
    periodCode: '2024JJ00',
    periodLabel: '2024',
    s0: value,
    s0_provisional: provisional,
    s0_resultId: 'cell-1',
  } as never;
  const Shape = SeriesBar('s0', '#0072b2', 'hatch-x-s0', new Map());
  return render(
    <svg>
      <Shape x={10} y={20} width={30} height={100} payload={payload} />
    </svg>,
  );
}

describe('SeriesBar corners', () => {
  it('a final bar is clipped by its own rounded outline; the rect itself is unchanged', () => {
    const { container } = renderBar(5, false);
    const rect = container.querySelector('rect[data-point="value"]')!;
    expect(rect.getAttribute('width')).toBe('30');
    const clip = rect.getAttribute('clip-path');
    expect(clip).toBe('url(#hatch-x-s0-clip-2024JJ00)');
    const path = container.querySelector('clipPath#hatch-x-s0-clip-2024JJ00 path')!;
    expect(path.getAttribute('d')).toBe(roundedBarClipPath(10, 20, 30, 100, 'top'));
  });

  it('a negative bar rounds its bottom end', () => {
    const { container } = renderBar(-5, false);
    const path = container.querySelector('clipPath path')!;
    expect(path.getAttribute('d')).toBe(roundedBarClipPath(10, 20, 30, 100, 'bottom'));
  });

  it('a provisional bar stays square (hatch + full outline, R11)', () => {
    const { container } = renderBar(5, true);
    const rect = container.querySelector('rect[data-point="value"]')!;
    expect(rect.getAttribute('clip-path')).toBeNull();
    expect(container.querySelector('clipPath')).toBeNull();
    expect(rect.getAttribute('stroke-width')).toBe('1');
  });
});
