# ADR 032 — Web search as a separated, unverified augmentation channel (#130)

**Status:** ✅ ACCEPTED (2026-07-12, session 39, owner in-chat) — direction confirmed 2026-07-11 (session 36); all ten detail points from the interview sheet confirmed the same session as this ADR was drafted (owner reviewed the four highest-weight points explicitly — pricing, web-only mode, failure/refund, domain policy — then said "Go with your defaults" for all ten). Full answers: [session-briefs/2026-07-12-websearch-interview-sheet.md](../session-briefs/2026-07-12-websearch-interview-sheet.md). Build-authorized; the remaining step is a frozen executor brief (WP27/WP30b pattern — pre-build adversarial review before the build), not another owner decision.

**Date:** 2026-07-12 (session 39; cost research executed per the owner's "best en voordeligst" ask)

## Context

The owner wants web search as a combinable source (open-questions #130): a question can use CBS (pre-checked) and/or web search, with internet findings combined into the answer. This is the single most principle-touching feature proposed to date, because:

- **Principle (a):** web content is unstructured and unvalidated — its numbers can never pass R1/R3/R5, and the public claim ("every number traceable to an official CBS cell") does not cover it.
- **Principle (b):** web content is inherently live; there is no meaningful way to bulk-ingest "the web" the way we ingest CBS tables.
- **Principle (c):** an unverified web claim presented as verified would be exactly the fabricated-number class of bug.

The owner-confirmed resolution: **the separation IS the honesty model.** The validated CBS body stays exactly as today (validator-backed, attributed, audit-stored). Below it, a **visually distinct section** — working copy *"Van het web (niet door checkdecijfers geverifieerd)"* — carries web findings with per-claim source links. Web findings NEVER feed the validated body, the validators, the audit numbers, or the charts.

Web search is **not** an ADR-030-waist source (it has no tables/cells to register); it is a separate augmentation channel. WP30c (structured source #2, #123) stays an independent lane.

## Decision (direction + all details owner-confirmed, session 39)

1. **Separated section, per-section honesty claims.** The answer page gets two zones: the validated CBS body (unchanged machinery, unchanged public claim) and an unverified-web section (own styling, own disclaimer, per-claim source links, no numbers promoted into charts/attribution). Header copy (Q1): **"Van het web (niet door checkdecijfers geverifieerd)"**.
2. **Technique: Anthropic's native `web_search` server-side tool** — owner-confirmed preference, cost-verified (below). One extra Claude API call per web-opted question, capped `max_uses: 3` (Q9); the tool executes searches server-side and returns results **with citations always enabled** (the API enforces citation plumbing; cited text/title/URL do not count as tokens). `user_location` set to Nederland, no domain allowlist (Q7).
3. **Opt-in per question via the #129 source-tags chip**, labelled **"Internet"** (Q8) = the natural cost gate. No chip selected → no web call, no web cost. Deselecting ALL sources → honest refusal ("geen bronnen geselecteerd"), never a guess. Deselecting CBS but keeping Internet → **the product answers with ONLY the unverified-web section** (Q4) — the section's own disclaimer carries the honesty, the public claim does not apply to that answer.
4. **Pricing (Q2): +10 credits** on top of the normal question price when the web chip is selected — rides the existing debit mechanism, no new ledger primitive.
5. **Section shape (Q3):** max ~4 short findings, each one sentence + a **domain-name-only** source link (no raw URL), in a visually distinct bordered block below the validated CBS body; never numbers in bold, never a chart.
6. **When CBS refuses but Internet is selected (Q5):** the refusal text is untouched; the web section may still render below it (the user paid for the web add-on independently of the CBS outcome).
7. **Web-call failure (Q6):** fail-soft — a one-line honest note ("De webzoekopdracht is niet gelukt — geen extra kosten") and an **automatic refund** of the web add-on credits via the existing compensation mechanism. The CBS answer always ships regardless.
8. **Zero bytes change in the existing validated pipeline.** Intent-parse and compose prompts stay byte-identical; the web call is a NEW, self-contained LLM call with its own prompt (allowed because this WP says so — the standing zero-prompt-bytes rule protects the *existing* pipeline). Fixtures do not re-record.
9. **Audit/R8:** the web section is stored **verbatim** in the audit row as an additive envelope field (with its citations), per the A1 discipline: `?? null` reads + an absent-key regression test. Reconstruction of a web section = replay of the stored bytes, never re-derivation (the web is non-deterministic; re-searching cannot reproduce it). The #129 selection state rides the audit record so R8 reconstructs *what was searched*.
10. **Conversation memory:** the web section does NOT enter the structured conversation context (ADR 021) in v1 — follow-ups reason over the validated CBS facts only. (Also avoids the API's `encrypted_content` multi-turn replay requirement entirely: each web call is single-shot.)
11. **Build sequencing (Q10):** #129 (source chips UI) and #130 (web channel) build TOGETHER as one WP, chips first then the web channel, in the same branch/PR per #118.

## Cost verification (measured 2026-07-12 — the "best en voordeligst" answer)

**Native web_search (option 1, chosen):** **$10 per 1,000 searches = $0.01 (~€0.009) per search**, plus standard token costs — search-result content bills as input tokens on the call that uses it. Errors are not billed. A typical factual question uses 1–3 searches (per Anthropic's own guidance); with `max_uses: 3` as the cap:

| Component | Basis | Per web-opted question |
|---|---|---|
| Searches | 1–3 × $0.01 | $0.01–$0.03 |
| Result tokens (input) | ~5–15K tokens on a mid-tier model ($3/MTok) | $0.015–$0.045 |
| Output tokens (the section) | ~300–600 tokens ($15/MTok) | $0.005–$0.01 |
| **Total** | | **≈ $0.03–$0.09 (€0.03–€0.08)** |

**Search-API + own pipeline (option 2, fallback):** Brave $5/1K requests; Tavily $8/1K basic / $16/1K advanced. The raw per-search fee is at most half a euro-cent cheaper than native — but we would still pay comparable LLM tokens to read the results, PLUS build and maintain our own fetching/extraction/citation pipeline (real engineering cost, real breakage surface, and citations become our correctness burden instead of the API's). **Verdict: the per-search price difference is negligible against the pipeline cost; native wins on "voordeligst" once engineering time counts, and wins outright on citation reliability.** Option 2 remains the recorded fallback if native quality disappoints in practice.

**Option 3 (own scraping): owner-rejected for v1** (recorded in #130).

Model choice for the augmentation call (not an owner decision; recorded here): a mid-tier model with `web_search_20260209`+ (dynamic filtering — results are code-filtered before hitting context, cutting token cost on search-heavy questions). Cheap-tier models only support the basic tool variant with `allowed_callers: ["direct"]` and load every result into context — likely *more* expensive in tokens than mid-tier with filtering, and weaker at honest summarization. Express as a named config constant (like `TABLE_RERANK_MODEL`), never hardcoded in prose.

Useful tool knobs confirmed in the docs: `max_uses` (hard cost cap per request), `allowed_domains`/`blocked_domains` (one or the other, not both), `user_location` (localize to NL). Tool errors come back **in-band** (HTTP 200 with an error object in the result block) — fail-soft is structurally easy.

## Alternatives considered

1. **Anthropic native web_search** — chosen (above).
2. **Search API (Brave/Tavily) + own pipeline** — fallback; loses built-in citations, adds an owned pipeline; per-search savings negligible (above).
3. **Own scraping** — owner-rejected for v1; highest maintenance, highest legal/robots.txt surface, no citation machinery.
4. **Blend web findings into the validated body** — rejected outright: it would put unvalidatable claims behind the public claim; the worst possible bug class (principle c).

## Constraints (binding on the build)

- Web findings never enter: the validated body, any validator input, `attribution`, chart data, or the benchmark's fabrication scoring. The 20-task benchmark runs with web search OFF and must stay green unchanged.
- The web call is fail-soft: any error → the CBS answer ships exactly as today, plus the Q6 honest note + automatic refund.
- The new envelope field ships with `?? null` reads + an absent-key regression test (standing A1 rule; four prior R8 bugs in this class — see #133).
- Displaying the section MUST include the source citations (also an Anthropic display requirement for end-user-facing search output), domain-name-only per Q3.
- Money path: +10 credits (Q2), rides the existing debit mechanism; billing gate/ledger primitives are not modified.

## Revisit triggers

- Native web_search quality disappoints on Dutch-language queries → evaluate option 2 (search API + own pipeline).
- Anthropic pricing changes materially from $10/1K.
- A second augmentation-channel candidate appears (e.g. news APIs) → generalize the section mechanism, don't fork it.

## Status: ready for the frozen executor brief

All owner decisions are closed (interview sheet, above). The next step is the WP27/WP30b pattern: a pre-build adversarial review producing a frozen executor brief, then the build on its own branch + PR (per #118 — this touches core-product/money-path code, so autonomous sessions merge nothing without owner review even though this decision itself was made owner-present).
