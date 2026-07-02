# STATUS

> **Tracker, not a source of truth.** Scope and the gate are defined in [03-mvp-scope.md](03-mvp-scope.md), the benchmark in [02-user-scenarios.md](02-user-scenarios.md). This file only records progress against them. Update it whenever project state changes (see the definition of done in [CLAUDE.md](../CLAUDE.md)) — with **measured results only, never aspirational ones**.

**Current phase:** Phase 0 — ready to build (docs signed off; owner account setup pending)
**Last updated:** 2026-07-02 — doc set signed off; repo pushed to GitHub (Stefan7168/checkdecijfers, private); Phase 0 build unblocked ([RUNBOOK.md](RUNBOOK.md) has the path)

## Phase 0 checklist

- [x] Open questions #10, #18, #20 answered by Stefan (2026-07-02 — see [open-questions.md](open-questions.md))
- [x] Doc-set sign-off by Stefan (2026-07-02)
- [ ] CBS table set chosen; IDs validated against the live catalog (open-questions #1)
- [ ] Benchmark answer key frozen ([02-user-scenarios.md](02-user-scenarios.md), Scoring)
- [ ] Ingestion + validation pipeline with fixture tests ([05-data-rules.md](05-data-rules.md))
- [ ] Table registry + alias list
- [ ] Intent parsing (schema-validated, ranked candidates + confidence)
- [ ] Deterministic query + validation + registered derivations
- [ ] Answer composition with verbatim/semantic/unit checks (R1–R3, R9–R10)
- [ ] Chart spec + dumb renderer (ADR [007](decisions/007-chart-spec-rendering.md))
- [ ] Refusal & clarification behavior
- [ ] Audit record per answer (R8)
- [ ] CI gate live (ingestion fixtures + invariant tests + benchmark scorer on every push)
- [ ] Provider spend caps, billing alerts, and dependency alerts set
- [ ] Full benchmark run recorded below

## Benchmark scoreboard

| Date | Answerable (of 14) | Refusal (of 6) | Fabricated numbers | Median response | Gate verdict |
|---|---|---|---|---|---|
| — | — | — | — | — | not yet run |

Gate: ≥12/14 answerable, 6/6 refusal, **zero** fabricated numbers ([03-mvp-scope.md](03-mvp-scope.md)). Also reported, informational: median latency, clarification count on B1–B14, template-fallback count, un-disambiguated phrasing check ([02-user-scenarios.md](02-user-scenarios.md), Scoring).

## Next up

1. Stefan: create the three remaining accounts — Anthropic API (+ spend cap), Supabase, Vercel ([RUNBOOK.md](RUNBOOK.md); GitHub done, repo pushed 2026-07-02).
2. Phase 0 build kickoff in a fresh chat — one work package per session ([RUNBOOK.md](RUNBOOK.md), "How work happens"). Session 1: CI skeleton + validate CBS table IDs against the live catalog (open-questions #1).

## Phase history

| Phase | Status | Gate result |
|---|---|---|
| Docs / discovery | ✅ complete (2026-07-02) | — |
| Phase 0 | not started | — |
| Phase 1 | — | — |
| Phase 2 | — | — |
