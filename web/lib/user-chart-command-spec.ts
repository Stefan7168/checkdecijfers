// Own-data publish (ADR 057, session 127, Task 2): a pure move of
// user-chart.tsx's private toCommandSpec/instructionKey out to a
// component-free module so the server-side replay
// (own-chart-publication.ts) can share the EXACT same command-validation
// adapter and cache key the reader's own card uses — no second, drifting
// copy of either function. Verbatim bodies + doc comments; no behaviour
// change (user-chart.tsx now imports both from here).
import type { CommandContext } from './chart-commands.ts';
import type { ClientChartInstruction, UserChartSpec } from '../backend/attachments/types.ts';

/** The command validator (chart-commands.ts) reads only `kind`, the series
 * INDEX, `periodCode` and `resultId`; it never touches a CBS-only field. Its
 * parameter type is nevertheless `Pick<ChartSpec, 'kind' | 'series'>`, so
 * this maps the own-data spec onto that interface with inert placeholders for
 * the CBS metadata it demands and nothing reads. D11 is untouched: the result
 * is missing every OTHER ChartSpec field (title, dims, unit, attribution, …),
 * so it still cannot be handed to `ChartView` or to any CBS builder — it
 * exists only inside `validateCommand`. */
export function toCommandSpec(spec: UserChartSpec): CommandContext['spec'] {
  return {
    kind: spec.kind,
    series: spec.series.map((series) => ({
      label: series.label,
      regionCode: null,
      points: series.points.map((point) => ({
        resultId: point.rowRef,
        periodCode: point.xKey,
        periodLabel: point.xLabel,
        value: point.value,
        formattedValue: point.formattedValue,
        decimals: 0,
        status: '',
        provisional: false,
        valueAttribute: '',
      })),
    })),
  };
}

/** The rendered-spec cache's key. An instruction is a small, flat, closed-
 * vocabulary object, so its JSON is a sound identity — and it is the same
 * value the doorways hand us, never a derived label. */
export function instructionKey(instruction: ClientChartInstruction | null): string {
  return JSON.stringify(instruction);
}
