// The table lane's master switch (breadth step 5). Read ONLY through this
// helper — outside the 'use server' actions file, for the same reason as
// web/lib/english-answers.ts (a 'use server' module may export only async
// functions). Unset / anything but exactly '1' ⇒ off: no request is routed to
// the lane and the daily onboarding-cron sweep does not touch its queue.
// (Created in Task 4 for the sweep's gate; Task 5 adds the request-path types
// and helpers to this file.)
export function tableLaneEnabled(): boolean {
  return process.env.TABLE_LANE_ENABLED === '1';
}
