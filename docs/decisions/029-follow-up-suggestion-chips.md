# ADR 029 — Follow-up suggestion chips under an answer (#73, owner request 2026-07-08)

**Status:** accepted (design frozen session 30); **BUILT as WP29 (session 35, 2026-07-11,
autonomous, branch `wp29-follow-up-chips` per #118)** — execute brief:
[session-briefs/2026-07-08-follow-up-chips-brief.md](../session-briefs/2026-07-08-follow-up-chips-brief.md).
**EXTENDED with a refusal-side variant for [#134](../open-questions.md)(a) (session 43, 2026-07-13,
branch `feat/134a-refusal-period-chips`) — see the second as-built note below. FURTHER EXTENDED with
the [#134](../open-questions.md)(b) too-old `not_published` chip (session 44, 2026-07-13, PR #41
`12518eb`, MERGED + LIVE) — see the fourth as-built note. EXTENDED AGAIN with the [#197](../open-questions.md)
step-3 COMPARISON chips (session 70, 2026-09-02, branch `feat/197-3-comparison-chips`; MERGED + LIVE 2026-09-03,
session 71, squash `83f790e`, PR #118) — the first chips that
are taken WITHOUT an LLM re-parse; see the first as-built note directly below.**

## As-built note (#197 step 3 — comparison chips, session 70, 2026-09-02)

The chart-UX research ([#197](../open-questions.md), session 69) put "one-tap comparison chips" third in its
build order; the owner gave GO in-chat. Built on branch `feat/197-3-comparison-chips`; its merge was gated on
the owner.s live `CLARIFY_CLICK_ENABLED` smoke test (RUNBOOK), because the chips reuse exactly that take-path —
that test passed in production on 2026-09-03 (audit rows 261/262, `parse.model = deterministic/wp26-click-option`,
zero tokens, R8 reconstruct clean) and the branch was squash-merged the same day as `83f790e` (PR #118, session 71;
CI run 33699880673 gate + deploy green).

- **Two new generators in `suggestions.ts`, ahead of the region variant:** `compareRegion` — a sub-national
  single-period answer offers ITS regions plus the national row ("Vergelijk met Nederland"); a national one
  offers the country plus the G4 ("Vergelijk met Amsterdam, Rotterdam, Den Haag en Utrecht") — and
  `comparePeriod` — a single-period, single-place answer offers the same period one year earlier as the
  registered `difference` derivation (R5; "Vergelijk met 2023" / "Vergelijk met juni 2025"). Priority is now
  adjacent → trend → compareRegion → comparePeriod → regionVariant → sameTopic; the region variant is SKIPPED
  once a region comparison surfaced (the side-by-side subsumes the lone national figure). With the cap still at
  3 (D1), a regional answer therefore shows adjacent / trend / "Vergelijk met Nederland" instead of the old
  "Wat was X in Nederland?" question — and, a direct consequence worth knowing, the period comparison is
  UNREACHABLE on such an answer (three slots, three earlier survivors): "Vergelijk met 2023" surfaces on
  national-only measures (CPI: no region comparison to fill the slot) or when adjacent/trend fail. Raising the
  cap to 4 under the flag was considered and left for usage data.
- **The comparisons start from the RESOLVED intent** (`result.intent`, the one the query ran — carried for
  R8), not the parsed one. They differ only when mechanism B-region defaulted the national row onto a
  question that named no place; built on the parsed intent the chips would be absent exactly there, built
  on the resolved one they offer the country + the G4 with every region explicit, so a click never depends
  on the default still being on (reviewer finding, the parallel session 70).
- **These chips are the first that D3's "v2" actually delivers:** each survivor rides the label list AND a
  `ClickOption` (ADR 024 mechanism A) — the fully resolved, dry-run-proven intent — on a NEW present-only
  `AnswerResponse.pending`, minted in the WP26c chip-carrier shape (`rescueOnly`). A click fills the input
  (#75, unchanged handler); on send the client routes a byte-equal label to `replyToClarification`, whose
  deterministic rung takes the stored intent through the `templateOnly` path: a real query, a NEW validated
  result (R6 — never a client-side merge of two answers), the click model on the parse, zero tokens, a real
  audit row at the normal reply price (20 credits — decision 4 of the brief, taken as the default). Anything
  else typed is a fresh question, exactly like the rescue pending.
- **Flag-gated, byte-neutral off:** the generators run only with `clickOptionsEnabled` (the
  `CLARIFY_CLICK_ENABLED` wire threaded into `respondToIntent`). Off ⇒ the pre-#197 chip list and NO `pending`
  key — pinned by test. Offered as plain labels without the take-path, "Vergelijk met Nederland" would go
  through a parse it was never written for, so they are not offered at all.
- **Principle (c) is the same dry-run gate:** a table with no national row offers no national comparison —
  pinned with a stub check that refuses `NL01`. Structural skips before any dry-run: explicit targets (the
  trust boundary refuses them), multi-period answers (one varying axis per question), an answer that already
  contains the national row, a region set beyond the validator's bound of 8 (an option the validator would drop
  at click time would silently downgrade the click to the LLM merge — so it is never offered).
- **`isRescuePending` widened** from "exactly one chip on one `measure` axis" to "1..MAX_CLICK_OPTIONS chips,
  labels pairwise byte-equal to `options`, ≥ 1 axis" — the label binding, not the axis literal, is what closes
  forgery (ADR 024 addendum). The carrier's `axes` names what the chips vary (`region` / `period`).
- **Thread resume drops carrier-bound labels** (`src/threads/replay.ts`): a resumed thread restores NO pending
  (ADR 033 ⟨A6⟩), so a replayed "Vergelijk met Nederland" would have been sent through a fresh parse — the
  question-shaped chips replay as before. This also now applies to the WP26c rescue chip. Restoring the carrier
  on resume is a possible follow-up, recorded in #197.
- **Not built, recorded as a deviation:** the brief's "Sinds 2008" chip. An answer carries no loaded-slice
  floor, and this module never sees the database (its confinement), so a "since" year would be a guess; the
  trend generator already offers a proven window. If it is ever wanted: the honest route is the injected-
  closure pattern `buildRefusalSuggestions` already uses for `RegionLabeler` — respond.ts would construct
  `(key, grain, regionCode) => earliestForCanonical(db, …)`, a `run.ts` export mirroring
  `freshestForCanonical` with the sort reversed (the private `earliestAvailablePeriod` #134(b) uses is the
  body to copy) — one indexed query per answer, and under cap 3 it would still rarely surface. A second
  reason to leave it: on a MONTHLY measure a since-the-floor range is ~190 cells, and the `templateOnly`
  take renders a series as one semicolon-separated wall (`renderSeries` has no cap; a `range` has no length
  bound while `codes` caps at 64) — a chip whose answer nobody can read.
- **Cost, measured** (pinned in `tests/answer/query-count.test.ts`, real fixture db + real dry-run): a
  regional single answer (Amsterdam 2024) costs 27 statements / 3 dry-runs with the flag OFF **and** ON — the
  cap stops the roster after three survivors and the region comparison takes the slot the region variant
  took, one dry-run for one; a national answer (Nederland 2026) 39 / 4 either way; a national-only measure
  (CPI 2024) 12 / 2 OFF → 18 / 3 ON (the period comparison fills the free slot). Worst case, with early
  generators failing their dry-runs: 8 dry-runs ON vs 6 OFF. Every dry-run is a full `runQuery` including
  the #110 `touchLastQueriedAt` statement — [#195](../open-questions.md)'s per-turn count.
- **Takeability gate (reviewer finding, the parallel session 70):** a comparison candidate is dry-run only if
  `isClickTakeableIntent` (validate-pending.ts, the click-time schema's `safeParse`) accepts it — the case
  that forced it: live chat answers on-demand-onboarded topics (`onboarded:…` keys, outside `CANONICAL_KEYS`
  by design) with the flag on, and a chip minted for one would be stripped at click time, the pending would
  stop being carrier-shaped, and the label would fall into the paid LLM merge. Not takeable ⇒ not offered,
  no dry-run spent (pinned).
- **Verification:** 19 new backend tests (`tests/answer/comparison-chips.test.ts`: real fixture db + real
  dry-run, both LLM clients throwing on the take, the audited row reconstructing clean), a replay pin, two
  chat-client pins, the envelope-key manifest entry for `AnswerResponse.pending`; the full block per CLAUDE.md
  before the push.

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
- **Deliberately excluded (in this note):** the DIMENSION `outside_loaded_slice` (axis `measure`,
  whose `nearestAlternative` is a dimension coordinate, never a period). `not_published` was excluded
  here (no boundary computed) but is now handled for the too-old sub-case — the [#134](../open-questions.md)(b)
  half, see the fourth as-built note below. Regional chip still deferred ([#138](../open-questions.md)).
- **[#137](../open-questions.md) range chip (session 43, PR #40):** for a range-ask
  `outside_loaded_slice` refusal, the chip prefers the clamped WORKING sub-range `[floor, originalTo]`
  as a trend question ("Hoe ontwikkelde {label} zich van {floor} tot en met {to}?" — the owner's
  "probeer 2010–2024" shape), falling back to the single-period floor chip when that window isn't
  fully servable. The `echoServability` dry-run is the SOLE validity gate — no manual grain/order
  compare (runQuery refuses a backwards/mixed-grain/above-ceiling/gappy range, never throws), only
  the degenerate `floor===to` is guarded; the range attempt is throw-isolated so it can never cost
  the single-period fallback. Still outside_loaded_slice-only, canonical + region-less.
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

## As-built note (#134(b) too-old not_published chip, 2026-07-13)

The [#134](../open-questions.md)(b) half — the owner's own "inflatie 2001" case. A `not_published`
refusal (CBS never published the asked period for this table) is now given the SAME retry chip as
the period `outside_loaded_slice`, but ONLY when the ask is too OLD. Owner decision (2026-07-13, two
questions): (1) range-aware like #137 (a range ask → the clamped working sub-range, a single-year
ask → the earliest year); (2) a MID-GAP not_published (a hole between served periods) stays
PROSE-ONLY — there is no single honest "try this" target, and picking a side would be the guess
principle (c) forbids.

- **Where the boundary is computed:** `src/query/run.ts` — a new `earliestAvailablePeriod(db, q,
  regionCode)` (the mirror of `fetchFreshness`, at the ASKED grain) plus a too-old classification in
  `diagnoseMissing`: it sets `nearestAlternative` = that earliest period **only** when
  `requestedKey < periodKey(earliest)`. A mid-gap (requested ≥ earliest) or a grain-mismatch
  (nothing at the asked grain → `earliest === null`) leaves it unset → no chip → prose. Same-grain
  deliberately (a yearly ask gets a yearly floor); cross-grain offers are a deferred v2.
- **Chip builder:** `suggestions.ts buildRefusalSuggestions` adds `not_published` to the allowed
  kinds and to the #137 range branch — it then shares the `outside_loaded_slice` path verbatim
  (single-period `{codes:[boundary]}`, or the clamped `[boundary, originalTo]` trend for a range
  ask), the `echoServability` dry-run the SOLE validity gate. No new charging surface, fill-don't-send
  (#75) preserved.
- **R8 / benchmark:** the refusal TEXT is byte-identical (`buildNotPublishedRefusal` ignores
  `nearestAlternative`); reconstruct never reads `suggestions`. Benchmark unaffected (no refuse task
  is a too-old not_published). Web needs no change — the chip block + resume replay are already
  reason-agnostic (they render any refusal carrying `suggestions`, verified by the second-read-site
  lens).
- **Adversarial review (5 lenses × refute-verify, 2026-07-13):** the ONLY confirmed finding was a
  test-coverage gap — no committed fixture has a natural same-grain interior hole, so the too-old
  guard's discriminating comparison could be weakened to `earliest !== null` with the suite staying
  green. CLOSED by `tests/query/not-published-midgap.test.ts`: an isolated ingest with one interior
  year surgically deleted drives the real `diagnoseMissing` and asserts the mid-gap carries NO
  boundary (teeth-proven — the reviewer's exact mutation fails it). The other four lenses
  (correctness, money-path/dead-end, R8/audit, web/thread-resume) found nothing.
- Verified: full gate green (backend 1280, web 305, benchmark 14/14 + 6/6 + 0 fabricated, both
  typechecks, real `next build`); zero prompt/fixture bytes changed. PR #41
  (squash `12518eb`), MERGED + LIVE.

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
their click handler to the pre-resolved-intent path (no LLM re-parse), because generation (D1) +
gating (D2) are identical in both — only the handler differs. **➡ As built (session 56): WP26 chose
take-path A2, so there is no `resolveClarificationOption` sibling to swap to — the deterministic
rung lives inside `respondToClarificationReply` and the #75 fill-don't-send handler is UNCHANGED.
The seam turned out to need no swap at all: a chip fills the input, the user sends, and the server
recognizes the label. v1 and v2 are the same handler.** *Residual v1 risk, accepted + recorded:* between chip display and
submit the normal LLM parse could read the filled text differently (e.g. clarify instead of
answer); mitigated by generating fully-explicit question text (measure, region, period all named —
the shape that parses confidently, per the #75/#97a precedent) and priced at worst as one ordinary
clarification round, which v2 eliminates structurally.

**D4 — Suggestions are a STRUCTURAL envelope field, not answer text.** `AnswerResponse` gains
`suggestions: string[]` (the servability-surviving chip texts), assembled post-compose like
`chart`/`stalenessWarning` — the R8-audited `text` string is byte-untouched, no prompt bytes change
anywhere, fixtures and the benchmark are unaffected by construction. Rendering: live chat only
(`chat.tsx`, under the answer, #84 styling conventions). The async dashboard/onboarded surface
waits for #117/#74. *(As-built update, 2026-08-27 session 66: #117/#74 landed — the history list
now live-refreshes while a fetch is in flight, so a delivered onboarding answer appears there
without a reload. Chips on that surface remain UNBUILT: the history's answer branch renders no
suggestions; extending chips there is still the open option below, now unblocked.)*

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

- ~~WP26 Mechanism A ships → do the v2 handler swap (remove the re-parse risk).~~ **RETIRED
  (session 57, 2026-07-25): this trigger can never fire. WP26 shipped on take-path A2, so there is
  no sibling handler to swap to — see the as-built note in D3 above. v1 and v2 are the same
  handler, and the "residual v1 risk" it was meant to remove is instead closed by the server
  recognising the label byte-exactly.**
- Measured: a filled chip question that produced a clarification round (audit rows show it) →
  tighten that generator's template or drop it.
- Onboarded-answer surface (#117/#74 dashboard work) → extend chips there with the same generators.
