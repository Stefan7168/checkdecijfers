// Chart module surface (WP8, ADR 007/014): deterministic spec builder +
// dumb SVG renderer + the runtime schema for stored specs.
export { buildChartSpec, PROVISIONAL_NOTE } from './build.ts';
export { buildCuratedCharts, ONTDEK_CHARTS, periodStepsBack } from './curated.ts';
export type { CuratedChart, CuratedChartDefinition, CuratedChartsOutcome } from './curated.ts';
export { renderChartSvg } from './render.ts';
export type { RenderChartOptions } from './render.ts';
export { chartSpecSchema } from './schema.ts';
export type { ParsedChartSpec } from './schema.ts';
export { CHART_SPEC_VERSION } from './types.ts';
export type { ChartAttribution, ChartPoint, ChartSeries, ChartSpec } from './types.ts';
