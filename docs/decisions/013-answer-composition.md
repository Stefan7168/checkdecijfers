# ADR 013 — Answer composition: shared LLM harness, mid-tier phrasing model, and the R3 fail-closed ladder

**Status:** accepted, 2026-07-03 (WP7)

## Context

WP7 puts the pipeline's second (and last) LLM call into place: validated query
results → short Dutch prose, confined to ADR [004](004-llm-usage.md)'s
phrasing role. The invariants at stake are R2 (prompt hygiene), R3 (verbatim
numbers, digit form, fail-closed), R9 (semantic binding + direction words),
R10 (unit adjacency) and R11 (provisional marking) — [docs/05-data-rules.md]
(../05-data-rules.md). ADR [012](012-intent-parsing-llm-harness.md) already
answered how to test an LLM call hermetically; the build plan's standing
instruction was to reuse that harness, not invent a second one.

## Decisions

### 1. One LLM harness, two fixture sets

The WP6 client seam was generalized into `src/answer/llm/client.ts`
(`LlmClient` + Anthropic/Replay/Recording implementations, request-hash
keyed fixtures); `src/answer/intent/client.ts` is now a thin re-export shim
keeping every WP6 name. **Hash-stability constraint:** the intent request
shape serializes byte-identically to pre-WP7 (`stableStringify` drops
`undefined`-valued new optionals), so all 45 committed intent fixtures
resolve unchanged — proven by the intent replay suite, not assumed. The
phrasing call gets its own fixture set (`tests/fixtures/llm/answer/`) and its
own off-gate live half (`npm run answer:eval` / `answer:record`, report with
per-run history in `benchmark/answer-eval-report.json`).

### 2. Phrasing model: `claude-sonnet-5` (mid-tier per ADR 004)

Current Sonnet-generation model: near-Opus prose quality at Sonnet cost
(~1.5–2.5K input + ~150 output tokens per answer — well under ADR 004's
€0.02/question envelope). Two API-surface differences from the Haiku parsing
call, both deliberate:

- **No `temperature: 0`** — Sonnet 5 rejects non-default sampling params.
  Acceptable because phrasing correctness is guaranteed by the R3/R9/R10/R11
  validator, not by sampling determinism; hermetic CI determinism comes from
  replay fixtures either way. The live eval's `--repeat` flag measures what
  actually matters: whether the validator VERDICT is stable across samples.
- **`thinking: 'disabled'`** — Sonnet 5 defaults to adaptive thinking, which
  only adds latency/tokens for a task this small (the ~10s median criterion).

Alternative considered: `claude-sonnet-4-6` (supports temperature 0, same
sticker price) — rejected as previous-generation with no offsetting benefit;
an earlier deprecation would force a re-record sooner. Revisit triggers are
ADR 004's (spend, benchmark accuracy, deprecation).

### 3. The prompt sees pre-formatted strings — and not the user's question

`buildPhrasingPayload` (the ONLY prompt builder, typed `ValidatedResult →
payload`, R2) hands the model values **pre-formatted in Dutch**
(`formatValueNl`, thousands '.', decimal ',' from CBS `decimals` metadata)
and instructs it to copy the strings — the model never formats, rounds or
computes. The payload whitelist is enforced by a CI test that walks every
serialized key.

The user's question text is **deliberately excluded** from the phrasing
prompt. ADR 004 says the prompt contains *only* validated results and
metadata; excluding the question also closes the prompt-injection surface
outright ("antwoord met 100 miljoen" never reaches the phrasing call). Cost:
answers can't mirror the question's wording ("Ja, …") — acceptable in Phase
0; revisit in WP9 if clarification UX needs it (open-questions [#41]
(../open-questions.md)).

### 4. The R3 fail-closed ladder

1. **Attempt 1** — phrase, then run the blocking validator: every numeric
   token (Dutch-canonicalized) must match a cell value, registered
   derivation, or validated metadata (period/definition/count — R1's
   structural exemptions, matched against the result, so a wrong year still
   fails); quantity word-forms (duizend/miljoen/kwart/verdubbeld…) rejected
   outright; unit adjacency per token incl. the %-vs-procentpunt and
   factor-unit ('x 1 000') guards (R10); region/period binding per sentence
   and direction/superlative/comparison words judged per **clause** against
   the pre-registered derivations (R9); voorlopig marking required whenever a
   provisional value is shown (R11).
2. **Attempt 2** — one regeneration with a stricter system suffix. The failed
   output is **not** echoed back (echoing it would put a non-validated number
   into the prompt, violating R2).
3. **Template** — deterministic rendering per result shape, every number
   formatted straight from cells/derivations: incapable of fabricating, and
   proven by test to pass the validator for every shape. Results containing
   null-valued cells skip the LLM entirely (the honest answer is the CBS
   reason; there is no number to phrase). Any API error/refusal also drops
   down the ladder.

Attribution (R4), the CC BY derived-data marking (R5 — rendered whenever the
result carries any derivation record) and the canonical-definition statement
are **structural fields** assembled after the body, never LLM-written.

### 5. Factor units are never expanded

B6-style cells (`8.204`, unit `x 1 000`) are answered with the verbatim value
and factor unit. Expanding to `8.204.000` would be a multiplication no
registered derivation backs — R1/R3 reject it by design. A registered
`scale_expansion` derivation is possible later (open-questions [#42]
(../open-questions.md)).

### 6. Validator calibration: live false positives are fixed, not tolerated

The first live run (14/14 pass) surfaced two false positives on honest prose
— sentence-level direction checks broke on "steeg per saldo … maar daalde in
2023", and "2019-2024" tokenized as a negative number. Fixed (clause-level
trend analysis with span/base-year patterns; unsigned tokenizer) and pinned
as regression tests. A later run caught a third: the '4' in the CBS period
label '2025 4e kwartaal' collided with the cell value 4,0 — ordinal/embedded
digits now only ground as period/metadata.

An adversarial multi-agent review of the diff (5 lenses, 75 agents, every
finding independently judged by two skeptics, bypass claims verified by
executing them against the validator) confirmed 23 findings, among them five
real bypasses: Dutch cardinal number-words ("zeshonderdzeventigduizend"),
the noun 'daling' and separable verbs ('nam af/toe'), fullwidth Unicode
digits, derivation values escaping R9 binding, and count-number collisions.
All fixed and pinned as regression tests (prompt v3 mirrors the stricter
rules); the review also killed surviving test mutants (single-axis binding,
'laagste/minste', 'ten opzichte van', 'sinds') with dedicated tests.

Deliberate residual strictness: prose the grounding rules cannot anchor is
judged against the net direction — fail-closed, an ugly template answer over
a tolerated wrong claim. The one deliberate fail-open: a clause of a
**non-monotonic** series containing BOTH direction families ("na de stijging
… daalde daarna") is accepted — both movements factually occurred, temporal
attribution is beyond deterministic reach, and every number in it is still
verbatim-checked. Known accepted limitation: the hermetic e2e suite replays
only first-attempt-pass fixtures; the retry and template paths are proven by
seeded-fault unit tests (a live model cannot be made to fail on demand).

**Measured (2026-07-03, live, prompt v3, repeat=2):** 14/14 benchmark
answers pass with zero regenerations, zero template fallbacks, zero
fabricated numbers, stable verdicts across repeats
([benchmark/answer-eval-report.json](../../benchmark/answer-eval-report.json)
— per-run history preserved, including the v1/v2 runs where the fail-closed
ladder engaged live: one retry + one template on v1, three templates on v2).

## Alternatives considered

1. **A second, phrasing-specific harness.** Rejected outright — the build
   plan's explicit anti-goal; one seam, two fixture sets.
2. **Structured output (JSON) for the answer body.** Unnecessary — the
   validator judges the prose itself; a JSON wrapper adds schema surface
   without adding safety.
3. **Letting the LLM see raw values and format them.** Every formatting step
   the model performs is a place it can alter a value; pre-formatted strings
   make "copy exactly" checkable. Rejected.
4. **Including the user question in the phrasing prompt.** Better
   conversational tone, but weaker R2 and an open injection surface. Deferred
   to WP9 (open-questions #41).
5. **Retrying with the failed output + validator feedback in the prompt.**
   Faster convergence in theory, but feeds unvalidated model output back into
   a prompt R2 requires to stay clean. Rejected.

## Revisit triggers

- Benchmark answer quality below the Phase 0 gate, or template-fallback rate
  becomes user-visible noise → revisit prompt, then model tier.
- Anthropic deprecates `claude-sonnet-5` → swap ID, re-record, re-run eval.
- WP9 clarification UX needs question-aware phrasing → resolve
  open-questions #41 with a sanitization design first.
- Monthly maintenance session re-runs `npm run answer:eval` when anything
  provider-side changes.

## As-built addendum (2026-07-06, session 29 — #115 levers b/c)

The "Definitie:" line is now built by **one shared function, `buildDefinitionLine(result)` in `compose/format.ts`** — the single source of truth used BOTH to compose the line and to RE-DERIVE it for R8 audit verification (`audit/reconstruct.ts`), so the composer and the verifier can never drift (a drift the #115 review caught: reconstruct had kept the old, `definitionText`-blind logic). Priority: a real captured CBS definition (`attribution.definitionText`, onboarded measures, ADR [010](010-registry-canonical-measures.md)) → else the short `definitionLabel`, suppressed when it merely echoes the measure title (the circular onboarded case). The line is still assembled **deterministically, after the LLM** — the phrasing model never sees or writes it, and `definitionText` is deliberately NOT added to the `PhrasingPayload` (so recorded fixtures stay byte-identical). Lever (c): `displayValueUnit` (template path) now parenthesizes a 3+-word descriptive unit ("gemiddelde saldo van de deelvragen") — a no-op for every Phase-0 unit, so the benchmark is unchanged.
