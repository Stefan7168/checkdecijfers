// WP135 chat workspace (ADR 033 D4): the right-pane dock's tabs are DERIVED
// from the messages array — never stored (a resumed thread reconstructs them
// for free). Each answer message carrying a chart or a stat card becomes one
// tab; labels are deterministic ("Grafiek n" / "Kaart n" + the truncated
// originating question), so no LLM is ever involved. Pure leaf: shared by
// Chat (which renders the in-flow reference chip) and Workspace (which renders
// the dock) so both agree on the tab identity for a given message.
//
// ADR 037 D10/WP202a: `deriveDatasetVisuals` below is the same derivation over
// a DatasetChatMessage array, for DatasetChat's own dock support. `userChart`
// is an ADDITIVE field on `DockVisual` (never touches the `chart`/`card`
// producer above) — a CBS-derived visual always carries `userChart: null`.
// Labels are English ("Your chart n") — the design doc's own §8 Q6 decided
// this exact string (session 84's Dutch→English translation, alongside the
// badge/disclaimer copy), not a fresh naming choice made here.
import type { ChatMessage } from './chat-message.ts';
import type { DatasetChatMessage } from '../backend/attachments/replay.ts';
import type { DatasetProfile, UserChartSpec } from '../backend/attachments/types.ts';
import type { UserChartEditContext } from '../components/user-chart.tsx';

/** One dockable visual. `chart`/`card`/`userChart` carry the payload verbatim
 * so the dock renders the SAME ChartView/StatCard/UserChartView components,
 * internally unchanged. */
export interface DockVisual {
  /** Deterministic, stable within a session: messages only ever append, so
   * the index is a stable identity (Chat/DatasetChat compute the same id from
   * the index to wire their reference chip to this tab). */
  id: string;
  kind: 'chart' | 'card' | 'userChart';
  /** "Grafiek 1" / "Kaart 2" / "Your chart 1" — deterministic, per-kind running
   * count. Dutch/English-independent renderers (tests constructing a
   * DockVisual by hand, and the `userChart` kind, whose "Your chart n" is
   * English by design — see the file header) still use this literal. */
  label: string;
  /** Session 110 UX audit row 5: the same per-kind running count `label` was
   * built from, exposed separately so a `chart`/`card` visual's tab text can
   * be localized at render time (`dock.chartTab`/`dock.cardTab` in
   * messages.ts) instead of staying baked into Dutch. Left unset (undefined)
   * for `userChart` visuals and for any DockVisual built by hand (tests) —
   * the renderer falls back to `label` in that case. */
  count?: number;
  /** The originating question (nearest preceding user turn), truncated. */
  question: string;
  chart: ChatMessage['chart'];
  /** #254 Task 6: the dock renders `ChartView` directly (not a summary), so
   * the reading toggle needs the same `chartAlternates` the in-flow chat
   * bubble already gets — carried verbatim from the originating message,
   * same null-safety posture as `chart`/`card`. `[]` for a `card` visual (no
   * chart to switch readings on) and for every `userChart` visual
   * (DatasetChatMessage carries no chartAlternates at all — a user-uploaded
   * dataset chart has no CBS registry entry to look alternates up in). */
  chartAlternates: ChatMessage['chartAlternates'];
  card: ChatMessage['card'];
  userChart: UserChartSpec | null;
  /** Task 4 (spec Part B1): the audit_answers row id ChartEmbedButton signs
   * an embed token against — same field, same null-on-non-answer contract as
   * `ChatMessage['auditId']` itself. Always null for a `userChart` visual
   * (DatasetChatMessage, deriveDatasetVisuals below, has no audit row at
   * all — a user-uploaded dataset chart is never an audited CBS answer, so
   * there is nothing for an embed token to sign). */
  auditId: number | null;
  /** Co-pilot phase 2 (session 113): what makes a DOCKED own-data card
   * editable — the same context the in-flow bubble hands `UserChartView`, so
   * a reader's edits and their saved log follow the chart into the right
   * pane. Null for every `chart`/`card` visual (a CBS chart is edited through
   * its own `embed.auditId` key), for a chart turn with no stored row behind
   * it, and for a DockVisual built by hand (tests). */
  userChartEdit: UserChartEditContext | null;
}

const QUESTION_MAX_LENGTH = 48;

function truncate(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > QUESTION_MAX_LENGTH
    ? `${collapsed.slice(0, QUESTION_MAX_LENGTH - 1)}…`
    : collapsed;
}

/** The dock-tab id for the message at `index` — the ONE place the id scheme
 * lives, so Chat's reference chip and the dock's tab agree. */
export function visualId(index: number): string {
  return `visual-${index}`;
}

/** Whether a message contributes a dock tab (an assistant answer with a chart
 * or a stat card). Chart takes precedence when — improbably — both are present,
 * keeping it ONE tab per message (ADR 033 D4). */
export function messageHasVisual(message: ChatMessage): boolean {
  return message.role === 'assistant' && (message.chart !== null || message.card !== null);
}

/** The DatasetChat analog of `messageHasVisual`: a chart-kind assistant turn
 * is the only dataset message that ever contributes a dock tab (there is no
 * dataset-side stat-card concept). */
export function datasetMessageHasVisual(message: DatasetChatMessage): boolean {
  return message.role === 'assistant' && message.kind === 'chart';
}

/** Derive the ordered dock visuals from the full messages array. */
export function deriveVisuals(messages: ChatMessage[]): DockVisual[] {
  const visuals: DockVisual[] = [];
  let chartCount = 0;
  let cardCount = 0;
  let lastQuestion = '';
  messages.forEach((message, index) => {
    if (message.role === 'user') {
      lastQuestion = message.text;
      return;
    }
    if (message.role !== 'assistant') return;
    if (message.chart !== null) {
      chartCount += 1;
      visuals.push({
        id: visualId(index),
        kind: 'chart',
        label: `Grafiek ${chartCount}`,
        count: chartCount,
        question: truncate(lastQuestion),
        chart: message.chart,
        chartAlternates: message.chartAlternates,
        card: null,
        userChart: null,
        auditId: message.auditId,
        userChartEdit: null,
      });
    } else if (message.card !== null) {
      cardCount += 1;
      visuals.push({
        id: visualId(index),
        kind: 'card',
        label: `Kaart ${cardCount}`,
        count: cardCount,
        question: truncate(lastQuestion),
        chart: null,
        chartAlternates: [],
        card: message.card,
        userChart: null,
        auditId: message.auditId,
        userChartEdit: null,
      });
    }
  });
  return visuals;
}

/** The DatasetChat analog of `deriveVisuals` (ADR 037 D10): one tab per
 * chart-kind assistant turn, in stored/sent order. Never stored — a resumed
 * dataset thread reconstructs its dock for free, exactly like the CBS side. */
export function deriveDatasetVisuals(
  messages: DatasetChatMessage[],
  /** Co-pilot phase 2 (session 113): the dataset/thread/profile the whole
   * thread belongs to. Given → each chart tab with a turn id carries the edit
   * context an editable card needs; omitted (every pre-phase-2 call site and
   * every test that only cares about the tabs) → every tab is read-only. */
  edit?: { datasetId: number; threadId: number; profile: DatasetProfile },
): DockVisual[] {
  const visuals: DockVisual[] = [];
  let chartCount = 0;
  let lastQuestion = '';
  messages.forEach((message, index) => {
    if (message.role === 'user') {
      lastQuestion = message.text;
      return;
    }
    if (!datasetMessageHasVisual(message) || message.role !== 'assistant' || message.kind !== 'chart') return;
    chartCount += 1;
    visuals.push({
      id: visualId(index),
      kind: 'userChart',
      label: `Your chart ${chartCount}`,
      question: truncate(lastQuestion),
      chart: null,
      chartAlternates: [],
      card: null,
      userChart: message.chart,
      // DatasetChatMessage (backend/attachments/replay.ts) carries no
      // auditId at all — a user-uploaded dataset chart is never an audited
      // CBS answer row, so there is no id an embed token could sign. See
      // the DockVisual.auditId doc comment above.
      auditId: null,
      userChartEdit:
        edit === undefined || message.turnId === null
          ? null
          : { ...edit, turnId: message.turnId, lastInstruction: message.lastInstruction },
    });
  });
  return visuals;
}
