# ADR 059 — The English meaning check (C12): an independent, reject-only comparison of masked Dutch and masked English

**Status:** accepted 2026-09-26 (session 133, owner present: GO on the design and on building the zero-spend half).
Hermetic half **built** (session 133). **Measured + model chosen session 134 (2026-09-26/27): Sonnet 5** — see "As-built (live
half, session 134)" below. Design: [superpowers/specs/2026-09-26-english-meaning-check-design.md](../superpowers/specs/2026-09-26-english-meaning-check-design.md);
plan: [superpowers/plans/2026-09-26-english-meaning-check.md](../superpowers/plans/2026-09-26-english-meaning-check.md).

**Relates to:** [open-questions #325](../open-questions.md) (the gap), ADR [058](058-english-answers.md) (English answers; this
check is a precondition of its `ENGLISH_ANSWERS_ENABLED` flip), ADR [034](034-semantic-fabrication-check.md) (the pattern reused).

## Context

ADR 058's checks C1–C11 make an altered NUMBER in an English answer impossible. They do not guarantee the MEANING of the words
around the numbers. Direction, negation and strength are word-list checked, and five review rounds kept finding
translations that reverse or weaken a claim while passing every list (#325: `steeg` → `hardly rose`, `steeg in Utrecht, niet
in Zeeland` → `rose not only in Utrecht but in Zeeland`, and four more). Each word-level patch opened new gaps, and ruling 25
reverted two of them.

## Decision

1. **A second, independent model call (check C12) compares the masked Dutch and the masked English, item by item** (body,
   each chip, definition, each alternate). It answers "same meaning" or "not the same" per item, via structured JSON with a
   hard id-set contract.
2. **It runs after C1–C11 pass and before the numbers are filled back in**, in `runLadder`
   (`src/answer/translate/translate.ts`). A "not the same" fails the attempt, and the retry gets one FIXED sentence. The
   checker's own text is never sent to the translator. Two failed attempts mean the reader gets the validated Dutch answer.
3. **Fail-closed on checker errors.** Unlike ADR 034's owner-chosen fail-open, the fallback here is the complete, validated
   Dutch answer, so caution is cheap. Serving unchecked English meaning is the exact risk #325 names.
4. **Always on for English candidates, with no deterministic trigger gate.** A gate would itself be a word list, and English
   traffic plus a cost under a cent make always-on the safe, cheap choice. There is no separate env flag: the check is part
   of the English path, not an option on it.
5. **The checker never sees a digit, raw cells or the user's question.** Both sides are masked, item ids are letters only,
   and a pre-call gate refuses any digit in the request.
6. **Model: `claude-haiku-4-5` first; `claude-sonnet-5` only if the labelled-set eval says so.** The bar is 0 missed
   reversals and 0 false alarms over 3 repeats. Both models are measured in the same recording run
   (`npm run meaning-check:record`).
7. **R8:** the verdict is recorded (`english.attempts[].meaningCheck`, no DDL) and never re-derived. Its SCOPE is re-derived
   instead: a verified row's final attempt must carry a `'same'` check whose verdicts cover exactly the items re-derived from
   the stored response, every one saying `sameMeaning: true`. Its tokens are tracked under the `llm_calls` role
   `'meaning_check'`.

## Alternatives considered

- **More word lists:** rejected on evidence (#325, ADR 058 ruling 25).
- **Back-translation plus the Dutch validator's rules:** still word lists, and a back-translation can repair the very error it
  should catch.
- **Translator-emitted direction/negation tags:** the same model's claim about its own text (ADR 034 alternative 1).
- **A deterministic trigger gate:** the gate would be a word list; a miss ships an unchecked answer.
- **Fail-open:** would serve unchecked English meaning.
- **Ship English without the check:** the owner's call, not recommended. A reversed claim is the same class of bug as #326,
  which was fixed live for exactly that reason.

## Consequences

- **Cost:** about €0.003 per English answer on Haiku (worst case, two checks: about €0.009; on Sonnet 5 about €0.006 and
  €0.017). Dutch answers cost nothing extra. A one-off eval run costs about €1.
- **Latency:** at most two translate calls plus two check calls inside the existing 20 s cap. The eval measures latency; if
  the worst case doesn't fit, the cap goes up (the page `maxDuration` is 90 s).
- **Fallback rate:** false alarms add to the English fallback rate, and ADR 058's ~10% revisit trigger covers the total.
- The recorded English fixtures (`translate:record`) now also contain the C12 calls.

## As-built (hermetic half, session 133)

Built via subagent-driven development, four tasks, each reviewed. Commits on `english-meaning-check`: `b4843bb1` (module),
`5ce6d6ed` (ladder), `f2110b49` (audit role + R8 leg) and `66fe2d67` (labelled set, guard, eval script). What the build had to
decide beyond the spec:

- `translateAnswer`/`attachEnglish` take an optional `checkClient`. When it is absent, the translate client is also used for
  the check, so there is no configuration where English skips C12. `respond-audited.ts` passes the same injected client
  twice, tracked under `'translate'` and `'meaning_check'`.
- A checker ERROR fails the attempt without setting the retry's problem sentences. The retry is then a fresh translation,
  because the translator did nothing wrong.
- **The labelled set is 13 must-reject and 6 must-pass cases** (every #325 shape plus the spec §4 list, each proven to pass C1–C11 by a CI guard test). Two planned must-pass cases were dropped because C1–C11
  already reject those FAITHFUL translations: `niet alleen … maar ook` → `not only … but also` trips C10's negation-after
  scan, and one Dutch sentence split into two English sentences with a shared period trips C8. That is the known
  over-strictness ADR 058 accepted (a faithful translation falls back to Dutch, the safe side). C12 can only reject, so it
  cannot recover those. If the recorded fallback rate shows they matter, relaxing C8/C10 becomes possible once C12 is
  measured and guards meaning. That would be a later, measured decision, not part of this build.
- **Must-pass gaps, recorded:** the spec's `nam toe → increased` and sentence-merge must-pass cases are not in the set yet
  (the first overlaps S1's plain rise; the merge shape needs a two-sentence Dutch body that C8 accepts). The spec's
  must-pass "14 real recorded translations" can only be added after `translate:record`; that is part of RUNBOOK step 3b.
  Missing must-pass cases only weaken the false-alarm side, which fails safe (toward Dutch).
- Existing translate test stubs answer meaning-check requests through `tests/helpers/meaning-check-stub.ts` (recognised by
  the fixed system prompt, never by call order), so their request logs and call counts still only see translate calls.

## As-built (live half, session 134, 2026-09-26/27, owner present)

- **Model choice by measurement (decision 6):** `meaning-check:record` ×3 on the 19-case set — Haiku missed D7 (a dropped
  hedge, `ongeveer ⟦Na⟧` → `⟦Na⟧`) on all three repeats; Sonnet 5: 0 missed, 0 false alarms, 0 errors, 0 flips, latency max
  2.9 s. `MEANING_CHECK_MODEL` = `'claude-sonnet-5'` (thinking disabled, no sampling params — the builder's existing Sonnet
  branch). Cost per English answer ≈€0.006 (worst case ≈€0.017), per this ADR's own Sonnet estimate. `meaning-check:eval`
  (replay) now defaults to the shipped model instead of the name 'haiku'.
- **What the first real recording caught** (Haiku check at the time): two genuine mistranslations — B6 ('Eindstand
  Voorraad' → 'Opening stock', the model reusing the glossary's neighbouring 'Beginstand voorraad') and B12 (a sentence
  garbled around three loose placeholders from the unregistered unit `1 000 euro`) — plus one C10 false alarm (B8,
  'did not move upwards'). Fixes in ADR 058's territory: listed CBS names found verbatim in the alternates line join the
  glossary (C5 then requires their English), `'1 000 euro'` is a registered unit, `upwards?`/`downwards?` join the English
  C10 lists, and prompt rule 3 maps "tot en met" to "up to and including" (Sonnet 5 rejected a bare "to" on 5 of 14 first
  attempts — correct, but each a wasted retry).
- **Final state:** 13/14 benchmark answers verify on the first attempt; B10 falls back (the translator wrote "benchmark
  figure" for the CBS term "standcijfer"; C12 rejected both attempts). Measured English fallback rate 1/14 ≈ 7%.
- **Spec §4's real cases:** the 13 verified renderings are must-pass cases (`R-B*`), stored in
  `tests/fixtures/meaning-check-real-translations.json` — written by every `translate:record`, or free from the committed
  fixtures via `node scripts/translate-eval.ts --write-real-cases`. All 32 cases on Sonnet 5 ×3: 0 / 0 / 0 / 0, max 3.2 s.

## Revisit triggers

- Any missed reversal in the eval or live → move to Sonnet 5 first, then rework the prompt. It blocks the flip.
- False alarms pushing the total English fallback rate above ~10% → tune the prompt's "not a difference" examples.
- A verdict with `sameMeaning: true` but a non-empty `differences` list currently counts as "same" (the prompt demands
  an empty list). If the eval shows the checker doing this, treat such a verdict as "different".
- `claude-haiku-4-5` is deprecated → swap the constant, re-record and re-run the eval.
- English traffic makes the check's cost visible on the spend dashboard → revisit batching or gating, with measured data.
