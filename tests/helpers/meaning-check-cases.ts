// #325 (spec §4): the labelled set for check C12. Every case is a masked
// Dutch/English pair that PASSES C1–C11 (the structural guard in
// tests/answer/translate/meaning-check-cases.test.ts enforces it — a case
// the free checks already reject measures nothing about C12).
//
// expected 'different' → a seeded meaning change; a "same" verdict is a
//                        MISSED REVERSAL (flag-flip blocker).
// expected 'same'      → a faithful translation; a "different" verdict is a
//                        FALSE ALARM (flag-flip blocker; it is also English
//                        fallback rate).
//
// Labels are product-policy judgments; changing one is a reviewed decision,
// never a way to green a run (ADR 012). Grow it from measured behaviour in
// the owner-supervised recording step.
import { readFileSync } from 'node:fs';
import type { TranslationItems } from '../../src/answer/translate/check.ts';
import type { GlossaryEntry } from '../../src/answer/translate/glossary.ts';
import type { MaskEntry } from '../../src/answer/translate/mask.ts';

export interface MeaningCheckCase {
  id: string;
  note: string;
  expected: 'same' | 'different';
  maskedDutch: TranslationItems;
  english: TranslationItems;
  glossary: GlossaryEntry[];
  maskTable: MaskEntry[];
}

const region = (name: string): GlossaryEntry => ({ dutch: name, english: name, kind: 'region', translated: false });
const REGIONS = [region('Utrecht'), region('Zeeland')];
const num = (id: string, dutch: string, english: string): MaskEntry => ({ placeholder: `⟦N${id}⟧`, kind: 'number', dutch, english });
const per = (id: string, dutch: string, english: string): MaskEntry => ({ placeholder: `⟦P${id}⟧`, kind: 'period', dutch, english });
const MASKS = [num('a', '3,9%', '3.9%'), num('b', '4,1%', '4.1%'), per('a', '2023', '2023'), per('b', '2024', '2024')];
const body = (text: string): TranslationItems => ({ body: text, chips: [], definition: null, alternates: [] });

function c(id: string, note: string, expected: 'same' | 'different', dutch: string, english: string, maskTable: MaskEntry[] = MASKS): MeaningCheckCase {
  return { id, note, expected, maskedDutch: body(dutch), english: body(english), glossary: REGIONS, maskTable };
}

export const MEANING_CHECK_CASES: MeaningCheckCase[] = [
  // --- must reject: #325's confirmed shapes and the spec §4 list ---
  c('D1-weakener', '#325 (1) a weakener the lists do not know', 'different',
    'In ⟦Pb⟧ steeg de werkloosheid naar ⟦Na⟧.', 'In ⟦Pb⟧ unemployment hardly rose, to ⟦Na⟧.'),
  c('D2-stopper', '#325 (1) a stopper', 'different',
    'In ⟦Pb⟧ steeg de werkloosheid naar ⟦Na⟧.', 'In ⟦Pb⟧ unemployment ceased to rise, at ⟦Na⟧.'),
  c('D3-intensifier-swap', '#325 (1) "nauwelijks" turned into "sharply"', 'different',
    'In ⟦Pb⟧ steeg de werkloosheid nauwelijks, naar ⟦Na⟧.', 'In ⟦Pb⟧ unemployment rose sharply, to ⟦Na⟧.'),
  c('D4-negation-moved', '#325 (2) negation moved between regions, equal negator counts', 'different',
    'De werkloosheid steeg in Utrecht, niet in Zeeland, naar ⟦Na⟧.', 'Unemployment rose not only in Utrecht but in Zeeland, to ⟦Na⟧.'),
  c('D5-noun-qualifier', '#325 (4) "niet groot" read as "no increase"', 'different',
    'De stijging was niet groot: de werkloosheid kwam in ⟦Pb⟧ uit op ⟦Na⟧.', 'There was no increase: unemployment came to ⟦Na⟧ in ⟦Pb⟧.'),
  c('D6-doubled-unit', '#325 (6) a unit after a unit-carrying placeholder, hyphen form', 'different',
    'In ⟦Pb⟧ lag de werkloosheid op ⟦Na⟧.', 'In ⟦Pb⟧ unemployment stood at a ⟦Na⟧-point level.'),
  c('D7-dropped-hedge', 'a hedge dropped', 'different',
    'In ⟦Pb⟧ lag de werkloosheid op ongeveer ⟦Na⟧.', 'In ⟦Pb⟧ unemployment stood at ⟦Na⟧.'),
  c('D8-added-cause', 'a cause the Dutch does not state', 'different',
    'In ⟦Pb⟧ lag de werkloosheid op ⟦Na⟧.', 'In ⟦Pb⟧ unemployment stood at ⟦Na⟧ because of the economic downturn.'),
  // C3 rejects the brief's verbatim wording ('soared' is not on the C3
  // direction-word list, so the English direction claim reads as empty
  // rather than 'up' — the failure is a vocabulary gap in C3, not the
  // intensifier this case exists to test). Reworded to keep a recognized
  // 'up' word ('rose') and add the unstated intensifier next to it.
  c('D9-intensifier-added', 'an intensifier added', 'different',
    'In ⟦Pb⟧ steeg de werkloosheid naar ⟦Na⟧.', 'In ⟦Pb⟧ unemployment rose sharply to ⟦Na⟧.'),
  // #325 (3): a reversal C10 does not attribute, masked by an unrelated
  // English negator that keeps C11's count equal. The comma splits 'steeg'
  // into its own clause with no negator before it, so BOTH C10's Dutch
  // negation-before/after scan and the English negation-before scan read the
  // rise as un-negated — 'not really' sits in a LATER clause, after the
  // direction word, and C10's English scan (unlike the Dutch side) only ever
  // looks BEFORE the match, so a negator placed after it is invisible to C10
  // however the clauses fall. C11 only counts total negator words per item
  // ('zonder'+'geen' = 2 in Dutch, 'not'+'without' = 2 in English), so the
  // parity check is satisfied even though 'not really' has quietly reversed
  // the claim and the caveat ('no comparison…' → 'matching…') has flipped too.
  c('D10-c10-blind-reversal', "#325 (3) a reversal C10 can't attribute, hidden behind an equal negator count", 'different',
    'In ⟦Pb⟧ steeg de werkloosheid naar ⟦Na⟧, zonder nadere toelichting en geen vergelijking met vorig jaar.',
    'In ⟦Pb⟧ unemployment rose to ⟦Na⟧, not really, without further explanation, matching last year.'),
  // #325 (5): region order swapped in a NUMBER-FREE sentence, safe only
  // because the Dutch/English SENTENCE COUNTS differ. The first sentence
  // (with both numbers) fixes Utrecht-before-Zeeland as the first mention on
  // both sides, so checkCompanionOrder (whole-item first mention) can't see
  // the later swap. checkRegionSentenceOrder's number-based grouping never
  // includes the second Dutch sentence at all (it carries no number
  // placeholder), and its positional per-sentence fallback only runs when
  // `dutchSentences.length === englishSentences.length` — splitting the
  // swapped English sentence in two (3 English sentences vs 2 Dutch) turns
  // that fallback off, so the swap in "the survey was held first in
  // Utrecht, then in Zeeland" (→ reversed order) is never compared at all.
  c('D11-region-order-no-numbers', '#325 (5) region order swapped in a number-free sentence, sentence counts differ', 'different',
    'In ⟦Pb⟧ steeg de werkloosheid in Utrecht naar ⟦Na⟧ en in Zeeland naar ⟦Nb⟧. De enquête werd eerst in Utrecht en daarna in Zeeland gehouden.',
    'In ⟦Pb⟧ unemployment in Utrecht rose to ⟦Na⟧ and in Zeeland rose to ⟦Nb⟧. The survey was held first in Zeeland. Then it was held in Utrecht.'),
  // A comparison with its sides swapped ('hoger in Utrecht dan in Zeeland' →
  // 'higher in Zeeland than in Utrecht'). C3 only tracks the comparative's
  // CLASS ('more'), never which side is higher, and C10 has no negation to
  // compare — neither check reads region attribution for a comparative at
  // all. The swap survives checkCompanionOrder (whole-item first mention)
  // for the same reason as D11: the first sentence's numbers already fix
  // Utrecht-before-Zeeland as the first mention on both sides. The trailing,
  // Dutch-less English sentence ('These figures are unadjusted.') makes the
  // sentence counts differ (2 Dutch vs 3 English), turning off
  // checkRegionSentenceOrder's positional fallback — without it, the swapped
  // comparative sentence (no number placeholder of its own) is never grouped
  // or compared by any C7 leg.
  c('D12-comparison-sides-swapped', 'a comparison with its sides swapped, sentence counts differ', 'different',
    'In ⟦Pb⟧ lag de werkloosheid in Utrecht op ⟦Na⟧ en in Zeeland op ⟦Nb⟧. De werkloosheid was hoger in Utrecht dan in Zeeland.',
    'In ⟦Pb⟧ unemployment in Utrecht stood at ⟦Na⟧ and in Zeeland at ⟦Nb⟧. It was higher in Zeeland than in Utrecht. These figures are unadjusted.'),
  // A statement moved to the other period: the Dutch attaches the causal
  // clause ('door een tijdelijke factor') to ⟦Pa⟧'s rise; the English
  // attaches the identical clause to ⟦Pb⟧'s fall instead. The clause carries
  // no placeholder and names no glossary region, so C1 (placeholder
  // multiset), C7/C8 (number/period/region order and binding) and C9
  // (quantity words) have nothing to check it against — none of C1–C11
  // track which numbered claim a free-text causal clause is attached to.
  c('D13-period-moved', '#325 shape: a causal statement moved from one period to the other', 'different',
    'In ⟦Pa⟧ steeg de werkloosheid naar ⟦Na⟧ door een tijdelijke factor; in ⟦Pb⟧ daalde ze weer naar ⟦Nb⟧.',
    'In ⟦Pa⟧ unemployment rose to ⟦Na⟧; in ⟦Pb⟧ it fell again to ⟦Nb⟧, due to a temporary factor.'),
  // --- must pass: faithful translations ---
  c('S1-plain-rise', 'plain rise', 'same',
    'In ⟦Pb⟧ steeg de werkloosheid naar ⟦Na⟧.', 'In ⟦Pb⟧ unemployment rose to ⟦Na⟧.'),
  c('S2-reordered', 'period moved after the number', 'same',
    'In ⟦Pb⟧ steeg de werkloosheid naar ⟦Na⟧.', 'Unemployment rose to ⟦Na⟧ in ⟦Pb⟧.'),
  c('S3-negated-fall', '#326 shape, translated correctly', 'same',
    'In ⟦Pb⟧ daalde de werkloosheid niet; ze lag op ⟦Na⟧.', 'In ⟦Pb⟧ unemployment did not fall; it stood at ⟦Na⟧.'),
  // C3 rejects the brief's verbatim wording ('bleef gelijk' — 'remained
  // equal' — is not on the Dutch FLAT_WORDS list, which needs 'gelijk
  // gebleven', 'onveranderd', etc.; a wording bug in the case, not a check
  // problem). Reworded to 'onveranderd' ('unchanged'), which both lists
  // recognize, keeping the same 'same' meaning.
  c('S4-unchanged', 'bleef onveranderd', 'same',
    'In ⟦Pb⟧ bleef de werkloosheid onveranderd op ⟦Na⟧.', 'In ⟦Pb⟧ unemployment remained unchanged at ⟦Na⟧.'),
  // dropped: C10 already rejects this shape. 'niet alleen X maar ook Y' puts
  // a 'niet' after the sentence's one direction word ('steeg'), and the C10
  // negation-after scan (check.ts's directionSequence with NL_NEGATION_AFTER)
  // has no notion of the 'niet alleen … maar ook' idiom — it reads the 'niet'
  // as negating the rise itself, while the English side (EN_NEGATION, tested
  // only BEFORE the direction word) sees no negation before 'rose'. No
  // rewording keeps 'niet alleen … maar ook' in the Dutch while clearing
  // C10, since any 'niet' anywhere in the clause containing the single
  // direction word trips the same rule regardless of word order.
  //
  // dropped: C8 already rejects this shape. Splitting a Dutch sentence whose
  // two numbers share companions (both periods, in the brief's wording) into
  // two English sentences always loses a companion: checkSentenceBinding
  // requires EVERY companion (period or region) mentioned anywhere in the
  // Dutch sentence to reappear in the specific English sentence holding each
  // number, so a genuine per-number split cannot pass without repeating every
  // companion verbatim in every resulting sentence — not a case wording bug,
  // but a real scope gap in how C8 reads multi-companion sentences.
  c('S7-hedge-kept', 'hedge kept', 'same',
    'In ⟦Pb⟧ lag de werkloosheid op ongeveer ⟦Na⟧.', 'In ⟦Pb⟧ unemployment stood at about ⟦Na⟧.'),
  c('S8-passive', 'voice changed', 'same',
    'In ⟦Pb⟧ werd een werkloosheid van ⟦Na⟧ gemeten.', 'In ⟦Pb⟧ an unemployment rate of ⟦Na⟧ was measured.'),
  // --- must pass: the benchmark's REAL recorded translations (spec §4) ---
  // Every task whose rendering verified in the last `npm run translate:record`
  // (written by scripts/translate-eval.ts; session 134: 13 of 14, B10 fell
  // back). Labelled 'same': they already passed C1–C12 once, so a later
  // "different" verdict on them is a false alarm — and English fallback rate.
  ...REAL_TRANSLATIONS().map(
    (r): MeaningCheckCase => ({ ...r, id: `R-${r.id}`, note: `real recorded translation, benchmark ${r.id}`, expected: 'same' }),
  ),
];

function REAL_TRANSLATIONS(): Omit<MeaningCheckCase, 'note' | 'expected'>[] {
  const path = new URL('../fixtures/meaning-check-real-translations.json', import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')) as Omit<MeaningCheckCase, 'note' | 'expected'>[];
}
