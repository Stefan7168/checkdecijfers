# ADR 001 — Single full-stack TypeScript app, not a split frontend + Python backend

**Status:** accepted, 2026-07-02
**Deciders:** Claude (architecture delegated per kickoff); Stefan reviews

## Context

The notes repeatedly propose Next.js frontend + a separate Python/FastAPI "orchestrator" backend, arguing the data world is Python (pandas/numpy). That proposal was written for a product with heavy analysis, enrichment pipelines, and background workers. Phase 0 (see [03-mvp-scope.md](../03-mvp-scope.md)) is much thinner: 5–10 pre-loaded tables, lookups, filters, and simple aggregations. The operator is one non-developer product owner working with AI coding sessions.

## Decision

**One TypeScript full-stack application (Next.js) for Phase 0–1.** The deterministic data layer is TypeScript + SQL. Internally the app is strictly modular — `ingestion/`, `cbs-adapter/`, `query/`, `validation/`, `answer/`, `chart/` as separate modules with typed interfaces — so a later split extracts modules rather than untangling them. CBS ingestion runs as an out-of-band script in the same codebase (invoked manually or by a scheduled runner), never inside a request-path serverless function.

## Evaluation against the kickoff's four criteria

**(a) Does the data layer need Python?** Not in Phase 0. The table operations are: fetch cells, filter by dimension, compare, difference, rank — all native SQL. Pandas earns its keep at multi-source joins, geodata, and statistical transforms; none of that exists before the enrichment phase (roadmap Phase 3+).

**(b) Refresh workloads on serverless.** The real risk with a single serverless-deployed app. Mitigation: ingestion is a CLI/scheduled job, not a web request. At 5–10 tables (tens of MB, minutes of runtime) this runs comfortably as a scheduled job or from the operator's machine. If tables × size grows past what a scheduled TS job handles, that is a split trigger (below), not a reason to pre-build a worker fleet.

**(c) Operability for one non-developer + AI sessions.** The decisive criterion. One repo, one language, one deploy, one log stream. A split doubles deployments, secrets, CORS/auth plumbing between services, and the mental model every future AI session must reconstruct.

**(d) Cost.** Single app: ~€0/mo at 0 users (hobby tiers + LLM per query), ~€25–75/mo at 100 active users, ~€200–600/mo at 1,000 (LLM-dominated; see [04-architecture.md](../04-architecture.md)). A split adds €5–12/mo fixed hosting plus a second CI/CD path at every stage — small in euros, large in operational surface.

## Alternatives considered

1. **Next.js + separate Python FastAPI service** (the notes' favorite). Right shape for the *eventual* enrichment product; wrong for Phase 0 — it front-loads operational complexity to serve workloads that don't exist yet. Rejected now, documented as the migration target.
2. **Python-only full stack** (FastAPI + server-rendered UI). Keeps one language but the wrong one for the product surface: streaming chat UI, chart rendering, and the AI SDK ecosystem are strongest in TypeScript. Rejected.
3. **Edge-first (Cloudflare Workers as the engine).** The notes themselves rejected this; runtime limits fit neither ingestion nor long LLM calls. Rejected.

## Consequences

- Fastest possible path to the Phase 0 gate; one codebase for AI sessions to hold in context.
- We accept TS+SQL expressiveness limits for statistics; anything beyond SQL comfort is a signal, not a workaround target.
- Hosting choice (e.g. Vercel or similar serverless platform) is an implementation detail within this ADR, not a separate commitment.

## Migration path & triggers (to the split architecture)

Extract `ingestion/` + `query/` into a Python (or dedicated TS) service behind the existing module interfaces when **any** of:

1. Enrichment sources land (PDOK/Kadaster geodata, RIVM, UWV — roadmap Phase 3) requiring real data-science tooling.
2. Ingestion jobs exceed scheduled-job limits (runtime > ~10 min per run, memory pressure, or > ~50 tables).
3. Always-on background workloads arrive (scoop-alert scanning).
4. Statistical validation grows past SQL (seasonal adjustment, significance testing).

The module boundaries above are the contract that keeps this migration a lift, not a rewrite.
