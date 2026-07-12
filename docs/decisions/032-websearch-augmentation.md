# ADR 032 — Web search as a separated, unverified augmentation channel (#130)

**Status:** PROPOSED — the *direction* is owner-confirmed (2026-07-11, session 36, in-chat: "De aanbevelingen: we kunnen alles vastleggen"); the *details* (copy, pricing, section shape, failure behavior) await the ~30-minute owner interview (sheet: [session-briefs/2026-07-12-websearch-interview-sheet.md](../session-briefs/2026-07-12-websearch-interview-sheet.md)). Nothing in this ADR is build-authorized until that interview closes the open points.

**Date:** 2026-07-12 (session 39; cost research executed per the owner's "best en voordeligst" ask)

## Context

The owner wants web search as a combinable source (open-questions #130): a question can use CBS (pre-checked) and/or web search, with internet findings combined into the answer. This is the single most principle-touching feature proposed to date, because:

- **Principle (a):** web content is unstructured and unvalidated — its numbers can never pass R1/R3/R5, and the public claim ("every number traceable to an official CBS cell") does not cover it.
- **Principle (b):** web content is inherently live; there is no meaningful way to bulk-ingest "the web" the way we ingest CBS tables.
- **Principle (c):** an unverified web claim presented as verified would be exactly the fabricated-number class of bug.

The owner-confirmed resolution: **the separation IS the honesty model.** The validated CBS body stays exactly as today (validator-backed, attributed, audit-stored). Below it, a **visually distinct section** — working copy *"Van het web (niet door checkdecijfers geverifieerd)"* — carries web findings with per-claim source links. Web findings NEVER feed the validated body, the validators, the audit numbers, or the charts.

Web search is **not** an ADR-030-waist source (it has no tables/cells to register); it is a separate augmentation channel. WP30c (structured source #2, #123) stays an independent lane.

## Decision (direction — owner-confirmed; details open)

1. **Separated section, per-section honesty claims.** The answer page gets two zones: the validated CBS body (unchanged machinery, unchanged public claim) and an unverified-web section (own styling, own disclaimer, per-claim source links, no numbers promoted into charts/attribution).
2. **Technique: Anthropic's native `web_search` server-side tool** — owner-confirmed preference, now cost-verified (below). One extra Claude API call per web-opted question; the tool executes searches server-side and returns results **with citations always enabled** (the API enforces citation plumbing; cited text/title/URL do not count as tokens). Per-claim source links — exactly what the section design needs — come out of the box.
3. **Opt-in per question via the #129 source-tags chip** = the natural cost gate. No chip selected → no web call, no web cost. Deselecting ALL sources → honest refusal ("geen bronnen geselecteerd"), never a guess.
4. **Zero bytes change in the existing validated pipeline.** Intent-parse and compose prompts stay byte-identical; the web call is a NEW, self-contained LLM call with its own prompt (allowed because this WP says so — the standing zero-prompt-bytes rule protects the *existing* pipeline). Fixtures do not re-record.
5. **Audit/R8:** the web section is stored **verbatim** in the audit row as an additive envelope field (with its citations), per the A1 discipline: `?? null` reads + an absent-key regression test. Reconstruction of a web section = replay of the stored bytes, never re-derivation (the web is non-deterministic; re-searching cannot reproduce it). The #129 selection state rides the audit record so R8 reconstructs *what was searched*.
6. **Conversation memory:** the web section does NOT enter the structured conversation context (ADR 021) in v1 — follow-ups reason over the validated CBS facts only. (Also avoids the API's `encrypted_content` multi-turn replay requirement entirely: each web call is single-shot.)

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

## Constraints (binding on the build, whatever the interview decides)

- Web findings never enter: the validated body, any validator input, `attribution`, chart data, or the benchmark's fabrication scoring. The 20-task benchmark runs with web search OFF and must stay green unchanged.
- The web call is fail-soft: any error → the CBS answer ships exactly as today (the section is absent or carries an honest failure note — interview point Q6).
- The new envelope field ships with `?? null` reads + an absent-key regression test (standing A1 rule; four prior R8 bugs in this class — see #133).
- Displaying the section MUST include the source citations (also an Anthropic display requirement for end-user-facing search output).
- Money path: whether and how credits are charged for the web add-on is an owner pricing decision (interview Q2); the billing gate/ledger primitives are not modified — a web charge, if any, rides the existing debit mechanism.

## Revisit triggers

- Native web_search quality disappoints on Dutch-language queries → evaluate option 2.
- Anthropic pricing changes materially from $10/1K.
- A second augmentation-channel candidate appears (e.g. news APIs) → generalize the section mechanism, don't fork it.

## Open points — closed only by the owner interview

See the [interview sheet](../session-briefs/2026-07-12-websearch-interview-sheet.md): exact Dutch copy (header, disclaimer, failure note), credits pricing, section shape/length, web-only questions (CBS deselected), refund semantics on partial failure, domain policy, and the #129 chip label.
