// Hand-built ValidatedResult objects for the WP7 validator/template unit
// tests. These test OUR guard mechanics (seeded mismatches, docs/05 R3
// "Unit-tested with seeded mismatches"), not model or query behavior — the
// hermetic end-to-end suite (compose-pipeline.test.ts) exercises real query
// results and recorded LLM output. Values mirror the frozen answer key so the
// prose in the correct-fixture tests reads like real answers.
import type { DerivationRecord, ResultCell, ValidatedResult } from '../../src/query/index.ts';
import { DERIVED_DATA_MARKING } from '../../src/query/index.ts';

interface CellSpec {
  table?: string;
  measure?: string;
  measureTitle?: string;
  region?: { code: string; label: string } | null;
  periodCode: string;
  periodLabel: string;
  value: number | null;
  unit: string;
  decimals?: number;
  status?: string;
  valueAttribute?: string;
}

export function makeCell(spec: CellSpec): ResultCell {
  const status = spec.status ?? 'Definitief';
  return {
    resultId: `${spec.table ?? 'T1'}:${spec.measure ?? 'M1'}:${spec.region?.code ?? '-'}:${spec.periodCode}:D`,
    tableId: spec.table ?? 'T1',
    measure: spec.measure ?? 'M1',
    measureTitle: spec.measureTitle ?? 'Testmaat',
    regionCode: spec.region?.code ?? null,
    regionLabel: spec.region?.label ?? null,
    periodCode: spec.periodCode,
    periodLabel: spec.periodLabel,
    grain: spec.periodCode.includes('KW') ? 'KW' : spec.periodCode.includes('MM') ? 'MM' : 'JJ',
    dims: {},
    dimLabels: {},
    value: spec.value,
    unit: spec.unit,
    decimals: spec.decimals ?? 0,
    status,
    provisional: status !== 'Definitief',
    valueAttribute: spec.valueAttribute ?? 'None',
    batchId: 1,
  };
}

export function makeResult(spec: {
  shape: ValidatedResult['shape'];
  cells: ResultCell[];
  derivations?: DerivationRecord[];
  definitionLabel?: string | null;
  definitionText?: string | null;
  periodSemantics?: string | null;
}): ValidatedResult {
  const cells = spec.cells;
  return {
    ok: true,
    schemaVersion: 1,
    shape: spec.shape,
    cells,
    derivations: spec.derivations ?? [],
    attribution: {
      tableId: cells[0]?.tableId ?? 'T1',
      tableTitle: 'Testtabel; kerncijfers',
      tableVersion: 1,
      syncedAt: '2026-07-02T16:41:04.988Z',
      coveredPeriods: { from: cells[0]!.periodCode, to: cells[cells.length - 1]!.periodCode },
      license: 'CC BY 4.0',
      definitionLabel: spec.definitionLabel ?? null,
      definitionText: spec.definitionText ?? null,
      periodSemantics: spec.periodSemantics ?? null,
    },
    intent: {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'test_key' },
      period: { kind: 'codes', codes: cells.map((c) => c.periodCode) },
      derivation: 'none',
    },
  };
}

// --- ready-made results mirroring the benchmark shapes ----------------------

/** B1-like: single national population value. */
export const populationSingle = makeResult({
  shape: 'single',
  definitionLabel: 'bevolking op 1 januari',
  periodSemantics: 'stand per 1 januari',
  cells: [
    makeCell({
      table: '03759ned', measure: 'M000352', measureTitle: 'Bevolking op 1 januari',
      region: { code: 'NL01', label: 'Nederland' },
      periodCode: '2025JJ00', periodLabel: '2025', value: 18044027, unit: 'aantal',
    }),
  ],
});

/** B5-like: percent level, no region. */
export const unemploymentSingle = makeResult({
  shape: 'single',
  definitionLabel: 'werkloosheidspercentage, seizoengecorrigeerd',
  cells: [
    makeCell({
      table: '85224NED', measure: 'M001906', measureTitle: 'Werkloosheidspercentage',
      region: null, periodCode: '2025KW04', periodLabel: '2025 4e kwartaal', value: 4.0, unit: '%', decimals: 1,
    }),
  ],
});

/** B6-like: the ×1.000 factor-unit guard (R10). */
export const housingSingle = makeResult({
  shape: 'single',
  definitionLabel: 'woningvoorraad per 1 januari',
  cells: [
    makeCell({
      table: '82235NED', measure: 'D002936', measureTitle: 'Beginstand voorraad',
      region: null, periodCode: '2024JJ00', periodLabel: '2024', value: 8204, unit: 'x 1 000',
    }),
  ],
});

/** B11-like: provisional (NaderVoorlopig) value — the R11 case. */
export const solarSingle = makeResult({
  shape: 'single',
  definitionLabel: 'bruto elektriciteitsproductie uit zonnestroom',
  cells: [
    makeCell({
      table: '82610NED', measure: 'M002264_1', measureTitle: 'Bruto elektriciteitsproductie',
      region: null, periodCode: '2024JJ00', periodLabel: '2024', value: 21822, unit: 'mln kWh',
      status: 'NaderVoorlopig',
    }),
  ],
});

/** B12-like: '1 000 euro' factor unit. */
export const incomeSingle = makeResult({
  shape: 'single',
  definitionLabel: 'gemiddeld besteedbaar inkomen van huishoudens',
  cells: [
    makeCell({
      table: '83932NED', measure: 'M003239', measureTitle: 'Gemiddeld inkomen',
      region: null, periodCode: '2023JJ00', periodLabel: '2023', value: 57.6, unit: '1 000 euro', decimals: 1,
    }),
  ],
});

/** Null-with-reason cell (R11). */
export const nullCellSingle = makeResult({
  shape: 'single',
  definitionLabel: 'bevolking op 1 januari',
  cells: [
    makeCell({
      table: '03759ned', measure: 'M000352', measureTitle: 'Bevolking op 1 januari',
      region: { code: 'GM0002', label: 'Aduard' },
      periodCode: '2024JJ00', periodLabel: '2024', value: null, unit: 'aantal', valueAttribute: 'Impossible',
    }),
  ],
});

/** B4-like: CPI series 2020–2024, non-monotonic, net up. */
export function cpiSeries(): ValidatedResult {
  const points: [string, string, number][] = [
    ['2020JJ00', '2020', 1.3],
    ['2021JJ00', '2021', 2.7],
    ['2022JJ00', '2022', 10.0],
    ['2023JJ00', '2023', 3.8],
    ['2024JJ00', '2024', 3.3],
  ];
  const cells = points.map(([code, label, value]) =>
    makeCell({
      table: '86141NED', measure: 'M000238', measureTitle: 'Jaarmutatie CPI',
      region: null, periodCode: code, periodLabel: label, value, unit: '%', decimals: 1,
    }),
  );
  const derivations: DerivationRecord[] = [
    {
      kind: 'direction', explicit: false,
      sourceResultIds: cells.map((c) => c.resultId), unit: '%', marking: DERIVED_DATA_MARKING,
      direction: 'up', monotonic: false, netChange: 3.3 - 1.3,
      firstResultId: cells[0]!.resultId, lastResultId: cells[cells.length - 1]!.resultId,
    },
    {
      kind: 'first_last', explicit: false,
      sourceResultIds: [cells[0]!.resultId, cells[cells.length - 1]!.resultId], unit: '%', marking: DERIVED_DATA_MARKING,
      firstResultId: cells[0]!.resultId, lastResultId: cells[cells.length - 1]!.resultId,
    },
  ];
  return makeResult({
    shape: 'series',
    definitionLabel: 'inflatie (jaarmutatie CPI, alle bestedingen)',
    cells, derivations,
  });
}

/** B8-like: home-price series 2019–2024, non-monotonic (2023 dip), net up. */
export function makeHomePriceSeries(): ValidatedResult {
  const points: [string, string, number][] = [
    ['2019JJ00', '2019', 307978],
    ['2020JJ00', '2020', 334488],
    ['2021JJ00', '2021', 386714],
    ['2022JJ00', '2022', 428591],
    ['2023JJ00', '2023', 416153],
    ['2024JJ00', '2024', 450985],
  ];
  const cells = points.map(([code, label, value]) =>
    makeCell({
      table: '85773NED', measure: 'M001534', measureTitle: 'Gemiddelde verkoopprijs',
      region: null, periodCode: code, periodLabel: label, value, unit: 'euro',
    }),
  );
  const derivations: DerivationRecord[] = [
    {
      kind: 'direction', explicit: false,
      sourceResultIds: cells.map((c) => c.resultId), unit: 'euro', marking: DERIVED_DATA_MARKING,
      direction: 'up', monotonic: false, netChange: 450985 - 307978,
      firstResultId: cells[0]!.resultId, lastResultId: cells[cells.length - 1]!.resultId,
    },
    {
      kind: 'first_last', explicit: false,
      sourceResultIds: [cells[0]!.resultId, cells[cells.length - 1]!.resultId], unit: 'euro', marking: DERIVED_DATA_MARKING,
      firstResultId: cells[0]!.resultId, lastResultId: cells[cells.length - 1]!.resultId,
    },
  ];
  return makeResult({
    shape: 'series',
    definitionLabel: 'gemiddelde verkoopprijs van bestaande koopwoningen',
    cells, derivations,
  });
}

/** B10-like: two-region comparison with the auto ranking (R9 binding target). */
export function populationComparison(): ValidatedResult {
  const amsterdam = makeCell({
    table: '03759ned', measure: 'M000352', measureTitle: 'Bevolking op 1 januari',
    region: { code: 'GM0363', label: 'Amsterdam' },
    periodCode: '2024JJ00', periodLabel: '2024', value: 931298, unit: 'aantal',
  });
  const rotterdam = makeCell({
    table: '03759ned', measure: 'M000352', measureTitle: 'Bevolking op 1 januari',
    region: { code: 'GM0599', label: 'Rotterdam' },
    periodCode: '2024JJ00', periodLabel: '2024', value: 670610, unit: 'aantal',
  });
  return makeResult({
    shape: 'comparison',
    definitionLabel: 'bevolking op 1 januari',
    cells: [amsterdam, rotterdam],
    derivations: [
      {
        kind: 'max', explicit: false,
        sourceResultIds: [amsterdam.resultId, rotterdam.resultId], unit: 'aantal', marking: DERIVED_DATA_MARKING,
        value: 931298, winnerResultId: amsterdam.resultId,
        rankingResultIds: [amsterdam.resultId, rotterdam.resultId],
      },
    ],
  });
}

/** B13-like: explicit difference (growth over 2024). */
export function populationDifference(): ValidatedResult {
  const earlier = makeCell({
    table: '03759ned', measure: 'M000352', measureTitle: 'Bevolking op 1 januari',
    region: { code: 'NL01', label: 'Nederland' },
    periodCode: '2024JJ00', periodLabel: '2024', value: 17942942, unit: 'aantal',
  });
  const later = makeCell({
    table: '03759ned', measure: 'M000352', measureTitle: 'Bevolking op 1 januari',
    region: { code: 'NL01', label: 'Nederland' },
    periodCode: '2025JJ00', periodLabel: '2025', value: 18044027, unit: 'aantal',
  });
  return makeResult({
    shape: 'derived',
    definitionLabel: 'bevolking op 1 januari',
    periodSemantics: 'stand per 1 januari',
    cells: [earlier, later],
    derivations: [
      {
        kind: 'difference', explicit: true,
        sourceResultIds: [earlier.resultId, later.resultId], unit: 'aantal', marking: DERIVED_DATA_MARKING,
        value: 101085, minuendResultId: later.resultId, subtrahendResultId: earlier.resultId,
      },
    ],
  });
}

/** A falling percent difference — negative value + procentpunt (R10). */
export function inflationDrop(): ValidatedResult {
  const earlier = makeCell({
    table: '86141NED', measure: 'M000238', measureTitle: 'Jaarmutatie CPI',
    region: null, periodCode: '2023JJ00', periodLabel: '2023', value: 3.8, unit: '%', decimals: 1,
  });
  const later = makeCell({
    table: '86141NED', measure: 'M000238', measureTitle: 'Jaarmutatie CPI',
    region: null, periodCode: '2024JJ00', periodLabel: '2024', value: 3.3, unit: '%', decimals: 1,
  });
  return makeResult({
    shape: 'derived',
    definitionLabel: 'inflatie (jaarmutatie CPI, alle bestedingen)',
    cells: [earlier, later],
    derivations: [
      {
        kind: 'difference', explicit: true,
        sourceResultIds: [earlier.resultId, later.resultId], unit: '%', marking: DERIVED_DATA_MARKING,
        value: -0.5, minuendResultId: later.resultId, subtrahendResultId: earlier.resultId,
      },
    ],
  });
}

/** B14-like: four-region max. */
export function g4Max(): ValidatedResult {
  const specs: [string, string, number][] = [
    ['GM0363', 'Amsterdam', 934526],
    ['GM0599', 'Rotterdam', 672960],
    ['GM0518', "'s-Gravenhage (gemeente)", 568945],
    ['GM0344', 'Utrecht (gemeente)', 376757],
  ];
  const cells = specs.map(([code, label, value]) =>
    makeCell({
      table: '03759ned', measure: 'M000352', measureTitle: 'Bevolking op 1 januari',
      region: { code, label }, periodCode: '2025JJ00', periodLabel: '2025', value, unit: 'aantal',
    }),
  );
  return makeResult({
    shape: 'derived',
    definitionLabel: 'bevolking op 1 januari',
    cells,
    derivations: [
      {
        kind: 'max', explicit: true,
        sourceResultIds: cells.map((c) => c.resultId), unit: 'aantal', marking: DERIVED_DATA_MARKING,
        value: 934526, winnerResultId: cells[0]!.resultId,
        rankingResultIds: cells.map((c) => c.resultId),
      },
    ],
  });
}
