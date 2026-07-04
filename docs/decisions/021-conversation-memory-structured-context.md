# ADR 021 — Conversation memory as structured context + clarification-suggestion servability (WP15)

**Status:** accepted (Stefan approved the WP and its fixed design constraint 2026-07-05; this ADR firms the brief up against the code — session 16, 2026-07-04)
**Builds on:** ADR [012](012-intent-parsing-llm-harness.md) (intent harness), ADR [015](015-refusal-clarification-composition.md) (one-round clarify + merge), ADR [016](016-audit-records.md) (stored intent IS the query plan)
**Resolves:** open-questions [#57](../open-questions.md) (conversation memory) and [#56](../open-questions.md) (suggestion resolvability)

## Context

The owner's 38-question validation pass measured conversation memory as the single biggest usability gap: 7 of 38 questions were follow-up-shaped ("En hoe zit dat voor jongeren?", "En alleen in de Randstad?") and all dead-ended, because every question parses independently — only the one-round clarification carries state (ADR 015). Separately, low-confidence "echo" clarifications (R7 rule 3) were measured offering suggestions that cannot actually be served (V22/V23: "alle gemeenten … vanaf 1970" when the loaded slice starts at 2019), a soft violation of docs/05's "concrete, *actually available* options" letter.

**The fixed design constraint (owner-approved with the WP, non-negotiable):** conversational context is **structured only** — the previous turn's resolved intent (which IS the stored query plan, ADR 016) offered to the parser as a merge candidate, generalizing the proven WP9 clarify-reply merge. **Never raw chat history into any prompt** — that would reopen the R2/prompt-injection surface deliberately closed in WP7 (open-questions #41). All numbers still come from the deterministic query layer; the anti-fabrication invariants must be untouched by construction.

## Decision 1 — `ConversationContext`: registry vocabulary only, built server-side, carried by the client

A new serializable `ConversationContext` mirrors `PendingClarification`'s proven turn-state pattern (client-held React state, passed back on the next submit):

- `topicKey` — a `canonical_measures` registry key.
- `regions` — canonical region **names + kinds** (mapped from the resolved intent's CBS codes via the registry), or null.
- `period` — a **concrete** `PeriodSpec` shape (`year` / `quarter` / `month` / `year_range`) mapped back from the resolved period codes, or null when the resolved shape cannot round-trip (see limitation 2).
- `derivation` — the derivation hint.

Built **only** by deterministic backend code (`src/answer/context/`) from the returned `ComposedResponse`: answers → `result.intent`, query-refusals → `queryRefusal.intent` (a freshness refusal's intent is a real referent — "en in mei?" after one is a useful follow-up). Clarifications and parse-level refusals (scope/forecast/causal/smalltalk) produce no context; the client keeps the most recent non-null context, so a smalltalk detour doesn't erase the referent. The pending-clarification reply flow is unchanged and never receives a context (one merge candidate per parse, never two).

**Trust boundary (same class as `PendingClarification`, but strictly tighter):** the context is client-held and could be forged, exactly like `pending` today — accepted for the same reason (it feeds only the parse role; everything downstream is deterministic resolution + query validation, so a forged context can at worst ask a question the user could have typed). Unlike `pending` (which round-trips free text), the context is **validated server-side before any use**: zod shape check, `topicKey` must exist in the registry, region names must match registry labels, enums must parse. Any failure drops the context entirely (fail closed to a standalone parse) — no client-controlled free text ever enters the prompt through it.

## Decision 2 — Follow-up parse mode: a new appended prompt section, WP9's exact pattern

A new `FOLLOWUP_MODE_SECTION` (own file `src/answer/intent/followup.ts`, `FOLLOWUP_PROMPT_VERSION = 1`) is **appended** to `buildSystemPrompt()`'s output, exactly as `clarify.ts` appends its mode section — `prompt.ts` bytes untouched. Verified consequence (fixture mechanics confirmed against `requestHash`): **all 54 intent fixtures and all 7 clarify fixtures stay byte-identical**; only the new mode records new fixtures.

The user-turn payload is deterministic JSON: `{"previous_intent": {…the ConversationContext fields…}, "question": <the new question, verbatim>}`. The new question is the only free text — the same surface a first-turn parse already has. The previous turn's question text, reply text, and model-phrased readings are deliberately **excluded** (they are chat history; the structured fields carry the referent).

Mode rules (the load-bearing ones): previous_intent is the referent for continuations ("en …", "dit", "daar"); inherit only axes the new question leaves unstated; never override an axis the question states; a self-contained question parses as if fresh; a series/chart request over a single-period referent leaves the period **unresolved** (`none`) — never invent a range. Confidence keeps its normal meaning; the R7 thresholds apply unchanged and are re-checked by calibration (Decision 5).

Resolution uses the **current turn's** referenceDate (a follow-up is a fresh question; only the clarify-reply flow pins the original clock). `finalRound` is NOT set: a follow-up may trigger a normal clarification round — the one-round cap applies per question, as ADR 015 defined it.

## Decision 3 — Envelope and audit: `ComposedResponse` untouched; context is a wrap-site input

`ComposedResponse` / `RESPONSE_SCHEMA_VERSION` do not change (no reconstruction migration, no version bump). The context handed to the client is **derived** from the envelope after the fact; the context **offered** on a follow-up turn is recorded on the audit row as an input — a new nullable `conversation_context` jsonb column (migration 009), mirroring how reply rows record `reply_text` + `pending_clarification` (ADR 016's wrap-site obligations). `prompt_versions` gains the followup constant on every row. The web action returns `{ gated, context }`; `GatedResponse` itself is unchanged.

## Decision 4 — #56: echo suggestions dry-run their servability; unservable ones name what IS available

R7 rule 3 (the echo clarification) fires only when the top reading **resolved** — a full `StructuredIntent` exists at that point. Before offering "Bedoel je {reading}?", the intent is dry-run through a new confined query-layer primitive:

- `dryRunServability(db, intent)` runs the real `runQuery` and returns **only** `{servable: true}` or `{servable: false, kind, axis, freshness?}` — the return type carries no cells and no values by construction, so the no-numbers guarantee of clarification builders stays structural (the R1/R3 belt tests scan the fallback templates too). Running the real query is deliberate: it is the exact check "would confirming this produce an answer," with zero drift risk against a parallel approximation. Cost is acceptable — the path fires only on low-confidence echoes.
- Servable → the echo is offered as today.
- Unservable → a deterministic fallback clarification **names what IS available** instead (restoring the docs/05 letter): for period-axis failures, the measure's actually-loaded range/freshest period (reusing the WP14 `openEndedRangeOptions` interior-gap discipline and `freshestForCanonical`); other kinds get an honest "that exact reading isn't servable" clarification naming the loaded alternative. No number ever appears; no corrected reading is silently auto-answered (principle c — we ask, never guess).

`decide()` gains a **required** servability callback (kept pure of db imports; both call sites pass the real dry-run). Scope note: rule 4's two-option clarifications and `buildUnmatchedClarification` options (already registry-sourced) are NOT dry-run in this WP — the owner decision named the echo path; extending to rule 4 is filed as a follow-up open question rather than silently widened scope.

## Decision 5 — Evaluation: new labelled set + calibration, existing sets untouched

A new `benchmark/followup-cases.json` + `scripts/followup-eval.ts` (the clarify-eval pattern: record/replay/live, report with append-only history). Cases: the validation pass's follow-ups verbatim (V29, V30, V31 as merge cases; V35–V38 pinned as unchanged honest refusals — meta-questions about the previous answer are the F3/#29 template work, not memory), plus everyday shapes: region switch, period switch, topic switch, explicit multi-axis override, fully self-contained question with context present (**no-regression pin: must parse identically to standalone**), abandonment, and a national-only-measure follow-up (region must not be silently inherited into a `region_on_national_measure` dead end — calibration measures what the model does). CI replays all of it hermetically; live calibration runs supervised with per-run owner confirmation (ADR 012 procedure, R7 thresholds re-checked).

## Alternatives considered

1. **Deterministic post-parse merge (no prompt change at all):** parse the follow-up standalone, fill unresolved axes from context in code. Rejected: the raw-parse schema cannot express a measure-less fragment ("En in Rotterdam?" produces no candidate to merge into — `candidates` require a `canonicalKey`), so the fragment cases that matter most never reach the merge; fixing that means a schema change, which invalidates *all* fixtures — strictly worse than the appended-section design on both capability and cost.
2. **Injecting the previous intent as a synthetic ranked candidate into `decide()`:** bypasses the LLM entirely. Rejected: the R7 thresholds were calibrated on model-emitted confidences; a code-injected candidate has no honest confidence value, and relevance ("is this even a follow-up?") is precisely a language judgment — the one job the parse LLM legitimately owns (principle a).
3. **Raw chat history in the prompt** (what most chat products do): rejected outright — reopens the R2/injection surface #41 closed; explicitly forbidden by the approved design constraint.
4. **For #56, approximating servability with `resolveIntent` only (no query):** cheaper but wrong — resolution succeeding says nothing about the cells existing (that check lives in `runQuery`'s completeness pass); V22/V23 would still slip through. Rejected for a correctness gap in the exact case that motivated the decision.

## Known limitations (v1, deliberate)

1. **Explicit-target intents produce no context** (only canonical targets round-trip into registry vocabulary). Rare by construction; the follow-up then parses standalone.
2. **Quarter/month ranges don't round-trip** into a concrete `PeriodSpec` (`year_range` is the only concrete range shape) — the context omits its period axis; an axis-inheriting follow-up then gets a period clarification. Honest degradation, filed as a revisit trigger.
3. **Dimension-breakdown follow-ups** (V29 "voor jongeren" — an age split) are not expressible in the intent vocabulary at all; memory supplies the referent, and the outcome is an honest clarification/refusal, not an answer. Vocabulary growth is Phase 2 (demand-driven onboarding, WP16).
4. **Reading-fidelity (V21 "per dag")** is NOT covered by the dry-run: a suggestion can be servable while its phrasing implies a grain the intent doesn't carry. The answer's transparent definition/period statement (R7) bounds the damage; noted in open-questions, not solved here.

## Revisit triggers

- Users measurably chain follow-ups deeper than one referent (context currently carries exactly one intent, never a stack).
- Quarter/month-range follow-ups show up in real usage (limitation 2).
- Rule-4 two-option clarifications measured offering unservable readings (the #56 follow-up question).
- A second merge-candidate source appears (e.g. pinned/saved charts feeding context) — at that point extract a shared merge-mode abstraction instead of a third hand-rolled prompt section.
