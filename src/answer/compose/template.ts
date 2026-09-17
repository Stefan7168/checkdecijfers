// The fail-closed template renderer (R3's final fallback). Deterministic
// code, zero LLM involvement: every number is formatted straight from a
// ResultCell or DerivationRecord, every label is embedded verbatim — so the
// output passes the validator BY CONSTRUCTION (proven by test, not assumed).
// Stilted Dutch is the accepted cost; a template answer can be ugly, never
// wrong. docs/02 reports the template-fallback count.
import type { DerivationRecord, ResultCell, ValidatedResult } from '../../query/index.ts';
import { formatValueNl, regionSetBodyNoun } from './format.ts';
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

/** Exported since #162: the slot filler appends the SAME registry-worded
 * marking to a provisional slot's rendering (R11 filler-owned on that path). */
export function provisionalSuffix(cell: ResultCell): string {
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

/** Difference values over %-cells are procentpunt, never % (R10). Exported
 * since #162: the slot filler renders verschil-slots through this exact code. */
export function displayDifferenceUnit(value: number, decimals: number, unit: string): string {
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

/** Verb-form direction words for a chart headline sentence ("Bevolking
 * steeg... ") — distinct from prompt.ts's TREND_WORD_BY_DIRECTION, which is
 * the NOUN form ("stijging") used as an LLM phrasing hint, not a formatter
 * output. */
const TREND_VERB_BY_DIRECTION: Record<'up' | 'down' | 'flat', string> = {
  up: 'steeg',
  down: 'daalde',
  flat: 'bleef stabiel',
};

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

/** ADR 055 / **MS1** — the PARTICIPLE form of a direction, for the per-region
 * clause below ("... (gestegen)"). A third grammatical form beside
 * TREND_VERB_BY_DIRECTION (the finite verb a headline sentence needs) and
 * prompt.ts's TREND_WORD_BY_DIRECTION (the noun form used as a phrasing
 * hint): three forms, three tables, none of them a rewording of a CBS label.
 * 'gelijk gebleven' is deliberately the exact phrase validate.ts's FLAT_WORDS
 * recognises — the template's own words are judged by the same validator
 * every other body is. */
const TREND_PARTICIPLE_BY_DIRECTION: Record<'up' | 'down' | 'flat', string> = {
  up: 'gestegen',
  down: 'gedaald',
  flat: 'gelijk gebleven',
};

/** One region's phraseable clause data: the two endpoint cells and the
 * direction record's own word, in BOTH label forms — `fullLabel` (verbatim
 * CBS label, e.g. "Utrecht (gemeente)") for the live renderer since ADR 055
 * pass-4 row 12, and `baseLabel` (qualifier stripped) kept only for
 * `renderRegionSeriesLegacyPreLineFormat` below, which reconstruct.ts uses
 * for rows stored before that change. Shared by both renderers so the DATA
 * (which regions get a clause, and from which cells) can never drift between
 * them — only the wording differs. */
interface RegionSeriesClause {
  fullLabel: string;
  baseLabel: string;
  first: ResultCell;
  last: ResultCell;
  direction: 'up' | 'down' | 'flat';
}

/** ADR 055 MS1, mechanised: one entry per region that has its OWN `direction`
 * record (computed over that region's cells alone — deriveDirection's
 * checkSingleRegion is what makes a per-region slice the only legal input).
 * A region with any gap at any requested period simply has no record here,
 * so neither renderer below has anything to phrase a direction from for it —
 * and R9 fails any trend word about that region closed from the other side.
 * The intent's own region order is used (`result.regionSeries?.requested`,
 * which is also the chart's series order, R6), with a fallback that keeps
 * this total for a hand-built result rather than throwing inside the
 * fail-closed floor of the R3 ladder — the same defensive posture
 * renderRegionSet takes with `scope`. */
function regionSeriesClauses(result: ValidatedResult): RegionSeriesClause[] {
  const byId = new Map(result.cells.map((c) => [c.resultId, c]));
  const requested =
    result.regionSeries?.requested ??
    [...new Set(result.cells.map((c) => c.regionCode).filter((code): code is string => code !== null))];
  const clauses: RegionSeriesClause[] = [];
  for (const regionCode of requested) {
    const direction = result.derivations.find(
      (d): d is Extract<DerivationRecord, { kind: 'direction' }> =>
        d.kind === 'direction' && byId.get(d.firstResultId)?.regionCode === regionCode,
    );
    if (direction === undefined) continue;
    const first = byId.get(direction.firstResultId);
    const last = byId.get(direction.lastResultId);
    // Unreachable for a real result (a registered derivation's endpoints are
    // always cells of the same result, and a record only exists for a region
    // whose every cell carries a value) — fail closed rather than throw.
    if (first?.value == null || last?.value == null) continue;
    const fullLabel = first.regionLabel === null ? regionCode : first.regionLabel;
    const baseLabel = first.regionLabel === null ? regionCode : baseRegionLabel(first.regionLabel);
    clauses.push({ fullLabel, baseLabel, first, last, direction: direction.direction });
  }
  return clauses;
}

/** The clause's own prose, given which label form to open it with — the only
 * thing that differs between the live renderer and the legacy one below. */
function regionSeriesClauseText(name: string, c: RegionSeriesClause): string {
  return (
    `${name} ging van ${displayValueUnit(c.first.value!, c.first.decimals, c.first.unit)}${provisionalSuffix(c.first)} ` +
    `in ${c.first.periodLabel} naar ${displayValueUnit(c.last.value!, c.last.decimals, c.last.unit)}${provisionalSuffix(c.last)} ` +
    `in ${c.last.periodLabel} (${TREND_PARTICIPLE_BY_DIRECTION[c.direction]})`
  );
}

/** ADR 055 — one measure, 2..REGION_SERIES_MAX_REGIONS EXPLICITLY NAMED
 * regions, over a period range: one line per region.
 *
 * **MS1 is implemented here exactly the way RS1 is implemented in
 * renderRegionSet: by keying on the existence of a DERIVATION RECORD, never
 * by filtering words out of prose** — see `regionSeriesClauses` above. Its
 * cells still DRAW (chart gaps + nullNotes, R11) and its coverage is
 * disclosed by the structural line buildRegionSeriesLine builds.
 *
 * **No cross-region claim of any kind is made or supported**: no registered
 * derivation ranks change across regions (deriveMax refuses a multi-period
 * cells array, and run.ts additionally gates it off this shape), so there is
 * no `max` record here and a superlative would fail R9 closed.
 *
 * **ADR 055 pass-4 rows 12+13 (2026-09-17), superseding this renderer's
 * original shape (shipped commit f923f31, same day):**
 *  - **Row 12 — the verbatim CBS-qualified label, not `baseRegionLabel`.**
 *    Six named regions in one sentence made a bare "Utrecht" genuinely
 *    ambiguous with the provincie of the same name; the legend, proof table
 *    and CSV already show the qualifier ("Utrecht (gemeente)"), so the body
 *    now matches them. `sentenceMentionsCellRegion` (validate.ts) needed no
 *    change: it is a case-insensitive SUBSTRING check against the BASE
 *    label, which still matches inside the qualified form.
 *  - **Row 13 — one line per region, not one semicolon-joined sentence.** A
 *    375px 6-region body used to be a 15-line run-on paragraph. Each line
 *    now starts with "– " (en dash) and the lines are joined by '\n', with
 *    the header ending in ':' on its own line and only the FINAL line ending
 *    in '.'. `splitSentences` (validate.ts) now treats '\n' as a sentence
 *    boundary too, which is what keeps each line's binding independent
 *    (MS1) — see that function's own comment.
 *
 * These two rows changed `body`'s BYTES for this shape, which is
 * `renderTemplateBody`'s R8 byte-identical re-derivation target
 * (reconstruct.ts) — `renderRegionSeriesLegacyPreLineFormat` below exists
 * SOLELY so a row stored before this change still reconstructs.
 *
 * With NO region carrying a record the body falls back to renderSeries' own
 * claim-free per-cell listing — the fail-closed floor of the R3 ladder, each
 * line naming its region, period and value, no trend word anywhere. */
function renderRegionSeries(result: ValidatedResult): string {
  const clauses = regionSeriesClauses(result);
  if (clauses.length === 0) return renderSeries(result);
  const lines = clauses.map((c) => `– ${regionSeriesClauseText(c.fullLabel, c)}`);
  return `${subjectSentenceStart(result)} per regio:\n${lines.join('\n')}.`;
}

/** The PRE-pass-4 shape of `renderRegionSeries`, byte-identical to how it
 * shipped at commit f923f31 (2026-09-17, ~13:50 UTC — the shape's own
 * go-live): base (unqualified) region labels, one sentence, clauses
 * separated by '; '. Never called from the live compose path — its only
 * caller is `checkAnswerReconstruction` (reconstruct.ts), for a
 * `region_series` row whose `createdAt` predates
 * `REGION_SERIES_LINE_FORMAT_CUTOFF` (that file's own comment explains why
 * this is a date-scoped tolerance rather than a known-divergences.ts
 * per-row-id entry). Kept here, next to the live renderer, rather than in
 * reconstruct.ts, so the two can never accidentally diverge on the shared
 * `regionSeriesClauses`/`regionSeriesClauseText` data path — only the label
 * form and the joiner differ. */
export function renderRegionSeriesLegacyPreLineFormat(result: ValidatedResult): string {
  const clauses = regionSeriesClauses(result);
  if (clauses.length === 0) return renderSeries(result);
  const text = clauses.map((c) => regionSeriesClauseText(c.baseLabel, c)).join('; ');
  return `${subjectSentenceStart(result)} per regio: ${text}.`;
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

/** #253 — one measure, one period, a whole region CLASS.
 *
 * RS1 is not implemented here as a word filter; it is implemented by the two
 * branches below keying on the RANKING DERIVATION's existence. `run.ts` routes
 * this shape through `deriveRegionRanking`, which refuses on an incomplete
 * class (src/query/derivations.ts) — so "no record" means "we could not
 * establish the ranking", and this renderer simply has nothing to phrase a
 * superlative from. R9 then backs the same rule from the other side: a ranking
 * word with no derivation behind it fails the validator closed.
 *
 * COMPLETE (a record exists) — a summary, never a list. The top and the bottom
 * member with their own verbatim cell values, in the ranking derivation's own
 * order (never re-sorted here). A class can carry up to REGION_SET_MAX_MEMBERS
 * cells; renderMax's spell-out-every-runner-up rendering is right for a
 * four-city comparison and unreadable at 342 gemeenten — and the chart is the
 * real reading for the full set (R6: the chart is a verbatim projection).
 *
 * INCOMPLETE (no record) — the per-member lines, claim-free, exactly as
 * renderComparison states them: with no ranking there is no honest summary to
 * give, so the answer states the data itself, including each withheld member's
 * own CBS reason (R11). The count is bounded by the same cap.
 *
 * The coverage itself (roster size, excluded members, and the fact that no
 * ranking is claimed) is disclosed by the STRUCTURAL line buildRegionSetLine
 * assembles, outside this scanned body — see format.ts for why its digits
 * could not legally live here. */
function renderRegionSet(result: ValidatedResult): string {
  // `scope` is present on every real region_set result (run.ts writes the
  // coverage record and the shape together); the fallback keeps this renderer
  // total for a hand-built result rather than throwing inside the fail-closed
  // floor of the R3 ladder.
  const scope = result.regionSet?.scope ?? null;
  const classNoun = (count: number): string =>
    scope === null ? (count === 1 ? 'regio' : "regio's") : regionSetBodyNoun(scope, count);
  const byId = new Map(result.cells.map((c) => [c.resultId, c]));
  const ranking = result.derivations.find((d) => d.kind === 'max');
  const winner = ranking?.kind === 'max' ? byId.get(ranking.winnerResultId) : undefined;
  const lowestId =
    ranking?.kind === 'max' ? ranking.rankingResultIds[ranking.rankingResultIds.length - 1] : undefined;
  const lowest = lowestId === undefined ? undefined : byId.get(lowestId);
  // The claim-free rendering is ALSO the fallback when a ranking record exists
  // but cannot be resolved against this result's own cells — a shape that
  // should not occur (a registered derivation's ids always come from the same
  // result), but this function is the fail-closed FLOOR of the R3 ladder: it
  // renders something honest or the pipeline has nothing left to serve. Same
  // defensive posture renderTrendHeadline already takes.
  if (winner?.value == null || lowest?.value == null) {
    const lines = result.cells.map((cell) => cellLine(cell)).join('; ');
    return `${subjectSentenceStart(result)} per ${classNoun(1)}: ${lines}.`;
  }
  const winnerName = winner.regionLabel ? baseRegionLabel(winner.regionLabel) : winner.periodLabel;
  const lowestName = lowest.regionLabel ? baseRegionLabel(lowest.regionLabel) : lowest.periodLabel;
  // The count is the number of members we SERVED (the distinct regions in the
  // cells), which is what validate.ts's structural region count matches. The
  // roster size is a different number and lives in the disclosure line.
  const served = new Set(result.cells.map((c) => c.regionCode)).size;
  return (
    `Van de ${served} ${classNoun(served)} had ${winnerName} in ${winner.periodLabel} de hoogste waarde voor ` +
    `${subject(result)}: ${displayValueUnit(winner.value, winner.decimals, winner.unit)}${provisionalSuffix(winner)}. ` +
    `${lowestName} had de laagste waarde: ${displayValueUnit(lowest.value, lowest.decimals, lowest.unit)}${provisionalSuffix(lowest)}.`
  );
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

/** #197 idea 4: a short, deterministic Dutch headline for a chart backed by
 * a `direction` derivation ("Bevolking steeg gestaag sinds 2015."). Template
 * only, no LLM — mirrors renderDifference/renderMax's own discipline.
 * `undefined` (not thrown) when the derivation's own firstResultId cannot be
 * resolved against the result's cells — a defensive guard for a shape that
 * should not occur (a registered derivation's source ids are always drawn
 * from the same result's own cells), matched by buildChartSpec choosing not
 * to set ChartAttribution.trendHeadline in that case (Task 2).
 *
 * Two more fail-closed guards (whole-branch review, #197 I1+I2):
 * - `undefined` when direction is 'flat' but NOT monotonic: a series that
 *   rose and fell back to its starting value nets to zero, but the FLAT verb
 *   ("bleef stabiel") claims a straight, unmoving line — false for that
 *   shape. There is no honest one-sentence phrasing for a
 *   net-zero-but-not-actually-flat series today, so the headline is
 *   suppressed entirely, the same fail-closed posture renderSeries already
 *   takes elsewhere in this file for trend claims it can't make safely.
 * - "gestaag" additionally requires >= 3 SOURCE points (derivation.
 *   sourceResultIds.length), not just monotonicity: a 2-point sequence has
 *   exactly one interval, so it is trivially "monotonic" and would otherwise
 *   always qualify for "gestaag" — the same class of hazard
 *   docs/open-questions.md #100 already tracks for `monotonic`'s reading in
 *   the LLM answer prompt, reopened here in this separate deterministic
 *   template. */
export function renderTrendHeadline(
  result: ValidatedResult,
  derivation: Extract<DerivationRecord, { kind: 'direction' }>,
): string | undefined {
  const byId = new Map(result.cells.map((c) => [c.resultId, c]));
  const first = byId.get(derivation.firstResultId);
  if (!first) return undefined;
  if (derivation.direction === 'flat' && !derivation.monotonic) return undefined;
  const verb = TREND_VERB_BY_DIRECTION[derivation.direction];
  const steadily =
    derivation.monotonic && derivation.direction !== 'flat' && derivation.sourceResultIds.length >= 3
      ? ' gestaag'
      : '';
  return `${subjectSentenceStart(result)} ${verb}${steadily} sinds ${first.periodLabel}.`;
}

/** Deterministic Dutch answer body for any ValidatedResult. */
export function renderTemplateBody(result: ValidatedResult): string {
  // #253: the region-class shape is decided FIRST, ahead of the explicit-max
  // branch. renderMax spells out every runner-up, which is right for a
  // four-city comparison and unreadable for a 342-gemeente class — and the
  // class has its own ranking record (deriveRegionRanking) that renderComparison
  // already honours only when coverage made one exist.
  if (result.shape === 'region_set') return renderRegionSet(result);
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
    case 'region_series':
      // ADR 055 / MS1: one clause per region that has its OWN direction
      // record; a region with a gap gets no clause (and no trend word), and
      // with no complete region at all the renderer falls back to
      // renderSeries' claim-free per-cell floor.
      return renderRegionSeries(result);
    // 'region_set' has already returned above — TypeScript narrows it out of
    // this switch, so adding a case here is a compile error, not an omission.
  }
}
