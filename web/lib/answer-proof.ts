// WP session 72 design brief (docs/session-briefs/2026-09-03-source-drill-
// through-design.md), the source drill-through cluster (#70/#79/#89 +
// #90-deep): "Bewijs dit cijfer" — one client-side view over the SAME
// validated envelope the chat already holds, at three depths (why this
// reading, which cells, which computation). Pure leaf, no React — built
// ONCE at receive time (chat.tsx) and at replay time (replay-assemble.ts),
// exactly the buildCitation / buildAnswerCsv / statCardData pattern (ADR 033
// (A3): the SAME builder over the SAME envelope ⇒ parity by construction.
//
// R1/R3 (docs/05-data-rules.md): every digit here is formatValueNl /
// displayValueUnit / displayDifferenceUnit over a STORED cell.value,
// derivation.value, netChange or factor. This module does NO ARITHMETIC —
// "B - A" prints the derivation's own stored `value`, never
// `later.value - earlier.value` computed here. answer-proof.test.ts's R1
// scan test is the belt: it re-tokenizes every string this module produces
// and proves each numeric token is a formatted stored value or a verbatim
// metadata field (docs/05 R1's own answer-side discipline, adapted to a
// deterministic — not LLM — surface).
//
// D9 (the design brief): difference/max/direction/unit_expansion are shown;
// first_last is skipped (it carries no value of its own — a binding aid for
// R9 prose, not something a reader drills into). D2: fields here are the
// RAW building blocks (a label, a count, a resolved cell) — the "Gebruikte
// lezing:" / "Niet gekozen:" / "Periodebetekenis:" prefixes are added by the
// component (answer-proof.tsx) at render time, exactly like csv.ts's own
// preamble prefixes — EXCEPT `steps[].text` and `nullNotice`, which involve
// real branching/counting logic and so are fully composed HERE (the
// deterministic-template discipline the brief's §4 describes), so the
// component only ever interpolates already-decided Dutch prose.
import {
  displayAlternateLabel,
  formatValueNl,
} from '../backend/answer/compose/format.ts';
import {
  displayDifferenceUnit,
  displayValueUnit,
  nullReasonText,
  provisionalSuffix,
} from '../backend/answer/compose/template.ts';
import type { AnswerResponse } from '../backend/answer/respond/types.ts';
import type { AttributionAlternate, DerivationRecord, ResultCell, ValidatedResult } from '../backend/query/types.ts';
// #170(1): the same measured-date formatter the source badge chip already
// uses — reused here (not re-derived) so the panel's date can never drift
// from the chip's.
import { syncDateLabel } from '../components/source-badge.tsx';

/** One `response.result.cells[i]`, carrying everything the "De gebruikte
 * cellen" table (Depth 2, #70) shows — human labels always, codes/ids only
 * when `Technische details` is on (the design brief's D2). */
export interface ProofCell {
  resultId: string;
  measure: string;
  measureTitle: string;
  regionLabel: string | null;
  regionCode: string | null;
  periodLabel: string;
  periodCode: string;
  dims: Record<string, string>;
  dimLabels: Record<string, string>;
  /** displayValueUnit(...) + provisionalSuffix(cell), or for a null cell
   * 'geen waarde — ' + nullReasonText(valueAttribute) (R11: a null cell
   * states its CBS reason, never a bare gap). */
  valueText: string;
  status: string;
  provisional: boolean;
  batchId: number;
}

/** One "Stap voor stap" (Depth 3, #79) list item — fully composed Dutch
 * prose (the deterministic template already applied), plus the optional
 * `[cel-id …]` suffix shown only when `Technische details` is on. */
export interface AnswerProofStep {
  text: string;
  technical: string | null;
}

/** One non-chosen reading (Depth 1, #89) — `label` is the cleaned display
 * text (displayAlternateLabel already stripped the registry's internal
 * cross-reference notation); `technical` is the ` — meetcode …` / `
 * — dim=code` suffix, shown only when `Technische details` is on. */
export interface AnswerProofAlternate {
  label: string;
  technical: string | null;
}

export interface AnswerProof {
  tableId: string;
  tableTitle: string;
  tableVersion: number;
  /** YYYY-MM-DD, via syncDateLabel — null only if the stored timestamp is
   * unparseable (principle c: never a guessed or reformatted date). */
  syncedAt: string | null;
  license: string;
  /** Source-registry key (WP30a); absent on envelopes stored before WP30a —
   * the same present-only convention AnswerView.source already carries. */
  source?: string;
  /** definitionLabel ?? cells[0].measureTitle — the raw reading text; the
   * component prepends "Gebruikte lezing: " and a closing period. */
  reading: string;
  /** Raw attribution.periodSemantics; the component prepends
   * "Periodebetekenis: " (the csv.ts preamble's own form) when non-null. */
  periodSemantics: string | null;
  /** #39's registry-recorded alternates, present-only on the result
   * (`?? []`) — absent also means "row predates #39", so this is never
   * used to claim "no other reading exists" (principle c). */
  alternates: AnswerProofAlternate[];
  cells: ProofCell[];
  steps: AnswerProofStep[];
  /** "{k} van de {n} cellen heeft geen waarde; …", or null when every cell
   * has a value. */
  nullNotice: string | null;
  /** True when the result carries a registered derivation — the SAME rule
   * compose.ts's marking line and citation.ts use (R5: the marking renders
   * whenever the answer schema contains a derivation record), so the panel
   * never contradicts the answer it opens under. A shown step, a
   * binding-only first_last or an unknown kind all count; the component then
   * shows DERIVED_DATA_MARKING below the steps (review round 2). */
  marked: boolean;
}

function cellValueText(cell: ResultCell): string {
  if (cell.value === null) return `geen waarde — ${nullReasonText(cell.valueAttribute)}`;
  return `${displayValueUnit(cell.value, cell.decimals, cell.unit)}${provisionalSuffix(cell)}`;
}

function proofCell(cell: ResultCell): ProofCell {
  return {
    resultId: cell.resultId,
    measure: cell.measure,
    measureTitle: cell.measureTitle,
    regionLabel: cell.regionLabel,
    regionCode: cell.regionCode,
    periodLabel: cell.periodLabel,
    periodCode: cell.periodCode,
    dims: cell.dims,
    dimLabels: cell.dimLabels,
    valueText: cellValueText(cell),
    status: cell.status,
    provisional: cell.provisional,
    batchId: cell.batchId,
  };
}

/** ` — meetcode X` / ` — dim=code[, dim2=code2]`, or null when the
 * registry alternate names neither (structurally shouldn't happen, but this
 * module never throws). Leading ` — ` included so the component can just
 * append it after the label when Technische details is on. */
function alternateTechnical(alternate: AttributionAlternate): string | null {
  const parts: string[] = [];
  if (alternate.measure !== undefined) parts.push(`meetcode ${alternate.measure}`);
  if (alternate.dims !== undefined) {
    const dimsPart = Object.entries(alternate.dims)
      .map(([dim, code]) => `${dim}=${code}`)
      .join(', ');
    if (dimsPart.length > 0) parts.push(dimsPart);
  }
  return parts.length > 0 ? ` — ${parts.join(', ')}` : null;
}

function buildAlternates(result: ValidatedResult): AnswerProofAlternate[] {
  const alternates = result.attribution.alternates ?? [];
  return alternates
    .map((alternate) => ({
      label: displayAlternateLabel(alternate.label),
      technical: alternateTechnical(alternate),
    }))
    .filter((alternate) => alternate.label.length > 0);
}

/** The always-present first step: which cell(s) were read, verbatim — no
 * computation, so it never needs a formatter beyond the shared cell text. */
function readStep(result: ValidatedResult): AnswerProofStep {
  const cells = result.cells;
  if (cells.length === 1) {
    const cell = cells[0]!;
    const regionPart = cell.regionLabel !== null ? `${cell.regionLabel}, ` : '';
    return {
      text:
        `Gelezen: 1 cel uit tabel ${result.attribution.tableId}: ${cell.measureTitle}, ` +
        `${regionPart}${cell.periodLabel} → ${cellValueText(cell)}.`,
      technical: ` [cel-id ${cell.resultId}]`,
    };
  }
  return {
    text: `Gelezen: ${cells.length} cellen uit tabel ${result.attribution.tableId} (de tabel hierboven).`,
    technical: cells.length === 0 ? null : ` [cel-id ${cells.map((cell) => cell.resultId).join(', ')}]`,
  };
}

/** D9: every derivation kind the panel shows — first_last is excluded (it
 * carries no value, only a binding pair; the design brief's D9). */
type ShownDerivation = Exclude<DerivationRecord, { kind: 'first_last' }>;

function isShownDerivation(derivation: DerivationRecord): derivation is ShownDerivation {
  return derivation.kind !== 'first_last';
}

const DIRECTION_WORD_NL: Record<Extract<DerivationRecord, { kind: 'direction' }>['direction'], string> = {
  up: 'gestegen',
  down: 'gedaald',
  flat: 'gelijk gebleven',
};

/** Review round 2 (session 74): the honest step for a stored derivation this
 * module cannot narrate — a kind outside today's union or a direction word
 * outside up/down/flat (a future `DerivationRecord` member, a malformed
 * historical row). buildAnswerProof's try/catch catches EXCEPTIONS only: a
 * switch falling through put `undefined` into `steps[]`, which threw later in
 * the component's render, outside every belt; the word lookup printed the
 * literal "undefined" into Dutch prose. Marked as derived (R5) either way — a
 * derivation WAS registered, whatever it was. */
const UNKNOWN_STEP: AnswerProofStep = {
  text: 'Een bewerking van een onbekend type kon niet worden weergegeven.',
  technical: null,
};

/** One "Stap voor stap" entry for a registered derivation. Every numeric
 * value printed here is the derivation's OWN stored field (`.value`,
 * `.netChange`, `.factor`) run through the shared formatter — never
 * recomputed from the cells (R1: "no arithmetic in this module"). */
function derivationStep(derivation: ShownDerivation, cellsById: Map<string, ResultCell>): AnswerProofStep {
  switch (derivation.kind) {
    case 'difference': {
      const later = cellsById.get(derivation.minuendResultId)!;
      const earlier = cellsById.get(derivation.subtrahendResultId)!;
      return {
        text:
          `Verschil berekend: ${later.periodLabel} (${displayValueUnit(later.value!, later.decimals, later.unit)}) ` +
          `min ${earlier.periodLabel} (${displayValueUnit(earlier.value!, earlier.decimals, earlier.unit)}) ` +
          `= ${displayDifferenceUnit(derivation.value, later.decimals, derivation.unit)}.`,
        technical: ` [cel-id ${derivation.sourceResultIds.join(', ')}]`,
      };
    }
    case 'max': {
      const winner = cellsById.get(derivation.winnerResultId)!;
      const winnerLabel = winner.regionLabel ?? winner.periodLabel;
      const order = derivation.rankingResultIds
        .map((id) => cellsById.get(id)!)
        .map((cell) => `${cell.regionLabel ?? cell.periodLabel} (${displayValueUnit(cell.value!, cell.decimals, cell.unit)})`)
        .join('; ');
      return {
        text:
          `Hoogste waarde bepaald: ${winnerLabel} (${displayValueUnit(winner.value!, winner.decimals, winner.unit)}). ` +
          `Volgorde: ${order}.`,
        technical: ` [cel-id ${derivation.rankingResultIds.join(', ')}]`,
      };
    }
    case 'direction': {
      const first = cellsById.get(derivation.firstResultId)!;
      const last = cellsById.get(derivation.lastResultId)!;
      const monotonicNote = derivation.monotonic ? '' : ' De reeks ging niet in elke stap dezelfde kant op.';
      // `typeof`, not `=== undefined`: a malformed direction such as
      // 'constructor' resolves through the prototype chain to a function.
      const word: unknown = DIRECTION_WORD_NL[derivation.direction];
      if (typeof word !== 'string') return UNKNOWN_STEP;
      return {
        text:
          `Richting van de reeks: ${word} van ${first.periodLabel} ` +
          `tot en met ${last.periodLabel}; netto ${displayDifferenceUnit(derivation.netChange, last.decimals, derivation.unit)}.` +
          monotonicNote,
        technical: ` [cel-id ${derivation.sourceResultIds.join(', ')}]`,
      };
    }
    case 'unit_expansion': {
      const source = cellsById.get(derivation.sourceResultIds[0]!)!;
      return {
        text: `Uitgerekend: ${displayValueUnit(source.value!, source.decimals, source.unit)} = ${formatValueNl(derivation.value, 0)}.`,
        technical: ` [cel-id ${derivation.sourceResultIds.join(', ')}]`,
      };
    }
    default:
      // Unreachable for today's DerivationRecord union; reachable for a stored
      // kind this build does not know (see UNKNOWN_STEP).
      return UNKNOWN_STEP;
  }
}

function buildSteps(result: ValidatedResult, cellsById: Map<string, ResultCell>): { steps: AnswerProofStep[]; marked: boolean } {
  const derivationSteps = result.derivations.filter(isShownDerivation).map((derivation) => derivationStep(derivation, cellsById));
  // Review round 2 (session 74): the "no computation" sentence must agree with
  // the read step above it AND with the answer's own marking line. Every
  // answer without a SHOWN derivation lands here: a single cell; a multi-cell
  // comparison (the G4 chips, live since rows 263/264) or a series whose null
  // cell blocked its derivations (run.ts registers them only when every value
  // is present) — the brief's single-cell wording ("de waarde uit de cel")
  // contradicted the "N cellen" it followed; and a result whose only
  // derivations are first_last (D9: not shown), which compose.ts and
  // citation.ts DO mark as derived, so the panel names that derivation for
  // what it is (the series read as a whole, begin and end point) instead of
  // "geen bewerking", and stays marked like the answer above it. In this
  // branch (no shown step) `derived` means exactly "only first_last": that is
  // the one kind isShownDerivation hides, and an unknown kind is SHOWN as
  // UNKNOWN_STEP — so no second predicate is needed here; if D9 ever hides
  // another kind, this sentence must be re-keyed with it. No live producer of
  // the first_last-only shape is known — run.ts registers direction and
  // first_last under the same gate and refuses mixed units before either — so
  // this is a belt for stored rows this build did not write, not a live path.
  const derived = result.derivations.length > 0;
  const noShownStep = derived
    ? 'Geen bewerking met een eigen uitkomst: het antwoord duidt de reeks als geheel (begin- en eindpunt) en toont de gelezen waarden van deze cellen.'
    : result.cells.length === 1
      ? 'Geen bewerking toegepast: het antwoord is de waarde uit de cel.'
      : 'Geen bewerking toegepast: het antwoord toont de gelezen waarden van deze cellen.';
  const steps =
    derivationSteps.length > 0
      ? [readStep(result), ...derivationSteps]
      : [readStep(result), { text: noShownStep, technical: null }];
  return { steps, marked: derived };
}

function buildNullNotice(result: ValidatedResult): string | null {
  const nullCount = result.cells.filter((cell) => cell.value === null).length;
  if (nullCount === 0) return null;
  return `${nullCount} van de ${result.cells.length} cellen heeft geen waarde; de reden van CBS staat per cel in de tabel.`;
}

/** Built once at receive time (chat.tsx) and at replay time
 * (replay-assemble.ts) from the SAME stored envelope — never re-decided,
 * never re-computed: parity by construction (ADR 033 ⟨A3⟩). Returns null
 * without a real `result.cells` array — the redacted-envelope belt (#14):
 * a redacted row's stored shape is `{schemaVersion, kind, question, text,
 * redacted: true}` (retention.ts), so `response.result` is absent at
 * runtime despite the type saying otherwise. Never throws: the whole body
 * runs under a try/catch belt (orchestrator review round 1) — the
 * `byId.get(id)!` idiom `derivationStep` uses (matching `template.ts`)
 * would throw on a stored derivation whose resultId is absent from `cells`,
 * and replay-assemble.ts runs this over EVERY stored row, so one malformed
 * historical row must not take down a whole resumed thread's render. A
 * missing proof panel is the honest degradation; the answer itself (text,
 * chart, citation, csv) is unaffected — none of those read this module. */
export function buildAnswerProof(response: AnswerResponse): AnswerProof | null {
  try {
    const result = response.result as ValidatedResult | undefined;
    if (!Array.isArray(result?.cells)) return null;

    const { attribution } = result;
    const cellsById = new Map(result.cells.map((cell) => [cell.resultId, cell]));
    const { steps, marked } = buildSteps(result, cellsById);

    return {
      tableId: attribution.tableId,
      tableTitle: attribution.tableTitle,
      tableVersion: attribution.tableVersion,
      syncedAt: syncDateLabel(attribution.syncedAt),
      license: attribution.license,
      ...(attribution.source !== undefined ? { source: attribution.source } : {}),
      reading: attribution.definitionLabel ?? result.cells[0]?.measureTitle ?? 'gevraagde waarde',
      periodSemantics: attribution.periodSemantics,
      alternates: buildAlternates(result),
      cells: result.cells.map(proofCell),
      steps,
      nullNotice: buildNullNotice(result),
      marked,
    };
  } catch {
    return null;
  }
}
