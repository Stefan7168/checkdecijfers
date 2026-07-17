// The Phase 0 table set — configuration mirror of docs/07-phase0-table-set.md
// (the validated set; that doc is the authority, this file must follow it).
// IDs are exact as-published, casing preserved (catalog quirk #1).
//
// Dimension structure (expected_dimensions, units) is NOT pinned here: the
// register step measures it from the live catalog (trust on first use) and the
// schema-fingerprint check defends every sync after that. Registration content
// beyond ingestion's needs (aliases, canonical defaults, period semantics) is
// the registry work package, not this file.
import type { CbsSlice } from '../cbs-adapter/types.ts';

export interface Phase0Table {
  id: string;
  /** Registered slice per docs/07 — absent means the full table is ingested. */
  slice?: CbsSlice;
  /** Expected update cadence (staleness metadata, human-readable for now). */
  updateCadence: string;
  /** Benchmark tasks this table serves (docs/02-user-scenarios.md). */
  servesTasks: string[];
  /** Curated PHANTOM-measure exclusion (#167, session 50): measure codes that
   * CBS's MeasureCodes metadata lists but that carry ZERO observations
   * table-wide (measured, documented per code below). Registration and sync
   * treat them as not-published (skipped in units, unit-consistency and the
   * per-measure row-plausibility check; any fetched row for them is dropped);
   * the schema FINGERPRINT deliberately stays unfiltered, so a CBS change to
   * the phantom set still fails the drift check loudly. Without this, a fully
   * healthy full-table ingest quarantines on measures that never had data. */
  excludeMeasures?: string[];
}

export const PHASE0_TABLES: Phase0Table[] = [
  {
    // Population — >100M obs unsliced; totals only, NL/province/gemeente, 2019+
    id: '03759ned',
    slice: {
      dimensionEquals: {
        Geslacht: 'T001038',
        Leeftijd: '10000',
        BurgerlijkeStaat: 'T001019',
      },
      dimensionPrefixes: { RegioS: ['NL', 'PV', 'GM'] },
      periodFloor: '2019JJ00',
    },
    updateCadence: 'yearly (next CBS update Q2 2027)',
    servesTasks: ['B1', 'B2', 'B10', 'B13', 'B14'],
  },
  {
    // Consumer prices (CPI 2025=100) — successor to 83131NED
    id: '86141NED',
    updateCadence: 'monthly',
    servesTasks: ['B3', 'B4', 'B20'],
  },
  {
    // Unemployment, seasonally adjusted + unadjusted variants in one dimension
    id: '85224NED',
    updateCadence: 'quarterly',
    servesTasks: ['B5'],
  },
  {
    // Housing stock 1921–2025, national only, tiny
    id: '82235NED',
    updateCadence: 'yearly',
    servesTasks: ['B6'],
  },
  {
    // House prices (v4-only)
    id: '85773NED',
    updateCadence: 'monthly (~22 days after each month)',
    servesTasks: ['B7', 'B8', 'B16'],
  },
  {
    // Bankruptcies — monthly/quarterly/yearly grains since 1981
    id: '82242NED',
    updateCadence: 'monthly',
    servesTasks: ['B9'],
  },
  {
    // Household income — totals slice, all income concepts kept
    id: '83932NED',
    slice: {
      dimensionEquals: {
        Inkomensklassen: 'T001226',
        KenmerkenVanHuishoudens: '1050010',
      },
    },
    updateCadence: 'yearly',
    servesTasks: ['B12'],
  },
  {
    // Solar electricity (v4-only) — 2024 is NaderVoorlopig (R11 applies to B11)
    id: '82610NED',
    updateCadence: 'yearly',
    servesTasks: ['B11'],
  },
];

// Coverage-sprint table set — configuration mirror of docs/11-coverage-table-set.md
// (owner strategy #163(3), sprint brief docs/session-briefs/2026-07-17-coverage-sprint-brief.md).
// Same seed shape and same authority rule as PHASE0_TABLES above: the doc is the
// authority, this file must follow it. servesTasks references the coverage
// verification tasks (CC*) in benchmark/coverage-key.json — the docs/05
// table-onboarding rule's 2-3 frozen-key tasks per table.
export const COVERAGE_TABLES: Phase0Table[] = [
  {
    // Consumer confidence, seasonally adjusted — tiny (483 months × 8 measures =
    // 3,864 obs, measured v3+v4 2026-07-17), monthly-only grain, no geo dimension,
    // full ingest. Do NOT conflate with the uncorrected sibling 83694NED.
    id: '83693NED',
    updateCadence: 'monthly (published ~the 22nd of the measured month itself, e.g. June figures on 22 June)',
    servesTasks: ['CC1', 'CC2', 'CC3', 'CC4'],
  },
  {
    // Producer prices (PPI) — slice: total ProdCom aggregate (A052584, measured
    // 2026-07-17) × totaal-afzet + invoer (full codes as exact-match prefixes)
    // → 654 obs, 100% dense. Mixed MM+JJ grains; last 5 months Voorlopig.
    id: '85770NED',
    slice: {
      dimensionEquals: { AlleProdComCoderingen: 'A052584' },
      dimensionPrefixes: { Afzetgebieden: ['A044074', 'A044077'] },
    },
    updateCadence: 'monthly (at latest the 30th day after the measured month)',
    servesTasks: ['CC8', 'CC9', 'CC10'],
  },
  {
    // GDP flash estimate — FULL ingest, deliberately NO slice (owner decision,
    // session 50, 2026-07-17): the lean 2-flavor SoortMutaties slice was
    // REFUTED by the hermetic validator (26 of 210 measures exist only under
    // the value/price flavors → row_plausibility quarantine, working as
    // designed — the income-side value-only concepts have no volume variant).
    // 99,676 obs table-wide (measured v4 2026-07-17, smaller than the loaded
    // CPI table); 5 mutation flavors × 210 measures × 156 periods (125 KW +
    // 31 JJ, ~10 recent periods Voorlopig incl. 2026KW01). The FIXTURE is
    // capture-sliced to 2020+ (22,230 obs — the 86141NED capture-only-slice
    // pattern; all measures/flavors covered, scripts/capture-cbs-fixtures.ts
    // has the rationale); live ingest is genuinely unsliced.
    id: '85880NED',
    updateCadence: 'quarterly (flash ~30 days after quarter-end; second estimate later revises it)',
    servesTasks: ['CC5', 'CC6', 'CC7'],
    // #167: 17 of the 210 MeasureCodes entries carry ZERO observations in the
    // ENTIRE live table (each probed individually with $orderby Perioden desc
    // $top 1 on 2026-07-17 — all "GEEN-RIJEN"). CBS metadata phantoms; without
    // exclusion the per-measure plausibility check quarantines even a full,
    // healthy ingest.
    excludeMeasures: [
      '320000', // "19 Aardolie-industrie"
      'A044496', // "Saldo aan- en verkopen van niet-geprod.."
      'A047176', // "In cultuur gebrachte activa"
      'M002584', // "Uitvoersaldo diensten"
      'M002592',
      'M006289',
      'M006343_1',
      'M006343_2',
      'M006445',
      'M006447',
      'M006479',
      'M006557_2',
      'M006557_3',
      'M006558_2',
      'M006562',
      'M006567_2',
      'M006567_3',
    ],
  },
];

// Every curated seed table (Phase 0 + coverage sprint) — what `ingest register`
// registers and the fixture-capture script accepts.
export const SEED_TABLES: Phase0Table[] = [...PHASE0_TABLES, ...COVERAGE_TABLES];
