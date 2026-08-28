// #65 / WP25: the web layer's one-line durable error reporter — a thin,
// NEVER-THROWING wrapper over src/db/error-log.ts logError (via the
// web/backend symlink) that supplies the pooled Db itself, so a catch site
// adds exactly one awaited line and keeps its existing behavior (rethrow /
// return an error response) byte-identical.
//
// Fail-open belt on top of a fail-open logger, deliberately: logError already
// swallows its own failures, but THIS wrapper also guards getDb() (env-less
// contexts throw at pool construction) and any violation of that no-throw
// contract — the WP25 pin is "a throwing logger must not change the action's
// outcome", and this is the single place the web layer enforces it
// (web/app/actions-errorlog.test.ts drives a logError stub that REJECTS).
//
// GDPR posture (the migration-022 invariant): `extra` context must NEVER
// carry raw question/answer text — reference what was processed by
// requestId/audit id, never by content. Message/stack extraction and all
// size bounds live in logError itself.
import { logError } from '../backend/db/error-log.ts';
import { getDb } from './db.ts';

export async function reportError(
  source: string,
  error: unknown,
  context?: { requestId?: string | null; userId?: string | null; extra?: Record<string, unknown> },
): Promise<void> {
  try {
    await logError(getDb(), {
      source,
      error,
      requestId: context?.requestId ?? null,
      userId: context?.userId ?? null,
      context: context?.extra ?? null,
    });
  } catch (logFailure) {
    // The original error was already console-logged by the catch site; only
    // the durable copy is lost. Never rethrow — that would replace it.
    console.error(`error_log report failed for source '${source}':`, logFailure);
  }
}
