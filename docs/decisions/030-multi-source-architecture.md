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
