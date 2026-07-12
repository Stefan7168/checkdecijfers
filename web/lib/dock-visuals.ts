// WP135 chat workspace (ADR 033 D4): the right-pane dock's tabs are DERIVED
// from the messages array — never stored (a resumed thread reconstructs them
// for free). Each answer message carrying a chart or a stat card becomes one
// tab; labels are deterministic ("Grafiek n" / "Kaart n" + the truncated
// originating question), so no LLM is ever involved. Pure leaf: shared by
// Chat (which renders the in-flow reference chip) and Workspace (which renders
// the dock) so both agree on the tab identity for a given message.
import type { ChatMessage } from './chat-message.ts';

/** One dockable visual. `chart`/`card` carry the payload verbatim so the dock
 * renders the SAME ChartView/StatCard components, internally unchanged. */
export interface DockVisual {
  /** Deterministic, stable within a session: messages only ever append, so
   * the index is a stable identity (Chat computes the same id from the index
   * to wire its reference chip to this tab). */
  id: string;
  kind: 'chart' | 'card';
  /** "Grafiek 1" / "Kaart 2" — deterministic, per-kind running count. */
  label: string;
  /** The originating question (nearest preceding user turn), truncated. */
  question: string;
  chart: ChatMessage['chart'];
  card: ChatMessage['card'];
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
        question: truncate(lastQuestion),
        chart: message.chart,
        card: null,
      });
    } else if (message.card !== null) {
      cardCount += 1;
      visuals.push({
        id: visualId(index),
        kind: 'card',
        label: `Kaart ${cardCount}`,
        question: truncate(lastQuestion),
        chart: null,
        card: message.card,
      });
    }
  });
  return visuals;
}
