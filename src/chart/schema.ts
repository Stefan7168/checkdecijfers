// Chart-spec zod schema — the runtime half of the v1 contract (ADR 008:
// zod is the single schema layer; validated result objects, chart specs and
// forms all validate through the same layer). Stored specs live forever in
// audit records (ADR 007), so anything reading one back — WP10's audit
// reconstruction, future page renderers — parses through this schema rather
// than trusting the blob. strictObject throughout: an unknown field in a
// stored spec is corruption, not extensibility (new fields arrive via new
// schema versions).
import { z } from 'zod';

const chartPointSchema = z.strictObject({
  resultId: z.string().min(1),
  periodCode: z.string().min(1),
  periodLabel: z.string().min(1),
  value: z.number().nullable(),
  formattedValue: z.string().min(1).nullable(),
  decimals: z.number().int().nonnegative(),
  status: z.string().min(1),
  provisional: z.boolean(),
  valueAttribute: z.string().min(1),
});

const chartSeriesSchema = z.strictObject({
  label: z.string().min(1),
  regionCode: z.string().min(1).nullable(),
  points: z.array(chartPointSchema).min(1),
});

const chartAttributionSchema = z.strictObject({
  tableId: z.string().min(1),
  tableTitle: z.string().min(1),
  tableVersion: z.number().int(),
  syncedAt: z.string().min(1),
  coveredPeriods: z.strictObject({ from: z.string().min(1), to: z.string().min(1) }),
  license: z.literal('CC BY 4.0'),
  trendHeadline: z.string().min(1).optional(),
});

// #170(4): curated event markers (metadata about WHEN something happened,
// never a data value) — structurally validated like every other spec field,
// but kept OPTIONAL so every spec stored before this field existed (R8: those
// rows live forever) still parses unchanged. `buildChartSpec` itself never
// sets this key; only the Ontdek curated path does (src/chart/annotations.ts).
const chartAnnotationSchema = z.strictObject({
  periodCode: z.string().min(1),
  label: z.string().min(1),
});

// Phase 5b (the verified whole): a faithful, minimal zod mirror of the
// `RegionScope` union in src/query/types.ts — all FOUR variants, including
// `all_gemeenten` (which has no verified-whole concept but is still a real
// scope a chart can be built from; this field records provenance, it does not
// pre-filter to the verifiable ones). strictObject per variant, so a `parent`
// on a scope that has none, or a missing `parent` on the one that needs it,
// is rejected exactly as the TypeScript union would reject it. Kept OPTIONAL
// on the spec (below) for the same reason `annotations`/`trendHeadline` are:
// every spec stored before this field existed still parses unchanged; a
// present key must be either a valid scope or an explicit `null`.
const regionScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('all_provincies') }),
  z.strictObject({ kind: z.literal('all_landsdelen') }),
  z.strictObject({ kind: z.literal('all_gemeenten') }),
  z.strictObject({ kind: z.literal('gemeenten_in_provincie'), parent: z.string().min(1) }),
]);

export const chartSpecSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.enum(['line', 'bar']),
    title: z.string().min(1),
    dims: z.record(z.string(), z.string()),
    dimLabels: z.record(z.string(), z.string()),
    unit: z.string().min(1),
    series: z.array(chartSeriesSchema).min(1),
    provisionalNote: z.string().min(1).nullable(),
    nullNotes: z.array(z.string().min(1)),
    definitionLine: z.string().min(1).nullable(),
    attributionLine: z.string().min(1),
    attribution: chartAttributionSchema,
    annotations: z.array(chartAnnotationSchema).optional(),
    regionScope: regionScopeSchema.nullable().optional(),
  })
  // A point's display string and its value must be null together — a value
  // without display text (or text without a value) is a malformed spec.
  .refine(
    (spec) =>
      spec.series.every((s) =>
        s.points.every((p) => (p.value === null) === (p.formattedValue === null)),
      ),
    { message: 'formattedValue must be null exactly when value is null' },
  );

export type ParsedChartSpec = z.infer<typeof chartSpecSchema>;
