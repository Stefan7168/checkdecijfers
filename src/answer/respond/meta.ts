// WP18 (F3): deterministic meta-question templates. The 2026-07-05 validation
// pass found that genuinely meta questions about the product itself — "welke
// bronnen gebruik je?", "hoe ga je om met ontbrekende waarden?" — got the same
// blunt two-sentence smalltalk deflection as "hallo". This module routes those
// questions, AFTER the LLM has already classified them into the
// smalltalk_or_other bucket, to dedicated product-behaviour templates that
// answer truthfully instead of deflecting.
//
// Two structural properties carry the safety argument (ADR 022):
// 1. The router runs POST-classification only: buildSmalltalkRefusal consults
//    it, and nothing else does. A data question can never reach these
//    patterns — the intent parser already filtered it into data_query — so a
//    misroute here can only ever swap one true product statement for another.
// 2. Bodies are static Dutch strings (plus the registry topic list, a
//    structured source the belt tests whitelist). No LLM, no cell values,
//    no free interpolation: a fabricated number is structurally impossible.
//
// The table is EXPORTED, examples included, so the test suite sweeps every
// template structurally (routing + order-honesty + body-binding + content
// pins + no-numbers belt) — adding a template without examples, or one whose
// examples an earlier template shadows, fails tests by construction rather
// than escaping them (the session-16 review lesson: a belt that enumerates by
// hand goes stale).
import { normalizeForScan } from '../compose/format.ts';

export type MetaTemplateKey =
  | 'sources'
  | 'missing_values'
  | 'freshness'
  | 'reliability'
  | 'capabilities';

/** What a body builder may cite — structured, registry-derived values only.
 * Kept as an explicit context object (not imports from refusals.ts) so this
 * module stays dependency-free and the whitelist for the belt tests can be
 * built from exactly these fields. */
export interface MetaBodyContext {
  /** loadedTopicsCompact() — first everyday term of every canonical measure. */
  topicsCompact: string;
}

export interface MetaTemplate {
  key: MetaTemplateKey;
  /** Matched against the normalized question (NFKC, zero-width stripped,
   * lowercased); a template matches when ANY pattern matches. No /g flags —
   * a stateful lastIndex would make matching order-dependent. */
  patterns: RegExp[];
  /** Real phrasings this template must catch — verbatim validation-pass
   * questions where one exists, plus DUAL-CUE phrasings that also touch a
   * later template's cues (they pin the priority decision: the order-honesty
   * test proves the intended winner wins). The test suite drives routing,
   * order-honesty, content pins and the belt sweep off these, so every
   * template ships with its own regression cases. */
  examples: string[];
  buildBody(ctx: MetaBodyContext): string;
}

/** Ordered, first-match-wins. Priority is a reviewed decision (ADR 022 §6,
 * adversarial-review finding 2026-07-04): a compound question touching TWO
 * templates' cues gets the one whose answer addresses the more safety-
 * relevant half. Concretely: reliability ("verzin je dit?") outranks
 * sources/freshness — "Is de bron wel betrouwbaar of verzin je die?" must get
 * the fabrication answer, not a generic sources explanation, because
 * deflecting a do-you-make-this-up question with an answer that ignores it is
 * misleading by omission. missing_values goes first (its cues are the most
 * specific); the broad capabilities cues (wat kun je / help) go last. */
export const META_TEMPLATES: readonly MetaTemplate[] = [
  {
    key: 'missing_values',
    patterns: [
      /ontbre{1,2}k/, // ontbreekt (double e) én ontbrekende (single e) — Dutch stem alternation
      /missende\s+(waarden?|cijfers?|gegevens|data)\b/,
      /gaten\s+in\s+(de\s+)?(data|cijfers|reeks)/,
    ],
    examples: [
      'Hoe ga je om met ontbrekende waarden?', // V37 verbatim
      'Wat doe je als er een cijfer ontbreekt?',
    ],
    buildBody: () =>
      'Als een cijfer ontbreekt of nog niet is gepubliceerd, zeg ik dat eerlijk — inclusief de reden die CBS zelf opgeeft, ' +
      'bijvoorbeeld dat het vertrouwelijk is of nog niet beschikbaar. ' +
      'Ik vul nooit zelf een schatting in: liever geen antwoord dan een onbetrouwbaar antwoord.',
  },
  {
    key: 'reliability',
    // Public-claim rule (CLAUDE.md): the claim is "elk cijfer herleidbaar
    // naar een officiële CBS-cel, met bron en peildatum" — never an absolute
    // slogan. The body below is that claim, verbatim in spirit.
    patterns: [
      /betrouwbaar|nauwkeurig|accuraat/,
      /verzin|hallucin/,
      /\bklopt\b|\bkloppen\b/,
      /\bfout(en)?\b/,
      /vertrouw|gecontroleerd\b|controleer/,
    ],
    examples: [
      'Hoe betrouwbaar zijn je antwoorden?',
      'Verzin je weleens cijfers?',
      // Dual-cue pin (review finding 2026-07-04): mentions 'bron' too, but
      // the fabrication half is the one that must be answered.
      'Is de bron die je gebruikt wel betrouwbaar of verzin je die?',
    ],
    buildBody: () =>
      'Elk cijfer dat ik noem is herleidbaar naar een cel in een officiële CBS-tabel, met bron en peildatum erbij. ' +
      'De berekeningen worden gedaan door vaste programmacode, niet door een taalmodel — het taalmodel formuleert alleen ' +
      'de uitleg, en elke formulering wordt gecontroleerd voordat je die ziet. ' +
      'Kan ik iets niet onderbouwen, dan zeg ik dat liever eerlijk dan dat ik gok.',
  },
  {
    key: 'freshness',
    patterns: [
      /bijgewerkt|ververst|geactualiseerd|[uü]pdat/, // bijgewerkt, update(n), geüpdatet (ü is NOT NFKC-folded to u — review finding 2026-07-04)
      /\bactue(el|le)\b/,
      /gesynchroniseerd|peildatum/,
      /hoe\s+recent\b/,
    ],
    examples: [
      'Wanneer zijn deze cijfers voor het laatst bijgewerkt?', // V36 verbatim
      'Hoe actueel zijn je cijfers?',
      'Wanneer is dit geüpdatet?', // pins the ü-diaeresis fix
      // Dual-cue pin: 'bronnen' present, but actuality is what is asked.
      'Zijn je bronnen actueel?',
    ],
    buildBody: () =>
      'Bij elk antwoord staat een peildatum: de datum waarop wij de CBS-tabel voor het laatst hebben gesynchroniseerd, ' +
      'plus de periode waarover het cijfer gaat. Zo zie je per antwoord precies hoe actueel het is; ' +
      'is een cijfer voorlopig, dan staat dat erbij.',
  },
  {
    key: 'sources',
    patterns: [
      /\bbron(nen)?\b/,
      /\bstatline\b/,
      /(uit\s+)?welke\s+(cbs-?)?tabel(len)?\b/,
      /waar\s+(komen|komt|haal|haalt)\b.*\b(cijfers?|data|gegevens)\b/,
      /\bvandaan\b/,
    ],
    examples: [
      'Welke bronnen gebruik je naast CBS voor deze vraag?', // V38 verbatim
      'Uit welke CBS-tabel komt deze grafiek precies?', // V35 verbatim
      'Waar komen je cijfers vandaan?',
      // Dual-cue pin: capabilities cues (kun/welke) present, but the sources
      // half is what is asked — sources must outrank capabilities.
      'Kun je vertellen welke bronnen je gebruikt?',
    ],
    buildBody: () =>
      'Al mijn cijfers komen rechtstreeks uit officiële tabellen van CBS StatLine — andere bronnen gebruik ik niet. ' +
      'Die tabellen laden we vooraf in onze eigen database, en bij elk antwoord staat uit welke CBS-tabel het cijfer komt ' +
      'en wanneer wij die tabel voor het laatst met CBS hebben gesynchroniseerd.',
  },
  {
    key: 'capabilities',
    // Broadest cues — deliberately last.
    patterns: [
      /\b(wat|welke|waarover|waarnaar)\b.*\b(kan|kun|kunt)\b/,
      /\b(kan|kun|kunt)\b.*\b(wat|welke)\b/,
      /welke\s+(onderwerpen|vragen|thema'?s|cijfers)\b/,
      /\bhelp(en)?\b|\bhulp\b/,
      /wat\s+doe\s+je\b|wat\s+is\s+dit\b|hoe\s+werkt\s+(dit|het)\b/,
    ],
    examples: [
      'Hallo! Wat kun je allemaal?', // the s-hallo labelled case verbatim
      'Laat maar, vertel liever wat dit systeem allemaal kan.', // the c-b15-smalltalk-abandon reply verbatim
      'Welke onderwerpen ken je?',
    ],
    buildBody: (ctx) =>
      `Ik beantwoord vragen over officiële CBS-cijfers, met bron en peildatum bij elk antwoord. Op dit moment kan ik je helpen met cijfers over: ${ctx.topicsCompact}.`,
  },
];

/** The belt's own normalizer (NFKC + zero-width strip — session-16 lesson:
 * U+FEFF-decorated input must not behave byte-differently), plus lowercase
 * for pattern matching. Reusing normalizeForScan keeps this module's
 * normalization provably identical to the scanner's. */
export function normalizeMetaQuestion(question: string): string {
  return normalizeForScan(question).toLowerCase();
}

/** First template (in table order) with any matching pattern, or null —
 * null means the caller keeps the generic smalltalk template. */
export function matchMetaTemplate(question: string): MetaTemplate | null {
  const normalized = normalizeMetaQuestion(question);
  for (const template of META_TEMPLATES) {
    if (template.patterns.some((p) => p.test(normalized))) return template;
  }
  return null;
}
