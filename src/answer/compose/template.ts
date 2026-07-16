// The fail-closed template renderer (R3's final fallback). Deterministic
// code, zero LLM involvement: every number is formatted straight from a
// ResultCell or DerivationRecord, every label is embedded verbatim — so the
// output passes the validator BY CONSTRUCTION (proven by test, not assumed).
// Stilted Dutch is the accepted cost; a template answer can be ugly, never
// wrong. docs/02 reports the template-fallback count.
import type { DerivationRecord, ResultCell, ValidatedResult } from '../../query/index.ts';
import { formatValueNl } from './format.ts';
import { resolveSource } from '../../sources/registry.ts';
import { baseRegionLabel } from './validate.ts';

/** ValueAttribute → owner-approved Dutch reason (R11: a null cell states its
 * reason, never renders as a bare gap) — the wording lives in the SOURCE
 * REGISTRY (WP30a, ADR 030 D3/A2); unknown attributes fall back to naming
 * the raw marker rather than guessing a meaning. These two helpers receive a
 * CELL, which carries no source key, so they resolve the default ('cbs')
 * entry — byte-identical today; per-cell source routing arrives with the
 * first real adapter (WP30c), when cells can differ in source at all. */
export function nullReasonText(valueAttribute: string): string {
  const info = resolveSource(undefined);
  return info.nullReasonLabels[valueAttribute] ?? `door ${info.displayName} gemarkeerd als '${valueAttribute}'`;
}

function provisionalSuffix(cell: ResultCell): string {
  if (!cell.provisional) return '';
  // A2: the two-tier CBS wording comes from the registry map; a provisional
  // status outside the map keeps the generic suffix (pre-WP30a behavior).
  return resolveSource(undefined).provisionalDisplay[cell.status] ?? ' (voorlopig cijfer)';
}

/** Value + unit, R10-safe: '%' attaches, 'aantal' renders bare, factor units
 * ('x 1 000', '1 000 euro') keep their verbatim factor string — the ×1.000
 * misreading guard. */
export function displayValueUnit(value: number, decimals: number, unit: string): string {
  const formatted = formatValueNl(value, decimals);
  const trimmed = unit.trim();
  if (trimmed === '%') return `${formatted}%`;
  if (/^aantal$/i.test(trimmed)) return formatted;
  if (/\d/.test(trimmed)) {
    // An index-BASE declaration ("2015=100") is a label, never a factor
    // (#143): an '×' prefix would claim a multiplication that isn't real.
    // parseFactorUnit (query/derivations.ts) already excludes '=' units from
    // expansion for the same reason — this keeps the display side consistent.
    if (trimmed.includes('=')) return `${formatted} (${trimmed})`;
    const factor = trimmed.startsWith('x ') || trimmed.startsWith('× ') ? trimmed : `× ${trimmed}`;
    return `${formatted} (${factor})`;
  }
  // A long descriptive unit phrase (3+ words — e.g. an onboarded measure's
  // "gemiddelde saldo van de deelvragen") reads as a run-on when jammed straight
  // after the number; set it off in parentheses (#115 lever c). Short units
  // ('euro', 'mln kWh') stay bare. Verbatim — the unit is never reworded (R10,
  // principle a). No Phase-0 measure has such a unit, so seed answers are
  // unchanged (benchmark-proven).
  if (trimmed.split(/\s+/).length >= 3) return `${formatted} (${trimmed})`;
  return `${formatted} ${trimmed}`;
}

/** Difference values over %-cells are procentpunt, never % (R10). */
function displayDifferenceUnit(value: number, decimals: number, unit: string): string {
  if (unit.trim() === '%') return `${formatValueNl(value, decimals)} procentpunt`;
  return displayValueUnit(value, decimals, unit);
}

function subject(result: ValidatedResult): string {
  return result.attribution.definitionLabel ?? result.cells[0]?.measureTitle ?? 'gevraagde waarde';
}

/** Sentence-initial form. Dutch grammatical gender is not tracked anywhere in
 * the pipeline, so templates never prepend an article ('De
 * werkloosheidspercentage' is wrong Dutch — adversarial-review finding,
 * 2026-07-03); they capitalize the label itself instead. */
function subjectSentenceStart(result: ValidatedResult): string {
  const s = subject(result);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function regionPhrase(cell: ResultCell): string {
  return cell.regionLabel === null ? '' : ` in ${baseRegionLabel(cell.regionLabel)}`;
}

function cellLine(cell: ResultCell): string {
  if (cell.value === null) {
    return `${cell.periodLabel}${regionPhrase(cell)}: geen waarde — ${nullReasonText(cell.valueAttribute)}`;
  }
  return `${cell.periodLabel}${regionPhrase(cell)}: ${displayValueUnit(cell.value, cell.decimals, cell.unit)}${provisionalSuffix(cell)}`;
}

function renderSingle(result: ValidatedResult): string {
  const cell = result.cells[0]!;
  if (cell.value === null) {
    return `Voor ${cell.periodLabel}${regionPhrase(cell)} is er geen waarde voor ${subject(result)}: ${nullReasonText(cell.valueAttribute)}.`;
  }
  return `${subjectSentenceStart(result)}${regionPhrase(cell)} was in ${cell.periodLabel} ${displayValueUnit(cell.value, cell.decimals, cell.unit)}${provisionalSuffix(cell)}.`;
}

function renderSeries(result: ValidatedResult): string {
  // Claims-free: the values per period, nothing more. Trend prose is the
  // LLM path's job (bound to the direction derivation); the template only
  // states what the cells state.
  const lines = result.cells.map((cell) => cellLine(cell)).join('; ');
  return `${subjectSentenceStart(result)} per periode: ${lines}.`;
}

function renderComparison(result: ValidatedResult): string {
  const lines = result.cells.map((cell) => cellLine(cell)).join('; ');
  const max = result.derivations.find((d) => d.kind === 'max');
  let winnerSentence = '';
  if (max && max.kind === 'max') {
    const winner = result.cells.find((c) => c.resultId === max.winnerResultId);
    if (winner?.regionLabel) {
      winnerSentence = ` ${baseRegionLabel(winner.regionLabel)} had de hoogste waarde.`;
    }
  }
  return `${subjectSentenceStart(result)}: ${lines}.${winnerSentence}`;
}

function renderDifference(result: ValidatedResult, derivation: Extract<DerivationRecord, { kind: 'difference' }>): string {
  const byId = new Map(result.cells.map((c) => [c.resultId, c]));
  const later = byId.get(derivation.minuendResultId)!;
  const earlier = byId.get(derivation.subtrahendResultId)!;
  const decimals = later.decimals;
  const changeWord =
    derivation.value > 0 ? 'Dat is een toename.' : derivation.value < 0 ? 'Dat is een afname.' : 'De waarde bleef gelijk.';
  return (
    `Het verschil in ${subject(result)}${regionPhrase(later)} tussen ${earlier.periodLabel} en ${later.periodLabel} ` +
    `is ${displayDifferenceUnit(Math.abs(derivation.value), decimals, derivation.unit)}: ` +
    `van ${displayValueUnit(earlier.value!, earlier.decimals, earlier.unit)}${provisionalSuffix(earlier)} in ${earlier.periodLabel} ` +
    `naar ${displayValueUnit(later.value!, later.decimals, later.unit)}${provisionalSuffix(later)} in ${later.periodLabel}. ${changeWord}`
  );
}

function renderMax(result: ValidatedResult, derivation: Extract<DerivationRecord, { kind: 'max' }>): string {
  const byId = new Map(result.cells.map((c) => [c.resultId, c]));
  const winner = byId.get(derivation.winnerResultId)!;
  const others = derivation.rankingResultIds
    .filter((id) => id !== derivation.winnerResultId)
    .map((id) => byId.get(id)!)
    .map((cell) => cellLine(cell))
    .join('; ');
  const winnerName = winner.regionLabel ? baseRegionLabel(winner.regionLabel) : winner.periodLabel;
  return (
    `Van de ${result.cells.length} vergeleken regio's had ${winnerName} in ${winner.periodLabel} de hoogste waarde voor ` +
    `${subject(result)}: ${displayValueUnit(winner.value!, winner.decimals, winner.unit)}${provisionalSuffix(winner)}. ` +
    `Daarna: ${others}.`
  );
}

/** Deterministic Dutch answer body for any ValidatedResult. */
export function renderTemplateBody(result: ValidatedResult): string {
  const explicit = result.derivations.find((d) => d.explicit);
  if (explicit?.kind === 'difference') return renderDifference(result, explicit);
  if (explicit?.kind === 'max') return renderMax(result, explicit);
  switch (result.shape) {
    case 'single':
      return renderSingle(result);
    case 'series':
      return renderSeries(result);
    case 'comparison':
      return renderComparison(result);
    case 'derived':
      // derived shape with a non-explicit or missing derivation record —
      // fall back to the safest general rendering.
      return result.cells.length === 1 ? renderSingle(result) : renderSeries(result);
  }
}
