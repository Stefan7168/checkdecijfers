// The signed-in account default for chart styling's two Server Actions
// (WP218 phase 2, owner decision C, ADR 039). Deliberately kept to its own
// tiny file — the db client + current-user auth check + the store + the
// error reporter, nothing from app/actions.ts's much larger graph — the
// same usage-actions.ts precedent, so that chart.tsx (a client component)
// importing this module never drags the chat pipeline's dependencies toward
// the client bundle. chart.tsx imports ONLY this file, never actions.ts.
//
// `raw` is untrusted input straight from the browser (the panel's current
// resolved.values) — sanitizeOverrides is the same allow-list every other
// overrides input goes through, so a stale/removed key or outright garbage
// can never reach the store or get persisted.
'use server';

import { deleteUserChartStyle, saveUserChartStyle } from '../backend/chart/user-styles.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { sanitizeOverrides } from '../lib/chart-presentation.ts';
import { reportError } from '../lib/error-report.ts';

export async function saveMyChartStyle(
  raw: unknown,
): Promise<{ ok: true } | { ok: false; reason: 'unauthenticated' | 'unavailable' | 'too-large' | 'error' }> {
  const userId = await currentUserId();
  if (userId === null) return { ok: false, reason: 'unauthenticated' };
  try {
    const clean = sanitizeOverrides(raw);
    return await saveUserChartStyle(getDb(), userId, clean);
  } catch (e) {
    await reportError('saveMyChartStyle', e, { userId });
    return { ok: false, reason: 'error' };
  }
}

export async function forgetMyChartStyle(): Promise<{ ok: boolean }> {
  const userId = await currentUserId();
  if (userId === null) return { ok: false };
  try {
    const ok = await deleteUserChartStyle(getDb(), userId);
    return { ok };
  } catch (e) {
    await reportError('forgetMyChartStyle', e, { userId });
    return { ok: false };
  }
}
