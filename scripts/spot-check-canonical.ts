// LLM-free spot-check of a canonical key against the LIVE database — the
// standing last step of the curated coverage-sprint table procedure
// (docs/RUNBOOK.md): construct the intent by hand (no LLM call, no credits),
// run the REAL deterministic query path, and print what a user's answer would
// be built from. Read-only; safe to run against production.
//
// Usage: node --env-file=.env scripts/spot-check-canonical.ts <canonicalKey> <periodCode> [<periodCode> ...]
//   e.g. node --env-file=.env scripts/spot-check-canonical.ts gdp_growth_yoy_volume 2026KW01
import { connectFromEnv } from '../src/db/client.ts';
import { runQuery } from '../src/query/index.ts';
import type { StructuredIntent } from '../src/query/index.ts';
import { buildDefinitionLine } from '../src/answer/compose/format.ts';

const [key, ...codes] = process.argv.slice(2);
if (!key || codes.length === 0) {
  console.error('usage: spot-check-canonical.ts <canonicalKey> <periodCode> [<periodCode> ...]');
  process.exit(1);
}

const intent: StructuredIntent = {
  schemaVersion: 1,
  target: { kind: 'canonical', key },
  period: { kind: 'codes', codes },
  derivation: 'none',
};

const { db, pool } = connectFromEnv();
try {
  const outcome = await runQuery(db, intent);
  if (!outcome.ok) {
    console.log(`REFUSAL (${outcome.refusal.kind}): ${outcome.refusal.message}`);
    process.exitCode = 2;
  } else {
    for (const cell of outcome.cells) {
      console.log(
        `${key} ${cell.periodCode}: ${cell.value} ${cell.unit} (status ${cell.status}, tabel ${outcome.attribution.tableId})`,
      );
    }
    const definition = buildDefinitionLine(outcome);
    if (definition) console.log(`Definitie: ${definition}`);
  }
} finally {
  await pool.end();
}
