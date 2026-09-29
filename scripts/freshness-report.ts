// #355 (session 148): which CBS tables have newer data at CBS than in our database — and is
// each one safe to refresh? READ-ONLY: no writes, no AI calls, no schema change.
//
// Step 1 of the RUNBOOK's release-day procedure: CBS's own `Modified` date (the adapter's
// Properties fetch) against cbs_tables.last_sync_at. Step 2 for every table that is behind:
// CBS's current code lists and structure against what we store (dimension_labels, the schema
// fingerprint) — `safe` means the only change is the next period, so `sync … --accept-new-codes`
// is the documented path; `review` means a person looks first (never forced).
//
//   npm run ingest:freshness            human-readable report + the exact sync commands
//   npm run ingest:freshness -- --json  the same findings as JSON
//
// Not checked: slice-cache tables (fetched on demand, never bulk-synced) and non-CBS sources
// (Eurostat refreshes twice a day and has its own adapter).
import { connectFromEnv } from '../src/db/client.ts';
import { adapterFor } from '../src/sources/adapters.ts';
import { CBS_SOURCE_KEY, sourceKeyForTableId } from '../src/sources/registry.ts';
import { computeFingerprint } from '../src/ingestion/fingerprint.ts';
import { allowListedMeasures } from '../src/ingestion/measure-allow-list.ts';
import { fetchAllCodeLists } from '../src/ingestion/pipeline.ts';
import {
  assessFreshness,
  classifyRelease,
  type FreshnessInputRow,
  type ReleaseVerdict,
} from '../src/ingestion/freshness.ts';

const asJson = process.argv.includes('--json');
const { db, pool } = connectFromEnv();

try {
  const tables = await db.query(
    `select id, last_sync_at, slice, schema_fingerprint from cbs_tables
      where status = 'active' and ingest_mode = 'full' order by id`,
  );
  const source = adapterFor(CBS_SOURCE_KEY);
  const inputs: FreshnessInputRow[] = [];
  const notChecked: string[] = [];
  const registered = new Map<string, { slice: unknown; fingerprint: string | null }>();
  for (const t of tables.rows) {
    const tableId = t.id as string;
    if (sourceKeyForTableId(tableId) !== CBS_SOURCE_KEY) {
      notChecked.push(tableId);
      continue;
    }
    registered.set(tableId, {
      slice: typeof t.slice === 'string' ? JSON.parse(t.slice) : (t.slice ?? null),
      fingerprint: (t.schema_fingerprint as string | null) ?? null,
    });
    let cbsModifiedAt: string | null = null;
    try {
      cbsModifiedAt = (await source.fetchTableSchema(tableId)).modified ?? null;
    } catch (err) {
      console.error(`could not read CBS's date for ${tableId}: ${err instanceof Error ? err.message : String(err)}`);
    }
    inputs.push({
      tableId,
      lastSyncAt: t.last_sync_at == null ? null : new Date(t.last_sync_at as string | Date).toISOString(),
      cbsModifiedAt,
    });
  }
  const findings = assessFreshness(inputs);

  // Step 2, only for tables that are behind.
  const verdicts = new Map<string, ReleaseVerdict | { verdict: 'unknown'; reasons: string[] }>();
  for (const f of findings.filter((x) => x.status === 'behind')) {
    const reg = registered.get(f.tableId)!;
    try {
      const slice = (reg.slice ?? undefined) as Parameters<typeof source.fetchTableSchema>[1];
      const schema = await source.fetchTableSchema(f.tableId, slice);
      const fetched = await fetchAllCodeLists(source, f.tableId, schema.dimensions, slice);
      const labels = await db.query('select dimension, code from dimension_labels where table_id = $1', [f.tableId]);
      const stored: Record<string, string[]> = {};
      for (const r of labels.rows) (stored[r.dimension as string] ??= []).push(r.code as string);
      const allow = allowListedMeasures(slice);
      const measureCodes = (allow === null ? schema.measures : schema.measures.filter((m) => allow.has(m.code))).map((m) => m.code);
      verdicts.set(
        f.tableId,
        classifyRelease({
          timeDimension: schema.dimensions.find((d) => d.kind === 'TimeDimension')?.name ?? null,
          stored,
          fetched: Object.fromEntries(Object.entries(fetched).map(([dim, codes]) => [dim, codes.map((c) => c.code)])),
          storedFingerprint: reg.fingerprint,
          fetchedFingerprint: computeFingerprint(schema.dimensions, measureCodes),
        }),
      );
    } catch (err) {
      verdicts.set(f.tableId, { verdict: 'unknown', reasons: [`could not read CBS's structure: ${err instanceof Error ? err.message : String(err)}`] });
    }
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        { checkedAt: new Date().toISOString(), findings: findings.map((f) => ({ ...f, release: verdicts.get(f.tableId) ?? null })), notChecked },
        null,
        2,
      ),
    );
  } else {
    const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : '—');
    const behind = findings.filter((f) => f.status === 'behind');
    const unknown = findings.filter((f) => f.status === 'unknown');
    console.log(`Freshness of our CBS copy — checked ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    console.log(`\n${behind.length} of ${findings.length} table(s) have newer data at CBS than in our database:`);
    for (const f of behind) {
      const v = verdicts.get(f.tableId);
      const tag = v?.verdict === 'safe' ? 'SAFE  ' : v?.verdict === 'review' ? 'REVIEW' : 'UNSURE';
      const added = v && 'newPeriodCodes' in v && v.newPeriodCodes.length > 0 ? `  new period(s): ${v.newPeriodCodes.join(', ')}` : '';
      console.log(`  ${tag} ${f.tableId.padEnd(10)} ours ${day(f.lastSyncAt)}  CBS changed ${day(f.cbsModifiedAt)} (${f.daysBehind}d newer)${added}`);
      if (v && v.verdict !== 'safe') for (const reason of v.reasons) console.log(`           - ${reason}`);
    }
    if (unknown.length > 0) {
      console.log(`\n${unknown.length} table(s) could not be compared (never guessed as up to date): ${unknown.map((f) => f.tableId).join(', ')}`);
    }
    console.log(`\nUp to date: ${findings.filter((f) => f.status === 'current').length}. Not checked: ${notChecked.length ? notChecked.join(', ') : 'none'}.`);
    const safe = behind.filter((f) => verdicts.get(f.tableId)?.verdict === 'safe').map((f) => f.tableId);
    if (safe.length > 0) {
      console.log(`\nTo refresh the SAFE ones (owner-supervised — writes to the live database through the validated pipeline):`);
      console.log(`  npm run ingest sync ${safe.join(' ')} --accept-new-codes`);
    }
  }
} finally {
  await pool.end();
}
