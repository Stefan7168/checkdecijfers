# STATUS

> **Tracker, not a source of truth.** Scope and the gate are defined in [03-mvp-scope.md](03-mvp-scope.md), the benchmark in [02-user-scenarios.md](02-user-scenarios.md). This file only records progress against them. Update it whenever project state changes (see the definition of done in [CLAUDE.md](../CLAUDE.md)) — with **measured results only, never aspirational ones**.

**Current phase:** Phase 0 — not started (documentation under review)
**Last updated:** 2026-07-02 — documentation set complete, awaiting Stefan's review

## Phase 0 checklist

- [ ] Docs reviewed and approved by Stefan (incl. [open-questions](open-questions.md) #10, #18, #20)
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
- [ ] Full benchmark run recorded below

## Benchmark scoreboard

| Date | Answerable (of 14) | Refusal (of 6) | Fabricated numbers | Median response | Gate verdict |
|---|---|---|---|---|---|
| — | — | — | — | — | not yet run |

Gate: ≥12/14 answerable, 6/6 refusal, **zero** fabricated numbers ([03-mvp-scope.md](03-mvp-scope.md)).

## Next up

1. Stefan: review the doc set; answer open questions #18 (stale-serve behavior) and #20 (rejected business models); confirm #10.
2. Then: Phase 0 build kickoff — the first implementation session starts at [CLAUDE.md](../CLAUDE.md).

## Phase history

| Phase | Status | Gate result |
|---|---|---|
| Docs / discovery | ✅ complete (2026-07-02) | — |
| Phase 0 | not started | — |
| Phase 1 | — | — |
| Phase 2 | — | — |
