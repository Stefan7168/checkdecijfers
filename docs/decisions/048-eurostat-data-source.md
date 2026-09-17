# ADR 048 — Eurostat as the second data source: adapter, catalog, pipeline, proof, and geography sequencing

**Status:** accepted at design level, 2026-09-14 (owner present in chat; three constraints settled there and
recorded at [open-questions #248](../open-questions.md) and in ADR [030](030-multi-source-architecture.md)'s
revisit-trigger addendum). **Not scheduled, no work-package number, no code.** Per the WP27/WP30 precedent, the
execute session runs the pre-build adversarial design review BEFORE writing code; the frozen executor brief
comes out of that review, not out of this ADR alone. **Pre-build adversarial design review completed same day
(4 lenses: data integrity/invariants, rollout enforceability, technical feasibility, architecture-fit/regression;
11 raw findings → 1 confirmed blocker fixed immediately outside this ADR, 5 more confirmed/cross-lens-corroborated
and folded into D3/D4/D5/D7/D9 below, 2 minor/no-fix-needed, 1 already-handled). See "Amendments from the
pre-build adversarial design review" below.
**Deciders:** Stefan (scope, destination, rollout posture); session (the engineering shape).
**Input:** the design spike [superpowers/specs/2026-09-14-eurostat-v2-design.md](../superpowers/specs/2026-09-14-eurostat-v2-design.md)
(§3 and §5 are what this ADR commits to; §4 is explicitly outside it — see D10).

## Context

ADR [047](047-repositioning-embedded-sourced-chart.md) (2026-09-13) named Eurostat as source two — *"after CBS's
current work settles, demand-driven and never announced before it answers"* — and required its own ADR before
any code, per the narrow-waist pattern ADR [030](030-multi-source-architecture.md) built for exactly this: a
code-level source registry (`src/sources/registry.ts`), a source-neutral adapter contract (`SourceAdapter`, the
alias of `CbsSource` in `src/cbs-adapter/types.ts`), prefixed table ids + a `source` column (D4, migration 016),
an executable conformance harness (`src/sources/conformance.ts`, families F0–F5) and a
[how-to-add-a-source guide](../how-to-add-a-source.md) listing seven verified, still-unwired WP30c landmines.
WP30a and WP30b are live; WP30c — the first real second source — was owner-deferred at
[open-questions #123](../open-questions.md) pending the choice of source. ADR 047 made that choice: Eurostat.

The [product vision's ICP](../01-product-vision.md) names Eurostat directly (the person "knows the number exists
at CBS or Eurostat but not where"; segment 4 is "reached through Eurostat and English"), and the session-96
[competitive research](../session-briefs/2026-09-11-competitive-research-localfocus-flourish-eurostat.md)
verified feasibility on the live site: four APIs (Statistics API in JSON-stat 2.0 over REST with CORS, SDMX 3.0,
SDMX 2.1, a Catalogue API); refresh twice daily (11:00 and 23:00 CET); **no versioning of past data**;
synchronous requests below 500,000 cells, async submit-and-poll for 500k–5M, HTTP 413 above; a fair-use policy
on concurrency and frequency; CC BY 4.0 with a prescribed line *"Source: [dataset DOI], [access date]"*; licence
exceptions for non-EU country data (USA, Japan, China) and some CH/AT trade data.

The design spike found that the pipeline needs **no new abstraction** for Eurostat, but that three questions
could not be settled by a session alone. The owner settled all three on 2026-09-14:

1. **Scope of this ADR:** the Eurostat-as-a-queryable-source track only. The "pattern discovery" feature the
   spike also designed (§4, a new S1–S10 invariant family) is a separate, later track.
2. **Destination:** the product becomes an **EU-wide knowledge base**; CBS/Dutch data was deliberately step one,
   never the ceiling (owner, verbatim intent at #248: *"We will not focus on Dutch. That's just the first step
   (CBS). The product will transform into an EU knowledge base."*). ADR 030 D2's Dutch-only region taxonomy was
   a scope steer for the CBS phase, not a permanent decision — ADR 030's revisit trigger has fired.
3. **Rollout posture:** demand-driven, never announced or marketed before it answers a real question — the
   posture WP16's CBS on-demand onboarding proved, restated in ADR 047.

## Decision

**D1 — Eurostat is one more `SourceAdapter` behind the existing waist; no new provider abstraction, no
parallel pipeline, no rename now.** The spike's `StatisticalProvider` shape (search datasets / get metadata /
get dimension values / query data) maps one-to-one onto `fetchCatalog` / `fetchTableSchema` / `fetchCodeList` /
`fetchObservations` + `fetchObservationCount` — the contract that already exists. The adapter lives in a new
sibling directory **`src/eurostat-adapter/`** next to `src/cbs-adapter/` (ADR [001](001-single-app-vs-split.md)'s
module set gains one entry; the guide's own instruction: "model it on `src/cbs-adapter/` — one directory"),
containing the live Statistics-API client, the parser into the existing wire types, a `FixtureSource` replaying
captured real responses through the same parser, and the grammar mapping of D6. No module outside it may know
Eurostat URL shapes (ADR [003](003-cbs-access-layer.md) decision 2, applied to source two). The `Cbs*` wire-type
names, the `cbs-adapter/` directory and the `cbs_tables`/`cbs_catalog` table names all **stay** — ADR 030 A5
measured the rename at 31+ files of diff noise on a live money product and deferred it; that verdict is
unchanged. A later hermetic cleanup (moving both adapters under `src/sources/`, renaming `Cbs*` → `Source*`) is
its own optional WP, never bundled into the source add. **(Amendment 11):** "no new abstraction, no parallel
pipeline" is accurate for E1's scope; it is NOT "one line changed forever" — D9 already scopes the
`adapterFor`/onboarding-cron rewiring (wiring point 4) to E2, a real touch of live money-path code, not E1. A
session reading only this headline should read D9 before touching that route.

**D2 — Destination and geography sequencing: EU-wide is the settled direction; the taxonomy widens in
phase E2, and phase E1 ships NL-scoped as a deliberate stepping stone.** Per #248, the region-taxonomy widening
— a `country` level plus a second, source-neutral region-code family (NUTS for Eurostat, CBS codes for CBS,
with the NL equivalences NUTS 0 `NL` = land, NUTS 1 `NL1`–`NL4` = the four landsdelen, NUTS 2 `NL11`…`NL42` =
the twelve provincies, NUTS 3 = the COROP areas CBS also publishes, recorded in `dimension_labels`) and the
consequent changes to `src/query/resolve.ts`, the region-prefix tables, `src/answer/intent/`'s region
vocabulary, the chips' `baseLabel` and the chart builder's region ordering, plus a migration — is **the expected
direction, not a hypothetical**. This ADR commits to the ORDER, not to the widening's design: **E1** ingests with
the NL-only NUTS↔CBS mapping (every non-NL `geo` row out of slice) so the adapter, the flag grammar, the
conformance families and the proof panel are proven on real data with zero waist change; **E2** widens the
taxonomy through its own design round (an executor brief with the same pre-build review, and — because it
touches `query/` and the intent schema — most likely its own ADR or a substantial amendment to ADR
[011](011-query-contract.md)), and only then may a Dutch question about a non-NL region be answered. An NL-only
Eurostat is therefore never the product; it is the proving step. The spike's option A/B framing is closed:
A-then-B.

**D3 — Rollout posture, named as a decision because a future session could easily default the other way:
Eurostat stays demand-driven and is never announced before it answers; E1's explorer is INTERNAL, flag-gated
and noindexed, never a public feature.** Concretely: (a) the E1 explorer route ships behind
`EUROSTAT_EXPLORER_ENABLED` (unset in production; owner + sessions only — the same class of owner-run proving
surface as `tables:evict --apply` or the coverage-sprint probes); (b) the public site stays **byte-identical**
through E1 — pinned by `web/components/coverage-disclosure.test.tsx`, `web/app/privacy/page.test.tsx` and
`web/app/galerij/page.test.tsx`, all three now asserting Eurostat is genuinely absent (Amendment 1: the
"Eurostat — binnenkort / coming" coverage-disclosure notice that used to exist here was itself a pre-D3
announcement, shipped before this rule — removed 2026-09-14, `058efdf`, not narrowed); none of the three
covers the query/finder path (Amendment 3 covers that gap in E1's done-definition below);
(c) the first public exposure of Eurostat IS the first served answer: a real question the finder maps to a
not-yet-loaded Eurostat dataset creates a `pending_table_requests` row and the ADR
[026](026-on-demand-fetch-job-architecture.md) job fetches → validates → verifies → answers on arrival — the WP16
loop, routed per table via `adapterFor` (guide wiring point 4: the onboarding-cron route must stop constructing
`new ODataV4Source()` directly before a Eurostat row can be claimed); (d) the public-claim wording change
("official CBS cell" → "official sources", CLAUDE.md, the meta 'sources' template, `/llms.txt`, the coverage
disclosure, `/systeemoverzicht`'s hand-written constants) ships WITH E2, owner-signed, in the same change as the
first answering dataset — never before. A session that finds itself building a Eurostat browse page, landing
section or marketing copy before E2 answers is violating this decision, not interpreting it.

**D4 — Catalog and metadata index: the existing mirror, source-scoped; discovery by the cheapest mechanism
first.** In E1, Eurostat's `catalog:refresh` runs the SAME way CBS's own does today — a manual/CLI script, NOT a
Vercel Cron job (Amendment 9: CBS's refresh has never actually run inside a serverless timeout, so "measure
against the cron ceiling" was a false baseline; making either source's refresh a real scheduled job is separate,
later design work). It reads the Catalogue API and writes rows into `cbs_catalog`
with ids `eurostat:<dataset code>` (ADR 030 D4), `source = 'eurostat'`, `language = 'en'`, the dataset's own
last-update timestamp in `modified` and its lifecycle status in `status` (the registry's
`currentCatalogStatuses` for Eurostat declared per A6). **Blocking pre-work:** `ingestCatalog`'s prune is not
source-scoped (`src/catalog/ingest.ts`, wiring point 1) — a Eurostat refresh would delete the CBS mirror rows;
it is scoped by `source` before any second refresh runs. Discovery for a Dutch question over an English catalog
proceeds in three steps, each gated on MEASURED misses, per the owner's cheapest-mechanism-first rule
(2026-09-08): (i) lift the finder's `language = 'nl'` filter per source (wiring point 2) and run English
full-text recall over `eurostat:` rows with per-source shortlist quotas (the A6 wiring exists); (ii) a curated
Dutch alias layer for the datasets people actually ask about, in `src/catalog/aliases.ts`'s existing pattern —
zero AI, zero schema; (iii) multilingual embeddings via pgvector (ADR [002](002-postgres-system-of-record.md)'s
designated upgrade path) only when (i)+(ii) show a measured miss rate worth the embedding spend and tuning
surface — never on catalog size alone. The rerank prompt shows each candidate's source (ADR 030 D5); that prose
is CBS-branded and fixture-frozen, so it changes only inside the owner-signed A4 sweep of D3(d).

**D5 — The query pipeline is the existing one; Eurostat adds no step.** The spike's *question → intent →
discovery → metadata/dimension validation → disambiguation → query → normalise → compute → cite* is already
[04-architecture.md](../04-architecture.md)'s pipeline: LLM intent parse to a strict schema with no data access
(ADR [004](004-llm-usage.md)/[012](012-intent-parsing-llm-harness.md)); finder + on-demand onboarding (ADRs
[025](025-cbs-catalog-table-discovery.md)/026/[027](027-finder-shape-fit-gate.md)); registry pinned defaults +
`dimension_labels` + ingestion validators 1–5; R7's one clarification round with dry-run-verified click options
(ADR [024](024-answer-first-defaults-and-clickable-options.md)); deterministic SQL + registered derivations (ADR
011); the attribution line + proof panel. Three Eurostat-specific rules inside those steps: (a) **a new
ambiguity class — the same statistic exists at CBS and at Eurostat** (ADR 030's "two+ sources covering the
same statistic" trigger): in E2 the live source chips (#129) decide — CBS pre-checked; when CBS has no reading,
Eurostat is **offered as an explicit clarification chip the reader must select, never auto-fetched** (Amendment
5: "offered" was ambiguous enough to permit a silent cross-source substitution — an honestly-attributed answer
the reader never actually asked for is still a guess about which source they meant, principle (c)); the richer
"here are both readings" answer (#39/#21) is E3; (b) **a comparability break (Eurostat flag `b`, or a NUTS revision) inside a
requested window is a refusal precondition on the `direction`/`first_last` derivations** in
`src/query/derivations.ts` — a "trend" across a definition change is a guess (principle (c)); this is the one
place a source flag legitimately reaches `src/query/`, as a registered-derivation precondition, never an LLM
concern; (c) **zero prompt bytes in E1** (ADR 030 A4) — the intent prompt, rerank prompt and meta templates
change only in E2's owner-signed sweep, with fixtures re-recorded there.

**D6 — Eurostat's native grammar maps INTO the waist at the adapter boundary (ADR 030 D2), with these
obligations:**
- *Periods:* `2024` / `2024-Q1` / `2024-M01` map losslessly to `2024JJ00` / `2024KW01` / `2024MM01` (F2
  round-trip holds). Semester (`-S1`), weekly (`-W01`) and daily datasets are **refused by the fit gate in
  E1/E2** — ADR 030 D2's grain-extension revisit trigger, not silently mapped (CBS's own `80416ned` daily
  specimen is the precedent).
- *Measures and units:* a Eurostat dataset is one observed variable with `unit` (and `na_item`, `sex`, `age`,
  `nace_r2`, …) as dimensions; the adapter synthesises one measure per distinct `unit` code in the registered
  slice (code `<dataset>|<unit code>`, title = dataset title + unit label, `unit` = the unit label verbatim),
  pins the `unit` dimension in the slice so a table never mixes units (R10), and takes `decimals` from the
  captured fixture's observed maximum precision, pinned at registration and re-checked by the unit-consistency
  validator.
- *Statuses, flags, null reasons — verbatim, interpreted only in the registry:* the observation-flag string
  (`p` provisional, `e` estimated, `s` Eurostat estimate, `f` forecast, `b` break, `c` confidential, `d`
  definition differs, `u` low reliability, `n` not significant, `z` not applicable, `:` not available) rides in
  `observations.status`; the registry entry declares `definitiveStatuses: ['']` (the unflagged state — every
  flagged cell renders provisional unless `provisionalDisplay` gives it a specific suffix) and
  `nullReasonLabels` for `:`/`c`/`z`. All Dutch suffix and null-reason wording is an **owner sign-off** (the
  guide's rule). Eurostat has no per-period publication status; the adapter reports every observed period as
  published (its provisional concept is per cell), which the ingestion validator's step-3 status requirement
  accepts as honest — see Assumption 4.
- *Identity and links:* ids `eurostat:<code>` (D4); `deepLink` → the dataset's stable data-browser table view
  (`https://ec.europa.eu/eurostat/databrowser/view/<code>/default/table`), mirroring the CBS choice in
  `web/lib/statline.ts` to link the table, not a cell; the #247 Text-Fragment highlight stays best-effort and may
  be null.
- *Licence exceptions enforced structurally at slice time:* rows for the excepted geographies are never
  ingested (the default slice restricts `geo` to EU/EFTA codes; the fit gate refuses a dataset whose only
  requested geo is excepted), pending the legal check in Assumption 2.
- *Fetch shape:* JSON-stat 2.0 over the Statistics API, server-side filtered per `CbsSlice` (`dimensionEquals`,
  `dimensionPrefixes` on `geo`, `periodFloor` on `time`), **synchronous only** — every fetch stays under the
  500k-cell threshold by construction of the WP16 150k-cell slice cap; the async submit-and-poll API is not
  implemented (a dataset that would need it fails the fit gate honestly). Eurostat fetches serialise (one at a
  time) in the CLI and the cron job — the fair-use policy is an ingestion-scheduling concern only, since no
  request-path call exists (principle (b)).

**D7 — Proof and citation carry over on the existing "Bewijs dit cijfer" panel with two additive fields.**
`web/lib/answer-proof.ts` builds the panel once from the stored envelope (no arithmetic, every digit a shared
formatter over a stored cell or derivation; the R1 token-scan test as the belt) and `web/components/answer-proof.tsx`
renders it — Eurostat answers ride it unchanged, plus: (a) **a per-dataset DOI**, as an additive nullable
column on `cbs_tables` and `cbs_catalog` (the DOI is per dataset, not per source, so it does NOT go on
`SourceInfo`), rendered by `buildAttributionLine` for `source = 'eurostat'` as *"Bron: Eurostat, dataset {code} —
{titel} (DOI {doi}). Gegevens gesynchroniseerd op {datum}. Licentie: CC BY 4.0."* — the "access date" Eurostat
prescribes is exactly the sync date R4 already shows; (b) **the request URL(s) the ingestion job actually
called**, as an additive `request_urls text[]` on `ingestion_batches`, recorded for BOTH sources (it does not
exist for CBS today either) and shown under the panel's "Technische details" toggle per batch — a record of what
the out-of-band job fetched, never a link the answer path calls. Amendment 6: unlike the DOI, this is NOT a
drop-in additive field — `answer-proof.ts` (verified by reading it directly) is a pure, synchronous leaf with no
DB access, called identically at receive- and replay-time for byte-parity, while `request_urls` lives on
`ingestion_batches`, a table that module never touches; the executor must add an explicit read — a live lookup
by the already-stored `batchId`, fetched alongside the proof build, kept OUTSIDE the R8-reconstructed envelope
(never denormalised into it) — not assume the interface just grows a field. Both are migrations, additive,
R8-safe (batch rows are outside the reconstructed envelope; an absent DOI renders no DOI clause; pre-Eurostat
rows re-derive byte-identically because absent `source` still resolves to `cbs`, ADR 030 A1). The verbatim flag letter appears
in the cell table's status column with its registry-resolved meaning alongside (principle (a), R11).

**D8 — Ingestion posture: bulk, out-of-band, our store is the only history.** Principle (b) unchanged. Because
Eurostat keeps no past versions, the existing silent-correction defence ([05-data-rules.md § CBS platform-change
risk](../05-data-rules.md): syncs diff against previous values, changed historical cells logged per batch) becomes
MORE valuable, not less — an audit row is a frozen snapshot of a value Eurostat itself can no longer show.
Expected cadence per dataset comes from its own update-frequency metadata, enforced as staleness warnings
(the CBS rule). NUTS revisions (2021 → 2024 → …) are the Eurostat analogue of gemeentelijke herindelingen and
follow the same reviewed-`dimension_labels`-update playbook. ADR 026 decision 3's revisit trigger fires in E2: for
measures both sources publish for NL, the on-demand verification gate gains a registered cross-source
comparison, refusing the table on a mismatch beyond a stated tolerance.

**D9 — Phasing (unnumbered; lifted into [08-build-plan.md](../08-build-plan.md) only when the owner schedules
it):**
- **E1 — adapter + internal explorer (proves the adapter).** `src/eurostat-adapter/`, registry entry + `adapterFor`
  line, fixture captures + `tests/fixtures/eurostat/conformance.json`, the NEW region-taxonomy conformance
  family (wiring point 5), the source-scoped prune, the D7 migrations, the flag-gated explorer (pick a dataset,
  filter, table + chart through the REAL `runQuery` → `buildChartSpec` path, CSV via `buildAnswerCsv`, proof
  panel underneath; zero LLM). Done: `npx vitest run tests/sources` green with Eurostat as a second positive
  control; 2–3 frozen-key verification tasks per ingested dataset (the 05-data-rules onboarding rule);
  ≥ 3 real datasets rendered on the dev server; the full verification block green; the public site
  byte-identical (D3(b)'s tests green). **Added by the adversarial review:** (Amendment 3) a test proving a live
  NL chat question can never surface an `eurostat:`-id result while `EUROSTAT_EXPLORER_ENABLED` is unset —
  scoped by an explicit `source = 'cbs'`/flag check in the live path, not left to the not-yet-lifted language
  filter as an incidental gate; (Amendment 7) `parseFactorUnit`/`baseLabel` verified against real Eurostat unit
  strings and region labels — a mismatch must fail open and be logged, never silently accepted; (Amendment 8)
  the executor brief names the DOI/`request_urls` acceptance mechanism explicitly (a new conformance check, or
  a documented exception naming the R1 token-scan test as the sole belt per D7) rather than leaving it implicit.
- **E2 — natural-language querying through the chat pipeline.** The taxonomy widening (D2, own design round),
  discovery steps (i)+(ii) (D4), the cron route via `adapterFor`, compose/refusals threading the result's actual
  source instead of `resolveSource(undefined)` (wiring point 3), the source-chip ambiguity rule (D5a), the
  `b`-flag precondition (D5b), the owner-signed prompt/claim sweep (D3(d)), the ADR 026 cross-source check
  (D8), and ≥ 5 Eurostat benchmark tasks in the frozen key including ≥ 2 refusals (a semester dataset; an
  excepted-geo ask). Done: the new tasks pass at the gate with 14/14 + 6/6 + 0 fabricated unchanged; a live,
  owner-supervised smoke run onboards a real dataset through the job and answers on arrival; every public
  surface says "official sources" and names Eurostat as answering — in one change. **Added by the adversarial
  review:** (Amendment 4) the interim wait-message shown during an on-demand Eurostat fetch (WP16's
  `pending_table_requests` loop) must not name the source before the answer itself is ready — generic wait
  copy, matching CBS's own on-demand wait-messaging, not a source-specific line.
- **E3 — research-assistant layer.** Saved queries as pointers at audit rows (the #60 saved-charts seam); a
  registered `cross_source_difference` derivation kind (two cells, two sources, unit-checked, marked derived,
  both attributions — the first cross-source computation, [#103](../open-questions.md)'s narrowest slice); a
  "waarom verschillen deze cijfers" block assembled from STORED metadata only (`CbsMeasure.description`
  verbatim for CBS; Eurostat's dataset/ESMS metadata captured at ingestion into an additive column) — template
  first, LLM paraphrase under R2/R3/R9 only if the pre-build review judges it safe. A two-source comparison
  chart is a `ChartSpec` change (ADR [007](007-chart-spec-rendering.md) seam, R6) decided in E3's own brief.

**D10 — Out of this ADR: the pattern-discovery feature.** The spike's §4 (scanning indicator pairs across
regions and years for statistical associations; a deterministic stats module; digit-free LLM phrasing; a new
S1–S10 invariant family; the multiple-testing controls) is a **separate, later, not-yet-scheduled track** with
its own ADR when — and if — the owner schedules it. It is not designed further here; the spike remains its
design record. Nothing in D1–D9 depends on it, and nothing in it may ride on E1–E3's work packages.

## Amendments from the pre-build adversarial design review (session, 2026-09-14 — 4 lenses run in parallel:
data integrity/invariants, rollout enforceability, technical feasibility, architecture-fit/regression; each
briefed to refute by default and report nothing if nothing survived scrutiny. 14 raw findings → 1 confirmed
blocker, fixed the same day outside this ADR's own text; 6 more confirmed or cross-lens-corroborated, folded
into D3–D9 above; 4 real-but-fixable, added as new E1/E2 done-definition items above; 3 minor, noted below with
no structural fix; 1 already correctly handled by the ADR as written, confirmed not a rubber stamp.

**Amendment 1 — CONFIRMED BLOCKER, fixed immediately (rollout-enforceability lens).** D3(b)'s original text cited
`coverage-disclosure.test.tsx` as proof the product "never names Eurostat as answering" — but that test actually
PINNED an "Eurostat — binnenkort / coming" notice as REQUIRED output, the opposite of what it was cited for.
That notice (`web/components/coverage-disclosure.tsx`), shipped in the Journey programme (PR #14, merged to
`main` 2026-09-12) before ADR 047 or this ADR existed, was itself already the kind of pre-answer naming D3
forbids. The session verified this directly (confirmed the component is live on `main`'s homepage, read the
exact copy, confirmed the test's assertion) before reporting it, then asked the owner rather than deciding
alone: keep it and narrow the rule, or remove it. **Owner: remove it (2026-09-14).** Fixed same day, TDD (test
flipped to assert absence, confirmed RED against the still-present chip, then GREEN after removal): the notice
and its two `coverage.eurostat*` i18n keys deleted, commit `058efdf`, pushed, full suite green (1707/1707). D3(b)
above reflects the corrected, now-true claim.

**Amendment 2 — real-but-fixable, now resolved by Amendment 1 (rollout-enforceability lens).** The original D3(b)
also overstated the three cited tests as jointly proving silence, when `coverage-disclosure.test.tsx` asserted a
materially weaker property before the fix. Moot now that all three genuinely assert absence — noted so a future
reader doesn't re-introduce a weaker assertion there without noticing the bar it needs to clear.

**Amendment 3 — CONFIRMED, folded into D9's E1 done-definition (rollout-enforceability lens).** E1's only
protection against a live NL chat question surfacing an `eurostat:`-id result is that the finder's `language =
'nl'` filter (D4 discovery step i) hasn't been lifted yet — an incidental side effect of unfinished work, not an
explicit deny-gate. An unrelated future change (broader full-text recall, English-question support) could leak
Eurostat results into production with nothing catching it. Fix: an explicit `source`/flag-scoped test added to
E1's done-definition (D9 above).

**Amendment 4 — real-but-fixable, folded into D9's E2 done-definition (rollout-enforceability lens).** D3(c)'s
"first exposure = first answer" loop didn't specify that the interim wait-message during an on-demand Eurostat
fetch stays generic. Fix: added to E2's done-definition (D9 above).

**Amendment 5 — CONFIRMED, cross-lens corroborated (data-integrity lens finding 1 + architecture-fit lens
finding 4), folded into D5(a) above.** "Eurostat offered... when CBS has no reading" didn't specify whether
"offered" meant click-to-confirm or auto-answered; the auto-answered reading is a guess about which source the
reader meant (principle c) even though the resulting attribution would be honest. D5(a) above now requires an
explicit clarification chip, never an automatic fetch.

**Amendment 6 — CONFIRMED, cross-lens corroborated (data-integrity lens finding 2 + architecture-fit lens
finding 3), folded into D7(b) above.** The original D7(b) described `request_urls` as carrying over "almost as
-is," alongside the DOI. It doesn't: `answer-proof.ts` is a pure, synchronous, DB-free leaf (verified by reading
it), while `request_urls` lives on a table that module never touches — a genuinely new read path, not a drop-in
field. D7(b) above now names the mechanism (a live lookup by the stored `batchId`, outside the R8-reconstructed
envelope).

**Amendment 7 — real-but-fixable, folded into D9's E1 done-definition (architecture-fit lens finding 2).** ADR
030's own amendment A7 named `parseFactorUnit` (unit-notation parsing) and `baseLabel` (region-label formatting)
as source-native grammars with no D2 bullet, explicitly flagged "revisit at WP30c with the first real adapter."
This is that adapter, and D6's units/measures design doesn't reference either. Not a correctness risk (A7's own
fail-open behavior holds — nothing gets fabricated), but a real risk of a silently dropped or mis-rendered unit
chip or region label in E1's own explorer, which exists specifically to prove the adapter on real data. Fix:
verification added to E1's done-definition (D9 above), fail-open confirmed AND logged, not silently accepted.

**Amendment 8 — real-but-fixable, folded into D9's E1 done-definition (architecture-fit lens finding 3).** The
conformance harness (F0–F5) checks registry coherence, fixture replay, period round-trip, value/null-reason
completeness and the ingestion validators — none of them touch D7's new DOI column or `request_urls`. A broken
capture of either could pass every conformance family and still reach the internal explorer. D7 already names
the R1 token-scan test as a belt for the DOI; this amendment requires the executor brief to say explicitly
whether that belt is judged sufficient or a new conformance check is needed — not leave it unstated.

**Amendment 9 — CONFIRMED, folded into D4 above (technical-feasibility lens finding 1).** D4's original text
framed Eurostat's catalog-refresh runtime as something to "measure against the cron/function ceiling" — which
implied CBS's own refresh already respects that ceiling. It doesn't: `catalog:refresh` is a manual/CLI script
today (~19 minutes for ~4,858 rows), never a Vercel Cron job, so it has never actually run inside a serverless
timeout. A real scheduled job at roughly twice the row count would need genuine design (pagination, incremental
writes), not just a measurement against a constraint nothing currently respects. D4 above now has E1 run
Eurostat's refresh the same unscheduled way CBS's runs today; making either a real Cron job is separate, later
work.

**Amendment 10 — minor, no structural fix (already correctly scoped) (technical-feasibility lens finding 2).**
D2's "NUTS 3 = the COROP areas... recorded in `dimension_labels`" phrasing reads as a data-only fix; `RegionKind`
(`src/answer/intent/types.ts`) has no COROP value today, so it is new code across every touch point D2 itself
lists. No ADR change needed — D2 already scopes this to its own E2 design round — flagged here so the E2
executor brief doesn't underestimate the lift.

**Amendment 11 — minor, caveat added to D1 above (architecture-fit lens finding 1).** D1's "no new abstraction,
no parallel pipeline" headline is accurate for E1 but could be misread as "nothing more to design" — D9 already
scopes the real `adapterFor`/onboarding-cron rewiring (a live money-path route) to E2, not E1. Caveat added to
D1 above rather than a design change.

**Amendment 12 — real-but-fixable, folded into D9's E1 done-definition (technical-feasibility lens finding 3).**
The 500k-sync / 5M-async / 413-above cell-count thresholds (Context, above) are research-verified (session-96
live-site checks), not verified by a real API round-trip from this codebase. Fix: one live smoke probe against
a real large Eurostat dataset, added to E1's done-definition, before the sync-only fit gate (D6) is treated as
finalized rather than provisional.

**Not amended — reviewed and confirmed already correctly handled (technical-feasibility lens finding 4).** D6's
"Eurostat has no per-period publication status... reports every observed period as published" is already named
as Assumption 4 with an explicit fallback (an ADR-recorded contract amendment if the harness insists on
per-period status) — the review confirms this is a real, honestly-hedged fit question, not an assertion dressed
up as settled. No change.

## Alternatives considered

1. **A new `StatisticalProvider` abstraction (per the research) vs. reusing `SourceAdapter` (chosen) vs. a
   parallel Eurostat pipeline.** A new abstraction would wrap the same four operations under a second name and
   either duplicate or bypass the conformance harness — the executable contract that makes "add source N" a
   weaker-model task (ADR 030 D6). A parallel pipeline was already rejected in ADR 030 D1 ("duplicates exactly
   the validated machinery that makes the product trustworthy"); nothing about Eurostat reopens that. Reuse
   costs one grammar mapping (D6) and inherits every invariant test for free.

2. **Geography: widen the taxonomy BEFORE any Eurostat code (widen-first) vs. NL-scoped E1 then widen in E2
   (chosen) vs. NL-only forever.** NL-only forever is closed by #248. Widen-first is the "correct" order on
   paper — no throwaway NL-only mapping — but it front-loads the riskiest change (query semantics, intent
   vocabulary, a migration on a live money product) before a single Eurostat wire shape, flag or dataset has
   been measured, and the widening's design needs exactly the evidence E1 produces (which datasets, which NUTS
   levels, how the flags behave). The NL-only mapping is not thrown away either: the NL equivalences are the
   first rows of the widened `dimension_labels`. A-then-B keeps E1 hermetic-testable and waist-untouched.

3. **E1's explorer: public browse feature vs. internal flag-gated proving surface (chosen) vs. no explorer at
   all (go straight to E2).** Public conflicts head-on with the owner's rollout posture (D3) and with
   [03-mvp-scope.md](../03-mvp-scope.md)'s free-browse-layer row (a separate product decision with its own
   thin-content and SEO questions). No explorer is tempting — E2 is where value lands — but it means the first
   time a real Eurostat cell, flag, unit-per-measure mapping or DOI line is seen on a real chart is in a paid,
   live, on-demand answer; the coverage sprint and the WP16 calibration both showed that measuring a new
   grammar on real data BEFORE it can answer is what catches the phantom-measure / slice-empty class of bug.
   Internal keeps that measurement and costs one flag.

4. **Dataset discovery in Dutch over an English catalog: curated alias layer first (chosen) vs. multilingual
   embeddings from day one vs. LLM-translating the question before recall.** Embeddings meet ADR 002's
   trigger on catalog size alone, but the owner's cheapest-mechanism rule asks for measured evidence, and
   embeddings add a per-refresh spend plus a threshold-tuning surface for a miss rate nobody has measured.
   Translating the question is a prompt change (A4-gated), adds a paid call on every turn, and introduces a
   new way to misfire (a mistranslated measure word) on the one step where the product must not guess.
   Aliases are zero-AI, zero-schema, reviewable, and the miss rate they leave IS the evidence embeddings
   would need.

5. **Wire format: JSON-stat 2.0 (chosen) vs. SDMX-CSV vs. the async API.** JSON-stat is the Statistics API's
   documented primary format with CORS and carries the observation flags; SDMX-CSV is the fallback if a needed
   flag or metadata field turns out to be JSON-stat-invisible at capture time. The async API would allow
   datasets above 500k cells, but the WP16 slice cap already bounds fetches far below that, and async
   submit-and-poll is a second job shape the ADR 026 cron engine does not have — a real cost for a case the fit
   gate can simply refuse.

6. **Where the DOI lives: per-dataset column (chosen) vs. a field on `SourceInfo` vs. a `deepLink`-style
   function.** The DOI is per dataset, so a source-level field is wrong by construction; a function would have
   to derive a DOI from a dataset code, which Eurostat does not guarantee. A stored, captured-at-ingestion
   column is the only honest option — and keeps `SourceInfo` the pure client-bundled leaf WP30a made it.

7. **Request URLs: store on the batch (chosen) vs. reconstruct from the registered slice at proof time vs. not
   surface them.** Reconstruction is arithmetic-free but is still a re-derivation of what was fetched, from
   today's adapter code — a later adapter change would silently rewrite history. Storing the URL the job
   actually called is what "traceable" means. Not surfacing loses the one proof element the research asked for
   that the CBS panel never had.

8. **Rename `cbs-adapter/` → source-neutral now vs. sibling directory (chosen).** The A5 measurement stands:
   31+ files of diff noise, zero hermetic benefit, on a live money product. A sibling is the guide's own
   instruction.

## Consequences

- One new `src/` module (`eurostat-adapter/`); ADR 001's as-built list gets the note. Zero change to `src/query/`
  semantics, `src/answer/compose/`, `src/chart/`, prompts or the benchmark scorer in E1 — the guide's "what you
  must NOT touch" list is honoured by construction; E2's widening is the one deliberate waist change, in its own
  design round.
- Two additive migrations (DOI columns; `request_urls` on batches), file-only until the owner's supervised
  apply; a third (the taxonomy widening) is E2's, designed there.
- Every CBS answer, citation, chart, CSV and stored audit row stays byte-identical through E1 (the WP30a golden
  pins remain the proof); the public site stays byte-identical through E1 (D3(b)'s tests).
- The public claim widens to "official sources" exactly once, in E2, owner-signed, together with the first
  answering dataset — [open-questions #102](../open-questions.md)'s recorded implication, executed.
- The seven WP30c wiring points in the guide become E1/E2 obligations: 1 and 5 in E1; 2, 3, 4, 6, 7 in E2.
- Pricing unchanged: a Eurostat answer at the normal price; on-demand Eurostat onboarding at the existing
  100-credit heavy tier (ADR 026 decision 2); any extra-credit pricing for E3's cross-source comparison is an
  owner decision at #103, not made here.
- ADR 030's "Nederland scope" steer is superseded as a permanent scope statement (its addendum says so);
  ADR 047's sequencing statement ("Eurostat next, demand-driven, never announced before it answers") is now
  backed by a concrete, gated plan. [06-roadmap.md](../06-roadmap.md) Phase 3's data-sources row and
  [03-mvp-scope.md](../03-mvp-scope.md)'s enrichment-sources row should point here when this is scheduled (a
  doc sweep for the execute session, not a change this ADR makes on its own).
- The spike's §4 track (pattern discovery) is explicitly parked, with its design record intact.

## Assumptions carried forward from the design spike (each to be mirrored into open-questions.md when this is scheduled)

1. **Dataset count.** The "~8–10k Eurostat datasets vs. CBS's ~4,858" figure is from the owner's Perplexity
   research, unverified in this repo; the count is measured against the Catalogue API at design-review time
   before any sizing (mirror runtime, shortlist quotas) rests on it.
2. **Licence exceptions.** The exact list (non-EU country data; CH/AT trade) and its interpretation get a legal
   check before the registry entry lands (ADR 030's licence revisit trigger); slice-time exclusion is assumed
   sufficient pending that check.
3. **NUTS ↔ CBS equivalence** is exact for provincie/COROP under the current NUTS version and lives in
   `dimension_labels` with a reviewed seed, same as herindelingen; a NUTS revision uses the same playbook.
4. **Per-period status for a per-cell-flag source.** Conformance F2 and ingestion validator step 3 accept the
   adapter's "every observed period published; provisional-ness per cell" reading without a waist change; if
   the harness insists on a per-period status vocabulary, that is an ADR-recorded adapter-contract amendment,
   never a silent workaround.
5. **Period grains.** The datasets the ICP asks about are annual/quarterly/monthly; semester/weekly/daily
   refusal in E1/E2 costs little. Measured in E1 against real questions.
6. **Decimals** derived from a fixture's observed maximum precision are honest (never round a served value)
   and are pinned per table at registration.
7. **Discovery.** The first 20–30 asked-about datasets are coverable by the alias layer; the pgvector step is
   evaluated on a measured miss rate, never on catalog size alone.
8. **Catalog freshness.** A daily Catalogue-API refresh is enough (Eurostat updates twice daily); the CBS mirror
   refresh already takes ~19 minutes for 4,858 rows and is a manual/CLI script, not a Cron job today (Amendment
   9 above) — E1 keeps Eurostat's refresh the same way; making either a real scheduled job is separate work.
9. ~~**Both-sources ambiguity.**~~ Resolved by Amendment 5 above, folded into D5(a) as a decision, not an
   assumption: Eurostat is offered as an explicit clarification chip when CBS has no reading, never auto-fetched.
10. **Request-URL storage** has no GDPR angle: URLs carry dataset codes and filters, never user data.
11. **Attribution wording** — the Dutch Eurostat line, the flag suffixes and the null-reason labels — are owner
    sign-offs before E1's registry entry is written.

## Revisit triggers

- E1's fixture captures show a needed flag or metadata field that JSON-stat 2.0 does not carry → switch the
  wire format to SDMX-CSV (alternative 5), one parser change inside the adapter.
- Real questions (E1 measurement, later E2 usage) ask for semester/weekly datasets at a rate that matters → the
  ADR 030 D2 grain-extension design.
- The alias layer's measured miss rate stays high after the first 20–30 datasets → enable pgvector for the
  Eurostat catalog (ADR 002's path), with its spend recorded.
- A dataset the ICP needs exceeds the slice cap even NL-scoped → raise the cap (ADR 026's 300 s ceiling
  revisit) before implementing the async API.
- The E2 widening's design shows the intent schema or `resolve.ts` needs more than an additive region-code
  family → a full ADR 011 amendment rather than an E2 brief note.
- A second regional non-NL source (RIVM/Kadaster are NL; a future EU-level or member-state source) → the
  widened taxonomy is the waist it maps into; if it cannot, this ADR's D2 reopens.
- The owner schedules the pattern-discovery track → its own ADR, starting from the spike's §4 and the S-family
  draft there; this ADR is not extended for it (D10).
- Eurostat announces versioning, an API deprecation or a licence change → the adapter (D1) is the isolation
  seam, exactly as ADR 003 makes the CBS adapter the seam for the SDMX migration.

## As-built (E1, session 101 continuation, autonomous overnight, 2026-09-14/15)

**Built:** `src/eurostat-adapter/` (types, the JSON-stat 2.0 parser, the live `StatisticsApiSource`, the fixture
replay), an `adapterFor('eurostat')` line, the eurostat `SourceInfo` registry entry, the source-scoped catalog
prune (wiring point 1), the D7 migrations (032 DOI columns, 033 `request_urls` — file-only, unapplied), the
D7(a)/(b) attribution and proof-panel code, the Amendment-3 deny gate in `src/catalog/recall.ts`, and the
internal `EUROSTAT_EXPLORER_ENABLED`-gated explorer (`web/app/eurostat-explorer/`). Full detail, task by task:
[session-briefs/2026-09-14-wp30c-e1-executor-brief.md](../session-briefs/2026-09-14-wp30c-e1-executor-brief.md)
(the frozen brief, with its own second adversarial review's Amendments B1–B6 folded in) and
[STATUS.md](../STATUS.md)'s session-101 entry. Branch `wp30c-e1-eurostat-adapter`, PR pending — autonomous,
core-product code, never auto-merged (#118(b)).

**Deviated from this ADR, deliberately, and why:**
- **A new session-level scoping decision, "Constraint 0": no live Eurostat API call happened this session,
  even a free read-only one** — the build-plan's WP30c entry pairs "any real Eurostat API spend" with "Live
  DDL... never autonomous," and this session read that literally rather than assuming "spend" meant money
  only. Consequence: every fixture is hand-built and explicitly `"synthetic": true`, never captured; zero
  real Eurostat tables are registered; the Amendment-12 live smoke probe and Amendment 7's "verified against
  real data" half stay open ([#249](../open-questions.md)). This ADR's own D9 E1 done-definition ("≥3 real
  datasets rendered," a live smoke probe) is therefore NOT met by this build — a narrower, disclosed
  done-definition in the executor brief was met instead. If this reading is overly conservative, that is the
  owner's call on PR review, not this session's to assume.
- **D6's `definitiveStatuses: ['']` is shipped as `[]` instead.** D6 assumed the unflagged status reaches
  `isProvisionalStatus` as a genuine per-cell status; it doesn't — `src/ingestion/pipeline.ts`'s `status`
  column has no per-cell path at all, only a per-period-code one (the CBS shape). An empty array makes every
  Eurostat cell render provisional unconditionally instead — strictly safer, per principle (c), but a real
  correction to D6's text, not a build detail. A scoped `pipeline.ts` change to carry a genuine per-row status
  is now a named prerequisite before any Eurostat cell may render as anything but maximally cautious
  ([#251](../open-questions.md)).
- **The chip-visibility gap this build actually found, that neither this ADR nor its own pre-build review
  anticipated:** merely registering a second `SourceInfo` entry made `web/components/chat.tsx`'s existing
  WP129+130 source-chip row (`Object.keys(SOURCES).map(...)`) render and default-select a new "Eurostat data"
  chip for every real user — a live violation of D3(b)/(c) that had nothing to do with any Eurostat data
  existing yet. Fixed with a new `SourceInfo.chatSelectable` field (`true` for cbs, `false` for eurostat,
  applied at both the chip UI and the server's untrusted-selection validator in `web/app/actions.ts`) — this
  is now the actual mechanism D3(d)'s "flips on in E2's owner-signed sweep" refers to, not a hypothetical.
- **`request_urls` (D7(b)) is wired at two of `buildAnswerProof`'s three call sites, not all three** — the
  live chat proof panel (`chat.tsx`, `'use client'`, no server context) doesn't show it; replay and question
  history do ([#252](../open-questions.md)). Applies to CBS proof panels too, so it is a coverage gap, not an
  Eurostat-specific one. **As-built (session 109, 2026-09-17): closed.** `web/app/actions.ts`'s
  `askQuestion`/`replyToClarification` now run the same `fetchRequestUrlsByBatch` lookup AFTER the answer is
  settled (fail-open, never inside the charged section) and thread it onto a new `AskOutcome.proofRequestUrls`
  field; `chat.tsx` reads it for the live turn exactly as `replay-assemble.ts`/`question-history.tsx` already
  did for a resumed one. All three call sites are wired; see [#252](../open-questions.md) for the measured
  test counts.

**A third real defect, found by the required final whole-branch review (after all tasks were built, before
the PR) — the most serious of the three:** Task 4's live-chat deny gate (`src/catalog/recall.ts`) was
originally implemented gated on `EUROSTAT_EXPLORER_ENABLED` — the SAME flag the internal explorer route
checks for its own visibility. That coupling meant flipping the explorer flag on — exactly what this ADR's
own RUNBOOK follow-up instructs doing, to check the explorer against a real registered table — would ALSO
have lifted the only protection keeping a registered Eurostat row out of live chat, a direct D3(c) violation
("never announced before it answers") with no code change needed to trigger it, just the documented next
step. Fixed: the deny gate is now unconditional, no flag at all — confirmed safe because the explorer never
depends on it (it reaches a table via an explicit-target intent, bypassing recall/discovery entirely). A
related, lower-severity gap in the SAME review pass: the pre-existing #108 status-flip detection
(`src/catalog/ingest.ts`) joined every registered table regardless of source, which would have caused a
CBS-only refresh to spuriously report every registered Eurostat table as "flipped" the moment a real
Eurostat catalog capture gives it a non-empty `currentCatalogStatuses` — fixed by scoping that join to the
refresh's own source, with a regression test that exercises the scoping directly (a real registry-status
dormancy, per Amendment B1, meant the bug couldn't be demonstrated with Eurostat's own current settings).

**Confirmed still correct, unchanged:** D1 (no new abstraction — the adapter models `cbs-adapter/` exactly),
D4 (id-prefix discipline), D5's zero-prompt-bytes claim (the benchmark ran byte-identical, 14/14+6/6+0
fabricated, before and after this build), D8's ingestion posture, and every Alternative/Consequence not named
above.

## As-built addendum — Constraint 0 resolved, real captures + two real defects found (session 107, 2026-09-16)

Session 107 resumed PR #23 (merge-conflict resolution against 53 commits of drift on `main`). Asked directly,
the owner confirmed the Constraint 0 reading above was overly conservative: "no real Eurostat API spend" meant
money, not any live call — Eurostat's API is free/public/read-only. This unblocked the RUNBOOK's owner-supervised
step, run live this session (steps 1-3 of 5; steps 4-5 — registering a real table and applying migrations 032/033
— stay owner-supervised, unstarted, since they need `npm run db:migrate`).

**Two real API-shape defects found, exactly what Constraint 0's own disclosed uncertainty anticipated:**

1. **The Catalogue "table of contents" endpoint returns tab-separated TEXT, not JSON.** The original
   `parseJsonStatCatalog` assumed a `link.item[]` JSON shape (a best-effort guess from Eurostat's documented
   conventions); the real endpoint 406s on an `Accept: application/json` header and returns a quoted,
   tab-separated file (`title\tcode\ttype\t...`) instead. Rewritten to parse the real TSV — `type: 'dataset' |
   'table'` rows are real, independently-queryable leaf nodes (both verified live against the Statistics API);
   `'folder'` rows are pure navigation, dropped. `statistics-api.ts` gained a `fetchText` alongside `fetchJson`
   (no `Accept` header on this one endpoint). The real toc file carries no per-entry lifecycle/status field at
   all — `status` stays `null` for every entry, and this is now a CONFIRMED absence, not "unknown pending a
   capture" ([#250](../open-questions.md) updated accordingly).
2. **Eurostat's real Statistics API returns `value` as a sparse, offset-keyed OBJECT, not a dense array** —
   e.g. `{"400": 7.7, "401": 9.3, ...}`, a spec-valid JSON-stat 2.0 alternative the original parser's
   `requireDataset` hard-rejected. `JsonStatDataset.value`'s type widened to `Array<number | null> |
   Record<string, number>`; `jsonstat.ts` gained `valueAt`/`validateValueShape` to handle both shapes (mirroring
   `normalizeStatus`'s existing dense-or-sparse handling for `status`). A THIRD, related finding surfaced by the
   conformance harness once real data flowed through: a cell absent from BOTH the sparse `value` map and the
   sparse `status` map (a normal shape for real EU data — not every geo×time combination is reported, unlike
   CBS's dense grid) was defaulting to `valueAttribute: 'None'`, which per `CbsObservationRow`'s own contract
   means "a real, present value with nothing to flag" — dishonest for an absent cell. Fixed: `'None'` now only
   applies when a value IS present; an absent value with no explicit flag defaults to Eurostat's own `':'`
   (not-available) flag, already registered in `registry.ts`'s `nullReasonLabels`.

**Real captures now committed** (`tests/fixtures/eurostat/`, `"synthetic": false`): the full real Catalogue TSV
(10,331 entries, 2.1MB) and two small real datasets, `tipsbd30`/`migr_asyapp1mp` (515/525 cells each) — chosen
fresh from the live catalog capture specifically because the original three demo codes
(`demo_pjan`/`namq_10_gdp`/`nrg_bal_c`) turned out to have real cell counts of 742,730/8,191,372/21,300,267 —
all three exceed `SYNC_CELL_THRESHOLD` (500,000), too large to usefully commit as synchronous-happy-path
fixtures. Their original hand-built specimens stay in place, unchanged, still used by unrelated unit tests.

**A third, unrelated real defect found while merging: a cross-branch migration NUMBER collision.**
`031_source_doi.sql` (this branch, built 2026-09-14/15) and `031_chart_headlines.sql` (an unrelated feature
that landed on `main` session 105, 2026-09-16, while this branch sat unmerged) both claimed migration number
031. `src/db/migrate.ts` tracks applied migrations by filename in a `done` set but inserts by NUMERIC
`version` into a `primary key` column — two different files with the same leading number pass the filename
check independently, then collide on the second `insert`. Surfaced as a real, reproducible test failure
(`duplicate key value violates unique constraint "schema_migrations_pkey"`) that made EVERY suite depending on
`createIngestedDb()`/`applyMigrations` fail, not just Eurostat's own — caught by running the full backend
suite after the merge rather than trusting the merge's own "no conflicts here" silence (two different
filenames never conflict in git, so this collision was invisible to the merge itself). Fixed by renumbering
this branch's two never-applied migrations: `031_source_doi.sql` → `032_source_doi.sql`,
`032_ingestion_batch_request_urls.sql` → `033_ingestion_batch_request_urls.sql` (plus their paired test files
and every code/doc cross-reference to the old numbers) — a pure rename, zero data or deployed-schema impact
since neither had ever been applied. **Lesson for future sessions:** two independently-developed branches can
each freely pick "the next number after what I see" and still collide once merged, since git's own conflict
detection only catches same-PATH edits, never same-NUMBER-different-file additions — the backend suite's own
`schema_migrations` primary key is what actually catches it, and only if the full suite runs post-merge before
declaring victory.

## Second As-built addendum — migrations applied, a real table registered, a fourth real defect found (session 107, 2026-09-16/17, on the owner's explicit go-ahead)

The owner directly instructed "apply migrations and register a real table," completing RUNBOOK "WP30c E1"'s
remaining steps 4-5 (full account: RUNBOOK's own WP30c E1 section).

**Migrations 032/033 applied to production** (`npm run db:migrate`) and verified directly against the live
database (columns exist, correct types; no new security advisories).

**A real table registered and synced: `eurostat:tipsbd30`, 532 real rows, 0 corrections** — via a one-off
script calling `registerTables`/`syncTable` directly with `adapterFor('eurostat')`, since neither the
`ingest` nor `catalog:refresh` CLI's own entry point was ever wired with a source-selection flag (both
hardcode `CBS_SOURCE_KEY`); the underlying pipeline functions were always source-agnostic.

**A fourth real defect found, this time in `registerTables` itself, not the adapter:** its `insert into
cbs_tables` never wrote the `source` column at all, so every table ever registered — Eurostat included —
silently landed tagged with the column's own default, `'cbs'`. Invisible until now because Eurostat was the
first non-CBS source anything has ever actually registered; `ingestCatalog`'s own insert into `cbs_catalog`
(the separate catalog-mirror table) already did this correctly, which is presumably why the gap in the
table-registry insert was never caught by the WP30c/E1 brief's own review rounds — a different function,
same table-adjacent concern, and the review checked the one that was already right. **Not a live-chat safety
gap**: `src/catalog/recall.ts`'s deny gate derives the source from the table id's own string prefix
(`sourceKeyForTableId`), by design never this column — its own comment states exactly why ("so this can
never drift"), and that design choice is what kept this from ever being a real exposure. It WAS a real
display bug: `web/lib/eurostat-explorer.ts`'s own `where source = $1` query could never have found this (or
any future) Eurostat table. Fixed by deriving and writing `source` via the same `sourceKeyForTableId` the
deny gate itself uses (commit `0a5c2c8`); two regression tests added (a bare-id CBS table still tags `cbs`,
an `eurostat:`-prefixed table tags `eurostat`, neither defaulting silently); the one already-registered
production row corrected directly via SQL, verified against the live database.

**Still genuinely open:** `doi` was never populated for this table (stays `null`) — nothing in
`registerTables` sources a DOI from anywhere, so ADR D7(a)'s "populated at catalog/registration time" was
itself never implemented, a separate, not-yet-scoped gap from the column-tagging bug above.

**Research update, session 108 (2026-09-17, subagent, docs-only — [open-questions #264](../open-questions.md)):**
D7(a)'s DOI source is now VERIFIED, closing the "not yet scoped" gap above. Eurostat mints one DOI per
dataset, pattern `10.2908/<CODE>` (code uppercased) per Eurostat's own "Anchoring of datasets" guide —
confirmed live via the public DataCite REST API (`GET https://api.datacite.org/dois/10.2908/<code>`) for
three real datasets including `tipsbd30` itself (200, `state: "findable"`, title matching what's already
registered here); the `doi.org` resolver path was confirmed live too. Neither the Catalogue endpoint nor
the Statistics API expose it — DataCite is the only verified programmatic source, and would be a NEW
third-party ingestion-time dependency (out-of-band, never the request path — consistent with principle
(b)) if built: construct the DOI deterministically, verify it with one DataCite call at registration time,
write `doi` only on a confirmed `findable` response, leave `null` otherwise rather than store an unverified
guess. Not built yet — still a future session's scoping/priority call; see open-questions #264 for the
full write-up. A full browser
click-through of `/eurostat-explorer` was not done (would need either flipping the production
`EUROSTAT_EXPLORER_ENABLED` flag, itself owner-supervised, or contending with another session's already-
running local dev server) — the explorer's own backing SQL query, run directly against the live database,
does now return this table, which is the load-bearing fact step 4 needed proven. Amendment 7/D9's "≥3 real
datasets rendered end-to-end" and the Amendment-12 live smoke probe are now reachable (one real table is
registered) but not yet exercised through the actual page. D6's `definitiveStatuses: []` correction and the
[#251](../open-questions.md) `pipeline.ts` per-cell-status prerequisite are unaffected by anything in this
addendum.

## Third As-built addendum — D7(a) DOI construction + verification built (session 109, 2026-09-17, #264)

`registerTables` (`src/ingestion/pipeline.ts`) now sources a DOI for every newly registered Eurostat table,
closing the gap the previous two addenda left open. New module `src/eurostat-adapter/doi.ts`:

- `eurostatDoiFor(tableIdOrCode)` — deterministic construction, zero API calls: `10.2908/<CODE uppercased>`,
  stripping an `eurostat:` prefix if present (a local `nativeIdFrom`, duplicated on purpose per this
  codebase's existing per-adapter convention, not imported from `src/sources/registry.ts`'s private helper).
- `verifyEurostatDoi(doi, { fetchImpl?, timeoutMs? })` — one cheap, out-of-band (never the request path) call
  to the public, unauthenticated DataCite REST API (`GET https://api.datacite.org/dois/<doi>`); returns
  `true` only on a 200 with `data.attributes.state === "findable"`. NEVER throws — a 404, any other non-2xx,
  a network error, a JSON-parse error, or a timeout all resolve to `false`, mirroring
  `src/chart/brandfetch.ts`'s `fetchBrand` fail-safe shape. `fetchImpl` is injectable so tests never touch
  the real network.

`registerTables` calls both, scoped to `sourceKeyForTableId(table.id) === EUROSTAT_SOURCE_KEY` rows only —
CBS has no DOI concept, so `cbs_tables.doi` stays `null` for every CBS row forever, with zero API calls
attempted for them (cheapest-mechanism-first). A `findable` result writes the constructed DOI in the same
insert as the rest of the registration row; anything else (unconfirmed, or a genuinely unexpected exception
from the verification call, belt-and-braces around a function that already never throws) leaves `doi` null
and logs a plain-language `console.warn` — this can never block or fail registration itself (D7(a)'s DOI
remains presentation-only support for the proof panel, not a fifth validation-pipeline check).

**`cbs_catalog.doi` is intentionally NOT populated by this change** — checked, not assumed:
`registerTables` never writes `cbs_catalog` at all; that table is refreshed separately by
`ingestCatalog` (`src/catalog/ingest.ts`), whose own upsert has no `doi` column in its `UPSERT_SQL` and
sources rows from the bulk Catalogue fetch, which (per the session-108 research this addendum builds on)
does not expose a DOI at all. D7(a)'s "populated at catalog/registration time" refers to the registration
step (`registerTables`), which is what this change does; extending `cbs_catalog` would be a separate,
unscoped gap if ever wanted.

**Backfill**: the already-registered `eurostat:tipsbd30` production row predates this fix and was NOT
touched by it (registration is a one-time, already-registered-tables-are-skipped operation). A new
idempotent script, `scripts/backfill-eurostat-doi.ts` (`npm run backfill:eurostat-doi`, dry-run by default,
`--apply` to write, mirroring `scripts/gdpr-purge.ts`'s shape), finds `source = 'eurostat' and doi is null`
rows and applies the same construct-then-verify rule. Not run against the live database by this session
(no live DB writes from a dispatched session) — documented as an owner RUNBOOK step
(docs/RUNBOOK.md's "DOI backfill" section under WP30c E1).

**Tests** (hermetic, `tests/ingestion/ingestion.test.ts`, PGlite, no real network): a Eurostat table gets
`doi` on a 200/`findable` DataCite response; stays `null` on a 404; stays `null` when the injected
`fetchImpl` throws (registration still succeeds); a CBS table never gets a `doi` and never triggers a
DataCite fetch at all; re-registering an already-registered table is a no-op skip with no second DataCite
call.

**Assumption carried forward** (mirrored in open-questions #264): DataCite's `findable` state for a
constructed `10.2908/<CODE>` DOI is being trusted as the correctness signal per the session-108 research
(3 real datasets spot-checked, no counter-example found); the rollout may not yet cover every one of
Eurostat's ~10,331 catalog entries, so a legitimately-published Eurostat dataset without a live DOI yet
would correctly register with `doi = null` under this rule, not a false negative in the code.
