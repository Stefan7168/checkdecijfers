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
'use server';

import { getDataset } from '../backend/attachments/store.ts';
import { getDatasetTurnById } from '../backend/attachments/read.ts';
import {
  countPublications,
  deletePublicationForTurn,
  getPublicationForTurn,
  MAX_PUBLICATIONS_PER_USER,
  PUBLICATION_SOURCE_LINE_MAX,
  upsertPublication,
} from '../backend/attachments/publications.ts';
import { CHART_EDITS_MAX_JSON } from '../backend/chart/edits-store.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { reportError } from '../lib/error-report.ts';
import { buildPublishedChart } from '../lib/own-chart-publication.ts';

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

/** Strips ASCII control characters (incl. DEL), trims, then applies the
 * empty-string-is-null and length rules (spec §3.2 step 4). Non-string,
 * non-nullish input (e.g. a number) fails rather than being coerced. */
export function normalizeSourceLine(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false };
  // eslint-disable-next-line no-control-regex -- deliberately stripping control chars
  const stripped = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (stripped === '') return { ok: true, value: null };
  if (stripped.length > PUBLICATION_SOURCE_LINE_MAX) return { ok: false };
  return { ok: true, value: stripped };
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

    if (JSON.stringify(log).length > CHART_EDITS_MAX_JSON) return { ok: false, reason: 'invalid' };

    const built = buildPublishedChart(dataset, turn, log);
    if (!built.ok) return { ok: false, reason: 'invalid' };
    if (built.dropped > 0) return { ok: false, reason: 'changed' };

    const normalized = normalizeSourceLine(sourceLine);
    if (!normalized.ok) return { ok: false, reason: 'invalid' };

    const existing = await getPublicationForTurn(db, userId, turnId);
    if (existing === null && (await countPublications(db, userId)) >= MAX_PUBLICATIONS_PER_USER) {
      return { ok: false, reason: 'limit' };
    }

    const result = await upsertPublication(db, {
      userId,
      datasetId: dataset.id,
      datasetTurnId: turnId,
      log: log as unknown[],
      sourceLine: normalized.value,
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
