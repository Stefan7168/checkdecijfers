// Co-pilot phase 2 (session 113, Task 8) — doorway B: "Pas deze grafiek
// aan", the chat under the own-data card. Presentation only; every server
// round trip (the one credited call, the feedback vote) belongs to the card.
//
// Three things this file is deliberately careful about:
//   1. The example chips are DETERMINISTIC text (chart-capabilities.ts) —
//      clicking one sends its own words. No parse, no prompt, no spend for
//      the three things readers ask for most (CLAUDE.md's cheapest-mechanism
//      rule).
//   2. A refusal names the CONTROL that can do it ("open het paneel
//      Opmaak"), never "request a feature" — the panel is already there.
//   3. `chart.copilot.cost` is the ONE digit-bearing string on this surface,
//      and this whole strip renders OUTSIDE the card's export container, so
//      no credit figure can ever enter a PNG/SVG of the chart.
'use client';

import { Heading, LayoutGrid, LayoutTemplate, MessageSquare, SlidersHorizontal, Table2, Text, ThumbsDown, ThumbsUp, Eye } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { opensForIcon, refusalLine, type AppliedChip, type ChipIcon, type ChipOpens } from '../lib/chart-copilot-reply.ts';
import type { ExampleChip } from '../lib/chart-capabilities.ts';
import { t, type Lang } from '../lib/i18n/messages.ts';
import type { CopilotRefusal } from '../backend/attachments/types.ts';
import { Button } from './ui/button.tsx';
import { Input } from './ui/input.tsx';

/** The same icons the Style/Data panel rows and the history menu use. */
const CHIP_ICON: Record<ChipIcon, typeof Table2> = {
  data: Table2,
  form: LayoutGrid,
  series: Eye,
  style: SlidersHorizontal,
  template: LayoutTemplate,
  title: Heading,
  caption: Text,
  note: MessageSquare,
};

/** Same cap as the dataset composer (`datasetChat.placeholder`'s input) and
 * as the action's own guard. */
const MESSAGE_MAX_LENGTH = 500;

export interface CopilotReply {
  applied: AppliedChip[];
  refused: CopilotRefusal[];
  /** How many of the stored commands this chart could not take. */
  dropped: number;
  /** The assistant's own line (`envelope.text`) — also the whole reply for a
   * clarification/refusal envelope, which carries no commands. */
  text: string;
  /** The dataset_turns row the 👍/👎 vote attaches to; null = nothing stored
   * to vote on, so no vote is offered. */
  turnId: number | null;
  netCost: number | null;
  /** The ids the card minted while dispatching `applied` — what one Undo
   * walks back. */
  commandIds: string[];
  /** The reader's own message, re-sent by Retry. */
  message: string;
}

/** The applied chips + the refusal lines. Shared by the card's live reply and
 * by DatasetChat's replayed `edit` message, so the two read identically. */
export function RecipeChips(props: {
  applied: { label: string; icon: ChipIcon }[];
  refused: CopilotRefusal[];
  lang: Lang;
  onOpen?: (target: ChipOpens) => void;
}): ReactNode {
  const { applied, refused, lang, onOpen } = props;
  if (applied.length === 0 && refused.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {applied.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {applied.map((chip, i) => {
            const Icon = CHIP_ICON[chip.icon];
            const target = opensForIcon(chip.icon);
            return (
              <button
                key={`${chip.label}-${i}`}
                type="button"
                // Nothing to open, or nobody listening: the chip is a label,
                // and saying so keeps it out of the tab order.
                disabled={onOpen === undefined || target === 'none'}
                onClick={() => onOpen?.(target)}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground disabled:cursor-default"
              >
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{chip.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {refused.map((item, i) => (
        <p key={`${item.request}-${i}`} className="text-xs text-warning">
          {refusalLine(item, lang)}
        </p>
      ))}
    </div>
  );
}

function ReplyStrip(props: {
  reply: CopilotReply;
  lang: Lang;
  busy: boolean;
  onUndoReply: (commandIds: string[]) => void;
  onRetry: (message: string) => void;
  onFeedback: (turnId: number, vote: 'up' | 'down') => void;
  onOpen: (target: ChipOpens) => void;
}): ReactNode {
  const { reply, lang, busy, onUndoReply, onRetry, onFeedback, onOpen } = props;
  const [voted, setVoted] = useState(false);
  const turnId = reply.turnId;

  function vote(value: 'up' | 'down'): void {
    if (voted || turnId === null) return;
    setVoted(true);
    onFeedback(turnId, value);
  }

  return (
    <div className="mt-2 rounded-lg border border-border bg-muted/40 p-2.5">
      <p className="text-sm text-foreground">{reply.text}</p>
      <RecipeChips applied={reply.applied} refused={reply.refused} lang={lang} onOpen={onOpen} />
      {reply.dropped > 0 ? (
        <p className="mt-1.5 text-xs text-warning">{t(lang, reply.dropped === 1 ? 'chart.copilot.dropped' : 'chart.copilot.droppedMany')}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {reply.commandIds.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onUndoReply(reply.commandIds)}>
            {t(lang, 'chart.copilot.undoReply')}
          </Button>
        ) : null}
        {/* Plainly labelled: a retry is a NEW model call and a new charge. */}
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onRetry(reply.message)}>
          {t(lang, 'chart.copilot.retry')}
        </Button>
        {turnId !== null ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={voted}
              aria-label={t(lang, 'chart.copilot.thumbsUp')}
              title={t(lang, 'chart.copilot.thumbsUp')}
              onClick={() => vote('up')}
            >
              <ThumbsUp className="size-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={voted}
              aria-label={t(lang, 'chart.copilot.thumbsDown')}
              title={t(lang, 'chart.copilot.thumbsDown')}
              onClick={() => vote('down')}
            >
              <ThumbsDown className="size-4" aria-hidden="true" />
            </Button>
          </>
        ) : null}
        {/* The ONE digit-bearing string on this surface (file header). */}
        {reply.netCost !== null ? (
          <span className="ml-auto text-xs text-muted-foreground">{t(lang, 'chart.copilot.cost', { n: reply.netCost })}</span>
        ) : null}
      </div>
      {voted ? <p className="mt-1 text-xs text-muted-foreground">{t(lang, 'chart.copilot.feedbackThanks')}</p> : null}
    </div>
  );
}

export function ChartCopilotInput(props: {
  lang: Lang;
  busy: boolean;
  examples: ExampleChip[];
  reply: CopilotReply | null;
  error: string | null;
  onSend: (message: string) => void;
  onUndoReply: (commandIds: string[]) => void;
  onRetry: (message: string) => void;
  onFeedback: (turnId: number, vote: 'up' | 'down') => void;
  onOpen: (target: ChipOpens) => void;
}): ReactNode {
  const { lang, busy, examples, reply, error, onSend, onUndoReply, onRetry, onFeedback, onOpen } = props;
  const [value, setValue] = useState('');
  /** Phones (< sm) start collapsed to a single chip: the card is already
   * tall there, and a permanent composer under it pushes the chart itself
   * off screen. Expanding is one tap and sticks for the session. */
  const [expanded, setExpanded] = useState(false);
  const placeholder = t(lang, 'chart.copilot.placeholder');

  function submit(): void {
    const message = value.trim();
    if (message.length === 0 || busy) return;
    setValue('');
    onSend(message);
  }

  return (
    <div className="mt-3" aria-label={t(lang, 'chart.copilot.regionLabel')} role="group">
      {expanded ? null : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex min-h-11 items-center rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground sm:hidden"
        >
          {placeholder}
        </button>
      )}
      <div className={expanded ? '' : 'max-sm:hidden'}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex gap-2"
        >
          <Input
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={busy}
            maxLength={MESSAGE_MAX_LENGTH}
            placeholder={placeholder}
            className="h-9 flex-1"
          />
          <Button type="submit" size="sm" className="h-9 px-3" disabled={busy || value.trim().length === 0}>
            {t(lang, busy ? 'chart.copilot.busy' : 'chart.copilot.send')}
          </Button>
        </form>
        {/* The examples are the empty state: once there is a reply, the chips
          * that describe what CHANGED take their place. */}
        {reply === null && !busy && examples.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label={t(lang, 'chart.copilot.examplesLabel')} role="group">
            {examples.map((example) => (
              <button
                key={example.message}
                type="button"
                onClick={() => onSend(example.message)}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {example.label}
              </button>
            ))}
          </div>
        ) : null}
        {error !== null ? (
          <p role="status" className="mt-1.5 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {reply !== null ? (
          <ReplyStrip
            // A new reply is a new strip: the 👍/👎 pair belongs to THAT turn,
            // so the vote state must not carry over.
            key={reply.turnId ?? reply.message}
            reply={reply}
            lang={lang}
            busy={busy}
            onUndoReply={onUndoReply}
            onRetry={onRetry}
            onFeedback={onFeedback}
            onOpen={onOpen}
          />
        ) : null}
      </div>
    </div>
  );
}
