// On-demand table eviction — the TTL half of the on-demand data lifecycle
// (#110 b/c/d, WP16 sub-part 2 follow-on; migration 025). On-demand-onboarded
// tables are a TTL cache ABOVE the permanent seed-table mirror: a table nobody
// has asked about for ON_DEMAND_TTL_DAYS stops earning its space and its
// nightly `sync --all` refresh cost, so the GC removes it. Deterministic code
// only — no LLM calls, no live pipeline invocation.
//
// What "evicted" MEANS — a full return to the never-onboarded state. Eviction
// deletes the table's observations (the bulk cells), dimension_labels,
// canonical_measures rows (the auto-derived `onboarded:` vocabulary),
// ingestion_batches history, and the cbs_tables registration row itself, in
// that FK-safe order, in one transaction per table. Deliberately NOT a status
// flip:
//  - `needs_review` is the VALIDATION quarantine ("failed validation /
//    suspected redesign", docs/05 — a table leaves it via verification tasks).
//    An expired cache entry is not a broken table; reusing the quarantine
//    would conflate "CBS changed the schema" with "nobody asked for 30 days",
//    and every consumer of status would need to tell them apart.
//  - a kept-but-inert row would still be enumerated by `sync --all`
//    (src/ingestion/cli.ts targets every registered id — the eviction would
//    stop nothing), would keep its stale vocabulary routing questions at a
//    dead table instead of at the finder, and registerTables' idempotency
//    skip (`already registered → untouched`) would silently SKIP re-fetching
//    schema + labels on re-onboarding, leaving a half-registered hybrid.
// Deleting the row makes re-onboarding be *exactly* the first-time flow, by
// construction: the intent parser no longer finds a canonical key (vocab rows
// gone) → unmatched topic → the finder searches cbs_catalog (NOT touched by
// eviction — it is the full CBS catalog mirror, not per-table data) →
// `alreadyIngestedSet` no longer matches (row gone) → the normal 100-credit
// onboarding trigger → registerAndSync inserts a FRESH registration (fresh
// schema measurement, fresh labels, fresh fingerprint baseline — correct for
// a table CBS may have changed in the meantime).
//
// What eviction NEVER touches — the R8 guarantee. audit_answers rows are
// self-contained by design: reconstruction "re-derives from the STORED record
// alone — no database" (src/answer/audit/reconstruct.ts), result ids are
// composite strings, and there is no FK from the audit trail into any table
// this module deletes. A past answer served from an evicted table stays
// byte-for-byte reconstructable (pinned in tests/ingestion/eviction.test.ts).
// credit_transactions and pending_table_requests are equally untouched: the
// ledger is the immutable financial trail, and pending rows carry the
// onboarding history + are GDPR-owned (their own redaction mechanism, #120 —
// a table-lifecycle operation must never write there). A delivered pending
// row's table_id keeps naming the evicted id as plain text — historical fact,
// no FK, harmless.
//
// Accepted consequence, documented rather than hidden: deleting
// ingestion_batches loses the evicted table's sync/corrections history (the
// docs/05 scoop-alert seam). For a non-seed table unqueried for 30+ days that
// history has no remaining audience — no published pages exist (Phase 2), and
// past answers carry their own record — while KEEPING batches would force
// keeping the cbs_tables row (FK) and with it the whole half-dead-row problem
// above. The permanent record is the seed set; the cache keeps no diary.
//
// Safety guards, in the WHERE itself (⟨F2⟩ discipline — the dry-run preview
// and the apply are built from the SAME fragment, so they can never drift):
//  - `pinned = false` — the curated seed set is exempt (#110 c).
//  - staleness anchored on coalesce(last_queried_at, created_at): last real
//    query when known (bumped debounced by src/query/run.ts), registration
//    moment when never queried — which also sweeps up failed-onboarding
//    debris (registered rows whose sync never succeeded are invisible to
//    `alreadyIngestedSet` but previously lingered forever).
//  - no ACTIVE pending_table_requests row (status pending/running) may
//    reference the table: an in-flight onboarding job for it must never race
//    a concurrent delete of the very rows it is writing. Terminal rows
//    (delivered/failed/unanswerable) do not block. A trigger that fires AFTER
//    the per-table transaction committed simply finds a never-onboarded topic
//    — the normal flow.
//
// Idempotent: an evicted table no longer matches the fragment (its row is
// gone), so a second run against the same state finds nothing new.
import type { Db } from '../db/types.ts';

/** #110(d): pure time-since-last-query TTL, per the row's own recommendation —
 * 30 days unqueried ⇒ evictable. The frequency-weighted variant (LRU-with-
 * frequency: a table queried daily for a year outliving one queried twice)
 * was deliberately NOT built — "until churn is measured" there is no evidence
 * it buys anything over the simple clock, and a smarter policy can replace
 * this constant + fragment later without touching the deletion mechanics. */
export const ON_DEMAND_TTL_DAYS = 30;

/** The eviction cutoff, same injected-clock discipline as retention.ts's
 * twoYearsBefore: a plain function of "now" so the CLI and the tests pin the
 * reference instant explicitly. */
export function evictionCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - ON_DEMAND_TTL_DAYS);
  return cutoff;
}

/** The single source of truth for WHICH cbs_tables rows are evictable —
 * `$1` is always the cutoff ISO string. Both the dry-run listing and the
 * apply's inside-transaction re-check are built from THIS fragment (the
 * retention.ts AUDIT_SCOPE discipline), so the scope can only ever change in
 * one place and preview/apply cannot disagree about membership. */
const EVICTABLE_WHERE = `
  cbs_tables.pinned = false
  and coalesce(cbs_tables.last_queried_at, cbs_tables.created_at) < $1
  and not exists (
    select 1 from pending_table_requests p
     where (p.table_id = cbs_tables.id or p.resolved_table_id = cbs_tables.id)
       and p.status in ('pending', 'running')
  )` as const;

/** One evictable table plus the artifact counts the operator is deciding
 * about. On a dry run these are what WOULD be deleted; on an apply they are
 * measured inside the same transaction that then deletes them. */
export interface EvictableTableReport {
  id: string;
  title: string;
  /** ISO of coalesce(last_queried_at, created_at) — the staleness anchor. */
  lastActivityAt: string;
  observations: number;
  dimensionLabels: number;
  canonicalMeasures: number;
  ingestionBatches: number;
}

export interface TableEvictionSummary {
  mode: 'dry-run' | 'applied';
  /** ISO cutoff: tables last active before this were in scope. */
  cutoff: string;
  tables: EvictableTableReport[];
  /** Applied runs only: candidates from the initial listing that no longer
   * matched the fragment inside their own transaction (queried, pinned or
   * deleted concurrently). Reported, never an error — a table saved by a
   * last-second query is the guard working. */
  skipped?: string[];
}

interface CandidateRow {
  id: string;
  title: string;
  lastActivityAt: string;
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

async function countOne(db: Db, sql: string, tableId: string): Promise<number> {
  const { rows } = await db.query(sql, [tableId]);
  return Number(rows[0]?.n ?? 0);
}

/** The four artifact counts for one table — shared VERBATIM by the dry-run
 * preview and the apply (which measures inside its own transaction, before
 * deleting), so the two can never count different things. */
async function countTableArtifacts(
  db: Db,
  tableId: string,
): Promise<Pick<EvictableTableReport, 'observations' | 'dimensionLabels' | 'canonicalMeasures' | 'ingestionBatches'>> {
  return {
    observations: await countOne(
      db,
      'select count(*)::int as n from observations where table_id = $1',
      tableId,
    ),
    dimensionLabels: await countOne(
      db,
      'select count(*)::int as n from dimension_labels where table_id = $1',
      tableId,
    ),
    canonicalMeasures: await countOne(
      db,
      'select count(*)::int as n from canonical_measures where table_id = $1',
      tableId,
    ),
    ingestionBatches: await countOne(
      db,
      'select count(*)::int as n from ingestion_batches where table_id = $1',
      tableId,
    ),
  };
}

async function listCandidates(db: Db, cutoffIso: string): Promise<CandidateRow[]> {
  const { rows } = await db.query(
    `select cbs_tables.id, cbs_tables.title,
            coalesce(cbs_tables.last_queried_at, cbs_tables.created_at) as last_activity_at
       from cbs_tables
      where ${EVICTABLE_WHERE}
      order by cbs_tables.id`,
    [cutoffIso],
  );
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    lastActivityAt: toIso(r.last_activity_at),
  }));
}

/** ⟨F2⟩ dry-run preview: every table an `--apply` run against this same state
 * would evict, with its artifact counts. Read-only — count queries only. */
export async function listEvictableTables(
  db: Db,
  cutoff: Date,
): Promise<EvictableTableReport[]> {
  const candidates = await listCandidates(db, cutoff.toISOString());
  const reports: EvictableTableReport[] = [];
  for (const candidate of candidates) {
    reports.push({ ...candidate, ...(await countTableArtifacts(db, candidate.id)) });
  }
  return reports;
}

/** Thrown when some tables were already evicted (their transactions
 * committed) and a later table's eviction failed — the operator must never be
 * told "it failed" about a run that deleted data (the
 * RetentionPurgePartialError lesson, applied here). */
export class TableEvictionPartialError extends Error {
  readonly evicted: EvictableTableReport[];

  constructor(message: string, evicted: EvictableTableReport[], reason: unknown) {
    super(`${message}: ${reason instanceof Error ? reason.message : String(reason)}`, {
      cause: reason,
    });
    this.name = 'TableEvictionPartialError';
    this.evicted = evicted;
  }
}

/** The apply: one transaction PER TABLE (a crash mid-run leaves earlier
 * tables fully evicted and later ones fully intact — never a half-deleted
 * table), each re-checking the SAME fragment under `for update` so a table
 * queried/pinned between listing and deletion is skipped, not evicted. */
export async function evictStaleTables(
  db: Db,
  cutoff: Date,
): Promise<{ evicted: EvictableTableReport[]; skipped: string[] }> {
  const cutoffIso = cutoff.toISOString();
  const candidates = await listCandidates(db, cutoffIso);
  const evicted: EvictableTableReport[] = [];
  const skipped: string[] = [];

  for (const candidate of candidates) {
    try {
      const result = await db.withTransaction(async (tx) => {
        // Re-derive eligibility INSIDE the transaction, from the same
        // fragment, locking the registry row: the listing above is a moment
        // ago, and the debounced last_queried_at bump (src/query/run.ts) may
        // have landed since. A row that no longer matches is skipped.
        const { rows } = await tx.query(
          `select cbs_tables.id, cbs_tables.title,
                  coalesce(cbs_tables.last_queried_at, cbs_tables.created_at) as last_activity_at
             from cbs_tables
            where cbs_tables.id = $2 and ${EVICTABLE_WHERE}
              for update`,
          [cutoffIso, candidate.id],
        );
        const row = rows[0];
        if (!row) return null;

        // Measured in the SAME transaction that deletes — the reported counts
        // are exactly what the deletes below removed.
        const counts = await countTableArtifacts(tx, candidate.id);

        // FK-safe order: observations reference ingestion_batches AND
        // cbs_tables; dimension_labels + canonical_measures + batches
        // reference cbs_tables; the registration row goes last.
        await tx.query('delete from observations where table_id = $1', [candidate.id]);
        await tx.query('delete from dimension_labels where table_id = $1', [candidate.id]);
        await tx.query('delete from canonical_measures where table_id = $1', [candidate.id]);
        await tx.query('delete from ingestion_batches where table_id = $1', [candidate.id]);
        await tx.query('delete from cbs_tables where id = $1', [candidate.id]);

        return {
          id: String(row.id),
          title: String(row.title),
          lastActivityAt: toIso(row.last_activity_at),
          ...counts,
        } satisfies EvictableTableReport;
      });
      if (result === null) skipped.push(candidate.id);
      else evicted.push(result);
    } catch (error) {
      // Earlier per-table transactions have COMMITTED. Carry what landed so
      // the CLI can report the evictions that actually happened before the
      // failure — "it failed" alone would lose that record.
      throw new TableEvictionPartialError(
        `eviction of table ${candidate.id} failed after ${evicted.length} table(s) were evicted`,
        evicted,
        error,
      );
    }
  }

  return { evicted, skipped };
}

/** A CHECK, not a catch (the retention-job.ts rule): the eviction columns
 * must exist before this tool means anything. Running against a database
 * missing migration 025 must say so in operator language, not fail with a
 * bare SQL error — and must never be silently treated as "nothing to evict". */
async function assertLifecycleColumns(db: Db): Promise<void> {
  const { rows } = await db.query(
    `select count(*)::int as n from information_schema.columns
      where table_name = 'cbs_tables' and column_name in ('pinned', 'last_queried_at')`,
  );
  if (Number(rows[0]?.n ?? 0) !== 2) {
    throw new Error(
      'cbs_tables is missing the lifecycle columns (pinned, last_queried_at) — ' +
        'apply migration 025 first (npm run db:migrate).',
    );
  }
}

export interface TableEvictionOptions {
  db: Db;
  /** Injected clock — never `new Date()` inside, so tests pin the cutoff. */
  now: Date;
  /** false = report only, write nothing. The CLI defaults to this. */
  apply: boolean;
}

/** Runs the eviction sweep (or its preview) and returns what happened.
 * Framework-agnostic job, one implementation for any future adapter — the
 * runRetentionPurge shape. Throws on real failure; a partial run throws
 * TableEvictionPartialError carrying the committed evictions. */
export async function runTableEviction(
  options: TableEvictionOptions,
): Promise<TableEvictionSummary> {
  const { db, now, apply } = options;
  await assertLifecycleColumns(db);
  const cutoff = evictionCutoff(now);

  if (!apply) {
    return {
      mode: 'dry-run',
      cutoff: cutoff.toISOString(),
      tables: await listEvictableTables(db, cutoff),
    };
  }

  const { evicted, skipped } = await evictStaleTables(db, cutoff);
  return {
    mode: 'applied',
    cutoff: cutoff.toISOString(),
    tables: evicted,
    ...(skipped.length > 0 ? { skipped } : {}),
  };
}

function tableLine(t: EvictableTableReport): string {
  return (
    `  - ${t.id} "${t.title}" — last used ${t.lastActivityAt}: ` +
    `${t.observations} cell(s), ${t.dimensionLabels} label(s), ` +
    `${t.canonicalMeasures} vocabulary row(s), ${t.ingestionBatches} sync batch(es)`
  );
}

/** One operator summary, shared by every caller of the job so two adapters
 * can never describe the same run differently (the describeRetentionPurge
 * shape). */
export function describeTableEviction(s: TableEvictionSummary): string {
  const head =
    s.mode === 'dry-run'
      ? `DRY RUN — eviction cutoff ${s.cutoff} (${ON_DEMAND_TTL_DAYS} days unqueried): ` +
        `${s.tables.length} on-demand table(s) WOULD be evicted.`
      : `Applied — eviction cutoff ${s.cutoff} (${ON_DEMAND_TTL_DAYS} days unqueried): ` +
        `evicted ${s.tables.length} on-demand table(s). Pinned seed tables are exempt; ` +
        `audit_answers, credit_transactions and pending_table_requests were not touched. ` +
        `An evicted topic re-onboards through the normal on-demand flow on next demand.`;
  const lines = s.tables.map(tableLine).join('\n');
  const skipped =
    s.skipped && s.skipped.length > 0
      ? `\n  note: ${s.skipped.length} candidate(s) were queried/changed concurrently and were NOT evicted: ` +
        s.skipped.join(', ')
      : '';
  return [head, lines].filter(Boolean).join('\n') + skipped;
}
