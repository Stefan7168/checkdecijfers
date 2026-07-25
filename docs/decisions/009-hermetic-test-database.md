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

---

## As-built addendum — one ingest per run, not one per suite (session 57, 2026-07-25, PR #61 squash `ea71c96`)

The decision above (PGlite per suite, never Supabase in CI) stands unchanged. What changed is how the
*ingested* fixture database is constructed.

Thirty-four test files called `createIngestedDb()`, and each booted its own PGlite and re-ingested all 17
`SEED_TABLES` from the committed fixtures. That cost drove four separate `hookTimeout` raises (30 → 60 → 120
→ 300 s) across four sessions, each treating the symptom. Measured: **7.9 s and 10.7 s** for two consecutive
cold builds.

Now the ingest runs **once** per `vitest run` in `globalSetup`, is dumped via PGlite's `dumpDataDir()` to a
content-hash-keyed file under `node_modules/.cache/`, and each suite restores a **private** copy — measured
**1.16-1.39 s**.

**Isolation is preserved, and that is the load-bearing property:** each caller still gets its own PGlite
instance, so only the expensive construction is shared, never a running database. Two suites deliberately
delete rows and restore them in a `finally`; under a genuinely shared mutable database they would go
order-dependent. Proven, not assumed — deleting all 98,672 observations from one restored copy leaves a
sibling at 98,672, and that is a test (`tests/db/fixture-snapshot.test.ts`).

**Two defects found by the review of this change, both fixed before merge:** the cache key was a hand-written
list that missed six files which decide the database's contents (a warm cache would then have let 34 suites
pass against a pre-fix database) — it now covers all of `src/`; and the read path could throw, taking all 34
dependent suites down on a corrupt cache file — every snapshot failure is now a slow path, never a red one.

**Measured and deliberately not done:** snapshotting `createTestDb()` as well. Applying the migrations to an
empty PGlite costs ~0.8 s, which a restore does not beat.

⚠ **The suite-level "680 s → 440 s" figure quoted at merge time is CONFOUNDED** — baseline and result were
measured at different machine loads. The per-suite mechanism numbers above are clean (back-to-back, one
machine). A same-conditions A/B is queued for the next session.
