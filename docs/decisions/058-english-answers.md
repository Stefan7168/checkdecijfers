# ADR 058 — English answers: translate the checked Dutch answer, numbers masked

**Status:** accepted 2026-09-25 (session 131, owner present, decided in chat). Design:
[superpowers/specs/2026-09-25-english-answers-design.md](../superpowers/specs/2026-09-25-english-answers-design.md).
Phase 1 (regular answers) specified; not yet built. Phases 2 (refusals/clarifications) and 3 (chart texts) get
their own specs.

## Context

The EN/NL interface switch (ADR [040](040-interface-language-switch.md)) translated the interface but deliberately left every
CBS answer Dutch. An English reader now sees a half-translated product ([open-questions #271](../open-questions.md)).
The owner chose (2026-09-25) to fully translate answers for English readers, official CBS names included.

The hard constraint is principle (a): every number must trace to a validated cell. The Dutch pipeline's validators
(R1/R3/R9–R11 in `src/answer/compose/validate.ts`), its phrasing prompt, its hash-keyed fixtures, the frozen
benchmark and the R8 reconstruction are all Dutch-coupled.

## Decision

1. **Translate the checked Dutch answer, don't build a second answer engine.** The Dutch pipeline runs unchanged;
   for an English reader (and only with `ENGLISH_ANSWERS_ENABLED=1`) a new `src/answer/translate/` step turns the
   validated Dutch answer into English.
2. **Numbers are unrepresentable to the translator.** Period labels and every numeric token are masked to
   placeholders before the model call and filled back by deterministic code in English format; six deterministic
   checks (placeholders, no digits, direction, caveats, official names, chip count) gate the output; one retry,
   then the Dutch answer with one honest English line.
3. **Hand-written English for everything template-built** (structural lines, staleness warning; refusals and
   clarifications in phase 2). The model only translates model- or template-phrased prose bodies and chip labels.
4. **Official names from a committed list** (`src/registry/english-names.ts`): CBS's own English labels where CBS
   publishes a same-number English table (12 of 17 on 2026-09-25), matched by key; curated and marked otherwise.
5. **Stored inside the existing audit row** (`response.english`), reconstructed by R8. No migration; `final_text`
   stays the Dutch canonical text.

## Alternatives considered

- **A separate English answer engine** (English phrasing prompt + English validators): most natural English, but
  duplicates the most safety-critical code in the product and every number rule must be re-proven in English.
  Rejected by the owner.
- **Model-translate everything, templates included:** least build work, but every refusal costs model spend and
  checked template wording could be mistranslated. Rejected by the owner.
- **Keep official CBS names Dutch** (session's recommendation, for traceability to the CBS website): rejected by
  the owner in favour of fully English text; mitigated by using CBS's own English labels wherever they exist.
- **A `lang` column / `final_text_en` column on `audit_answers`:** cleaner querying, but a migration for data that
  fits the existing jsonb; not needed until someone has to query English rows at scale.

## Consequences

- One small extra model call per English answer; Dutch answers unchanged in cost, bytes and fixtures.
- A new text producer inside R8's scope, with its own reconstruction leg and tamper tests.
- Real-model fixtures and the English eval wait for the Anthropic API cap to lift (2026-10-01); the flag stays off
  until then.

## As-built (phase 1, sessions 131-132, branch `english-answers-phase1`, NOT merged, flag off)

Built via SDD, 9 tasks — plan
[superpowers/plans/2026-09-25-english-answers-phase1.md](../superpowers/plans/2026-09-25-english-answers-phase1.md),
ledger
[superpowers/sdd/2026-09-25-english-answers-phase1/progress.md](../superpowers/sdd/2026-09-25-english-answers-phase1/progress.md).
What the Decision above under-specified or the build genuinely had to decide:

- **Five more deterministic checks, C7–C11, past the six named above** (`src/answer/translate/check.ts`; all
  fail toward the Dutch fallback). A review found the original placeholder-identity check (C1) is SET-based: a
  model swapping two number placeholders — binding a value to the wrong period or region — passed every
  original check untouched, and a number bound to the wrong region or period is a fabricated claim (principle
  a), not a stylistic nit.
  - **C7 (order, per ITEM — the body, each chip, the definition, each alternate — not per sentence):** the
    number placeholders keep their exact relative order; so do the PERIOD placeholders; and the glossary's
    REGION names keep the relative order of their first mentions (longest name first, so a region nested in a
    longer one — 'Holland' in 'Noord-Holland' — is not its own mention). Only the order WITHIN a kind is
    pinned: a period moving past its number ('In ⟦Pa⟧ was X ⟦Na⟧' → 'X was ⟦Na⟧ in ⟦Pa⟧') is ordinary English.
    The period and region legs were added by the final whole-branch review: Dutch bodies are often ONE
    sentence, so a same-sentence swap ('In ⟦Pa⟧ … ⟦Na⟧, in ⟦Pb⟧ … ⟦Nb⟧' → 'In ⟦Pb⟧ … ⟦Na⟧, in ⟦Pa⟧ …', or
    two regions traded) passed the sentence-level C8. A residual round then added a third region leg: first
    mentions alone missed a swap in a LATER sentence ('… In ⟦Pb⟧ Zeeland had ⟦Ne⟧ and Utrecht ⟦Nf⟧'), so per
    ALIGNED sentence group (a Dutch sentence and the English sentence(s) holding its number placeholders, merged
    when English joins sentences) the ordered sequence of ALL region mentions must match too. A region moved
    after its own number in the same order ('⟦Nc⟧ in Utrecht and ⟦Nd⟧ in Zeeland') passes. The final bounded
    round closed the last gap: a sentence with NO number ('Utrecht had meer inwoners dan Zeeland.') never joined
    such a group, so when the Dutch and English items have the same number of sentences, EVERY sentence is now
    paired by position and its region order pinned — IN ADDITION to the number-based grouping, which always
    runs too (an abbreviation such as 'o.a. ' can split a Dutch sentence so the counts match while the positions
    no longer line up).
  - **C8 (sentence binding, body):** each number placeholder's companion period placeholders and region names
    in its Dutch sentence land in the SAME English sentence.
  - **C9 (quantity words):** an English number word (one…twenty, thirty…ninety, hundred, thousand, million,
    billion, dozen), fraction/multiple (half, quarter, a third, twice, double(d), triple(d), quadruple(d),
    -fold) or percent word (percent / per cent / '%', percentage point) outside the placeholders fails unless
    the masked Dutch item carries its Dutch counterpart (één/twee/…, helft, kwart, derde, verdubbeld/twee
    keer, drievoudig, procent, procentpunt, …). The residual round added fractions fourth…tenth ('a fifth', 'two
    tenths' — never the ordinal 'the fifth year'; vierde…tiende), decade(s) (decennium, tien jaar) and
    century (eeuw), and made a bare 'one' require the accented numeral 'één' — the unaccented article 'een' was
    satisfying every ', one of the largest rises' out of thin air. C9 also fails a unit or scale word the model
    writes right AFTER a placeholder that already carries its unit ('⟦Na⟧ points', '⟦Na⟧ euros', '⟦Na⟧
    percent' when the fill already ends in that unit) — a check that needs the mask table, which
    `translateAnswer` and the R8 reconstruction both pass to `checkTranslation`. The map is small and explicit, and 'percent' is never satisfied
    by 'procentpunt' (a unit swap is R10's own fabrication). The Dutch cardinal morphemes are a copy of the
    Dutch validator's list, pinned against it by a test.
  - **C3 compares an ORDERED sequence, and C10 checks negation.** Direction claims are read the way the Dutch
    validator reads them — trend words per clause, more/less-than comparatives per sentence (its own
    `splitSentences`/`splitClauses`) — in text order, consecutive duplicates collapsed — not as a set, which let 'Utrecht steeg…, Zeeland daalde…' → 'Utrecht fell…, Zeeland rose…'
    pass. C10 then requires each claim's negation to match: the Dutch side uses the Dutch validator's own
    negation-in-clause rule (zonder/geen/niet earlier in the clause; copied, pinned against validate.ts by a
    test), the English side its mirror (not / no / never / without / cannot / n't earlier in the clause) —
    'niet gedaald' → 'has fallen' is a reversed claim. Dutch also puts 'niet' AFTER a finite verb ('daalde
    niet', 'nam niet af', 'steeg in ⟦Pa⟧ niet', 'daalde in Utrecht en Zeeland niet'), which the validator's
    earlier-only rule cannot see; the English checks' OWN Dutch scan (never validate.ts, which stays
    byte-identical) also counts niet/geen/nooit after the direction word, up to the clause end or the next
    direction word in the clause. A conjunction does not end that scan (an earlier conjunction stop let
    'daalde in Utrecht en Zeeland niet' → 'fell in Utrecht and Zeeland' through); only a negation sitting between
    a conjunction and the NEXT direction word belongs to that next word ('steeg naar ⟦Na⟧ en er was geen daling'
    keeps the rise un-negated). Two further heuristics tried in the last round — cutting the scan where 'en'/
    'maar'/'of' opens a new clause, and skipping a negation after a trend noun ('De stijging was niet groot') —
    were reverted (ruling 25): each opened new false passes, and C11 covers the case they targeted. So a later
    negation in a coordinated clause still attaches to the verb (a faithful translation then falls back to Dutch,
    the safe side), and the noun-qualifier case stays a known residual. The scan also treats
    'nooit', 'nergens', 'noch', 'geenszins' and 'evenmin' as negators (English adds 'never', 'neither', 'nor',
    'nowhere'). The copy-drift test carries these extensions as explicit, commented exceptions.
  - **C11 (negation parity) — a structural backstop.** Word-by-word negation rules kept leaking (each fix round
    found another shape), so per item the NUMBER of negator words must be equal on both sides: Dutch niet,
    geen, nooit, nergens, noch, geenszins, evenmin, zonder, niets, niemand; English not, n't (once per
    occurrence), no, never, neither, nor, nowhere, without, nothing, nobody, none, cannot — 'no longer' counts
    once.
    An added or dropped negator anywhere in the item fails, whatever sentence shape carries it.
- **A number is masked TOGETHER with a directly following unit or scale word, as ONE placeholder** (final
  whole-branch review). The model never sees a unit, so it cannot swap one: 'procentpunt' → 'percent' or 'mln'
  → 'billion' is a fabricated number as surely as a changed digit. Joined: `%` (glued or after one space),
  procent, procentpunt(en), mln, mld, miljoen, miljard, and the result's own registered unit strings that have
  an English form in the shared name list (`translateUnit`, longest first, so 'mln euro' beats 'mln'). The mask
  table stores the combined Dutch text and a FIXED English fill: '%', 'percentage point(s)' (singular only when
  the number is exactly 1), 'million', 'billion', or the registered unit's English ('450.985 euro' → '450,985
  euros'). R8 re-derives it through `prepareTranslation` like every other mask entry. C2, the pre-call digit gate
  and the digit-bearing-name split use `\p{N}` (every Unicode numeral: '½', '²', 'Ⅻ'), not just `\p{Nd}`.
- **The whole translate step is capped at 20 s** (`TRANSLATE_TIMEOUT_MS`, `src/answer/translate/types.ts`). It
  runs after the full Dutch pipeline and after the credit is reserved, inside a page with a 90 s maxDuration;
  an uncapped step (two calls on a default SDK client: 10-minute timeout, 2 retries) could get the function
  killed — charged, no answer, no audit row. On expiry the answer falls back to Dutch with attempt error
  `'timeout'`, built from a snapshot; the ladder stops at its next checkpoint, so a late response mutates
  nothing and starts no further paid call. The web layer (`web/lib/english-answers.ts`) builds the translate
  client on its own SDK instance with `maxRetries: 0` and a 20 s request timeout.
- **A digit-bearing glossary name is masked WHOLE**, as a new placeholder kind `⟦G…⟧` (exact case-sensitive
  match, longest match first, masked before caveats/periods/numbers). A measure title like "Bevolking op 1
  januari" or a dimension label like "15 tot 75 jaar" carries a digit in ITS OWN Dutch or English text — sent to
  the model as literal text, it would either let the model write that digit back (forbidden, C2) or demand the
  model reproduce an untranslatable name exactly (C5), a guaranteed deadlock. Such names are removed from both
  the model-facing glossary and the glossary `checkTranslation` runs against; C1's ordinary placeholder-identity
  check enforces their exact reuse instead.
- **A retry never quotes `checkTranslation`'s own problem strings — it sends one fixed, digit-free English
  sentence per failed CHECK KIND, deduplicated.** Those problem strings are audit text: they name item indices,
  counts and, sometimes, a Dutch source name — which can itself carry a digit (e.g. a problem naming "Bevolking
  op 1 januari"). Echoing one back to the model on retry would smuggle a digit past the mask straight into the
  model's own prompt. `src/answer/translate/prompt.ts`'s `PROBLEM_KIND_SENTENCE` table instead maps:
  - C1 → "Some placeholders were dropped, duplicated or invented."
  - C2 → "A digit was written."
  - C3 → "A direction word was changed."
  - C4 → "A caveat word was dropped."
  - C5 → "A required name was not used exactly."
  - C6 → "The number of chips or alternates changed."
  - C7 → "Numbers, periods or regions were reordered."
  - C8 → "A number was moved away from its period or region."
  - C9 → "A number word, fraction, multiple, scale word or unit was written that the Dutch does not contain."
  - C10 → "A negation was added or dropped."
  - C11 → "The number of negation words (not, no, never) changed."
  - malformed/unparseable model output → "The output was not valid JSON of the required shape."
- **The model's output is shape-validated before anything else touches it** (`isTranslationItemsShape`) — a
  malformed response becomes an ordinary retryable failed attempt instead of throwing inside
  `checkTranslation`/`fillPlaceholders`. Up to two attempts total (one fresh, one retry naming the failed check
  kinds) — the same ladder shape the Dutch compose path uses, just shorter: no template rung, because the
  fallback here is the ALREADY-VALIDATED Dutch answer, never a fabricated English one.
- **`TRANSLATE_PROMPT_VERSION` stays `1`** even though system-prompt rule 1 gained the `⟦G…⟧` name-placeholder
  kind partway through the build — nothing has ever been recorded or served under v1 (recording is this very
  Task 9, and the flag stays unset until the go-live below), so no consumer can distinguish the old and new
  wording; a real behaviour change to an ALREADY-RECORDED prompt would instead need a bump.
- **Every deterministic name/direction/region check (C3, C5, C7–C11) reads the MASKED Dutch text**, not a
  separately re-split unmasked body — this closes a latent desync risk (regions read from an independently-split
  body could misalign if sentence counts ever differed) at no extra cost, since C1 already guarantees a
  `⟦G…⟧`-masked name's own exact reuse regardless. **Names match on Unicode word boundaries**
  (case-insensitive, quote-normalized) — the Dutch validator's `mentions` is a substring test, under which 'Ede'
  matched inside 'exceeded' and 'Nederland'.
- **System-prompt rule 2 was widened by the final review** to say a number placeholder already includes its unit
  (never write a unit or scale word next to one) and never to add a number word, fraction or multiple the Dutch
  does not contain — the same reasoning as rule 1's `⟦G…⟧` addition keeps `TRANSLATE_PROMPT_VERSION` at `1`.
- **A glossary entry is `translated` when the shared name list HAS an entry** (`hasEnglishName`), never merely
  when its English differs — 'CPI' → 'CPI' is a translation, so it is not listed in `untranslatedNames`.
- **The English R8 leg never throws on a malformed stored row** (`src/answer/audit/reconstruct.ts`): a shape
  guard over every field it reads (plus a try/catch) turns a null/non-object `english`, non-array
  `attempts`/`chips` or a missing field into one `english:` problem on that row, instead of aborting a whole
  `audit:verify` run.
- **Editing an English name later makes older English rows that used it diverge in `audit:verify`** — the
  reconstruction re-derives the glossary and mask table from TODAY's name list. Same pattern as any other
  registry-derived text: record such rows as known divergences, never rewrite them.
- **A verified English answer renders inside the SAME answer card**, not a separate plain bubble:
  `english.body`/`english.lines.*`/`english.stalenessWarning` map onto the card's existing text slots, with
  table id, source, synced date, provisional badge and the chart-dock trigger all read from the unchanged Dutch
  `answerView`. A fallback renders the ORIGINAL Dutch card unchanged, with one honest line above it —
  `chat.englishFallback` in `web/lib/i18n/messages.ts`: *"We couldn't produce a verified English version of this
  answer, so here is the original Dutch."* A bare, cardless bubble was rejected: it would have silently dropped
  the dock trigger and the answer's own source link, the public claim's whole point.
- **Official English names split into two files** (Decision 4): `src/registry/english-names.cbs.generated.ts`
  holds ONLY names a script derives from CBS's own English-language sibling tables (12 of 17 registered tables);
  `src/registry/english-names.data.ts` holds hand-curated entries for everything else, with a test forbidding
  the same key from appearing in both files with different values (so a regeneration can never silently clobber
  a curated entry). Two specific hand picks made during the build, recorded here so a later session never has to
  re-derive them: **'Ongecorrigeerd' → 'Uncorrected'** (CBS's own word from table 85828ENG, its table-specific
  noun stripped); **'Prijsindex verkoopprijzen' → 'Price index purchase prices'**, picked from CBS's own English
  titles on both tables that share this Dutch measure name (85773ENG *"Existing own homes; purchase prices,
  price indices 2020=100"* and 85792ENG *"…; purchase prices, price index 2020=100, region"*) after the owner
  said to "just pick one" rather than leave it Dutch (open-questions #324). The 80590NED age-bracket labels use
  CBS's own English verbatim ("15 tot 75 jaar" → "15 to 74 years") — Dutch "tot" is EXCLUSIVE of its own upper
  bound, so the apparent digit mismatch between the two languages is not an error; the digit-invariance test
  carries one explicit, narrowly-scoped exception for exactly this CBS shape and nothing else.
- **`scripts/translate-eval.ts` (Task 9)** mirrors `scripts/answer-eval.ts`'s two-mode harness for this second,
  smaller LLM call: `npm run translate:eval` replays committed fixtures (none recorded yet — fails loudly with a
  clear message, never a crash); `npm run translate:record` makes 14 real calls (one per answerable benchmark
  task) and (re)writes them — owner-supervised, real spend, blocked until the Anthropic workspace usage cap
  lifts (2026-10-01). See [RUNBOOK.md](../RUNBOOK.md)'s "English answers (ADR 058) — switching it on".

**Known phase-1 gaps, deferred rather than blocking** (tracked at
[open-questions #324](../open-questions.md)): a reloaded thread's user bubble shows the Dutch submit text, not
the English chip label that was actually clicked; the citation copy, CSV export and proof panel stay Dutch under
an English answer; shared/published pages and exports stay Dutch; chart texts are untouched by this phase (a
separate, not-yet-specified phase 3, per Decision above).

**Not yet done:** `npm run translate:record` (blocked by the API cap), the owner-supervised go-live
(`ENGLISH_ANSWERS_ENABLED=1`), and the merge to `main`.

## Revisit triggers

- English fallback rate above ~10% on real traffic → revisit prompt or move more text to hand-written templates.
- Measured English-answer spend materially above Dutch → revisit the credit price (assumption, #271).
- A need to query English answers in SQL → add a column by migration.
