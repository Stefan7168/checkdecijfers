# STATUS

> **Tracker, not a source of truth.** Scope and the gate are defined in [03-mvp-scope.md](03-mvp-scope.md), the benchmark in [02-user-scenarios.md](02-user-scenarios.md). This file only records progress against them. Update it whenever project state changes (see the definition of done in [CLAUDE.md](../CLAUDE.md)) — with **measured results only, never aspirational ones**.

**Current phase:** Phase 0 — build in progress (session 3 done: benchmark answer key frozen)
**Last updated:** 2026-07-03 — PR #2 (WP2: ingestion + validation pipeline) merged to `main` (green CI, owner-authorized). Session 3: **benchmark answer key frozen** ([benchmark/answer-key.json](../benchmark/answer-key.json)) — all 14 answerable tasks (B1–B14) plus the B20 freshness reference, each entry re-queried directly from the ingested `observations` table (not copied from docs) and cross-matching docs/07's independently-measured values exactly. Two registry-internal variant choices pinned as assumptions pending the registry work package ([open-questions #35](open-questions.md) B6 stock-date, [#36](open-questions.md) B9 bankruptcy definition); B20's freshest-available-vs-freshest-Definitief policy also flagged ([#37](open-questions.md)). `scripts/score-benchmark.mjs` updated to validate the frozen key's structure honestly (14/14 + B20 present, shape-correct) rather than hard-failing until the answer pipeline exists — CI stays green. Full local gate green: typecheck, ingestion (29 tests), invariants, benchmark (15 tests incl. new `answer-key.test.ts`), scorer. `DATABASE_URL` verified and corrected to the IPv4 session pooler with pinned-CA TLS ([RUNBOOK.md](RUNBOOK.md), secrets register); migration 001 applied to Supabase. **First live ingest (measured 2026-07-02 UTC / 2026-07-03 session date): all 8 tables, 641,024 rows, 0 failures, 0 corrections.** Post-ingest sanity check: **17/17 benchmark-cell coverage checks pass** — every cell B1–B14 + B20 needs exists in the database, and every reference value docs/07 states reproduces exactly (incl. solar 2024 = 21,822 mln kWh *NaderVoorlopig* — the R11 marker — and both ×1,000-unit cells the R10 guard covers). Database size: 230 MB of the 500 MB free tier (headroom decision: [open-questions #33](open-questions.md))

## Phase 0 checklist

- [x] Open questions #10, #18, #20 answered by Stefan (2026-07-02 — see [open-questions.md](open-questions.md))
- [x] Doc-set sign-off by Stefan (2026-07-02)
- [x] CBS table set chosen; IDs validated against the live catalog (2026-07-02, open-questions #1 resolved — 8 tables, all v4-reachable, every benchmark period confirmed present: [07-phase0-table-set.md](07-phase0-table-set.md))
- [x] Benchmark answer key frozen (2026-07-03: [benchmark/answer-key.json](../benchmark/answer-key.json) — 14/14 answerable tasks + B20 freshness reference, values re-verified against the live ingest, not just copied from docs; [02-user-scenarios.md](02-user-scenarios.md), Scoring)
- [x] Ingestion + validation pipeline with fixture tests (2026-07-03: five ordered checks, quarantine, correction-diff log, idempotent syncs; the 10 inherited `todo` obligations are now 21 real fixture tests + 8 adapter tests on an embedded real-Postgres test DB (ADR [009](decisions/009-hermetic-test-database.md)); adversarial review found and fixed 2 ordering/defaulting bugs; live ingest recorded above)
- [ ] Table registry + alias list
- [ ] Intent parsing (schema-validated, ranked candidates + confidence)
- [ ] Deterministic query + validation + registered derivations
- [ ] Answer composition with verbatim/semantic/unit checks (R1–R3, R9–R10)
- [ ] Chart spec + dumb renderer (ADR [007](decisions/007-chart-spec-rendering.md))
- [ ] Refusal & clarification behavior
- [ ] Audit record per answer (R8)
- [x] CI gate live (2026-07-02): GitHub Actions runs typecheck + the three gate suites on every push. State after WP3 (2026-07-03): 46 real tests + 11 `todo`-marked answer-side obligations (R1–R11) that turn into real tests with their work packages; the scorer validates the frozen key's structure (14/14 answerable entries + B20) but still reports zero scores — real scoring against audit records lands with the answer pipeline. Deploy-blocking attaches at Vercel setup
- [ ] Provider spend caps, billing alerts, and dependency alerts set
- [ ] Full benchmark run recorded below

## Benchmark scoreboard

| Date | Answerable (of 14) | Refusal (of 6) | Fabricated numbers | Median response | Gate verdict |
|---|---|---|---|---|---|
| — | — | — | — | — | not yet run |

Gate: ≥12/14 answerable, 6/6 refusal, **zero** fabricated numbers ([03-mvp-scope.md](03-mvp-scope.md)). Also reported, informational: median latency, clarification count on B1–B14, template-fallback count, un-disambiguated phrasing check ([02-user-scenarios.md](02-user-scenarios.md), Scoring).

## Next up

1. Owner: authorize the PR (WP3: benchmark answer key frozen) merge once CI is green.
2. Owner: confirm or override the two registry-internal defaults pinned as assumptions this session — B6 stock-date ([open-questions #35](open-questions.md)) and B9 bankruptcy definition ([#36](open-questions.md)) — before the registry work package encodes them as permanent aliases.
3. Session 4 (proposed): **table registry + alias list** (canonical defaults, period semantics — the registry columns already exist and are seeded; B5's seasonally-adjusted default is already decided, B6/B9's defaults are pinned above pending owner confirmation).

## Phase history

| Phase | Status | Gate result |
|---|---|---|
| Docs / discovery | ✅ complete (2026-07-02) | — |
| Phase 0 | in progress (started 2026-07-02) | — |
| Phase 1 | — | — |
| Phase 2 | — | — |
