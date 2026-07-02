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
