// #115 residual: how the dashboard presents an answer's "Definitie:" line.
//
// A curated Phase-0 definition is a short phrase and stays inline, exactly as
// before. An on-demand-onboarded measure carries CBS's full verbatim
// Description — a ~180-word paragraph that buries the actual answer when
// rendered inline (owner verdict, session 29). Long definitions therefore
// fold behind a "Meer over deze meting" expander, with one exception kept
// visible: the sentence stating the measurement SCALE (e.g. "De indicator
// kan een waarde aannemen van -100 ... tot +100 ..."), which the owner
// flagged as the part a reader needs to interpret the number at all.
//
// Principle (a) boundary: this module SELECTS which verbatim CBS sentences
// render where — it never rewords, abridges within a sentence, or generates
// text. A wrong pick shows a correctly-attributed CBS sentence in a slightly
// odd place, never a wrong claim. The full definition is always available
// behind the expander, byte-identical to the stored envelope field.

const DEFINITION_PREFIX = 'Definitie: ';

/** Longest "Definitie:" line that still renders inline in full. Every curated
 * Phase-0 definition label is far under this; a CBS Description paragraph is
 * far over — the threshold only decides presentation, never content. */
export const DEFINITION_INLINE_MAX_CHARS = 240;

/** A sentence that states the measure's value range: a range pattern
 * ("van -100 ... tot +100", "tussen 0 en 10") in a sentence that names a
 * value/scale concept. Both conditions together keep ordinary numeric
 * sentences (years, revision notes) out of the inline slot. */
const SCALE_RANGE = /(?:van|tussen)\s*[-−–]?\s*\d+[^.?!]*?(?:tot(?:\s+en\s+met)?|t\/m|en)\s*[-−–+±]?\s*\d+/i;
const SCALE_NOUN = /waarde|schaal|score/i;

/** Sentence boundaries, same rule as the validator's splitSentences (src/
 * answer/compose/validate.ts): terminal punctuation followed by whitespace or
 * end — dots inside '18.044.027' never split (no whitespace follows them). */
function sentencesOf(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  const re = /[.!?](?=\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const end = match.index + 1;
    const sentence = text.slice(start, end).trim();
    if (sentence.length > 0) sentences.push(sentence);
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail.length > 0) sentences.push(tail);
  return sentences;
}

export interface DefinitionDisplay {
  /** Rendered inline under the answer body: the whole line when short, the
   * verbatim scale sentence(s) of a folded long definition, or null when a
   * long definition has no recognizable scale sentence. */
  inline: string | null;
  /** Full definition text behind the "Meer over deze meting" expander;
   * null when the definition is short enough to stay fully inline. */
  folded: string | null;
}

export function splitDefinitionForDisplay(definitionLine: string): DefinitionDisplay {
  if (definitionLine.length <= DEFINITION_INLINE_MAX_CHARS) {
    return { inline: definitionLine, folded: null };
  }
  const text = definitionLine.startsWith(DEFINITION_PREFIX)
    ? definitionLine.slice(DEFINITION_PREFIX.length)
    : definitionLine;
  const scale = sentencesOf(text).filter((s) => SCALE_RANGE.test(s) && SCALE_NOUN.test(s));
  return { inline: scale.length > 0 ? scale.join(' ') : null, folded: text };
}
