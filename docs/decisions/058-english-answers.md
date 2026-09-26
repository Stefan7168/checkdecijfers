# ADR 058 — English answers: translate the checked Dutch answer, numbers masked

**Status:** accepted 2026-09-25 (session 131, owner present, decided in chat). Design:
[superpowers/specs/2026-09-25-english-answers-design.md](../superpowers/specs/2026-09-25-english-answers-design.md).
Phase 1 (regular answers) specified; **in build** (session 131, branch `english-answers-phase1`, Tasks 1–6 of 9 done at
`d9b632f1`; not merged, not live). Build rulings added two checks (C7 number order, C8 sentence binding) and a fourth
placeholder kind for digit-bearing official names (⟦G…⟧) — see the spec's §3.4 on the branch and the SDD ledger copy in
[session-briefs/2026-09-26-session-132-kickoff.md](../session-briefs/2026-09-26-session-132-kickoff.md). Phases 2 (refusals/clarifications) and 3 (chart texts) get
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

## Revisit triggers

- English fallback rate above ~10% on real traffic → revisit prompt or move more text to hand-written templates.
- Measured English-answer spend materially above Dutch → revisit the credit price (assumption, #271).
- A need to query English answers in SQL → add a column by migration.
