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
  type DatasetTurnRecord,
  type UserChartSpec,
  type UserDataset,
} from '../backend/attachments/types.ts';
import { replayLog } from './chart-history.ts';
import {
  initialDocState,
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

function isCommandShaped(x: unknown): x is ChartCommand {
  return x !== null && typeof x === 'object' && !Array.isArray(x) && typeof (x as { kind?: unknown }).kind === 'string';
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
  const firstInstruction = toClientInstruction(turn.instruction);

  const cache = new Map<string, UserChartSpec>([[instructionKey(firstInstruction), first.chart]]);
  let garbage = 0;
  const commands: ChartCommand[] = [];
  for (const entry of log) {
    if (!isCommandShaped(entry)) {
      garbage++;
      continue;
    }
    commands.push(entry);
    if (entry.kind === 'setInstruction') {
      const key = instructionKey(entry.instruction);
      if (!cache.has(key)) {
        const outcome = renderInstructionForDataset(dataset, entry.instruction);
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
  const blankedRefs = new Set<string>();
  const series = spec.series.map((s, i) => {
    if (!hidden.has(`s${i}`)) return s;
    for (const p of s.points) blankedRefs.add(p.rowRef);
    return {
      label: '',
      points: s.points.map((p) => ({ rowRef: p.rowRef, xKey: p.xKey, xLabel: p.xLabel, value: null, formattedValue: null, sourceText: '' })),
    };
  });
  const prunedSpec: UserChartSpec = {
    ...spec,
    series,
    provenance: { ...spec.provenance, datasetId: 0, displayName: '', sourceUrlHost: null, contentSha256: '' },
  };
  const overlayRequests = state.derivedOverlayRequests.filter((r) => r.resultIds.every((id) => !blankedRefs.has(id)));
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
      notes: state.notes.filter((n) => !blankedRefs.has(n.resultId)),
      title: state.title,
      caption: state.caption,
      goalLines: state.goalLines,
      eraShadings: state.eraShadings,
      headlineOverrideResultId:
        state.headlineOverrideResultId !== null && blankedRefs.has(state.headlineOverrideResultId) ? null : state.headlineOverrideResultId,
      derivedOverlayRequests: overlayRequests,
    },
    overlays,
    sourceLine,
  };
}
