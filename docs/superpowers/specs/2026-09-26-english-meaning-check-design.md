# #325 — The English meaning check (design, not built)

**Status:** designed 2026-09-26 (session 133). Not built. Relates to [open-questions #325](../../open-questions.md),
ADR [058](../../decisions/058-english-answers.md) (English answers), ADR [034](../../decisions/034-semantic-fabrication-check.md)
(the pattern reused here). Precondition of the `ENGLISH_ANSWERS_ENABLED` flip.

## 1. The problem in one paragraph

ADR 058 makes an altered NUMBER impossible in an English answer: numbers, units, periods, caveats and digit-bearing names
are masked before the translator sees the text, and eleven deterministic checks (C1–C11) gate the result. What those
checks cannot guarantee is the MEANING of the words around the numbers. Direction ("rose"/"fell"), negation ("did not
fall") and weakeners ("hardly rose") are checked with word lists, and five review rounds kept finding translations that
reverse or weaken a claim while passing every list (#325 lists six confirmed shapes, e.g. `steeg` → `hardly rose`,
`steeg in Utrecht, niet in Zeeland` → `rose not only in Utrecht but in Zeeland`). Each word-level patch opened new
gaps. A word list can't settle what a sentence means, so this design adds a structural check and stops adding words.

## 2. Decision (recommended)

**A second, independent model call — the "meaning check" (C12) — compares the masked Dutch and the masked English item
by item and can only say "same meaning" or "not the same". It runs on every English candidate that has passed C1–C11,
before the numbers are filled back in. Anything short of an explicit "same meaning" for every item means the reader
gets the already-validated Dutch answer, exactly as today's fallback does.**

This is ADR 034's shape: additive, reject-only and fail-closed, a cheap tier with measured escalation, and a verdict
that is recorded and never re-derived.

### 2.1 What the checker sees (and never sees)

- **Sees:** for each item (the body, each chip, the definition, each alternate) the masked Dutch text and the masked
  English text, side by side, with the same item ids the translator used. Both are already stored on the audit row
  (`english.maskedDutch`, `english.rawTranslation`).
- **Never sees:** a digit (both sides are masked; C2 already proved the English side digit-free), raw cells, the user's
  question, or the unmasked answer. The payload whitelist is pinned by a test, as ADR 034's is.
- **Why masked is enough:** every reversal in #325 lives in the WORDS. A placeholder like `⟦Pa⟧` or `⟦Na⟧` is identical
  on both sides, so the checker can still see which period or number a claim is attached to. The prompt tells it that
  each number placeholder already includes its unit, so `⟦Na⟧ points` is a difference (closes #325 shape 6).

### 2.2 What it judges

One question per item: *does the English make exactly the same claims as the Dutch?* That covers direction, negation,
strength (a weakener or intensifier added or dropped), comparison (more/less than, which side), which region or period
each statement is about, hedges (`ongeveer`, `circa`) kept, and nothing added that the Dutch doesn't say. Style,
word order and sentence splitting are explicitly NOT differences. That matters, because the false-positive guard cases
(§4) are ordinary faithful rewordings.

The prompt tells it to answer "not the same" when unsure (principle c). A false "not the same" costs one retry and at
worst a Dutch answer. A false "same" would put a reversed claim in front of a reader.

### 2.3 Output contract (hard at the call site)

Structured JSON output, one zod schema shared by the request's `jsonSchema` and the call-site validation (the house
pattern): `{ items: [{ id: string, sameMeaning: boolean, differences: string[] }] }`.

- The ids must match the item set exactly: each item once, none missing, none extra. A partial or padded list is a
  checker ERROR and never counts as a pass (ADR 034 decision 3).
- `sameMeaning: false` on any item → the attempt fails with problem kind **C12**.
- `differences` are audit text only. They are stored on the row and **never** sent back to the translator: a retry sends
  one fixed sentence, `PROBLEM_KIND_SENTENCE.C12 = "The meaning of a sentence changed: a direction, negation, strength,
  comparison, hedge, or which region or period a statement is about."` (the same rule as ADR 058: never echo audit text
  into a model prompt).

### 2.4 Where it sits in the ladder

`runLadder` in `src/answer/translate/translate.ts`, per attempt:
`translate → parse → shape check → C1–C11 → **C12 meaning check** → fill → assemble`.

- C12 runs only after C1–C11 pass, so it never pays for a translation the free checks already reject.
- A C12 rejection is an ordinary failed attempt: attempt 2 is the translator retry with the fixed C12 sentence, followed
  by its own C12. If attempt 2 also fails, the reader gets the Dutch fallback. At most **2 translate calls + 2 check
  calls** per English answer.
- The existing 20 s deadline covers the whole step, both checks included, and the deadline checkpoints (`state.expired`)
  gain one after the check call. **Assumption:** 20 s is enough. The eval measures it (§5), and if the worst case (two
  translate calls plus two check calls) doesn't fit, the cap goes up. The page's `maxDuration` is 90 s.

### 2.5 Checker errors fail CLOSED (to Dutch)

A failed check CALL is an outage, a timeout or malformed output, not a judgment. When that happens, the attempt fails
and the answer falls back to Dutch. This deliberately differs from ADR 034's owner-chosen fail-open, for a concrete
reason: there, fail-closed meant a degraded *template* answer; here the fallback is the complete, validated Dutch
answer with one honest English line, so the cost of caution is small. Fail-open would serve exactly the unchecked
English meaning #325 exists to prevent, so no fail-open mode is built and no owner alert is needed.

### 2.6 Model: cheap tier first, escalation measured

- `MEANING_CHECK_MODEL = 'claude-haiku-4-5'` (the same tier as the translator and ADR 034's checker, and the owner's
  2026-09-08 cost steer that moved phrasing to Haiku), `temperature: 0`.
- **Escalation is measured in the same eval run, not argued:** the record step runs the labelled set (§4) on Haiku AND
  on `claude-sonnet-5` (Sonnet 5 rejects `temperature`, so that request omits it and sets `thinking: 'disabled'`,
  which the client already supports). Haiku ships only if it scores 0 missed reversals and 0 false alarms over 3
  repeats. Otherwise Sonnet 5 ships, if it meets that bar. If neither does, the flag stays off and the prompt is
  reworked.
- **Known limit, stated plainly:** Haiku is also the translator, so both calls could share a blind spot. The checker has
  a different job and prompt, and the labelled set measures exactly this. If a live miss ever appears, the first move is
  to switch to Sonnet 5 (a different model).

### 2.7 Audit record and R8

- Each `EnglishAttempt` gains an optional `meaningCheck` field: `{ status: 'same' | 'different' | 'error', model,
  promptVersion, verdicts, error, latencyMs }`. No DDL: it rides the existing `response.english` jsonb. It is additive
  to `ENGLISH_RENDERING_SCHEMA_VERSION` 1 because no English row has ever been stored (the flag has never been on), the
  same reasoning ADR 058 used to keep `TRANSLATE_PROMPT_VERSION` at 1.
- Its tokens land in `llm_calls` under a new role, `'meaning_check'`.
- **R8 (`checkEnglishReconstruction`) re-derives the SCOPE, never the verdict:**
  - A `verified` rendering requires its final attempt to carry `meaningCheck.status === 'same'`.
  - Its verdict ids must equal the item ids re-derived from the stored `maskedDutch`.
  - Every verdict must say `sameMeaning: true`.
  - A `verified` rendering never carries an `error` or `different` final check.

  Tamper tests prove each rule can fail. The verdict's content (booleans, differences, model, latency) is recorded
  capture, as in ADR 034 decision 4. Re-running a model at reconstruct time would make R8 non-deterministic.

### 2.8 What stays as it is

- C1–C11 all stay. They are free, deterministic and fail toward Dutch. C12 is additive and can only reject.
- The Dutch pipeline, its prompts, its fixtures and the Dutch benchmark stay byte-identical. The check runs only on the
  English path, only when English is on.
- There is no separate env flag. The meaning check is part of the English path, not an option on it: two flags would
  allow an unchecked English state, which is the thing this design removes.

## 3. Cost per English answer (plain English, for the owner's spend decision)

Prices as of 2026-09-26: Haiku 4.5 costs $1 per million input tokens and $5 per million output tokens; Sonnet 5 costs
$2 and $10. One check call is roughly 1,500–2,500 tokens in and 200–400 out. **Assumption**, measured by the eval.

| | Haiku (default) | Sonnet 5 (if Haiku misses) |
|---|---|---|
| One check call | ≈ $0.002–0.005 | ≈ $0.005–0.009 |
| Typical English answer (1 check) | ≈ **€0.003** | ≈ **€0.006** |
| Worst case (2 checks) | ≈ €0.009 | ≈ €0.017 |
| One-off eval run (≈25 cases × 3 repeats × 2 models) | ≈ €1 total | |

Dutch answers pay nothing extra. The English credit price is unchanged (ADR 058 assumption, #271). If measured English
spend turns out materially above Dutch, ADR 058's existing revisit trigger covers it.

## 4. The labelled set (the flip gate)

`tests/helpers/meaning-check-cases.ts`. Each case is a masked Dutch/English pair with a product-policy label, and every
case must first pass C1–C11: a case the free checks already reject measures nothing (ADR 034's structural guard).

- **Must-reject cases (missed-reversal measurement):**
  - each of #325's six confirmed shapes;
  - a dropped hedge (`ongeveer ⟦Na⟧` → `⟦Na⟧`);
  - a comparison with its sides swapped;
  - an intensifier added (`steeg` → `soared`);
  - a statement moved to the other period;
  - a doubled unit (`⟦Na⟧ points`);
  - an added clause the Dutch doesn't make.
- **Must-pass cases (false-alarm measurement):**
  - faithful rewordings: active/passive, sentence split and merge, `nam toe` → `increased`, `daalde niet` → `did not
    fall`, `bleef gelijk` → `remained unchanged`, `niet alleen … maar ook` → `not only … but also`;
  - the #326 negation shapes, translated correctly;
  - the 14 benchmark answers' real recorded translations from `translate:record`.
- **Gate:** 0 missed reversals and 0 false alarms, over 3 repeats (`--repeat=3`, the house standard). A checker error
  never counts as a judgment in the eval.

The false-alarm rate on the 14 real translations is also the new English fallback rate that C12 adds. ADR 058's
revisit trigger (fallback rate above ~10%) applies to the total.

## 5. Testing split (ADR 012 / ADR 034 decision 6)

- **Hermetic, on the CI gate, buildable before 2026-10-01 with no spend:** the payload whitelist (no digit, no question,
  no cells); the output-contract validation (id-set, padded or partial lists, malformed JSON); the ladder policy (C12
  runs only after C1–C11, a reject triggers a retry with the fixed sentence, a second reject means Dutch, a checker
  error means Dutch, the deadline stops the chain before the check call); the R8 scope rules with tamper tests; the
  labelled set's structural guard (every case passes C1–C11). All of this runs on stub clients.
- **Live, owner-supervised, after the cap lifts:** `npm run translate:record` records the translator AND check fixtures
  together. A new `npm run meaning-check:eval` / `meaning-check:record` scores the labelled set on both models and
  appends to `benchmark/meaning-check-eval-report.json` (append-only history), including latency so the 20 s cap can
  be checked.

## 6. Alternatives considered

1. **More word lists (status quo).** Rejected on evidence: five rounds, each patch opening a new false pass, two of them
   reverted (ADR 058 ruling 25). #325 exists because this road doesn't converge.
2. **Back-translation:** translate the English back to Dutch, then run the Dutch validator's direction and negation rules
   against the original. Rejected: it's still word-list judgment (the Dutch side), and a back-translation can "repair" a
   bad English wording (`hardly rose` → `steeg`), hiding the very error it should catch.
3. **Structured translator output (per-clause direction/negation tags emitted by the translator).** Rejected for ADR 034's
   alternative-1 reason: the tags are the same model's claim about its own text, so they carry no more certainty than
   the text itself, and adding them changes the translate prompt for no closed gap.
4. **A deterministic trigger gate (run the check only when the Dutch has a trend, negation or comparison word).**
   Rejected: the gate itself would be a word list, and a miss would ship an unchecked answer, the #325 failure mode
   again. ADR 034 could gate because its gate only decided whether to double-check an already-validated body. Here,
   the check is the only meaning guarantee there is. English-only traffic and a cost under a cent make always-on the
   cheap, safe choice.
5. **Fail-open on checker errors (ADR 034's choice).** Rejected, see §2.5: the fallback here is a full Dutch answer, not
   a degraded template.
6. **Ship English without the check, disclosing the known gaps.** This is the owner's call, not a technical one. It is
   not recommended: a reversed claim ("the inflation did not fall" on a real decline) is the same class of bug as a
   fabricated number, and the Dutch twin of that bug (#326) was just fixed live for exactly that reason.

## 7. On the kickoff's "build only if `translate:eval` shows the word lists aren't enough"

`translate:eval` can't show that. It replays 14 honest translations and measures how often they fall back. It never
sees a reversed claim, because a faithful translator on 14 benchmark answers will rarely make one, and when it does,
nothing in that eval labels it. How often reversals slip past C1–C11 can only be measured with a labelled set, which is
this design's §4. So the real trigger is the decision already on record: the owner wants English answers (#271), and
#325 makes this check a precondition of the flip. **Recommendation: build it before the flip.**

## 8. Revisit triggers

- Any missed reversal in the eval or live → move to Sonnet 5 first, then rework the prompt. It blocks the flip until
  resolved.
- A false-alarm rate that pushes the total English fallback rate above ~10% on real traffic → tune the prompt's
  "not a difference" examples first.
- `claude-haiku-4-5` is deprecated → swap the constant, re-record and re-run the eval (one command each).
- English traffic grows enough to make the check's cost visible on the spend dashboard → revisit batching or gating, with
  the measured false-alarm and missed-reversal data in hand.
