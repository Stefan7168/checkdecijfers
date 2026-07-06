# ADR 003 — CBS access via bulk ingestion behind an adapter

**Status:** accepted, 2026-07-02

## Context

Confirmed principle (b): CBS data is bulk-ingested into our own database, never queried live from the frontend. Verified facts (from the kickoff, not re-litigated): the classic OData v3 API (opendata.cbs.nl) caps responses at 10,000 cells; OData v4 (datasets.cbs.nl) returns up to 100,000 cells with pagination; CBS offers bulk channels for full-table ingestion. CBS has announced a long-term migration to an SDMX/.Stat Suite platform — **postponed indefinitely as of early 2026, but not cancelled**. The notes add operational color: tables are redesigned or archived mid-year with new codes when definitions change politically ("bijstand", "migratieachtergrond"); CBS has no fixed publication times and corrects historical figures retroactively without announcement.

## Decision

1. **Ingest via OData v4 / bulk channels** into Postgres (ADR [002](002-postgres-system-of-record.md)), with one documented fallback: the v3 platform's **bulk feed**. The 10,000-cell cap applies to the v3 *query API*, which is banned; the v3 bulk feed is uncapped and is CBS's own documented bulk channel. The fallback matters because the v4 catalog is a **partial subset** of StatLine (verified live 2026-07-02: natural Phase 0 candidates such as `70072NED` and `03759NED` exist only on the v3 platform). A v3-only table means the adapter grows a second fetch/parse implementation (v3 wide format vs. v4 long format) — budgeted as Phase 0 work if table selection requires it. Table selection ([open-questions.md](../open-questions.md) #1) therefore checks per candidate: platform availability *and* observation count (some v4 tables run to tens of millions of rows; prefer smaller equivalents or record a registered slice).
2. **All CBS contact goes through one adapter interface** (`CbsSource`: list catalog metadata, fetch table schema, fetch observations) with exactly one implementation today (OData v4). The SDMX migration then costs one new adapter implementation, not a rewrite. No module outside the adapter may know CBS URL shapes or OData semantics.
3. **Schema fingerprint per sync.** Each ingestion computes a fingerprint of the table's structure (dimensions, measures, units). On mismatch with the registry: the table is marked `needs_review` and **excluded from answering** until a human (or reviewed AI session) re-maps it. Silent structural drift must never reach users — this is the redesign-risk defense.
4. **Freshness metadata is first-class**: every sync records time and covered periods; answers surface it (see [05-data-rules.md](../05-data-rules.md)).

**Assumption:** CC BY 4.0 plus CBS's documented bulk channels mean no separate permission is needed for sustained bulk ingestion; CBS fair-use guidance is checked during Phase 0 setup ([open-questions.md](../open-questions.md) #13).

## Alternatives considered

1. **Live per-question CBS queries** (with caching). Rejected — violates confirmed principle (b); the notes document CBS as "berucht traag", with outages Stefan personally observed; freshness and traceability become unauditable.
2. **Hybrid: ingest hot tables, live-query the long tail.** Superficially attractive, but every live path re-opens the hallucination/validation problem the architecture exists to close, and creates two code paths to test. Rejected for Phase 0–2; reconsider only if the catalog must grow faster than ingestion can follow.
3. **Third-party wrappers/mirrors of CBS data.** Adds a dependency with unknown freshness guarantees between us and the source of truth; our promise is *official* cell-level traceability. Rejected.

## Consequences

- We own freshness: local data can lag CBS between syncs. Mitigated by cadence metadata per table and freshness display on every answer; a stale table is never silently served — it carries an explicit staleness warning or triggers refusal, per the failure rules in [05-data-rules.md](../05-data-rules.md).
- We own storage/normalization cost — trivial at 5–10 tables.
- A local copy doubles as availability insurance when CBS is down (a selling point the notes flagged).

## Revisit triggers

- CBS re-activates the SDMX/.Stat migration or announces v3/v4 deprecation dates → schedule the second adapter implementation.
- A mid-year redesign hits a loaded table (expect this) → verify the fingerprint defense worked; tune if it paged a human too late.
- Catalog ambitions outgrow manual table onboarding → invest in adapter-level catalog sync.

## CBS data channels — as-built reference (verified from code, session 28)

CBS exposes several delivery channels; this project **consumes exactly one — the OData v4 API** — and never the others from the request path. The decision above anticipated a v3-bulk-feed fallback; today only the v4 adapter exists in code (`src/cbs-adapter/odata-v4.ts`).

- **OData v4 API — `https://datasets.cbs.nl/odata/v1/CBS`** ✅ *the one we use* (`odata-v4.ts`, `const BASE`). Two endpoints:
  - `/Datasets` — the full ~4,858-table **catalog** (the list of every CBS table). Mirrored into our own `cbs_catalog` (migration 011) so the table-finder searches OUR copy, never CBS live (principle b; ADR [025](025-cbs-catalog-table-discovery.md)).
  - `/{tableId}/Observations` (+ `/$count`) — per-table **data** (the cells), ingested on onboarding with the 150k-cell slice cap.
- **OData v3 / "Cube" feed — `https://opendata.cbs.nl/ODataApi/odata`** — the older API (TableInfos, TypedDataSet, dimension code-lists); the **v3 *bulk* feed remains the documented fallback** (decision 1) but is not implemented. The v3 *query* API's 10k-cell cap is why it is banned. Only ever hit ad-hoc by a human/session for a one-off metadata lookup.
- **StatLine (web portal)** — only the DESTINATION of the user-facing "Bekijk bij CBS" deep-link (#86 / WP23); our request path never touches it.
- **Bulk CSV download** — not used; we fetch targeted Observations via the API, not whole-table file downloads.

**Relevance to the finder ([#111](../open-questions.md) stock-vs-flow):** the `/Datasets` catalog carries mainly *title + description* per table — that is all the finder matches on today. A table's **measures + dimensions** (stock vs flow, total vs breakdown) live in the per-table metadata on the *same* v4 API — that is the extra signal the finder-precision work must pull in.
