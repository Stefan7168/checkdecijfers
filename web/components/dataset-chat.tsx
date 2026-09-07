// ADR 037 D8/D10 — the dataset-chat loop, chat.tsx's sibling for a dataset
// thread. Mirrors chat.tsx's own structural discipline (one crypto.randomUUID()
// per submit, the send control disabled while a request is in flight — D10's
// explicit "replicate the double-click guard exactly" requirement — and the
// #75 fill-don't-send convention for clarification options) over a much
// smaller envelope surface: no clarification-REPLY carrier object, no
// websearch chips, no citation/CSV/StatCard/proof machinery.
//
// v1 scope, deliberately smaller than Chat (documented, not silently cut):
// no resumed-turn cost captions (no ledger join built for dataset-turn replay
// yet — showing one would mean inventing a number `getDatasetTurnsByThread`
// cannot currently back); a freshly-sent turn DOES show its live `netCost`.
//
// ADR 037 D10/WP202a: dock support mirrors Chat's own dockMode/onVisualsChange/
// activeVisualId/onActivateVisual props exactly (all optional, all no-ops
// without their callback — the needs_decision screen / test call sites that
// omit them). In dock mode a chart turn's `UserChartView` moves to the right
// pane and this bubble shows the same in-flow reference-chip pattern as
// Chat's own docked chart/card chip; below `lg` (dockMode=false) a chart
// still renders inline exactly as before this increment (D4 symmetry).
'use client';

import { useEffect, useRef, useState } from 'react';
import { askDataset, decideDatasetFormat } from '../app/dataset-actions.ts';
import type { AskDatasetOutcome } from '../app/dataset-actions.ts';
import type { DatasetChatMessage } from '../backend/attachments/replay.ts';
import type { RawDatasetState } from '../backend/attachments/respond.ts';
import { ambiguousFormatClarificationText, AMBIGUOUS_FORMAT_OPTIONS } from '../backend/attachments/templates.ts';
import type { ColumnProfile, DatasetProfile, DatasetStatus, NumberFormat } from '../backend/attachments/types.ts';
import { datasetMessageHasVisual, deriveDatasetVisuals, visualId, type DockVisual } from '../lib/dock-visuals.ts';
import { UserChartView } from './user-chart.tsx';

/** The one ambiguous-format decision UI needs from a resumed/fresh dataset:
 * whether it's askable yet, and — while it isn't — the profile to ask the
 * two-chip question(s) against. */
export interface DatasetChatProps {
  datasetId: number;
  threadId: number;
  displayName: string;
  initialStatus: DatasetStatus;
  initialProfile: DatasetProfile;
  initialMessages: DatasetChatMessage[];
  initialRawState: RawDatasetState | null;
  onThreadId?: (threadId: number) => void;
  onBusyChange?: (busy: boolean) => void;
  /** ADR 037 D10: mirrors Chat's own `dockMode` — true only at `lg`+ AND with
   * a live dock (Workspace decides both). A no-op default (false) keeps every
   * existing call site (including this file's own tests) byte-identical. */
  dockMode?: boolean;
  /** Reports the dockable visuals derived from `messages`, mirroring Chat's
   * own `onVisualsChange` — a no-op without the callback. */
  onVisualsChange?: (visuals: DockVisual[]) => void;
  activeVisualId?: string | null;
  onActivateVisual?: (visualId: string) => void;
}

function ambiguousColumns(profile: DatasetProfile): ColumnProfile[] {
  return profile.columns.filter((c) => c.numberFormat === 'ambiguous');
}

export function DatasetChat({
  datasetId,
  threadId,
  displayName,
  initialStatus,
  initialProfile,
  initialMessages,
  initialRawState,
  onThreadId,
  onBusyChange,
  dockMode = false,
  onVisualsChange,
  activeVisualId = null,
  onActivateVisual,
}: DatasetChatProps) {
  const [status, setStatus] = useState(initialStatus);
  const [profile, setProfile] = useState(initialProfile);
  const [pendingColumnIndex, setPendingColumnIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, NumberFormat>>({});
  const [messages, setMessages] = useState<DatasetChatMessage[]>(initialMessages);
  const [rawState, setRawState] = useState<RawDatasetState | null>(initialRawState);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    onThreadId?.(threadId);
  }, [threadId, onThreadId]);

  useEffect(() => {
    onVisualsChange?.(deriveDatasetVisuals(messages));
  }, [messages, onVisualsChange]);

  async function submitDecision(format: NumberFormat): Promise<void> {
    const columns = ambiguousColumns(profile);
    const column = columns[pendingColumnIndex];
    if (!column) return;
    const nextDecisions = { ...decisions, [column.id]: format };
    if (pendingColumnIndex + 1 < columns.length) {
      setDecisions(nextDecisions);
      setPendingColumnIndex((i) => i + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await decideDatasetFormat(datasetId, nextDecisions);
      if (result.kind === 'ok') {
        setProfile(result.profile);
        setStatus('ready');
        setDecisions({});
        setPendingColumnIndex(0);
      } else if (result.kind === 'unauthenticated') {
        setError('Your session has expired. Please refresh the page.');
      } else {
        setError('This file no longer needs a decision — it may have been deleted.');
      }
    } catch {
      setError('Something went wrong saving that choice. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setInput('');
    setBusy(true);
    setError(null);
    const requestId = crypto.randomUUID();
    try {
      const result: AskDatasetOutcome = await askDataset(datasetId, threadId, text, requestId, rawState);
      if (result.kind === 'unauthenticated') {
        setError('Your session has expired. Please refresh the page.');
      } else if (result.kind === 'duplicate_request') {
        // A client retry of an already-processed submit — nothing new to show.
      } else if (result.kind === 'insufficient_credits') {
        setError(`Not enough credits (need ${result.required}, you have ${result.balance}).`);
      } else if (result.kind === 'not_found') {
        setError('This file is no longer available.');
      } else if (result.kind === 'needs_decision') {
        setProfile(result.profile);
        setStatus('needs_decision');
      } else {
        const envelope = result.envelope;
        if (envelope.kind === 'chart') {
          setRawState({ datasetId, lastInstruction: envelope.state.lastInstruction });
          setMessages((prev) => [...prev, { role: 'assistant', kind: 'chart', text: envelope.text, chart: envelope.chart, lastInstruction: envelope.state.lastInstruction }]);
        } else if (envelope.kind === 'clarification') {
          setMessages((prev) => [...prev, { role: 'assistant', kind: 'clarification', text: envelope.text, options: envelope.options }]);
        } else {
          setMessages((prev) => [...prev, { role: 'assistant', kind: 'refusal', text: envelope.text, guidance: envelope.guidance }]);
        }
      }
    } catch {
      setError('Something went wrong answering that question. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (status === 'needs_decision') {
    const columns = ambiguousColumns(profile);
    const column = columns[pendingColumnIndex] ?? columns[0];
    return (
      <div className="flex h-[65vh] w-full flex-col rounded border border-line p-4">
        <h1 className="mb-4 text-lg font-semibold">{displayName}</h1>
        {column ? (
          <div className="flex-1 space-y-3">
            <p className="text-sm text-ink">{ambiguousFormatClarificationText(column)}</p>
            <div className="flex flex-wrap gap-2">
              {AMBIGUOUS_FORMAT_OPTIONS.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  disabled={busy}
                  onClick={() => void submitDecision(i === 0 ? 'nl' : 'en')}
                  className="rounded-full border border-line-strong px-3 py-1 text-xs text-ink-soft hover:bg-paper-sunken disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {label}
                </button>
              ))}
            </div>
            {error ? <div className="text-sm text-danger">{error}</div> : null}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">Nothing left to decide.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-[65vh] w-full flex-col rounded border border-line p-4">
      <h1 className="mb-4 text-lg font-semibold">{displayName}</h1>
      <div className="flex-1 space-y-3 overflow-y-auto tnum">
        {messages.map((message, i) => {
          if (message.role === 'redacted') {
            return (
              <div key={i} className="text-left">
                <p className="text-sm italic text-ink-muted">This question has been deleted.</p>
              </div>
            );
          }
          // ADR 037 D10: mirrors chat.tsx's own `docked` computation exactly
          // (dockMode AND this message contributes a visual).
          const docked = dockMode && datasetMessageHasVisual(message);
          return (
            <div key={i} className={message.role === 'user' ? 'text-right' : 'text-left'}>
              <div
                className={
                  'inline-block max-w-full whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ' +
                  (message.role === 'user'
                    ? 'bg-paper-sunken text-ink'
                    : message.kind === 'clarification'
                      ? 'border border-line-strong bg-warn-soft text-ink'
                      : message.kind === 'refusal'
                        ? 'border border-line bg-paper-sunken text-ink'
                        : 'border border-line bg-paper-raised text-ink')
                }
              >
                {message.text}
              </div>
              {message.role === 'assistant' && message.kind === 'refusal' && message.guidance ? (
                <p className="mt-1 text-xs text-ink-muted">{message.guidance}</p>
              ) : null}
              {message.role === 'assistant' && message.kind === 'clarification' && message.options.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {message.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setInput(option)}
                      className="rounded-full border border-line-strong px-3 py-1 text-xs text-ink-soft hover:bg-paper-sunken"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}
              {message.role === 'assistant' && message.kind === 'chart' ? (
                docked ? (
                  // ADR 037 D10: the in-flow reference chip standing in for a
                  // docked chart — mirrors chat.tsx's own chip exactly, English
                  // copy per #206.
                  <button
                    type="button"
                    onClick={() => onActivateVisual?.(visualId(i))}
                    aria-pressed={activeVisualId === visualId(i)}
                    className={
                      'mt-2 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs ' +
                      (activeVisualId === visualId(i)
                        ? 'border-line-strong bg-paper-sunken text-ink'
                        : 'border-line-strong text-ink-soft hover:bg-paper-sunken')
                    }
                  >
                    Chart in panel →
                  </button>
                ) : (
                  <UserChartView spec={message.chart} />
                )
              ) : null}
            </div>
          );
        })}
        {busy ? <div className="text-left text-sm text-ink-muted">Working on it…</div> : null}
        {error ? <div className="text-sm text-danger">{error}</div> : null}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          maxLength={500}
          placeholder="Ask about your data…"
          className="flex-1 rounded-md border border-line-strong bg-paper-raised px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:bg-paper-sunken"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
