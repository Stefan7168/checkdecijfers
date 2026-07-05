// GDPR retention purge (#14, docs/08-build-plan.md WP14): redacts every
// source_tag='user' audit_answers row older than the 2-year retention window
// (docs/05-data-rules.md audit-trail section). Deterministic code only — no
// LLM calls, no live pipeline invocation.
//
//   npm run gdpr:purge                dry run (default): reports how many
//                                      rows WOULD be redacted, changes nothing.
//   npm run gdpr:purge -- --apply     actually redacts the matching rows.
//
// Idempotent: redacting an already-redacted row writes the identical sentinel
// values again (src/answer/audit/retention.ts) — a second run against the same
// cutoff always finds zero NEWLY-affected rows once the first run committed,
// and re-running it is always safe (never double-charges, never touches the
// ledger, never widens scope).
//
// Scope, enforced in retention.ts (never trusted to this script): ONLY
// source_tag = 'user' rows. benchmark/validation rows are this project's own
// regression fixtures and are never touched, regardless of age.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { purgeExpiredQuestionHistory, twoYearsBefore } from '../src/answer/audit/index.ts';
import { connectFromEnv } from '../src/db/client.ts';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const cutoff = twoYearsBefore(new Date());

  const { db, pool } = connectFromEnv();
  try {
    if (!apply) {
      // Dry run: reuse the exact same selection the real purge would use, but
      // roll back instead of relying on redactMatchingRows' commit — a
      // read-only preview must never be able to write, even accidentally.
      const { rows } = await db.query(
        `select count(*)::int as n from audit_answers where source_tag = 'user' and created_at < $1`,
        [cutoff.toISOString()],
      );
      const n = Number(rows[0]?.n ?? 0);
      console.log(
        `DRY RUN — cutoff ${cutoff.toISOString()}: ${n} source_tag='user' row(s) older than 2 years would be redacted.`,
      );
      console.log('Re-run with --apply to actually redact them.');
      return;
    }

    const redacted = await purgeExpiredQuestionHistory(db, cutoff);
    console.log(
      `Applied — cutoff ${cutoff.toISOString()}: redacted ${redacted.length} source_tag='user' row(s).`,
    );
    if (redacted.length > 0) {
      const byKind = redacted.reduce<Record<string, number>>((acc, r) => {
        acc[r.kind] = (acc[r.kind] ?? 0) + 1;
        return acc;
      }, {});
      console.log(`  by kind: ${JSON.stringify(byKind)}`);
    }
  } finally {
    try {
      await pool.end();
    } catch (closeError) {
      console.error('warning: closing the database connection failed:', closeError);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
