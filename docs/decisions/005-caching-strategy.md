# ADR 005 — Caching: none in Phase 0; Postgres-first later; Redis only on measured need

**Status:** accepted, 2026-07-02

## Context

The notes lean heavily on caching (Redis/Upstash, 24h vs 7-day TTL debates, "50 journalists asking about inflation = 1 CBS call", sub-100ms claims). But most of that reasoning predates the bulk-ingestion decision: once data lives in our own Postgres (ADR [003](003-cbs-access-layer.md)), there is no per-question CBS call to save. What remains cacheable is LLM work and repeated identical questions.

## Decision

- **Phase 0: no cache layers at all.** Queries hit pre-loaded Postgres; that is already the "cache". Benchmark latency (~10s median target) is dominated by LLM calls, which a cache doesn't help until questions repeat.
- **Phase 1–2, when repeated questions appear:** an **answer cache in Postgres** — normalized intent hash → composed answer + result IDs, invalidated by table sync version (not by wall-clock TTL). This resolves the notes' 24h-vs-7-day TTL contradiction: freshness is anchored to *data versions*, so a cached answer is valid exactly as long as its source tables are unchanged.
- **Redis (e.g. Upstash) only on a measured trigger**, for the jobs Postgres does badly: per-user rate limiting at public launch, and hot-path latency if p95 measurably suffers under load. Not before.

## Alternatives considered

1. **Redis from day one** (the notes' default). Another service to operate and a second source of truth for state, bought before any load exists. Rejected.
2. **TTL-based caching** (24h/7-day). Wall-clock TTLs either serve stale data after a sync or expire fresh data pointlessly; version-keyed invalidation is strictly better given we control sync events. Rejected.
3. **CDN/edge caching of answers.** Useful later for public shareable answer pages (roadmap Phase 2 SEO idea), irrelevant for authenticated chat. Deferred to that feature's design.

## Consequences

- One less moving part for the solo operator; cache correctness (the classic bug farm) is deferred until there's traffic that pays for it.
- We accept that the notes' "answer in 100ms" marketing claim is not a Phase 0–1 property; honesty gates in [03-mvp-scope.md](../03-mvp-scope.md) reflect that.

## Revisit triggers

- Repeated-question rate > ~20% of traffic → build the Postgres answer cache.
- Public launch (Phase 2) → rate limiting required; evaluate Redis vs. Postgres-based limiter at that point.
- p95 answer latency > ~15s under real load → profile; add caching where the profile says, not where folklore says.
