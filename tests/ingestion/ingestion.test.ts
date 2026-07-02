// Ingestion fixture test suite — will hold the corruption-fixture tests required by
// docs/05-data-rules.md ("Verify:" clauses in the validation-pipeline section). Each
// todo is one required fixture; they become real tests in the ingestion work package
// ("Ingestion + validation pipeline with fixture tests" on the Phase 0 checklist).
// A green run currently proves ONLY the doc-consistency check at the bottom.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ingestion validation fixtures (docs/05-data-rules.md, validation pipeline)', () => {
  it.todo('renamed dimension -> batch fails with schema-fingerprint reason; table marked needs_review and excluded from answering');
  it.todo('unparseable period code -> batch fails at period parsing');
  it.todo('unknown dimension code -> batch fails at dimension mapping (no silent new municipality codes)');
  it.todo('changed unit vs registry -> batch fails/flags at unit consistency');
  it.todo('implausible row count (truncated sync) -> batch fails row plausibility (default ±20%, per-table override)');
  it.todo('empty measure -> batch fails row plausibility');
  it.todo('null value with CBS reason (ValueAttribute) -> ingests as a VALID row carrying its status, not a failure');
  it.todo('same sync run twice -> identical row content (table checksum/diff), not just identical counts (idempotency)');
  it.todo('second sync with one changed historical cell -> batch correction log names exactly that cell');
  it.todo('ingestion CLI failure -> non-zero exit + plain-language summary (loud includes the operator)');
});

describe('doc consistency (keeps this scaffold honest)', () => {
  it('docs/05-data-rules.md still requires the five validation checks in order', () => {
    const dataRules = readFileSync(new URL('../../docs/05-data-rules.md', import.meta.url), 'utf8');
    for (const check of ['Schema fingerprint', 'Row plausibility', 'Period parsing', 'Dimension mapping', 'Unit consistency']) {
      expect(dataRules, `validation check "${check}" missing from docs`).toContain(check);
    }
  });
});
