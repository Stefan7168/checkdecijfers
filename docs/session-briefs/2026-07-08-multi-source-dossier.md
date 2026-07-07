# Multi-source readiness dossier (session 30, 2026-07-08) — what is CBS-hardwired vs already source-agnostic

**Input for ADR [030](../decisions/030-multi-source-architecture.md) / WP30.** Produced by a 3-agent
code audit (adapter/ingestion, query/answer, product/ops — mid tier), findings verified by citation.
Owner constraints for the design: **subject scope stays "Nederland" for now; the source itself is
undecided → design source-NEUTRAL**; design now, build after WP27.

## The headline

**The narrow waist already exists de facto.** The ingestion pipeline, all five validators (four
fully, one CBS-vocabulary-bound), the query layer's derivations/dry-run, the compose/validate
machinery, the billing gate, the audit trail and CI are written against interfaces
(`CbsSource`, `ResultCell`, `Attribution`, the registry contract) — none of them care which
organization produced a row. What is missing is not a rewrite but **formalization**: a source
IDENTITY that flows from the registry into `Attribution`, plus per-source vocabularies for the
handful of places CBS's own grammar leaked into the canonical model.

## Structural findings (need real design — the ADR 030 decisions)

1. **No source discriminator anywhere**: one global table-id namespace (`cbs_tables`,
   `cbs_catalog`, `observations`, `canonical_measures`, `pending_table_requests` all key on bare
   `table_id`); `StructuredIntent`/`ResultCell`/`Attribution`/`StatCardData`/benchmark schemas carry
   no `source` field. Root cause of most other findings.
2. **The period model is CBS's grammar** (`JJ|KW|MM` codes, `\d{4}(JJ|KW|MM)\d{2}`), re-parsed
   independently in ingestion, query, intent, compose. Single largest surface if generalized —
   avoidable if adapters MAP INTO it (ADR 030 D2).
3. **Region taxonomy is the Dutch hierarchy** (land/landsdeel/provincie/gemeente, NL/LD/PV/GM
   prefixes, duplicated in two places). The owner's "Nederland scope" decision makes this a KEEPER,
   not a blocker.
4. **`cbs_tables.platform` check-constrained to `'v4'`** — the one existing source-ish column
   actively forbids a second value.
5. **R11 status + null-reason vocabularies are CBS's exact words** (`Definitief/Voorlopig/
   NaderVoorlopig`; `Impossible/Confidential/NotAvailable`), with provisional-detection hardcoded
   on them.
6. **`Attribution.license` is the literal type `'CC BY 4.0'`**; `buildAttributionLine` hardcodes
   *"Bron: CBS StatLine, tabel …"*; `web/lib/citation.ts` and the stat-card SVG spell the label out
   independently (three call sites that can drift).
7. **The product asserts CBS-exclusivity as fact**: the meta 'sources' template ("Al mijn cijfers
   komen rechtstreeks … van CBS StatLine"), the intent-prompt prose, layout metadata, and the
   CLAUDE.md public claim — plus `scripts/run-validation-pass.ts` fixtures whose EXPECTED behavior
   is "refuse: only CBS" (they go stale the day source #2 ships).
8. **Single adapter instance wired everywhere** (ingest CLI, catalog CLI, onboarding cron route
   construct exactly one `ODataV4Source`) — no routing layer, because nothing exists to route on.

## Mechanical findings (legwork once the design lands)

Catalog SQL table/column parameterization; `PHASE0_TABLES`/alias hints as CBS-only config data;
`NL01` national-code literal; `ONBOARDING_MAX_CELLS`/`NATIONAL_REGION_PREFIX` constants; CLI
`--source` flag; fixture dirs/capture scripts (`tests/fixtures/cbs/`, `capture-cbs-fixtures.ts`);
benchmark task/answer-key `source` field + scorer; ADR 001/003/04-architecture doc language
("cbs-adapter" as the module noun, revisit triggers phrased purely as CBS lifecycle events);
RUNBOOK gets a parallel per-source section (additive).

## Cosmetic findings

`Cbs*` type/file/directory names; `DERIVED_DATA_MARKING` "…van CBS-gegevens…"; dozens of Dutch UI
strings ("Bekijk bij CBS StatLine", chat empty-state, onboarding ack copy, layout description) —
a project-wide truthfulness sweep of literals, mostly blocked on the source field existing.

## Already agnostic (verified — do not rebuild)

`registerTables`/`syncTable` against the interface; validators (pure over canonical shapes);
`FixtureSource` multi-table replay; the slice algebra; the whole derivations/R5 layer; the Db
abstraction; CI's generically-named gates; `runOnboardingJob`'s injected `source` dep; the
registry CONTRACT (with the `OnboardedMeasure` runtime-extension path already proven live).
