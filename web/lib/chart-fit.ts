// Phase 5 (chart-fit scorer, session 116, owner "Split" decision — ADR 039's
// refusal of pie/donut/stacked/100%/scatter is UNCHANGED, see
// docs/superpowers/specs/2026-09-17-chart-copilot-design.md §10). The ONE
// place "is this shape honestly offered for this chart" is answered — both
// the on-screen tab switcher (chart.tsx) and the chat co-pilot's
// allowed-shapes list (chart-capabilities.ts) call this instead of each
// keeping their own hand-written copy of the same list, so the two can
// never disagree about what's on offer. No model, no cost, pure functions
// over the spec already on screen — nothing here computes a NEW number.
import type { ChartSpec } from '../backend/chart/types.ts';
import {
  areaFormAllowed,
  dumbbellFormAllowed,
  hbarFormAllowed,
  heatmapFormAllowed,
  lineFormAllowed,
  slopeFormAllowed,
  type ChartForm,
  type SeriesShape,
} from './chart-view-state.ts';

/**
 * Every shape currently honestly offered for `spec`, in the app's fixed
 * display order. `bar` and `table` are never gated (pre-existing
 * convention). The three phase-5 shapes trail the original five so the
 * five keep their familiar, already-shipped tab order and positions.
 * `spec` is typed on the structural minimum (chart-view-state.ts's
 * `SeriesShape`) so a full ChartSpec and chart.tsx's PlottableSpec both fit.
 */
export function allowedForms(spec: Pick<ChartSpec, 'kind'> & SeriesShape, seriesCount: number): ChartForm[] {
  const forms: ChartForm[] = [];
  if (lineFormAllowed(spec, seriesCount)) forms.push('line');
  if (areaFormAllowed(spec, seriesCount)) forms.push('area');
  forms.push('bar');
  if (hbarFormAllowed(spec)) forms.push('hbar');
  forms.push('table');
  if (dumbbellFormAllowed(spec, seriesCount)) forms.push('dumbbell');
  if (slopeFormAllowed(spec, seriesCount)) forms.push('slope');
  if (heatmapFormAllowed(spec, seriesCount)) forms.push('heatmap');
  return forms;
}
