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
  {
    // Sprint #4 — omzet detailhandel (merged 9-in-1 handel-en-diensten table).
    // Slice: the retail headline branch (371600 = SBI 47) + its exactly 7
    // direct subgroups (SBI 473 and 478 do NOT exist in this table's dimension
    // — measured 2026-07-17, docs/11). Full codes as exact-match prefixes
    // (startswith == equality, no code extends another); all grains kept
    // (MM/KW/JJ are pipeline-native). Slice = 46,442 obs measured; the FIXTURE
    // keeps 2020+ only (12,096 obs — capture-only floor, see
    // scripts/capture-cbs-fixtures.ts).
    id: '85828NED',
    slice: {
      dimensionPrefixes: {
        BedrijfstakkenBranchesSBI2008: [
          '371600', // 47 Detailhandel (niet in auto's)
          '371700', // 471 Supermarkten en warenhuizen
          '372200', // 472 Winkels in voedingsmiddelen
          '374000', // 474 Winkels in consumentenelektronica
          '374600', // 475 Winkels in overige huishoudwaren
          '377400', // 476 Winkels in recreatieartikelen
          '378400', // 477 Winkels in overige artikelen
          '382500', // 479 Detailhandel, geen winkel of markt
        ],
      },
    },
    updateCadence: 'monthly (first working day of the second month after the measured month)',
    servesTasks: ['CC11', 'CC12', 'CC13'],
    // #167-probe result (2026-07-17): the 7 "Productie"-family measures exist
    // table-wide (industry branches) but carry ZERO rows within the retail
    // slice — same quarantine mechanism as table-wide phantoms, so the same
    // curated exclusion applies (slice-empty, not phantom: documented in
    // docs/11 and open-questions #167).
    excludeMeasures: [
      'A042501_7', // "Productie / Indexcijfers / Ongecorrigeerd"
      'A052581_5', // "Productie / Indexcijfers / Kalendergecorrigeerd"
      'A050903_5', // "Productie / Indexcijfers / Seizoengecorrigeerd"
      'A042501_8', // "Productie / Ontwikkeling t.o.v. jaar eerder / Ongecorrigeerd"
      'A052581_6', // "Productie / Ontwikkeling t.o.v. jaar eerder / Kalendergecorrigeerd"
      'A042501_9', // "Productie / Ontwikkeling t.o.v. voorgaande periode / Ongecorrigeerd"
      'A050903_6', // "Productie / Ontwikkeling t.o.v. voorgaande periode / Seizoengecorrigeerd"
    ],
  },
  {
    // Sprint #5 — consumptie huishoudens. Full ingest (34,048 obs, small);
    // M005269 (koopdaggecorrigeerd) exists for only 6 of 14 categories —
    // sparse-but-present, so NO exclusion needed (row_plausibility is
    // per-measure ≥1 row; measured 2026-07-17, docs/11). The FIXTURE keeps
    // 2020+ only (8,208 obs).
    id: '85937NED',
    updateCadence: 'monthly (~six to seven weeks after the measured month)',
    servesTasks: ['CC14', 'CC15', 'CC16', 'CC17'],
  },
  {
    // Sprint #6 — internationale goederenhandel. Totals-only slice (Landen
    // totaal × SITC totaal = 1,132 obs, measured 2026-07-17): the full table
    // is 1.88M obs. Jaarmutaties have ZERO rows for 2015 (no base year) and
    // 2021 (methodebreuk 2020/2021 — CBS deliberately publishes no YoY across
    // the break); absent rows, never null-with-attribute (docs/11). The
    // current-year JJ code is a PARTIAL-year cumulative ("2026 januari-april")
    // — period semantics in src/registry/defaults.ts says so.
    id: '85429NED',
    slice: {
      dimensionEquals: { Landen: 'T001047', SITC: 'T001082' },
    },
    updateCadence: 'monthly (~two months after the measured month)',
    servesTasks: ['CC18', 'CC19', 'CC20', 'CC21'],
  },
  {
    // Sprint #7 — huizenprijzen per regio (21 regions: NL01 + 4 landsdelen +
    // 12 provincies + Amsterdam/Den Haag/Rotterdam/Utrecht). ⚠ RegioS has
    // Kind="Dimension", NOT GeoDimension (measured 2026-07-17) — the geo path
    // does not apply; RegioS is a plain dimension with default NL01
    // (src/registry/defaults.ts). Full ingest (26,208 obs, dense 21×156×8);
    // the FIXTURE keeps 2020+ only (5,208 obs). All periods are Definitief on
    // publication ("direct definitief" — no revision cycle).
    id: '85792NED',
    updateCadence: 'quarterly (~22 days after quarter-end)',
    servesTasks: ['CC22', 'CC23', 'CC24'],
  },
  {
    // Sprint #8 — werkloosheid per maand. ⚠ LOWERCASE id: the v4 host serves
    // this table ONLY as '80590ned' (uppercase 404s — docs/07 catalog quirk
    // #1, same as 03759ned). Slice: totaal × 15-75 jaar (5,586 obs, dense
    // 399×14). Seasonally-adjusted measures carry null values with CBS reason
    // 'Impossible' on JJ periods (no seasonal adjustment exists on year basis
    // — rows present, values honestly null; measured 2026-07-17). The loaded
    // quarterly table 85224NED keeps the canonical default for
    // "werkloosheid"; this monthly table gets its own distinct terms in the
    // staged vocab batch (#165 lesson).
    id: '80590ned',
    slice: {
      dimensionEquals: { Geslacht: 'T001038', Leeftijd: '52052' },
    },
    updateCadence: 'monthly (mid-month, covering the previous month)',
    servesTasks: ['CC25', 'CC26', 'CC27', 'CC28'],
  },
  {
    // Sprint #9 — gemiddelde verkoopprijzen per gemeente: the per-gemeente
    // local-angle engine (#160(b)). RegioS IS a GeoDimension here (correctly
    // typed, unlike 85792NED): 745 codes = 728 GM (incl. opgeheven gemeenten,
    // whose post-merger years are null with reason 'Impossible') + 12 PV +
    // 4 LD + NL01. Yearly only (31 JJ, all Definitief), one measure. Full
    // ingest (23,095 obs); the FIXTURE keeps 2015+ only (8,195 obs).
    id: '83625NED',
    updateCadence: 'yearly (new year added ~February)',
    servesTasks: ['CC29', 'CC30', 'CC31'],
  },
];

// Every curated seed table (Phase 0 + coverage sprint) — what `ingest register`
// registers and the fixture-capture script accepts.
export const SEED_TABLES: Phase0Table[] = [...PHASE0_TABLES, ...COVERAGE_TABLES];
