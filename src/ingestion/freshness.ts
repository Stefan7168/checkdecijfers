// Is our stored copy of a CBS table older than what CBS has published? (#355, session 148.)
//
// The missed-sync alert in ./stale-sync.ts answers a different question — "was
// this table forgotten for longer than its cadence allows?" — with thresholds
// that are generous on purpose (60 days for a monthly table), so a table can
// be a whole publication behind for two months without a word. CBS's own
// `Modified` date (the Properties document, `CbsTableSchema.modified`) answers
// the sharper question directly: CBS changed the table after our last
// successful sync, so there is newer data — or a revision of the figures we
// show — that we do not hold yet. No guessing about cadence needed.
//
// Cheapest-mechanism-first (CLAUDE.md): pure comparison + a read-only report
// (scripts/freshness-report.ts). No schema change, no write, no AI. Whether to
// AUTOMATE the refresh is a separate decision (#355), made on evidence from
// this report.
import type { CbsCatalogEntry } from '../cbs-adapter/types.ts';

export interface FreshnessInputRow {
  tableId: string;
  /** cbs_tables.last_sync_at, ISO string, or null (never synced). */
  lastSyncAt: string | null;
  /** CBS's `Modified` for the table, ISO string, or null when CBS did not say
   * (or the table could not be checked). */
  cbsModifiedAt: string | null;
}

export type FreshnessStatus = 'behind' | 'current' | 'unknown';

export interface FreshnessFinding {
  tableId: string;
  status: FreshnessStatus;
  lastSyncAt: string | null;
  cbsModifiedAt: string | null;
  /** Whole days between our last successful sync and CBS's change — only for
   * 'behind' (>= 0; a table CBS changed hours after our sync is 0 days behind
   * but still behind). */
  daysBehind: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parse(iso: string | null): number | null {
  if (iso == null) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Pure. 'behind' = CBS changed the table after our last successful sync;
 * 'current' = it did not; 'unknown' = either date is missing/unreadable (never
 * guessed as current — principle (c)). Most-behind first, then unknown, then
 * current; ties by table id so the order is stable. */
export function assessFreshness(rows: readonly FreshnessInputRow[]): FreshnessFinding[] {
  const findings = rows.map((row): FreshnessFinding => {
    const synced = parse(row.lastSyncAt);
    const modified = parse(row.cbsModifiedAt);
    if (synced == null || modified == null) {
      return { tableId: row.tableId, status: 'unknown', lastSyncAt: row.lastSyncAt, cbsModifiedAt: row.cbsModifiedAt, daysBehind: null };
    }
    if (modified > synced) {
      return {
        tableId: row.tableId,
        status: 'behind',
        lastSyncAt: row.lastSyncAt,
        cbsModifiedAt: row.cbsModifiedAt,
        daysBehind: Math.floor((modified - synced) / MS_PER_DAY),
      };
    }
    return { tableId: row.tableId, status: 'current', lastSyncAt: row.lastSyncAt, cbsModifiedAt: row.cbsModifiedAt, daysBehind: null };
  });
  const rank: Record<FreshnessStatus, number> = { behind: 0, unknown: 1, current: 2 };
  return findings.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      (b.daysBehind ?? 0) - (a.daysBehind ?? 0) ||
      a.tableId.localeCompare(b.tableId),
  );
}

// ---------------------------------------------------------------------------
// The daily "CBS has newer data" e-mail (#355): which behind tables to name, and on which
// days the owner hears about it.
//
// Same no-schema dedupe as the missed-sync alert (./stale-sync.ts shouldAlertToday): the
// cron recomputes everything fresh each run from two dates already stored/fetched, so there is
// no "last alerted at" column to add. The clock that matters is how long ago CBS CHANGED the
// table (not how far behind our sync is): a daily cron first sees a change on a run where it
// is under 24 hours old (age 0 — the day the news breaks), and again every 7th day while we
// are still behind (7, 14, ...). Known limit: if the cron itself missed the age-0 day, the
// first mail comes at age 7 — the session-start / monthly `npm run ingest:freshness` check is
// the backstop.
// ---------------------------------------------------------------------------
export interface NewCbsDataEntry {
  tableId: string;
  lastSyncAt: string;
  cbsModifiedAt: string;
  /** Whole days between our last sync and CBS's change (assessFreshness's daysBehind). */
  daysBehind: number;
  /** Whole days between CBS's change and `now` (>= 0). */
  cbsChangedDaysAgo: number;
}

/** Pure — the 'behind' findings, each with how long ago CBS changed the table. Tables that
 * could not be compared ('unknown') are left out on purpose: an unreadable date is not news. */
export function findNewCbsData(findings: readonly FreshnessFinding[], now: Date): NewCbsDataEntry[] {
  const out: NewCbsDataEntry[] = [];
  for (const f of findings) {
    if (f.status !== 'behind' || f.lastSyncAt == null || f.cbsModifiedAt == null || f.daysBehind == null) continue;
    const modified = parse(f.cbsModifiedAt);
    if (modified == null) continue;
    out.push({
      tableId: f.tableId,
      lastSyncAt: f.lastSyncAt,
      cbsModifiedAt: f.cbsModifiedAt,
      daysBehind: f.daysBehind,
      cbsChangedDaysAgo: Math.max(0, Math.floor((now.getTime() - modified) / MS_PER_DAY)),
    });
  }
  return out;
}

/** Pure — true on the day the news breaks (age 0) and on every 7th day after while still
 * behind. */
export function shouldAlertAboutNewData(cbsChangedDaysAgo: number): boolean {
  return cbsChangedDaysAgo >= 0 && cbsChangedDaysAgo % 7 === 0;
}

// ---------------------------------------------------------------------------
// The RUNBOOK's release-day step 2, as a function: is this table's new release
// only "the next period was added", or did something else move?
//
// A bare sync of a table whose release added a period code QUARANTINES it
// (checkDimensionMapping, ./validate.ts) and takes it out of service; the flag
// `--accept-new-codes` accepts ANY new code on ANY dimension, so it is only
// safe once a person has confirmed the delta is just the next period. This is
// that confirmation, mechanical: it never writes and never decides to sync.
// ---------------------------------------------------------------------------
export interface ReleaseDiffInput {
  /** Name of the table's TimeDimension (e.g. 'Perioden'); null if it has none. */
  timeDimension: string | null;
  /** dimension name → the codes we store (dimension_labels). */
  stored: Readonly<Record<string, readonly string[]>>;
  /** dimension name → the codes CBS lists now (fetched with the table's own slice). */
  fetched: Readonly<Record<string, readonly string[]>>;
  /** cbs_tables.schema_fingerprint, or null if the table never recorded one. */
  storedFingerprint: string | null;
  /** The fingerprint of CBS's current schema, computed the way the sync computes it. */
  fetchedFingerprint: string;
}

export interface ReleaseVerdict {
  /** 'safe' = the only change is new period code(s) (or no code change at all) and the
   * schema fingerprint is unchanged, so `sync <id> --accept-new-codes` is the
   * documented path. 'review' = a person must look first; never forced. */
  verdict: 'safe' | 'review';
  /** New codes on the time dimension (the expected "next period" delta). */
  newPeriodCodes: string[];
  /** Plain-language reasons a person must look, empty when safe. */
  reasons: string[];
}

const preview = (codes: readonly string[]): string =>
  codes.slice(0, 5).join(', ') + (codes.length > 5 ? `, … (+${codes.length - 5} more)` : '');

export function classifyRelease(input: ReleaseDiffInput): ReleaseVerdict {
  const reasons: string[] = [];
  const newPeriodCodes: string[] = [];

  if (input.storedFingerprint == null) {
    reasons.push('no stored schema fingerprint to compare against');
  } else if (input.storedFingerprint !== input.fetchedFingerprint) {
    reasons.push("the table's structure (dimensions or measures) changed since our last sync");
  }

  const dimensions = new Set([...Object.keys(input.stored), ...Object.keys(input.fetched)]);
  for (const dim of [...dimensions].sort()) {
    const storedCodes = new Set(input.stored[dim] ?? []);
    const fetchedCodes = new Set(input.fetched[dim] ?? []);
    if (!(dim in input.fetched)) {
      reasons.push(`dimension ${dim} is no longer published`);
      continue;
    }
    const added = [...fetchedCodes].filter((c) => !storedCodes.has(c));
    const removed = [...storedCodes].filter((c) => !fetchedCodes.has(c));
    if (removed.length > 0) reasons.push(`CBS no longer lists ${removed.length} code(s) of ${dim}: ${preview(removed)}`);
    if (added.length > 0) {
      if (dim === input.timeDimension) newPeriodCodes.push(...added.sort());
      else reasons.push(`${added.length} new non-period code(s) in ${dim}: ${preview(added)}`);
    }
  }
  if (input.timeDimension == null) reasons.push('the table has no time dimension we can recognise');

  return { verdict: reasons.length === 0 ? 'safe' : 'review', newPeriodCodes, reasons };
}

// ---------------------------------------------------------------------------
// Eurostat tables (#357). Eurostat's catalogue file gives, per dataset, the day its data last
// changed and the first/last period it holds. Two questions, both from that one file:
//   behind          - Eurostat changed the data on a later day than our last sync;
//   possibly_frozen - the dataset's last period is older than its grain allows. Eurostat retires
//                     datasets without notice (prc_hicp_manr stayed at 2025-12 while the live
//                     series moved to prc_hicp_minr, session 150); a frozen dataset never shows
//                     up as "behind" because nothing new arrives — so lateness of the DATA
//                     itself is the only signal, and only a person can find the replacement.
// Anything unreadable is 'unknown', never 'current' (principle (c)). Blind spot, accepted: an
// update on the same UTC day as our sync is not seen (the catalogue date has no time of day).
// ---------------------------------------------------------------------------

/** Monthly data is published about 1-2 months after the period; 4 leaves room for a late release. */
export const EUROSTAT_MONTHLY_MAX_LAG_MONTHS = 4;
/** Quarterly national-accounts data lags 1-2 quarters; 3 leaves room for a late release. */
export const EUROSTAT_QUARTERLY_MAX_LAG_QUARTERS = 3;
/** Annual data can lag 12-18 months after the year ends; 30 leaves room for slow indicators. */
export const EUROSTAT_ANNUAL_MAX_LAG_MONTHS = 30;

export type EurostatFreshnessStatus = 'behind' | 'possibly_frozen' | 'unknown' | 'current';

export interface EurostatFreshnessInput {
  tableId: string;
  /** cbs_tables.last_sync_at, ISO string, or null (never synced). */
  lastSyncAt: string | null;
  /** The table's row in Eurostat's catalogue file, or null when the dataset is not in it. */
  entry: CbsCatalogEntry | null;
}

export interface EurostatFreshnessVerdict {
  tableId: string;
  status: EurostatFreshnessStatus;
  /** Plain-language reasons; empty for 'current'. */
  reasons: string[];
  lastSyncAt: string | null;
  /** Eurostat's 'last update of data' (ISO day), or null. */
  eurostatModifiedAt: string | null;
  /** Eurostat's 'data end' verbatim ('2025-12'), or null. */
  dataEnd: string | null;
}

/** Whole months from `end` (the LAST month the period covers) to `now`; null for a spelling we do
 * not recognise (weekly, semester, daily, month 13, ...). `unit` says what the threshold counts. */
function lagOfDataEnd(dataEnd: string, now: Date): { unit: 'month' | 'quarter' | 'year'; lag: number } | null {
  const nowMonths = now.getUTCFullYear() * 12 + now.getUTCMonth();
  let m = /^(\d{4})$/.exec(dataEnd);
  if (m) return { unit: 'year', lag: nowMonths - (Number(m[1]) * 12 + 11) };
  m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(dataEnd);
  if (m) return { unit: 'month', lag: nowMonths - (Number(m[1]) * 12 + Number(m[2]) - 1) };
  m = /^(\d{4})-Q([1-4])$/.exec(dataEnd);
  if (m) return { unit: 'quarter', lag: Math.floor(nowMonths / 3) - (Number(m[1]) * 4 + Number(m[2]) - 1) };
  return null;
}

/** Pure. See the block comment above; 'possibly_frozen' outranks 'behind' because a sync cannot fix it. */
export function assessEurostatFreshness(input: EurostatFreshnessInput, now: Date): EurostatFreshnessVerdict {
  const { tableId, lastSyncAt, entry } = input;
  const base = {
    tableId,
    lastSyncAt,
    eurostatModifiedAt: entry?.modified ?? null,
    dataEnd: entry?.dataEnd ?? null,
  };
  const unknown = (reason: string): EurostatFreshnessVerdict => ({ ...base, status: 'unknown', reasons: [reason] });
  if (entry == null) return unknown("the dataset is not in Eurostat's catalogue any more (retired or renamed?)");
  const synced = parse(lastSyncAt);
  const modified = parse(entry.modified);
  if (synced == null) return unknown('we have no last-sync time for this table');
  if (modified == null) return unknown("Eurostat's catalogue gave no readable 'last update of data' date");

  const reasons: string[] = [];
  const behind = Math.floor(modified / MS_PER_DAY) > Math.floor(synced / MS_PER_DAY);
  if (behind) reasons.push(`Eurostat updated the data on ${entry.modified!.slice(0, 10)}, after our last sync`);

  const end = entry.dataEnd == null ? null : lagOfDataEnd(entry.dataEnd, now);
  let frozen = false;
  if (end != null) {
    const limit = { month: EUROSTAT_MONTHLY_MAX_LAG_MONTHS, quarter: EUROSTAT_QUARTERLY_MAX_LAG_QUARTERS, year: EUROSTAT_ANNUAL_MAX_LAG_MONTHS }[end.unit];
    frozen = end.lag > limit;
    if (frozen) {
      reasons.unshift(
        `the newest period is ${entry.dataEnd}, older than a ${end.unit === 'year' ? 'annual' : end.unit + 'ly'} dataset should be — it may have been retired`,
      );
    }
  }

  if (frozen) return { ...base, status: 'possibly_frozen', reasons };
  if (behind) return { ...base, status: 'behind', reasons };
  if (end == null) return unknown(`could not read Eurostat's 'data end' (${entry.dataEnd ?? 'missing'}) to judge how recent the data is`);
  return { ...base, status: 'current', reasons };
}
