# ADR 025 — CBS catalog table discovery: two-stage keyword-first finder (WP16 sub-part 1)

**Status:** accepted, 2026-07-05 (session 24, WP16 sub-part 1). Supersedes the "flat refusal on missing data" framing for the discovery step only; the async fetch/verify/store steps are WP16 sub-parts 2–5 (own ADRs).

## Context

WP16 makes a missing-data question trigger an on-demand CBS fetch instead of a dead-end. Its hardest sub-part is **discovery**: map a user topic we don't have loaded ("bijstand", "huizenprijzen") to the right CBS table id out of CBS's full catalog (~4,858 tables), so the fetch/verify/store steps have a concrete id to work on. A wrong table is a principle-(c) risk. This ADR records the discovery design; the [08-build-plan](../08-build-plan.md) WP16 brief is the plan of record it firms up.

Empirically measured this session (public read-only GETs against `datasets.cbs.nl/odata/v1/CBS/Datasets`), correcting the brief's earlier research:
- The catalog listing returns **all 4,858 rows in one response** (no `@odata.nextLink`), each carrying `Identifier`, `Title`, **`Description`** (the full blurb — present in the listing itself, and `contains(Description,…)` *is* server-filterable, contrary to the brief), `Status` (`Regulier`/`Gediscontinueerd`/`Vervallen`), `DatasetType` (`Numeric`/`Mixed`/`Text`), `Language`, `Modified`.
- The catalog **`Identifier` is verbatim the id the data endpoints require** (`Properties/85773NED` → 200, `/85773` → 404), casing load-bearing — so a discovered id feeds the ingestion pipeline with no mapping.
- **`$search` is a no-op** (HTTP 200 + irrelevant results) — never used.

## Decisions

### 1. Two-stage, keyword-first: Postgres FTS recall → LLM rerank. pgvector deferred.

**Stage 1 (deterministic recall):** Dutch Postgres full-text search (`to_tsvector('dutch', …)` + GIN, title weighted above summary via `setweight`) over a **local catalog mirror**, plus curated alias hints — no LLM, no CBS call. Output: a bounded shortlist (`RECALL_LIMIT = 20`). `DatasetType='Text'` and non-`nl` rows are excluded (a text table has no numbers, so it can never answer a numeric question — principle c).

**Stage 2 (LLM rerank):** the shortlist's titles/blurbs + the topic → a schema-validated ranked pick + confidence. **Hard allowlist validator (`validateRerankOutput`): the picked id MUST be one of the shortlist ids sent** — enforced in deterministic code after schema validation, not in the JSON schema (mirrors R3's verbatim-number rule / principle a — the LLM emits a choice, never invents an id). An off-allowlist pick throws and routes to disclosure — never a wrong table.

**pgvector stays deferred** (ADR [002](002-postgres-system-of-record.md)'s designated upgrade). It becomes an *additive* second recall signal into the same Stage-2 shortlist only once keyword recall is **measured** to miss real tables — not a v1 redesign.

### 2. The catalog is a separate, bulk-refreshed mirror (`cbs_catalog`), never live-queried (principle b)

`migrations/011_cbs_catalog.sql` adds `cbs_catalog` — **structurally separate** from `cbs_tables` (WP16: "don't conflate or repurpose columns"): it is "known to CBS, not yet ingested" vs `cbs_tables`'s "registered + ingested", no FK between them. Discovery is added as a new `CbsSource.fetchCatalog()` method (real in `odata-v4.ts`, replayed from a captured fixture in `fixture-source.ts`), keeping the ADR [003](003-cbs-access-layer.md) isolation seam — **this closes ADR 003's own revisit trigger #3** ("catalog ambitions outgrow manual onboarding"). The mirror is bulk-refreshed via the `catalog:refresh` CLI — the cadence is an open operational choice ([#106](../open-questions.md)); for now it runs by hand in a maintenance session. The request path only ever reads our own table.

### 3. The rerank is a variant of the ADR-004 intent role, run on the small/fast tier — NOT Fable

The rerank is a **closed multiple-choice over a supplied shortlist** with a hard allowlist — an *easier* shape than intent parsing's open Dutch→structure extraction, which already runs on `claude-haiku-4-5` (`INTENT_MODEL`). So `TABLE_RERANK_MODEL = 'claude-haiku-4-5'`. The owner authorized Fable on WP16's hard sub-parts and asked whether the topic→table node earns it; the code-grounded answer is **no for v1**: the principle-(c) risk is contained **structurally** (allowlist + conservative confidence threshold + multi-candidate disclosure + the downstream verification gate), not by model size, so Fable here would be a cost bug (ADR 004 "model per task" + the delegation cost-tier rule). The model is a single named constant with a recorded **escalation ladder Haiku → Sonnet → Fable**, triggered only by a *measured* accuracy miss **within a good shortlist** (a quality miss, not a safety breach). Temperature 0, hermetic via the shared record/replay harness (ADR [012](012-intent-parsing-llm-harness.md)); the `tablefinder:record`/`:eval` scripts are off the CI gate.

### 4. Confidence routing feeds existing mechanisms, never new ones

`findTable` returns one of: **`confident`** (≥ `DEFAULT_FIND_TABLE_CONFIG.highConfidence` = 0.8, calibrated live in session 25 — see Consequences; the confident FLOOR is measured, the disclose boundary is not yet) → sub-part 2's fetch+verify gate; **`disclose`** (low confidence or a rerank error) → the #21/#39 multi-candidate disclosure pattern, shown *before* any ingest (ingest costs real minutes + credits — never ingest-several-then-pick); **`none`** (recall empty) → an honest "we can't find a candidate". The rerank is *injected* into `findTable` so the routing is unit-tested without recorded LLM fixtures.

## Alternatives considered

- **pgvector / embeddings first** — the semantic-search project. Rejected for v1: builds the expensive path before the cheap one is proven insufficient (phase-gate + cost discipline); keyword recall + alias hints demonstrably finds the right tables on the measured fixture. Deferred, not rejected (ADR 002 trigger).
- **The legacy `opendata.cbs.nl/ODataCatalog`** (filterable `ShortDescription` + a real theme taxonomy). Rejected: CBS is steering away from it, and its table count (5,943) diverges from v4's (4,858) by ~1,000 — a table CBS has could read as "we don't have that" (coverage risk). v4 is the platform the rest of the adapter already uses.
- **One LLM call over the whole catalog** (no recall stage). Rejected: ~4,858 titles is far more tokens per question, and without a shortlist there is no bounded allowlist to constrain the pick. Recall both cuts cost and *is* the allowlist.
- **A dynamic per-request `enum` of shortlist ids in the JSON schema** (so the model literally cannot emit an off-list id). Considered; the brief mandates the allowlist as a deterministic post-parse check regardless, and keeping the schema static keeps its bytes stable. The code check is the load-bearing guard; a schema enum would be redundant belt-and-suspenders at the cost of a per-request schema. Revisitable if the model ever emits off-list ids in practice.
- **Fable for the rerank** — see decision 3. Rejected for v1 on cost-tier grounds; escalation is a one-line change gated on measurement.

## Consequences

- First use of Postgres full-text search in the codebase (verified working on the PGlite hermetic DB — `dutch` config, `setweight` generated `tsvector`, GIN, `plainto_tsquery`/`ts_rank`). Still plain Postgres, ADR 002-compliant.
- A new module seam `src/catalog/` (ingest, recall, aliases, rerank, find) joins the ADR [001](001-single-app-vs-split.md) module list as the discovery seam.
- **Measured currency insight:** on pure keyword match, discontinued older tables outrank the live one (e.g. "inflatie" → 1990s-era tables above `86141NED`). The rerank prompt explicitly prefers `Regulier` over `Gediscontinueerd`/`Vervallen` unless the topic is historical — a real quality lever the shortlist alone doesn't solve. This is why Stage 2 exists.
- **Hermetic now / supervised deferred.** Shipped in session 24, all hermetic (€0 LLM spend, no live DDL): the migration file, the adapter method + a real captured catalog fixture, ingest, recall, rerank scaffolding + the allowlist validator, the orchestrator + routing, and their tests. **Deferred to a supervised step (owner-authorized) — now DONE except the last item, see the next bullet:** applying migration 011 to production, the real catalog bulk-refresh, recording the rerank replay fixtures against the labelled set (real Haiku spend), and calibrating `highConfidence` were all done in session 25; only wiring `findTable` into the answer flow remains (sub-part 2).
- **Supervised step DONE (session 25, owner present) — measured.** Migration 011 applied to production; the RUNBOOK per-migration grants/RLS check confirmed `cbs_catalog` locked by inheritance (0 `anon`/`authenticated` grants, RLS enabled, 0 policies — live-verified, not assumed). Real `catalog:refresh` mirrored **4,858 rows** (Numeric 4,473 / Mixed 309 / Text 76; Regulier 1,277 / Gediscontinueerd 3,559 / Vervallen 22 — the discontinued-dominant reality that makes the "prefer Regulier" rerank rule load-bearing), and production Dutch FTS recall was exercised live (all 8 registered tables present; "inflatie"/"huizenprijzen"/"faillissementen" top-5 raw recall is all-discontinued — Stage-2 does the real work). `tablefinder:record` run live (Haiku): first pass 5/8; the 3 misses were one **mislabel** (zonnepanelen — the rerank's `85004NED` "zonnestroom-productie" beats the seed's general-renewables `82610NED`, verified from CBS metadata + adversarial review) and two **Stage-1 recall gaps** (bevolking, woningvoorraad — fixed with alias hints); re-record → **8/8**. `highConfidence` **calibrated to 0.8**: confident floor 0.85 (measured, stable), failure-safe (below-0.8 → disclose, never a wrong table). An **end-to-end replay test** now pins the finder on the gate (`tests/catalog/find-replay.test.ts`, hermetic, €0). **Honesty note (review catch):** the confident/disclose boundary is *not* directly measured — the labelled set has no disclose-expected case — so 0.8 is a confident-floor value; a disclose case + a live-mirror re-check are owed in sub-part 2 ([#104](../open-questions.md)). **Operational quirk recorded:** node/undici couldn't reach CBS from the calibration host (IPv6 black-hole; curl worked) — an IPv4-force preload let the unmodified CLI run ([lessons-learned](../lessons-learned.md)).

## Revisit triggers

- Keyword recall measurably misses relevant tables → add pgvector as an additive recall signal into the same shortlist (ADR 002).
- Rerank accuracy misses within a good shortlist on the labelled set → escalate `TABLE_RERANK_MODEL` (Haiku → Sonnet → Fable), one line.
- Recall needs dimension-name signal (title+summary insufficient) → a per-table metadata enrichment pass feeding the `tsvector`.
- v4 catalog coverage gaps surface real "we don't have that" for tables CBS actually publishes → reconsider a legacy-catalog merge.
- LLM spend > ~€50/mo (ADR 004) → prompt caching + tier re-evaluation.
