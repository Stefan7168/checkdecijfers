// WP30b (ADR 030 D6 as amended by A5/A6): the adapter CONFORMANCE HARNESS —
// the executable done-definition for adding a data source. A source may exist
// only when this harness passes on its recorded fixtures: the five ingestion
// validators (registration semantics) plus the contract families F0–F4 below,
// driven by a per-source fixture manifest committed next to its fixtures
// (tests/fixtures/<key>/conformance.json).
//
// Pure and hermetic: no vitest, no DB, no network — the adapter under test is
// a fixture-replay implementation of the SourceAdapter contract (for CBS:
// FixtureSource, which replays captured wire responses through the REAL
// parse-v4 code). Failure summaries are plain language in the validate.ts
// style, so the owner can read what a candidate source got wrong.
//
// Honesty note (review amendment B5, sharpened by the post-build review):
// family F5 runs the validators with SELF-derived expectations
// (unitsFromMeasures + the fetched schema — exactly registerTables'
// trust-on-first-use registration semantics). The fingerprint and
// unit-consistency stages are therefore self-consistent BY CONSTRUCTION here
// — both sides derive from the same fetched schema, so within the harness
// they only prove those validators RUN over the adapter's shapes without
// rejecting; their real comparative work (drift detection) happens at sync
// time against the stored registry. F5's actual bite is the other three:
// period parseability + publication/status coverage, no reason-less nulls,
// no duplicate cells, coordinate↔code-list closure.
import type { CbsCode, CbsObservationRow, CbsSlice, CbsTableSchema } from '../cbs-adapter/types.ts';
import { computeFingerprint } from '../ingestion/fingerprint.ts';
import { encodePeriodCode, parsePeriodCode } from '../ingestion/periods.ts';
import { unitsFromMeasures } from '../ingestion/pipeline.ts';
import { SEED_TABLES } from '../ingestion/registry-seed.ts';
import {
  checkDimensionMapping,
  checkPeriodParsing,
  checkRowPlausibility,
  checkSchemaFingerprint,
  checkUnitConsistency,
  type StoredLabel,
} from '../ingestion/validate.ts';
import type { SourceAdapter } from './adapters.ts';
import { CBS_SOURCE_KEY, sourceKeyForTableId, type SourceInfo } from './registry.ts';

export interface ConformanceTableSpec {
  tableId: string;
  /** Metadata-only fixture (schema + code lists, no observation pages) — the
   * WP27 capture pattern. Row-dependent checks are skipped. */
  schemaOnly?: boolean;
  /** Escape hatch for a source whose captures include out-of-slice history
   * the product would never ingest (e.g. statusless ancient periods). Applied
   * through the adapter's own fetchObservations — the same client-side
   * semantics ingestion uses. The CBS manifest needs none (measured, WP30b
   * brief ⟨B2⟩). */
  slice?: CbsSlice;
}

/** The per-source conformance manifest — tests/fixtures/<key>/conformance.json. */
export interface SourceConformanceManifest {
  sourceKey: string;
  tables: ConformanceTableSpec[];
  /** Full declared vocabulary of per-period publication statuses. */
  declaredPeriodStatuses: string[];
  /** Full declared vocabulary of observation value attributes (incl. the
   * plain-value marker, 'None' for CBS). */
  declaredValueAttributes: string[];
  /** Full declared CATALOG-lifecycle vocabulary (A6) — a different axis than
   * the per-cell statuses above. */
  declaredCatalogStatuses: string[];
  /** Full declared catalog datasetType vocabulary. */
  declaredDatasetTypes: string[];
}

export type ConformanceFamily =
  | 'F0_registry'
  | 'F1_replay'
  | 'F2_periods'
  | 'F3_statuses'
  | 'F4_catalog'
  | 'F5_validators';

export interface ConformanceFailure {
  family: ConformanceFamily;
  tableId?: string;
  summary: string;
}

export interface ConformanceReport {
  ok: boolean;
  failures: ConformanceFailure[];
}

/** The D4 id discipline, both directions: bare ids belong to cbs (a 'cbs:'
 * prefix is malformed — CBS keeps its bare legacy ids); every other source's
 * ids carry exactly its '<sourcekey>:' prefix. */
function isWellFormedTableId(tableId: string, sourceKey: string): boolean {
  if (sourceKeyForTableId(tableId) !== sourceKey) return false;
  return sourceKey === CBS_SOURCE_KEY ? !tableId.includes(':') : true;
}

/** Loud runtime validation for the JSON manifest (it is authored by hand; a
 * malformed manifest is an authoring error, not a conformance failure). */
export function validateManifestShape(raw: unknown, path: string): SourceConformanceManifest {
  const fail = (what: string): never => {
    throw new Error(`Conformance manifest at '${path}' is invalid: ${what}.`);
  };
  if (typeof raw !== 'object' || raw === null) fail('not a JSON object');
  const m = raw as Record<string, unknown>;

  // Unknown keys are authoring typos (`schemaonly`, `declaredPeriodStatusses`,
  // …) that would otherwise silently weaken the contract — reject them loudly.
  const KNOWN_ROOT = new Set([
    'sourceKey',
    'tables',
    'declaredPeriodStatuses',
    'declaredValueAttributes',
    'declaredCatalogStatuses',
    'declaredDatasetTypes',
  ]);
  for (const key of Object.keys(m)) {
    if (!KNOWN_ROOT.has(key)) fail(`unknown key '${key}'`);
  }

  if (typeof m.sourceKey !== 'string' || m.sourceKey.length === 0) fail('sourceKey must be a non-empty string');
  if (!Array.isArray(m.tables) || m.tables.length === 0) fail('tables must be a non-empty array');
  const KNOWN_TABLE = new Set(['tableId', 'schemaOnly', 'slice']);
  const KNOWN_SLICE = new Set(['dimensionEquals', 'dimensionPrefixes', 'periodFloor']);
  for (const t of m.tables as unknown[]) {
    if (typeof t !== 'object' || t === null || typeof (t as Record<string, unknown>).tableId !== 'string') {
      fail('every tables[] entry needs a string tableId');
    }
    const entry = t as Record<string, unknown>;
    for (const key of Object.keys(entry)) {
      if (!KNOWN_TABLE.has(key)) fail(`unknown key '${key}' on table '${entry.tableId as string}'`);
    }
    if (entry.schemaOnly !== undefined && typeof entry.schemaOnly !== 'boolean') {
      fail(`schemaOnly on table '${entry.tableId as string}' must be a boolean`);
    }
    if (entry.slice !== undefined) {
      const slice = entry.slice;
      if (typeof slice !== 'object' || slice === null) fail(`slice on table '${entry.tableId as string}' must be an object`);
      const s = slice as Record<string, unknown>;
      for (const key of Object.keys(s)) {
        if (!KNOWN_SLICE.has(key)) fail(`unknown slice key '${key}' on table '${entry.tableId as string}'`);
      }
      if (s.periodFloor !== undefined && typeof s.periodFloor !== 'string') {
        fail(`slice.periodFloor on table '${entry.tableId as string}' must be a string`);
      }
      if (
        s.dimensionEquals !== undefined &&
        (typeof s.dimensionEquals !== 'object' ||
          s.dimensionEquals === null ||
          Object.values(s.dimensionEquals).some((v) => typeof v !== 'string'))
      ) {
        fail(`slice.dimensionEquals on table '${entry.tableId as string}' must map dimension names to strings`);
      }
      if (
        s.dimensionPrefixes !== undefined &&
        (typeof s.dimensionPrefixes !== 'object' ||
          s.dimensionPrefixes === null ||
          Object.values(s.dimensionPrefixes).some(
            (v) => !Array.isArray(v) || v.some((p) => typeof p !== 'string'),
          ))
      ) {
        fail(`slice.dimensionPrefixes on table '${entry.tableId as string}' must map dimension names to string arrays`);
      }
    }
  }
  for (const key of [
    'declaredPeriodStatuses',
    'declaredValueAttributes',
    'declaredCatalogStatuses',
    'declaredDatasetTypes',
  ] as const) {
    const v = m[key];
    if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) {
      fail(`${key} must be an array of strings`);
    }
  }
  return m as unknown as SourceConformanceManifest;
}

/**
 * Runs the full conformance harness for one source. Never throws for a
 * failing SOURCE — every defect becomes a plain-language failure; it throws
 * only on harness-usage errors (already-validated manifests don't).
 */
export async function runSourceConformance(
  adapter: SourceAdapter,
  manifest: SourceConformanceManifest,
  info: SourceInfo,
): Promise<ConformanceReport> {
  const failures: ConformanceFailure[] = [];
  const add = (family: ConformanceFamily, summary: string, tableId?: string) => {
    failures.push(tableId !== undefined ? { family, tableId, summary } : { family, summary });
  };

  checkRegistryEntry(info, manifest, add);

  // --- Catalog (fetched once): F1 presence + D4 ids, F4 vocabulary ---------
  try {
    const entries = await adapter.fetchCatalog();
    if (entries.length === 0) {
      add('F1_replay', 'fetchCatalog returned zero entries — a source needs a catalog for table discovery.');
    }
    const catalogStatuses = new Set(manifest.declaredCatalogStatuses);
    const datasetTypes = new Set(manifest.declaredDatasetTypes);
    const badIds: string[] = [];
    const undeclaredStatuses = new Set<string>();
    const undeclaredTypes = new Set<string>();
    for (const e of entries) {
      if (!isWellFormedTableId(e.tableId, manifest.sourceKey)) badIds.push(e.tableId);
      if (e.status !== null && !catalogStatuses.has(e.status)) undeclaredStatuses.add(e.status);
      if (e.datasetType !== null && !datasetTypes.has(e.datasetType)) undeclaredTypes.add(e.datasetType);
    }
    if (badIds.length > 0) {
      add(
        'F1_replay',
        `${badIds.length} catalog entry id(s) do not carry source '${manifest.sourceKey}' per the ` +
          `'<sourcekey>:<native-id>' convention (ADR 030 D4; CBS ids must be bare): ` +
          `${badIds.slice(0, 5).join(', ')}. Adapters speak prefixed ids natively — the pipeline never adds or strips prefixes.`,
      );
    }
    if (undeclaredStatuses.size > 0) {
      add(
        'F4_catalog',
        `Catalog status(es) not in declaredCatalogStatuses: ${[...undeclaredStatuses].slice(0, 10).join(', ')}. ` +
          `Declare the source's full catalog-lifecycle vocabulary (A6) — the finder's current-first ` +
          `shortlist depends on knowing every value.`,
      );
    }
    if (undeclaredTypes.size > 0) {
      add(
        'F4_catalog',
        `Catalog datasetType(s) not in declaredDatasetTypes: ${[...undeclaredTypes].slice(0, 10).join(', ')}.`,
      );
    }
  } catch (err) {
    add('F1_replay', `fetchCatalog threw: ${(err as Error).message}`);
  }

  // --- Per-table families ---------------------------------------------------
  for (const spec of manifest.tables) {
    try {
      await checkTable(adapter, spec, manifest, info, add);
    } catch (err) {
      add('F1_replay', `adapter threw while replaying the table: ${(err as Error).message}`, spec.tableId);
    }
  }

  return { ok: failures.length === 0, failures };
}

// ---------------------------------------------------------------------------
// F0 — registry-entry coherence ("attribution fields present", widened)
// ---------------------------------------------------------------------------

function checkRegistryEntry(
  info: SourceInfo,
  manifest: SourceConformanceManifest,
  add: (family: ConformanceFamily, summary: string, tableId?: string) => void,
): void {
  const f0 = (summary: string) => add('F0_registry', summary);

  if (info.key !== manifest.sourceKey) {
    f0(`registry entry key '${info.key}' does not match the manifest's sourceKey '${manifest.sourceKey}'.`);
  }
  if (info.displayName.trim().length === 0) f0('displayName is empty.');
  if (info.attributionLabel.trim().length === 0) f0('attributionLabel is empty — the R4 attribution line needs it.');
  if (!info.license) f0('license is missing.');

  const periodStatuses = new Set(manifest.declaredPeriodStatuses);
  const undeclaredProvisional = Object.keys(info.provisionalDisplay).filter((s) => !periodStatuses.has(s));
  if (undeclaredProvisional.length > 0) {
    f0(`provisionalDisplay key(s) not in declaredPeriodStatuses: ${undeclaredProvisional.join(', ')}.`);
  }
  if (info.definitiveStatuses.length === 0) {
    f0('definitiveStatuses is empty — every cell would render as provisional; declare which verbatim statuses are definitive.');
  }
  const undeclaredDefinitive = info.definitiveStatuses.filter((s) => !periodStatuses.has(s));
  if (undeclaredDefinitive.length > 0) {
    f0(`definitiveStatuses value(s) not in declaredPeriodStatuses: ${undeclaredDefinitive.join(', ')}.`);
  }
  const overlap = info.definitiveStatuses.filter((s) => s in info.provisionalDisplay);
  if (overlap.length > 0) {
    f0(
      `status(es) declared BOTH definitive and provisional-displayed: ${overlap.join(', ')} — ` +
        `a cell cannot be definitive and carry a provisional suffix (R11).`,
    );
  }

  const valueAttributes = new Set(manifest.declaredValueAttributes);
  const undeclaredReasons = Object.keys(info.nullReasonLabels).filter((a) => !valueAttributes.has(a));
  if (undeclaredReasons.length > 0) {
    f0(`nullReasonLabels key(s) not in declaredValueAttributes: ${undeclaredReasons.join(', ')}.`);
  }

  const catalogStatuses = new Set(manifest.declaredCatalogStatuses);
  if (info.currentCatalogStatuses.length === 0) {
    f0('currentCatalogStatuses is empty — the finder could never rank any of this source\'s tables as current (A6).');
  }
  const undeclaredCurrent = info.currentCatalogStatuses.filter((s) => !catalogStatuses.has(s));
  if (undeclaredCurrent.length > 0) {
    f0(`currentCatalogStatuses value(s) not in declaredCatalogStatuses: ${undeclaredCurrent.join(', ')}.`);
  }

  if (info.deepLink !== null && manifest.tables.length > 0) {
    const sampleId = manifest.tables[0]!.tableId;
    const url = info.deepLink(sampleId);
    if (!url.startsWith('https://')) {
      f0(`deepLink('${sampleId}') is not an absolute https URL: '${url}'.`);
    } else if (!url.includes(sampleId)) {
      f0(`deepLink('${sampleId}') does not embed the table id verbatim: '${url}'.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-table: F1 replay + D4 ids, F2 periods, F3 statuses, F5 validators
// ---------------------------------------------------------------------------

async function checkTable(
  adapter: SourceAdapter,
  spec: ConformanceTableSpec,
  manifest: SourceConformanceManifest,
  info: SourceInfo,
  add: (family: ConformanceFamily, summary: string, tableId?: string) => void,
): Promise<void> {
  const id = spec.tableId;

  // F1: D4 id discipline, both directions — bare ⇒ cbs (and cbs ⇒ bare, no
  // ':' ever), '<key>:' prefix ⇒ exactly that key.
  if (!isWellFormedTableId(id, manifest.sourceKey)) {
    add(
      'F1_replay',
      `table id '${id}' does not follow the D4 id rule for source '${manifest.sourceKey}' ` +
        `('<sourcekey>:<native-id>' for non-CBS sources; CBS ids stay bare, never containing ':'). ` +
        `Adapters speak prefixed ids natively — the pipeline never adds or strips prefixes.`,
      id,
    );
  }

  // F1: schema through the real parse code.
  const schema: CbsTableSchema = await adapter.fetchTableSchema(id);
  if (schema.title.trim().length === 0) add('F1_replay', 'fetchTableSchema returned an empty title.', id);
  if (schema.measures.length === 0) add('F1_replay', 'fetchTableSchema returned zero measures.', id);
  const timeDims = schema.dimensions.filter((d) => d.kind === 'TimeDimension');
  if (timeDims.length !== 1) {
    add(
      'F1_replay',
      `the schema has ${timeDims.length} TimeDimension(s) (${timeDims.map((d) => d.name).join(', ') || 'none'}) — ` +
        `exactly one is required: the whole period machinery (and the fit gate's deliverability ` +
        `pre-checks, ADR 030 A7) keys on it.`,
      id,
    );
    return; // period/validator families need the one time dimension
  }
  const timeDim = timeDims[0]!;

  // F1: code lists per dimension.
  const codeLists: Record<string, CbsCode[]> = {};
  for (const dim of schema.dimensions) {
    const codes = await adapter.fetchCodeList(id, dim.name);
    if (codes.length === 0) add('F1_replay', `fetchCodeList('${dim.name}') returned zero codes.`, id);
    codeLists[dim.name] = codes;
  }

  // F1: the count seam must answer without throwing (null is a valid answer).
  await adapter.fetchObservationCount(id);

  const periodCodes = codeLists[timeDim.name] ?? [];

  if (spec.schemaOnly) {
    // A schemaOnly fixture is a metadata-only SPECIMEN (the WP27 capture
    // pattern) — it may deliberately be undeliverable-shaped: the CBS corpus
    // includes 80416ned, whose TimeDimension carries 7,492 DAILY codes
    // (20060101, …) — ADR 030 D2's daily-grain revisit case, kept as a
    // fit-gate negative specimen. Such a table can never be SERVED (the
    // ingestion pipeline's own period gate refuses it at sync time), so F2's
    // grammar contract does not apply; only the row-free registration-shape
    // gates run.
    //
    // The flag is VERIFIED, not trusted (post-build review): a table whose
    // adapter actually yields observation rows may not dodge the row-level
    // families by declaring itself schemaOnly.
    let observed = 0;
    for await (const page of adapter.fetchObservations(id, spec.slice)) observed += page.length;
    if (observed > 0) {
      add(
        'F1_replay',
        `the manifest declares this table schemaOnly, but the adapter returned ${observed} observation ` +
          `row(s) — either the manifest is wrong or the fixture is not a true metadata-only capture. ` +
          `Row-level checks may not be skipped for a table that carries data.`,
        id,
      );
      return;
    }
    runRowFreeValidators(schema, add, id);
    return;
  }

  // F2 over the period CODE LIST (servable tables): grammar round-trip +
  // declared statuses.
  const declaredPeriodStatuses = new Set(manifest.declaredPeriodStatuses);
  const badGrammar: string[] = [];
  const undeclaredStatuses = new Set<string>();
  for (const code of periodCodes) {
    const parsed = parsePeriodCode(code.code);
    if (parsed === null || encodePeriodCode(parsed) !== code.code) badGrammar.push(code.code);
    if (code.status !== null && !declaredPeriodStatuses.has(code.status)) undeclaredStatuses.add(code.status);
  }
  if (badGrammar.length > 0) {
    add(
      'F2_periods',
      `${badGrammar.length} period code(s) do not survive the canonical-grammar round-trip ` +
        `(YYYY + JJ|KW|MM + index; parse→encode must be the identity): ${badGrammar.slice(0, 10).join(', ')}. ` +
        `The adapter must MAP native periods into the internal grammar (ADR 030 D2).`,
      id,
    );
  }
  if (undeclaredStatuses.size > 0) {
    add(
      'F2_periods',
      `period status(es) not in declaredPeriodStatuses: ${[...undeclaredStatuses].slice(0, 10).join(', ')}.`,
      id,
    );
  }

  // F1: observations replay (through the real parse code), manifest slice applied.
  const rows: CbsObservationRow[] = [];
  for await (const page of adapter.fetchObservations(id, spec.slice)) {
    rows.push(...page);
  }
  if (rows.length === 0) {
    add(
      'F1_replay',
      'fetchObservations yielded zero rows (and the table is not marked schemaOnly in the manifest).',
      id,
    );
    return;
  }

  // F2 over observed period coordinates.
  const badObserved = new Set<string>();
  for (const row of rows) {
    const code = row.coordinates[timeDim.name];
    if (code === undefined) continue; // checkDimensionMapping reports coordinate gaps
    const parsed = parsePeriodCode(code);
    if (parsed === null || encodePeriodCode(parsed) !== code) badObserved.add(code);
  }
  if (badObserved.size > 0) {
    add(
      'F2_periods',
      `${badObserved.size} observed period coordinate(s) fail the canonical-grammar round-trip: ` +
        `${[...badObserved].slice(0, 10).join(', ')}.`,
      id,
    );
  }

  // F3: value-attribute completeness (R11 — a refusal must be able to state
  // the TRUE reason for every null cell).
  const declaredAttributes = new Set(manifest.declaredValueAttributes);
  const undeclaredAttrs = new Set<string>();
  const unlabeledNullAttrs = new Set<string>();
  for (const row of rows) {
    if (!declaredAttributes.has(row.valueAttribute)) undeclaredAttrs.add(row.valueAttribute);
    if (row.value === null && !(row.valueAttribute in info.nullReasonLabels)) {
      unlabeledNullAttrs.add(row.valueAttribute);
    }
  }
  if (undeclaredAttrs.size > 0) {
    add(
      'F3_statuses',
      `value attribute(s) not in declaredValueAttributes: ${[...undeclaredAttrs].slice(0, 10).join(', ')}.`,
      id,
    );
  }
  if (unlabeledNullAttrs.size > 0) {
    add(
      'F3_statuses',
      `null cells carry value attribute(s) without an owner-approved nullReasonLabels entry: ` +
        `${[...unlabeledNullAttrs].slice(0, 10).join(', ')} — a refusal could not state the true reason (R11).`,
      id,
    );
  }

  // F5: the five ingestion validators, registration semantics (see the
  // honesty note in the module header). #167: exactly like the pipeline, a
  // seed's curated phantom-measure exclusion is applied before the
  // per-measure checks (units, plausibility, unit consistency) — while the
  // schema FINGERPRINT stays unfiltered, same reasoning as syncTable: a CBS
  // change to the phantom set must still fail loudly.
  const excludedMeasures = new Set(SEED_TABLES.find((t) => t.id === id)?.excludeMeasures ?? []);
  const servedMeasures =
    excludedMeasures.size === 0 ? schema.measures : schema.measures.filter((m) => !excludedMeasures.has(m.code));
  const registryUnits = unitsFromMeasures(servedMeasures);
  const expectedDimensions = [...schema.dimensions]
    .map((d) => ({ name: d.name, kind: d.kind as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const fingerprint = computeFingerprint(schema.dimensions, schema.measures.map((m) => m.code));
  const storedLabels: StoredLabel[] = [];
  for (const [dimension, codes] of Object.entries(codeLists)) {
    for (const code of codes) storedLabels.push({ dimension, code: code.code });
  }

  const stages = [
    checkSchemaFingerprint(schema.dimensions, schema.measures.map((m) => m.code), expectedDimensions, fingerprint),
    checkRowPlausibility(rows, registryUnits, null, 0.2),
    checkPeriodParsing(rows, timeDim.name, periodCodes),
    checkDimensionMapping(rows, schema.dimensions, registryUnits, storedLabels, codeLists, false),
    checkUnitConsistency(servedMeasures, registryUnits),
  ];
  for (const result of stages) {
    if (!result.ok) add('F5_validators', `${result.stage}: ${result.summary}`, id);
  }
}

function runRowFreeValidators(
  schema: CbsTableSchema,
  add: (family: ConformanceFamily, summary: string, tableId?: string) => void,
  id: string,
): void {
  const registryUnits = unitsFromMeasures(schema.measures);
  const expectedDimensions = [...schema.dimensions]
    .map((d) => ({ name: d.name, kind: d.kind as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const fingerprint = computeFingerprint(schema.dimensions, schema.measures.map((m) => m.code));
  const stages = [
    checkSchemaFingerprint(schema.dimensions, schema.measures.map((m) => m.code), expectedDimensions, fingerprint),
    checkUnitConsistency(schema.measures, registryUnits),
  ];
  for (const result of stages) {
    if (!result.ok) add('F5_validators', `${result.stage}: ${result.summary}`, id);
  }
}
