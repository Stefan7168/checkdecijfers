# ADR 030 — Multi-source architecture: formalize the narrow waist (owner priority #2, designed 2026-07-08)

**Status:** accepted at design level (session 30; owner steers: subject scope stays "Nederland",
source undecided → source-NEUTRAL design; design now, **build after WP27**). Per the WP27 precedent,
the execute session runs the standard pre-build adversarial design review BEFORE writing code.
Evidence base: the [multi-source dossier](../session-briefs/2026-07-08-multi-source-dossier.md)
(3-agent code audit).

## Context

"New data sources beyond CBS" is priority #2 in the owner's stack, and the owner asked (2026-07-08)
whether the architecture is ready for it. The audited answer: the pipeline is interface-shaped
end-to-end (the dossier's "already agnostic" list), but **source identity does not exist as a
concept anywhere** — one table-id namespace, no `source` on `Attribution`, CBS's period/status
vocabularies as the canonical grammar, and product copy that asserts CBS-exclusivity as fact. The
public claim ("every number traceable to an official CBS cell") widens to "official sources" only
when source #2 actually ships — that wording change is a standing owner sign-off item, already
recorded in the priority stack.

## Decisions

**D1 — One canonical internal model; ALL source-specificity lives in per-source adapters that map
into it (the narrow waist, formalized).** The current internal shapes (table schema, measures,
observations, the registry contract, `ResultCell`) ARE the waist — they stay. A source is added by
writing an adapter that satisfies the (renamed) `CbsSource` interface plus the new mapping
obligations in D2–D5, and by passing a **conformance harness** (D6). Nothing downstream of the
waist may ever branch on "which source" except via the source registry (D3).
*Rejected:* generalizing the internal model to every source's native shapes (huge, speculative) and
per-source parallel pipelines (duplicates exactly the validated machinery that makes the product
trustworthy).

**D2 — Source-native grammars are translated AT the adapter boundary; the internal grammars stay.**
- **Periods**: the internal `YYYY(JJ|KW|MM)NN` code + grain model is the canonical period language;
  an adapter must map native periods into it. Netherlands-scope statistical sources are
  year/quarter/month-shaped; a daily/weekly source (e.g. weather) would need a grain extension —
  an explicit REVISIT trigger, not built now.
- **Regions**: the Dutch taxonomy (land/landsdeel/provincie/gemeente) is kept AS the canonical
  geography per the owner's Nederland-scope steer; adapters map into it or mark data national/
  non-regional. (The duplicated prefix tables get consolidated to one module in the build.)
- **Status / null reasons**: `observations.status` keeps the VERBATIM source label (principle a);
  what generalizes is the interpretation — the source registry carries each source's
  `provisionalStatuses` set and null-reason label map, replacing today's hardcoded
  Voorlopig/NaderVoorlopig and Impossible/Confidential/NotAvailable matches. A source with no
  provisional concept declares an empty set (nothing is ever marked provisional — honest, no
  invented certainty EITHER way, because the label shown stays verbatim).

**D3 — A code-level SOURCE REGISTRY is the single authority for source identity and display.**
A committed constant map: `{ key, displayName, attributionLabel ("CBS StatLine"), license
("CC BY 4.0"), deepLink(tableId) | null, provisionalStatuses, nullReasonLabels, adapterFactory }`.
`Attribution` gains a `source` field (the key + resolved display fields); `buildAttributionLine`,
`web/lib/citation.ts`, `web/lib/statline.ts`, the stat-card footer and the chat link label all
consolidate onto it — closing the three-independent-spellings drift the audit found. The meta
'sources' answer template and the intent-prompt provenance prose become registry-driven
enumerations, so the product's self-description is true by construction the day source #2 lands.

**D4 — Table identity: prefixed ids + an authoritative `source` column, no compound keys.**
New sources register table ids as `'<sourcekey>:<native-id>'`; CBS keeps its bare legacy ids.
Migration adds `source text not null default 'cbs'` to `cbs_tables` and `cbs_catalog` with a CHECK
(`source = 'cbs' OR id LIKE source || ':%'`) so the global id space stays collision-free WITHOUT
touching any FK, index, join, audit row or ledger reference (all additive, deploy-order-safe; the
`platform` check widens per adapter). *Rejected:* `(source, table_id)` compound keys — correct in
the abstract, but it rewrites every FK/unique-index/join over five tables on a LIVE money product
for zero v1 benefit; the prefix convention gives the same uniqueness with an enforcing constraint.
(Precedent: `onboardedKey`'s prefix namespacing, already live.)

**D5 — Routing: the adapter is chosen by the table's source, once, at the seams that fetch.**
Ingest CLI, catalog refresh, and the onboarding job resolve `adapterFactory` from the source
registry via the table id / catalog row; `runOnboardingJob` already takes the source as an injected
dep, so this is wiring, not redesign. The catalog/finder stays ONE search space (one `cbs_catalog`
mirror with a `source` column; the rerank prompt shows each candidate's source).

**D6 — An adapter is DONE when the conformance harness passes on its recorded fixtures.** The
harness = the existing four agnostic validators + new contract tests (period-mapping round-trip,
status/null-reason mapping completeness, attribution fields present, fixture replay through the
REAL parsing code — the `FixtureSource` pattern per source). This is what makes "add source N" a
weaker-model task: the contract is executable, not prose. A "how to add a source" guide rides the
build (docs/, referenced from the RUNBOOK).

**D7 — No Python/ADR-001 split for this.** The split trigger was tooling/scale pressure; the waist
formalization is TypeScript-shaped additive work inside the existing module boundaries
(`cbs-adapter/` → renamed source-neutrally in the build; ADR 001's list gets the as-built note).
Revisit only if a chosen source demands tooling TypeScript genuinely lacks.

## Sequencing (owner-decided: design now, build after WP27)

- **WP30a — formalize the waist (hermetic, CBS-only behavior byte-identical):** source registry +
  `Attribution.source` + the D3 consolidation + D4 migration (+ widen `platform` check) + benchmark
  schema `source` field. Every existing answer/citation/chart/CSV byte stays identical
  (source='cbs' resolves to today's exact strings — pinned).
- **WP30b — adapter contract + conformance harness + the how-to guide.**
- **WP30c — the first real second source**: blocked on the owner picking one; the conformance
  harness is the acceptance test. Public-claim wording change (CLAUDE.md + meta template + UI copy
  sweep + the stale validation-pass expectations) ships WITH this, owner-signed.

## Revisit triggers

- A chosen source with daily/weekly/irregular periods → the D2 grain extension design.
- A chosen source outside Nederland scope → the region-taxonomy decision reopens.
- A source whose license forbids the current attribution/display pattern → legal check before D3
  entry.
- Two+ sources covering the SAME statistic → the #39/#21 multi-reading disclosure design (already
  anticipated there), plus cross-source verification (ADR 026's deferred "genuine second source"
  check becomes possible — worth doing at WP30c).

## Amendments from the pre-build adversarial design review (session 36, 2026-07-11 — 48 agents: 6 mid-tier lenses × dual heavy-tier skeptics; 21 raw findings → 3 confirmed blockers, 2 contested upheld by the session model, 16 killed)

**A1 — Absent `source` defaults to the `'cbs'` registry entry, everywhere, forever (R8).** The
review's strongest finding, confirmed independently by TWO lenses (dual-upheld both times):
`audit_answers.response` holds the FULL envelope as frozen jsonb — every row written before WP30a
has an `attribution` object with NO `source` key, and `reconstruct.ts` re-derives the attribution
line (and stored chart specs, incl. the null-note) from that stored JSON byte-for-byte. Any
builder that consolidates onto `Attribution.source` therefore MUST treat an absent/undefined
`source` as the `'cbs'` registry entry — old rows re-derive byte-identically forever. Pinned by:
(a) a regression test constructing a pre-WP30a-shaped `Attribution` (no `source` field) that must
reconstruct clean, and (b) the supervised step re-running `scripts/verify-audit-rows.ts` against
real production rows.

**A2 — `provisionalStatuses` is a MAP, not a set.** Today's display is two-tier
(`template.ts` `provisionalSuffix`: `NaderVoorlopig` → ' (nader voorlopig cijfer)', otherwise
' (voorlopig cijfer)') — a flat set cannot reproduce it byte-identically. The registry field
becomes `provisionalDisplay: Record<verbatimStatus, suffix>` (CBS:
`{ Voorlopig: ' (voorlopig cijfer)', NaderVoorlopig: ' (nader voorlopig cijfer)' }`); a status
absent from the map is not provisional. D2's honesty rule stands: verbatim labels, no invented
certainty either way.

**A3 — Two D3 sites the enumeration missed, now in scope:** the chart null-cell note
(`src/chart/build.ts:47`, literal `'… ${valueAttribute} (CBS).'` — STORED in `ChartSpec.nullNotes`
and R8-re-derived, so it inherits A1's fallback rule) and the stat-card footer (needs a source
field on `StatCardData` — additive plumbing). Chart-spec typing: `Attribution.source` rides as an
OPTIONAL additive field; `CHART_SPEC_VERSION` stays 1 (old stored specs re-derive via A1; nothing
existing changes shape).

**A4 — WP30a touches ZERO LLM request bytes — made explicit.** D3's "intent-prompt provenance
prose / meta 'sources' template become registry-driven enumerations" is DEFERRED to WP30c (where
the owner-signed wording change re-records fixtures anyway). In WP30a the intent prompt is
byte-untouched and the meta template may only be restructured if its output is proven
byte-identical (the killed-findings' residual risk, closed by making the constraint explicit).
The fixture-replay suite green IS the proof, as with #125a.

**A5 — Scope split confirmed: WP30a and WP30b are SEPARATE sessions; the `Cbs*`/`cbs-adapter/`
rename is DEFERRED (alias only if WP30b's guide needs a neutral name).** Measured rename blast
radius: `CbsSource` 13 files/41 occurrences, full `Cbs*` family 21 files, import path 31 files —
diff noise that buys nothing hermetic now. D6 correction: the harness runs the FIVE existing
validators (schema fingerprint, row plausibility, period parsing, dimension mapping, unit
consistency — the ADR said four), plus the four contract-test families and the per-source
fixture manifest, per the review's scope-harness inventory (recorded in the WP30a executor brief).

**A6 — The registry also carries the CATALOG-lifecycle "current" vocabulary (delta-audit
finding, dual-upheld).** WP27 stage A (post-dossier) made `cbs_catalog.status = 'Regulier'` a
LOAD-BEARING recall-ranking key (`src/catalog/recall.ts` — the 20-current/4-historic shortlist
quota that fixed #111), and that is a DIFFERENT vocabulary (per-table lifecycle:
Regulier/Gediscontinueerd/Vervallen) than D2's per-cell observation statuses. The registry
therefore also carries a per-source `currentCatalogStatuses` set, and recall's partition
consults it for the row's source instead of the literal `'Regulier'`. The D6 harness gains a
matching contract test (an adapter must declare its catalog-lifecycle mapping; fixtures
containing an undeclared status fail). Build timing: the registry FIELD lands in WP30a (CBS
entry only, recall output byte-identical); the recall-consultation wiring + contract test land
in WP30b (recall.ts is fixture-load-bearing — touching it in WP30a buys nothing).

**A7 — Delta deferrals, recorded explicitly (post-dossier code, all fail-open or byte-frozen):**
the two NEW CBS-branded LLM prompts (rerank v2 `src/catalog/rerank-prompt.ts`, fit gate
`src/ingestion/onboarding-fit.ts`) are fixture-hash-frozen → WP30c's owner-signed wording sweep
(per A4, zero LLM bytes before that); the fit gate's deliverability pre-checks key on CBS
OData's `CbsDimensionKind` enum — an adapter-contract point for WP30b's guide (a source's
schema mapping must populate the same kind vocabulary); D2 gains a recorded gap-note: UNIT
notation (#125a's `parseFactorUnit` parses CBS's factor spellings) and region-LABEL formatting
(WP29's `baseLabel` strips CBS's parenthetical suffix) are source-native grammars WITHOUT a D2
bullet — both fail open (missed nicety / dropped chip, never a wrong number), revisit at WP30c
with the first real adapter.

## WP30a as-built (session 36, 2026-07-11 — same session as the review; [PR #26](https://github.com/Stefan7168/checkdecijfers/pull/26) merged `7864271`, main gate + deploy green — LIVE)

Built literally per the [executor brief](../session-briefs/2026-07-11-wp30a-brief.md), with
four recorded as-built refinements:

1. **No `adapterFactory` in the registry.** `src/sources/registry.ts` is a PURE LEAF: it is
   client-bundled (citation, stat-card, chat link import it via `web/lib`), and an adapter
   import would drag the whole `cbs-adapter/` graph into the browser bundle (the stat-card
   leaf-chain discipline). Adapter construction stays at the few node-only call sites until
   WP30b/c gives routing a second target. Supersedes D3's original field list.
2. **The chart spec carries NO `source` field** — the null-note and attribution strings
   resolve at BUILD time (A1 fallback covers stored results without the key), so stored specs
   re-derive byte-identically and `CHART_SPEC_VERSION` stays 1 with zero schema edits.
   Supersedes A3's "optional additive field" wording — carrying the key bought nothing.
3. **`Attribution.license` keeps reading the STORED field** (never the registry) — an old
   row's line re-derives from its own bytes, not from live config.
4. **`statusSuffixNl` in `src/answer/respond/refusals.ts` consolidated too** — the diff
   review surfaced it as a THIRD independent copy of the two-tier provisional wording (its
   skeptics killed the finding on a technicality; the session model upheld the substance:
   D3's whole point is one authority). Byte-identical: map lookup, `''` outside the map.

**Post-build diff review (11 agents, 3 lenses × dual skeptics): 1 confirmed blocker — a
stale strict-`toEqual` in `web/lib/stat-card-data.test.ts` missing the new `sourceLabel`
field (the targeted pre-review test round had missed exactly that file) — fixed in-session
+ an A1 absent-source pin added there.** run.ts's provisional BOOLEAN rule
(`status !== 'Definitief'`) is deliberately untouched (byte-identity); making it
registry-driven is WP30b adapter-contract material.

## WP30b as-built (session 37, 2026-07-11/12 — the conformance harness + guide session, per A5; [PR #27](https://github.com/Stefan7168/checkdecijfers/pull/27) merged `f6bcf26` on the owner's in-chat approval, main gate + deploy green — LIVE)

Built from the frozen [WP30b executor brief](../session-briefs/2026-07-11-wp30b-brief.md), which
was itself produced by a completed pre-build adversarial design review (46 agents, 6 lenses ×
dual skeptics; 20 raw findings → 2 confirmed, 2 split, 16 killed; amendments ⟨B1⟩–⟨B7⟩ recorded
there). What landed:

1. **The conformance harness (D6 as amended by A5/A6)** — `src/sources/conformance.ts`, pure and
   hermetic: families F0 (registry-entry coherence) / F1 (fixture replay through the REAL parse
   code + the D4 id discipline + exactly-one-TimeDimension per A7) / F2 (period-grammar
   round-trip via the new `encodePeriodCode` inverse + declared statuses) / F3
   (value-attribute/null-reason completeness, R11) / F4 (catalog-lifecycle completeness, A6) /
   F5 (the five ingestion validators, registration semantics — `unitsFromMeasures` exported from
   pipeline.ts, one derivation). Driven by per-source manifests
   (`tests/fixtures/<key>/conformance.json`; CBS: all 14 fixture tables, 5 schemaOnly, no
   slices — measured unnecessary). Discovery-driven CBS run + a 23-case
   harness-can-fail suite (the tamper-test discipline).
2. **The A6 recall wiring** — `src/catalog/current-status.ts` builds the per-row is-current SQL
   (simple CASE over the D4 prefix-derived source key, statuses as `::text[]` params, unknown →
   `else false`); recall.ts consults it in place of both `'Regulier'` literals. Byte-identity
   proven by the unchanged recall suite + the hash-pinned find-replay suite; the SQL↔TS
   derivation agreement is pinned over edge ids.
3. **The registry-driven provisional rule** — `SourceInfo.definitiveStatuses` (CBS
   `['Definitief']`), `isProvisionalStatus`, `sourceKeyForTableId`/`resolveSourceForTable`
   (pure, in the leaf registry); run.ts:273 and the freshestDefinitief SQL
   (`= any($6::text[])`, own params array) consult it. R8-safe by construction (`provisional`
   is stored per cell; reconstruct never recomputes — verified).
4. **The routing seam, review-scoped (⟨B1⟩)** — `src/sources/adapters.ts` (`SourceAdapter` alias
   per A5 + `adapterFor` with the loud-throw fetch fail-direction); ONLY the two owner-run CLIs
   wired through it. **The onboarding-cron route is byte-untouched** — its literal-scan wiring
   pin stays literal; WP30c wires the money path when routing has a real second target.
5. **The guide** — [docs/how-to-add-a-source.md](../how-to-add-a-source.md), incl. the verified
   **known WP30c wiring points** (the un-scoped catalog prune wipe at ingest.ts:66, the
   `language='nl'` finder filter, compose's `resolveSource(undefined)`, the cron-route adapter,
   the missing region-taxonomy family, the A4 prompt sweep).

**As-built deviations from the frozen brief (both measured in-session):** (a) F2's code-list
grammar check is scoped to SERVABLE (non-schemaOnly) tables — first harness run caught CBS's own
80416ned carrying 7,492 DAILY period codes (the D2 daily-grain revisit case, kept in fixtures as
a fit-gate specimen; unservable by the pipeline's own gates, so not a conformance failure);
observed-data checks are unconditional. (b) The F1 id check enforces BOTH D4 directions
explicitly (bare ⇒ cbs and cbs ⇒ bare — a `'cbs:'`-prefixed id is malformed), which the brief's
single-equation form missed.

**Post-build diff review (session 37): 3 mid-tier lenses ran; the dual heavy-tier skeptic layer
was LOST to a provider session limit (all 14 skeptic agents errored), so the session model
applied the refutation judgment directly to the 7 raw findings — 6 accepted + fixed in-session,
1 resolved as documentation:** schemaOnly is now VERIFIED not trusted (a schemaOnly table whose
adapter yields rows fails F1 — the dodge the review named); ~10 failure-suite gaps closed (every
F0/F1/F3 sub-check now has a failing test); the frozen brief's freshestDefinitief regression pin
added (tests/query — the sharp case where freshest available ≠ freshest definitief on 82610NED);
manifest validation rejects unknown keys and wrongly-typed `schemaOnly`/`slice` (authoring-typo
safety); the sub-1000-year padding edge added to the encode round-trip; the stale WP30a-era
`currentCatalogStatuses` comment corrected. The judged-to-docs finding: F5's fingerprint/unit
stages are self-consistent BY CONSTRUCTION in the harness (both sides derive from the same
fetched schema) — the honesty note now says so explicitly instead of gaining optional
manifest-baseline machinery; **recorded residual: a future source's manifest MAY want an
optional expected-dimensions baseline (design it with WP30c if its author wants a pinned
shape).**
