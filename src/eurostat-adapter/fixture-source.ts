// Replay of pre-captured Eurostat JSON-stat 2.0 documents through the same
// jsonstat.ts parser the live adapter uses (ADR 003 seam, applied to source
// two) — modelled directly on src/cbs-adapter/fixture-source.ts.
//
// Task 3 (WP30c/E1 brief): every fixture this session commits is
// HAND-BUILT, not captured from the live Eurostat API (Constraint 0),
// declared via a `"synthetic": true` manifest field. loadFixtureDataset/
// loadEurostatCatalogFixture REQUIRE that field to be PRESENT (a boolean —
// true for today's hand-built fixtures, false once a real
// `npm run fixtures:capture:eurostat` run replaces one) so a manifest can
// never omit the claim either way; only its ABSENCE is treated as an
// authoring error, never its value.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  CbsCatalogEntry,
  CbsCode,
  CbsObservationRow,
  CbsSlice,
  CbsSource,
  CbsTableSchema,
} from '../cbs-adapter/types.ts';
import { parseJsonStatCatalog, parseJsonStatDataset, type ParsedEurostatDataset } from './jsonstat.ts';

interface EurostatFixtureIndex {
  synthetic: boolean;
  /** Filename of the raw JSON-stat 2.0 document, relative to the table dir. */
  dataset: string;
  note?: string;
}

function loadFixtureDataset(dir: string): unknown {
  const indexPath = join(dir, 'index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as EurostatFixtureIndex;
  if (typeof index.synthetic !== 'boolean') {
    throw new Error(
      `Eurostat fixture manifest at '${indexPath}' must declare a boolean 'synthetic' field (Task 3, ` +
        `WP30c/E1 brief) — true for a hand-built specimen, false once a real ` +
        `'npm run fixtures:capture:eurostat' run replaces it; never omitted either way.`,
    );
  }
  if (typeof index.dataset !== 'string' || index.dataset.length === 0) {
    throw new Error(`Eurostat fixture manifest at '${indexPath}' is missing a string 'dataset' filename`);
  }
  return JSON.parse(readFileSync(join(dir, index.dataset), 'utf8'));
}

/**
 * Discovers every table directory under `dir` (one level, each holding an
 * `index.json`) and loads its raw JSON-stat document, keyed by DIRECTORY
 * NAME — the bare native Eurostat code, mirroring CBS's own bare-directory
 * convention (D4: table ids carry the 'eurostat:' prefix; fixture
 * directories stay bare — EurostatFixtureSource re-adds the prefix
 * internally at lookup time, same as the live adapter does for its URL).
 */
export function loadEurostatFixtureTree(dir: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    result[entry.name] = loadFixtureDataset(join(dir, entry.name));
  }
  return result;
}

interface EurostatCatalogFixture {
  synthetic: boolean;
  /** The raw tab-separated Catalogue "table of contents" TEXT, verbatim —
   * NOT JSON (session 107 correction: the real endpoint returns text, the
   * original `link.item[]` JSON shape here was Constraint 0's own disclosed,
   * unverified guess and was wrong). */
  raw: string;
}

/** Global (non-per-table) catalog fixture, `_catalog.json` under `dir` —
 * mirrors cbs-adapter/fixture-source.ts's loadCatalogFixture. Returns null
 * when absent, so a source built without one simply has no catalog
 * (fetchCatalog then throws, matching the CBS-side contract). */
export function loadEurostatCatalogFixture(dir: string): EurostatCatalogFixture | null {
  const path = join(dir, '_catalog.json');
  if (!existsSync(path)) return null;
  const doc = JSON.parse(readFileSync(path, 'utf8')) as Partial<EurostatCatalogFixture>;
  if (typeof doc.synthetic !== 'boolean') {
    throw new Error(
      `Eurostat catalog fixture at '${path}' must declare a boolean 'synthetic' field (Task 3, WP30c/E1 brief).`,
    );
  }
  if (typeof doc.raw !== 'string' || doc.raw.length === 0) {
    throw new Error(`Eurostat catalog fixture at '${path}' must declare a string 'raw' field (the TSV body).`);
  }
  return doc as EurostatCatalogFixture;
}

/** D4: strips the '<key>:' prefix internally — same local first-colon rule
 * every module in this adapter family implements independently (see
 * jsonstat.ts's and statistics-api.ts's own copies; the how-to-add-a-source
 * guide's Step 2 rules out a cross-module import for this). */
function nativeIdFrom(tableId: string): string {
  const colon = tableId.indexOf(':');
  return colon >= 0 ? tableId.slice(colon + 1) : tableId;
}

/**
 * CbsSource replaying pre-captured (here: hand-built synthetic, per Task 3)
 * JSON-stat documents through the REAL jsonstat.ts parser. Accepts a
 * Record<nativeCode, rawJsonStatDocument> — the multi-table case
 * loadEurostatFixtureTree produces — so one instance can back the whole
 * conformance manifest, exactly like CBS's own FixtureSource.
 */
export class EurostatFixtureSource implements CbsSource {
  private readonly tables: Record<string, unknown>;
  private readonly catalogFixture: EurostatCatalogFixture | null;
  /** Caches only the UNSLICED parse (`this.parsed(tableId)`, no second arg) —
   * a call with a slice (schema, code list, OR observations; E2a step-5 fix,
   * 2026-09-23: schema/codeLists genuinely DO depend on the slice now, same
   * as the live adapter — D6's measures are one per `unit` code actually
   * PRESENT after slicing) always re-parses via `parsed(tableId, slice)`
   * rather than filtering an already-cached row list a second time; cheap
   * for a fixture-sized document, unlike the live adapter's own per-
   * (tableId, slice) `loadDataset` cache, which exists to avoid a second
   * real HTTP call. */
  private readonly cache = new Map<string, ParsedEurostatDataset>();

  constructor(tables: Record<string, unknown>, catalogFixture?: EurostatCatalogFixture | null) {
    this.tables = tables;
    this.catalogFixture = catalogFixture ?? null;
  }

  private rawFor(tableId: string): unknown {
    const nativeCode = nativeIdFrom(tableId);
    const raw = this.tables[nativeCode];
    if (raw === undefined) {
      throw new Error(
        `EurostatFixtureSource has no fixture registered for table '${tableId}' (known: ` +
          `${Object.keys(this.tables).join(', ') || '<none>'})`,
      );
    }
    return raw;
  }

  private parsed(tableId: string, slice?: CbsSlice): ParsedEurostatDataset {
    if (!slice) {
      let cached = this.cache.get(tableId);
      if (!cached) {
        cached = parseJsonStatDataset(this.rawFor(tableId), tableId);
        this.cache.set(tableId, cached);
      }
      return cached;
    }
    return parseJsonStatDataset(this.rawFor(tableId), tableId, slice);
  }

  // E2a step-5 fix (2026-09-23): `slice`, mirroring StatisticsApiSource's own
  // fix — a captured fixture never hits the sync-cell cap, but the schema's
  // measure set (D6: one measure per `unit` code ACTUALLY PRESENT after
  // slicing) and the code lists should still reflect the registered slice,
  // not the whole unfiltered fixture, so a slice-registering caller
  // (registerTables) sees the same shape a live sliced fetch would produce.
  async fetchTableSchema(tableId: string, slice?: CbsSlice): Promise<CbsTableSchema> {
    return this.parsed(tableId, slice).schema;
  }

  async fetchCodeList(tableId: string, dimension: string, slice?: CbsSlice): Promise<CbsCode[]> {
    const codeLists = this.parsed(tableId, slice).codeLists;
    const codes = codeLists[dimension];
    if (!codes) {
      throw new Error(
        `EurostatFixtureSource has no captured code list for table '${tableId}' dimension '${dimension}' ` +
          `(known: ${Object.keys(codeLists).join(', ') || '<none>'})`,
      );
    }
    return codes;
  }

  // NB no `dimensionNames` third parameter — see statistics-api.ts's own
  // note (a JSON-stat document carries its own dimension names inline).
  async *fetchObservations(tableId: string, slice?: CbsSlice): AsyncIterable<CbsObservationRow[]> {
    yield this.parsed(tableId, slice).rows;
  }

  async fetchObservationCount(tableId: string): Promise<number | null> {
    return this.parsed(tableId).rows.length;
  }

  async fetchCatalog(): Promise<CbsCatalogEntry[]> {
    if (this.catalogFixture === null) {
      throw new Error(
        'EurostatFixtureSource has no captured catalog fixture (pass loadEurostatCatalogFixture(dir) as the second constructor arg)',
      );
    }
    return parseJsonStatCatalog(this.catalogFixture.raw);
  }
}
