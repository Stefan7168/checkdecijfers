# WP30c phase E1 — executor brief: Eurostat adapter + internal explorer

**Written:** 2026-09-14, session 101 continuation (autonomous overnight, owner asleep/away).
**Authority order for this brief:** [ADR 048](../decisions/048-eurostat-data-source.md) (the design,
including its own pre-build adversarial review's Amendments 1–12) → [08-build-plan.md](../08-build-plan.md)'s
WP30c entry → [how-to-add-a-source.md](../how-to-add-a-source.md) (the operational recipe) → this brief (the
line-by-line translation of all three into buildable tasks, plus this session's own scoping decision below).
Per the WP27/WP30a/WP30b precedent, this brief itself gets a second, independent pre-build adversarial review
before any code is written — ADR 048's review checked the *design*, not this frozen brief.

## Scope

E1 only: the adapter, registry entry, conformance harness, fixture capture tooling, the two D7 migrations
(file-only), the source-scoped catalog prune, the Amendment-3 deny-gate test, and an internal
`EUROSTAT_EXPLORER_ENABLED`-gated explorer. E2 (natural-language querying) and E3 (research assistant) are
out of scope and must not be started. The pattern-discovery track (ADR 048 D10) is out of scope permanently
until its own future ADR.

## Constraint 0 — no live Eurostat API calls this session (new scoping decision; the adversarial review must
check this explicitly)

[08-build-plan.md](../08-build-plan.md)'s WP30c entry states: *"Live DDL (the D7 migrations) and any real
Eurostat API spend stay owner-supervised, never autonomous (guardrail 4 above)."* This session reads that
literally: **no live HTTP call to the real Eurostat Statistics API or Catalogue API happens in this
autonomous session**, even though the API is free/public and read-only — the same caution this project
already applies to first contact with any new external system (Stripe, live DDL), extended here on the
build-plan's own explicit instruction, not this session's own invention.

**Consequence, stated honestly rather than papered over:** ADR 048's own E1 done-definition (D9) requires
real captured fixtures replaying through real parse code, ≥3 real datasets rendered on the dev server, and
a live smoke probe confirming the 500k/5M/413 cell-count thresholds (Amendment 12). **None of these three
are achievable this session.** This brief's own done-definition (below) is therefore narrower than ADR 048's
E1 done-definition — it builds everything that does not require a live call, and leaves one clearly-scoped
owner-supervised follow-up: run the fixture-capture script, then re-run the conformance suite and the
explorer against real data. This mirrors the existing pattern for migrations (file-only, owner applies) —
treating "first real contact with a new external API" the same way.

If this reading turns out to be overly conservative (the owner may have meant "spend" in the literal money
sense, and a free read-only GET carries no such cost), that is the owner's call to make on PR review, not
this session's to assume — the PR body will say so explicitly and point at this paragraph.

## Amendments from this brief's own second pre-build adversarial review (4 lenses, run in parallel against
this frozen brief, same discipline ADR 048 itself got: data integrity/invariants, rollout enforceability,
technical feasibility, architecture-fit/regression — each briefed to refute by default. 8 raw findings → 6
confirmed (1 cross-lens corroborated), folded into the tasks below as amendments; nothing was reported that
didn't survive scrutiny.

**Amendment B1 — CONFIRMED, HIGH (data-integrity lens), folded into Task 1/2 below.** As originally written,
Task 1 routed Eurostat's per-cell flags into `CbsObservationRow.valueAttribute`, while Task 2 built
per-flag `provisionalDisplay` suffixes keyed on `cell.status`. These two fields are **not the same
mechanism**: reading `src/ingestion/pipeline.ts` (531–566) shows `status` is set only from
`periodStatusByCode`, a map built from a **per-period-code** lookup (`fetchCodeList('Perioden')`) — the CBS
shape, where every cell in a period shares one status. `valueAttribute` feeds a completely different path
(`nullReasonText`, fires only when `value === null`). A real Eurostat cell with a non-null value and a `p`/
`f` flag would therefore render as fully definitive — a genuine R11 violation, exactly the risk principle
(c) exists to prevent — and nothing in E1's synthetic-fixture/conformance testing would catch it (F2/F3
never invoke `pipeline.ts`). This is precisely the tension ADR 048's Assumption 4 already flagged as
requiring "an ADR-recorded adapter-contract amendment, never a silent workaround" if it turned out real —
it did. **Fix, scoped to stay inside E1 without touching `pipeline.ts` (a shared, CBS-tested, live-money-
path file — a real pipeline change to carry per-row status is E2/a dedicated follow-up, not this brief):**
the Eurostat registry entry's `definitiveStatuses` is `[]` (empty), not `['']`. Per `isProvisionalStatus`,
an empty list means **every** Eurostat cell renders provisional (the generic ' (voorlopig cijfer)'-
equivalent suffix), regardless of what `periodStatusByCode` produces — the safe fail-direction, over-
cautious never under. Task 2's per-flag `provisionalDisplay` suffixes (p/e/s/f/b/c/d/u/n) stay in the
registry as forward documentation for when real per-cell status plumbing exists, but are **inert in E1** —
say so explicitly in the code comment on the registry entry. Record a new residual (below) and an ADR 048
as-built note: real per-cell provisional propagation needs its own scoped pipeline change before any
Eurostat cell is ever shown as anything but maximally-cautious-provisional.

**Amendment B2 — CONFIRMED, HIGH, cross-lens corroborated (data-integrity lens + rollout-enforceability
lens independently), folded into Task 4 below.** The Amendment-3 deny-gate test, as originally scoped
("assert a live NL chat question can never surface an eurostat:-id result while the flag is unset"), can
pass **vacuously** — E1 registers zero real Eurostat tables (Task 7's own honest empty state), so with
nothing in the finder's search space to return, the assertion is true regardless of whether the new guard
code exists, is correct, or was ever written. This is the exact "incidental gate" failure ADR 048's own
Amendment 3 was written to eliminate, recurring here for a different incidental reason (empty registry
instead of the unlifted language filter). **Fix:** the test MUST hand-insert a synthetic `eurostat:`-
prefixed candidate row into the test DB (mirroring Task 5's own instruction for the prune isolation test) —
a negative case (flag unset → the candidate is never returned) AND a positive control (flag set → the SAME
candidate IS returned), proving the guard is real and not incidental.

**Amendment B3 — CONFIRMED, MEDIUM-HIGH (rollout-enforceability lens), folded into Task 7 below.** Task 7
originally said only "gated by `EUROSTAT_EXPLORER_ENABLED`" without naming the mechanism. This codebase
already has an established, tested pattern for exactly this (`web/app/geschiedenis/page.tsx`:
`if (process.env.WORKSPACE_ENABLED !== '1') { redirect(...) }`) — and its own history includes a real
regression of precisely this shape (a flag-gate omitted on a route, the #135/`/login` fix). **Fix:** Task 7
names the mechanism explicitly (the same `redirect()`-on-flag-unset pattern) and requires a flag-off test
proving the route redirects when the flag is unset, not just a flag-on test proving the route works.

**Amendment B4 — CONFIRMED, HIGH (technical-feasibility lens), folded into Task 1/3/4 below.** The original
plan to make the conformance harness's F2 family "exercise" a semester-grain refusal via a throwing fixture
is self-contradictory against the real `src/sources/conformance.ts` code: every table in a source's
`conformance.json` gets `fetchTableSchema`/`fetchCodeList` called unconditionally, wrapped in a per-table
`try/catch` that records ANY thrown error as a generic `F1_replay` failure and fails the whole suite — there
is no "expected to throw" mechanism anywhere in the harness (confirmed by reading `conformance.ts` and
grepping `how-to-add-a-source.md`). The only escape hatch, `schemaOnly` (CBS's own `80416ned` daily
specimen), **skips** the F2 check entirely rather than exercising it. A throwing adapter and a green
`npx vitest run tests/sources` run (Done-definition item 2) are mutually exclusive for this fixture as
originally planned. **Fix:** drop the semester-grain fixture from `conformance.json`/the harness path
entirely. Prove the refusal with a plain, standalone unit test directly on `jsonstat.ts`'s parser — call it
with a hand-built semester-grain JSON-stat payload, assert it throws `UnsupportedGrainError`. This needs no
conformance-harness involvement at all.

**Amendment B5 — CONFIRMED, HIGH (architecture-fit lens), folded into Task 6 below.** `buildAnswerProof` has
**three** call sites, not the one Task 6 assumed: `web/lib/replay-assemble.ts` and
`web/components/question-history.tsx` are genuinely server-side, but `web/components/chat.tsx` is
`'use client'` and calls it directly in the browser on data the `askQuestion` Server Action already
returned — that action never touches `buildAnswerProof` today. Task 6's instruction ("fetch
`request_urls` alongside the proof build, in the server component/action that currently calls it") is
simply impossible at the `chat.tsx` site — there is no server context to add a DB lookup into. Threading
`request_urls` into live chat would mean touching `askQuestion` itself (a request-path, money-path,
heavily-invariant-tested function) and the response payload shape — real scope this brief never budgeted.
**Fix:** Task 6 wires the live `request_urls` lookup ONLY at the two genuinely server-side call sites
(`replay-assemble.ts`, `question-history.tsx`). The live chat proof panel (`chat.tsx`) does **not** show
`request_urls` in E1 — a named, explicit residual, not a silent gap — until a follow-up threads it through
`askQuestion`'s response payload. This does not weaken D7(b) dishonestly: the field degrades gracefully
(absent), exactly the R8-safe behavior the ADR already requires for a missing value.

**Amendment B6 — CONFIRMED, HIGH (architecture-fit lens), folded into Task 5 below.** `ingestCatalog`'s
existing signature (`src/catalog/ingest.ts:47`) is already `ingestCatalog(db: Db, source: CbsSource)` —
`source` is the **adapter instance**, not a key string, and `CbsSource` carries no identity field. Task 5's
"add a `source` parameter" collides with this and doesn't say where a source-KEY comes from, doesn't
mention `src/catalog/cli.ts` (the only real call site) needs updating to pass one explicitly, and doesn't
mention the 9 existing tests in `tests/catalog/ingest.test.ts` all call today's two-argument shape. **Fix:**
Task 5 is rewritten below to add an explicit, caller-supplied `sourceKey: string` parameter (not derived
implicitly), update `cli.ts` to pass `CBS_SOURCE_KEY`/the eurostat key explicitly, scope the prune's WHERE
clause by the already-live migration-016 `source` column, update all 9 existing tests to pass the CBS key
(proving CBS-only behavior is unchanged — byte-identical prune count), and add the new cross-source
isolation test with two hand-inserted rows of different sources.

## Task 1 — `src/eurostat-adapter/` (models `src/cbs-adapter/`)

- `src/eurostat-adapter/types.ts` — re-exports/aliases the shared wire types from `src/cbs-adapter/types.ts`
  under neutral names where the ADR's D1 contract needs a Eurostat-specific detail (the per-unit measure
  synthesis, D6) that doesn't exist on the CBS side; otherwise reuses `CbsTableSchema`/`CbsCode`/
  `CbsObservationRow`/`CbsSlice`/`CbsCatalogEntry`/`CbsSource` verbatim (D1: "no new provider abstraction").
- `src/eurostat-adapter/jsonstat.ts` — the JSON-stat 2.0 parser: dataset → `CbsTableSchema`/`CbsCode[]`/
  `CbsObservationRow[]`, implementing D6's obligations:
  - Period grammar: `2024` → `2024JJ00`, `2024-Q1` → `2024KW01`, `2024-M01` → `2024MM01`, round-trip via the
    existing `parsePeriodCode`/`encodePeriodCode`; **semester/weekly/daily datasets are refused** (throw a
    typed `UnsupportedGrainError`, never silently mapped). **Per Amendment B4: this refusal is proved by a
    plain, standalone unit test directly on this parser function (a hand-built semester-grain JSON-stat
    payload → assert it throws) — NOT via the conformance harness.** The harness's `F1_replay`/`schemaOnly`
    mechanics cannot represent "expected to throw" (confirmed against the real `conformance.ts` code); do
    not add a semester fixture to `conformance.json` (see Task 3/4's revised scope).
  - One measure per distinct `unit` code (`<dataset>|<unit code>`; title = dataset title + unit label; `unit`
    = the unit label verbatim; `unit` pinned in the slice so a table never mixes units, R10); `decimals` from
    the fixture's observed maximum precision.
  - Status/flag strings (`p e s f b c d u n z :`) ride verbatim into `CbsObservationRow.valueAttribute` for
    R11 null-reason purposes (fires when `value === null`) — but **per Amendment B1, this is NOT how
    provisional-cell marking works for a non-null flagged cell** (e.g. `p`/`f` on a real published figure):
    `src/ingestion/pipeline.ts`'s `status` column comes only from a per-PERIOD-code lookup
    (`periodStatusByCode`, the CBS shape), which has no path for per-cell data at all. Do not attempt to
    route the flag into `status` in this adapter — there is no mechanism to do so without a `pipeline.ts`
    change, which is explicitly out of scope for E1 (see Task 2's registry fix, which handles this safely
    without touching the pipeline).
  - Per Amendment 7: `parseFactorUnit`/`baseLabel` calls for Eurostat data must fail open **and log** (a
    console/error-log entry, not silence) on a mismatch — implement the logging now even though the
    "verified against real data" half of Amendment 7 is blocked by Constraint 0 and stays open (see Residuals).
- `src/eurostat-adapter/statistics-api.ts` — the live `SourceAdapter` implementation (Statistics API for
  observations, Catalogue API for `fetchCatalog`), JSON-stat 2.0 over REST, synchronous only (D6: refuse
  server-side any dataset whose declared cell count would need the async API — a typed refusal, not a hang).
  **This file is written but never invoked with a real URL in this session** (Constraint 0) — its own unit
  tests use dependency-injected fetch stubs returning hand-built, clearly-labeled-synthetic JSON-stat 2.0
  payloads (see Task 3), never a live network call.
- `src/eurostat-adapter/fixture-source.ts` — replays captured raw responses through the real
  `jsonstat.ts` parser (the `FixtureSource` pattern), modeled directly on
  `src/cbs-adapter/fixture-source.ts`.
- `src/eurostat-adapter/capture-fixtures.ts` (a script, `scripts/capture-eurostat-fixtures.ts` entry point +
  a `fixtures:capture:eurostat` package.json script, modeled on `scripts/capture-cbs-fixtures.ts`) — **built,
  never run this session.** Its own header comment must say explicitly: "OWNER-RUN STEP — this session did
  not execute this script (Constraint 0); run it, then re-run `npx vitest run tests/sources` and the explorer
  smoke check before treating E1 as done against real data."

## Task 2 — registry entry (`src/sources/registry.ts`)

Add a `eurostat` entry to `SOURCES` (`SourceInfo`), values drawn from ADR 048 D6/D7/Assumption 11 (owner-
signed wording, taken directly from the ADR's own text — flag as still-a-sign-off in the PR body, since the
ADR records the wording but this brief doesn't re-litigate it):

- `key: 'eurostat'`, `displayName: 'Eurostat'`, `attributionLabel: 'Eurostat'`, `license: 'CC BY 4.0'`.
- `deepLink: (tableId) => `https://ec.europa.eu/eurostat/databrowser/view/${nativeIdFrom(tableId)}/default/table`` —
  `nativeIdFrom` strips the `eurostat:` prefix (never the caller's job, per D4 — the registry entry owns this
  internally, consistent with how CBS's deep link takes the bare id).
- `provisionalDisplay`: a suffix per non-empty flag D6 lists (`p`, `e`, `s`, `f`, `b`, `c`, `d`, `u`, `n`) —
  Dutch wording drafted from the ADR's own D6 prose, marked in the PR body as pending final owner sign-off
  per Assumption 11 (this is display-only, R11-covered, never a numeric risk). **Per Amendment B1, this map
  is INERT in E1** — nothing today can key into it per-cell (see below) — kept only as forward documentation
  for when a real per-cell status mechanism exists; say so in the code comment directly above it.
- `definitiveStatuses: []` (empty — **deliberately NOT `['']`, a deviation from D6's literal text, per
  Amendment B1**). D6 says the unflagged state is definitive, but `isProvisionalStatus` can only ever see
  the per-PERIOD status `pipeline.ts` derives (never a per-cell flag — there is no plumbing for that without
  a pipeline change, out of scope for E1). An empty `definitiveStatuses` makes `isProvisionalStatus` return
  `true` unconditionally: **every** Eurostat cell renders provisional (the generic suffix), regardless of its
  real flag. This is the safe direction (over-cautious, never under) and requires no pipeline change. Record
  in ADR 048's as-built note: real per-cell provisional propagation is a follow-up pipeline change, required
  before any Eurostat cell may render as definitive.
- `nullReasonLabels` for `:` and `c` and `z` (per D6's null-reason list).
- `currentCatalogStatuses`: whatever Eurostat's Catalogue API declares as its "current" lifecycle status —
  **this is genuinely unknown without a live catalog call (Constraint 0).** Do not guess; leave a typed
  `TODO` referencing this brief and Constraint 0, with the safe fallback behavior (an unrecognized status
  already falls back to "not current" in `current-status.ts`'s fail-direction, per the registry's own
  documented contract) — this degrades gracefully, not silently wrong, so it is acceptable to ship with the
  value list empty pending the owner's first live catalog capture.

## Task 3 — fixtures (synthetic, explicitly labeled, not asserted as real)

`tests/fixtures/eurostat/` gets:
- 2–3 hand-built JSON-stat 2.0 payloads, constructed strictly from the public JSON-stat 2.0 spec's documented
  shape (dimension/id/size/value/status arrays), covering: one annual dataset, one quarterly dataset with a
  `b`-flagged cell, one dataset exercising the per-unit measure split (≥2 `unit` codes). **Every fixture file
  and the conformance manifest carry a `"synthetic": true` field and a header comment**: "Hand-built to the
  JSON-stat 2.0 spec, NOT captured from the live API (Constraint 0, this brief) — replace via
  `npm run fixtures:capture:eurostat` before treating adapter conformance as proven against real data."
- `tests/fixtures/eurostat/conformance.json` per the guide's shape (`declaredPeriodStatuses`,
  `declaredValueAttributes` = the flag list, `declaredCatalogStatuses`, `declaredDatasetTypes`). **Per
  Amendment B4: no semester/weekly/daily-grain fixture goes into this manifest** — the grain refusal is
  proved by Task 1's standalone parser unit test instead, which needs no conformance-harness fixture at all.
  Every table listed here must be one E1 actually claims is deliverable.

## Task 4 — conformance harness wiring

- One `FIXTURE_ADAPTERS['eurostat']` line in `tests/sources/conformance.test.ts`, replaying through the real
  `fixture-source.ts` → `jsonstat.ts` parser (per the guide's step 4 — this is genuine code-level conformance
  even though the underlying fixture data is synthetic).
- **Amendment 8 decision, made explicit here rather than left implicit:** the new D7 fields (DOI,
  `request_urls`) are **not** given a new conformance family. The R1 token-scan test (already run over every
  answer body) is judged sufficient as the sole belt for these two fields, because neither is a computed
  numeric value or a cell attribute the F0–F5 families exist to police — they are provenance metadata
  attached at proof-render time, structurally incapable of feeding a fabricated number into an answer body.
  State this reasoning in the code comment on the DOI-rendering function and in ADR 048's as-built note; if
  the adversarial review disagrees, that is exactly the kind of finding this second review pass exists to
  catch.
- **Amendment 3 test** (new, in `tests/query/` or wherever the finder's live-path integration tests live —
  find the right file, don't create a parallel suite): an explicit assertion that a live NL chat question can
  never return a result whose `tableId` resolves to `sourceKeyForTableId(tableId) === 'eurostat'` while
  `EUROSTAT_EXPLORER_ENABLED` is unset — asserted via a real `source`/flag check in the finder/query path
  added for this purpose, not incidentally via the still-unlifted `language = 'nl'` filter (which remains
  unlifted in E1 regardless — D4 discovery step (i) is E2 scope). **Per Amendment B2: this test MUST
  hand-insert a synthetic `eurostat:`-prefixed candidate row into the test DB first** (E1's real registry is
  otherwise empty, which would make the assertion pass vacuously and prove nothing) — write BOTH a negative
  case (flag unset → the candidate is never returned by the live query path) AND a positive control (flag
  set → the same candidate IS returned), so the test can only pass if the new guard code genuinely exists
  and works.

## Task 5 — wiring point 1: source-scope the catalog prune

`src/catalog/ingest.ts:66`'s prune (`delete from cbs_catalog where refreshed_at < $1`) currently has no
`source` predicate — a second source's `catalog:refresh` would delete every CBS mirror row. **Per Amendment
B6: `ingestCatalog`'s existing signature is already `ingestCatalog(db: Db, source: CbsSource)` where
`source` is the ADAPTER INSTANCE, not a key** — do not reuse that name for a key. Concretely:

1. Add a new, explicit, caller-supplied parameter — `ingestCatalog(db: Db, source: CbsSource, sourceKey: string)`
   (name it however reads best once you see the call site; the point is it is supplied by the caller, never
   derived implicitly inside `ingestCatalog`).
2. Update `src/catalog/cli.ts` (the only real call site) to pass the key explicitly — `CBS_SOURCE_KEY` for
   today's CBS refresh, the eurostat key once that adapter exists.
3. Scope the prune's WHERE clause by that key, using the already-live migration-016 `source` column (confirm
   it is genuinely live in the current schema before relying on it — don't assume from the ADR text alone).
4. Update all 9 existing tests in `tests/catalog/ingest.test.ts` to pass the new parameter (the CBS key) —
   and add an explicit assertion that a CBS-only refresh's prune count/behavior is byte-identical to before
   this change (not just "the new isolation test passes").
5. Add the new cross-source isolation test: two hand-inserted rows of different sources in a test DB, prove
   a refresh scoped to one source's key cannot delete the other's row.

This is pure code + hermetic tests; it does not depend on Constraint 0 and should be built and verified
fully in this session.

## Task 6 — D7: DOI + request_urls

- Two migrations, **file-only, numbered `031` and `032`** (031 was free at brief-writing time; the executor
  double-checks `migrations/` for the actual next free number before naming files — do not assume 031/032
  are still free by build time):
  - `031_source_doi.sql`: additive nullable `doi text` on `cbs_tables` and `cbs_catalog`.
  - `032_ingestion_batch_request_urls.sql`: additive nullable `request_urls text[]` on `ingestion_batches`.
  - Both migrations are **written, reviewed, tested against the hermetic PGlite harness the existing
    migrations use, and left unapplied** — no `db:migrate` run this session (Constraint per the kickoff
    brief's hard bounds, independent of Constraint 0).
- `Attribution` (wherever the type lives — check `src/answer/` for the exact module before assuming) gains
  an optional `doi?: string` field, populated at query time from the resolved table's `cbs_tables.doi` column
  (mirrors how `tableId`/`tableTitle` already get onto `Attribution` — follow that existing wiring, don't
  invent a new path). `buildAttributionLine` (`src/answer/compose/format.ts:311`) renders, for
  `source === 'eurostat'` only, the D7(a) sentence: *"Bron: Eurostat, dataset {code} — {titel} (DOI {doi}).
  Gegevens gesynchroniseerd op {datum}. Licentie: CC BY 4.0."* — falling back to the existing CBS-shaped
  sentence when `doi` is absent (pre-Eurostat rows, or a Eurostat row whose DOI wasn't captured), never
  throwing on a missing DOI (R8: an absent DOI renders no DOI clause, per D7).
- `web/lib/answer-proof.ts` (verified: a pure, synchronous, DB-free leaf, per Amendment 6) gains a genuinely
  new, explicit read: a live lookup of `ingestion_batches.request_urls` by the envelope's already-stored
  `batchId` (line 68/147 in the current file), fetched **alongside** the proof build and passed in as an
  extra prop — kept **outside** the R8-reconstructed envelope (never denormalized into it, per Amendment 6).
  Rendered under the panel's existing "Technische details" toggle. Byte-parity tests: a replay with no
  `request_urls` lookup available (batch row deleted/absent) must render the rest of the panel unchanged, not
  throw.
  **Per Amendment B5: `buildAnswerProof` has THREE call sites, not one** — `web/lib/replay-assemble.ts` and
  `web/components/question-history.tsx` are genuinely server-side (wire the lookup there, exactly as
  originally planned); `web/components/chat.tsx` is `'use client'` and calls it directly in the browser on
  data `askQuestion` (a Server Action) already returned — there is no server context at that call site to
  add a DB lookup into, and reaching one would mean touching `askQuestion` itself (a request-path, money-
  path function) and its response payload shape, which is out of E1's scope. **Do not attempt this at the
  `chat.tsx` site.** The live-chat proof panel simply omits `request_urls` in E1 — an explicit, named
  residual (below), not a silent gap; it degrades gracefully exactly like an absent DOI does.

## Task 7 — the internal explorer

`web/app/eurostat-explorer/` (or wherever internal flag-gated tooling already lives — check for an existing
convention, e.g. how `EUROSTAT_EXPLORER_ENABLED`'s sibling flags like the coverage-sprint tooling are routed,
before inventing a new one), gated by `EUROSTAT_EXPLORER_ENABLED` (unset in production; `noindex` meta tag
regardless of flag state, per D3(a)). **Per Amendment B3: name the exact mechanism, don't just say
"gated."** Use this codebase's own established pattern (`web/app/geschiedenis/page.tsx`:
`if (process.env.WORKSPACE_ENABLED !== '1') { redirect(...) }`) — this exact class of bug (a flag-gate
omitted on a route) already caused a real regression once (#135/`/login`). Require a flag-OFF test proving
the route redirects when the flag is unset, in addition to a flag-ON test proving the route works — not
just the latter.
- Pick a registered Eurostat dataset (only ones actually ingested — none exist yet this session, since
  ingestion needs real fixtures per Constraint 0) → filter → the **real** `runQuery` → `buildChartSpec` path
  (zero new query/chart code, D5) → table + chart render → CSV export via `buildAnswerCsv` → the proof panel
  underneath (Task 6). Zero LLM calls anywhere in this route (D5c).
- **Honest state to ship:** the explorer route, its UI, and its wiring to the real pipeline are built and
  unit/integration-tested against the synthetic fixtures' registered shape, but it cannot show "≥3 real
  datasets" this session (Constraint 0 — nothing is really ingested yet). Say this plainly in the route's own
  empty-state copy ("no Eurostat tables are registered yet") and in the PR body, not just in this brief.

## Task 8 — D3(b) byte-identity re-check

Re-run (don't just assume unchanged) `coverage-disclosure.test.tsx`, `web/app/privacy/page.test.tsx`,
`web/app/galerij/page.test.tsx` — all three already assert Eurostat's genuine absence post-Amendment-1. This
brief's changes must not touch any of the three; the task is verification, not new code.

## Verification block (full, before opening the PR)

Root + web typecheck; full backend suite (solo, since the 8GB-machine OOM lesson applies — see
[[feedback_verify_exit_codes]]); full web suite; hermetic benchmark 14/14 + 6/6 + 0 fabricated (must be
byte-identical to the pre-brief run — zero prompt bytes, D5c); real `next build`; `npx vitest run
tests/sources` green with `eurostat` as a second positive control over the synthetic fixtures;
`/code-review` LOW pass, 0 outstanding findings, per the standing verification-block rule.

## Done-definition for THIS brief (narrower than ADR 048's E1 done-definition — see Constraint 0)

1. `src/eurostat-adapter/` exists, models `src/cbs-adapter/` structurally, implements `SourceAdapter`.
2. Registry entry + `adapterFor` line exist; `tests/sources` green with eurostat as a second positive
   control over synthetic, explicitly-labeled fixtures.
3. Wiring point 1 (catalog prune) fixed and regression-tested.
4. The Amendment-3 deny-gate test exists and passes.
5. The two D7 migrations exist as reviewed, hermetically-tested files — not applied.
6. DOI rendering + request_urls lookup are built and tested against the synthetic data path.
7. The internal explorer route exists, flag-gated, wired to the real pipeline, with an honest empty state.
8. D3(b) byte-identity confirmed unchanged.
9. Full verification block green.
10. Docs updated in the same change: ADR 048 as-built note (naming Constraint 0 explicitly as this session's
    scoping decision, not an ADR amendment), the 08-build-plan WP30c entry, open-questions rows for every new
    residual below, STATUS, lessons-learned.
11. Branch + PR opened against `main`, never merged (autonomous, core-product, #118(b)). PR body states
    Constraint 0 plainly and lists the owner-run follow-up (fixture capture → re-run conformance/explorer/
    Amendment-12 smoke probe against real data) as the single next step before E1 can be called done against
    ADR 048's own bar.

## Residuals this brief deliberately leaves open (record in open-questions.md)

- Real fixture capture, the Amendment-12 live smoke probe, and "≥3 real datasets rendered" — blocked on
  Constraint 0, owner-run.
- `currentCatalogStatuses` for Eurostat — unknown without a live catalog call.
- Amendment 7's "verified against real data" half — the fail-open+logged code ships now; the verification
  itself needs real data.
- The exact Dutch wording for `provisionalDisplay`/`nullReasonLabels` — drafted from the ADR, needs final
  owner sign-off per Assumption 11 (routine, not a blocker to building).
- **New (Amendment B1): real per-cell provisional-status propagation.** E1 ships with `definitiveStatuses:
  []` (every Eurostat cell renders provisional, the safe direction) because `pipeline.ts`'s `status` column
  has no per-cell path — only a per-period-code one (the CBS shape). A real fix needs a scoped `pipeline.ts`
  change (carry an optional per-row status override from the adapter, falling back to `periodStatusByCode`
  when absent — byte-identical for CBS) with its own review, before any Eurostat cell can honestly render as
  definitive. Required before E2 shows Eurostat cells to a real user with any nuance beyond "always
  provisional".
- **New (Amendment B5): `request_urls` is not wired into the live-chat proof panel (`chat.tsx`) in E1** —
  only the replay and history views show it. Threading it into live chat needs `askQuestion`'s response
  payload extended, a request-path/money-path change, its own scoped follow-up.
