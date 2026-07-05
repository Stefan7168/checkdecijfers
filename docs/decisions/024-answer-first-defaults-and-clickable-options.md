# ADR 024 — Answer-first for structural defaults + clickable pre-verified clarification options (#72 + #66)

**Status:** proposed, 2026-07-05 (owner chose to build [#72](../open-questions.md) and [#66](../open-questions.md) together as one WP — WP26 — in session 23; the **safelist** in decision 3 and the **deferred pricing** in decision 6 are put to the owner in the same session — accept on read-back). Nothing in this ADR is enforced until WP26 lands; the R7 amendments in decision 2 are written into [05-data-rules.md](../05-data-rules.md) **in the same change as the code**, not before.

## Context

First real usage (sessions 18–22) produced one recurring, owner-flagged failure shape the docs call the **paid dead-end**: a question triggers a clarification, the user replies, and the reply still dead-ends in `still_ambiguous` — with money already spent. The cost is exact and now evidence-backed (read from [gate.ts](../../src/billing/gate.ts), not assumed): a clarification round nets **10 credits** charged (a real answer is 20, a refusal is 0, ADR [020](020-credit-ledger-and-billing-gate.md) decision 2 / [#58](../open-questions.md)); a failed reply refunds to 0 but does **not** refund the original 10 — so a clarify-then-dead-end is *"net 10 for nothing"* (the owner's own phrasing on [#77](../open-questions.md) and [#97](../open-questions.md)).

Code reading (`policy.ts` `decide()`, `resolve.ts` `resolveCandidate`) shows **two independent root causes**, and [#72](../open-questions.md) (owner-decided "yes, build") plus its sibling [#66](../open-questions.md) map one-to-one onto them:

1. **We stop to ask when a canonical structural default exists.** A geo measure (e.g. population) asked with **no region named** returns `codes:[]` and is refused by the query layer ("missing region on a geo table") — instead of just serving the national total and saying so. The period axis already does the honest version of this (present tense → freshest published period, stated in the answer per R4); the region axis does not.
2. **When we do ask, free-text replies fail to re-bind.** The clarification's options are display text; the user retypes ("Beiden", "Jan modaal inkomen 2024", or the identical explicit-date phrasing), and `replyToClarification()`'s **second LLM re-parse** fails to merge it — a fragile step with its own failure surface, independent of whether the offered option was itself servable. `echoServability` (WP15/[#56](../open-questions.md), [dry-run.ts](../../src/query/dry-run.ts)) already **proves an offered option answerable before it is shown** — but nothing lets the user *take* that pre-verified option without going back through the free-text LLM re-parse.

This ADR fixes both with the codebase's existing seams and precedents; it invents no new trust mechanism. The load-bearing precedent is the **canonical-default policy already sanctioned by R7's second sentence and shipped in [compose.ts](../../src/answer/compose/compose.ts)** (`Definitie: {definitionLabel}.`, assembled by deterministic code outside LLM reach): a default is allowed when it is *transparent*, never a hidden guess. #72 asks to extend that same discipline from registry-internal variant choice to a **narrow, named set of user-facing axes**; #66 asks to make the clarifications that legitimately remain terminate on a pre-verified click.

## Decisions

### 1. Two mechanisms, one work package; neither changes the LLM prompt or schema

WP26 ships **Mechanism A** (clickable, pre-verified clarification options — #66) and **Mechanism B** (answer-first for structural defaults — #72) together. Both are **deterministic-policy-and-plumbing** changes over data the pipeline already produces (`resolve.ts`'s resolved region codes / period, `decide()`'s ranked candidates, the `echoServability` dry-run). Neither touches `buildSystemPrompt()` (`prompt.ts`), the raw-parse JSON schema (`schema.ts`), or the LLM request in `parse.ts` — so, like the #64 merge, this is **zero prompt bytes: no fixture re-recording, no live-LLM spend** for the pipeline change itself. (Cost that *does* apply: new frozen-key benchmark cases, decision 5.)

### 2. The principle-(c) line, stated as a checkable rule

R7 already draws the line **not** at "did we pick without asking" but at *what kind of choice the pick is*: a registry-curated, always-labelled canonical reading is transparent (allowed); a confidence-scored guess among candidates the parser is unsure about is not (must clarify). WP26 extends that line by **exactly one narrow branch**, governed by a rule the R1/answer-schema validator can enforce:

> **A default may be answered (instead of clarified) only when the fallback value is a *canonical, structurally-determined reading* — the national aggregate, or the freshest published period — AND all three of:**
> **(a)** it is **servability-checked** before use (dry-run through the real query layer, the #56 primitive — never offer or take a default that would dead-end);
> **(b)** its **assumption is disclosed in-sentence by deterministic code** (an `assumptionLine` built exactly like `definitionLine`, structurally present in the answer schema, non-optional, outside anything the LLM can reword or drop — so R1's token scan and the answer-schema validator enforce its presence like R4 attribution);
> **(c)** it is paired with a **working correction path** — a clickable option (Mechanism A) whose intent is itself pre-verified, so accepting the correction cannot dead-end.
>
> **A default is forbidden — the axis still clarifies — when the choice is a confidence-scored pick among competing entity or definition readings** (region_ambiguous, rule-3 below-threshold single reading, rule-4 two materially-different readings, unmatched measure). Those are exactly R7's existing "never a best guess" cases and stay that way.

R7's row in [05-data-rules.md](../05-data-rules.md) and the "Ambiguous intent" / "Still ambiguous after one round" rows of its failure-behaviour table gain this third branch **when the code lands**, with B15/B16 extended (decision 5) as the regression pin.

### 3. Mechanism B safelist — which user-facing axes default (the #72 judgment, owner-blessable per entry)

Deliberately narrow v1, each entry a *structurally-determined* reading, not a heuristic. Every entry off this list keeps clarifying.

- **B-region — no region named on a measure that has a national figure → the national total, disclosed.** `resolveRegions` returning `codes:[]` on a **geo** table currently dead-ends at the query layer's missing-region refusal. New: if the table is geo **and** no region term was given **and** an NL-level row exists at the canonical coordinate, resolve to that NL code and set `regionDefaulted:true`; the answer carries *"Dit is het landelijke cijfer voor heel Nederland."* plus a correction chip *"Liever een gemeente of provincie? Noem de naam."* The NL aggregate is a specific known row, not a pick among competing places — the clean side of the decision-2 line. **Assumption (verify at build via the dry-run, not asserted here):** every in-scope geo measure has an NL-level row at its canonical coordinate; a measure that does not falls back to clarify, never to a fabricated national figure.
- **B-period — no period expressible at all (`period_missing`/`none`) → the freshest published period, disclosed.** The softer, second-tier entry: most bare questions already resolve to `latest` via present tense; only a genuine `none` reaches here. Defaulting `none` to the freshest period (with *"Dit is het meest recente cijfer, over {periode}."* and a range-correction chip) mirrors the already-sanctioned `latest` path. **Included but explicitly the entry the owner is most invited to drop or defer**, since a bare `none` can also signal trend intent; if kept, its benchmark case must show the correction chip offers a *servable* range (the `openEndedRangeOptions` gap-free builder already exists).

**Explicitly NOT defaulted (stay clarifications, now with clickable options):** `region_ambiguous` (Utrecht gemeente vs provincie — two different real numbers; a disclosed pick still shows a wrong-entity value), rule-3 below-`answerThreshold` single reading (the model doubts itself — the strongest (c) case for asking), rule-4 two materially-different readings, `unknown_canonical_key`, and every out-of-slice / composite-region case where no in-data default exists.

### 4. Mechanism A — options carry a pre-verified intent; a click bypasses the LLM re-parse

Each clarification option gains, alongside its display string, a **resolvable intent** — either a full `StructuredIntent` (the rule-4 readings and the #56 echo suggestion already ARE resolved candidates: trivially attachable) or an axis-patch (`{axis, value}`) applied to the pending partial intent (the region presets). An option is attached **only if its intent passes the `echoServability` dry-run** — the same "concrete, actually available options" bar R7's failure table already sets; unservable options are simply not offered as chips.

The UI renders attached options as **clickable chips** (`chat.tsx`). Clicking calls a **new backend entry point** `resolveClarificationOption(pendingId, optionId)` that reads the audited pending clarification, takes the option's already-resolved intent, and runs the deterministic query → answer **with no LLM call at all**. Free-text reply stays the fallback for when the user types something not on the chip list (still through today's `replyToClarification` merge). This *reduces* the R2 / prompt-injection surface (a clicked resolution never feeds free text back through the model) rather than widening it.

**Assumption (verify at build):** the audit record's clarification pending-state (R8, ADR [015](015-refusal-clarification-composition.md)/[016](016-audit-records.md)) can hold the per-option resolved intents — either in the existing pending-intent jsonb or via one additive column. If a column is needed, that is a **live migration → WP26 is a supervised (non-overnight) build**; noted in the WP brief.

### 5. Verification: extend B15/B16, add frozen-key default-and-answer cases; keep the anti-fabrication pins

New benchmark tasks with frozen keys: (i) a geo measure asked with no region → national answer carrying the disclosure line and the correction chip; (ii) a clicked rule-4 option → the picked reading's answer, reconstructible from the audit row **without** a second LLM call; (iii) the `none`-period default if decision-3 B-period survives owner read-back. B15/B16 (R7 regression) are **extended, not replaced** — they must still prove that the *non*-safelisted classes (region_ambiguous, below-threshold single reading) continue to clarify, and that no default path ever emits a numeric token not bound to a result cell (R1/R3/R9). The audit-reconstruction check (R8) must re-verify a clicked-option answer from the row alone, and the new `assumptionLine` must re-derive byte-identically like the attribution line does.

### 6. Pricing is deferred (owner decision, session 23): WP26 changes no cent-logic

WP26 ships **no ledger or pricing change**. A defaulted answer returns `kind:'answer'` and therefore flows through `gate.ts` at the normal `simple` price; a clicked resolution likewise resolves to a normal answer. Net user-facing effect is already a win without any pricing move: an ambiguous-region question that today costs *clarify 10 + answer 20 = 30 over two rounds* (or 10-for-nothing when it dead-ends) becomes **one 20-credit answer**. Two optional sweeteners are recorded as open questions for the owner to decide anytime before launch, each an independent config/ledger change: **(i)** discount a *defaulted* answer below the full `simple` price (the user did not get exactly what they asked); **(ii)** price a *clicked, LLM-free* resolution cheaper than a typed reply (~5, the #66 proposal) — must respect the ledger's `clarification ≤ simple` CHECK constraint.

## Alternatives considered

1. **Fix only Mechanism A (clickable options), leave defaults alone.** Rejected as insufficient: it makes clarifications terminate but still charges 10 for a round we needn't have run at all when a structural default exists — it treats the symptom (dead-end) not root cause 1 (asking unnecessarily). A helps *every* remaining clarification; B removes a class of them entirely. They are complementary, which is why the owner chose to build both.
2. **Fix only Mechanism B (defaults), leave the free-text reply path.** Rejected: B only covers axes with a canonical default; the named live dead-ends ("Beiden", "Jan modaal inkomen 2024") are *reply-merge* failures on genuinely-ambiguous questions B never touches. Without A they persist.
3. **Widen the safelist to region_ambiguous with a "most common reading" default (gemeente over provincie).** Rejected for v1: gemeente-over-provincie is a *heuristic*, not a structural reading — it fails the decision-2 line (a disclosed pick still puts a specific wrong-entity number on screen). Kept as a clarification with clickable chips instead. **Revisit trigger:** measured evidence that entity-collision clarifications are a frequent real dead-end AND a labelled-set calibration shows one reading dominant.
4. **Let the LLM decide when to default (prompt it to answer-or-clarify).** Rejected — it moves the (c)-line judgment into the model, the exact opposite of principle (a); the whole point is that *code*, on registry/DB facts, decides what is a structural default, and the model stays purely linguistic. Also would force a prompt/fixture re-record (decision 1's zero-spend property lost).
5. **Charge a defaulted answer the clarification price (10), not the answer price (20).** Deferred, not decided (decision 6) — the owner chose "decide later"; shipping at the normal answer price is the no-new-mechanism default and is already cheaper end-to-end than today's two-round path.

## Revisit triggers

- Entity-collision (region_ambiguous) clarifications showing up as frequent real dead-ends → alternative 3.
- A geo measure entering scope with **no** NL-level row → B-region must fall back to clarify for it; pin a no-default case.
- Owner deciding either pricing sweetener (decision 6) → a follow-up ledger/config change, not a re-open of this ADR.
- Free-text follow-ups (not clicks) continuing to dead-end after A ships → the residual conversation-memory scope (ADR [021](021-conversation-memory-structured-context.md) limitations; a click is a structured follow-up, free text is still the harder open problem).
- Monthly maintenance: confirm B15/B16 still pin the non-safelisted classes as clarifying.
