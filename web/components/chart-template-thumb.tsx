// ADR 043: a template's thumbnail, DERIVED from its resolved presentation
// values — never hand-drawn per template, so it cannot drift from what the
// template actually applies. Digit-free by construction (no <text>), hidden
// from assistive tech (the card's own name/description carry the meaning).
import type { ReactNode } from 'react';
import {
  FRAME_CORNER_PX,
  FRAME_GRADIENT_ANGLE,
  resolvePresentation,
  seriesColor,
} from '../lib/chart-presentation.ts';
import type { ChartTemplate } from '../lib/chart-templates.ts';

const W = 64;
const H = 40;
// One fixed, plausible polyline — five points, a rise, a dip, a rise.
const POINTS: [number, number][] = [
  [8, 30],
  [20, 22],
  [32, 26],
  [44, 14],
  [56, 10],
];

export function TemplateThumb({ template }: { template: ChartTemplate }): ReactNode {
  const values = resolvePresentation({ kind: 'line', form: 'line', seriesCount: 1, hasProvisional: false }, template.overrides).values;
  const colour = seriesColor(values, 0);
  const bg = values.frameBackground;
  const inset = values.frameInset !== 'none';
  const corner = Math.round(FRAME_CORNER_PX[values.frameCorners] / 4);
  const gradientId = `thumb-${template.id}-bg`;
  const plotTop = 6;
  const plotBottom = 34;
  const plotLeft = 6;
  const plotRight = 58;
  const visible = (i: number): boolean => {
    if (values.markers === 'all') return true;
    if (values.markers === 'ends') return i === 0 || i === POINTS.length - 1;
    return false;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" data-template-thumb={template.id}>
      {bg !== 'none' && bg.kind === 'gradient' ? (
        <defs>
          <linearGradient id={gradientId} gradientTransform={`rotate(${FRAME_GRADIENT_ANGLE - 90})`}>
            <stop offset="0" stopColor={bg.from} />
            <stop offset="1" stopColor={bg.to} />
          </linearGradient>
        </defs>
      ) : null}
      <rect
        x={0}
        y={0}
        width={W}
        height={H}
        rx={corner}
        fill={bg === 'none' || bg.kind === 'image' ? 'var(--card)' : bg.kind === 'solid' ? bg.hex : `url(#${gradientId})`}
        stroke="var(--border)"
        data-thumb="frame"
      />
      {inset ? <rect x={4} y={4} width={W - 8} height={H - 8} rx={corner} fill="var(--card)" data-thumb="card" /> : null}
      {values.grid !== 'none' ? (
        <>
          <line x1={plotLeft} x2={plotRight} y1={plotTop + 4} y2={plotTop + 4} stroke="var(--border)" data-thumb="grid-h" />
          <line x1={plotLeft} x2={plotRight} y1={plotBottom - 6} y2={plotBottom - 6} stroke="var(--border)" data-thumb="grid-h" />
        </>
      ) : null}
      {values.grid === 'both'
        ? [20, 32, 44].map((x) => <line key={x} x1={x} x2={x} y1={plotTop} y2={plotBottom} stroke="var(--border)" data-thumb="grid-v" />)
        : null}
      {values.axisLines === 'shown' ? (
        <>
          <line x1={plotLeft} x2={plotLeft} y1={plotTop} y2={plotBottom} stroke="var(--muted-foreground)" data-thumb="axis" />
          <line x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} stroke="var(--muted-foreground)" data-thumb="axis" />
        </>
      ) : values.grid !== 'none' ? (
        <line x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} stroke="var(--border)" data-thumb="baseline" />
      ) : null}
      <polyline
        points={POINTS.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke={colour}
        strokeWidth={values.lineWidth === 'thick' || values.lineWidth === 'extraThick' ? 2.5 : 1.5}
        strokeLinejoin="round"
        data-thumb="line"
      />
      {POINTS.map(([x, y], i) => (visible(i) ? <circle key={i} cx={x} cy={y} r={2} fill={colour} data-thumb="point" /> : null))}
    </svg>
  );
}
