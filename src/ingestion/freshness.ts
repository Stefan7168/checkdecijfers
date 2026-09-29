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
