// Own-data publish (ADR 057, session 127): rebuild a published own-data
// chart on the server from its stored command log, and prune it for an
// anonymous visitor. Rebuilding uses ONLY the building blocks the card
// itself uses (replayLog + validateCommand, renderInstructionForDataset,
// deriveChartOverlay) — no new code computes a number, so U1/U5/U6 hold by
// reuse. pruneForPublic is the single enforcement point of invariant P1
// (docs/05-data-rules.md): read the spec §3.5 before changing it.
import {
  deriveChartOverlay,
  OverlaySelectionError,
  type ResolvedOverlay,
} from '../backend/attachments/derive-overlay.ts';
import { NoRowsError, TooManyPointsError } from '../backend/attachments/execute.ts';
import { InstructionValidationError, validateInstructionObject } from '../backend/attachments/instruct/schema.ts';
import { renderInstructionForDataset } from '../backend/attachments/render.ts';
import {
  toClientInstruction,
  upgradeInstruction,
  type ChartInstruction,
  type DatasetTurnRecord,
  type UserChartSpec,
  type UserDataset,
} from '../backend/attachments/types.ts';
import { replayLog } from './chart-history.ts';
import {
  initialDocState,
  parseCommandLog,
  type ChartCommand,
  type ChartDocState,
  type CommandContext,
  type DerivedOverlayRequest,
  type EraShading,
  type GoalLine,
} from './chart-commands.ts';
import { defaultFormFor, type ChartForm } from './chart-view-state.ts';
import type { PresentationOverrides } from './chart-presentation.ts';
import type { ChartNote } from '../components/chart-notes.tsx';
import { instructionKey, toCommandSpec } from './user-chart-command-spec.ts';

/** JSON-safe (no Set) — crosses the server→client boundary. Deliberately
 * NOT `ChartDocState`: it drops `instruction` (a full server-shape object,
 * never sent to an anonymous visitor), `periodRange` and `selectedReading`
 * (own-data has neither — chart-commands.ts's `validateCommand` already
 * refuses a non-null `setPeriodRange` on an own-data context) and
 * `wholeReferenceRowRef` (v1: the verified-whole designation is an
 * author-only affordance, cleared on publish per the spec). */
export interface PublicChartState {
  form: ChartForm;
  hiddenKeys: string[];
  dimmedKeys: string[];
  highlightedKey: string | null;
  presentation: PresentationOverrides;
  notes: ChartNote[];
  title: string | null;
  caption: string | null;
  goalLines: GoalLine[];
  eraShadings: EraShading[];
  headlineOverrideResultId: string | null;
  derivedOverlayRequests: DerivedOverlayRequest[];
}

export interface PublicOwnChart {
  spec: UserChartSpec; // pruned; provenance scrubbed (see pruneForPublic)
  state: PublicChartState;
  overlays: Record<string, ResolvedOverlay>; // keyed by DerivedOverlayRequest.id
  sourceLine: string | null;
}

export type BuildPublishedChartResult =
  | { ok: true; state: ChartDocState; spec: UserChartSpec; dataset: UserDataset; dropped: number }
  | { ok: false; reason: 'not_chart' | 'invalid_log' | 'render_failed' };

/** Fix round 1 (I3): a bare `typeof kind === 'string'` shape check let a
 * well-shaped-but-incomplete command (e.g. `{ kind: 'addNote' }`, missing
 * `note`) reach `validateCommand`/`applyCommand`, which read its other
 * fields unconditionally and throw a TypeError instead of a reachable
 * refusal. `chart-commands.ts` already exports the real per-command zod
 * schema for exactly this: parsing a single-entry array through it is the
 * same "is this a real ChartCommand" check the card's own stored-log
 * hydration runs, so a stale/malformed log entry is counted as dropped
 * here exactly as it would be there, never a thrown error. */
function parseLogEntry(entry: unknown): ChartCommand | undefined {
  return parseCommandLog([entry])?.[0];
}

/** Mirrors web/app/dataset-derivation-actions.ts's private
 * toValidatableInstruction (itself a copy of render.ts's own private
 * toServerShape) — fills the server-only fields a ClientChartInstruction
 * never carries. TOTAL over unknown input: a malformed value falls through
 * to validateInstructionObject's own schema refusal, never throws here. */
function toValidatableInstruction(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const o = raw as Record<string, unknown>;
  const unsupported = o.unsupported;
  return {
    ...o,
    confidence: 1,
    reading: '',
    ...(unsupported !== null && typeof unsupported === 'object'
      ? { unsupported: { ...(unsupported as Record<string, unknown>), detail: '' } }
      : {}),
  };
}

/**
 * Rebuild an own-data chart's current state by replaying its stored command
 * log over the chart as it was FIRST made from the audited instruction
 * (`turn.instruction`) — the same replay path a reader's own card runs
 * (`replayLog` + `validateCommand`), so a command that could never have
 * applied to this chart is dropped here exactly as it would be there, never
 * silently accepted. A structurally-invalid log entry (not command-shaped
 * at all) is ALSO counted as dropped, so `dropped` covers both "the log was
 * garbage" and "the log named something no longer true of this chart".
 */
export function buildPublishedChart(dataset: UserDataset, turn: DatasetTurnRecord, log: unknown): BuildPublishedChartResult {
  if (turn.kind !== 'chart' || !turn.chartEmitted || turn.instruction === null) return { ok: false, reason: 'not_chart' };
  if (!Array.isArray(log)) return { ok: false, reason: 'invalid_log' };

  const first = renderInstructionForDataset(dataset, turn.instruction);
  if (first.kind !== 'ok') return { ok: false, reason: 'render_failed' };
  // Fix round 1 (M6): the card never hydrates a raw stored instruction
  // as-is — replay.ts's own `assistantMessage` upgrades it first
  // (`upgradeInstruction(envelope.state.lastInstruction)`) before it ever
  // becomes `state.instruction`/a cache key on the client. A pre-v2 stored
  // row lacks the `aggregate`/`derived` keys entirely, so an un-upgraded
  // `toClientInstruction` result would JSON-stringify to a DIFFERENT key
  // than the same instruction upgraded — matching the card's own hydration
  // step here keeps this cache's keys identical to the ones a real card
  // would compute for the same stored data.
  const firstInstruction = toClientInstruction(upgradeInstruction(turn.instruction) as ChartInstruction);

  const cache = new Map<string, UserChartSpec>([[instructionKey(firstInstruction), first.chart]]);
  let garbage = 0;
  const commands: ChartCommand[] = [];
  for (const entry of log) {
    const parsed = parseLogEntry(entry);
    if (parsed === undefined) {
      garbage++;
      continue;
    }
    commands.push(parsed);
    if (parsed.kind === 'setInstruction') {
      const key = instructionKey(parsed.instruction);
      if (!cache.has(key)) {
        const outcome = renderInstructionForDataset(dataset, parsed.instruction);
        if (outcome.kind === 'ok') cache.set(key, outcome.chart);
      }
    }
  }

  // Same initial state + ctx the card builds (user-chart.tsx's own mount
  // effect): the cache is looked up fresh per command so a `setInstruction`
  // earlier in the log changes which spec every LATER command validates
  // against (chart-history.ts's own `ReplayContext` function form exists
  // for exactly this).
  const initial = initialDocState(defaultFormFor(toCommandSpec(first.chart)), {}, firstInstruction);
  const ctx = (state: ChartDocState): CommandContext => ({
    spec: toCommandSpec(cache.get(instructionKey(state.instruction)) ?? first.chart),
    alternatesCount: 0,
    profile: dataset.profile,
  });
  const { state, dropped } = replayLog(initial, commands, ctx);
  const spec = cache.get(instructionKey(state.instruction));
  if (spec === undefined) return { ok: false, reason: 'render_failed' };
  return { ok: true, state, spec, dataset, dropped: dropped + garbage };
}

/**
 * The single enforcement point of invariant P1 (docs/05-data-rules.md): a
 * hidden series' label/value/source text, the dataset's own file name/
 * source url/content hash/raw cells/profile, and the reader's command log
 * itself must never reach an anonymous visitor. A hidden series' SLOT is
 * kept (blanked, not removed) so the remaining series' keys/colours never
 * shift; anything anchored to a hidden point (a note, an overlay touching
 * it, the headline override, the highlight) is dropped rather than shown
 * against a blank.
 */
export function pruneForPublic(built: Extract<BuildPublishedChartResult, { ok: true }>, sourceLine: string | null): PublicOwnChart {
  const { state, spec, dataset } = built;
  const hidden = new Set(state.hiddenKeys);
  // Fix round 1 (C2): mirrors user-chart.tsx's own `plottedRowRefs` (the
  // card filters a stale note the SAME way, at render — every rowRef the
  // FINAL spec plots, hidden or not). A `setInstruction` reset can drop a
  // rowRef out of the chart entirely (a filter/column change), and
  // `blankedRefs` below only ever knows about points that are STILL on the
  // current chart but hidden — it says nothing about a rowRef from a PRIOR
  // instruction that the final spec no longer plots at all. Built from the
  // spec BEFORE blanking, so a still-plotted-but-hidden point is counted
  // here too (blankedRefs is checked separately below to still drop it).
  const plottedRowRefs = new Set(spec.series.flatMap((s) => s.points.map((p) => p.rowRef)));
  const blankedRefs = new Set<string>();
  const series = spec.series.map((s, i) => {
    if (!hidden.has(`s${i}`)) return s;
    for (const p of s.points) blankedRefs.add(p.rowRef);
    return {
      label: '',
      points: s.points.map((p) => ({ rowRef: p.rowRef, xKey: p.xKey, xLabel: p.xLabel, value: null, formattedValue: null, sourceText: '' })),
    };
  });
  // Fix round 2 (C1, correcting fix round 1's wrong assumption): `yHeaders`
  // is always built straight from `instruction.y` — a fixed, sort/limit-
  // blind column order (chart.ts ~135-140). `series`, however, is grouped
  // by first-appearance order over `executeInstruction`'s OWN returned
  // points — and those points are sorted (and possibly `limit`-sliced)
  // BEFORE chart.ts ever groups them (execute.ts ~545-550: `sortPoints`
  // then an optional `.slice(0, limit)` run over ALL series' points
  // together, then chart.ts's `bySeries` Map takes first-appearance order
  // over THAT already-reordered list). A `sort: { by: 'value' }` can
  // freely interleave which y-column's points appear first, so `series[i]`
  // and `yHeaders[i]` are NOT guaranteed to name the same column by
  // POSITION — position-based blanking (fix round 1's bug) can both leak a
  // hidden column's header (wrong index) and wrongly blank a still-visible
  // one. Matching by LABEL instead is index-order-independent: `aggregate`
  // wraps both a series' `label` and its `yHeaders` entry in the SAME
  // `aggregateLabel(fn, header)` text (chart.ts ~127-140), so the two still
  // compare equal; `derived` collapses `series`/`yHeaders` to one shared
  // entry each, so the label the derived series carries after prune-time
  // blanking is checked the same way. A `limit` can drop an ENTIRE
  // y-column's series (none of its points survive the slice) without it
  // ever becoming a `series[i]` at all — that header names nothing
  // currently drawn, so it is blanked too (`!visibleLabels.has(h)`), not
  // only headers belonging to a still-present-but-hidden series
  // (`hiddenLabels.has(h)`). With a seriesBy set, every series instead
  // shares the SAME single y column (`yHeaders` has one entry for all of
  // them), so hiding one series never isolates a header unique to it —
  // nothing to scrub there.
  const seriesByNull = state.instruction !== null && state.instruction.seriesBy === null;
  let yHeaders = spec.yHeaders;
  if (seriesByNull) {
    const hiddenLabels = new Set<string>();
    const visibleLabels = new Set<string>();
    spec.series.forEach((s, i) => (hidden.has(`s${i}`) ? hiddenLabels : visibleLabels).add(s.label));
    yHeaders = spec.yHeaders.map((h) => (hiddenLabels.has(h) || !visibleLabels.has(h) ? '' : h));
  }
  const prunedSpec: UserChartSpec = {
    ...spec,
    yHeaders,
    series,
    provenance: { ...spec.provenance, datasetId: 0, displayName: '', sourceUrlHost: null, contentSha256: '' },
  };
  const overlayRequests = state.derivedOverlayRequests.filter((r) =>
    r.resultIds.every((id) => plottedRowRefs.has(id) && !blankedRefs.has(id)),
  );
  const overlays: Record<string, ResolvedOverlay> = {};
  if (state.instruction !== null) {
    let instruction: ReturnType<typeof validateInstructionObject> | null = null;
    try {
      instruction = validateInstructionObject(toValidatableInstruction(upgradeInstruction(state.instruction)), dataset.profile);
    } catch (e) {
      if (!(e instanceof InstructionValidationError)) throw e;
    }
    if (instruction !== null) {
      for (const r of overlayRequests) {
        try {
          overlays[r.id] = deriveChartOverlay(dataset, instruction, { calcKind: r.calcKind, resultIds: r.resultIds });
        } catch (e) {
          // A refused overlay is simply not drawn on the public page (the
          // author's card shows the refusal text; the public page never
          // shows error copy). Narrowed to the three reachable throw
          // classes (derive-overlay.ts's own OverlaySelectionError, plus
          // execute.ts's NoRowsError/TooManyPointsError it can propagate
          // via executeInstruction) so an unrelated programming error still
          // surfaces instead of being swallowed here.
          if (!(e instanceof OverlaySelectionError) && !(e instanceof NoRowsError) && !(e instanceof TooManyPointsError)) throw e;
        }
      }
    }
  }
  return {
    spec: prunedSpec,
    state: {
      form: state.form,
      hiddenKeys: [...state.hiddenKeys],
      dimmedKeys: [...state.dimmedKeys],
      highlightedKey: state.highlightedKey !== null && hidden.has(state.highlightedKey) ? null : state.highlightedKey,
      presentation: state.presentation,
      notes: state.notes.filter((n) => plottedRowRefs.has(n.resultId) && !blankedRefs.has(n.resultId)),
      title: state.title,
      caption: state.caption,
      goalLines: state.goalLines,
      eraShadings: state.eraShadings,
      headlineOverrideResultId:
        state.headlineOverrideResultId !== null && plottedRowRefs.has(state.headlineOverrideResultId) && !blankedRefs.has(state.headlineOverrideResultId)
          ? state.headlineOverrideResultId
          : null,
      derivedOverlayRequests: overlayRequests,
    },
    overlays,
    sourceLine,
  };
}
