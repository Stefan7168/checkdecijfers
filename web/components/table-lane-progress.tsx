'use client';

// Breadth step 5 (Task 6): the progress bubble a table-lane job shows in the
// chat while the background job fetches the CBS table. It polls the
// pollTableLane Server Action (the request path only reads OUR database - the
// job, not this component, talks to CBS) every 2 s for the first 60 s, then
// every 15 s up to 10 minutes in total, and hands the audited outcome to its
// parent. Nothing here builds, formats or re-derives an answer.
import { useEffect, useRef, useState } from 'react';
import { pollTableLane } from '../app/actions.ts';
import type { GatedResponse } from '../backend/billing/index.ts';
import { useT } from '../lib/i18n/lang-provider.tsx';
import { AnswerSkeleton } from './loading-skeletons.tsx';
import type { TableLaneFoundTable } from '../lib/table-lane.ts';

/** Poll cadence: every second while a typical answer lands (session 153, #363 —
 * a 2 s step added ~1 s on average to every answer), then every 2 s for the
 * rest of the first minute, then slow until the 10-minute budget. */
export const TABLE_LANE_FIRST_POLL_MS = 1_000;
export const TABLE_LANE_FIRST_POLL_UNTIL_MS = 20_000;
export const TABLE_LANE_FAST_POLL_MS = 2_000;
export const TABLE_LANE_SLOW_POLL_MS = 15_000;
/** After this much waiting the bubble adds the over-budget line. */
export const TABLE_LANE_SLOW_AFTER_MS = 60_000;
/** After this much waiting the bubble stops polling and tells the reader the
 * answer will still arrive in the conversation. */
export const TABLE_LANE_GIVE_UP_MS = 600_000;

export function TableLaneProgress({
  rowId,
  phase,
  table,
  onDone,
  onGone,
  onSlow,
}: {
  rowId: number;
  phase: 'fetching' | 'slow';
  /** Session 153 (#363): the table the finder picked — named in the bubble. */
  table?: TableLaneFoundTable;
  /** The row finished: its audited outcome (an answer, a button question or a
   * refusal) and the thread the job attached it to. */
  onDone: (outcome: { gated: GatedResponse; threadId: number | null }) => void;
  /** Unknown row, or the polling budget is used up. */
  onGone: () => void;
  /** 60 s passed - the parent flips `phase` to 'slow'. */
  onSlow: () => void;
}) {
  const t = useT();
  // The latest callbacks, so a parent re-render never restarts the poller.
  const callbacks = useRef({ onDone, onGone, onSlow });
  // The job's real state from the last poll: 'pending' (queued) or 'running'.
  const [status, setStatus] = useState<'pending' | 'running' | null>(null);
  callbacks.current = { onDone, onGone, onSlow };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    const elapsed = () => Date.now() - startedAt;
    let slowReported = false;

    const schedule = () => {
      const delay =
        elapsed() < TABLE_LANE_FIRST_POLL_UNTIL_MS
          ? TABLE_LANE_FIRST_POLL_MS
          : elapsed() < TABLE_LANE_SLOW_AFTER_MS
            ? TABLE_LANE_FAST_POLL_MS
            : TABLE_LANE_SLOW_POLL_MS;
      timer = setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      let outcome: Awaited<ReturnType<typeof pollTableLane>> | null = null;
      try {
        outcome = await pollTableLane(rowId);
      } catch {
        // A failed poll (network blip, redeploy) is not the end of the job:
        // keep going until the budget is used up.
        outcome = null;
      }
      if (cancelled) return;
      if (outcome !== null && outcome.status === 'done') {
        callbacks.current.onDone({ gated: outcome.gated, threadId: outcome.threadId });
        return;
      }
      if (outcome !== null && (outcome.status === 'pending' || outcome.status === 'running')) {
        setStatus(outcome.status);
      }
      if (outcome !== null && outcome.status === 'gone') {
        callbacks.current.onGone();
        return;
      }
      if (elapsed() >= TABLE_LANE_GIVE_UP_MS) {
        callbacks.current.onGone();
        return;
      }
      if (!slowReported && elapsed() >= TABLE_LANE_SLOW_AFTER_MS) {
        slowReported = true;
        callbacks.current.onSlow();
      }
      schedule();
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [rowId]);

  return (
    <div className="flex flex-col gap-2" data-testid="table-lane-progress">
      {table !== undefined ? (
        <div className="text-left text-sm text-foreground" data-testid="table-lane-found">
          {table.title !== null ? t('tableLane.found', { id: table.id, title: table.title }) : t('tableLane.foundNoTitle', { id: table.id })}
        </div>
      ) : null}
      <div className="text-left text-sm text-muted-foreground" role="status">
        {status === 'running' ? t('tableLane.running') : status === 'pending' ? t('tableLane.queued') : t('tableLane.progress')}
      </div>
      <AnswerSkeleton />
      {phase === 'slow' ? <p className="text-left text-xs text-muted-foreground">{t('tableLane.slow')}</p> : null}
    </div>
  );
}
