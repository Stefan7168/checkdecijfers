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
});

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
