// Chart co-pilot phase 1 server actions (session 112, ADR 056, migration 034,
// docs/open-questions.md #274). Own tiny file, mirroring
// chart-headline-actions.ts line for line: chart.tsx imports only this, never
// web/app/actions.ts's much larger graph.
//
// Zero LLM calls: the reader's own command log goes in and comes out again.
// The stored value is ALWAYS the PARSED log (parseCommandLog re-validates
// every command and re-sanitises presentation patches), never the raw input —
// so a hand-crafted POST can never put an unknown command kind or an unknown
// presentation key into the row that a later replay would read back.
'use server';

import { parseCommandLog } from '../lib/chart-commands.ts';
import { getOwnChartEdits, upsertChartEdits } from '../backend/chart/edits-store.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { reportError } from '../lib/error-report.ts';

function validAuditId(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0;
}

export type FetchChartEditsResponse = { ok: true; log: unknown[] | null } | { ok: false };

export async function fetchChartEdits(rawAuditId: unknown): Promise<FetchChartEditsResponse> {
  try {
    const userId = await currentUserId();
    if (userId === null) return { ok: false };
    if (!validAuditId(rawAuditId)) return { ok: false };
    const log = await getOwnChartEdits(getDb(), rawAuditId, userId);
    return { ok: true, log };
  } catch (e) {
    await reportError('fetchChartEdits', e, {});
    return { ok: false };
  }
}

export interface SaveChartEditsResponse {
  ok: boolean;
}

export async function saveChartEdits(rawAuditId: unknown, rawLog: unknown): Promise<SaveChartEditsResponse> {
  try {
    const userId = await currentUserId();
    if (userId === null) return { ok: false };
    if (!validAuditId(rawAuditId)) return { ok: false };
    const log = parseCommandLog(rawLog);
    // `null` = the whole log failed the schema. Refuse rather than store a
    // partial or a raw value; the client keeps its own in-memory history, so
    // nothing the reader sees is lost by a refused save.
    if (log === null) return { ok: false };
    const ok = await upsertChartEdits(getDb(), { auditAnswerId: rawAuditId, userId, log });
    return { ok };
  } catch (e) {
    await reportError('saveChartEdits', e, {});
    return { ok: false };
  }
}
