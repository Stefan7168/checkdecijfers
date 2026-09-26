# English answers for English readers — design (phase 1: regular answers)

*Session 131, 2026-09-25. Owner decision: [open-questions #271](../../open-questions.md) option (c) — fully translate
answers for a reader on the English interface, official CBS names included. Approach chosen by the owner in chat:
"translate the checked answer". Decision record: ADR [058](../../decisions/058-english-answers.md).*

## 1. Goal and non-goals

**Goal.** A reader with the interface set to English gets the answer to a CBS question in English — the body,
the structural lines under it (definition, assumption, region-set/series, alternates, provisional marking,
attribution), the staleness warning and the follow-up chips — with every number still traceable to the same
database cell, and the Dutch site byte-for-byte unchanged.

**Phasing (owner-approved in chat).**

| Phase | Covers | This spec |
|---|---|---|
| 1 | `kind: 'answer'` responses: body, structural lines, staleness warning, follow-up chips | **yes** |
| 2 | Refusals and clarifications (~150 fixed Dutch sentences in `src/answer/respond/`) — hand-written English | no, own spec |
| 3 | Chart texts: model-phrased headline + insight cards (`src/chart/insights-phrase.ts`), chart titles/axes | no, own spec |

Until a phase ships, what it covers stays Dutch for every reader. An English reader never sees a half-checked
translation.

**Non-goals.** No English intent-parsing prompt (the parser already reads what the reader typed; its behaviour
on English questions is measured after the API cap lifts, not changed here). No change to the Dutch prompts,
validators, fixtures, benchmark, or the `final_text` column. No schema migration. No change to credit prices.

## 2. The invariant this design must keep

Principle (a) and R1/R3: every number shown traces to a validated result cell or registered derivation. The
translation step is a new text producer, so it gets the same treatment slot phrasing (#162) gave the phrasing
model: **numbers are made unrepresentable to it.** The translator never sees a digit; it sees placeholders,
and deterministic code puts the numbers back. A fabricated or altered number is then not something a check
has to catch — it cannot be written.

## 3. Architecture

A new sub-module `src/answer/translate/` (inside the existing `answer/` boundary, ADR 001), called only when
the reader's language is English AND `ENGLISH_ANSWERS_ENABLED=1`.

```
Dutch pipeline (unchanged) ──► validated Dutch AnswerResponse
                                      │  lang === 'en' && flag on
                                      ▼
                     translate/  mask → model → check → fill
                                      │
                      response.english = EnglishRendering   (verified | fallback)
                                      ▼
                      audit write (R8, same row, same jsonb) ──► web renders english when verified
```

### 3.1 How the reader's language reaches the backend

`web/app/actions.ts` `askQuestion` / `replyToClarification` read `getLang()` (`web/lib/i18n/server.ts`, the
existing cookie → Accept-Language → Dutch chain) and pass `lang` in the options bag of
`answerQuestionAudited`. The backend option defaults to `'nl'`. With `lang` absent or `'nl'`, or the flag off,
no translate code runs and the response object is identical to today's (pinned by test, §7).

### 3.2 Masking (deterministic)

Input: the final Dutch body (after the unit-expansion splice) and each Dutch chip text.

1. **Period labels** of the result's cells (e.g. `2023`, `2023 1e kwartaal`, `januari 2024`) are replaced by
   `⟦P1⟧, ⟦P2⟧ …` — longest first, exact match. Their English forms come from the name list (§3.5).
2. **Every remaining numeric token**, found with the existing `findNumericTokens` scanner, is replaced by
   `⟦1⟧, ⟦2⟧ …`, including unit notations such as `x 1 000`. *(Final whole-branch review, ruling 17a:) a unit or
   scale word directly after the token — `%`, procent, procentpunt(en), mln, mld, miljoen, miljard, or one of the
   result's registered units with an English form (`translateUnit`) — is masked WITH it as one placeholder, filled
   with fixed English (`%`, `percentage point(s)`, `million`, `billion`, the unit's English), so the model can
   never swap a unit.*
3. After masking, the text must contain **no digit** at all; if it does, the scanner missed a token → fallback
   (never send a digit to the model).

The mask table (placeholder → Dutch token → English rendering) is kept for filling and stored for audit.

### 3.3 Translation (the only model call)

*(Final whole-branch review, ruling 19:) the whole step — both attempts — is capped at 20 s
(`TRANSLATE_TIMEOUT_MS`); on expiry the answer falls back to Dutch with attempt error `timeout`.*

One request per English answer: the masked body plus the masked chip texts as a JSON array, a glossary of the
official names present in this answer (Dutch → English, §3.5), and a short English system prompt
(`src/answer/translate/prompt.ts`, `TRANSLATE_PROMPT_VERSION = 1`). Model: the existing phrasing model constant
(`PHRASING_MODEL`), temperature 0, JSON-schema output `{ body: string, chips: string[] }`. Goes through the
existing `LlmClient` (real / replay / recording), so CI replays hermetic fixtures under
`tests/fixtures/llm/translate/`.

### 3.4 Checks (deterministic, blocking)

*C7/C8 added during the build (session 131, SDD ruling 6): C1 compares placeholder sets, so a swap of two
numbers would otherwise pass every check. C9/C10, the ordered C3, the period/region legs of C7, word-boundary
name matching and `\p{N}` in C2 added by the final whole-branch review (rulings 17–18, fold-in 4); C11 and the
later C7/C9/C10 refinements by the residual rounds (rulings 22–24).*

Run on the model output **before** filling. Any failure → one retry with the problems appended (the same
retry shape the phrasing rung uses), then fallback.

| # | Check | Catches |
|---|---|---|
| C1 | Placeholder multiset per item equals the mask table's (each exactly once, none invented, none dropped; order may change) | dropped / duplicated / invented numbers |
| C2 | No numeral character (`\p{N}`: digits, '½', '²', 'Ⅻ' …) anywhere in the output outside placeholders | a number written out of thin air |
| C3 | Direction claims equal as an ORDERED sequence: per sentence and clause, in text order (consecutive duplicates collapsed), the Dutch body's rise / fall / flat / more / less claims (the validator's existing Dutch word lists) must match the English body's (a small English list: rose/increased/grew …, fell/decreased/declined/dropped …, unchanged/stable/flat …) | "fell" translated as "rose"; two regions' directions traded |
| C4 | Caveats kept: each provisional/estimate marker in the Dutch body has its English counterpart in the English body | a dropped "provisional" |
| C5 | Glossary respected: for every glossary name the Dutch item mentions (on Unicode word boundaries, case-insensitive — not the validator's substring `mentions`, under which 'Ede' matched 'exceeded'), the English item contains the English form | an improvised measure name ("average" for "median") |
| C6 | Chip count equal to the input chip count, each chip non-empty | a lost chip |
| C7 | Per item: number placeholders keep their relative order; period placeholders keep theirs; region names keep the order of their first mentions; and per aligned sentence (a Dutch sentence + the English sentence(s) holding its numbers, and — when both items have the same sentence count — additionally every sentence by position) the ordered sequence of ALL region mentions matches (a period or region may move past a number — only the order within a kind is pinned) | two numbers, periods or regions swapped, even within one sentence or in a later one |
| C8 | Sentence binding: each number placeholder's Dutch-sentence companions (period placeholders, region names) appear in the English sentence that holds it | a number re-attached to another period or region |
| C9 | Quantity words: an English number word ('one' needs 'één', not the article 'een'), fraction/multiple (half, a third…a tenth, twice, double, -fold …), decade/century, or percent word (percent, '%', percentage point) outside placeholders needs its Dutch counterpart in the masked Dutch item (small explicit map; 'percent' is never satisfied by 'procentpunt'); and no unit/scale word right after a placeholder that already carries its unit | "roughly double", "ten years before", "the highest in a decade", "⟦Na⟧ points" |
| C10 | Negation: each direction claim's negation must match. Dutch: zonder/geen/niet/nooit/nergens/noch/geenszins/evenmin earlier in the clause (the validator's rule plus those words), or niet/geen/nooit/nergens/noch/geenszins/evenmin AFTER the direction word up to the clause end or the next direction word in the clause. A conjunction does not stop that scan, except: a negation between a conjunction and the NEXT direction word belongs to that next word; and with no next direction word, 'en'/'maar'/'of' opening a new clause (er, dat, het, dit, zo, de, een, is/was/zijn/heeft…, or a period placeholder not directly after the conjunction, within three words) ends it. A negation after a trend NOUN ('De stijging was niet groot') qualifies the noun. English: not/no/never/without/cannot/neither/nor/nowhere/n't earlier in the clause | "niet gedaald" / "daalde in Utrecht en Zeeland niet" / "is nooit gedaald" → "has fallen" / "fell …" |
| C11 | Negation parity (structural backstop): per item, the count of negator words is equal — Dutch niet, geen, nooit, nergens, noch, geenszins, evenmin, zonder, niets, niemand; English not, n't, no, never, neither, nor, nowhere, without, nothing, nobody, none ('no longer' once) | an added "did not" or a dropped "geen", in any sentence shape |

Then **fill**: `⟦n⟧` → the Dutch token converted to English number format by a pure function
(`17.942.942` → `17,942,942`, `3,5` → `3.5`, `x 1 000` → `x 1,000`), `⟦Pn⟧` → the English period label. The
converter parses with the existing `parseNlNumber` and re-formats with the token's own decimal count, so the
value is provably the same number (a round-trip test over every token shape the scanner accepts).

### 3.5 The official-name list

A committed, reviewable file `src/registry/english-names.ts` (registry module — names are registry
metadata), keyed by `tableId` → { table title, measure labels by measure key, dimension-member labels by key,
period labels by period code }.

- **Where CBS publishes an English version of the table under the same number** (probed 2026-09-25: 12 of the
  17 registered CBS tables answer `…ENG/TableInfos` with 200 — 82242, 82610, 83625, 83693, 85429, 85770,
  85773, 85792, 85828, 85880, 85937, 86141), the names are CBS's own English labels, pulled by a one-off
  script `scripts/english-names-fetch.ts` (ingestion-side, never the request path — principle (b)) and matched
  **by key**, never by position. A label whose key does not match exactly is not guessed; it goes to the
  curated list.
- **Tables without a same-number English version** (03759, 82235, 83932, 85224; 80590 timed out on the probe
  and is re-checked by the script) and any unmatched key get **curated English names**, written against the
  CBS definition text and marked `curated: true` so a reader of the file can see which are CBS's own words.
- **Eurostat** answers are switched off in chat today (E2a, `EUROSTAT_SIBLINGS_ENABLED`); their names are
  added to the list when that source is switched on, not in this phase.
- A name with no English entry is shown in Dutch (correct, just untranslated) and listed in the rendering's
  `untranslatedNames` — a missing translation is never a reason to guess, and never a reason to drop the
  whole answer.

**Assumption:** CBS's same-number ENG tables use the same measure/dimension keys as the NED tables, or a key
mapping the script can prove. The script verifies this per table and refuses to write a mapping it cannot
prove (mirrored in open-questions #271).

### 3.6 English structural lines (hand-written, no model)

English siblings of the Dutch line builders in `src/answer/compose/format.ts` — `buildDefinitionLine`,
`buildAssumptionLine`, `buildRegionSetLine`, `buildRegionSeriesLine`, `buildAlternatesLine`,
`buildAttributionLine`, the provisional marking line and the staleness warning — in
`src/answer/translate/lines.ts`, fed from the same `ValidatedResult`, formatting numbers with the English
formatter and names from the name list. The Dutch builders are not touched. The full English text is
assembled in the same order `compose.ts assemble()` uses.

### 3.7 The record — `EnglishRendering` inside the existing response

```ts
interface EnglishRendering {
  schemaVersion: 1;
  status: 'verified' | 'fallback';
  promptVersion: number;            // TRANSLATE_PROMPT_VERSION
  model: string | null;
  maskedDutch: { body: string; chips: string[] };
  maskTable: { placeholder: string; dutch: string; english: string }[];
  rawTranslation: { body: string; chips: string[] } | null;   // model output, pre-fill
  attempts: { ok: boolean; problems: string[]; error: string | null }[];
  body: string | null;              // filled English body
  lines: Record<string, string | null>;   // English structural lines
  text: string | null;              // the full English message shown
  chips: { label: string; submit: string }[];  // label English, submit = the original Dutch chip text
  untranslatedNames: string[];
}
```

Stored as `response.english` in the existing `audit_answers.response` jsonb — **no migration**
(cheapest-mechanism rule). `final_text` keeps the Dutch canonical text. R8 is extended, not bent: for an
English reader the text shown is `response.english.text` when `status === 'verified'`, and reconstruction
re-verifies it (§3.8). ADR 016 gets an as-built note; docs/05's R8 row gets one sentence.

### 3.8 Reconstruction (R8)

`reconstructionReport` gains an English leg for rows that carry `response.english`: re-run every check (C1–C11) on the stored
`rawTranslation` against the stored `maskedDutch`/`maskTable`; re-derive `maskTable` from the stored Dutch body
(masking is deterministic); re-fill and compare byte-for-byte with the stored `body`; re-derive every English
line from the stored result; re-assemble `text`. Tamper tests for each (a changed number in the stored English
body, a swapped placeholder, a changed line) must fail reconstruction.

### 3.9 Fallback

`status: 'fallback'` (two failed attempts, a model/API error, a digit left after masking): the web shows the
Dutch answer exactly as today, headed by one English line — "We couldn't produce a verified English version of
this answer, so here is the original Dutch." The attempt log is stored, so fallbacks are countable.

### 3.10 Chips

Chip **labels** are English (translated in the same call, checked by C1/C2/C6). A click submits the stored
**Dutch** chip text, so the follow-up runs through exactly the path it runs today; the thread shows the English
label as the reader's message.

### 3.11 Web

`web/` renders `english.text` / `english.chips` when present and verified, the fallback line when `fallback`,
and today's Dutch otherwise. Thread reload renders from the stored response, so a reloaded English answer is
the same English answer. Refusals and clarifications (phase 2) render Dutch, unchanged.

## 4. Cost and pricing

One extra model call per English answer (the phrasing model, a few hundred tokens each way). Dutch answers
cost nothing extra. **Assumption:** English answers keep the same credit price as Dutch (the extra call is
small); revisit if measured spend says otherwise (open-questions #271).

## 5. Rollout

1. Build behind `ENGLISH_ANSWERS_ENABLED` (off). CI is hermetic: hand-authored translate fixtures.
2. After the Anthropic API cap lifts (2026-10-01), owner-supervised: record real translate fixtures over the 14
   answerable benchmark tasks (`translate:record`), run an English eval (every task `verified` or an explained
   `fallback`; zero C1/C2 failures reaching the reader is structural), then set the flag in Vercel Production.
3. Rollback: unset the flag and redeploy — English readers get Dutch answers again; stored English renderings
   stay in the audit rows and still reconstruct.

## 6. Error handling summary

Every failure mode ends in the Dutch answer the reader would have got today, plus one honest English line.
Nothing in the translate path can block, delay past the existing timeout budget, or change the Dutch answer
or its audit fields.

## 7. Testing

- **Byte-identity:** with `lang` absent, `'nl'`, or the flag off, the composed response and audit row are
  deep-equal to today's for every benchmark task; all existing fixtures and the benchmark stay untouched.
- **Masking:** every token shape `findNumericTokens` accepts is masked; no digit survives; period labels mask
  before numbers.
- **Number converter:** round-trip property over generated values/decimal counts; unit notations.
- **Checks C1–C11:** one failing and one passing case each, incl. a direction flip, a dropped provisional
  marker, an invented placeholder, a stray digit, an improvised measure name.
- **Lines:** each English builder against every benchmark result shape.
- **Name list:** every registered table has an entry; every key the script wrote exists in the NED table's
  registry metadata; curated entries are marked.
- **Reconstruction:** English leg passes on good rows, fails on each tamper.
- **Web:** English answer, fallback line and Dutch path render; chip click submits the Dutch text.
- The usual verification block (typechecks, all suites, benchmark gate 14/14 + 6/6 + 0 fabricated, real build,
  `audit:verify`, `/code-review` LOW) and green CI.

## 8. Open points (mirrored in open-questions #271)

- **Assumption:** same credit price for English answers.
- **Assumption:** CBS ENG table keys match NED keys (verified per table by the fetch script).
- Measured after 2026-10-01: how the Dutch intent parser handles questions typed in English (not changed here).
