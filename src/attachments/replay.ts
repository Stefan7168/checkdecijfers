// "Eigen data" attachments tier — deterministic replay of a dataset thread's
// stored dataset_turns rows (ADR 037 D10, the CBS-side src/threads/replay.ts
// analog). ZERO LLM. Unlike the CBS split (src/threads/replay.ts's own header
// explains why: web-only citation/CSV/StatCard builders need a second,
// web-side assembly stage), a DatasetTurnEnvelope already carries everything
// a DatasetChatMessage needs directly — no chart-download-menu wiring or
// other web-only builder runs at replay time, so this file produces the
// FINAL message shape, not an intermediate "parts" stage. Pure leaf: no
// db/SQL import, operates only on already-loaded rows.
//
// D9's redaction discipline, restated for this new reader (the design doc
// names exactly this obligation, alongside three others): check
// `isRedacted(envelope)` FIRST, before touching any kind-specific field — a
// redacted row replays as ONE placeholder message, never a user+assistant
// pair (mirrors CBS's ⟨A7⟩), and `lastChartState` skips redacted rows when
// scanning backward for the last chart turn's refinement referent.
import { upgradeInstruction, type ClientChartInstruction, type DatasetTurnRecord, type UserChartSpec } from './types.ts';

export type DatasetChatMessage =
  | { role: 'user'; text: string }
  /** Co-pilot phase 2 (session 113): `turnId` is this chart's OWN
   * dataset_turns row — what the card's saved command log is keyed on
   * (Task 3's ChartEditsKey). Null only for a chart a caller pushed without
   * a stored row behind it (a freshly-sent turn whose audit insert produced
   * no id, `AuditedDatasetTurn.auditId`); a replayed row always has one. */
  | { role: 'assistant'; kind: 'chart'; text: string; chart: UserChartSpec; lastInstruction: ClientChartInstruction; turnId: number | null }
  | { role: 'assistant'; kind: 'clarification'; text: string; options: string[] }
  | { role: 'assistant'; kind: 'refusal'; text: string; guidance: string | null }
  | { role: 'redacted' };

type LiveEnvelope = Exclude<DatasetTurnRecord['envelope'], { redacted: true }>;

function isRedacted(envelope: DatasetTurnRecord['envelope']): boolean {
  return 'redacted' in envelope && envelope.redacted === true;
}

function assistantMessage(envelope: LiveEnvelope, turnId: number): DatasetChatMessage {
  if (envelope.kind === 'chart') {
    return {
      role: 'assistant',
      kind: 'chart',
      text: envelope.text,
      chart: envelope.chart,
      lastInstruction: upgradeInstruction(envelope.state.lastInstruction) as ClientChartInstruction,
      turnId,
    };
  }
  if (envelope.kind === 'clarification') {
    return { role: 'assistant', kind: 'clarification', text: envelope.text, options: envelope.options };
  }
  return { role: 'assistant', kind: 'refusal', text: envelope.text, guidance: envelope.guidance };
}

/** One row → one user turn + one assistant turn, in stored order (the caller
 * — `getDatasetTurnsByThread`, read.ts — already orders by created_at asc,
 * id asc); a redacted row → ONE placeholder, never a pair (⟨A7⟩ analog). */
export function replayDatasetTurns(rows: DatasetTurnRecord[]): DatasetChatMessage[] {
  const messages: DatasetChatMessage[] = [];
  for (const record of rows) {
    if (isRedacted(record.envelope)) {
      messages.push({ role: 'redacted' });
      continue;
    }
    messages.push({ role: 'user', text: record.question });
    messages.push(assistantMessage(record.envelope as LiveEnvelope, record.id));
  }
  return messages;
}

/** D8 step 2's resumed refinement referent: the LAST non-redacted chart
 * turn's `state`, scanned backward — so a follow-up like "make it a bar
 * chart" works immediately after resuming a thread, exactly as it does
 * mid-session. Null when the thread has no live chart turn yet (every turn
 * so far was a clarification/refusal, or the only chart turn is redacted). */
export function lastChartState(
  rows: DatasetTurnRecord[],
): { datasetId: number; lastInstruction: ClientChartInstruction; turnId: number } | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const record = rows[i]!;
    if (isRedacted(record.envelope)) continue;
    const envelope = record.envelope as LiveEnvelope;
    if (envelope.kind === 'chart') {
      return {
        ...envelope.state,
        lastInstruction: upgradeInstruction(envelope.state.lastInstruction) as ClientChartInstruction,
        // Co-pilot phase 2: the row this chart came from, so a resumed
        // thread's card can key its saved edits on the same turn.
        turnId: record.id,
      };
    }
  }
  return null;
}
