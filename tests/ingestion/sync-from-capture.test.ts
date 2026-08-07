// #192 — the supervised capture escape hatch must be able to complete a
// RELEASE-DAY sync, which is the one job it exists for.
//
// The bug: scripts/sync-from-capture.ts called syncTable with no options bag,
// so acceptNewCodes/rebaseline were unreachable from that entry point. Every
// CBS release adds a period code BY DEFINITION; an unmapped code fails
// checkDimensionMapping; a failed mapping quarantines the table
// (status = 'needs_review'); and a quarantined table REFUSES in production.
// So the documented hatch would have taken the table out of service rather
// than syncing it. It only ever worked because session 50 used it for a
// FIRST-TIME registration, where registration populates dimension_labels and
// nothing is new.
//
// These pins drive the script's OWN exported functions, not syncTable
// directly — otherwise they would prove the pipeline works (already pinned in
// ingestion.test.ts) while saying nothing about the entry point that was
// broken. Session 60's trap 1: a test can name the issue it does not cover.
//
// Hermetic: PGlite + committed 85224NED fixture with a synthetic new code
// injected in memory. No network, no capture directory, no CBS call.
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { PHASE0_TABLES } from '../../src/ingestion/registry-seed.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { parseArgs, runSyncFromCapture } from '../../scripts/sync-from-capture.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));
const TABLE_ID = '85224NED';

type RawDocs = Awaited<ReturnType<typeof loadFixtureDocs>>;

function registryEntry(id: string) {
  const t = PHASE0_TABLES.find((entry) => entry.id === id);
  if (!t) throw new Error(`no Phase0Table registry entry for ${id}`);
  return t;
}

/** The shape every CBS release has: one code in a dimension's code list that
 * our dimension_labels does not know yet, plus an observation that uses it. */
function withNewDimensionCode(docs: RawDocs): RawDocs {
  const next = structuredClone(docs);
  const codeList = (next.codes as Record<string, { value: Record<string, unknown>[] }>)
    .SeizoenEnWerkdagcorrectie;
  codeList.value.push({
    Identifier: 'A099999',
    Index: codeList.value.length + 1,
    Title: 'Nieuwe correctiemethode',
    Description: '',
    DimensionGroupId: null,
  });
  const obsPages = next.observationPages as { value: Record<string, unknown>[] }[];
  const template = obsPages[0].value[0];
  obsPages[0].value.push({ ...template, Id: -1, SeizoenEnWerkdagcorrectie: 'A099999' });
  return next;
}

async function tableStatus(db: Awaited<ReturnType<typeof createTestDb>>['db']): Promise<string> {
  const row = (await db.query('select status from cbs_tables where id = $1', [TABLE_ID])).rows[0];
  return String((row as { status?: unknown } | undefined)?.status ?? '');
}

describe('#192 parseArgs — the same flag vocabulary as ingest cli', () => {
  it('reads both flags regardless of position, and keeps the positionals', () => {
    expect(parseArgs(['85224NED', '/tmp/cap', '--accept-new-codes', '--rebaseline'])).toEqual({
      tableId: '85224NED',
      dir: '/tmp/cap',
      acceptNewCodes: true,
      rebaseline: true,
    });
    // Flags interleaved before the positionals must still work — an operator
    // typing at 8am on a release morning should not have to remember an order.
    expect(parseArgs(['--rebaseline', '85224NED', '--accept-new-codes', '/tmp/cap'])).toEqual({
      tableId: '85224NED',
      dir: '/tmp/cap',
      acceptNewCodes: true,
      rebaseline: true,
    });
  });

  it('defaults BOTH flags off — they are reviewed actions, never implicit', () => {
    expect(parseArgs(['85224NED', '/tmp/cap'])).toEqual({
      tableId: '85224NED',
      dir: '/tmp/cap',
      acceptNewCodes: false,
      rebaseline: false,
    });
  });

  it('returns null when a positional is missing, so the entry point can usage-exit', () => {
    expect(parseArgs([])).toBeNull();
    expect(parseArgs(['85224NED'])).toBeNull();
    expect(parseArgs(['--accept-new-codes'])).toBeNull();
  });
});

describe('#192 runSyncFromCapture — a release-day new code', () => {
  it('bare run still quarantines (the trap, unchanged and deliberate)', async () => {
    const { db, close } = await createTestDb();
    try {
      const clean = await loadFixtureDocs(`${FIXTURES_DIR}/${TABLE_ID}`);
      const cleanSource = new FixtureSource(clean);
      await registerTables(db, cleanSource, [registryEntry(TABLE_ID)]);
      expect((await syncTable(db, cleanSource, TABLE_ID)).outcome).toBe('succeeded');

      const releaseSource = new FixtureSource(withNewDimensionCode(clean));
      const code = await runSyncFromCapture(db, releaseSource, {
        tableId: TABLE_ID,
        dir: 'unused',
        acceptNewCodes: false,
        rebaseline: false,
      });

      // This is #192 reproduced through the script's own entry point: the
      // operator followed the documented hatch and took the table OUT of
      // service. Quarantine itself is correct — the point is that before the
      // fix there was no way to get past it from here.
      expect(code).toBe(2);
      expect(await tableStatus(db)).toBe('needs_review');
    } finally {
      await close();
    }
  });

  it('WITH the flags it completes — the capability #192 said was unreachable', async () => {
    const { db, close } = await createTestDb();
    try {
      const clean = await loadFixtureDocs(`${FIXTURES_DIR}/${TABLE_ID}`);
      const cleanSource = new FixtureSource(clean);
      await registerTables(db, cleanSource, [registryEntry(TABLE_ID)]);
      expect((await syncTable(db, cleanSource, TABLE_ID)).outcome).toBe('succeeded');

      const releaseSource = new FixtureSource(withNewDimensionCode(clean));
      // Quarantine first, exactly as a real bare release-day run does, so this
      // asserts the RECOVERY path an operator actually faces.
      await runSyncFromCapture(db, releaseSource, {
        tableId: TABLE_ID,
        dir: 'unused',
        acceptNewCodes: false,
        rebaseline: false,
      });
      expect(await tableStatus(db)).toBe('needs_review');

      const code = await runSyncFromCapture(db, releaseSource, {
        tableId: TABLE_ID,
        dir: 'unused',
        acceptNewCodes: true,
        rebaseline: true,
      });

      expect(code).toBe(0);
      expect(await tableStatus(db)).toBe('active');

      // The new code was LABELLED from the CBS code list, never invented.
      const label = (
        await db.query(
          `select label from dimension_labels
           where table_id = $1 and dimension = 'SeizoenEnWerkdagcorrectie' and code = 'A099999'`,
          [TABLE_ID],
        )
      ).rows[0];
      expect((label as { label?: unknown } | undefined)?.label).toBe('Nieuwe correctiemethode');
    } finally {
      await close();
    }
  });
});
