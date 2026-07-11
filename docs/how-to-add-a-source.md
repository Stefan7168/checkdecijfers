# How to add a data source

**Audience:** a build session (possibly on a smaller model) executing WP30c or a later
source addition. **Authority:** ADR [030](decisions/030-multi-source-architecture.md) (read its
§ Amendments and as-built sections first) and [05-data-rules.md](05-data-rules.md). This guide is
the operational recipe; when it disagrees with those, they win and this file is a bug to fix.

**The one-sentence architecture:** deterministic code computes every number from a canonical
internal model (tables, measures, observations, `YYYY(JJ|KW|MM)NN` periods, the Dutch region
taxonomy, verbatim statuses); ALL source-specificity lives in a per-source **adapter** that maps
native shapes INTO that model, plus one **registry entry** that owns the source's identity and
display vocabulary. Nothing downstream of that waist may branch on "which source" except through
the registry. An adapter is DONE when the **conformance harness** passes on its recorded fixtures
— an executable contract, not a review opinion.

## Before you write any code — owner preconditions (never skip, never autonomous)

1. **The owner picks the source** ([open-questions #123](open-questions.md) — deferred; CBS-first
   until he decides).
2. **License check**: the source's terms must permit our attribution/display pattern (ADR 030
   revisit trigger). CC BY-style is the known-good shape.
3. **Public-claim wording** ("every number traceable to an official CBS cell" → "official
   sources") ships WITH the first second source, **owner-signed** — that sweep (CLAUDE.md, the
   meta 'sources' template, intent-prompt prose, UI copy, stale validation expectations) is
   WP30c-lane and re-records LLM fixtures. Until then: **zero LLM/prompt bytes** (ADR 030 A4).
4. Per [#118](open-questions.md): own branch + PR + owner review; a new source is never an
   autonomous add.

## Step 1 — the registry entry (`src/sources/registry.ts`)

Add one entry to `SOURCES`. The file is a PURE LEAF (client-bundled — no imports, data + pure
lookups only). Every field is load-bearing:

| Field | What it drives | Notes |
|---|---|---|
| `key` | source identity everywhere | lowercase, stable, never `'cbs'`; becomes the id prefix |
| `displayName` | chart null-notes, unknown-marker fallback wording | short org name |
| `attributionLabel` | the R4 attribution line, citations, chat link, stat-card footer | |
| `license` | the attribution line's license clause | legal-checked first |
| `deepLink(tableId)` | "Bekijk bij …" link | `null` if the source has no public viewer; must be `https://` and embed the id verbatim |
| `provisionalDisplay` | R11 suffixes per VERBATIM status (A2: a MAP, e.g. two-tier for CBS) | keys ⊆ your declared period statuses |
| `definitiveStatuses` | which cells are NOT provisional + the freshness query | fail-safe: anything else renders as provisional |
| `nullReasonLabels` | R11 null-reason wording per verbatim value attribute | **owner-approved Dutch** — new wording is an owner sign-off |
| `currentCatalogStatuses` | the finder's current-first shortlist quota (A6) | a DIFFERENT axis than cell statuses: per-table lifecycle |

Three different status axes — do not conflate: **per-cell publication status**
(Definitief/…, drives R11), **per-table catalog lifecycle** (Regulier/…, drives the finder), and
**null-reason value attributes** (Impossible/…, drives refusal wording).

Fail-direction contract (deliberate, already wired): DISPLAY paths fall back to the cbs entry
(A1), catalog RANKING treats an unknown source as not-current, FETCH seams throw loud
(`src/sources/adapters.ts`).

## Step 2 — the adapter

Implement `SourceAdapter` (`src/sources/adapters.ts` — the A5 alias of `CbsSource` in
`src/cbs-adapter/types.ts`; the `Cbs*` wire-type names are historical, ADR 030 A5). Model it on
`src/cbs-adapter/` — one directory, no imports from it into your adapter beyond the shared types.

Mapping obligations (ADR 030 D2 — the adapter maps INTO the canonical grammars; the waist never
changes):

- **Periods → `YYYY(JJ|KW|MM)NN`** (`JJ00` whole year, `KW01–04`, `MM01–12`). The conformance
  harness enforces the round-trip (`parsePeriodCode` → `encodePeriodCode` → identity). **A
  daily/weekly/irregular source is an ADR revisit trigger — STOP and run a design round first**
  (measured precedent: CBS's own 80416ned carries 7,492 daily codes and is undeliverable —
  kept in fixtures only as a fit-gate specimen).
- **Regions → the Dutch taxonomy** (land/landsdeel/provincie/gemeente) or mark data national/
  non-regional. A REGIONAL source needs its region-code mapping designed with the adapter — no
  conformance family checks this yet (WP30c wiring point 5 below).
- **Statuses VERBATIM** — never translate a source's status/marker words; interpretation lives in
  the registry maps (principle a / R11).
- **Dimension kinds faithfully** — exactly ONE `TimeDimension` per table; `GeoDimension` for the
  region dimension. The fit gate's deliverability pre-checks key on these (ADR 030 A7).
- **Table ids: `'<key>:<native-id>'`, spoken NATIVELY by the adapter** (D4). Your
  `fetchTableSchema('politie:47022NED')` strips its own prefix internally; `fetchCatalog()` emits
  prefixed ids. The pipeline never adds or strips prefixes. CBS ids stay bare; a native id may
  itself contain `':'` (the prefix is up to the FIRST colon).
- Numeric payloads only (a non-null `stringValue` fails ingestion); every null cell carries a
  value attribute with a `nullReasonLabels` entry, so refusals can state the TRUE reason.

Known fail-open niceties you inherit but need not fix (A7): `parseFactorUnit` knows CBS's factor
spellings (a missed factor unit = missed display nicety, never a wrong number); WP29's chip
`baseLabel` assumes CBS region-label formatting (worst case: a dropped suggestion chip).

## Step 3 — fixtures

Record REAL wire responses (the `scripts/capture-cbs-fixtures.ts` pattern) into
`tests/fixtures/<key>/<tableId>/` + a catalog capture. Then commit
`tests/fixtures/<key>/conformance.json`:

```json
{
  "sourceKey": "<key>",
  "tables": [
    { "tableId": "<key>:..." },
    { "tableId": "<key>:...", "schemaOnly": true }
  ],
  "declaredPeriodStatuses": ["..."],
  "declaredValueAttributes": ["..."],
  "declaredCatalogStatuses": ["..."],
  "declaredDatasetTypes": ["..."]
}
```

The four `declared*` arrays are the source's FULL vocabularies — the harness fails on anything
observed-but-undeclared (that is the point: no vocabulary surprises after go-live). `schemaOnly`
marks metadata-only captures (row checks skipped). An optional per-table `slice` (the `CbsSlice`
shape) exists for captures that include out-of-slice history the product would never ingest —
CBS needs none (measured).

## Step 4 — the conformance harness (the done-definition)

Add ONE line to `FIXTURE_ADAPTERS` in `tests/sources/conformance.test.ts` — your fixture-replay
adapter factory (it must replay through your REAL parse code, like CBS's `FixtureSource`). Then:

```
npx vitest run tests/sources
```

Green = the D6 contract holds: **F0** registry-entry coherence, **F1** replay through real parse
code + the D4 id discipline + exactly-one-TimeDimension, **F2** period-grammar round-trip +
declared statuses, **F3** value-attribute/null-reason completeness, **F4** catalog-lifecycle
completeness (A6), **F5** the five ingestion validators (registration semantics — proves the
pipeline's gates ACCEPT your shapes; drift detection stays sync-time work). Failure summaries are
plain language — read them, fix the adapter or the declarations, never the harness.

## Step 5 — registration & serving

1. `adapterFor` entry in `src/sources/adapters.ts` (the one routing point).
2. Registry/seed rows + `registerTables` + sync through the standard pipeline (ids prefixed).
3. **The 05-data-rules onboarding rule**: a table leaves `needs_review` only with 2–3 frozen-key
   benchmark-style verification tasks. Honest state of the tooling: the frozen-key mechanism
   today is the Phase-0 benchmark set + the WP16 onboarded-table verification pattern
   (fit-replay / delivery-record); the fully automated per-table pipeline is
   [open-questions #21](open-questions.md) — still open. Budget for hand-authoring those tasks.
4. Migration only if actually needed (016 already widened `platform` and added the `source`
   columns + prefix CHECK) — numbered file, owner applies supervised.

## Known WP30c wiring points (verified landmines — NOT yet wired; plan them into WP30c)

1. **`ingestCatalog`'s prune is not source-scoped** (`src/catalog/ingest.ts:66`): a second
   source's catalog refresh would DELETE the other source's mirror rows. WP30c must scope the
   prune (id prefix, or the migration-016 `source` column once applied) before any second
   `catalog:refresh` runs.
2. **`recall.ts` filters `language = 'nl'`** — a non-Dutch-language catalog is invisible to the
   finder (interacts with the [#131](open-questions.md) i18n lane).
3. **Compose display resolves `resolveSource(undefined)`** (`template.ts`, `refusals.ts`) —
   correct while single-source; WP30c threads the result's actual source into those calls.
4. **The onboarding-cron route constructs its adapter directly** (`web/app/api/onboarding-cron/
   route.ts` — kept byte-identical in WP30b with its literal-scan wiring pin): WP30c routes it
   per-table via `adapterFor`.
5. **No GeoDimension/region-taxonomy conformance family** — design it with the first REGIONAL
   source.
6. `datasetType <> 'Text'` (recall) and the region-prefix tables are canonical-waist vocabulary
   the adapter maps INTO — not per-source config.
7. The CBS-branded LLM prompt prose (`rerank-prompt.ts`, `meta.ts`, intent prompt) is
   fixture-frozen — the WP30c owner-signed wording sweep re-records those fixtures (A4).

## What you must NOT touch

The waist itself: `src/answer/compose/` + `validate.ts`, `src/query/` semantics, `src/billing/`,
prompts/schemas, `src/chart/`, the benchmark scorer, R1–R11. If the source "needs" a waist
change, that is an ADR + owner conversation, not an adapter patch.
