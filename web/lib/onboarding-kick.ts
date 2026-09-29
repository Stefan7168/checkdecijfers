// The onboarding-cron KICK (WP16 sub-part 2, #113): after triggerOnboarding
// commits (design §2), the app fires the cron route itself so the delivery
// re-run starts within minutes rather than waiting for the daily 06:00 UTC
// backstop sweep — the cadence that makes the acknowledgment's "meestal een
// kwestie van minuten" promise true.
//
// Fail-soft (#113, binding): a failed kick may NEVER affect money or the
// acknowledgment, and it cannot throw; the daily backstop cron still sweeps
// the queued row. The full contract (framework-free, bounded dispatch wait,
// never enable supportsCancellation on the kicked path) is documented once, in
// web/lib/cron-kick.ts.
//
// The implementation lives in web/lib/cron-kick.ts (shared with the table-lane
// kick, ruling R11); this wrapper only names the route and its log words —
// byte-identical behaviour and log lines to the pre-extraction version.
import { kickCronRoute, type KickDeps } from './cron-kick.ts';

export type { KickDeps } from './cron-kick.ts';

/** Fire the onboarding-cron route once, fail-soft (see web/lib/cron-kick.ts). */
export async function kickOnboardingJob(deps: KickDeps = {}): Promise<void> {
  return kickCronRoute(
    {
      path: '/api/onboarding-cron',
      label: 'onboarding kick',
      routeLabel: 'cron route',
      backstopNote: 'daily backstop cron will sweep',
    },
    deps,
  );
}
