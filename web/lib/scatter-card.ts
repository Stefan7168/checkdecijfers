// #296 part 2 Task 7: a scatter answer's card text, per language — the ONE
// builder the chat card, the docked card, Copy and the public embed page all
// read, so the four can never disagree about what a scatter answer says.
//
// Pure leaf (no React). Dutch = the STORED structural fields verbatim (R8:
// they re-derive byte-identically from the two stored legs at audit time),
// with one display-only touch: each definition line is named by its MEASURE
// ("Definitie gemiddeld inkomen: …"), since a scatter shows two definitions
// and the stored "Definitie: …" doesn't say which is which (Task 4
// carry-over). By measure, not by axis (Task 7 fix M2): "swap axes" would
// make an axis label wrong; a measure name stays right.
// English = derived at render time from the spec (spec D7 — a scatter answer
// stores no English): the English body/coverage/definition builders
// (scatter-text-en.ts) and the shared staleness translator taught the
// named-table subject — never a Dutch sentence on the English card.
import type { AnswerResponse } from '../backend/answer/respond/types.ts';
import type { ScatterSpec } from '../backend/chart/scatter.ts';
import { lowerFirst } from '../backend/chart/scatter-text.ts';
import { translateAttributionLine } from './i18n/cbs-words.ts';
import type { Lang } from './i18n/messages.ts';
import {
  scatterBodyEn,
  scatterDefinitionLineEn,
  scatterLineEn,
  scatterStalenessLinesEn,
} from './scatter-text-en.ts';

export interface ScatterCardText {
  /** The body as the reader sees it (ScatterView shows the same string). */
  body: string;
  /** The coverage line as the reader sees it; null only on an envelope that
   * lacks the stored key (a scatter answer always carries it). */
  line: string | null;
  /** The asked-about measure (y) first; a measure without a definition has
   * no line. ScatterView's `extraLines`. */
  definitionLines: string[];
  /** One per stale table, in stored order (y first). ScatterView's
   * `warningLines` — shown in the warning style under the coverage line,
   * never through `extraLines` (Task 7 fix I1). */
  stalenessLines: string[];
  /** Both axes' R4 attribution sentences, y first; one when both axes share
   * the identical sentence (ScatterView's own rule). */
  attributionLines: string[];
}

/** "Definitie: X." → "Definitie gemiddeld inkomen: X." — display-only (the
 * stored text is unchanged); a line in any other shape is shown as stored
 * rather than rewritten on a guess. */
function nameDefinitionNl(line: string | null | undefined, measureTitle: string): string | null {
  if (line === null || line === undefined || line === '') return null;
  const prefix = 'Definitie: ';
  if (!line.startsWith(prefix)) return line;
  return `Definitie ${lowerFirst(measureTitle)}: ${line.slice(prefix.length)}`;
}

/** What the card text is built from: the stored structural fields of a
 * scatter answer, wherever they are held (the envelope live and on replay,
 * or a ChatMessage's AnswerView). */
export interface ScatterCardSource {
  scatter: ScatterSpec;
  body: string;
  scatterLine?: string | null;
  definitionLine?: string | null;
  pairedDefinitionLine?: string | null;
  stalenessWarning?: string | null;
}

/** The source fields of a scatter answer envelope (`response.scatter` must be
 * present — callers branch on it first). */
export function scatterCardSourceOf(response: AnswerResponse): ScatterCardSource {
  return {
    scatter: response.scatter!,
    body: response.answer.body,
    scatterLine: response.answer.scatterLine,
    definitionLine: response.answer.definitionLine,
    pairedDefinitionLine: response.answer.pairedDefinitionLine,
    stalenessWarning: response.stalenessWarning,
  };
}

/** The card text of a scatter answer, in the reader's language. */
export function scatterCardText(source: ScatterCardSource, lang: Lang): ScatterCardText {
  const spec = source.scatter;
  const warning = source.stalenessWarning ?? null;
  const storedLine = source.scatterLine ?? null;
  const attributions = [...new Set([spec.y.attributionLine, spec.x.attributionLine])];
  if (lang === 'en') {
    const definitionLines = (['y', 'x'] as const)
      .map((side) => scatterDefinitionLineEn(spec, side))
      .filter((line): line is string => line !== null);
    const stalenessLines = scatterStalenessLinesEn(spec, warning);
    return {
      body: scatterBodyEn(spec),
      line: storedLine === null ? null : scatterLineEn(spec),
      definitionLines,
      stalenessLines,
      attributionLines: attributions.map(translateAttributionLine),
    };
  }
  const definitionLines = [
    nameDefinitionNl(source.definitionLine, spec.y.measureTitle),
    nameDefinitionNl(source.pairedDefinitionLine, spec.x.measureTitle),
  ].filter((line): line is string => line !== null);
  const stalenessLines = warning === null ? [] : warning.split('\n').filter((line) => line.trim() !== '');
  return {
    body: source.body,
    line: storedLine,
    definitionLines,
    stalenessLines,
    attributionLines: attributions,
  };
}

/** A scatter answer's SECOND R4 attribution sentence (the horizontal axis's
 * table) for the card/Copy — null when it is the identical sentence (both
 * axes from one table and period), shown once like ScatterView does. */
export function pairedAttributionOf(spec: ScatterSpec): string | null {
  return spec.x.attributionLine === spec.y.attributionLine ? null : spec.x.attributionLine;
}
