// #23 residual (missed-sync trigger, session 110, 2026-09-17): a registered,
// SERVED table (cbs_tables.status = 'active' — the same vocabulary
// src/query/run.ts and src/registry/coverage.ts use; 'needs_review' tables
// are already covered by the #108 catalog-status-flip / #23 quarantine
// alerts and are deliberately excluded here) that has not had a successful
// sync in longer than its own data allows for.
//
// Cheapest-mechanism-first (CLAUDE.md): NO new schema/column. The cadence
// baseline is derived entirely from data already in the DB —
// cbs_tables.last_sync_at (the pipeline's own commit timestamp, set only on
// a successful sync — see src/ingestion/pipeline.ts) and
// cbs_tables.period_semantics (registry/types.ts's PeriodSemantics, keyed by
// the same grain markers periods.ts parses: JJ yearly, KW quarterly, MM
// monthly). The finest grain a table carries sets how often CBS is expected
// to publish for it; the coarsest table (yearly-only) gets the most
// generous threshold.
import type { Db } from '../db/types.ts';
import type { ParsedPeriod } from './periods.ts';

type Grain = ParsedPeriod['grain'];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Generous on purpose — CBS release lags (a delayed monthly/quarterly
 * publication) must never fire a false alarm. Chosen as roughly 2x the
 * longest observed real-world CBS lag per grain (docs/07's ~22-days-after-
 * month-end note for the fastest series is the tightest real example we
 * have) rather than the label's own literal period length, so ordinary
 * publication jitter never crosses the line. 'unknown' (a table with no
 * period_semantics keys at all, or a grain outside JJ/KW/MM) gets the most
 * generous threshold — the same "never guess, refuse/wait" posture as R9:
 * we would rather under-alert on an unclassifiable table than spam the
 * owner about a table we don't understand the cadence of. */
export const SYNC_CADENCE_THRESHOLD_DAYS: Record<Grain | 'unknown', number> = {
  MM: 60,
  KW: 130,
  JJ: 420,
  unknown: 420,
};

/** The subset of a cbs_tables row this check needs. Deliberately narrow —
 * callers (the sync-watch cron) select exactly these columns, nothing else. */
export interface StaleSyncCandidateRow {
  tableId: string;
  /** cbs_tables.status. Only 'active' rows are considered "served" — see the
   * module comment above. */
  status: string;
  /** cbs_tables.last_sync_at, ISO string or null (never synced). */
  lastSyncAt: string | null;
  /** cbs_tables.period_semantics, parsed JSONB (registry/types.ts
   * PeriodSemantics) — only the KEYS (grains) matter here, never the Dutch
   * descriptive text. Null when the table has no registry defaults row. */
  periodSemantics: Record<string, string> | null;
}

export interface StaleSync {
  tableId: string;
  /** The last successful sync this table had, ISO string (never null — a
   * table with no sync at all is excluded, see findStaleSyncs). */
  lastSuccessfulSyncAt: string;
  thresholdDays: number;
  /** Whole days PAST the threshold (>= 1 — a table exactly at its threshold
   * is not yet overdue). */
  overdueDays: number;
}

/** The finest (most frequent) grain among a table's period_semantics keys,
 * or 'unknown' when there are none we recognize. Exported so a caller/test
 * can sanity-check a table's derived cadence independent of a full row. */
export function finestGrain(periodSemantics: Record<string, string> | null): Grain | 'unknown' {
  if (!periodSemantics) return 'unknown';
  const grains = new Set(Object.keys(periodSemantics));
  if (grains.has('MM')) return 'MM';
  if (grains.has('KW')) return 'KW';
  if (grains.has('JJ')) return 'JJ';
  return 'unknown';
}

export function cadenceThresholdDays(periodSemantics: Record<string, string> | null): number {
  return SYNC_CADENCE_THRESHOLD_DAYS[finestGrain(periodSemantics)];
}

/** Pure — no DB access, no clock read (the caller passes `now`so this stays
 * unit-testable with fixture rows). Returns every 'active' table whose last
 * successful sync is more than its derived cadence threshold days old,
 * ordered like the input. A table that has NEVER synced (lastSyncAt null) is
 * excluded — that is a different, already-visible gap (an active table with
 * no successful sync is a registration/onboarding bug, not a "missed"
 * recurring sync), not guessed at here. */
export function findStaleSyncs(rows: StaleSyncCandidateRow[], now: Date): StaleSync[] {
  const stale: StaleSync[] = [];
  for (const row of rows) {
    if (row.status !== 'active') continue;
    if (row.lastSyncAt == null) continue;
    const lastSync = new Date(row.lastSyncAt);
    if (Number.isNaN(lastSync.getTime())) continue;
    const thresholdDays = cadenceThresholdDays(row.periodSemantics);
    const daysSinceSync = Math.floor((now.getTime() - lastSync.getTime()) / MS_PER_DAY);
    const overdueDays = daysSinceSync - thresholdDays;
    if (overdueDays < 1) continue;
    stale.push({
      tableId: row.tableId,
      lastSuccessfulSyncAt: row.lastSyncAt,
      thresholdDays,
      overdueDays,
    });
  }
  return stale;
}

/** Daily-alert-fatigue dedupe WITHOUT a schema change (no "last alerted at"
 * column to add/read/write): the daily cron recomputes `overdueDays` fresh
 * every run from cbs_tables.last_sync_at alone, and this pure function
 * decides — from that single number — whether TODAY is a day the owner
 * should hear about it. `overdueDays` is already >= 1 by construction
 * (findStaleSyncs never returns less), so this fires on day 1 (the day it
 * first crosses the threshold, since the cron runs once daily and the prior
 * day's run would have seen overdueDays <= 0), then again every 7th day
 * after (8, 15, 22, ...) — never a fresh email every single day a table
 * stays overdue. */
export function shouldAlertToday(overdueDays: number): boolean {
  if (overdueDays < 1) return false;
  return (overdueDays - 1) % 7 === 0;
}

function parseJsonb<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

/** The one DB touch in this module — reads exactly the columns
 * findStaleSyncs needs, mapped the same way src/query/resolve.ts and
 * src/registry/coverage.ts already read this table (period_semantics is
 * jsonb; the pg driver may hand it back as a string or a pre-parsed object
 * depending on the pool, hence parseJsonb). Kept separate from the pure
 * findStaleSyncs above so the cadence RULE stays unit-testable without a DB,
 * while a caller (the sync-watch check) only needs one import for both. */
export async function loadStaleSyncCandidateRows(db: Db): Promise<StaleSyncCandidateRow[]> {
  const result = await db.query(
    `select id, status, last_sync_at, period_semantics
       from cbs_tables
      order by id`,
  );
  return result.rows.map((row) => ({
    tableId: row.id as string,
    status: row.status as string,
    lastSyncAt:
      row.last_sync_at == null ? null : new Date(row.last_sync_at as string | Date).toISOString(),
    periodSemantics: parseJsonb<Record<string, string> | null>(row.period_semantics, null),
  }));
}
