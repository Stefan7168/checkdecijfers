# ADR 003 — CBS access via bulk ingestion behind an adapter

**Status:** accepted, 2026-07-02

## Context

Confirmed principle (b): CBS data is bulk-ingested into our own database, never queried live from the frontend. Verified facts (from the kickoff, not re-litigated): the classic OData v3 API (opendata.cbs.nl) caps responses at 10,000 cells; OData v4 (datasets.cbs.nl) returns up to 100,000 cells with pagination; CBS offers bulk channels for full-table ingestion. CBS has announced a long-term migration to an SDMX/.Stat Suite platform — **postponed indefinitely as of early 2026, but not cancelled**. The notes add operational color: tables are redesigned or archived mid-year with new codes when definitions change politically ("bijstand", "migratieachtergrond"); CBS has no fixed publication times and corrects historical figures retroactively without announcement.

## Decision

1. **Ingest via OData v4 / bulk channels** into Postgres (ADR [002](002-postgres-system-of-record.md)). The v3 API's 10k-cell cap makes it unsuitable for ingestion; it is not used.
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
