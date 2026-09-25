// Own-data publish (ADR 057, session 127, Task 3) — the publish/unpublish
// Server Actions (spec §3.2). Own tiny file, same rationale as
// embed-actions.ts's own header comment: chart.tsx (a client component)
// must never drag this module's DB/audit graph toward the client bundle by
// importing it from a shared barrel alongside other client-facing helpers.
//
// Fails closed: `OWN_DATA_PUBLISH_ENABLED !== '1'` refuses before anything
// else runs (no `currentUserId()` call, no DB touch), matching the
// `EMBED_TOKEN_SECRET`/`PRO_SUBSCRIPTIONS_ENABLED` dormancy pattern used
// throughout embed-actions.ts.
//
// Ownership is by `user_id` PARAMETER, never trusted from the caller's
// input: `getDatasetTurnById` (read.ts) is NOT user-scoped, so the loaded
// turn's own `userId` is compared against the signed-in caller's id here;
// `getDataset` (store.ts) IS user-scoped (its query already binds
// `user_id`), and its loaded row's `id` is compared back against the turn's
// `datasetId` as defence in depth against the two ever silently disagreeing.
//
// `changed` (spec §3.2 step 3) means the stored log would not replay
// EXACTLY against this chart right now — `buildPublishedChart`'s `dropped`
// count is nonzero. What is stored is exactly what the author sees, never a
// silently different chart; the client is expected to flush pending edits
// (its own current serialized log) before calling this, so a `changed`
// result should be rare in practice, not a caller bug to paper over.
//
// Session 128 (ADR 057 ruling 1, "freeze the look at publish time"): this
// function is also where the author's account chart style is read and
// frozen into the publication row (`resolveAuthorStyleForPublish` below) —
// the public page (web/app/embed/own/[publicId]/page.tsx) no longer reads
// it live on every visitor request.
'use server';

import type { Db } from '../backend/db/types.ts';
import { getDataset } from '../backend/attachments/store.ts';
import { getDatasetTurnById } from '../backend/attachments/read.ts';
import {
  countPublications,
  deletePublicationForTurn,
  getPublicationForTurn,
  MAX_PUBLICATIONS_PER_USER,
  upsertPublication,
} from '../backend/attachments/publications.ts';
import { CHART_EDITS_MAX_JSON } from '../backend/chart/edits-store.ts';
import { chartStylesTablePresent, getUserChartStyle } from '../backend/chart/user-styles.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { reportError } from '../lib/error-report.ts';
import { buildPublishedChart, firstRenderMatchesEnvelope } from '../lib/own-chart-publication.ts';
import { parseCommandLog } from '../lib/chart-commands.ts';
// Fix round 1: normalizeSourceLine is a plain synchronous function, which
// Next's server-boundary check refuses as an export of a 'use server' file
// (bare tsc doesn't catch it) — it now lives in its own pure lib module and
// is imported, NEVER re-exported, here. sanitizeOverridesStrict (session
// 128) is the same kind of import for the same reason — see that module's
// own header for why it moved out of chart-style-actions.ts.
import { normalizeSourceLine } from '../lib/publication-source-line.ts';
import { sanitizeOverridesStrict } from '../lib/chart-style-sanitize.ts';

export type PublishFailure =
  | 'disabled'
  | 'unauthenticated'
  | 'forbidden'
  | 'invalid'
  | 'changed'
  | 'limit'
  | 'unavailable'
  | 'error';

export type PublishOwnChartResult = { ok: true; publicId: string } | { ok: false; reason: PublishFailure };

function isValidTurnId(turnId: number): boolean {
  return Number.isInteger(turnId) && turnId > 0;
}

/** Session 128 (ADR 057 ruling 1, "freeze the look at publish time"): reads
 * the author's CURRENT account chart style, right here at publish time —
 * never on the public page's own request path, which used to call
 * `getUserChartStyle` fresh on every visitor request (the v1 "known
 * difference" ADR 057 documented and this session closes). Re-validated
 * through the same allow-list `saveMyChartStyle` uses
 * (`sanitizeOverridesStrict`) before it is ever stored — "never store
 * unvalidated JSON" — rather than trusting that the row was already clean
 * when it was originally saved. Same fail-soft posture the public page used
 * to have at request time: no saved style, an absent table, or a thrown
 * lookup error all degrade to null (no default look) rather than failing
 * the publish — a style is a nice-to-have presentation default, not
 * something worth refusing "Publish" over. A thrown error is logged with a
 * short fixed message and no payload (same C1 discipline the page's own
 * try/catch documents), never via `reportError`: like the page's own
 * comment says, this isn't a server fault worth paging anyone over. */
async function resolveAuthorStyleForPublish(db: Db, userId: string): Promise<Record<string, unknown> | null> {
  try {
    if (!(await chartStylesTablePresent(db))) return null;
    const styleRow = await getUserChartStyle(db, userId);
    return styleRow === null ? null : sanitizeOverridesStrict(styleRow.style);
  } catch {
    console.error('own-chart publish: author chart style lookup failed; publishing without it');
    return null;
  }
}

export async function publishOwnChart(turnId: number, log: unknown, sourceLine: unknown): Promise<PublishOwnChartResult> {
  if (process.env.OWN_DATA_PUBLISH_ENABLED !== '1') return { ok: false, reason: 'disabled' };

  const userId = await currentUserId();
  if (userId === null) return { ok: false, reason: 'unauthenticated' };

  if (!isValidTurnId(turnId)) return { ok: false, reason: 'forbidden' };

  try {
    const db = getDb();

    const turn = await getDatasetTurnById(db, turnId);
    if (turn === null || turn.userId !== userId || turn.kind !== 'chart' || !turn.chartEmitted) {
      return { ok: false, reason: 'forbidden' };
    }

    const dataset = await getDataset(db, userId, turn.datasetId);
    if (dataset === null || dataset.status !== 'ready' || dataset.id !== turn.datasetId) {
      return { ok: false, reason: 'forbidden' };
    }

    // B4: shape BEFORE size. JSON.stringify(undefined) is undefined (not a
    // string), so `.length` on it threw a TypeError that landed in the catch
    // below as an 'error' + a reportError — a malformed client payload is
    // simply 'invalid', not a server fault worth reporting.
    if (!Array.isArray(log)) return { ok: false, reason: 'invalid' };
    if (JSON.stringify(log).length > CHART_EDITS_MAX_JSON) return { ok: false, reason: 'invalid' };
    // Session 128 (#322 I-4a): the WHOLE log through the capped command
    // schema (at most CHART_COMMAND_LOG_MAX real commands) before anything is
    // built — the size check above alone let a crafted 64 KB log of 377
    // overlay commands through. The public page applies the same parse
    // (inside buildPublishedChart) on every read. What is stored is the
    // PARSED log, never the raw client payload — the same rule
    // chart-edits-actions.ts's saveChartEdits follows.
    const parsedLog = parseCommandLog(log);
    if (parsedLog === null) return { ok: false, reason: 'invalid' };

    const built = buildPublishedChart(dataset, turn, parsedLog);
    if (!built.ok) return { ok: false, reason: 'invalid' };
    if (built.dropped > 0) return { ok: false, reason: 'changed' };
    // m3 (ruling R16, same guard as the public page): if the turn's first
    // render no longer names the same series, in order, as the chart the
    // turn stored, the public page would show "not available" for this link
    // — so the author is told 'changed' here instead of "published".
    if (!firstRenderMatchesEnvelope(dataset, turn)) return { ok: false, reason: 'changed' };

    const normalized = normalizeSourceLine(sourceLine);
    if (!normalized.ok) return { ok: false, reason: 'invalid' };

    const existing = await getPublicationForTurn(db, userId, turnId);
    if (existing === null && (await countPublications(db, userId)) >= MAX_PUBLICATIONS_PER_USER) {
      return { ok: false, reason: 'limit' };
    }

    // Session 128 (ADR 057 ruling 1): resolved AFTER every refusal above (no
    // point reading a style for a publish that's about to fail anyway) but
    // BEFORE the write — "Update published version" is this SAME function
    // called again, so the style is re-resolved and re-frozen on every call,
    // never stale from the first publish.
    const style = await resolveAuthorStyleForPublish(db, userId);

    const result = await upsertPublication(db, {
      userId,
      datasetId: dataset.id,
      datasetTurnId: turnId,
      log: parsedLog,
      sourceLine: normalized.value,
      style,
    });
    if (result === null) return { ok: false, reason: 'unavailable' };

    return { ok: true, publicId: result.publicId };
  } catch (e) {
    await reportError('publishOwnChart', e, { userId, extra: { turnId } });
    return { ok: false, reason: 'error' };
  }
}

export async function unpublishOwnChart(turnId: number): Promise<{ ok: boolean }> {
  if (process.env.OWN_DATA_PUBLISH_ENABLED !== '1') return { ok: false };
  const userId = await currentUserId();
  if (userId === null) return { ok: false };
  if (!isValidTurnId(turnId)) return { ok: false };

  const db = getDb();
  const deleted = await deletePublicationForTurn(db, userId, turnId);
  return { ok: deleted };
}

/** Lets the publish dialog show the current state (published vs not, and
 * the current source line) without duplicating `publications.ts`'s row
 * shape into the client. */
export async function getOwnChartPublication(turnId: number): Promise<{ publicId: string; sourceLine: string | null } | null> {
  if (process.env.OWN_DATA_PUBLISH_ENABLED !== '1') return null;
  const userId = await currentUserId();
  if (userId === null) return null;
  if (!isValidTurnId(turnId)) return null;

  const db = getDb();
  const row = await getPublicationForTurn(db, userId, turnId);
  return row === null ? null : { publicId: row.publicId, sourceLine: row.sourceLine };
}
