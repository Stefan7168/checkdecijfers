# STATUS

> **Tracker, not a source of truth.** Scope and the gate are defined in [03-mvp-scope.md](03-mvp-scope.md), the benchmark in [02-user-scenarios.md](02-user-scenarios.md). This file only records progress against them. Update it whenever project state changes (see the definition of done in [CLAUDE.md](../CLAUDE.md)) — with **measured results only, never aspirational ones**.

**Current phase:** Phase 0 — build in progress (session 2 done: ingestion + validation pipeline, first live ingest)
**Last updated:** 2026-07-03 — work package 2 pushed as PR #2 (merge after green CI + owner authorization). `DATABASE_URL` verified and corrected to the IPv4 session pooler with pinned-CA TLS ([RUNBOOK.md](RUNBOOK.md), secrets register); migration 001 applied to Supabase. **First live ingest (measured 2026-07-03): all 8 tables, 641,024 rows, 0 failures, 0 corrections; 8/8 doc-07 reference cells reproduced from the database** (incl. solar 2024 = 21,822 mln kWh *NaderVoorlopig* — the R11 marker — and both ×1,000-unit cells the R10 guard covers)

## Phase 0 checklist

- [x] Open questions #10, #18, #20 answered by Stefan (2026-07-02 — see [open-questions.md](open-questions.md))
- [x] Doc-set sign-off by Stefan (2026-07-02)
- [x] CBS table set chosen; IDs validated against the live catalog (2026-07-02, open-questions #1 resolved — 8 tables, all v4-reachable, every benchmark period confirmed present: [07-phase0-table-set.md](07-phase0-table-set.md))
- [ ] Benchmark answer key frozen ([02-user-scenarios.md](02-user-scenarios.md), Scoring)
- [x] Ingestion + validation pipeline with fixture tests (2026-07-03: five ordered checks, quarantine, correction-diff log, idempotent syncs; the 10 inherited `todo` obligations are now 21 real fixture tests + 8 adapter tests on an embedded real-Postgres test DB (ADR [009](decisions/009-hermetic-test-database.md)); adversarial review found and fixed 2 ordering/defaulting bugs; live ingest recorded above)
- [ ] Table registry + alias list
- [ ] Intent parsing (schema-validated, ranked candidates + confidence)
- [ ] Deterministic query + validation + registered derivations
- [ ] Answer composition with verbatim/semantic/unit checks (R1–R3, R9–R10)
- [ ] Chart spec + dumb renderer (ADR [007](decisions/007-chart-spec-rendering.md))
- [ ] Refusal & clarification behavior
- [ ] Audit record per answer (R8)
- [x] CI gate live (2026-07-02): GitHub Actions runs typecheck + the three gate suites on every push. State after WP2 (2026-07-03): 37 real tests + 11 `todo`-marked answer-side obligations (R1–R11) that turn into real tests with their work packages; the scorer refuses to report scores until the key freezes. Deploy-blocking attaches at Vercel setup
- [ ] Provider spend caps, billing alerts, and dependency alerts set
- [ ] Full benchmark run recorded below

## Benchmark scoreboard

| Date | Answerable (of 14) | Refusal (of 6) | Fabricated numbers | Median response | Gate verdict |
|---|---|---|---|---|---|
| — | — | — | — | — | not yet run |

Gate: ≥12/14 answerable, 6/6 refusal, **zero** fabricated numbers ([03-mvp-scope.md](03-mvp-scope.md)). Also reported, informational: median latency, clarification count on B1–B14, template-fallback count, un-disambiguated phrasing check ([02-user-scenarios.md](02-user-scenarios.md), Scoring).

## Next up

1. Owner: authorize the PR #2 merge once CI is green (the WP2 gate signal).
2. Session 3 (proposed): **freeze the benchmark answer key** — now unblocked, keys pin to the ingested cells of the 2026-07-03 sync batches ([02-user-scenarios.md](02-user-scenarios.md), Scoring). If the session has room, start the **table registry + alias list** (canonical defaults, period semantics — the registry columns already exist and are seeded).

## Phase history

| Phase | Status | Gate result |
|---|---|---|
| Docs / discovery | ✅ complete (2026-07-02) | — |
| Phase 0 | in progress (started 2026-07-02) | — |
| Phase 1 | — | — |
| Phase 2 | — | — |
