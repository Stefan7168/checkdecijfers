// The table-lane job KICK (breadth step 5, Task 4): after askQuestion /
// replyToTableLane queue a table_lane_requests row, the Server Action fires the
// job route itself (through next/server's after()) so the answer starts within
// seconds instead of waiting for the daily onboarding-cron sweep (which also
// runs the table-lane job once — the backstop for a failed kick).
//
// Same fail-soft contract as the onboarding kick, through the ONE shared
// implementation in web/lib/cron-kick.ts (ruling R11): it cannot throw, never
// affects money or the routing turn, and only waits for the dispatch — the job
// route runs as its own invocation (its path must never enable
// supportsCancellation, see cron-kick.ts).
import { kickCronRoute, type KickDeps } from './cron-kick.ts';

export type { KickDeps } from './cron-kick.ts';

/** Fire the table-lane job route once, fail-soft. */
export async function kickTableLaneJob(deps: KickDeps = {}): Promise<void> {
  return kickCronRoute(
    {
      path: '/api/table-lane-job',
      label: 'table-lane kick',
      routeLabel: 'job route',
      backstopNote: 'the daily onboarding-cron sweep will pick the row up',
    },
    deps,
  );
}
