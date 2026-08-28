// Read-only RLS (Row-Level Security) posture audit — session 66, docs/session-briefs/2026-08-27-session-66-autonomous-queue.md.
//
// This product has no direct client-to-DB path (access goes through the
// service-role connection only, by design), so the known-good posture,
// live-verified when migration 011 first went in (session 25, 2026-07-05),
// is: every table in `public` has RLS ON, ZERO policies, and ZERO grants to
// `anon`/`authenticated` (both roles inherit from PUBLIC unless GRANTed).
// Flags any table that drifts from that shape, including ones added since.
//
// Usage: node --env-file=.env scripts/rls-audit.ts
import { connectFromEnv } from '../src/db/client.ts';

interface TableRow {
  tablename: string;
  rowsecurity: boolean;
}
interface PolicyRow {
  tablename: string;
  policy_count: string;
}
interface GrantRow {
  table_name: string;
  grantee: string;
  privilege_type: string;
}

const { db, pool } = connectFromEnv();
try {
  const tablesResult = await db.query(
    `select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename`,
  );
  const tables = tablesResult.rows as unknown as TableRow[];

  const policiesResult = await db.query(
    `select tablename, count(*)::text as policy_count from pg_policies where schemaname = 'public' group by tablename`,
  );
  const policies = policiesResult.rows as unknown as PolicyRow[];
  const policyCounts = new Map(policies.map((r) => [r.tablename, Number(r.policy_count)]));

  const grantsResult = await db.query(
    `select table_name, grantee, privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon', 'authenticated')
     order by table_name, grantee, privilege_type`,
  );
  const grants = grantsResult.rows as unknown as GrantRow[];

  console.log(`RLS audit — ${tables.length} table(s) in schema 'public'\n`);

  let drift = 0;
  for (const t of tables) {
    const policyCount = policyCounts.get(t.tablename) ?? 0;
    const tableGrants = grants.filter((g) => g.table_name === t.tablename);
    const flags: string[] = [];
    if (!t.rowsecurity) flags.push('RLS OFF');
    if (policyCount !== 0) flags.push(`${policyCount} POLICIES (expected 0)`);
    if (tableGrants.length > 0) {
      flags.push(
        `GRANTS: ${tableGrants.map((g) => `${g.grantee}:${g.privilege_type}`).join(', ')}`,
      );
    }
    const status = flags.length > 0 ? `DRIFT — ${flags.join(' | ')}` : 'OK';
    if (flags.length > 0) drift++;
    console.log(`  ${t.tablename.padEnd(40)} rls=${t.rowsecurity ? 'on ' : 'OFF'} policies=${policyCount} grants=${tableGrants.length}  ${status}`);
  }

  console.log(`\n${drift === 0 ? 'CLEAN' : `${drift} TABLE(S) WITH DRIFT`} — known-good posture: RLS on, 0 policies, 0 anon/authenticated grants (session 25, 2026-07-05).`);
  process.exitCode = drift === 0 ? 0 : 1;
} finally {
  await pool.end();
}
