// #74 + #117 (WP16 follow-up): the "mijn aanvragen" at-a-glance line above the
// question history, plus the live poll that makes a pending -> delivered /
// failed transition appear WITHOUT a manual page refresh.
//
// Architecture (#117 decision): a router.refresh() poll, NOT a dedicated
// status endpoint. While any onboarding request is in flight, this component
// re-runs the CURRENT route's Server Components every POLL_INTERVAL_MS via
// next/navigation's router.refresh(). That choice over a lightweight
// /api/onboarding-status endpoint is deliberate:
//   - a status endpoint could only flip the label text; the DELIVERED answer
//     itself (a new audit-row entry with real answer text, produced by
//     src/billing/history.ts's merge) would still need a full server
//     re-render to appear — which is exactly what #117 complains about. The
//     refresh brings the label change AND the delivered answer in one step.
//   - zero new API surface: no new auth-guarded route, no client-side state
//     merge, nothing new that could leak another user's rows — the refresh
//     re-runs the SAME server reads (getQuestionHistory scoped to the
//     session's own userId) that rendered the page in the first place.
// Trade-off accepted: one refresh re-runs all of the page's server reads
// (balance + history + pricing), heavier per tick than a status-only
// endpoint. Bounded by construction: it only runs while an in-flight entry
// exists in the SERVER-rendered list (the prop below — never a client-held
// flag, so a refresh that shows no in-flight items stops the poll on its own),
// ticks are skipped while the tab is hidden, and delivery typically lands in
// minutes (the acknowledgment's own promise), so a poll rarely lives long.
//
// The poll interval and the copy are deterministic and fixed (the #84
// convention: Dutch product copy is a template, never LLM-authored).
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** 20s: sane middle of the #117 "light poll" range — fast enough that a
 * minutes-scale delivery appears promptly, slow enough that the re-run of the
 * page's server reads is negligible DB load for the one-or-two users who ever
 * have a request in flight at once. */
export const ONBOARDING_POLL_INTERVAL_MS = 20_000;

/**
 * Renders the amber in-behandeling summary line and polls while any request
 * is in flight. `inFlightCount` comes from the SERVER-rendered history
 * (QuestionHistory counts its pending/running onboarding entries), so every
 * refresh re-decides it from the database — the poll stops the moment a
 * refresh comes back with none in flight, and never outlives the page.
 */
export function OnboardingLiveStatus({ inFlightCount }: { inFlightCount: number }) {
  const router = useRouter();

  useEffect(() => {
    if (inFlightCount === 0) return;
    const tick = (): void => {
      // A hidden tab skips its ticks (no point hammering the server for a
      // page nobody is looking at); the same handler doubles as the
      // visibilitychange listener, so returning to the tab refreshes
      // immediately instead of waiting out the current interval.
      if (document.visibilityState === 'hidden') return;
      router.refresh();
    };
    const interval = setInterval(tick, ONBOARDING_POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [inFlightCount, router]);

  if (inFlightCount === 0) return null;

  return (
    // role="status": a polite live region — screen readers announce the
    // count changing (or the line disappearing content-wise) after a refresh.
    <p role="status" className="rounded-lg border border-warn bg-warn-soft p-2 text-xs text-warn">
      {inFlightCount === 1
        ? 'Er is 1 aanvraag bij het CBS in behandeling — de status hieronder wordt automatisch bijgewerkt.'
        : `Er zijn ${inFlightCount} aanvragen bij het CBS in behandeling — de status hieronder wordt automatisch bijgewerkt.`}
    </p>
  );
}
