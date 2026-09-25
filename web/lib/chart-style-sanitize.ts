// Own-data publish (ADR 057, session 128) — pulled out of
// web/app/chart-style-actions.ts: that file's own header explains why its
// copy of this allow-list (`sanitizeOverridesStrict`, backed by zod) has to
// stay OUT of chart.tsx's import graph (~382 KB of zod, session 110 landing-
// bundle pass), and own-chart-publish-actions.ts (also a `'use server'`
// Server Action module, never bundled to the client) now needs the SAME
// validator to freeze the author's account style into a publication row at
// publish time (session 128 ruling 1: "never store unvalidated JSON" —
// reusing this schema rather than trusting a historical `saveMyChartStyle`
// call to have already run it). Moving it here — a plain, non-`'use server'`
// module, the same `publication-source-line.ts` precedent — lets BOTH
// `'use server'` files import the identical validator without either
// re-exporting a sync function through its own server-action boundary
// (Next's server-boundary check refuses that at `next build` time, the exact
// trap `normalizeSourceLine` was pulled out for).
//
// STILL NOT SAFE for a client component to import: it pulls in zod. Nothing
// outside a server-only module (a `'use server'` file, a Server Component)
// should ever import this file — chart.tsx's own render path keeps using
// `sanitizeOverrides` in lib/chart-presentation.ts (the zod-free twin with
// IDENTICAL semantics, pinned together by chart-style-actions.test.ts).
import { z } from 'zod';
import { HEX_COLOR, FONT_FAMILY_NAME, type PresentationOverrides } from './chart-presentation.ts';

const hexSchema = z.string().transform((s) => s.toLowerCase()).pipe(z.string().regex(HEX_COLOR));
const frameBackgroundSchema = z.union([
  z.literal('none'),
  z.object({ kind: z.literal('solid'), hex: hexSchema }).strict(),
  z.object({ kind: z.literal('gradient'), from: hexSchema, to: hexSchema }).strict(),
  z.object({ kind: z.literal('image') }).strict(),
]);
const overridesSchema = z.object({
  lineWidth: z.enum(['thin', 'normal', 'thick', 'extraThick']).optional(),
  markers: z.enum(['all', 'ends', 'provisionalOnly']).optional(),
  grid: z.enum(['both', 'horizontal', 'none']).optional(),
  xLabels: z.enum(['flat', 'tilted']).optional(),
  axisLines: z.enum(['shown', 'hidden']).optional(),
  valueLabels: z.enum(['shown', 'hidden']).optional(),
  zeroBaseline: z.enum(['auto', 'zero']).optional(),
  areaFill: z.enum(['gradient', 'flat']).optional(),
  pieHole: z.enum(['none', 'donut']).optional(),
  seriesColors: z.record(z.string(), z.unknown()).optional(),
  fontFamily: z.string().regex(FONT_FAMILY_NAME).nullable().optional(),
  language: z.enum(['nl', 'en']).nullable().optional(),
  frameBackground: frameBackgroundSchema.optional(),
  framePadding: z.enum(['none', 'small', 'medium', 'large']).optional(),
  frameCorners: z.enum(['square', 'rounded', 'veryRounded']).optional(),
  frameShadow: z.enum(['none', 'soft', 'strong']).optional(),
  frameInset: z.enum(['none', 'small', 'large']).optional(),
  frameAspect: z.enum(['auto', '16:9', '4:5', '1:1', '1.91:1']).optional(),
});

/** Allow-list parse of anything claiming to be overrides (a reducer patch, a
 * stored row, a browser-submitted patch). Unknown keys, wrong enum values,
 * malformed colours and non-numeric series indexes are DROPPED, never
 * thrown on. */
export function sanitizeOverridesStrict(raw: unknown): PresentationOverrides {
  if (raw === null || typeof raw !== 'object') return {};
  const out: PresentationOverrides = {};
  for (const key of Object.keys(overridesSchema.shape) as (keyof PresentationOverrides)[]) {
    if (!(key in raw)) continue;
    const parsed = overridesSchema.pick({ [key]: true } as never).safeParse({ [key]: (raw as Record<string, unknown>)[key] });
    if (!parsed.success) continue;
    const value = (parsed.data as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (key === 'seriesColors') {
      const colors: Record<number, string> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const index = /^\d+$/.test(k) ? Number(k) : NaN;
        const hex = hexSchema.safeParse(v);
        if (Number.isInteger(index) && hex.success) colors[index] = hex.data;
      }
      out.seriesColors = colors;
    } else {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}
