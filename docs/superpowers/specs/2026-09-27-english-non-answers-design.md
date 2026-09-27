# English refusals and clarifications — deterministic templates (ADR 058 phase 2, #332)

**Status:** owner GO 2026-09-27 (session 135) on the plain-English summary: "write English versions of the
refusal and clarification texts in code, next to the Dutch ones; no AI call; the Dutch path unchanged; the
model's own reading stays Dutch inside an English sentence for now; chart texts after this."

## Problem

On the English interface a REFUSAL or CLARIFICATION shows an English header/badge (`chat.refusalHeader`) around
the Dutch body sentence (`web/components/chat.tsx` renders `message.text`), and its chips stay Dutch under an
English hint — because `attachEnglish` (`src/answer/translate/translate.ts`) only handles `kind === 'answer'`.

## Why templates, not the translation model

Every one of these texts is already built by code from a template (inventory: ~20 refusal builders in
`src/answer/respond/refusals.ts`, 5 product-info replies in `meta.ts`, the staleness refusal in `respond.ts`,
~15 clarification questions in `src/answer/intent/policy.ts`, chip labels in `suggestions.ts` / `rescue.ts`).
Cheapest-mechanism rule (CLAUDE.md) + owner ask #331: a hand-written English sibling per template costs nothing
per question, cannot misfire, and needs no meaning check. The ONE non-template ingredient is the intent model's
free-text `reading` ("Bedoel je {reading}?") and the user's own unmatched term — those stay verbatim (Dutch)
inside the English sentence, listed in `untranslated`.

## Invariants

- **The Dutch path is byte-identical.** No Dutch string changes; a Dutch-interface (or lang-less: benchmark,
  CLI, tests) envelope gains NO key. The benchmark and every existing stored audit row are untouched.
- The English is produced AT THE TEMPLATE SITE, from the same parameters as the Dutch (many parameters —
  definition label, period, region — exist only inside the Dutch string, so it cannot be rebuilt afterwards).
- No digit may appear in English text that the Dutch does not carry (periods only; `cardinalNl` → an English
  number word, never a digit).
- R8: the English rides the SAME audit row as a present-only envelope key, classified in the envelope-key
  manifest exactly like `offer`/`guidance` (deterministic, value-free template text).

## Design

### Shape

```ts
// src/answer/translate/types.ts (next to EnglishRendering)
export interface NonAnswerEnglish {
  source: 'template';
  /** The full English message, assembled exactly like the Dutch `text` (body, offer, guidance joined the same way). */
  text: string;
  /** Chips: English label shown, the Dutch original submitted (the same {label, submit} contract as answer chips). */
  chips: { label: string; submit: string }[];
  /** Dutch fragments kept verbatim inside `text` (model readings, the user's own term). Honest-by-construction list. */
  untranslated: string[];
}
RefusalResponse.english?: NonAnswerEnglish        // present ONLY when respond ran with lang === 'en'
ClarificationResponse.english?: NonAnswerEnglish  // same
```

### Production (always computed internally, attached only for English)

- `BuiltRefusal` gains a REQUIRED `en: { text: string; offer: string | null; guidance: string | null; untranslated: string[] }`
  — required so the compiler proves every builder has an English sibling.
- A clarification `ParseOutcome` (policy.ts) gains a present-only `question_en: string` (+ `options_en?: string[]`
  index-aligned with `options` when they are deterministic labels). The envelope STORES the parse WITHOUT these
  keys (strip at assembly) so Dutch rows are byte-identical.
- `RespondOptions.lang?: 'nl' | 'en'` threaded from `respond-audited.ts` (which already has `options.lang`).
  `toRefusalResponse` / `toClarificationResponse` attach `english` only when `lang === 'en'`.
- Chips: `buildRefusalSuggestions`, rescue/offer chips and clarification click-option labels produce an English
  label per Dutch label; the envelope's `english.chips` pairs them `{ label: en, submit: nl }`. A label that is a
  model reading keeps the Dutch text as its English label (and is listed in `untranslated`).

### English parameter helpers — `src/answer/respond/english.ts` (pure, DB-free)

- `periodCodeToEn(code)`: '2026MM06' → 'June 2026'; '2025KW04' → 'the fourth quarter of 2025'; '2024JJ00' → '2024';
  unparseable → verbatim (mirrors `periodCodeToNl`).
- `statusSuffixEn(status, sourceKey?)`: the English of the source's `provisionalDisplay` suffixes (reuse the
  English status wording the answer path already uses in `src/answer/translate/lines.ts` if present).
- `englishMeasureLabel(canonicalKey)`: a HAND-WRITTEN lowercase noun phrase per static canonical key
  (`src/answer/respond/english-measure-labels.ts`, e.g. `population_on_1_january` → 'the population on 1 January'),
  with a coverage test over `CANONICAL_MEASURES`; onboarded/unknown keys fall back to `translateMeasureTitle` of the
  registry `measureTitle`, else 'these figures'.
- `joinOfEn`, `cardinalEn` (number WORDS), `axesEn` (mirrors `AXIS_NL`), `loadedTopicsCompactEn`
  (from `englishMeasureLabel`), region labels via `translateRegion`, fixed option labels via a small map
  ('heel Nederland (landelijk cijfer)' → 'the Netherlands as a whole (national figure)', …).

### Web

`web/lib/chat-message.ts` carries `english` for refusal/clarification messages too (and `src/threads/replay.ts`);
`web/components/chat.tsx`: when the reader is on English and `message.english` is present, render
`message.english.text` instead of `message.text`, and `message.english.chips` (label shown, `submit` sent)
instead of `message.suggestions` — the same branch answer chips already use.

## Tasks

1. **Helpers + English measure labels** — `english.ts`, `english-measure-labels.ts`, unit tests (every static key
   covered, period/status/join/cardinal cases, no digits from `cardinalEn`).
2. **Refusal siblings** — `BuiltRefusal.en` on every builder in `refusals.ts`, English meta templates in `meta.ts`,
   the staleness refusal in `respond.ts`, `buildNeedsClarificationAsClarification` / still-ambiguous. Tests: one per
   RefusalReason asserting the English text and that the Dutch `text` is unchanged (existing tests stay green).
3. **Clarification siblings** — `question_en` (+ `options_en`) on every clarification outcome in `policy.ts`
   (and `buildUnmatchedClarification`, `echoUnservableClarification`, rule 3/4 confirms); strip before storing.
4. **Chips** — English labels for refusal retry chips, rescue/offer chips, clarification options.
5. **Envelope + lang threading + audit** — `english` present-only on both envelopes when `lang === 'en'`;
   `respond-audited` passes lang; envelope-key manifest rows (`ignored`, same argument as `offer`/`guidance`);
   reconstruct tolerates the key; tests: Dutch envelope byte-identical (deep-equal to a lang-less run), English
   envelope carries `english`.
6. **Web** — chat-message/replay carry `english`; chat.tsx renders it; web unit tests.
7. **Docs** — ADR 058 addendum (phase 2 as built), #332 row, STATUS, build plan.
