// Chart co-pilot server actions (session 112 phase 1 / session 113 phase 2,
// ADR 056, migrations 034 + 035, docs/open-questions.md #274). Own tiny
// file, mirroring chart-headline-actions.ts line for line: chart.tsx
// imports only this, never web/app/actions.ts's much larger graph.
//
// Zero LLM calls: the reader's own command log goes in and comes out again.
// The stored value is ALWAYS the PARSED log (parseCommandLog re-validates
// every command and re-sanitises presentation patches), never the raw input —
// so a hand-crafted POST can never put an unknown command kind or an unknown
// presentation key into the row that a later replay would read back.
'use server';

import { isChartEditsKey } from '../lib/chart-edits-key.ts';
import { parseCommandLog } from '../lib/chart-commands.ts';
import { getOwnChartEdits, upsertChartEdits } from '../backend/chart/edits-store.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { reportError } from '../lib/error-report.ts';

export type FetchChartEditsResponse = { ok: true; log: unknown[] | null } | { ok: false };

export async function fetchChartEdits(rawKey: unknown): Promise<FetchChartEditsResponse> {
  try {
    const userId = await currentUserId();
    if (userId === null) return { ok: false };
    if (!isChartEditsKey(rawKey)) return { ok: false };
    const log = await getOwnChartEdits(getDb(), rawKey, userId);
    return { ok: true, log };
  } catch (e) {
    await reportError('fetchChartEdits', e, {});
    return { ok: false };
  }
}

export interface SaveChartEditsResponse {
  ok: boolean;
}

export async function saveChartEdits(rawKey: unknown, rawLog: unknown): Promise<SaveChartEditsResponse> {
  try {
    const userId = await currentUserId();
    if (userId === null) return { ok: false };
    if (!isChartEditsKey(rawKey)) return { ok: false };
    const log = parseCommandLog(rawLog);
    // `null` = the whole log failed the schema. Refuse rather than store a
    // partial or a raw value; the client keeps its own in-memory history, so
    // nothing the reader sees is lost by a refused save.
    if (log === null) return { ok: false };
    const ok = await upsertChartEdits(getDb(), { key: rawKey, userId, log });
    return { ok };
  } catch (e) {
    await reportError('saveChartEdits', e, {});
    return { ok: false };
  }
}
