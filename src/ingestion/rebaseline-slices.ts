// Supervised re-baseline of a QUARANTINED slice-storage table (ADR 065; design
// docs/superpowers/specs/2026-09-30-one-route-warm-slices-design.md D5; the
// recovery ADR 062 recorded as missing). syncTable refuses slice tables, so a
// fingerprint or unit mismatch used to leave one out of service for good.
//
// Mirrors `ingest sync <id> --rebaseline` as far as the slice model allows: CBS's
// current layout becomes the new baseline (layout, units, fingerprint, labels),
// computed with the table's own curation exactly as a fresh registration would
// (planSchemaOnlyRegistration — one derivation), the table is active again and
// the re-baseline is recorded on a batch. Unlike the whole-table rebaseline there
// is no fresh fetch of every cell in the same transaction, so the stored cells
// and slice records are DELETED: after a structural change they cannot be trusted
// to mean the same thing. A pinned table is then warmed again; an unpinned one
// refills on the next question.
//
// Refuses, writing nothing, when the table is not slice storage or not
// quarantined, when CBS's new schema cannot be registered, when a canonical
// measure or the default coordinates would point at a code CBS no longer has,
// or when a pinned table's declared scope no longer plans against the new codes.
import type { CbsCode, CbsSlice, CbsSource, CbsTableSchema } from '../cbs-adapter/types.ts';
import type { Db } from '../db/types.ts';
import { fetchAllCodeLists } from './pipeline.ts';
import { SEED_TABLES } from './registry-seed.ts';
import {
  planSchemaOnlyRegistration,
  schemaOnlyPropertiesRefusal,
  writeSliceRegistration,
  type SliceRegistration,
} from './slice-cache.ts';
import { WARM_MAX_CELLS, warmTable, type WarmTableResult } from './warm-job.ts';
import { planWarmSlices } from './warm-plan.ts';

export interface RebaselineSlicesOptions {
  /** Epoch ms (as `now` counts them): the warm run of a pinned table stops here. */
  deadline: number;
  /** false = dry run: every check, nothing written (the CLI without --yes). */
  apply: boolean;
  now?: () => number;
}

export interface RebaselineSlicesResult {
  tableId: string;
  outcome: 'refused' | 'dry_run' | 'rebaselined';
  reason?: string;
  oldFingerprint?: string | null;
  newFingerprint?: string;
  measuresAdded?: string[];
  measuresRemoved?: string[];
  cellsDeleted?: number;
  sliceRecordsDeleted?: number;
  /** The succeeded, rebaselined batch that records the re-baseline. */
  batchId?: number;
  /** The warm run of a pinned table; null for an unpinned one. */
  warm?: WarmTableResult | null;
}

class RebaselineAbort extends Error {}

function parseJsonb<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

/** Every canonical measure and default coordinate of the table that the new
 * baseline would leave pointing at a measure or code CBS no longer has. */
async function danglingReferences(db: Db, reg: SliceRegistration): Promise<string[]> {
  const codesByDim = new Map<string, Set<string>>();
  for (const l of reg.labelRows) {
    let set = codesByDim.get(l.dimension);
    if (!set) codesByDim.set(l.dimension, (set = new Set()));
    set.add(l.code);
  }
  const pinProblem = (what: string, dim: string, code: string): string | null => {
    const codes = codesByDim.get(dim);
    if (!codes) return `${what} pins dimension ${dim}, which CBS's table no longer has`;
    if (!codes.has(code)) return `${what} pins ${dim} = ${code}, a code CBS no longer publishes`;
    return null;
  };

  const problems: string[] = [];
  const canonicalRows = (
    await db.query('select key, measure, dims from canonical_measures where table_id = $1 order by key', [reg.tableId])
  ).rows;
  for (const cm of canonicalRows) {
    const what = `canonical measure ${String(cm.key)}`;
    if (!Object.hasOwn(reg.units, String(cm.measure))) {
      problems.push(`${what} uses measure ${String(cm.measure)}, which the new baseline does not serve`);
    }
    for (const [dim, code] of Object.entries(parseJsonb<Record<string, string>>(cm.dims, {}))) {
      const p = pinProblem(what, dim, code);
      if (p) problems.push(p);
    }
  }
  const row = (await db.query('select default_coordinates from cbs_tables where id = $1', [reg.tableId])).rows[0];
  for (const [dim, code] of Object.entries(parseJsonb<Record<string, string>>(row?.default_coordinates, {}))) {
    const p = pinProblem('default_coordinates', dim, code);
    if (p) problems.push(p);
  }
  return problems;
}

export async function rebaselineSliceTable(
  db: Db,
  source: CbsSource,
  tableId: string,
  opts: RebaselineSlicesOptions,
): Promise<RebaselineSlicesResult> {
  const refused = (reason: string): RebaselineSlicesResult => ({ tableId, outcome: 'refused', reason });

  const row = (
    await db.query(
      `select ingest_mode, status, pinned, version, update_cadence, slice, units, schema_fingerprint
         from cbs_tables where id = $1`,
      [tableId],
    )
  ).rows[0];
  if (!row) return refused(`Table "${tableId}" is not registered.`);
  if (row.ingest_mode !== 'slice_cache') {
    return refused(
      `Table "${tableId}" is not a slice-storage table; a whole table is re-baselined by the ordinary sync ` +
        `(ingest sync ${tableId} --rebaseline).`,
    );
  }
  if (row.status !== 'needs_review') return refused(`Table "${tableId}" is not quarantined; there is nothing to re-baseline.`);

  // CBS's current layout, fetched before anything is written.
  let schema: CbsTableSchema;
  let codeLists: Record<string, CbsCode[]>;
  try {
    // The stored scope narrows a Eurostat dataset's request (CBS's adapters ignore it).
    const scope = parseJsonb<CbsSlice | null>(row.slice, null) ?? undefined;
    schema = await source.fetchTableSchema(tableId, scope);
    const early = schemaOnlyPropertiesRefusal(tableId, schema);
    if (early) return refused(`${early.reason}: ${early.summary}`);
    codeLists = await fetchAllCodeLists(source, tableId, schema.dimensions, scope);
  } catch (err) {
    return refused(`Fetching the table's schema from CBS failed: ${err instanceof Error ? err.message : String(err)}.`);
  }

  // The table's own curation: its stored scope (whose `measures` is the ADR 061
  // allow-list), cadence and pin; a seed entry's phantom-measure exclusions (#167)
  // live only in the seed, which is authoritative for them.
  const seed = SEED_TABLES.find((t) => t.id === tableId);
  let reg: SliceRegistration;
  try {
    const planned = planSchemaOnlyRegistration(tableId, schema, codeLists, {
      pinned: row.pinned === true,
      ...(row.update_cadence != null ? { updateCadence: String(row.update_cadence) } : {}),
      slice: parseJsonb<CbsSlice | null>(row.slice, null),
      excludeMeasures: seed?.excludeMeasures,
    });
    if (!planned.ok) return refused(`${planned.reason}: ${planned.summary}`);
    reg = planned.registration;
  } catch (err) {
    return refused(err instanceof Error ? err.message : String(err));
  }

  const dangling = await danglingReferences(db, reg);
  if (dangling.length > 0) {
    return refused(
      `The new baseline would leave registry entries pointing at codes CBS no longer has: ${dangling.join('; ')}. ` +
        `Update src/registry/defaults.ts (or the seed) for the new layout first.`,
    );
  }

  if (reg.pinned) {
    const codes: Record<string, string[]> = {};
    for (const l of reg.labelRows) (codes[l.dimension] ??= []).push(l.code);
    try {
      planWarmSlices(
        { tableId, slice: reg.slice, measures: Object.keys(reg.units), dimensions: reg.expectedDimensions, codes },
        { maxCells: WARM_MAX_CELLS },
      );
    } catch (err) {
      return refused(
        `The declared scope no longer plans against CBS's new code lists: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const oldMeasures = Object.keys(parseJsonb<Record<string, unknown>>(row.units, {}));
  const newMeasures = Object.keys(reg.units);
  const summary = {
    oldFingerprint: (row.schema_fingerprint as string | null) ?? null,
    newFingerprint: reg.fingerprint,
    measuresAdded: newMeasures.filter((m) => !oldMeasures.includes(m)).sort(),
    measuresRemoved: oldMeasures.filter((m) => !newMeasures.includes(m)).sort(),
  };
  const count = async (d: Db) => {
    const c = (
      await d.query(
        `select (select count(*) from observations where table_id = $1)::int as cells,
                (select count(*) from slice_fetches where table_id = $1)::int as slices`,
        [tableId],
      )
    ).rows[0]!;
    return { cellsDeleted: Number(c.cells), sliceRecordsDeleted: Number(c.slices) };
  };

  if (!opts.apply) return { tableId, outcome: 'dry_run', ...summary, ...(await count(db)) };

  const written = await db
    .withTransaction(async (tx) => {
      // Same key and bound as fetchSlice/syncTable's rebaseline/eviction.
      await tx.query("set local lock_timeout = '180s'");
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', [tableId]);
      const fresh = (
        await tx.query('select ingest_mode, status, version from cbs_tables where id = $1 for update', [tableId])
      ).rows[0];
      if (
        !fresh ||
        fresh.ingest_mode !== 'slice_cache' ||
        fresh.status !== 'needs_review' ||
        Number(fresh.version) !== Number(row.version)
      ) {
        throw new RebaselineAbort(
          `The registry row of "${tableId}" changed while the new baseline was checked; nothing was written. Run it again.`,
        );
      }
      // The references are re-read under the lock too (a registry apply may have run).
      const stillDangling = await danglingReferences(tx, reg);
      if (stillDangling.length > 0) {
        throw new RebaselineAbort(`Registry entries would point at vanished codes: ${stillDangling.join('; ')}.`);
      }
      const counts = await count(tx);
      await tx.query('delete from observations where table_id = $1', [tableId]);
      await tx.query('delete from slice_fetches where table_id = $1', [tableId]);
      await writeSliceRegistration(tx, reg, 'replace');
      const batch = await tx.query(
        `insert into ingestion_batches
           (table_id, outcome, finished_at, row_count, rows_inserted, rows_updated, rows_unchanged, rows_missing,
            corrections, fingerprint, rebaselined)
         values ($1, 'succeeded', now(), 0, 0, 0, 0, 0, '[]'::jsonb, $2, true)
         returning id`,
        [tableId, reg.fingerprint],
      );
      return { ...counts, batchId: Number(batch.rows[0]!.id) };
    })
    .catch((err: unknown) => {
      if (err instanceof RebaselineAbort) return err;
      throw err;
    });
  if (written instanceof RebaselineAbort) return refused(written.message);

  const warm = reg.pinned ? await warmTable(db, source, tableId, { deadline: opts.deadline, now: opts.now }) : null;
  return { tableId, outcome: 'rebaselined', ...summary, ...written, warm };
}

export function describeRebaseline(r: RebaselineSlicesResult): string {
  const id = r.tableId;
  if (r.outcome === 'refused') return `[${id}] REFUSED — nothing was written.\n  ${r.reason ?? ''}`;
  const change =
    `  Fingerprint ${r.oldFingerprint ?? '(none)'} -> ${r.newFingerprint}; measures added: ` +
    `${r.measuresAdded?.join(', ') || 'none'}; removed: ${r.measuresRemoved?.join(', ') || 'none'}.`;
  if (r.outcome === 'dry_run') {
    return [
      `[${id}] DRY RUN — every check passed; nothing was written.`,
      `  With --yes: take CBS's current layout as the new baseline, delete ${r.cellsDeleted} stored cell(s) and ` +
        `${r.sliceRecordsDeleted} slice record(s), and make the table active again.`,
      change,
    ].join('\n');
  }
  const lines = [
    `[${id}] re-baselined — active again (batch ${r.batchId}); ${r.cellsDeleted} cell(s) and ` +
      `${r.sliceRecordsDeleted} slice record(s) deleted.`,
    change,
  ];
  const w = r.warm;
  if (w === null || w === undefined) {
    lines.push('  Not pinned: its cells are fetched again on the next question.');
  } else if (w.outcome === 'complete') {
    lines.push(`  Warm run complete — ${w.planned} request(s).`);
  } else {
    lines.push(
      `  Warm run ${w.outcome}${w.failure ? ` (${w.failure.stage}): ${w.failure.summary}` : ''} — ` +
        `${w.remaining} request(s) remain. Finish it with: ingest warm ${id}`,
    );
  }
  return lines.join('\n');
}
