# ADR 029 — Follow-up suggestion chips under an answer (#73, owner request 2026-07-08)

**Status:** accepted (design frozen session 30); **BUILT as WP29 (session 35, 2026-07-11,
autonomous, branch `wp29-follow-up-chips` per #118)** — execute brief:
[session-briefs/2026-07-08-follow-up-chips-brief.md](../session-briefs/2026-07-08-follow-up-chips-brief.md).
**EXTENDED with a refusal-side variant for [#134](../open-questions.md)(a) (session 43, 2026-07-13,
branch `feat/134a-refusal-period-chips`) — see the second as-built note below.**

## As-built note (#134(a) refusal-side variant, 2026-07-13)

The same mechanism, applied to period-coverage REFUSALS instead of answers — because a refusal
already computes a concrete boundary period we CAN serve, so the "give the user a working next
step" idea (this ADR's whole point) applies there too.

- **`buildRefusalSuggestions(queryRefusal, check)`** (suggestions.ts) — emits ONE dry-run-gated
  retry chip on exactly two `QueryRefusal` kinds: `freshness` (offer `freshestAvailable`) and
  **period-axis** `outside_loaded_slice` (offer `nearestAlternative` = the slice floor). Gated to
  a canonical target (a registry `definitionLabel` to name) and — **region-less v1** — a
  region-less intent: a refusal has no cells, so there is no honest cell-derived region wording,
  and naming a region from its code is the guess the answer-path generators refuse (drop-never-
  guess). The candidate is `{same target, no regions, period:codes[boundary], derivation:none}`;
  `check` (the same `echoServability` closure) proves it resolves in loaded data before the chip
  surfaces (R7 "actually available"). Copy reuses the adjacent-period template verbatim
  (`Wat was {label} in {periodNl}?`). Whole body fail-open to `[]`, plus the respond.ts belt.
- **Deliberately excluded:** the DIMENSION `outside_loaded_slice` (axis `measure`, whose
  `nearestAlternative` is a dimension coordinate, never a period) and `not_published` (no boundary
  is computed — the genuinely hard [#134](../open-questions.md)(b) half; stays prose-only). v2
  enhancements (range/trend retry chip, regional chip) tracked as [#137](../open-questions.md)/
  [#138](../open-questions.md).
- **Envelope**: `RefusalResponse.suggestions: string[]` (mirror of the answer field), set only by
  `respondToIntent`'s query-refusal site via `toRefusalResponse`'s new optional input (`?? []`
  everywhere else). R8-safe: reconstruct.ts never reads `suggestions` — the refusal `text` is the
  only reconstructed surface and stays byte-identical. **Benchmark unaffected**: only B20
  (freshness) among the refuse tasks is a target reason, and the scorer's fabrication scan reads
  `finalText` only, not `suggestions` (14/14 + 6/6 + 0 fabricated verified).
- **Web — TWO read sites** (the adversarial review caught that the second was missed): (1) the
  LIVE turn — `chat.tsx` reads `suggestions` for `refusal` responses too; and (2) the WP135
  thread-RESUME replay — `src/threads/replay.ts` `buildAssistantPart` was widened from
  `kind === 'answer'` to `answer || refusal`, or a reopened thread would silently drop the retry
  chip while the live turn showed it (a stored-envelope-vs-render parity gap, WP135 being live in
  prod). Both feed the same kind-agnostic chip render + #75 fill-don't-send handler. Regression
  tests: `tests/threads/replay.test.ts` (mutation-verified) + `web/lib/replay-assemble.test.ts`.
- Verified: full gate green (backend suite incl. 14 new chip/replay tests, benchmark 14/14 + 6/6 +
  0 fabricated, web suite incl. 3 new refusal-chip/replay tests, both typechecks, real `next build`);
  zero prompt/fixture bytes changed. **Adversarial multi-lens review (6 lenses × refuting skeptics,
  2026-07-13): the ONLY confirmed finding was the replay-parity gap above (found independently by 3
  lenses, 0 false positives) — fixed + regression-pinned before the PR.**

## As-built note (WP29, 2026-07-11)

Built exactly per D1–D4; the deliberate micro-refinements, all inside the design:

- **`src/answer/respond/suggestions.ts`** — `buildSuggestions(intent, result, check)`: the four
  D1 generators in fixed priority, each candidate dry-run through the injected `ServabilityCheck`
  (the same callback type policy.ts uses; respondToIntent constructs it as a closure over
  `echoServability`). Cap 3 (`MAX_SUGGESTIONS`). Whole-body fail-open to `[]` PLUS a second
  fail-open belt at the respond.ts call site — a suggestions hiccup can never cost the paid answer.
- **The dry-run IS the loadedness check** (no db access in the module): generator 1 probes
  next-then-previous neighbor; generator 2 probes a five-period window ending at the answered
  period, then the three-period minimum (the "≥3 loaded" floor) — a window the dry-run accepts is
  gap-free by runQuery's own completeness pass. Generator 2 is skipped when the answer already IS
  a series (the chip would re-ask the answered question).
- **Inclusive ranges say "tot en met"** (not the brief's "van X tot Y" sketch): matches the #75
  example chip and policy.ts's own range options, and removes the exclusive-"tot" re-parse
  ambiguity D3 accepts as residual risk.
- **Region variant**: regional ⟺ the answered intent carries region codes (resolveRegions emits
  none for national-only measures). Sub-national answer → the national figure (intent region
  `NL01`, CBS's standard country code — dry-run-gated, so a table with a different code just drops
  the chip); national answer → the G4 gemeente comparison (stable CBS codes, copy says "Den Haag",
  the parser's own alias resolves it). Copy for every generator names the answered regions
  explicitly (D3's fully-explicit rule), via the cells' own CBS labels.
- **Generator 4 never fires on the Phase-0 seed** (every seeded table carries exactly one
  canonical measure) — pinned by test with an injected sibling registry; it activates when a
  table gains a second canonical measure.
- **Envelope**: `AnswerResponse.suggestions: string[]` (required, default `[]`), assembled
  post-compose in `respondToIntent` — the ONE construction site both entry points share, so
  first-turn and clarification-reply answers get chips identically. `text` byte-identity is
  pinned by test (B3 golden, sync-date spliced from the structural field). Additive for R8:
  reconstruct.ts checks only fields it names; pre-WP29 rows simply lack the field.
- **Web**: chips render under the answer in `chat.tsx` with the #75 classes and the #75 handler
  verbatim (`setInput(question)` — fill, never send); empty `suggestions` renders nothing.
  `?? []` guards only the deploy-window skew (old server, new client).
- Verified: full gate green (backend suite incl. 12 new tests, benchmark 14/14 + 6/6 +
  0 fabricated, web suite incl. 2 new chip tests, both typechecks); prompt/fixture files
  byte-untouched in the PR diff.
- **Adversarial review (5 lenses × dual refuting skeptics, 2026-07-11):** the three
  heavyweight lenses CLEAN (R7 servability gating, R8/audit byte-discipline, money/entry-points);
  one generator finding refuted by both skeptics (sameTopic plural-template wording —
  unreachable on the Phase-0 seed, activates only with a future second measure per table);
  one CONFIRMED test-adequacy gap — no pin proved suggestions also ride the warn-and-serve
  STALE answer branch (a mutant skipping chips on stale answers passed the whole gate) —
  closed same session with a mutation-verified test (the mutant now fails exactly that pin).

## Context

Owner request (2026-07-08, verbatim intent): after an answer, show new example questions that FIT
the question just asked — same topic and/or deepening questions — to give users ideas and provoke
more questions. This is brainstorm idea **#73**, owner-approved earlier and **deliberately deferred**
by session 22 with a recorded condition: *deterministic templates alone cannot promise a SERVABLE
suggestion — an unservable chip invites a paid dead-end* (the #77/#97 pattern). The missing
primitive has since been designed: ADR [024](024-answer-first-defaults-and-clickable-options.md)'s
Mechanism A (pre-verified clickable options over the `echoServability` dry-run), and the roadmap's
drill-down-buttons row already says *"same UI mechanism as clarification options — build once."*
This ADR turns #73 into a buildable WP consistent with both.

## Decisions

**D1 — Chips are generated DETERMINISTICALLY from the answered intent + the registry; no LLM
anywhere.** Four bounded generators, fixed priority, cap 3 shown:
1. **Adjacent period** — same intent, period shifted to the nearest loaded neighbor ("En in 2023?").
2. **Trend/deepening** — the measure's loaded multi-year window as a series question ("Hoe
   ontwikkelde dit zich van 2019 tot 2024?") — only when ≥3 periods are loaded.
3. **Region variant** (regional measures only) — compare with the national figure or a G4 city
   ("Vergelijk met heel Nederland").
4. **Same topic** — another canonical measure on the SAME table ("Hoeveel huishoudens waren er?").
Chip copy is a deterministic Dutch template over registry labels — a QUESTION, never a data claim
(principle a untouched: no number, no fact in a chip).

**D2 — Every chip is servability-gated before display** (the exact #73 deferral condition, and
R7's own rule that offered options must resolve in loaded data): each candidate's
`StructuredIntent` must pass the `echoServability` dry-run (`src/query/dry-run.ts`, the #56
primitive); unservable candidates are silently dropped; zero survivors → no chip block at all. A
shown chip can therefore never invite the paid dead-end that deferred #73.

**D3 — v1 click behavior: FILL the input, never send** — the proven #75/#82 convention: clicking
puts the chip's question text in the input box, the existing pre-send cost line shows what it will
cost, the user presses send, and the turn runs through the completely normal (gated, audited)
pipeline. No new money entry point, no new backend route, independent of WP26's build.
**v2 (upgrade seam, deliberately designed-in): when WP26 ships Mechanism A**, the same chips swap
their click handler to the pre-resolved-intent path (no LLM re-parse; the
`resolveClarificationOption` sibling), because generation (D1) + gating (D2) are identical in both
— only the handler differs. *Residual v1 risk, accepted + recorded:* between chip display and
submit the normal LLM parse could read the filled text differently (e.g. clarify instead of
answer); mitigated by generating fully-explicit question text (measure, region, period all named —
the shape that parses confidently, per the #75/#97a precedent) and priced at worst as one ordinary
clarification round, which v2 eliminates structurally.

**D4 — Suggestions are a STRUCTURAL envelope field, not answer text.** `AnswerResponse` gains
`suggestions: string[]` (the servability-surviving chip texts), assembled post-compose like
`chart`/`stalenessWarning` — the R8-audited `text` string is byte-untouched, no prompt bytes change
anywhere, fixtures and the benchmark are unaffected by construction. Rendering: live chat only
(`chat.tsx`, under the answer, #84 styling conventions). The async dashboard/onboarded surface
waits for #117/#74.

## Alternatives rejected

1. **LLM-generated suggestions** — cannot promise servability (the recorded #73 blocker), adds
   prompt bytes + per-answer spend + an injection surface, and violates the "suggestions are
   product copy, deterministically generated" line every existing chip (#75, #97a) holds.
2. **Curated static suggestion lists per measure** — the owner's own #111 steer forbids per-topic
   static fixes; doesn't scale past the seed tables and goes stale with onboarded ones.
3. **Direct-answer-on-click in v1 (build Mechanism A now, inside this WP)** — couples WP29 to
   WP26's not-yet-started build and adds a new charged entry point in the same change; the
   fill-don't-send v1 delivers the owner's goal (ideas, provocation) with zero new money surface,
   and the v2 swap is one handler.

## Revisit triggers

- WP26 Mechanism A ships → do the v2 handler swap (remove the re-parse risk).
- Measured: a filled chip question that produced a clarification round (audit rows show it) →
  tighten that generator's template or drop it.
- Onboarded-answer surface (#117/#74 dashboard work) → extend chips there with the same generators.
