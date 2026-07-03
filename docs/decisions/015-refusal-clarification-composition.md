# ADR 015 — Refusal & clarification composition (WP9)

**Status:** accepted (2026-07-03) · **Owner sign-off:** follows the confirmed principles; no new product-policy decisions beyond those recorded in open-questions
**Relates to:** ADR [004](004-llm-usage.md) (LLM confinement), ADR [011](011-query-contract.md) (typed refusals), ADR [012](012-intent-parsing-llm-harness.md) (harness + fixtures), ADR [013](013-answer-composition.md) (structural fields), docs/05 failure-behaviour table, docs/02 B15–B20

## Context

WP5 produces ten kinds of typed query refusal; WP6 classifies forecast/causal/out-of-scope/compound/smalltalk questions and builds clarification questions. Until WP9, none of that was user-facing behaviour: nothing phrased refusals in Dutch, nothing handled the reply to a clarification, and the staleness row of the failure-behaviour table had no implementation. WP9's done-criterion is B15–B20 passing 6/6 with no guessed numbers.

## Decision 1 — Refusal/clarification phrasing is deterministic templates, never an LLM

Every non-answer message (refusals of all kinds, clarification questions, guidance) is assembled by deterministic code in `src/answer/respond/` from structured fields only. The LLM phrases nothing on these paths.

**Why:** these messages exist precisely because there is no validated number to phrase. An LLM could only add fabrication risk (a hallucinated "helpful" number in a refusal is the worst bug in the product, principle c) for marginal fluency gain on short, formulaic messages. This extends WP7's precedent (null-cell answers skip the LLM). The no-numbers guarantee becomes structural: the builders receive `QueryRefusal`/`ParseOutcome` objects that carry no cell values by construction, and tests belt-check every rendered text with the R1/R3 tokenizer against a whitelist derived from structured sources (period codes, sync dates, option labels).

**Alternatives considered:**
- *LLM phrasing with the WP7 validator*: rejected — the validator proves numbers match results, but refusals have no results; "no numbers at all except whitelisted period tokens" is cheaper to guarantee by never generating free text.
- *LLM phrasing with a no-digit validator*: rejected — still needs the fail-closed template anyway; the template alone already passes by construction, so the LLM step is pure cost/risk.

**Trade-off accepted:** refusal copy is formulaic and cannot mirror the user's wording (consistent with open-questions #41, which WP9 keeps: the user's question text stays out of every phrasing path).

## Decision 2 — The response envelope (`ComposedResponse`)

One versioned union — `answer | clarification | refusal` — is the pipeline's single output (`src/answer/respond/types.ts`). Structural, non-droppable fields per kind: answers carry the WP7 `ComposedAnswer`, the WP8 chart spec and an optional staleness warning; clarifications carry all unresolved axes, options and a serializable `PendingClarification`; refusals carry a user-facing **reason taxonomy** (the benchmark pass criterion "states the correct reason" is checked against this field, not by parsing prose), a structured offer/guidance, the freshness payload, and audit seams (full parse/query outcomes, internal diagnostic note). This is the seam WP10's audit record wraps.

`outside_loaded_slice` and `not_published` are distinct reasons with distinct wording (docs/05 requires the distinction); `table_quarantined` maps to `quarantined` with out-of-scope-equivalent behaviour.

## Decision 3 — One clarification round, merged reply, then refusal-with-guidance

- `parseClarificationReply` (`src/answer/intent/clarify.ts`) parses the user's free-text reply **merged with the pending partial intent**: the LLM receives a JSON payload (original question + the clarification we asked + options + reply) under a clarify-mode section **appended** to the WP6 system prompt (base prompt bytes untouched — the 45 intent fixtures stay valid). Same model tier, same schema, same deterministic resolution and R7 thresholds as WP6.
- The final-round rule lives in the respond layer, not the parser: if the merged parse would clarify again, the user gets a `still_ambiguous` refusal with guidance (what stayed unresolved + one concrete answerable example question) — never a second question, never pending state on a refusal. The parser stays honest and reusable; the one-round policy is enforced exactly once — **on both clarification shapes**: the parser-level one *and* the query layer's `needs_clarification` (the missing-region check deliberately lives in the query layer per WP6's pass-through policy, so `respondToIntent` takes a `finalRound` flag that converts it too; found as a HIGH by the adversarial review, 2026-07-03 — a reply could previously trigger a second, query-originated clarification).
- On the *first* turn, a query-level `needs_clarification` legitimately becomes the clarification (e.g. a question naming no place on the regional population measure); its region options are concrete and resolvable ("heel Nederland", plus the gemeente/provincie preset mirroring docs/02 S3's combined-preset example) per docs/05's options rule.
- Calibration mirrors ADR 012: a labelled reply set (`benchmark/clarification-cases.json`), a live eval/record script (`npm run clarify:eval` / `clarify:record`, off-gate), committed replay fixtures (`tests/fixtures/llm/clarify/`) for hermetic CI, and a committed calibration report.

**Alternative considered:** deterministic reply matching (option picking + region/period parsing without an LLM). Rejected: replies are arbitrary Dutch ("de gemeente", "het landelijke cijfer, voor 2024"); brittle matching would either guess (principle c violation) or refuse legitimate replies. Parsing is exactly the job ADR 004 assigns to the small-model tier.

## Decision 4 — Staleness policy (docs/05 row, both branches)

Cadence strings already live in the registry (`cbs_tables.update_cadence`). WP9 maps their prefixes to a maximum age (**Assumption**, mirrored in open-questions: monthly → 47 days, quarterly → 138, yearly → 549 — expected cadence × 1.5 margin, absorbing CBS's "no fixed publication times"; unknown cadence → no staleness claim). Stale means `referenceDate − syncedAt > maxAge`, clock-injected (the same injected reference date the parser uses; never the wall clock).

- Stale + covered historical period → **warn-and-serve** (owner decision, open-questions #18): a structural warning line appended to the answer text, attribution untouched.
- Stale + recency-implying question (WP6's `impliedRecency`) → **refusal** (`staleness` reason), guidance to ask for a specific covered period.

## Decision 5 — Refusals never ask

Refusal texts never end in a question and never create pending state (embedded example questions inside guidance are fine). Rationale: a trailing "Wil je dat cijfer?" would invite a bare "ja" reply for which no merge state exists — a conversational dead end pretending to be a flow. Clarifications remain the only envelope that asks (exactly one compact question) and the only one carrying pending state. Compound questions get the honest split without naming the first ask — naming it requires multi-ask decomposition, which is a Phase 1–2 roadmap item (docs/02).

## Notes for WP10 (audit records)

The envelope deliberately does **not** carry the user's clarification-*reply* text or the clarify/intent prompt-version constants — WP10 wraps `respondToQuestion`/`respondToClarificationReply` and must record, at the wrap site: the reply text and the `PendingClarification` it answered, plus `PROMPT_VERSION` (intent), `CLARIFY_PROMPT_VERSION` and `COMPOSE_PROMPT_VERSION` (all exported constants) per docs/05's audit-trail design ("model IDs and prompt versions used"). Judged with the adversarial review (2026-07-03): carrying these in every envelope would duplicate what the audit layer owns; the obligation is recorded here so it cannot be forgotten.

## Revisit triggers

- Chat UI session: conversational tone of refusals (and open-questions #41's sanitization design) may be revisited with real user feedback — the deterministic-template decision itself stands unless measured comprehension problems appear.
- Multi-ask decomposition (Phase 1–2): compound split gains "zal ik met X beginnen?".
- Owner tuning of the staleness constants or the always-clarify period policy (#40) — both single-constant changes.
- If clarify-reply calibration degrades on a model change: re-record + re-calibrate per ADR 012's procedure.
