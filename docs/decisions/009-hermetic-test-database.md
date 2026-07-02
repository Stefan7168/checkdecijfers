# ADR 009 — PGlite as the hermetic test database for ingestion fixtures

**Status:** accepted, 2026-07-02

## Context

The CI gate is deliberately hermetic: no secrets, no network beyond npm (its
workflow file says so, and the owner's trust model depends on it — a green run
must not depend on Supabase being up or a credential being present). But the
ingestion fixture tests required by [05-data-rules.md](../05-data-rules.md)
exercise real SQL: transactional staging, upserts against a unique natural key,
jsonb columns, correction diffs. Mocking the database would test our mocks, not
the pipeline.

## Decision

Fixture tests run against **PGlite** (`@electric-sql/pglite`, a WASM build of
real PostgreSQL) as a dev dependency: in-memory, per-test-file, no Docker, no
network, no secrets. The pipeline is written against a minimal `Db` interface
([src/db/types.ts](../../src/db/types.ts)); production binds it to `pg`/Supabase,
tests bind it to PGlite, and both run the **same committed migration files** —
so the schema the tests prove is the schema production runs (ADR
[002](002-postgres-system-of-record.md)'s plain-Postgres rule keeps this
honest: no vendor-specific SQL exists to diverge).

## Alternatives considered

1. **Postgres service container in CI + local Docker.** Highest fidelity
   (byte-identical server), but breaks "no network/no infra" hermeticity, adds
   Docker as a local prerequisite the non-developer owner would have to
   maintain, and slows every CI run. Rejected while PGlite covers every feature
   the pipeline uses.
2. **Mocked/fake Db layer.** Fast, but the invariants live in SQL semantics
   (unique-key conflicts, `is distinct from` diffs, transactional rollback) —
   exactly what a fake silently gets wrong. Rejected.
3. **A test schema on the real Supabase instance.** Puts secrets and network in
   CI, risks test writes near production data, and couples the gate's
   availability to a vendor. Rejected.

## Consequences

- Tests prove SQL behavior on real Postgres semantics with zero infrastructure;
  a fresh clone runs `npm test` with nothing installed but npm packages.
- PGlite is one Postgres minor version behind at times; plain-Postgres SQL only
  (already required by ADR 002) keeps the gap irrelevant.

## Revisit triggers

- The pipeline needs a Postgres feature PGlite lacks or gets wrong → move the
  affected suite to a CI service container (keep PGlite for the rest).
- A bug ships that PGlite-backed tests passed but Supabase Postgres rejects →
  add a scheduled (non-gating) integration run against a real instance.
