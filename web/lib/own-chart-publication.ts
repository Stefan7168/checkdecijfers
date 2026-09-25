// Own-data publish (ADR 057, session 127): rebuild a published own-data
// chart on the server from its stored command log, and prune it for an
// anonymous visitor. Rebuilding uses ONLY the building blocks the card
// itself uses (replayLog + validateCommand, renderInstructionForDataset,
// deriveChartOverlay) — no new code computes a number, so U1/U5/U6 hold by
// reuse. pruneForPublic is the single enforcement point of invariant P1
// (docs/05-data-rules.md): read the spec §3.5 before changing it.
//
// Session 128 security-review fix wave (#322; docs/superpowers/specs/
// 2026-09-25-own-data-publish-security-review.md): every public point is
// re-keyed to an opaque id (I-1), a hidden slot is one blank point per
// visible category in visible order (I-2), note labels are rebuilt from the
// final public spec (M-1), and the log and overlay count are capped, with
// every overlay resolved from ONE point map per request (I-4 a/b).
import {
  allResolvedPoints,
  OverlaySelectionError,
  overlayFromResolvedPoints,
  type ResolvedOverlay,
  type ResolvedPoint,
} from '../backend/attachments/derive-overlay.ts';
import { NoRowsError, TooManyPointsError } from '../backend/attachments/execute.ts';
import { InstructionValidationError, validateInstructionObject } from '../backend/attachments/instruct/schema.ts';
import { renderInstructionForDataset } from '../backend/attachments/render.ts';
import {
  toClientInstruction,
  upgradeInstruction,
  type ChartInstruction,
  type DatasetTurnRecord,
  type UserChartPoint,
  type UserChartSpec,
  type UserDataset,
} from '../backend/attachments/types.ts';
import { replayLog } from './chart-history.ts';
import {
  initialDocState,
  parseCommandLog,
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
  | { ok: false; reason: 'not_chart' | 'invalid_log' | 'render_failed' | 'too_many_overlays' };

/** Session 128 (#322 I-4a): the most derived overlays a published chart may
 * carry. Each one the public page draws is a lookup in the point map
 * pruneForPublic builds once per request, but the count still bounds that
 * per-view work and the payload — checked in buildPublishedChart, so the
 * publish action (-> 'invalid') and the public page (-> "not available")
 * enforce the SAME limit. */
export const PUBLIC_OVERLAY_MAX = 20;

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
 * silently accepted (`dropped`).
 *
 * Session 128 (#322 I-4a): the log is parsed WHOLE through the capped
 * schema (`parseCommandLog`: every entry a real ChartCommand — fix round 1's
 * I3 reason for using the real zod schema at all — and at most
 * CHART_COMMAND_LOG_MAX of them), the same parse the card's own stored-log
 * hydration runs (use-chart-edits.ts) and the edits store writes through
 * (chart-edits-actions.ts). It used to parse entry by entry, which counted
 * a malformed entry as "dropped" but also bypassed the 200-command cap (a
 * crafted 64 KB log of 377 overlay commands was accepted). A malformed or
 * over-long log is now `invalid_log`. Both outcomes fail closed (the
 * publish action refuses, the public page shows "not available"), and a
 * real card never produces a malformed entry, so the per-entry tolerance
 * was not needed for anything. `dropped` now counts only commands that no
 * longer validate against this chart.
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

  const commands = parseCommandLog(log);
  if (commands === null) return { ok: false, reason: 'invalid_log' };

  const cache = new Map<string, UserChartSpec>([[instructionKey(firstInstruction), first.chart]]);
  for (const command of commands) {
    if (command.kind === 'setInstruction') {
      const key = instructionKey(command.instruction);
      if (!cache.has(key)) {
        const outcome = renderInstructionForDataset(dataset, command.instruction);
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
  if (state.derivedOverlayRequests.length > PUBLIC_OVERLAY_MAX) return { ok: false, reason: 'too_many_overlays' };
  return { ok: true, state, spec, dataset, dropped };
}

/**
 * Final-review fix A3 (ruling R16) — a code-drift guard for the public page.
 * A stored log names series POSITIONALLY (`s0`, `s1`, ...): `toggleSeries
 * s0` means "hide whichever series the chart drew first". That only means
 * what the author meant if rendering the turn's own instruction today still
 * yields the same series, in the same order, as the chart the turn stored
 * when it was made (`envelope.chart`). If a later code change reordered or
 * relabelled them, the same log would hide a DIFFERENT series — so the page
 * refuses instead. Skipped only when the envelope carries no chart at all
 * (nothing to compare against); a chart that is present but malformed fails
 * closed.
 */
export function firstRenderMatchesEnvelope(dataset: UserDataset, turn: DatasetTurnRecord): boolean {
  if (turn.instruction === null) return false;
  const envelope: unknown = turn.envelope;
  const chart = envelope !== null && typeof envelope === 'object' ? (envelope as { chart?: unknown }).chart : undefined;
  if (chart === undefined || chart === null) return true;
  if (typeof chart !== 'object') return false;
  const stored = (chart as { series?: unknown }).series;
  if (!Array.isArray(stored)) return false;
  const first = renderInstructionForDataset(dataset, turn.instruction);
  if (first.kind !== 'ok') return false;
  const now = first.chart.series.map((s) => s.label);
  return (
    stored.length === now.length &&
    stored.every((s, i) => s !== null && typeof s === 'object' && (s as { label?: unknown }).label === now[i])
  );
}

/**
 * The single enforcement point of invariant P1 (docs/05-data-rules.md): a
 * hidden series' label/value/source text, the dataset's own file name/
 * source url/content hash/raw cells/profile, the reader's command log
 * itself, and any internal row reference must never reach an anonymous
 * visitor. A hidden series' SLOT is kept (blanked, not removed) so the
 * remaining series' keys/colours never shift; anything anchored to a hidden
 * point (a note, an overlay touching it, the headline override, the
 * highlight) is dropped rather than shown against a blank.
 *
 * Session 128 security-review fix wave (#322):
 * - I-1: every public point gets an opaque id (`p0`, `p1`, …) in place of
 *   its internal rowRef, and every reference (a note's resultId, an
 *   overlay's resultIds, the headline override) is remapped through the
 *   same map. An internal rowRef is not a neutral key: an aggregate's
 *   (`agg:count:r1:c0+r2:c0+r3:c0`) lists its member rows — so its group
 *   size n, which for `count` IS the value — and a share's carries
 *   `|total:n`. The card only ever uses a rowRef as an identity key
 *   (React keys, `data-label-for`/`data-result-id`, lookups), so an opaque
 *   id works unchanged. Ids are handed out in series order, the blanked
 *   slot's from visible data only, so their numbering carries nothing
 *   about a hidden series either. A note's own id (the card builds it as
 *   `${resultId}-…`) is re-keyed too, and a resolved overlay's own handle
 *   becomes `${calcKind}:${public ids}`.
 * - I-2: a blanked slot is exactly one blank point per category a VISIBLE
 *   series plots, in visible order (first appearance across the visible
 *   series). It used to keep the hidden series' own points (A1: only those
 *   at visible categories) in their own order — with sort-by-value that
 *   order IS the hidden series' ranking, and which categories it has is
 *   itself information (for `count`, a missing category means zero).
 * - M-1: a kept note's series/period labels are rebuilt from the final
 *   public spec — a note keeps the labels the chart had when it was added,
 *   and a later setInstruction can make them name a series no longer
 *   plotted (a customer name, when the chart is now split by region).
 * - I-4b: every kept overlay is resolved from ONE `allResolvedPoints` map
 *   (one executeInstruction over the file per request, not one per
 *   overlay), through derive-overlay.ts's own arithmetic.
 * - `sourceText` is blanked on every public point: the card never reads
 *   it, and on a derived point it is the unplotted operand's raw cell text.
 */
export function pruneForPublic(built: Extract<BuildPublishedChartResult, { ok: true }>, sourceLine: string | null): PublicOwnChart {
  const { state, spec, dataset } = built;
  const hidden = new Set(state.hiddenKeys);
  const isHidden = (i: number) => hidden.has(`s${i}`);

  // Every rowRef a hidden series plots — never referenced publicly, even if
  // (defensively) the same rowRef were also plotted by a visible series.
  const blankedRefs = new Set(spec.series.flatMap((s, i) => (isHidden(i) ? s.points.map((p) => p.rowRef) : [])));

  // Final-review fix A1 (ruling R11) + I-2: the categories at least one
  // VISIBLE series plots, in first-appearance order across the visible
  // series — the only categories, and the only order, a blanked slot shows.
  const visibleCategories: { xKey: string; xLabel: string }[] = [];
  const visibleXKeys = new Set<string>();
  spec.series.forEach((s, i) => {
    if (isHidden(i)) return;
    for (const p of s.points) {
      if (visibleXKeys.has(p.xKey)) continue;
      visibleXKeys.add(p.xKey);
      visibleCategories.push({ xKey: p.xKey, xLabel: p.xLabel });
    }
  });

  // I-1: internal rowRef -> opaque public id, for every VISIBLE point. The
  // same internal rowRef always maps to the same public id, so identity
  // (and so every lookup the card does) is preserved exactly. `location`
  // is what M-1 rebuilds a note's labels from.
  const publicIdByRef = new Map<string, string>();
  const location = new Map<string, { seriesLabel: string; xLabel: string }>();
  let nextId = 0;
  const freshId = () => `p${nextId++}`;
  const series = spec.series.map((s, i) => {
    if (isHidden(i)) {
      return {
        label: '',
        points: visibleCategories.map(({ xKey, xLabel }): UserChartPoint => ({
          rowRef: freshId(),
          xKey,
          xLabel,
          value: null,
          formattedValue: null,
          sourceText: '',
        })),
      };
    }
    return {
      label: s.label,
      points: s.points.map((p): UserChartPoint => {
        let id = publicIdByRef.get(p.rowRef);
        if (id === undefined) {
          id = freshId();
          publicIdByRef.set(p.rowRef, id);
          location.set(p.rowRef, { seriesLabel: s.label, xLabel: p.xLabel });
        }
        return { ...p, rowRef: id, sourceText: '' };
      }),
    };
  });
  // Fix round 1 (C2) + I-1: a reference survives only if the FINAL spec
  // plots it in a visible series (a `setInstruction` can drop a rowRef out
  // of the chart entirely; a hidden one is blanked). The card filters a
  // stale note the same way at render (its own `plottedRowRefs`).
  const isVisibleRef = (ref: string) => publicIdByRef.has(ref) && !blankedRefs.has(ref);
  const publicRef = (ref: string) => publicIdByRef.get(ref)!;

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
    spec.series.forEach((s, i) => (isHidden(i) ? hiddenLabels : visibleLabels).add(s.label));
    yHeaders = spec.yHeaders.map((h) => (hiddenLabels.has(h) || !visibleLabels.has(h) ? '' : h));
  }
  const prunedSpec: UserChartSpec = {
    ...spec,
    yHeaders,
    series,
    provenance: { ...spec.provenance, datasetId: 0, displayName: '', sourceUrlHost: null, contentSha256: '' },
  };

  const keptOverlayRequests = state.derivedOverlayRequests.filter((r) => r.resultIds.every(isVisibleRef));
  const overlays: Record<string, ResolvedOverlay> = {};
  const byRef = keptOverlayRequests.length > 0 ? resolvedPointsForOverlays(state, dataset) : null;
  if (byRef !== null) {
    for (const r of keptOverlayRequests) {
      try {
        const resolved = overlayFromResolvedPoints(byRef, { calcKind: r.calcKind, resultIds: r.resultIds });
        overlays[r.id] = { value: resolved.value, decimals: resolved.decimals, rowRef: `${r.calcKind}:${r.resultIds.map(publicRef).join('+')}` };
      } catch (e) {
        // A refused overlay is simply not drawn on the public page (the
        // author's card shows the refusal text; the public page never
        // shows error copy). Narrowed to derive-overlay.ts's own refusal
        // class so an unrelated programming error still surfaces.
        if (!(e instanceof OverlaySelectionError)) throw e;
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
      notes: state.notes
        .filter((n) => isVisibleRef(n.resultId))
        .map((n, i) => {
          const at = location.get(n.resultId)!;
          return { id: `n${i}`, resultId: publicRef(n.resultId), seriesLabel: at.seriesLabel, periodLabel: at.xLabel, text: n.text };
        }),
      title: state.title,
      caption: state.caption,
      goalLines: state.goalLines,
      // A1 follow-through: an era names its ends by xKey (the category
      // string itself for own-data — chart.ts sets xKey = xLabel), so an era
      // anchored to a hidden-only category would carry that category to the
      // visitor even though no row draws it. Kept only when BOTH ends are
      // categories a visible series plots (the card could not place it
      // otherwise anyway).
      eraShadings: state.eraShadings.filter((e) => visibleXKeys.has(e.fromPeriodCode) && visibleXKeys.has(e.toPeriodCode)),
      headlineOverrideResultId:
        state.headlineOverrideResultId !== null && isVisibleRef(state.headlineOverrideResultId) ? publicRef(state.headlineOverrideResultId) : null,
      derivedOverlayRequests: keptOverlayRequests.map((r) => ({ id: r.id, calcKind: r.calcKind, resultIds: r.resultIds.map(publicRef) })),
    },
    overlays,
    sourceLine,
  };
}

/** I-4b: the ONE point map every kept overlay is resolved from — null when
 * the instruction no longer validates or the chart can no longer be built
 * (then no overlay is drawn, exactly as each per-overlay call used to
 * refuse). Narrowed to the reachable throw classes (the schema's own
 * refusal, execute.ts's NoRowsError/TooManyPointsError) so an unrelated
 * programming error still surfaces instead of being swallowed. */
function resolvedPointsForOverlays(state: ChartDocState, dataset: UserDataset): Map<string, ResolvedPoint> | null {
  if (state.instruction === null) return null;
  try {
    const instruction = validateInstructionObject(toValidatableInstruction(upgradeInstruction(state.instruction)), dataset.profile);
    return allResolvedPoints(dataset, instruction);
  } catch (e) {
    if (e instanceof InstructionValidationError || e instanceof NoRowsError || e instanceof TooManyPointsError) return null;
    throw e;
  }
}
