# #134(a) — refusal period-suggestion chips (execute-ready brief)

**Session 43 (2026-07-13). Owner-chosen this session (over WP26). Core-product (answer
pipeline) → branch `feat/134a-refusal-period-chips` + PR, merge only on owner in-chat approval
(Executor guardrail 5 / [#118](../open-questions.md)b).**

## Goal (the cheap, high-confidence first slice of [#134](../open-questions.md))

When a question refuses specifically because the asked *period* lies outside what we can serve,
surface **one clickable chip that retries the same question at a period we DO have** — the
boundary the refusal already computes. Reuses the WP29/#73 chip UI verbatim (fill-don't-send,
[#75](../open-questions.md); ADR [029](../decisions/029-follow-up-suggestion-chips.md)). Zero LLM,
zero prompt bytes, servability-gated. The two target reasons are the ones that already know the
boundary deterministically:

- **`freshness`** (asked too recent): offer `freshness.freshestAvailable.periodCode`. The refusal
  prose already says *"Ik kan het cijfer voor {available} direct geven, vraag daar gerust naar."* —
  the chip makes that a one-click retry.
- **`outside_loaded_slice`** (asked below our slice floor, **period axis only**): offer
  `nearestAlternative` (= `slice.periodFloor`). Prose already says *"Ik kan wel cijfers laten zien
  vanaf {nearest}."*

## Out of scope (recorded as v2 / the hard half)

- **`not_published`** — [#134](../open-questions.md)b, the genuinely hard half: no boundary is
  computed for it and one may not exist (CBS never having published the measure that far back does
  not imply a nearest-working start year). Stays prose-only. The owner's own "inflatie 2001–2024"
  example falls here, NOT under (a).
- **Range / trend retry chip** (e.g. clamp a range ask to `{floor, originalTo}`): better UX but adds
  grain-aware period comparison + a second copy template + more surface. Deferred; single-period chip
  is the honest, uniform, provably-servable v1.
- **Regional period-refusals**: v1 is region-less only (see the drop-never-guess rule below).

## The mechanism (deterministic, servability-gated)

New `buildRefusalSuggestions(queryRefusal, built, check): Promise<string[]>` in
`src/answer/respond/suggestions.ts`. Returns **0 or 1** chip. Guards (any failing → `[]`):

1. `built.reason ∈ {'freshness','outside_loaded_slice'}`.
2. `queryRefusal.refusal.axis === 'period'` — **excludes the dimension `outside_loaded_slice`**
   (`resolve.ts:383`, `axis:'measure'`, `nearestAlternative` = a dimension coordinate, NOT a period).
3. Target is `canonical` → a registry `definitionLabel` exists (drop-never-guess; mirrors the answer
   path's `label === null` skip).
4. `intent.regions` empty/absent — **region-less v1** (no cells exist on a refusal, so there is no
   honest cell-derived region wording; naming a region from a code is exactly the guess the answer
   path avoids). Regional case is v2.
5. A boundary period code exists (`freshestAvailable.periodCode` / `nearestAlternative`).

Then build ONE candidate intent — same target, **no regions**, `period:{kind:'codes',codes:[boundary]}`,
`derivation:'none'` — and `await check(candidate)` (the injected `echoServability` dry-run, no LLM, no
cell values by construction). If `.servable` → return `["Wat was ${definitionLabel} in
${periodCodeToNl(boundary)}?"]` (exact copy of the answer path's adjacent-period generator). Else
`[]`. Whole body is `try/catch → []` (**fail-open**: a chip hiccup must never cost the user the paid
turn — the ADR 029 rule).

## Wiring

- `src/answer/respond/types.ts`: `RefusalResponse` gains `suggestions: string[]` (mirror
  `AnswerResponse.suggestions` — additive STRUCTURAL field, `text` byte-untouched).
- `src/answer/respond/refusals.ts`: `RefusalEnvelopeInput` gains optional `suggestions?`;
  `toRefusalResponse` sets `suggestions: input.suggestions ?? []`; `toInternalRefusal` sets `[]`.
  **Every** existing `toRefusalResponse` call site keeps `[]` by omission — only the one query-refusal
  site below passes a computed array.
- `src/answer/respond/respond.ts`: in `respondToIntent`, at the non-clarification query-refusal
  return (the `return toRefusalResponse({..., built: built.refusal, ...})`), compute
  `suggestions = buildRefusalSuggestions(outcome, built.refusal, c => echoServability(db, c))` inside a
  `try/catch → []` belt (same shape as the answer path), then pass it into `toRefusalResponse`.
- `web/components/chat.tsx`: extend the client read (currently `response.kind === 'answer' ? ... : []`)
  to also take `refusal` suggestions. The existing chip render block (`message.suggestions.map(...)`)
  is kind-agnostic — no other web change; the click handler IS the #75 fill-don't-send handler.

## Invariants at stake (Definition of done, [CLAUDE.md](../CLAUDE.md))

- **R8** — refusal `text` byte-untouched; `suggestions` is additive and `reconstruct.ts` never reads
  it (verified: reconstruct checks `finalText === response.text`, reason, onboarding presence — not
  suggestions). Audit stores the envelope verbatim.
- **Principle (c) / R1/R3/R9/R10** — the chip names a period **proven loaded by the dry-run**, never a
  guess; copy is a templated QUESTION over a label + a loaded period code, carries no data value.
- **R7 / docs/05 failure table** — the offered retry "actually resolves in loaded data" (the #56
  dry-run rule), same guarantee the clarification options already carry. Add the note to the
  `freshness` / `outside_loaded_slice` failure rows in the same change.
- **Zero prompt bytes** — pure deterministic code over data the pipeline already produces; no
  `prompt.ts`/`schema.ts`/`parse.ts`/fixtures.
- **Benchmark** — only **B20 (freshness)** among the 4 refuse tasks is a target reason (no
  `outside_loaded_slice` task exists). B20 will now carry a chip, but the scorer's fabrication scan
  reads `record.finalText` only (`score-benchmark.mjs:190-193`), not `suggestions`, and reconstruct
  ignores suggestions → **14/14 + 6/6 + 0 fabricated stays green** (verified before build). Runner
  stays hermetic (the dry-run is a DB call, no LLM).

## Tests

- `tests/answer/suggestions.test.ts` (extend) — `buildRefusalSuggestions`: freshness→chip;
  outside_slice period-axis→chip; outside_slice **measure**-axis→`[]`; non-target reason→`[]`;
  regional intent→`[]`; non-canonical target→`[]`; dry-run false→`[]`; throwing check→`[]` (fail-open);
  R8 envelope pin (refusal `text` byte-untouched, chip rides alongside).
- `tests/answer/respond-pipeline.test.ts` (extend) — a full freshness refusal turn carries a
  servability-gated chip; `text` unchanged; reconstruct OK; no unbacked token in `finalText`.
- `web/components/chat.test.tsx` (extend) — a refusal response's suggestions render as chips; click
  fills the input (#75), does not send.

## Verification block (Executor guardrail 2b — BEFORE the PR, serial, exit codes checked)

`npm ci` (root + web) · typecheck (root + web) · all backend suites · web suite · `benchmark:run` +
`benchmark:score` = 14/14 + 6/6 + 0 fabricated · real `next build`. Then adversarial multi-lens review
(house rule for answer-pipeline changes) before merge. Green CI is the only "done".
