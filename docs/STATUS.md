# STATUS

> **Tracker, not a source of truth.** Scope and the gate are defined in [03-mvp-scope.md](03-mvp-scope.md), the benchmark in [02-user-scenarios.md](02-user-scenarios.md). This file only records progress against them. Update it whenever project state changes (see the definition of done in [CLAUDE.md](../CLAUDE.md)) — with **measured results only, never aspirational ones**.

**Current phase:** Phase 0 — build in progress (session 1 done: CI skeleton + CBS table set)
**Last updated:** 2026-07-02 — work package 1 delivered on branch `wp1-ci-skeleton-cbs-table-set` (PR pending owner merge); accounts created (Anthropic/Supabase/Vercel — see [RUNBOOK.md](RUNBOOK.md) for the two ⚠ leftovers: spend-cap confirmation, `DATABASE_URL`)

## Phase 0 checklist

- [x] Open questions #10, #18, #20 answered by Stefan (2026-07-02 — see [open-questions.md](open-questions.md))
- [x] Doc-set sign-off by Stefan (2026-07-02)
- [x] CBS table set chosen; IDs validated against the live catalog (2026-07-02, open-questions #1 resolved — 8 tables, all v4-reachable, every benchmark period confirmed present: [07-phase0-table-set.md](07-phase0-table-set.md))
- [ ] Benchmark answer key frozen ([02-user-scenarios.md](02-user-scenarios.md), Scoring)
- [ ] Ingestion + validation pipeline with fixture tests ([05-data-rules.md](05-data-rules.md))
- [ ] Table registry + alias list
- [ ] Intent parsing (schema-validated, ranked candidates + confidence)
- [ ] Deterministic query + validation + registered derivations
- [ ] Answer composition with verbatim/semantic/unit checks (R1–R3, R9–R10)
- [ ] Chart spec + dumb renderer (ADR [007](decisions/007-chart-spec-rendering.md))
- [ ] Refusal & clarification behavior
- [ ] Audit record per answer (R8)
- [x] CI gate live (2026-07-02): GitHub Actions runs typecheck + the three gate suites on every push. Honest-skeleton state: 9 real tests (benchmark structure vs docs/02, doc-consistency, frozen-flag coherence) + 21 `todo`-marked obligations (R1–R11, ingestion corruption fixtures) that turn into real tests with their work packages; the scorer refuses to report scores until the key freezes. Deploy-blocking attaches at Vercel setup
- [ ] Provider spend caps, billing alerts, and dependency alerts set
- [ ] Full benchmark run recorded below

## Benchmark scoreboard

| Date | Answerable (of 14) | Refusal (of 6) | Fabricated numbers | Median response | Gate verdict |
|---|---|---|---|---|---|
| — | — | — | — | — | not yet run |

Gate: ≥12/14 answerable, 6/6 refusal, **zero** fabricated numbers ([03-mvp-scope.md](03-mvp-scope.md)). Also reported, informational: median latency, clarification count on B1–B14, template-fallback count, un-disambiguated phrasing check ([02-user-scenarios.md](02-user-scenarios.md), Scoring).

## Next up

1. Stefan: merge the work-package-1 PR (CI must be green first — that's the signal); confirm the Anthropic spend cap; paste `DATABASE_URL` into `.env` ([RUNBOOK.md](RUNBOOK.md)).
2. Session 2 (proposed): ingestion + validation pipeline with fixture tests, against the 8-table set in [07-phase0-table-set.md](07-phase0-table-set.md) — including the registered slices and the catalog quirks listed there. The answer-key freeze follows ingestion (keys pin to ingested cells, not live reads).

## Phase history

| Phase | Status | Gate result |
|---|---|---|
| Docs / discovery | ✅ complete (2026-07-02) | — |
| Phase 0 | in progress (started 2026-07-02) | — |
| Phase 1 | — | — |
| Phase 2 | — | — |
