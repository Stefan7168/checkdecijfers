# ADR 002 — PostgreSQL as system of record; no vector database in Phase 0

**Status:** accepted, 2026-07-02

## Context

Principle (b) (see [CLAUDE.md](../../CLAUDE.md)) requires CBS data to be bulk-ingested into our own database. The notes converge on PostgreSQL but also float Pinecone, Qdrant, and Supabase pgvector for semantic table discovery ("Wat is de inflatie?" ≈ "Hoeveel duurder is het leven geworden?").

## Decision

**PostgreSQL is the single system of record** for ingested CBS data, the table registry, and audit records. Managed hosting (e.g. Supabase, Neon) is an implementation choice, not a commitment — nothing may depend on vendor-specific features except plain Postgres.

Core schema shape (sketch, refined at build time):

- `cbs_tables` — registry: our ID, CBS table ID, title, description, the table's **full dimension list** with a pinned default ("totaal") coordinate per dimension, period grains with per-grain coverage and **semantics** (stand per 1 januari vs. jaargemiddelde vs. jaartotaal), ingested slice ranges when a table is partially ingested, units, update cadence, last sync, **schema fingerprint**, version.
- `observations` — long/narrow facts: table ref, measure, the **full set of dimension coordinates** (region and period are typed specializations; other dimensions — Geslacht, Leeftijd, seizoenscorrectie, bestedingscategorie — stored generically), value, unit, **value status** (CBS `ValueAttribute`: voorlopig / definitief / null-with-reason), ingestion batch.
- `dimension_labels` — keyed by **(table, dimension, code)** → human label (the "translation layer" the notes call the real IP), plus the alias policy: each everyday term ("inflatie", "werkloosheid") maps to one canonical headline measure and preferred table.
- `ingestion_batches` — when, what, row counts, validation outcome.
- `audit_answers` — one record per answer: question, parsed intent, query plan, result IDs, numbers used, table versions, timestamps.

**CBS tables are N-dimensional — the model must be too, from day one.** Verified against live CBS (2026-07-02): the CPI table carries a spending-category dimension and *no region at all*; population tables carry up to four classification dimensions beside region and period; labour tables carry a seasonal-adjustment dimension. A model hard-coded to measure×region×period cannot ingest these losslessly, and retrofitting dimensions later means re-ingesting everything. Region and period stay special (typed, validated, used for freshness), but as specializations of a generic dimension mechanism — not the whole mechanism.

**No vector database and no pgvector in Phase 0.** With 5–10 tables, intent→table matching is a registry lookup over titles, measures, and a hand-maintained alias list (e.g. "inflatie" → CPI table). Embeddings solve a discovery problem we won't have until the catalog grows.

## Alternatives considered

1. **Postgres + pgvector from day one.** Cheap to add, but it changes how intent parsing is built and tested, and adds a tuning surface (embeddings, thresholds) before there's any evidence a lookup table fails. Deferred, not rejected — pgvector (inside the same Postgres) is the *designated* upgrade path, so no separate vector DB is ever needed.
2. **Dedicated vector DB (Pinecone/Qdrant).** The notes themselves discarded this ("Geen dure, losse vector-databases nodig"). Rejected.
3. **SQLite / DuckDB.** Attractive for a prototype, but Phase 1+ needs concurrent web access and managed backups; migrating the system of record after Phase 0 would burn the schema work. Rejected.

## Consequences

- One database to operate, back up, and reason about; audit trail lives beside the data it references.
- The long `observations` format trades storage for uniform querying and simple validation — right trade at CBS scale for our table subset.

## Revisit triggers

- Table catalog grows past ~50 tables or benchmark-style intent-matching misses appear → enable pgvector for table discovery.
- Observation volume makes Postgres aggregation slow (beyond roughly 100 million rows) → evaluate an analytics-optimized companion database (e.g. DuckDB) *behind the same query module*.
