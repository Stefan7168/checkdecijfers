# ADR 029 — Follow-up suggestion chips under an answer (#73, owner request 2026-07-08)

**Status:** accepted (design frozen session 30); **BUILT as WP29 (session 35, 2026-07-11,
autonomous, branch `wp29-follow-up-chips` per #118)** — execute brief:
[session-briefs/2026-07-08-follow-up-chips-brief.md](../session-briefs/2026-07-08-follow-up-chips-brief.md).
**EXTENDED with a refusal-side variant for [#134](../open-questions.md)(a) (session 43, 2026-07-13,
branch `feat/134a-refusal-period-chips`) — see the third as-built note below. FURTHER EXTENDED with
the [#134](../open-questions.md)(b) too-old `not_published` chip (session 44, 2026-07-13, PR #41
`12518eb`, MERGED + LIVE) — see the fourth as-built note. EXTENDED AGAIN with the [#197](../open-questions.md)
step-3 COMPARISON chips (session 70, 2026-09-02, branch `feat/197-3-comparison-chips`; MERGED + LIVE 2026-09-03,
session 71, squash `83f790e`, PR #118) — the first chips that
are taken WITHOUT an LLM re-parse; see the third as-built note below. #73 v2 (session 72, 2026-09-03,
autonomous per #118(b), branch `feat/73-v2-click-take-chips`; review round 2 by the parallel cloud session 74;
**PR #122 MERGED + LIVE 2026-09-03 — session 75, owner-approved in chat, squash `4fd6ea5` of head `002f5b0`**): EVERY
follow-up chip is now such a take; see the first as-built note directly below.
FIXED [#195](../open-questions.md)/[#196](../open-questions.md) (session 72, 2026-09-03, branch
`fix/195-196-eviction-probe-touch`; review round 2 session 73, `ebd341f`; **PR #121 MERGED + LIVE 2026-09-03 —
session 75, owner-approved in chat, squash `527ef2e`**) — the dry-run primitive this ADR's chips run through no
longer bumps `last_queried_at`; see the second as-built note below.**

## As-built note (#73 v2 — every chip takeable, session 72, 2026-09-03, autonomous; MERGED + LIVE 2026-09-03 as PR #122, session 75)

Row [#73](../open-questions.md) recorded the v2 seam as "WP26 Mechanism-A click, no re-parse — revisit when WP26
ships"; WP26 mechanism A went live on 2026-09-02/03 and the #197 comparison chips proved the carrier shape in
production (rows 263/264). v2 is now built on exactly that carrier — no handler swap (the D3 as-built note stays
true: the #75 fill-don't-send handler is untouched), just an option per chip. Built autonomously on branch
`feat/73-v2-click-take-chips` per [#118](../open-questions.md)(b): a PR for the owner's review, not a push to main.

- **Every generator returns one candidate shape** (`ChipCandidate`: label + the resolved intent it just dry-ran +
  the axis it varies + which generator made it), and the assembly loop mints a `ClickOption` for every survivor
  whose intent passes the click-time schema (`isClickTakeableIntent`, the same gate the comparisons had). Axes:
  adjacent period and trend → `period`, region variant → `region`, same topic → `measure`, plus the comparisons'
  own. Ids name the generator (`adjacent-1`, `trend-1`, `region-1`, `topic-1`; the comparisons keep `cmp-N`) so
  the audit row's take note reads at a glance. `impliedRecency` is `false` on every chip: each names an explicit,
  already-answered period or window (an adjacent code, a window ending at the answered period, the answered
  period at another place or for a sibling measure, a comparison of named periods) — no "what is it now" claim,
  the rescue chip's reasoning. The intents are the ones the generators already dry-ran — no new query shape,
  and the number of dry-runs per turn is unchanged (re-measured: `query-count.test.ts` pins stay 27/27 regional,
  39/39 national, 12→18 CPI).
- **The take path needed no change** — it is label-bound and generic. Verified per generator on the fixture db
  with both LLM clients throwing (`tests/answer/wp29-click-take.test.ts`): adjacent → one cell, `single`, no
  chart; trend → a five-period `series` with the builder's line chart; region variant → the lone `NL01` cell,
  or the G4 `comparison` with a bar chart; every take `parse.model = deterministic/wp26-click-option`, zero
  tokens, `answer_source = template`, a NEW validated result (R6), and the audited row reconstructs clean (R8)
  with the label as `reply_text`. Same topic — the only take that switches `target.key` — fires on real data
  too: five seed tables carry several canonical measures (`CANONICAL_MEASURES`: 83693NED ×3, 85880NED ×2,
  85770NED ×3, 85828NED ×2, 85429NED ×4; the rest carry one), and under cap 3 the topic chip surfaces when an
  earlier generator yields nothing — e.g. a consumer-confidence SERIES answer (no trend chip, no single-period
  comparison) offers "Hoeveel economisch klimaat waren er in juni 2026?" as `topic-1`, whose take is one cell
  of the sibling measure under the sibling's own attribution and definition label, R8 clean (pinned). Its
  candidate is the adjacent-period shape on a sibling key and is minted only for a `CANONICAL_KEYS` sibling.
  (The v2 note's first version claimed same topic could not fire on the seed at all — the registry has grown
  since the WP29 as-built note below was written; corrected in the PR #122 review.) The template's plural
  "Hoeveel … waren er" reads awkwardly for an index-valued sibling — a pre-existing WP29 copy wart, now
  reachable, recorded here and not changed in this PR.
- **Servable-but-not-takeable stays a label.** A question-shaped survivor the click-time schema rejects (an
  `onboarded:` key — outside `CANONICAL_KEYS` by design) is offered exactly as before v2: in `suggestions`, not in
  `clickOptions`, and a click fills the input for the ordinary parse. Only the comparisons are all-or-nothing.
- **A minted intent never leans on the B-region default.** The question-shaped candidates used the PARSED
  intent's regions; on a B-defaulted answer (a question naming no place — live since 2026-09-03, row 269) that is
  no region at all, and such an intent would only serve while `ANSWER_FIRST_ENABLED` is on — the RUNBOOK's
  rollback-order hazard the comparisons avoided by starting from the RESOLVED intent. The same rule now applies:
  when the question named NO place, the candidate carries the resolved regions (explicit `NL01`), and — review
  round 2 — the chip copy names the country too ("… in Nederland in 2025?"), exactly as when the question named
  it: the take is an explicit national intent that discloses no default, so the label itself carries the
  disclosure the answer's `assumptionLine` gave (R7 third branch (c)/(d)); a resolved region without an honest
  cell label keeps the candidates region-less labels, like a named place. Extended to the take: when a place WAS named but its cells
  carry no honest label (the drop-never-guess rule that already emptied the copy), the region-less candidate is
  offered as a label only. Pinned both ways (a take with `ANSWER_FIRST_ENABLED` off still serves `NL01`).
- **Thread resume: carriers are still NOT restored** (ADR 033 ⟨A6⟩). `src/threads/replay.ts` used to drop every
  carrier-bound label; with all chips carrier-bound that would have emptied resumed answers. A present-only
  `ClickOption.questionShaped: true` (the four WP29 generators; absent on comparisons, the rescue chip and
  clarification options; accepted by the click-time schema as the literal `true` only) tells replay which
  carrier chips are complete questions — those replay as the plain fill-the-input chips they were before v2, the
  comparison labels are dropped as before. Resume behaviour is therefore exactly today's, deliberately.
- **Flag off is byte-identical in SHAPE** (same generators, same order, same dry-runs, no options, no `pending`
  key — the existing pins stay green). One copy change is flag-independent since review round 2: a B-defaulted
  answer's question chips name the country ("… in Nederland …") whether or not the flag is on — it is label
  copy, not carrier shape, and it is the honest wording either way. The carrier question (`questionNl`, never rendered) is now the neutral
  'Vervolg op dit antwoord:' (`CHIP_CARRIER_QUESTION_NL`); rows minted before carry the old comparison wording.
  `isRescuePending`'s 1..`MAX_CLICK_OPTIONS` (4) bound holds `MAX_SUGGESTIONS` (3) chips — pinned.
- **Web: the routing stays label-bound** (a label in `pending.options` goes to `replyToClarification`, anything
  else is a fresh question). `chat.tsx` did gain logic in the review rounds — per-message carriers and a
  send-time binding for a clicked chip (round 1 item (6) and round 2 below). `MAX_SUGGESTIONS = 3` chips are
  within the carrier's 1..4 bound.
- **Verification (this branch, per file):** `suggestions` 43/43, `comparison-chips` 22/22, `wp29-click-take`
  18/18 (new), `query-count` 10/10 (pins unchanged), `clarify-click` 19/19, `rescue-chip` 10/10,
  `wp26-trust-boundary` 4/4, `tests/threads` 32/32, `envelope-key-manifest` 9/9, both typechecks clean; the full
  suite, the benchmark and the real build run in the orchestrating session before merge. Zero prompt bytes, no
  migration, no env flag.
- **Review round 1 (orchestrator, PR #122, 2026-09-03 — full block green on `ba232a5`; six items fixed on the
  branch):** (1) CONFIRMED DEFECT at the trust boundary: `withValidatedClickOptions` passed a carrier's
  `options` through unfiltered while `clickOptions` was schema-filtered, so ONE dropped option left the
  carrier mis-shaped and the user's next text fell into the paid `parseClarificationReply` merge — a
  carrier's options now re-align to the surviving chips (a real clarification's options are untouched), and a
  carrier whose every chip was dropped is a STRIPPED carrier (`rescueOnly` + empty options + no chips,
  `isStrippedCarrier`) that routes every reply as a fresh question, never the merge (ADR 024 addendum
  corrected; the session-57 bare-forgery pin split into its two shapes). (2) The false "same topic cannot fire
  on the seed" claim corrected in three places and a REAL `topic-1` take pinned (above). (3) A NATIONAL trend
  take pinned (Nederland 2022–2026, five cells, line chart). (4) Zero takeable survivors on the real path
  pinned: the Utrecht-gemeente + Utrecht-provincie + Nederland answer (colliding base labels → label-only
  question chips, no comparison possible) carries two `suggestions` and NO `pending` key, through
  `respondToIntent` and `respondToQuestion`. (5) The full id triplets pinned on the Amsterdam and CPI rosters.
  (6) A UX trap widened by v2 fixed client-side: two answers' fixed-text chips can share a label and the client
  held ONE live pending, so an older answer's chip was taken against the NEWEST answer — `chat.tsx` now keeps
  each answer's carrier under its audit id (a ref, not the ChatMessage type) and a chip click re-binds the
  send to ITS answer's carrier; pinned in `chat.test.tsx`. Plus the label-keyed `questionShaped` lookup in
  `replay.ts` acknowledged as a documented fragility (no collision possible with today's fixed templates).
- **Review round 2 (session 74, 2026-09-03 — the HIGH-effort pass RUNBOOK batch item 10 asks for before a
  core-product PR merges; nine findings, the code ones fixed on the branch):** (1) round 1's client fix
  re-bound `pending` ON THE CLICK, which discarded an OPEN clarification round when the user glanced at an older
  chip and then typed a reply (the paid round went out as a fresh question) and lost the race with an in-flight
  answer overwriting `pending` — `chat.tsx` now binds a clicked chip to its message's carrier at SEND time
  (`chipRef`, only while the label goes out unedited), and the carriers are keyed by message index so a
  REFUSAL's rescue chip binds to its own carrier too; three pins. (2) A B-defaulted answer's question chips
  named no place while their minted intent named `NL01` — the take then served the national figure with no
  disclosure at all (R7 third branch (c)/(d) — v1's fresh parse re-fired the default and its `assumptionLine`);
  the copy now names the country (above). (3) The audit role of a STRIPPED carrier's standalone parse was
  'clarify' — the exact #177 mislabel, re-introduced for the shape round 1 added; now 'intent' (pinned). (4) The
  "a `rescueOnly` WITH options but without chips still merges" claim (respond.ts, ADR 024, the rescue-chip pin)
  held only for direct callers — the deployed path's boundary re-aligns a carrier's options first; scoped in all
  three places and the boundary pinned (`wp26-trust-boundary.test.ts`). (5) This note's own "no change to
  `chat.tsx` logic" bullet contradicted item (6) — corrected. (6) The label-collision premise behind replay's
  `questionShaped` lookup is now an explicit **Assumption** (replay.ts, [#73](../open-questions.md)). Not
  changed: chips stay clickable while a send is in flight (harmless with the send-time binding); the
  `ID_PREFIX`/`QUESTION_SHAPED` twin tables (a simplification, recorded). The LOW pass over this round added: a
  send whose captured thread is null (that turn's attach had failed) — a chip-bound take or a typed clarification
  reply alike — falls back to the LIVE thread (a null would have made the server open a new thread and fork the
  conversation — pinned for both paths, ADR 033 ⟨A6⟩ addendum); and one follow-up — the
  carriers are keyed by message INDEX in a ref, correct today (within a thread the list only appends; the reset
  clears the map) but an implicit coupling on a money-path route: once `web/lib/chat-message.ts` is free (after
  PR #123 merges) the carrier belongs ON the `ChatMessage`.
- **Veto points for the owner:** a clicked follow-up now reads in the plainer TEMPLATE phrasing (no LLM) — the
  ADR 024 trade every take makes; the price is unchanged at 20 credits per take ([#101](../open-questions.md)
  still open); the carrier question wording.

## As-built note (#195/#196 — the dry-run primitive no longer touches last_queried_at, session 72, 2026-09-03)

Session 67's adversarial review of PR #111 (the eviction/TTL feature, [#110](../open-questions.md)) found that
`echoServability` — the servability-probe primitive every chip generator in this ADR dry-runs through — shared
`runQuery` with the SERVED answer path, and `runQuery` bumped `cbs_tables.last_queried_at` unconditionally. Two
consequences, tracked as [#195](../open-questions.md) and [#196](../open-questions.md): a table could be kept
artificially "warm" for the eviction GC by chip-building traffic that never once delivered an answer (#195), and
a live read racing a concurrent eviction transaction could be served a false "no data" refusal instead of the
real answer, because the touch's own locking UPDATE forced the read to synchronize behind the eviction's row
lock (#196). Neither was a merge blocker for PR #111 (eviction `--apply` is manual/supervised only, no cron)
but both were flagged as must-close-before-any-live-automation.

**Fixed together, since #196's mechanism is exactly what made #195 possible to reproduce as a false refusal
rather than just an accounting nit.** `src/query/resolve.ts`'s `QueryOptions` gained a `probe?: boolean` field;
`echoServability` (`src/query/dry-run.ts`) now calls `runQuery(db, intent, { ...options, probe: true })` — every
comparison chip, follow-up chip and alternate-reading check in this ADR is therefore a probe by construction, with
no per-generator change needed. In `runQuery` (`src/query/run.ts`), the `touchLastQueriedAt` call moved from
BEFORE the observations fetch to directly AFTER it (still before the completeness loop, so a period refusal on
an otherwise-present, registered table still counts as demand — the original #110(b) design's intent, unchanged),
and is now skipped entirely when `options.probe === true`. **The semantics of `last_queried_at` are therefore
now "last SERVED/DELIVERED read", never "last touched by any internal machinery"** — the eviction anchor
(`src/ingestion/eviction.ts`) means what its own doc comment always claimed it meant. The READ-THEN-TOUCH order
also closes #196 directly: the observations fetch no longer waits behind an eviction's `select ... for update`
row lock (that lock contention was the touch's own UPDATE, not the fetch), so a read that arrives while an
eviction is still mid-transaction simply sees the pre-eviction data via ordinary MVCC. For the residual case
where the fetch genuinely runs AFTER an eviction has already committed (no lock contention needed — plain
timing), `runQuery`'s missing-cell branch now re-checks `cbs_tables` registration before calling `diagnoseMissing`
and returns an honest `table_not_registered` refusal (never `no_data`/`not_published`) naming that the table was
evicted while the query was in flight and can be asked again — one extra statement, only on that already-
exceptional path, never on a served answer ([#173](../open-questions.md) pooler budget).

Verified: `tests/query/last-queried.test.ts` (a probe read and `echoServability` both leave the clock untouched;
the existing served-bump pin still holds), `tests/query/eviction-race.test.ts` (new — a synthetic eviction
injected deterministically before vs. after the observations fetch, since PGlite serves one query at a time and
there is no real concurrency to race against: BEFORE → `table_not_registered`, never `no_data`/`not_published`/
`freshness`; AFTER → the answer still serves with the real cell values, unaffected by an eviction landing once
the fetch has already captured what it needed), `tests/answer/query-count.test.ts` (re-measured — see the "Cost,
measured" bullet above — plus a `set last_queried_at` statement count: exactly 0 across a full chip build, exactly
1 across one real served `respondToQuestion` turn), and `tests/ingestion/eviction.test.ts` unchanged.

**Round 2 (session 73, 2026-09-03, `ebd341f`) and MERGED + LIVE (PR #121 → squash `527ef2e`, session 75, 2026-09-03,
owner-approved in chat; CI run 33786945030 gate + deploy green, canaries 200):** a HIGH-effort review of the round-1 fix
found fifteen verified items (the moved touch still queued behind an eviction's row lock; a TOCTOU in the re-check that
could re-create the false `not_published`; raw period codes, a too-new sync date and a silenced staleness warning in
the same race; the benign race paging the owner as an internal error). Fixed: the `last_queried_at` touch takes the row
`for no key update skip locked` in a subquery — a locked, eviction-eligible row is SKIPPED, never waited on (NO KEY so an
ingestion insert's FK KEY SHARE never causes a spurious skip); the observations fetch LEFT-JOINs the period labels and
the retained cells' batch dates — one statement, one snapshot; the registration check runs LAST in `diagnoseMissing`'s
`not_published` branch (the only branch a fully evicted table can reach); an eviction landing mid-flight yields the new
`RefusalKind` `table_evicted` → `RefusalReason` `evicted` with honest Dutch copy ("stonden in onze database, maar zijn
zojuist opgeruimd … stel je vraag opnieuw"), never the owner alert; `ValidatedResult.registry` (present-only:
`updateCadence` + the table's `lastSyncAt`) is carried from `resolveIntent`'s row so `checkStaleness` re-reads nothing
after the fetch. Tests: four committed-eviction interleavings, a served turn pinned to read nothing after the fetch, the
statement tripwires re-measured (per served turn 13→12 / 9→8 / 13→12 / 14→13, per successful dry-run 24→21 / 10→8 /
15→12), the new reason / silent alert / no-re-read path pinned; docs/05's failure table has the evicted-mid-flight row.
**Structural follow-up, recorded not built:** `resolveIntent`'s canonical-measures lookup and label reads race the same
eviction one step earlier — eviction must YIELD to in-flight reads (a `pg_advisory_xact_lock` per table the read also
takes, or a marked-for-eviction grace state) before any live automation of `tables:evict --apply`; see row
[#196](../open-questions.md).

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
  regional single answer (Amsterdam 2024) costs 24 statements / 3 dry-runs with the flag OFF **and** ON — the
  cap stops the roster after three survivors and the region comparison takes the slot the region variant
  took, one dry-run for one; a national answer (Nederland 2026) 36 / 4 either way; a national-only measure
  (CPI 2024) 10 / 2 OFF → 15 / 3 ON (the period comparison fills the free slot). Worst case, with early
  generators failing their dry-runs: 8 dry-runs ON vs 6 OFF (a FAILED dry-run never reached the touch line
  either, so this figure is unaffected by the #195 fix below). Every dry-run is a full `runQuery`, but —
  since the [#195](../open-questions.md) fix (as-built note below) — **no longer** includes the #110
  `touchLastQueriedAt` statement: these numbers were re-measured 2026-09-03 and are 3/2/3 lower than the
  27/12/18 originally measured 2026-09-02, one fewer statement per dry-run, exactly the touch that used to
  fire on each one. The 36-statement national-answer figure was not independently pinned by a test either
  before or after this fix (unlike the other two rows) — measured directly for this addendum, not carried
  forward from the original note (which had understated it by one dry-run's worth even before the fix).
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
  half, see the fourth as-built note below. The regional chip shipped later ([#138](../open-questions.md), session 55, commit `f2d015a` — see the fifth as-built note if present, else the row).
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
  table gains a second canonical measure. *(➡ No longer true: the registry has since grown to five
  tables with several canonical measures — 83693NED, 85880NED, 85770NED, 85828NED, 85429NED — so the
  generator fires on real data; its take is pinned in the #73 v2 note above.)*
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
  unreachable on the Phase-0 seed, activates only with a future second measure per table — *➡ reachable
  since the registry grew; the wording is a recorded copy wart, see the #73 v2 note*);
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
recognizes the label. v1 and v2 are the same handler.** **➡ #73 v2 as built (session 72, 2026-09-03): the
no-re-parse half of v2 is now DELIVERED — not by a handler swap but by minting a ClickOption for every takeable
chip on the WP26 chip carrier (the #197 mechanism), so a live click takes the stored intent through the zero-LLM
`templateOnly` rung; the handler is still unchanged, and the fresh parse remains only the fallback where no carrier
exists (flag off, a resumed thread, an old bundle in the deploy window). See the v2 as-built note at the top.**
*Residual v1 risk, accepted + recorded (closed structurally on the live turn by v2, still the fallback's
property):* between chip display and
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
  recognising the label byte-exactly.** **Update (session 72, 2026-09-03): the OUTCOME this trigger wanted — no
  re-parse on a click — is now delivered by #73 v2 through the chip carrier (an option per chip, handler
  untouched); see the v2 as-built note.**
- Measured: a filled chip question that produced a clarification round (audit rows show it) →
  tighten that generator's template or drop it.
- Onboarded-answer surface (#117/#74 dashboard work) → extend chips there with the same generators.
