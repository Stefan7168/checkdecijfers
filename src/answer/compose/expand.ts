// #125a (ADR 031 D4): the deterministic post-validation display splice —
// the owner's "uitgerekend erbij" convention. A body that shows a pure
// factor-unit value ("390,2 x 1000", "8.204 (x 1 000)") gains the exact
// expanded figure alongside CBS's verbatim notation:
//
//   bare prose      390,2 x 1000        →  390,2 x 1000 (= 390.200)
//   template parens 8.204 (x 1 000)     →  8.204 (x 1 000 = 8.204.000)
//
// The expansion is NEVER computed here — it comes from the unit_expansion
// DerivationRecord runQuery pre-registered (R5), so the inserted token is
// backed the moment it exists. The LLM never sees the record (ADR 031 D3)
// and never writes the expansion; this splice is the single display site,
// shared by the LLM and template paths via compose.ts assemble().
//
// Every safety belt fails OPEN to today's display — a missed expansion is a
// missing nicety, a wrong insertion would be a display bug, so: don't.
import type { DerivationRecord, ValidatedResult } from '../../query/index.ts';
import { formatValueNl, normalizeForScan, unitMaskPhrases } from './format.ts';
import { scanBody, UNIT_SUFFIX, validateAnswerBody } from './validate.ts';

type UnitExpansionRecord = Extract<DerivationRecord, { kind: 'unit_expansion' }>;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One whitespace-tolerant pattern over every spelling of the unit phrase —
 * the same variants the validator masks and matches (unitMaskPhrases /
 * containsPhrase), longest first so 'x 1 000' wins over any shorter overlap. */
function unitPhrasePattern(unit: string): RegExp | null {
  const variants = unitMaskPhrases(unit);
  if (variants.length === 0) return null;
  const alternation = variants
    .sort((a, b) => b.length - a.length)
    .map((v) => v.split(/\s+/).map(escapeRegExp).join('[\\s\\u00a0]+'))
    .join('|');
  return new RegExp(alternation, 'gi');
}

interface Insertion {
  /** Insert `text` at this index of the original body. */
  index: number;
  text: string;
}

/** Splice the registered unit expansions into a settled answer body.
 *
 * Anchoring reuses the validator's own machinery: scanBody locates each
 * cell-backed numeric token, and the unit phrase must START within the same
 * UNIT_SUFFIX window after the token where the validator proved the verbatim
 * factor string sits (R10) — so the splice only ever fires where an R10-valid
 * factor unit already stands. One insertion per phrase occurrence, claimed by
 * the nearest preceding token (anchors are visited right-to-left).
 *
 * Fail-open belts: no expansion records → untouched; a body that is not its
 * own scan-normal form → untouched (token indices would not be trustworthy);
 * no anchor or no phrase found → untouched; a phrase with ANOTHER numeric
 * token between the anchor and itself is never claimed (it visually belongs
 * to that nearer number — the misattribution belt, design review 2026-07-11);
 * an expansion whose figure the body already shows is not inserted again
 * (the double-render belt, same review); and the spliced body is
 * RE-VALIDATED against the result — any problem discards the whole splice. */
export function applyUnitExpansions(body: string, result: ValidatedResult): string {
  const recordByCell = new Map<string, UnitExpansionRecord>();
  for (const d of result.derivations) {
    if (d.kind === 'unit_expansion') {
      for (const id of d.sourceResultIds) recordByCell.set(id, d);
    }
  }
  if (recordByCell.size === 0) return body;
  if (normalizeForScan(body) !== body) return body;

  // Cell-backed tokens whose cell carries an expansion record, rightmost
  // first — the nearest preceding token claims a shared phrase occurrence.
  const tokens = scanBody(body, result);
  const anchors = tokens
    .filter((t) => t.kind === 'cell')
    .map((t) => {
      const cell = t.cells.find((c) => recordByCell.has(c.resultId));
      return cell === undefined ? null : { token: t, unit: cell.unit, record: recordByCell.get(cell.resultId)! };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null)
    .sort((a, b) => b.token.index - a.token.index);

  const claimed = new Set<number>();
  const insertions: Insertion[] = [];
  for (const anchor of anchors) {
    const expanded = formatValueNl(anchor.record.value, 0);
    // Double-render belt: if the body already shows the expanded figure as a
    // token (a model that computed it anyway — backed by the record, so the
    // validator rightly accepts it), adding it again would only garble.
    if (tokens.some((t) => t.token === expanded)) continue;
    const pattern = unitPhrasePattern(anchor.unit);
    if (pattern === null) continue;
    const tokenEnd = anchor.token.index + anchor.token.token.length;
    pattern.lastIndex = tokenEnd;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      if (match.index > tokenEnd + UNIT_SUFFIX) break; // outside the R10 window
      // Misattribution belt: another numeric token between the anchor and the
      // phrase means the phrase visually belongs to THAT number ("5,2 en
      // 16,155 x 1 000" — the factor is 16,155's, not 5,2's). R10's shared
      // suffix window tolerates the distance; the splice must not.
      if (tokens.some((t) => t.index >= tokenEnd && t.index < match!.index)) break;
      if (!claimed.has(match.index)) {
        claimed.add(match.index);
        const phraseEnd = match.index + match[0].length;
        insertions.push(
          body[phraseEnd] === ')'
            ? { index: phraseEnd, text: ` = ${expanded}` } // 8.204 (x 1 000 = 8.204.000)
            : { index: phraseEnd, text: ` (= ${expanded})` }, // 390,2 x 1000 (= 390.200)
        );
        break;
      }
    }
  }
  if (insertions.length === 0) return body;

  let spliced = body;
  for (const { index, text } of insertions.sort((a, b) => b.index - a.index)) {
    spliced = spliced.slice(0, index) + text + spliced.slice(index);
  }

  // The last belt: the spliced body must still pass the full validator
  // against the same result — any problem (a collision, a broken binding)
  // discards the splice entirely.
  return validateAnswerBody(spliced, result).ok ? spliced : body;
}
