// Ingestion fixture test suite — the corruption-fixture tests required by
// docs/05-data-rules.md ("Verify:" clauses in the validation-pipeline section).
// Each test feeds a realistic wire-level corruption (mutated RAW CBS response
// objects, the way a real CBS redesign or transcription slip would show up)
// through the real pipeline and asserts the exact stage, the loud failure
// summary, and that the table is quarantined (needs_review, excluded from
// answering) as docs/05 requires.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import { runCli } from '../../src/ingestion/cli.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { PHASE0_TABLES, SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

function fixturePath(tableId: string): string {
  return `${FIXTURES_DIR}/${tableId}`;
}

function table(id: string) {
  const t = PHASE0_TABLES.find((entry) => entry.id === id);
  if (!t) throw new Error(`no Phase0Table registry entry for ${id}`);
  return t;
}

/** Raw fixture doc bag as loadFixtureDocs returns it, kept untyped here on
 * purpose: the corruption tests mutate wire-shaped fields the pinned
 * CbsSource types deliberately do not expose (Identifier, Unit, etc). */
type RawDocs = Awaited<ReturnType<typeof loadFixtureDocs>>;

async function loadDocs(tableId: string): Promise<RawDocs> {
  return loadFixtureDocs(fixturePath(tableId));
}

function clone(docs: RawDocs): RawDocs {
  return structuredClone(docs);
}

/** md5(string_agg(...)) checksum over every observation column, ordered by
 * the natural key (table, measure, period_code, region_code, dims) — the
 * idempotency/content check docs/05 asks for (not just row counts). */
async function observationsChecksum(db: Db, tableId: string): Promise<string> {
  const result = await db.query(
    `select md5(string_agg(
        coalesce(measure,'') || '|' || coalesce(region_code,'') || '|' ||
        coalesce(period_code,'') || '|' || coalesce(dims::text,'') || '|' ||
        coalesce(value::text,'') || '|' || coalesce(unit,'') || '|' ||
        coalesce(status,'') || '|' || coalesce(value_attribute,''),
        ','
        order by measure, period_code, region_code, dims::text
      )) as checksum
     from observations where table_id = $1`,
    [tableId],
  );
  return result.rows[0]?.checksum as string;
}

describe('ingestion validation fixtures (docs/05-data-rules.md, validation pipeline)', () => {
  it('renamed dimension -> batch fails with schema-fingerprint reason; table marked needs_review and excluded from answering', async () => {
    const { db, close } = await createTestDb();
    try {
      const cleanDocs = await loadDocs('85224NED');
      const cleanSource = new FixtureSource(cleanDocs);

      await registerTables(db, cleanSource, [table('85224NED')]);
      const first = await syncTable(db, cleanSource, '85224NED');
      expect(first.outcome).toBe('succeeded'); // positive control

      const checksumBefore = await observationsChecksum(db, '85224NED');

      const corruptDocs = clone(cleanDocs);
      const dims = corruptDocs.dimensions as { value: { Identifier: string }[] };
      for (const dim of dims.value) {
        if (dim.Identifier === 'SeizoenEnWerkdagcorrectie') dim.Identifier = 'SeizoenCorrectieV2';
      }
      const codes = corruptDocs.codes as Record<string, { value: unknown[] }>;
      if (codes.SeizoenEnWerkdagcorrectie) {
        codes.SeizoenCorrectieV2 = codes.SeizoenEnWerkdagcorrectie;
        delete codes.SeizoenEnWerkdagcorrectie;
      }
      const obsPages = corruptDocs.observationPages as { value: Record<string, unknown>[] }[];
      for (const page of obsPages) {
        for (const row of page.value) {
          if ('SeizoenEnWerkdagcorrectie' in row) {
            row.SeizoenCorrectieV2 = row.SeizoenEnWerkdagcorrectie;
            delete row.SeizoenEnWerkdagcorrectie;
          }
        }
      }
      const corruptSource = new FixtureSource(corruptDocs);

      const second = await syncTable(db, corruptSource, '85224NED');
      expect(second.outcome).toBe('failed');
      expect(second.failureStage).toBe('schema_fingerprint');

      const row = (await db.query('select status, needs_review_reason from cbs_tables where id = $1', ['85224NED'])).rows[0];
      expect(row?.status).toBe('needs_review');
      expect(row?.needs_review_reason).toBeTruthy();

      const checksumAfter = await observationsChecksum(db, '85224NED');
      expect(checksumAfter).toBe(checksumBefore);
    } finally {
      await close();
    }
  });

  it('unparseable period code -> batch fails at period parsing', async () => {
    const { db, close } = await createTestDb();
    try {
      const docs = clone(await loadDocs('85224NED'));

      const obsPages = docs.observationPages as { value: Record<string, unknown>[] }[];
      const target = obsPages[0].value[0];
      target.Perioden = '2024XX00';

      // Also add the bad code to the Perioden code list so a later stage
      // (dimension_mapping) cannot be the one that catches it instead: the
      // failure must come from period parsing itself.
      const periodenCodes = (docs.codes as Record<string, { value: Record<string, unknown>[] }>)
        .Perioden;
      periodenCodes.value.push({
        Identifier: '2024XX00',
        Index: periodenCodes.value.length + 1,
        Title: '2024 onbekend',
        Description: '',
        DimensionGroupId: '0',
        Status: 'Definitief',
      });

      const source = new FixtureSource(docs);
      await registerTables(db, source, [table('85224NED')]);
      const result = await syncTable(db, source, '85224NED');

      expect(result.outcome).toBe('failed');
      expect(result.failureStage).toBe('period_parsing');

      const row = (await db.query('select status from cbs_tables where id = $1', ['85224NED'])).rows[0];
      expect(row?.status).toBe('needs_review');

      const count = (await db.query('select count(*)::int as n from observations where table_id = $1', ['85224NED'])).rows[0];
      expect(count?.n).toBe(0);
    } finally {
      await close();
    }
  });

  describe('unknown dimension code', () => {
    it('(a) one observation coordinate not present in any code list -> fails dimension_mapping', async () => {
      const { db, close } = await createTestDb();
      try {
        const docs = clone(await loadDocs('85224NED'));
        const obsPages = docs.observationPages as { value: Record<string, unknown>[] }[];
        obsPages[0].value[0].SeizoenEnWerkdagcorrectie = 'X999999';

        const source = new FixtureSource(docs);
        await registerTables(db, source, [table('85224NED')]);
        const result = await syncTable(db, source, '85224NED');

        expect(result.outcome).toBe('failed');
        expect(result.failureStage).toBe('dimension_mapping');

        const row = (await db.query('select status from cbs_tables where id = $1', ['85224NED'])).rows[0];
        expect(row?.status).toBe('needs_review');

        const count = (
          await db.query('select count(*)::int as n from observations where table_id = $1', ['85224NED'])
        ).rows[0];
        expect(count?.n).toBe(0);
      } finally {
        await close();
      }
    });

    it('(b) municipal-reorg style new code -> fails dimension_mapping naming the code; acceptNewCodes:true succeeds and labels it', async () => {
      const { db, close } = await createTestDb();
      try {
        const cleanDocs = await loadDocs('85224NED');
        const cleanSource = new FixtureSource(cleanDocs);
        await registerTables(db, cleanSource, [table('85224NED')]);
        const first = await syncTable(db, cleanSource, '85224NED');
        expect(first.outcome).toBe('succeeded');

        const docsWithNewCode = clone(cleanDocs);
        const codeList = (docsWithNewCode.codes as Record<string, { value: Record<string, unknown>[] }>)
          .SeizoenEnWerkdagcorrectie;
        codeList.value.push({
          Identifier: 'A099999',
          Index: codeList.value.length + 1,
          Title: 'Nieuwe correctiemethode',
          Description: '',
          DimensionGroupId: null,
        });
        const obsPages = docsWithNewCode.observationPages as { value: Record<string, unknown>[] }[];
        const template = obsPages[0].value[0];
        obsPages[0].value.push({
          ...template,
          Id: -1,
          SeizoenEnWerkdagcorrectie: 'A099999',
        });

        const sourceWithNewCode = new FixtureSource(docsWithNewCode);

        const failing = await syncTable(db, sourceWithNewCode, '85224NED');
        expect(failing.outcome).toBe('failed');
        expect(failing.failureStage).toBe('dimension_mapping');
        expect(failing.failureSummary).toBeTruthy();
        expect(failing.failureSummary).toContain('A099999');

        // A failed sync quarantines the table (needs_review); syncTable refuses
        // to run again without an explicit, reviewed rebaseline (docs/05: "loud,
        // never silent" — acceptNewCodes alone is not enough to leave quarantine,
        // matching the "quarantined table" behavior asserted in 'sync semantics').
        const accepted = await syncTable(db, sourceWithNewCode, '85224NED', {
          acceptNewCodes: true,
          rebaseline: true,
        });
        expect(accepted.outcome).toBe('succeeded');

        const label = (
          await db.query(
            `select label from dimension_labels
             where table_id = $1 and dimension = 'SeizoenEnWerkdagcorrectie' and code = 'A099999'`,
            ['85224NED'],
          )
        ).rows[0];
        expect(label?.label).toBe('Nieuwe correctiemethode');
      } finally {
        await close();
      }
    });
  });

  it('changed unit vs registry -> batch fails/flags at unit consistency', async () => {
    const { db, close } = await createTestDb();
    try {
      const cleanDocs = await loadDocs('85224NED');
      const cleanSource = new FixtureSource(cleanDocs);
      await registerTables(db, cleanSource, [table('85224NED')]);
      const first = await syncTable(db, cleanSource, '85224NED');
      expect(first.outcome).toBe('succeeded');

      const docs = clone(cleanDocs);
      const measures = (docs.measureCodes as { value: Record<string, unknown>[] }).value;
      const target = measures.find((m) => m.Identifier === 'M001906');
      if (!target) throw new Error('expected M001906 (Werkloosheidspercentage) in fixture');
      const oldUnit = target.Unit as string;
      target.Unit = 'x 1 000';

      const source = new FixtureSource(docs);
      const result = await syncTable(db, source, '85224NED');

      expect(result.outcome).toBe('failed');
      expect(result.failureStage).toBe('unit_consistency');
      expect(result.failureSummary).toContain('M001906');
      expect(result.failureSummary).toContain(oldUnit);
      expect(result.failureSummary).toContain('x 1 000');

      const row = (await db.query('select status from cbs_tables where id = $1', ['85224NED'])).rows[0];
      expect(row?.status).toBe('needs_review');
    } finally {
      await close();
    }
  });

  it('implausible row count (truncated sync) -> batch fails row plausibility; observation content unchanged', async () => {
    const { db, close } = await createTestDb();
    try {
      const cleanDocs = await loadDocs('85224NED');
      const cleanSource = new FixtureSource(cleanDocs);
      await registerTables(db, cleanSource, [table('85224NED')]);
      const first = await syncTable(db, cleanSource, '85224NED');
      expect(first.outcome).toBe('succeeded');
      expect(first.rowCount).toBeGreaterThan(4000);

      const checksumBefore = await observationsChecksum(db, '85224NED');

      const docs = clone(cleanDocs);
      const obsPages = docs.observationPages as { value: Record<string, unknown>[] }[];
      obsPages[0].value = obsPages[0].value.slice(0, 800); // >20% drop from ~4046

      const source = new FixtureSource(docs);
      const result = await syncTable(db, source, '85224NED');

      expect(result.outcome).toBe('failed');
      expect(result.failureStage).toBe('row_plausibility');

      const row = (await db.query('select status from cbs_tables where id = $1', ['85224NED'])).rows[0];
      expect(row?.status).toBe('needs_review');

      const checksumAfter = await observationsChecksum(db, '85224NED');
      expect(checksumAfter).toBe(checksumBefore);
    } finally {
      await close();
    }
  });

  it('empty measure (first sync, no previous count) -> batch fails row plausibility naming the measure', async () => {
    const { db, close } = await createTestDb();
    try {
      const docs = clone(await loadDocs('85224NED'));
      const obsPages = docs.observationPages as { value: Record<string, unknown>[] }[];
      // Werkloosheidspercentage (M001906) — remove every row for this measure.
      obsPages[0].value = obsPages[0].value.filter((row) => row.Measure !== 'M001906');

      const source = new FixtureSource(docs);
      await registerTables(db, source, [table('85224NED')]);
      const result = await syncTable(db, source, '85224NED');

      expect(result.outcome).toBe('failed');
      expect(result.failureStage).toBe('row_plausibility');
      expect(result.failureSummary).toContain('M001906');

      const row = (await db.query('select status from cbs_tables where id = $1', ['85224NED'])).rows[0];
      expect(row?.status).toBe('needs_review');

      const count = (
        await db.query('select count(*)::int as n from observations where table_id = $1', ['85224NED'])
      ).rows[0];
      expect(count?.n).toBe(0);
    } finally {
      await close();
    }
  });

  it('null value with CBS reason ingests as a valid row; null with reason "None" fails row plausibility', async () => {
    const { db, close } = await createTestDb();
    try {
      const docs = clone(await loadDocs('85224NED'));
      const obsPages = docs.observationPages as { value: Record<string, unknown>[] }[];
      const target = obsPages[0].value.find(
        (row) => row.Measure === 'M001906' && row.SeizoenEnWerkdagcorrectie === 'A050903',
      );
      if (!target) throw new Error('expected an M001906/A050903 row in the fixture');
      target.Value = null;
      target.ValueAttribute = 'Onbekend';
      const targetPeriod = target.Perioden as string;

      const source = new FixtureSource(docs);
      await registerTables(db, source, [table('85224NED')]);
      const result = await syncTable(db, source, '85224NED');

      expect(result.outcome).toBe('succeeded');

      const stored = (
        await db.query(
          `select value, value_attribute, unit, status from observations
           where table_id = $1 and measure = 'M001906' and period_code = $2
             and dims->>'SeizoenEnWerkdagcorrectie' = 'A050903'`,
          ['85224NED', targetPeriod],
        )
      ).rows[0];
      expect(stored).toBeDefined();
      expect(stored?.value).toBeNull();
      expect(stored?.value_attribute).toBe('Onbekend');
      expect(stored?.unit).toBe('%');
      expect(stored?.status).toBeTruthy();
    } finally {
      await close();
    }
  });

  it('null value with ValueAttribute "None" (no reason) fails row plausibility', async () => {
    const { db, close } = await createTestDb();
    try {
      const docs = clone(await loadDocs('85224NED'));
      const obsPages = docs.observationPages as { value: Record<string, unknown>[] }[];
      const target = obsPages[0].value.find(
        (row) => row.Measure === 'M001906' && row.SeizoenEnWerkdagcorrectie === 'A050903',
      );
      if (!target) throw new Error('expected an M001906/A050903 row in the fixture');
      target.Value = null;
      target.ValueAttribute = 'None';

      const source = new FixtureSource(docs);
      await registerTables(db, source, [table('85224NED')]);
      const result = await syncTable(db, source, '85224NED');

      expect(result.outcome).toBe('failed');
      expect(result.failureStage).toBe('row_plausibility');

      const row = (await db.query('select status from cbs_tables where id = $1', ['85224NED'])).rows[0];
      expect(row?.status).toBe('needs_review');

      const count = (
        await db.query('select count(*)::int as n from observations where table_id = $1', ['85224NED'])
      ).rows[0];
      expect(count?.n).toBe(0);
    } finally {
      await close();
    }
  });

  it('same sync run twice -> identical row content (checksum), not just counts (idempotency)', async () => {
    const { db, close } = await createTestDb();
    try {
      const docs = await loadDocs('85224NED');
      const source = new FixtureSource(docs);
      await registerTables(db, source, [table('85224NED')]);

      const firstBatch = await syncTable(db, source, '85224NED');
      expect(firstBatch.outcome).toBe('succeeded');
      const checksumAfterFirst = await observationsChecksum(db, '85224NED');

      const secondBatch = await syncTable(db, source, '85224NED');
      expect(secondBatch.outcome).toBe('succeeded');
      expect(secondBatch.rowsInserted).toBe(0);
      expect(secondBatch.rowsUpdated).toBe(0);
      expect(secondBatch.corrections).toEqual([]);

      const checksumAfterSecond = await observationsChecksum(db, '85224NED');
      expect(checksumAfterSecond).toBe(checksumAfterFirst);

      const batchRows = (
        await db.query('select count(*)::int as n from ingestion_batches where table_id = $1', [
          '85224NED',
        ])
      ).rows[0];
      expect(batchRows?.n).toBe(2);
    } finally {
      await close();
    }
  });

  it('second sync with one changed historical cell -> correction log names exactly that cell', async () => {
    const { db, close } = await createTestDb();
    try {
      const cleanDocs = await loadDocs('85224NED');
      const cleanSource = new FixtureSource(cleanDocs);
      await registerTables(db, cleanSource, [table('85224NED')]);
      const first = await syncTable(db, cleanSource, '85224NED');
      expect(first.outcome).toBe('succeeded');

      const docs = clone(cleanDocs);
      const obsPages = docs.observationPages as { value: Record<string, unknown>[] }[];
      // Pick a specific, identifiable historical cell.
      const target = obsPages[0].value.find(
        (row) =>
          row.Measure === 'T001143_2' &&
          row.SeizoenEnWerkdagcorrectie === 'A042501' &&
          row.Perioden === '2013KW01',
      );
      if (!target) throw new Error('expected the T001143_2/A042501/2013KW01 cell in the fixture');
      const oldValue = target.Value;
      target.Value = (target.Value as number) + 5;

      const source = new FixtureSource(docs);
      const result = await syncTable(db, source, '85224NED');

      expect(result.outcome).toBe('succeeded');
      expect(result.corrections).toHaveLength(1);
      const correction = result.corrections[0];
      expect(correction.measure).toBe('T001143_2');
      expect(correction.period_code).toBe('2013KW01');
      expect(correction.dims.SeizoenEnWerkdagcorrectie).toBe('A042501');
      expect(Number(correction.old_value)).toBe(oldValue as number);
      expect(Number(correction.new_value)).toBe(target.Value as number);
      expect(result.rowsUpdated).toBe(1);

      const batchRow = (
        await db.query(
          `select corrections from ingestion_batches where table_id = $1 and id = $2`,
          ['85224NED', result.batchId],
        )
      ).rows[0];
      expect(batchRow?.corrections).toEqual(result.corrections);
    } finally {
      await close();
    }
  });

  it('ingestion CLI: failure is non-zero exit + plain-language summary; success is zero exit + row counts', async () => {
    const { db, close } = await createTestDb();
    try {
      // Positive control: clean docs, exit 0, row counts printed.
      const cleanDocs = await loadDocs('85224NED');
      const cleanSource = new FixtureSource(cleanDocs);
      await registerTables(db, cleanSource, [table('85224NED')]);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const okExitCode = await runCli(['sync', '85224NED'], { db, source: cleanSource });
        expect(okExitCode).toBe(0);
        const okOutput = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join('\n');
        // Actual row-count line printed by printResult, not just "some digit".
        expect(okOutput).toMatch(/Rows — fetched: \d+/);

        const rowAfterOk = (
          await db.query('select status from cbs_tables where id = $1', ['85224NED'])
        ).rows[0];
        expect(rowAfterOk?.status).toBe('active');

        logSpy.mockClear();
        errorSpy.mockClear();

        // Corrupted docs: unit changed -> unit_consistency failure.
        const corruptDocs = clone(cleanDocs);
        const measures = (corruptDocs.measureCodes as { value: Record<string, unknown>[] }).value;
        const target = measures.find((m) => m.Identifier === 'M001906');
        if (!target) throw new Error('expected M001906 in fixture');
        target.Unit = 'x 1 000';
        const corruptSource = new FixtureSource(corruptDocs);

        const failExitCode = await runCli(['sync', '85224NED'], { db, source: corruptSource });
        expect(failExitCode).not.toBe(0);

        const failOutput = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join('\n');
        // A human-readable phrase, not a bare error code — the loud CLI
        // requirement from docs/05 ("Loud includes the operator").
        expect(failOutput.toLowerCase()).toMatch(/unit/);
        expect(failOutput).toContain('M001906');

        const rowAfterFail = (
          await db.query('select status from cbs_tables where id = $1', ['85224NED'])
        ).rows[0];
        expect(rowAfterFail?.status).toBe('needs_review');
      } finally {
        logSpy.mockRestore();
        errorSpy.mockRestore();
      }
    } finally {
      await close();
    }
  });

  it('changed decimals only (unit unchanged) vs registry -> batch fails/flags at unit consistency', async () => {
    const { db, close } = await createTestDb();
    try {
      const cleanDocs = await loadDocs('85224NED');
      const cleanSource = new FixtureSource(cleanDocs);
      await registerTables(db, cleanSource, [table('85224NED')]);
      const first = await syncTable(db, cleanSource, '85224NED');
      expect(first.outcome).toBe('succeeded');

      const docs = clone(cleanDocs);
      const measures = (docs.measureCodes as { value: Record<string, unknown>[] }).value;
      const target = measures.find((m) => m.Identifier === 'M001906');
      if (!target) throw new Error('expected M001906 (Werkloosheidspercentage) in fixture');
      const oldDecimals = target.Decimals as number;
      const oldUnit = target.Unit as string;
      target.Decimals = oldDecimals + 1; // Unit deliberately left unchanged.

      const source = new FixtureSource(docs);
      const result = await syncTable(db, source, '85224NED');

      expect(result.outcome).toBe('failed');
      expect(result.failureStage).toBe('unit_consistency');
      expect(result.failureSummary).toContain('M001906');
      expect(result.failureSummary).toContain(oldUnit);

      const row = (await db.query('select status from cbs_tables where id = $1', ['85224NED'])).rows[0];
      expect(row?.status).toBe('needs_review');
    } finally {
      await close();
    }
  });

  it('small number of new observation rows (new period) on second sync -> succeeds within the row-count tolerance', async () => {
    const { db, close } = await createTestDb();
    try {
      const cleanDocs = await loadDocs('85224NED');
      const cleanSource = new FixtureSource(cleanDocs);
      await registerTables(db, cleanSource, [table('85224NED')]);
      const first = await syncTable(db, cleanSource, '85224NED');
      expect(first.outcome).toBe('succeeded');
      const rowCountBefore = first.rowCount;

      const docs = clone(cleanDocs);

      // Register a new, valid period code (Voorlopig — legitimate near-term
      // CBS publication) in the Perioden code list.
      const periodenCodes = (docs.codes as Record<string, { value: Record<string, unknown>[] }>)
        .Perioden;
      const newPeriod = '2026KW02';
      periodenCodes.value.push({
        Identifier: newPeriod,
        Index: periodenCodes.value.length + 1,
        Title: '2026 2e kwartaal',
        Description: '',
        DimensionGroupId: '0',
        Status: 'Voorlopig',
      });

      // Duplicate the last 4 observation rows under the new period code —
      // same measure/dimension coordinates as their originals, but a
      // different Perioden value means no collision with existing cells.
      const obsPages = docs.observationPages as { value: Record<string, unknown>[] }[];
      const page = obsPages[0];
      const lastFour = page.value.slice(-4);
      const appended = lastFour.map((row, i) => ({
        ...row,
        Id: -(i + 1),
        Perioden: newPeriod,
      }));
      page.value.push(...appended);

      // The new period code itself is an unmapped dimension code (same
      // mechanism as the municipal-reorg case above) and needs reviewed
      // acceptance; that is orthogonal to what this test is proving, which
      // is the row-count tolerance in checkRowPlausibility.
      const source = new FixtureSource(docs);
      const result = await syncTable(db, source, '85224NED', { acceptNewCodes: true });

      expect(result.outcome).toBe('succeeded');
      expect(result.rowsInserted).toBe(appended.length);
      expect(result.rowCount).toBe(rowCountBefore + appended.length);

      const row = (await db.query('select status from cbs_tables where id = $1', ['85224NED'])).rows[0];
      expect(row?.status).toBe('active');
    } finally {
      await close();
    }
  });
});

describe('sync semantics', () => {
  it('R11 plumbing: 82610NED M002264_1/E006590/2024JJ00 has status NaderVoorlopig, value 21822, unit mln kWh', async () => {
    const { db, close } = await createTestDb();
    try {
      const docs = await loadDocs('82610NED');
      const source = new FixtureSource(docs);
      await registerTables(db, source, [table('82610NED')]);
      const result = await syncTable(db, source, '82610NED');
      expect(result.outcome).toBe('succeeded');

      const row = (
        await db.query(
          `select value, unit, status from observations
           where table_id = $1 and measure = 'M002264_1' and period_code = '2024JJ00'
             and dims->>'BronTechniek' = 'E006590'`,
          ['82610NED'],
        )
      ).rows[0];
      expect(row).toBeDefined();
      expect(Number(row?.value)).toBe(21822);
      expect(row?.unit).toBe('mln kWh');
      expect(row?.status).toBe('NaderVoorlopig');
    } finally {
      await close();
    }
  });

  it('quarantined table: syncTable without rebaseline throws mentioning quarantine; rebaseline:true against clean docs succeeds and clears it', async () => {
    const { db, close } = await createTestDb();
    try {
      const cleanDocs = await loadDocs('85224NED');
      const cleanSource = new FixtureSource(cleanDocs);
      await registerTables(db, cleanSource, [table('85224NED')]);
      await syncTable(db, cleanSource, '85224NED');

      const corruptDocs = clone(cleanDocs);
      const measures = (corruptDocs.measureCodes as { value: Record<string, unknown>[] }).value;
      const target = measures.find((m) => m.Identifier === 'M001906');
      if (!target) throw new Error('expected M001906 in fixture');
      target.Unit = 'x 1 000';
      const corruptSource = new FixtureSource(corruptDocs);

      const failed = await syncTable(db, corruptSource, '85224NED');
      expect(failed.outcome).toBe('failed');

      const rowBefore = (
        await db.query('select status, version from cbs_tables where id = $1', ['85224NED'])
      ).rows[0];
      expect(rowBefore?.status).toBe('needs_review');
      const versionBefore = rowBefore?.version as number;

      await expect(syncTable(db, corruptSource, '85224NED')).rejects.toThrow(/quarantine/i);

      const rebaselined = await syncTable(db, cleanSource, '85224NED', { rebaseline: true });
      expect(rebaselined.outcome).toBe('succeeded');
      expect(rebaselined.rebaselined).toBe(true);

      const rowAfter = (
        await db.query('select status, version from cbs_tables where id = $1', ['85224NED'])
      ).rows[0];
      expect(rowAfter?.status).toBe('active');
      expect(rowAfter?.version as number).toBeGreaterThan(versionBefore);

      const batchRow = (
        await db.query(
          `select rebaselined from ingestion_batches where table_id = $1 and id = $2`,
          ['85224NED', rebaselined.batchId],
        )
      ).rows[0];
      expect(batchRow?.rebaselined).toBe(true);
    } finally {
      await close();
    }
  });

  it('rebaseline that fails a later check leaves the registry baseline untouched', async () => {
    const { db, close } = await createTestDb();
    try {
      const cleanDocs = await loadDocs('85224NED');
      const cleanSource = new FixtureSource(cleanDocs);
      await registerTables(db, cleanSource, [table('85224NED')]);
      const first = await syncTable(db, cleanSource, '85224NED');
      expect(first.outcome).toBe('succeeded');

      const baselineBefore = (
        await db.query(
          'select expected_dimensions, units, version, schema_fingerprint from cbs_tables where id = $1',
          ['85224NED'],
        )
      ).rows[0]!;
      const labelCountBefore = (
        await db.query('select count(*)::int as n from dimension_labels where table_id = $1', ['85224NED'])
      ).rows[0]!.n;

      // Quarantine the table via a unit change.
      const unitCorrupt = clone(cleanDocs);
      const measures = (unitCorrupt.measureCodes as { value: Record<string, unknown>[] }).value;
      const target = measures.find((m) => m.Identifier === 'M001906');
      if (!target) throw new Error('expected M001906 in fixture');
      target.Unit = 'x 1 000';
      const failedSync = await syncTable(db, new FixtureSource(unitCorrupt), '85224NED');
      expect(failedSync.outcome).toBe('failed');

      // Rebaseline against docs that pass schema checks but fail row
      // plausibility (truncated fetch): the swap must NOT happen.
      const truncated = clone(unitCorrupt);
      const obsPages = truncated.observationPages as { value: Record<string, unknown>[] }[];
      obsPages[0].value = obsPages[0].value.slice(0, 800);
      const failedRebaseline = await syncTable(db, new FixtureSource(truncated), '85224NED', {
        rebaseline: true,
      });
      expect(failedRebaseline.outcome).toBe('failed');
      expect(failedRebaseline.failureStage).toBe('row_plausibility');

      const rowAfter = (
        await db.query(
          'select status, expected_dimensions, units, version, schema_fingerprint from cbs_tables where id = $1',
          ['85224NED'],
        )
      ).rows[0]!;
      expect(rowAfter.status).toBe('needs_review');
      expect(rowAfter.expected_dimensions).toEqual(baselineBefore.expected_dimensions);
      expect(rowAfter.units).toEqual(baselineBefore.units);
      expect(rowAfter.version).toBe(baselineBefore.version);
      expect(rowAfter.schema_fingerprint).toBe(baselineBefore.schema_fingerprint);
      // The corrupted unit ('x 1 000') never became the baseline.
      const units = rowAfter.units as Record<string, { unit: string }>;
      expect(units.M001906!.unit).toBe('%');
      const labelCountAfter = (
        await db.query('select count(*)::int as n from dimension_labels where table_id = $1', ['85224NED'])
      ).rows[0]!.n;
      expect(labelCountAfter).toBe(labelCountBefore);

      // A clean rebaseline afterwards still works and bumps the version once.
      const recovered = await syncTable(db, cleanSource, '85224NED', { rebaseline: true });
      expect(recovered.outcome).toBe('succeeded');
      const rowRecovered = (
        await db.query('select status, version from cbs_tables where id = $1', ['85224NED'])
      ).rows[0]!;
      expect(rowRecovered.status).toBe('active');
      expect(rowRecovered.version).toBe((baselineBefore.version as number) + 1);
    } finally {
      await close();
    }
  });

  it('period without a publication status -> batch fails at period parsing, nothing defaulted', async () => {
    const { db, close } = await createTestDb();
    try {
      const docs = clone(await loadDocs('85224NED'));
      const obsPages = docs.observationPages as { value: Record<string, unknown>[] }[];
      const observedPeriod = obsPages[0].value[0].Perioden as string;
      const periodenCodes = (docs.codes as Record<string, { value: Record<string, unknown>[] }>)
        .Perioden;
      const entry = periodenCodes.value.find((c) => c.Identifier === observedPeriod);
      if (!entry) throw new Error(`expected period ${observedPeriod} in the Perioden code list`);
      entry.Status = null;

      const source = new FixtureSource(docs);
      await registerTables(db, source, [table('85224NED')]);
      const result = await syncTable(db, source, '85224NED');

      expect(result.outcome).toBe('failed');
      expect(result.failureStage).toBe('period_parsing');
      expect(result.failureSummary).toContain(observedPeriod);
      expect(result.failureSummary?.toLowerCase()).toContain('status');

      const count = (
        await db.query('select count(*)::int as n from observations where table_id = $1', ['85224NED'])
      ).rows[0];
      expect(count?.n).toBe(0);
    } finally {
      await close();
    }
  });

  it('duplicate fetched cell (same measure + coordinates twice) -> batch fails row plausibility', async () => {
    const { db, close } = await createTestDb();
    try {
      const docs = clone(await loadDocs('85224NED'));
      const obsPages = docs.observationPages as { value: Record<string, unknown>[] }[];
      obsPages[0].value.push({ ...obsPages[0].value[0], Id: -1 });

      const source = new FixtureSource(docs);
      await registerTables(db, source, [table('85224NED')]);
      const result = await syncTable(db, source, '85224NED');

      expect(result.outcome).toBe('failed');
      expect(result.failureStage).toBe('row_plausibility');
      expect(result.failureSummary?.toLowerCase()).toContain('more than once');

      const row = (await db.query('select status from cbs_tables where id = $1', ['85224NED'])).rows[0];
      expect(row?.status).toBe('needs_review');

      const count = (
        await db.query('select count(*)::int as n from observations where table_id = $1', ['85224NED'])
      ).rows[0];
      expect(count?.n).toBe(0);
    } finally {
      await close();
    }
  });

  it('trailing-space defense: padded code + padded observation coordinate both end up trimmed', async () => {
    const { db, close } = await createTestDb();
    try {
      const docs = clone(await loadDocs('85224NED'));
      const codeList = (docs.codes as Record<string, { value: Record<string, unknown>[] }>)
        .SeizoenEnWerkdagcorrectie;
      const codeEntry = codeList.value.find((c) => c.Identifier === 'A050903');
      if (!codeEntry) throw new Error('expected A050903 in the code list');
      codeEntry.Identifier = 'A050903  ';

      const obsPages = docs.observationPages as { value: Record<string, unknown>[] }[];
      for (const page of obsPages) {
        for (const row of page.value) {
          if (row.SeizoenEnWerkdagcorrectie === 'A050903') {
            row.SeizoenEnWerkdagcorrectie = 'A050903  ';
          }
        }
      }

      const source = new FixtureSource(docs);
      await registerTables(db, source, [table('85224NED')]);
      const result = await syncTable(db, source, '85224NED');

      expect(result.outcome).toBe('succeeded');

      const label = (
        await db.query(
          `select code from dimension_labels
           where table_id = $1 and dimension = 'SeizoenEnWerkdagcorrectie' and code = 'A050903'`,
          ['85224NED'],
        )
      ).rows[0];
      expect(label?.code).toBe('A050903');

      const paddedLabel = (
        await db.query(
          `select code from dimension_labels
           where table_id = $1 and dimension = 'SeizoenEnWerkdagcorrectie' and code = 'A050903  '`,
          ['85224NED'],
        )
      ).rows[0];
      expect(paddedLabel).toBeUndefined();

      const obsRow = (
        await db.query(
          `select dims from observations
           where table_id = $1 and dims->>'SeizoenEnWerkdagcorrectie' = 'A050903'
           limit 1`,
          ['85224NED'],
        )
      ).rows[0];
      expect(obsRow).toBeDefined();
    } finally {
      await close();
    }
  });
});

describe('doc consistency (keeps this scaffold honest)', () => {
  it('docs/05-data-rules.md still requires the five validation checks in order', () => {
    const dataRules = readFileSync(new URL('../../docs/05-data-rules.md', import.meta.url), 'utf8');
    for (const check of ['Schema fingerprint', 'Row plausibility', 'Period parsing', 'Dimension mapping', 'Unit consistency']) {
      expect(dataRules, `validation check "${check}" missing from docs`).toContain(check);
    }
  });
});

describe('#167 — curated phantom-measure exclusion (Phase0Table.excludeMeasures, session 50)', () => {
  it('85880NED full ingest succeeds WITH the curated exclusion: 17 metadata-only measures skipped, headline registered, 22,230 fixture rows in', async () => {
    const { db, close } = await createTestDb();
    try {
      const source = new FixtureSource(await loadDocs('85880NED'));
      const seed = SEED_TABLES.find((t) => t.id === '85880NED');
      if (!seed) throw new Error('85880NED missing from SEED_TABLES');
      expect(seed.excludeMeasures).toHaveLength(17);

      await registerTables(db, source, [seed]);
      const sync = await syncTable(db, source, '85880NED');
      expect(sync.outcome).toBe('succeeded');

      const row = (await db.query(`select units, status from cbs_tables where id = $1`, ['85880NED'])).rows[0]!;
      expect(row.status).toBe('active');
      const units = (typeof row.units === 'string' ? JSON.parse(row.units) : row.units) as Record<string, unknown>;
      // 210 MeasureCodes entries minus the 17 phantoms.
      expect(Object.keys(units)).toHaveLength(193);
      for (const code of seed.excludeMeasures ?? []) {
        expect(units[code], `phantom ${code} must not be registered`).toBeUndefined();
      }
      // The measure the canonical keys pin stays served.
      expect(units['M002782_1']).toBeDefined();

      const n = await db.query(`select count(*)::int c from observations where table_id = $1`, ['85880NED']);
      expect(Number(n.rows[0]!.c)).toBe(22230);
    } finally {
      await close();
    }
  });

  it('strictness unchanged WITHOUT a curated list: a metadata-only measure on an unexcluded table still quarantines at row_plausibility', async () => {
    const { db, close } = await createTestDb();
    try {
      const docs = clone(await loadDocs('82235NED'));
      const measureDocs = (docs.measureCodes as { value: Record<string, unknown>[] }).value;
      // Wire-shaped phantom: clone a REAL entry so the parser accepts it, then
      // give it a code no observation row carries.
      const phantom = structuredClone(measureDocs[0]!);
      phantom.Identifier = 'M999999';
      phantom.Title = 'Spookmaat (testfixture)';
      measureDocs.push(phantom);
      const source = new FixtureSource(docs);

      await registerTables(db, source, [table('82235NED')]);
      const sync = await syncTable(db, source, '82235NED');
      expect(sync.outcome).toBe('failed');
      expect(sync.failureStage).toBe('row_plausibility');
      expect(sync.failureSummary).toContain('M999999');

      const row = (await db.query('select status from cbs_tables where id = $1', ['82235NED'])).rows[0]!;
      expect(row.status).toBe('needs_review');
    } finally {
      await close();
    }
  });
});
