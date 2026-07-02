# STATUS

> **Tracker, not a source of truth.** Scope and the gate are defined in [03-mvp-scope.md](03-mvp-scope.md), the benchmark in [02-user-scenarios.md](02-user-scenarios.md). This file only records progress against them. Update it whenever project state changes (see the definition of done in [CLAUDE.md](../CLAUDE.md)) — with **measured results only, never aspirational ones**.

**Current phase:** Phase 0 — build in progress (session 4 done: table registry + alias list)
**Last updated:** 2026-07-03 — PR #3 (WP3: benchmark answer key frozen) merged to `main` (green CI, owner-authorized). Session 4: **table registry + alias list** (ADR [010](decisions/010-registry-canonical-measures.md)) — `cbs_tables.default_coordinates`/`.period_semantics` populated for all 8 tables (migration 001 columns, empty until now), plus a new `canonical_measures` table (migration 002, the alias list) with one row per headline concept (population, inflation, unemployment, ...), each carrying its Dutch definition label and any alternate CBS readings kept visible. Formalizes the B5 (already-decided), B6, and B9 canonical defaults from WP3 as the live registry data — B6/B9 remain flagged as owner-revisable assumptions ([open-questions #35](open-questions.md)/[#36](open-questions.md)), now encoded rather than only documented. Applied to the live database (idempotent, re-run twice with identical results) and covered by 14 new hermetic tests, 8 of which cross-check the registry against `benchmark/answer-key.json` directly (catches drift between the two by construction). Full local gate green: typecheck, 60 real tests (was 46), scorer.
Previously (session 3, 2026-07-03): **benchmark answer key frozen** ([benchmark/answer-key.json](../benchmark/answer-key.json)) — all 14 answerable tasks (B1–B14) plus the B20 freshness reference, each entry re-queried directly from the ingested `observations` table (not copied from docs) and cross-matching docs/07's independently-measured values exactly. `scripts/score-benchmark.mjs` updated to validate the frozen key's structure honestly rather than hard-failing until the answer pipeline exists.
`DATABASE_URL` verified and corrected to the IPv4 session pooler with pinned-CA TLS ([RUNBOOK.md](RUNBOOK.md), secrets register); migrations 001-003 applied to Supabase. **First live ingest (measured 2026-07-02 UTC / 2026-07-03 session date): all 8 tables, 641,024 rows, 0 failures, 0 corrections.** Post-ingest sanity check: **17/17 benchmark-cell coverage checks pass** — every cell B1–B14 + B20 needs exists in the database, and every reference value docs/07 states reproduces exactly (incl. solar 2024 = 21,822 mln kWh *NaderVoorlopig* — the R11 marker — and both ×1,000-unit cells the R10 guard covers). Database size: 230 MB of the 500 MB free tier (headroom decision: [open-questions #33](open-questions.md)).
**Security fix (2026-07-03):** Supabase's "Automatically expose new tables" setting had granted `anon`/`authenticated` full CRUD on every table via the unused Data API — not exploitable in practice (Supabase's own RLS-auto-enable safety net already blocked it) but real attack surface with no offsetting benefit. Migration 003 revokes it properly (verified clean via `get_advisors`: 2 WARN + 6 INFO → 6 INFO). One manual step remains for the owner (RUNBOOK.md, Supabase account line): turn off that dashboard toggle so future tables aren't re-exposed.

## Phase 0 checklist

- [x] Open questions #10, #18, #20 answered by Stefan (2026-07-02 — see [open-questions.md](open-questions.md))
- [x] Doc-set sign-off by Stefan (2026-07-02)
- [x] CBS table set chosen; IDs validated against the live catalog (2026-07-02, open-questions #1 resolved — 8 tables, all v4-reachable, every benchmark period confirmed present: [07-phase0-table-set.md](07-phase0-table-set.md))
- [x] Benchmark answer key frozen (2026-07-03: [benchmark/answer-key.json](../benchmark/answer-key.json) — 14/14 answerable tasks + B20 freshness reference, values re-verified against the live ingest, not just copied from docs; [02-user-scenarios.md](02-user-scenarios.md), Scoring)
- [x] Ingestion + validation pipeline with fixture tests (2026-07-03: five ordered checks, quarantine, correction-diff log, idempotent syncs; the 10 inherited `todo` obligations are now 21 real fixture tests + 8 adapter tests on an embedded real-Postgres test DB (ADR [009](decisions/009-hermetic-test-database.md)); adversarial review found and fixed 2 ordering/defaulting bugs; live ingest recorded above)
- [x] Table registry + alias list (2026-07-03: ADR [010](decisions/010-registry-canonical-measures.md); `cbs_tables.default_coordinates`/`.period_semantics` populated for all 8 tables, `canonical_measures` alias list seeded with 8 canonical concepts, applied live and idempotently; 14 hermetic tests incl. cross-checks against the frozen benchmark key)
- [ ] Intent parsing (schema-validated, ranked candidates + confidence)
- [ ] Deterministic query + validation + registered derivations
- [ ] Answer composition with verbatim/semantic/unit checks (R1–R3, R9–R10)
- [ ] Chart spec + dumb renderer (ADR [007](decisions/007-chart-spec-rendering.md))
- [ ] Refusal & clarification behavior
- [ ] Audit record per answer (R8)
- [x] CI gate live (2026-07-02): GitHub Actions runs typecheck + the four gate suites on every push. State after WP4 (2026-07-03): 60 real tests + 11 `todo`-marked answer-side obligations (R1–R11) that turn into real tests with their work packages; the scorer validates the frozen key's structure (14/14 answerable entries + B20) but still reports zero scores — real scoring against audit records lands with the answer pipeline. Deploy-blocking attaches at Vercel setup
- [ ] Provider spend caps, billing alerts, and dependency alerts set
- [ ] Full benchmark run recorded below

## Benchmark scoreboard

| Date | Answerable (of 14) | Refusal (of 6) | Fabricated numbers | Median response | Gate verdict |
|---|---|---|---|---|---|
| — | — | — | — | — | not yet run |

Gate: ≥12/14 answerable, 6/6 refusal, **zero** fabricated numbers ([03-mvp-scope.md](03-mvp-scope.md)). Also reported, informational: median latency, clarification count on B1–B14, template-fallback count, un-disambiguated phrasing check ([02-user-scenarios.md](02-user-scenarios.md), Scoring).

## Next up

1. Owner: authorize the PR (WP4: table registry + alias list) merge once CI is green.
2. Owner: confirm or override the two registry-internal defaults now encoded live — B6 stock-date ([open-questions #35](open-questions.md)) and B9 bankruptcy definition ([#36](open-questions.md)). Not blocking: both are one-row updates in `src/registry/defaults.ts` + a re-run of `npm run registry:apply` if overridden.
3. Session 5 (proposed): **intent parsing** (schema-validated, ranked candidates + confidence, R7) — the first work package that actually reads `canonical_measures`.

## Phase history

| Phase | Status | Gate result |
|---|---|---|
| Docs / discovery | ✅ complete (2026-07-02) | — |
| Phase 0 | in progress (started 2026-07-02) | — |
| Phase 1 | — | — |
| Phase 2 | — | — |
