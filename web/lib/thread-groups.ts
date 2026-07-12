// WP135 chat workspace (ADR 033): the sidebar groups threads by day —
// vandaag / gisteren / afgelopen 7 dagen / ouder — using Europe/Amsterdam day
// boundaries (the product's own timezone, matching every other date surface).
// Pure leaf so the bucketing is deterministic and testable independent of the
// component.
import type { ThreadSummary } from '../backend/threads/index.ts';

export type ThreadGroupLabel = 'Vandaag' | 'Gisteren' | 'Afgelopen 7 dagen' | 'Ouder';

export interface ThreadGroup {
  label: ThreadGroupLabel;
  threads: ThreadSummary[];
}

/** The Amsterdam calendar day of an instant, as a UTC-midnight Date — so day
 * differences are whole-day integers regardless of DST. */
function amsterdamDay(iso: string): number {
  // en-CA formats as YYYY-MM-DD in the requested timezone.
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
  return Date.parse(`${ymd}T00:00:00Z`) / 86_400_000;
}

/** Bucket the (already most-recent-first) threads. `now` is injectable for
 * deterministic tests; production passes the current instant. Empty groups are
 * dropped, and the order is fixed. */
export function groupThreads(threads: ThreadSummary[], now: Date = new Date()): ThreadGroup[] {
  const today = amsterdamDay(now.toISOString());
  const buckets: Record<ThreadGroupLabel, ThreadSummary[]> = {
    Vandaag: [],
    Gisteren: [],
    'Afgelopen 7 dagen': [],
    Ouder: [],
  };
  for (const thread of threads) {
    const daysAgo = today - amsterdamDay(thread.lastActivityAt);
    if (daysAgo <= 0) buckets.Vandaag.push(thread);
    else if (daysAgo === 1) buckets.Gisteren.push(thread);
    else if (daysAgo <= 7) buckets['Afgelopen 7 dagen'].push(thread);
    else buckets.Ouder.push(thread);
  }
  const order: ThreadGroupLabel[] = ['Vandaag', 'Gisteren', 'Afgelopen 7 dagen', 'Ouder'];
  return order
    .map((label) => ({ label, threads: buckets[label] }))
    .filter((group) => group.threads.length > 0);
}
