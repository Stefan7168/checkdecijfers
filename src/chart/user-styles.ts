// User chart style store + anonymous usage counter (migration 028, WP218
// phases 2 + 6, ADR 039). FILE-ONLY until the migration's supervised apply
// (see the migration's own header) — every function here must therefore
// degrade gracefully, never throw, when its table doesn't exist yet:
// reads → null / [], writes → { ok: false, reason: 'unavailable' }, the
// usage counter → a silent no-op. This mirrors the check-not-catch
// discipline `src/answer/audit/retention-job.ts` (trialTableExists /
// errorLogTableExists) and `src/threads/index.ts` (userDatasetsTableExists)
// already use for the same deploy-window problem, via to_regclass — plus a
// defensive catch on Postgres's 42P01 (undefined_table) error code for the
// narrow race window between that check and the query that follows it.
import type { Db } from '../db/types.ts';
import { twoYearsBefore } from '../answer/audit/retention.ts';

/** `style` is stored as-is (the web side sanitises before it ever reaches
 * this module); this cap bounds `JSON.stringify(style)`, not the object
 * itself, so it caps what actually goes into the `jsonb` column. */
export const USER_CHART_STYLE_MAX_JSON = 4000;

export const CHART_STYLE_EVENTS = [
  'panel_open',
  'option_changed',
  'default_saved',
  'default_forgotten',
] as const;
export type ChartStyleEvent = (typeof CHART_STYLE_EVENTS)[number];

export interface UserChartStyleRow {
  style: Record<string, unknown>;
  brand: Record<string, unknown> | null;
  updatedAt: string;
}

/** Postgres's SQLSTATE for "relation does not exist" — the race-window
 * fallback behind the to_regclass check below (see module header). */
const UNDEFINED_TABLE = '42P01';

function isUndefinedTableError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === UNDEFINED_TABLE
  );
}

/** jsonb column → plain object. pg and PGlite both return a parsed object
 * for a jsonb select; a string fallback keeps this driver-agnostic (the
 * src/threads/index.ts `decodeResponse` / context/build.ts precedent). */
function decodeJsonb(raw: unknown): Record<string, unknown> {
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
}

/** timestamptz column → ISO string, whichever shape the driver hands back
 * (the src/threads/index.ts `toIso` precedent). */
function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** `to_regclass` existence check for `user_chart_styles` — a check, not a
 * catch, so a real failure (permissions, pool exhaustion) still propagates
 * instead of being silently reported as "no table". */
export async function chartStylesTablePresent(db: Db): Promise<boolean> {
  const { rows } = await db.query(`select to_regclass('public.user_chart_styles') as t`, []);
  return rows[0]?.t != null;
}

/** Same check, scoped to the separate usage-counter table — dropped
 * independently of `user_chart_styles` in the absent-table tests, so it
 * gets its own (unexported — `recordChartStyleEvent` is the only caller)
 * presence check rather than reusing `chartStylesTablePresent`. */
async function chartStyleUsageTablePresent(db: Db): Promise<boolean> {
  const { rows } = await db.query(`select to_regclass('public.chart_style_usage') as t`, []);
  return rows[0]?.t != null;
}

/** Null both when the user has no saved style AND when the table doesn't
 * exist yet — deliberately indistinguishable, same as this codebase's other
 * deploy-window reads (`getTrialPotStatus`, `getDataset`'s ownership
 * contract): a caller degrades to "no default" either way. */
export async function getUserChartStyle(db: Db, userId: string): Promise<UserChartStyleRow | null> {
  if (!(await chartStylesTablePresent(db))) return null;
  try {
    const { rows } = await db.query(
      `select style, brand, updated_at from user_chart_styles where user_id = $1`,
      [userId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      style: decodeJsonb(row.style),
      brand: row.brand == null ? null : decodeJsonb(row.brand),
      updatedAt: toIso(row.updated_at),
    };
  } catch (err) {
    if (isUndefinedTableError(err)) return null;
    throw err;
  }
}

/** Upsert. `brand` is a separate column this task's interface does not
 * write — a later phase-6 task owns setting it — so it is never touched
 * here, matching the interface comment ("brand column untouched"). The
 * size cap is checked BEFORE touching the database: an oversized payload is
 * invalid regardless of table state, so there is no reason to spend a
 * round-trip (or a presence check) on it first. */
export async function saveUserChartStyle(
  db: Db,
  userId: string,
  style: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; reason: 'unavailable' | 'too-large' }> {
  const json = JSON.stringify(style);
  if (json.length > USER_CHART_STYLE_MAX_JSON) {
    return { ok: false, reason: 'too-large' };
  }
  if (!(await chartStylesTablePresent(db))) return { ok: false, reason: 'unavailable' };
  try {
    await db.query(
      `insert into user_chart_styles (user_id, style, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (user_id) do update set style = excluded.style, updated_at = now()`,
      [userId, json],
    );
    return { ok: true };
  } catch (err) {
    if (isUndefinedTableError(err)) return { ok: false, reason: 'unavailable' };
    throw err;
  }
}

/** True only if a row actually went — false for both "never had one" and
 * "table absent", matching the store's other indistinguishable-on-purpose
 * degrades. */
export async function deleteUserChartStyle(db: Db, userId: string): Promise<boolean> {
  if (!(await chartStylesTablePresent(db))) return false;
  try {
    const { rows } = await db.query(
      `delete from user_chart_styles where user_id = $1 returning user_id`,
      [userId],
    );
    return rows.length > 0;
  } catch (err) {
    if (isUndefinedTableError(err)) return false;
    throw err;
  }
}

/** Per-user daily cap on brand lookups (WP218 phase 3, ADR 039) — each
 * lookup hits Brandfetch's paid API (via brand-cache.ts's cache miss path),
 * so this bounds how many a single user can trigger in a day regardless of
 * how many distinct domains they try. */
export const BRAND_LOOKUPS_PER_DAY = 5;

interface BrandLookups {
  day: string;
  count: number;
}

/** Reads `brand.lookups` off an already-decoded `brand` object, tolerating
 * anything a corrupted or hand-edited row might contain (never trust a
 * stored row blindly — the brand-cache.ts module documents the same
 * discipline for its own cached payload). */
function readLookups(brand: Record<string, unknown>): BrandLookups | null {
  const lookups = brand.lookups;
  if (typeof lookups !== 'object' || lookups === null) return null;
  const record = lookups as Record<string, unknown>;
  if (typeof record.day !== 'string' || typeof record.count !== 'number') return null;
  return { day: record.day, count: record.count };
}

/**
 * Bumps today's brand-lookup count for `userId`, creating the row (with
 * `style: '{}'`) on first use, resetting the count when `day` differs from
 * what's stored, and refusing at `BRAND_LOOKUPS_PER_DAY` WITHOUT
 * incrementing past it. `{ allowed: false, count: 0 }` when the table
 * doesn't exist yet.
 *
 * Read-modify-write inside a transaction, not a single SQL statement: the
 * "reset on a new day, refuse at the cap without incrementing past it"
 * logic branches on the CURRENT count before deciding what to write, which
 * a plain `coalesce(brand, '{}') || jsonb` merge (see `setAppliedBrand`
 * below) can't express — there's no conditional business logic to express
 * in that operator, only a key replacement. `for update` locks the row for
 * the transaction's duration so two concurrent calls can't both read the
 * same pre-increment count and both believe they got the 5th lookup.
 */
export async function bumpBrandLookups(
  db: Db,
  userId: string,
  day: string,
): Promise<{ allowed: boolean; count: number }> {
  if (!(await chartStylesTablePresent(db))) return { allowed: false, count: 0 };
  try {
    return await db.withTransaction(async (tx) => {
      await tx.query(
        `insert into user_chart_styles (user_id, style)
         values ($1, '{}'::jsonb)
         on conflict (user_id) do nothing`,
        [userId],
      );
      const { rows } = await tx.query(`select brand from user_chart_styles where user_id = $1 for update`, [
        userId,
      ]);
      const brand = rows[0]?.brand == null ? {} : decodeJsonb(rows[0].brand);
      const existing = readLookups(brand);
      const currentCount = existing !== null && existing.day === day ? existing.count : 0;

      if (currentCount >= BRAND_LOOKUPS_PER_DAY) {
        return { allowed: false, count: currentCount };
      }

      const nextCount = currentCount + 1;
      const nextBrand = { ...brand, lookups: { day, count: nextCount } };
      await tx.query(`update user_chart_styles set brand = $2::jsonb, updated_at = now() where user_id = $1`, [
        userId,
        JSON.stringify(nextBrand),
      ]);
      return { allowed: true, count: nextCount };
    });
  } catch (err) {
    if (isUndefinedTableError(err)) return { allowed: false, count: 0 };
    throw err;
  }
}

/**
 * Merges `applied` into the user's `brand` column, leaving any `lookups`
 * counter untouched, and creates the row (with `style: '{}'`) on first use.
 *
 * A single SQL statement, not a read-modify-write: unlike
 * `bumpBrandLookups` there's no conditional business logic to branch on —
 * just a top-level key replacement — so `coalesce(brand, '{}') ||
 * jsonb_build_object('applied', $2)` does it atomically: jsonb `||`
 * replaces only the keys present on its right-hand side, so a sibling
 * `lookups` key already in `brand` survives untouched.
 */
export async function setAppliedBrand(
  db: Db,
  userId: string,
  applied: { domain: string; name: string; fetchedAt: string } | null,
): Promise<void> {
  if (!(await chartStylesTablePresent(db))) return;
  try {
    await db.query(
      `insert into user_chart_styles (user_id, style, brand)
       values ($1, '{}'::jsonb, jsonb_build_object('applied', $2::jsonb))
       on conflict (user_id) do update
         set brand = coalesce(user_chart_styles.brand, '{}'::jsonb) || jsonb_build_object('applied', $2::jsonb),
             updated_at = now()`,
      [userId, JSON.stringify(applied)],
    );
  } catch (err) {
    if (isUndefinedTableError(err)) return;
    throw err;
  }
}

/** Anonymous usage tally (open-questions #220): event × day × count, no
 * user id, no IP. A silent no-op when the table is absent — this counter is
 * pure telemetry, never load-bearing for a real answer, so the fail-safe
 * here is to say nothing rather than to throw or to log noisily on every
 * deploy-window call. */
export async function recordChartStyleEvent(db: Db, event: ChartStyleEvent, day: Date): Promise<void> {
  if (!(await chartStyleUsageTablePresent(db))) return;
  const dayOnly = day.toISOString().slice(0, 10);
  try {
    await db.query(
      `insert into chart_style_usage (event, day, count)
       values ($1, $2, 1)
       on conflict (event, day) do update set count = chart_style_usage.count + 1`,
      [event, dayOnly],
    );
  } catch (err) {
    if (isUndefinedTableError(err)) return;
    throw err;
  }
}

/** The same #14/ADR-037 two-year account window, re-exported under this
 * module's own name so callers (the retention job/CLI) don't need to reach
 * into the audit module just for a date helper — the
 * `src/attachments/retention.ts` `twoYearsBefore` re-export precedent. */
export function chartStyleRetentionCutoff(now: Date): Date {
  return twoYearsBefore(now);
}

/** Dry-run preview, counted from the EXACT same predicate `purgeExpiredChartStyles`
 * deletes with, so a read-only count can never drift from what `--apply`
 * actually does (the `countPurgeableDatasets`/`purgeExpiredDatasets` pair
 * precedent). */
export async function countPurgeableChartStyles(db: Db, cutoff: Date): Promise<{ userId: string }[]> {
  if (!(await chartStylesTablePresent(db))) return [];
  try {
    const { rows } = await db.query(`select user_id from user_chart_styles where updated_at < $1`, [
      cutoff.toISOString(),
    ]);
    return rows.map((r) => ({ userId: String(r.user_id) }));
  } catch (err) {
    if (isUndefinedTableError(err)) return [];
    throw err;
  }
}

export async function purgeExpiredChartStyles(db: Db, cutoff: Date): Promise<{ userId: string }[]> {
  if (!(await chartStylesTablePresent(db))) return [];
  try {
    const { rows } = await db.query(
      `delete from user_chart_styles where updated_at < $1 returning user_id`,
      [cutoff.toISOString()],
    );
    return rows.map((r) => ({ userId: String(r.user_id) }));
  } catch (err) {
    if (isUndefinedTableError(err)) return [];
    throw err;
  }
}
