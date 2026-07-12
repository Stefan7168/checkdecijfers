// Onboarding vocabulary registration (WP16 sub-part 2, ADR 026, design §3.6):
// derives canonical_measures rows from an ingested table's measure metadata so
// the delivery re-run can resolve a question against it. Hermetic: registers +
// syncs a fixture table, then registers vocab and checks the rows.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import type { Phase0Table } from '../../src/ingestion/registry-seed.ts';
import {
  cleanCbsDefinition,
  loadOnboardedVocabulary,
  onboardedKey,
  registerOnboardingVocabulary,
} from '../../src/ingestion/onboarding-vocab.ts';
import { REDACTED_QUESTION_TEXT } from '../../src/answer/audit/retention.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const FIXTURES = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));
const TABLE = '82235NED'; // Perioden-only, national — dims = {} shape.

async function ingest(db: Db): Promise<void> {
  const source = new FixtureSource(loadFixtureDocs(`${FIXTURES}/${TABLE}`));
  const seed: Phase0Table = { id: TABLE, updateCadence: 'on-demand', servesTasks: [] };
  await registerTables(db, source, [seed]);
  const result = await syncTable(db, source, TABLE);
  if (result.outcome !== 'succeeded') throw new Error(`sync failed: ${result.failureSummary}`);
}

async function withIngested(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await ingest(db);
    await fn(db);
  } finally {
    await close();
  }
}

describe('registerOnboardingVocabulary', () => {
  it('registers a canonical_measures row per empty-coordinate measure, keyed + labelled from CBS metadata', async () => {
    await withIngested(async (db) => {
      const result = await registerOnboardingVocabulary(db, {
        tableId: TABLE,
        topicTerm: 'woningvoorraad',
      });
      expect(result.onboarded.length).toBeGreaterThan(0);

      // Every onboarded measure has a namespaced key, the CBS title as its
      // definition label (R10 spirit), and the topic term in its everyday terms.
      for (const m of result.onboarded) {
        expect(m.measure.key).toMatch(new RegExp(`^onboarded:${TABLE}:`));
        expect(m.measure.definitionLabel.length).toBeGreaterThan(0);
        expect(m.measure.everydayTerms).toContain('woningvoorraad');
        expect(m.grains.length).toBeGreaterThan(0);
      }

      // The rows are actually in canonical_measures (resolve.ts reads them).
      const key = onboardedKey(TABLE, 'D002936');
      const row = await db.query('select key, table_id, measure, definition_label, definition_text from canonical_measures where key = $1', [key]);
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]!.table_id).toBe(TABLE);
      expect(row.rows[0]!.measure).toBe('D002936');
      // #115 lever b: the REAL CBS definition (from the measure's Description) is
      // stored in definition_text — CBS's own words, verbatim — so the onboarded
      // answer can show a genuine "Definitie:" line, not just the title.
      expect(row.rows[0]!.definition_text).toContain('Aantal aan het begin van de periode.');
    });
  });

  it('stores NULL definition_text when the measure has no CBS blurb (composer omits the line)', async () => {
    await withIngested(async (db) => {
      // Blank out one measure's stored Description, then re-register: a measure
      // CBS gives no usable definition for must land NULL, not an empty/echoed
      // line — the composer then omits "Definitie:" rather than repeating the
      // title (the old circular case, #115 lever a).
      await db.query(
        `update cbs_tables
            set units = jsonb_set(units, '{D002936,description}', '""'::jsonb)
          where id = $1`,
        [TABLE],
      );
      await registerOnboardingVocabulary(db, { tableId: TABLE, topicTerm: 'x' });
      const row = await db.query(
        'select definition_text from canonical_measures where key = $1',
        [onboardedKey(TABLE, 'D002936')],
      );
      expect(row.rows[0]!.definition_text).toBeNull();
    });
  });
  it('is idempotent — re-running upserts the same rows without error', async () => {
    await withIngested(async (db) => {
      const first = await registerOnboardingVocabulary(db, { tableId: TABLE, topicTerm: 'x' });
      const second = await registerOnboardingVocabulary(db, { tableId: TABLE, topicTerm: 'x' });
      expect(second.onboarded.length).toBe(first.onboarded.length);
      const count = await db.query(
        'select count(*)::int as n from canonical_measures where key like $1',
        [`onboarded:${TABLE}:%`],
      );
      // Same number of rows after the second run (upsert, not duplicate insert).
      expect(Number(count.rows[0]!.n)).toBe(first.onboarded.length);
    });
  });

  it('pins default_coordinates to an explicit {} (the answerable empty-coordinate shape)', async () => {
    await withIngested(async (db) => {
      await registerOnboardingVocabulary(db, { tableId: TABLE, topicTerm: 'x' });
      const row = await db.query('select default_coordinates from cbs_tables where id = $1', [TABLE]);
      const dc = row.rows[0]!.default_coordinates;
      const parsed = typeof dc === 'string' ? JSON.parse(dc) : dc;
      expect(parsed).toEqual({});
    });
  });
});

describe('⟨F4⟩ #120 redaction belt — a sentinel topicTerm never enters the shared vocabulary', () => {
  it('returns the empty-onboarded result WITHOUT any canonical_measures write when topicTerm is the redaction sentinel', async () => {
    await withIngested(async (db) => {
      // A pending onboarding row whose topic_term was redacted (self-service
      // deletion / 2-year purge → REDACTED_QUESTION_TEXT) and then claimed must
      // flow into the job's empty-vocab → unanswerableAndRefund path, never write
      // the sentinel into the shared canonical_measures vocabulary (where it
      // would become a parser-matchable everydayTerm).
      const result = await registerOnboardingVocabulary(db, {
        tableId: TABLE,
        topicTerm: REDACTED_QUESTION_TEXT,
      });

      expect(result.onboarded).toEqual([]);
      expect(result.skippedMeasures).toEqual([]);

      // Zero writes: no onboarded rows landed in the shared vocabulary.
      const count = await db.query(
        'select count(*)::int as n from canonical_measures where key like $1',
        [`onboarded:${TABLE}:%`],
      );
      expect(Number(count.rows[0]!.n)).toBe(0);
      // And the sentinel text is nowhere in canonical_measures at all.
      const sentinel = await db.query(
        'select count(*)::int as n from canonical_measures where $1 = any(everyday_terms)',
        [REDACTED_QUESTION_TEXT],
      );
      expect(Number(sentinel.rows[0]!.n)).toBe(0);
    });
  });
});

describe('loadOnboardedVocabulary (#112 — a live turn must know what is already onboarded)', () => {
  it('round-trips the registered vocabulary: keys, grains, regional flag and definition text', async () => {
    await withIngested(async (db) => {
      const registered = await registerOnboardingVocabulary(db, {
        tableId: TABLE,
        topicTerm: 'woningvoorraad',
      });
      const loaded = await loadOnboardedVocabulary(db);

      // Everything registered comes back — nothing more (the curated Phase-0
      // seed rows never carry the 'onboarded:' prefix, so they are excluded
      // by construction and the calibrated prompt is only extended, never
      // reshuffled).
      expect(loaded.length).toBe(registered.onboarded.length);
      for (const m of loaded) {
        expect(m.measure.key).toMatch(/^onboarded:/);
      }

      // Field-level parity with what registration handed the delivery re-run:
      // the SAME OnboardedMeasure shape, so the live-turn prompt renders the
      // measure exactly as the delivery re-run's did.
      const byKey = new Map(registered.onboarded.map((m) => [m.measure.key, m]));
      for (const m of loaded) {
        const reg = byKey.get(m.measure.key);
        expect(reg).toBeDefined();
        expect(m.grains).toEqual(reg!.grains);
        expect(m.regional).toBe(reg!.regional);
        expect(m.measure.definitionLabel).toBe(reg!.measure.definitionLabel);
        expect(m.measure.definitionText ?? null).toBe(reg!.measure.definitionText ?? null);
        expect(m.measure.everydayTerms).toEqual(reg!.measure.everydayTerms);
      }

      // Deterministic prompt bytes: ordered by key.
      const keys = loaded.map((m) => m.measure.key);
      expect(keys).toEqual([...keys].sort());
    });
  });

  it('returns [] when nothing is onboarded (prompt stays byte-identical Phase-0)', async () => {
    const { db, close } = await createTestDb();
    try {
      expect(await loadOnboardedVocabulary(db)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('skips a measure whose empty-coordinate observations have disappeared (never offer a dead end)', async () => {
    await withIngested(async (db) => {
      await registerOnboardingVocabulary(db, { tableId: TABLE, topicTerm: 'x' });
      // Simulate a narrower re-sync that dropped one measure's dims={} rows.
      await db.query(
        `delete from observations where table_id = $1 and measure = $2 and dims = '{}'::jsonb`,
        [TABLE, 'D002936'],
      );
      const loaded = await loadOnboardedVocabulary(db);
      expect(loaded.some((m) => m.measure.key === onboardedKey(TABLE, 'D002936'))).toBe(false);
      // The others still load.
      expect(loaded.length).toBeGreaterThan(0);
    });
  });
});

describe('everyday-terms union on re-onboarding (#112)', () => {
  it('a re-onboard under a NEW synonym ADDS it — the earlier learned term survives', async () => {
    await withIngested(async (db) => {
      await registerOnboardingVocabulary(db, { tableId: TABLE, topicTerm: 'woningvoorraad' });
      await registerOnboardingVocabulary(db, { tableId: TABLE, topicTerm: 'huizenbestand' });
      const row = await db.query('select everyday_terms from canonical_measures where key = $1', [
        onboardedKey(TABLE, 'D002936'),
      ]);
      const terms = row.rows[0]!.everyday_terms as string[];
      // First-occurrence order: the original term first, the new synonym
      // appended — a plain overwrite would have ERASED 'woningvoorraad',
      // regressing the already-answerable phrasing.
      expect(terms).toContain('woningvoorraad');
      expect(terms).toContain('huizenbestand');
      expect(terms.indexOf('woningvoorraad')).toBeLessThan(terms.indexOf('huizenbestand'));
      // No duplicates.
      expect(new Set(terms).size).toBe(terms.length);
    });
  });

  it('re-onboarding with the SAME term is byte-stable (idempotent terms)', async () => {
    await withIngested(async (db) => {
      await registerOnboardingVocabulary(db, { tableId: TABLE, topicTerm: 'woningvoorraad' });
      const first = await db.query('select everyday_terms from canonical_measures where key = $1', [
        onboardedKey(TABLE, 'D002936'),
      ]);
      await registerOnboardingVocabulary(db, { tableId: TABLE, topicTerm: 'woningvoorraad' });
      const second = await db.query('select everyday_terms from canonical_measures where key = $1', [
        onboardedKey(TABLE, 'D002936'),
      ]);
      expect(second.rows[0]!.everyday_terms).toEqual(first.rows[0]!.everyday_terms);
    });
  });
});

describe('cleanCbsDefinition (#115 lever b — CBS words or nothing, never invented)', () => {
  it('keeps a single definition block intact, including a scale sentence', () => {
    // The real consumentenvertrouwen case: one paragraph carrying the meaning
    // AND the −100..+100 scale — nothing is dropped from a single block.
    const desc =
      'Het consumentenvertrouwen is een indicator van het vertrouwen van consumenten. ' +
      'De indicator kan een waarde aannemen van -100 (iedereen negatief) tot +100 (iedereen positief).';
    expect(cleanCbsDefinition(desc, 'Consumentenvertrouwen')).toBe(desc);
  });

  it('keeps a LATER block that holds the real definition/scale — never stops at a preamble (#115 live-verified)', () => {
    // The real consumentenvertrouwen shape: a short preamble in block 1, the
    // actual definition + the −100..+100 scale in block 2. A "first block only"
    // cut dropped the substance the owner asked for — this must NOT happen.
    const desc =
      'Indicator van het Consumentenvertrouwen. Dit is de oorspronkelijke, niet-gecorrigeerde reeks.\r\n\r\n' +
      'De indicator kan een waarde aannemen van -100 tot +100.';
    const cleaned = cleanCbsDefinition(desc, 'Consumentenvertrouwen');
    expect(cleaned).toContain('-100 tot +100'); // the scale survives
    expect(cleaned).toBe(
      'Indicator van het Consumentenvertrouwen. Dit is de oorspronkelijke, niet-gecorrigeerde reeks. ' +
        'De indicator kan een waarde aannemen van -100 tot +100.',
    );
  });

  it('keeps appended CBS glossary blocks too (verbatim CBS text > risking the definition)', () => {
    // Faillissementen-shaped: title echo + definition, then a related-concept
    // block. The title echo is stripped; everything else CBS wrote is kept.
    const desc =
      'Uitgesproken faillissementen\r\nHet aantal eenheden dat failliet is verklaard.\r\n\r\n' +
      'Faillissement\r\nStaat waarin de rechter een eenheid failliet verklaart.';
    const cleaned = cleanCbsDefinition(desc, 'Uitgesproken faillissementen');
    expect(cleaned).toBe(
      'Het aantal eenheden dat failliet is verklaard. Faillissement Staat waarin de rechter een eenheid failliet verklaart.',
    );
  });

  it('strips a leading line that merely echoes the measure title', () => {
    const cleaned = cleanCbsDefinition('Beginstand voorraad\r\nAantal aan het begin van de periode.', 'Beginstand voorraad');
    expect(cleaned).toBe('Aantal aan het begin van de periode.');
  });

  it('strips a title-echo line even when it carries trailing punctuation (review edge case)', () => {
    // Exact equality missed "Consumentenvertrouwen." vs title "Consumentenvertrouwen";
    // the match now ignores trailing sentence punctuation.
    expect(cleanCbsDefinition('Consumentenvertrouwen.\r\nHet vertrouwen van consumenten.', 'Consumentenvertrouwen')).toBe(
      'Het vertrouwen van consumenten.',
    );
    // and a blurb that is ONLY the punctuated title -> null (no line at all).
    expect(cleanCbsDefinition('Consumentenvertrouwen.', 'Consumentenvertrouwen')).toBeNull();
  });

  it('returns null for an empty blurb or one that is only the title echo', () => {
    expect(cleanCbsDefinition('', 'Consumentenvertrouwen')).toBeNull();
    expect(cleanCbsDefinition('   ', 'Consumentenvertrouwen')).toBeNull();
    expect(cleanCbsDefinition('Consumentenvertrouwen', 'Consumentenvertrouwen')).toBeNull();
    expect(cleanCbsDefinition('consumentenvertrouwen', 'Consumentenvertrouwen')).toBeNull();
  });
});
