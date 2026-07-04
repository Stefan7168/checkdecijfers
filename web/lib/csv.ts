// WP21 (open-questions #52): "Download als CSV" — one answer's validated
// cells as a data file a journalist can open directly in Dutch-locale Excel.
//
// Format decisions (recorded in docs/08-build-plan.md, WP21): Dutch-notation
// CSV exactly like CBS StatLine's own downloads — ';' separator, decimal
// comma, NO thousands grouping (formatValueNl groups for prose display;
// grouping breaks numeric parsing outside Dutch Excel and CBS's own CSVs
// don't group), UTF-8 BOM (Excel's encoding sniff), CRLF line endings.
//
// Honesty rules, structural:
// - R1/R3: every waarde round-trips to EXACTLY the stored cell value — the
//   serializer pads to the cell's CBS decimals only when that is lossless,
//   otherwise it emits the exact value string. Derived values serialize at
//   the same precision the answer body shows them (the renderDifference
//   reference-cell-decimals convention), so the file carries exactly the
//   numbers the validated answer carried. No other number source exists.
// - R4: the preamble's source row IS buildAttributionLine(result) verbatim —
//   the one builder shared with answer text and chart specs; it cannot drift.
// - R5/CC BY: explicit derivation values ship in their own marked section
//   with their source cell ids; the implicit binding derivations
//   (direction/first_last) are prose infrastructure, never exported.
// - R10: eenheid is the cell's raw CBS unit metadata, verbatim.
// - R11: per-cell status column; a null value stays empty and states its CBS
//   reason in `bijzonderheid`.
//
// Imports target the already-client-proven pure leaves only (format.ts,
// query/types.ts — the WP20 precedent), never a barrel.
import { buildAttributionLine } from '../backend/answer/compose/format.ts';
import type { AnswerResponse } from '../backend/answer/respond/types.ts';
import { DERIVED_DATA_MARKING } from '../backend/query/types.ts';
import type { DerivationRecord, ResultCell } from '../backend/query/types.ts';

export interface AnswerCsv {
  filename: string;
  /** Full file content, BOM included. */
  content: string;
}

const SEPARATOR = ';';
const CRLF = '\r\n';
const BOM = '\ufeff';

/** RFC 4180 quoting for the ';' dialect: quote only fields that need it. */
function csvField(raw: string): string {
  return /[";\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

function csvRow(fields: string[]): string {
  return fields.map(csvField).join(SEPARATOR);
}

/** Decimal-comma, ungrouped serialization that can never change the value:
 * pad to the CBS decimals when that is lossless, else the exact JS string. */
function csvCellNumberNl(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  const exact = Number(fixed) === value ? fixed : String(value);
  return exact.replace('.', ',');
}

/** Derived values: the answer body's own precision (formatValueNl minus the
 * grouping) — toFixed at the reference cell's decimals absorbs float noise
 * the registered derivation may carry (e.g. 3.6 - 3.3), exactly as the
 * validated answer text displays it. */
function csvDerivedNumberNl(value: number, decimals: number | null): string {
  const text = decimals === null ? String(value) : value.toFixed(decimals);
  return text.replace('.', ',');
}

/** The explicit derivations are the answer's own headline computations
 * (difference/max — deriveDifference is always explicit, deriveMax carries
 * the flag). Only they are exported. */
type ExportableDerivation = Extract<DerivationRecord, { kind: 'difference' | 'max' }>;

function exportableDerivations(derivations: DerivationRecord[]): ExportableDerivation[] {
  return derivations.filter(
    (d): d is ExportableDerivation =>
      d.explicit && (d.kind === 'difference' || d.kind === 'max'),
  );
}

const DERIVATION_LABEL_NL: Record<ExportableDerivation['kind'], string> = {
  difference: 'verschil (laatste min eerste periode)',
  max: 'hoogste waarde',
};

/** The CBS decimals the answer body displays this derivation at:
 * renderDifference/renderMax use the minuend/winner cell. Defense-in-depth
 * (adversarial review, export-honesty lens): if that exact cell is ever
 * absent from the result — impossible today, run.ts builds derivations from
 * the same cells array — fall back to any other source cell, and only then
 * to null (the caller then emits the exact raw value string: an unregistered
 * rounding would be a value change, so truth beats beauty there). */
function derivationDecimals(
  derivation: ExportableDerivation,
  cellsById: Map<string, ResultCell>,
): number | null {
  const preferred =
    derivation.kind === 'difference' ? derivation.minuendResultId : derivation.winnerResultId;
  for (const id of [preferred, ...derivation.sourceResultIds]) {
    const cell = cellsById.get(id);
    if (cell) return cell.decimals;
  }
  return null;
}

export function buildAnswerCsv(response: AnswerResponse): AnswerCsv {
  const { result } = response;
  const derived = exportableDerivations(result.derivations);

  // Preamble: self-describing provenance sentences, one per row (R4 + CC BY
  // INSIDE the file, per open-questions #52 / the WP21 brief).
  const preamble: string[] = [csvRow([buildAttributionLine(result)])];
  if (result.attribution.definitionLabel !== null) {
    preamble.push(csvRow([`Definitie: ${result.attribution.definitionLabel}`]));
  }
  if (result.attribution.periodSemantics !== null) {
    preamble.push(csvRow([`Periodebetekenis: ${result.attribution.periodSemantics}`]));
  }
  if (response.stalenessWarning !== null) {
    // Verbatim: the pipeline's warning is already a self-describing sentence
    // ("Let op: deze tabel wordt normaal ... bijgewerkt ...", staleness.ts).
    preamble.push(csvRow([response.stalenessWarning]));
  }
  if (derived.length > 0) {
    preamble.push(csvRow([`Bewerking: ${DERIVED_DATA_MARKING}`]));
  }
  preamble.push(csvRow(['Bestand aangemaakt door checkdecijfers.nl']));

  // Data table: one row per validated cell, order preserved (the result is
  // already period-ascending, then intent region order).
  const dimKeys = [...new Set(result.cells.flatMap((cell) => Object.keys(cell.dims)))].sort();
  const header = csvRow([
    'onderwerp',
    'regio',
    'regiocode',
    'periode',
    'periodecode',
    ...dimKeys,
    'waarde',
    'eenheid',
    'status',
    'bijzonderheid',
    'cel-id',
  ]);
  const dataRows = result.cells.map((cell) =>
    csvRow([
      cell.measureTitle,
      cell.regionLabel ?? '',
      cell.regionCode ?? '',
      cell.periodLabel,
      cell.periodCode,
      ...dimKeys.map((key) => cell.dimLabels[key] ?? cell.dims[key] ?? ''),
      cell.value === null ? '' : csvCellNumberNl(cell.value, cell.decimals),
      cell.unit,
      cell.status,
      cell.valueAttribute === 'None' ? '' : cell.valueAttribute,
      cell.resultId,
    ]),
  );

  const lines = [...preamble, '', header, ...dataRows];

  if (derived.length > 0) {
    const cellsById = new Map<string, ResultCell>(result.cells.map((cell) => [cell.resultId, cell]));
    lines.push(
      '',
      csvRow([`Afgeleide waarden (${DERIVED_DATA_MARKING})`]),
      csvRow(['afleiding', 'waarde', 'eenheid', 'bron-cellen']),
      ...derived.map((derivation) =>
        csvRow([
          DERIVATION_LABEL_NL[derivation.kind],
          csvDerivedNumberNl(derivation.value, derivationDecimals(derivation, cellsById)),
          derivation.unit,
          derivation.sourceResultIds.join(', '),
        ]),
      ),
    );
  }

  const { from, to } = result.attribution.coveredPeriods;
  const span = from === to ? from : `${from}-${to}`;
  return {
    filename: `checkdecijfers-${result.attribution.tableId}-${span}.csv`,
    content: BOM + lines.join(CRLF) + CRLF,
  };
}
