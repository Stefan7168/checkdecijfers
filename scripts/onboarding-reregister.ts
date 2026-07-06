// Re-runs onboarding vocabulary registration for an ALREADY-onboarded table, so a
// field added to the pipeline after that table was first onboarded (e.g.
// canonical_measures.definition_text, #115 lever b) backfills from the table's
// CURRENT units metadata. registerOnboardingVocabulary is idempotent (it upserts
// on the key), so this only fills the new field + refreshes the CBS-derived
// labels; it never invents a value and never touches an observation.
//
// PREREQUISITES (run in order): migration that adds the field is applied to the
// target DB, and the table has been RE-SYNCED with current code so its
// cbs_tables.units carry the new source data (for #115: `npm run ingest -- sync
// <tableId>` captures the CBS measure Description into units.description first).
//
// Usage:  node --env-file=.env scripts/onboarding-reregister.ts <tableId> <topicTerm>
// Example: node --env-file=.env scripts/onboarding-reregister.ts 83694NED consumentenvertrouwen
import { connectFromEnv } from '../src/db/client.ts';
import { registerOnboardingVocabulary } from '../src/ingestion/onboarding-vocab.ts';

const [tableId, topicTerm] = process.argv.slice(2);
if (!tableId || !topicTerm) {
  console.error('Usage: node --env-file=.env scripts/onboarding-reregister.ts <tableId> <topicTerm>');
  process.exit(1);
}

const { db, pool } = connectFromEnv();
try {
  const result = await registerOnboardingVocabulary(db, { tableId, topicTerm });
  console.log(`Re-registered ${result.onboarded.length} measure(s) for ${tableId} (topic "${topicTerm}"):`);
  for (const m of result.onboarded) {
    const dt = m.measure.definitionText;
    const shown = dt ? `"${dt.length > 90 ? dt.slice(0, 90) + '…' : dt}"` : 'NULL (no CBS definition)';
    console.log(`  ${m.measure.key}\n    definitie: ${shown}`);
  }
  if (result.skippedMeasures.length > 0) {
    console.log(`Skipped (no empty-coordinate data): ${result.skippedMeasures.join(', ')}`);
  }
} finally {
  await pool.end();
}
