# ADR 024 — Answer-first for structural defaults + clickable pre-verified clarification options (#72 + #66)

**Status:** accepted, 2026-07-05 (owner chose to build [#72](../open-questions.md) and [#66](../open-questions.md) together as one WP — WP26 — in session 23, and **read back + settled decision 3's safelist in the same session:** B-region kept as-is; **B-period upgraded from "freshest single value" to "the recent trend"** at the owner's choice; entity-collision cases (Utrecht) confirmed as **stay-a-clarification, now with clickable buttons**. Pricing stays deferred, decision 6 / [#101](../open-questions.md)). Nothing in this ADR is enforced until WP26 lands; the R7 amendments in decision 2 are written into [05-data-rules.md](../05-data-rules.md) **in the same change as the code**, not before. **➡ WP26 LANDED in session 56 (2026-07-25) — all four sub-parts built and pushed, CI green, DORMANT behind `CLARIFY_CLICK_ENABLED` / `ANSWER_FIRST_ENABLED`; the R7 third branch IS now written into 05-data-rules.md. What remains is the owner-supervised go-live. As-built notes are inline below, per decision/sub-part.**

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

  **➡ AS-BUILT (session 56, 2026-07-25).** The assumption was **MEASURED, not carried**: both registered geo tables really do have the `NL01` row — `03759ned` ("Nederland", 16 rows, newest 2026JJ00) and `83625NED` ("Nederland", 31 rows, newest 2025JJ00) — so B-region ships for *both*, not only for population as the execute-brief's fallback wording allowed for. Three as-built notes:
  1. **The existence check is per-measure and runs every time**, not a one-off registry fact: the seam probes for an actual `NL01` observation at this measure's coordinate before defaulting, and falls through to today's clarification when there is none. The ADR's revisit trigger ("a geo measure entering scope with no NL-level row") is therefore already mechanical, and pinned by a test that deletes the row and asserts the clarification comes back.
  2. **The default is region-only.** A defaulted region does not paper over an unpublished PERIOD — that keeps its own honest refusal, exactly as a named region would get. Pinned.
  3. **Deviation from the approved copy, flagged to the owner:** the safelist promised the correction as *"en een knop: 'Liever een gemeente of provincie? Noem de naam.'"*. The chip surface fills the input with the chip's own text and the user then sends it — so a chip reading *"Noem de naam"* would be sent as a question, not as a correction. Rather than invent a new interaction or pick example places for the user (which the safelist rejects), the correction ships as the disclosure's own second sentence: *"Noem een gemeente of provincie in je vraag als je een specifieke regio wilt."* Same information, same place on screen, one fewer broken button. A real chip would need either a fill-a-template interaction or suggested places — both out of WP26 scope.

  `regionDefaulted` travels on the ValidatedResult (present-only, `?? false` reads) and the disclosure is built by `buildAssumptionLine` in format.ts — the same single builder `audit/reconstruct.ts` re-runs, so the sentence the user saw re-derives byte-identically at audit time instead of being re-decided (R8). The result also records the RESOLVED intent (`regions:['NL01']`), so the audit row shows the query that actually ran. Rollout flag: `ANSWER_FIRST_ENABLED`, independent of `CLARIFY_CLICK_ENABLED` so each mechanism can go live and roll back on its own.
- **B-period — no period signal at all (`period_missing`/`none`) → the recent TREND, not a single value (owner decision, session 23).** Most bare questions already resolve to `latest` via present tense; only a genuine `none` reaches here. The owner chose — over the softer "freshest single value" — to default `none` to a **bounded recent trend**: a series over the last N periods up to the freshest, at the measure's natural grain, rendered as the existing line chart, disclosed (*"het verloop over de afgelopen jaren, t/m {laatste periode}"*) with a correction chip offering *"alleen het laatste cijfer"* and *"een andere periode"*. Owner rationale: a fact-checking audience is better served by the trend — which also contains the latest point — than by a lone number, and it reads as less of a guess than picking one period. **Window N is a build-time detail** (proposal: the last ~10 years, or the full loaded range if shorter, at the coarsest available grain — bounded, and **gap-free** via the existing `openEndedRangeOptions`/completeness discipline so a holey window is never served). Degrades to the single freshest value when the loaded series has only one period. Still **zero prompt bytes**: a deterministic resolve-layer choice of a range + `series` derivation, reusing the `since`/`last_n` machinery — and on the allowed side of the decision-2 line (the window is a disclosed, correctable assumption; the series is verbatim cells; direction prose stays derivation-bound per R9).

  **➡ AS-BUILT (session 56, 2026-07-25).** Built as specified — window `DEFAULT_TREND_YEARS = 10` at the coarsest published grain, `series` forced after resolution (the shape is only known then), `impliedRecency: true` (a window ending at the freshest period claims currency, so a stale table refuses rather than warn-and-serves), degrading to a single code when only one period survives. **One design change, and it is the load-bearing one:** the window is built by **walking backwards from the newest period while each step is actually present**, NOT by computing a 10-year span and relying on the completeness check to reject a holey one. The brief's phrasing ("a holey window refuses, satisfying the gap-free requirement structurally") would have been honest but *hostile*: a default the user never asked for would have turned an answerable question into a refusal because of an interior hole in OUR data. Walking makes the window gap-free by construction — a hole simply shortens it, and every code in the span is a real loaded period. Pinned by a test that punches a hole and asserts the window shortens (and still serves) rather than refusing.

  `periodDefaulted` is stamped onto the ValidatedResult by the ANSWER layer (`respondToIntent`), because the period axis is resolved before the query runs and the query layer cannot know — the one place holding both halves. Disclosure: *"Dit is het verloop over de afgelopen jaren, t/m {laatste periode}. Vraag gerust naar alleen het laatste cijfer of naar een andere periode."* — the end is read from the SERVED cells, never from a computed "today", so the sentence can only describe data actually in the answer. Same `ANSWER_FIRST_ENABLED` flag as B-region. **Correction paths ship as prose here too**, for the reason recorded under B-region's as-built.

**Explicitly NOT defaulted (stay clarifications, now with clickable options) — owner-confirmed, session 23:** `region_ambiguous` (Utrecht gemeente vs provincie — two different real numbers; a disclosed pick still shows a wrong-entity value; the owner explicitly chose the safe path here: keep asking, but as one-click buttons), rule-3 below-`answerThreshold` single reading (the model doubts itself — the strongest (c) case for asking), rule-4 two materially-different readings, `unknown_canonical_key`, and every out-of-slice / composite-region case where no in-data default exists.

### 4. Mechanism A — options carry a pre-verified intent; a click bypasses the LLM re-parse

Each clarification option gains, alongside its display string, a **resolvable intent** — either a full `StructuredIntent` (the rule-4 readings and the #56 echo suggestion already ARE resolved candidates: trivially attachable) or an axis-patch (`{axis, value}`) applied to the pending partial intent (the region presets). An option is attached **only if its intent passes the `echoServability` dry-run** — the same "concrete, actually available options" bar R7's failure table already sets; unservable options are simply not offered as chips.

The UI renders attached options as **clickable chips** (`chat.tsx`). *(⚠ The entry-point sentence below is the ORIGINAL A1 decision and was SUPERSEDED at build time — see the as-built note at the end of this decision.)* Clicking calls a **new backend entry point** `resolveClarificationOption(pendingId, optionId)` that reads the audited pending clarification, takes the option's already-resolved intent, and runs the deterministic query → answer **with no LLM call at all**. Free-text reply stays the fallback for when the user types something not on the chip list (still through today's `replyToClarification` merge). This *reduces* the R2 / prompt-injection surface (a clicked resolution never feeds free text back through the model) rather than widening it.

**Assumption (verify at build):** the audit record's clarification pending-state (R8, ADR [015](015-refusal-clarification-composition.md)/[016](016-audit-records.md)) can hold the per-option resolved intents — either in the existing pending-intent jsonb or via one additive column. If a column is needed, that is a **live migration → WP26 is a supervised (non-overnight) build**; noted in the WP brief. **➡ Resolved by the 2026-07-18 design-marathon code survey ([execute-brief](../session-briefs/2026-07-19-wp26-execute-brief.md)): `audit_answers.pending_clarification` is jsonb (migration 004) — the enriched options ride the existing column, NO live DDL needed.** The execute-brief also refines this decision's option payload (full resolved intents only, no axis-patches) and puts a take-path variant (A2: deterministic option-label match inside `replyToClarification`, no new entry point) next to this decision's A1 for owner read-back — either way this ADR gets its as-built amendment in the build change.

**➡ AS-BUILT (session 56, 2026-07-25 — owner read back and chose A2 in-chat; safelist re-read and approved unchanged).** What shipped differs from this decision's text in four measured ways:

1. **Take-path A2, not A1.** There is **no** `resolveClarificationOption` entry point. `respondToClarificationReply` gained a deterministic FIRST RUNG: a reply whose trimmed text is byte-equal to an offered `ClickOption.label` takes that option's stored intent and runs the normal query → validate → answer path with **zero LLM calls** (proven by a test in which both clients throw). Everything else falls through to today's merge, unchanged. Chosen because it satisfies the "no new paid entry point" constraint and the #75 fill-don't-send convention verbatim, and because it *also* rescues TYPED replies that happen to equal an offered option — the measured "Beiden"-class dead-end. Cost of the choice: the enriched pending is client-held on the reply turn, so it comes back through a full schema check ([validate-pending.ts](../../src/answer/respond/validate-pending.ts), the `context/validate.ts` pattern) that drops forgeries fail-closed.
2. **Option payload as refined, plus one field the brief missed:** `{id, label, intent, impliedRecency}`. `impliedRecency` is CARRIED, not re-derived — the period spec that implied recency is gone once resolution turns it into codes, and without it a clicked take would be quietly *less* conservative than the typed path under the docs/05 staleness rule (warn-and-serve where the typed path refuses).
3. **Where options are born:** policy rules 3 and 4, plus the `region_ambiguous` resolver branch (the Utrecht case this ADR's alternative 3 deliberately keeps as a clarification — now with working chips, exactly as decision 3's safelist entry 3 promises). Each candidate is dry-run through the real query layer before it is offered; an unservable one silently stays plain text.
4. **Rendering:** no new UI surface. The labels ride the existing kind-agnostic `suggestions` chip field that WP29 (#73) and #134(a) already established, so clarifications reuse the same render and the same fill-don't-send handler.

**Composition of a taken option** is the ADR-013 template rung (`templateOnly` on `composeAnswer`) — valid by construction, injection-free, provider-outage-proof; the honest trade is that a clicked answer reads plainer. **Rollout:** `CLARIFY_CLICK_ENABLED` (dormant by default, #53/#144 pattern); flag-off turns build no options, run no dry-runs and serialize **no extra envelope keys** (present-only fields, pinned by tests).

### 5. Verification: extend B15/B16, add frozen-key default-and-answer cases; keep the anti-fabrication pins

New benchmark tasks with frozen keys: (i) a geo measure asked with no region → national answer carrying the disclosure line and the correction chip; (ii) a clicked rule-4 option → the picked reading's answer, reconstructible from the audit row **without** a second LLM call; (iii) a `none`-period question → the recent-trend default (a bounded gap-free series + line chart, the disclosure line, and the "alleen het laatste cijfer"/"andere periode" correction chips), degrading to a single value when only one period is loaded. B15/B16 (R7 regression) are **extended, not replaced** — they must still prove that the *non*-safelisted classes (region_ambiguous, below-threshold single reading) continue to clarify, and that no default path ever emits a numeric token not bound to a result cell (R1/R3/R9). The audit-reconstruction check (R8) must re-verify a clicked-option answer from the row alone, and the new `assumptionLine` must re-derive byte-identically like the attribution line does.

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

## As-built addendum — WP26c (session 56, 2026-07-25)

The sub-part the execute-brief (§6) proposed and the owner put in scope: a misfired refusal may carry ONE
deterministic rescue chip. Built as designed, with three notes.

1. **The refusal is untouched.** Neither the classification nor the refusal TEXT changes — you cannot pin an
   unstable parse (the s54 bistability lesson), so nothing here tries to. The chip sits beside an honest refusal.
2. **The brief's "period ≤ freshest" gate was folded into the dry-run.** An unpublished period simply fails
   `echoServability`, which is the same source of truth every other chip in the product is gated on. One check
   instead of two that could drift apart.
3. **Taking the chip must not re-enter the parse that misfired** — which meant the rescue needs mechanism A's
   take-path, and therefore a pending. A refusal that carries a pending is new, so two rules keep it honest:
   the pending is marked `rescueOnly`, and **anything the user types that is not the chip is answered as a FRESH
   question** — enforced client-side (the ordinary question path, so on-demand onboarding and the table finder
   still apply — a review finding) and belted server-side. A rescue pending also does not change the input
   placeholder: nothing was asked, so the box must not look like it is waiting for an answer.

Flag: rides `CLARIFY_CLICK_ENABLED` (it is mechanism A's machinery). Period detection is deliberately narrow —
month+year and bare year only, and it bails when a question names more than one distinct period, because a
missing rescue is a cosmetic loss while a wrong one is a product bug.

---

## As-built addendum — the trust boundary, hardened (session 57, 2026-07-25, PR #62 squash `29e9e8b`)

An adversarial review of the client-held state (four independent lenses: money path, forgery/injection,
deploy skew, byte neutrality) confirmed the design's central safety claim and closed four gaps around it.

**Confirmed sound:** a forged `ClickOption` cannot make the product serve a number it would otherwise
refuse. The take path re-runs the real query layer — schema version, canonical key, table registration,
**quarantine**, every dimension code against the table's own labels, and the existence of every requested
cell — and the offer-time dry-run verdict is discarded by construction. `target.kind: 'explicit'` is refused
at the schema. The blast radius of a perfect forgery is "the same power as typing a different question".

**Four gaps closed:**

1. **`rescueOnly` is granted on the pending's SHAPE, not the client's word.** Three of the four lenses found
   this independently: the branch fired on `rescueOnly === true` alone, so with both flags off any client
   could post that byte and reach a WP26c path that did not exist before WP26 — which is what "dormant
   behind two flags" is supposed to make impossible. The gate is deliberately NOT the feature flag: a flag
   check would break the case that matters, a rescue pending legitimately minted minutes before a rollback
   and still sitting in an open tab. The shape check (one measure axis, one chip, one option, labels
   matching) closes the forgery *and* keeps the rollback graceful.
2. **A chip's label must be an entry of the pending's `options[]`.** All three offer sites build both lists
   from the same strings, so binding them cannot drop a legitimate chip.
3. **`guardPending` bounds `axes` entries and validates `referenceDate`'s shape** (`YYYY-MM-DD`, the same
   form `parseReferenceDate` accepts). A well-formed lie silently moved what "vorige maand" means.
4. **The validated pending is rebuilt from an allowlist**, not spread from the client's object — invented
   keys were being persisted verbatim into `audit_answers.pending_clarification`.

⚠ **The review over the hardening itself caught a regression in it before merge:** the first allowlist
omitted `conversationContext` (WP15 / ADR 021), and the new test had pinned the truncated key set as
correct. An allowlist is exactly as good as its completeness; the full key set is now pinned.

**Deliberately not fixed, recorded as [#174-#178](../open-questions.md):** the client-held `impliedRecency`
bit (the obvious fix over-refuses legitimate historical chips — it needs a decision about what the bit
means), the trial path never receiving either flag (#175, a product decision), flags-off extra DB queries
(#176), the `llm_calls` role label on the rescue path (#177), and pending TTL/binding/version (#178).

**As-built, 2026-07-26 (session 60) — [#176](../open-questions.md) is now FIXED.** Mechanism A's per-option
intents are built by `resolveCandidate`, but read only by `clarificationFromFailure` behind
`clickOptionsEnabled` — so with the flag off the resolver was spending a `resolvePeriod` query per
region-ambiguous question and discarding the result. `resolveCandidate` now takes `clickOptionsEnabled` in
its existing options bag and gates the `regionOptionIntents` call on it; `parse.ts` and `followup.ts` pass
the same flag they already pass to `decide()`. `clarify.ts` passes nothing **on purpose**: a reply turn is
the final round and never asks again, so those intents were dead work there in every flag state.
Measured on a named ambiguity ("Utrecht"): **3 statements flag-off, 4 flag-on**.

Two things this surfaced that belong in the ADR record. First, `regionOptionIntents` resolves its period
**without** `answerFirstEnabled` and without region codes (`resolve.ts:933`), unlike the main path — so a
period-less ambiguous question builds no chips even with both flags on. That looks deliberate (per-option
trend windows would each need their own servability check) but was written down nowhere; it is also the
main reason the alternative design (moving the construction into `policy.ts`'s gated branch) is riskier
than it sounds — any reimplementation must reproduce it exactly or silently change flag-ON behaviour.
Second, the byte-neutrality review that ORIGINALLY found #176 was right about the defect and the test that
was supposed to pin it was not: the "region ambiguous" case in `tests/answer/query-count.test.ts` passed
`regions: null`, which never enters the failure branch at all. The pin and the defect had drifted apart
without either being wrong on its own terms.

**As-built, 2026-08-07 (session 61) — [#191](../open-questions.md) is now FIXED, and it corrects a claim
made two paragraphs above.** The #176 note says `clarify.ts` passes nothing to `resolveCandidate` **on
purpose**. That remains true and correct for `clickOptionsEnabled`. It was NOT true, and not deliberate, for
`answerFirstEnabled`: `ClarifyReplyOptions` declared that field and `clarify.ts` faithfully threaded it into
both consumers (the dry-runs at lines 194 and 210), but `respondToClarificationReply` never SET it —
so the value was always `undefined`.

The consequence was not "reply turns run pre-WP26". It was that a reply turn ran **HALF of mechanism B**, a
state nobody designed. B's two axes live in different layers: **B-region** is applied in the QUERY layer
(`src/query/resolve.ts:393`) and already reached reply turns through the `{ ...options }` spread into
`respondToIntent` (`respond.ts:652`), while **B-period** is applied in the INTENT layer
(`src/answer/intent/resolve.ts:731`) and is fed by exactly the bag that was missing the flag. So with
`ANSWER_FIRST_ENABLED=1`, a reply turn **silently defaulted the region the user never mentioned and then
refused over the period it was allowed to default.**

Measured on the hermetic fixture DB, flag ON — pre-fix: first turn `answer`, reply turn
`refusal (still_ambiguous)` on the same intent; post-fix: both `answer`.

**Why the reply turn SHOULD default, which is the decision this note records.** It reads as a product fork
("is the user's reply exactly the moment not to guess?") and is not one. **R7's third branch authorises
filling in a structurally-determined axis under four conditions and draws no first-turn/reply-turn
distinction**, and the safelist is code, not configuration — so applying it to one axis and not the other
was an invariant conformance gap. The supporting argument is that a reply is the LAST round by rule (a reply
never asks again), which makes it the turn where refusing costs most: the user answered the exact question
we asked and would be refused on an axis nobody asked about, after paying the clarification price — the
precise paid dead-end this ADR's Context section exists to remove. Condition (c) holds unchanged: the
disclosure re-derives through the same `buildAssumptionLine` on both turns, verified live and now pinned.

Pinned by `tests/answer/answer-first-reply-turn.test.ts`. Its load-bearing case asserts the two turns
**agree** rather than asserting a verdict — a "the reply now answers" pin would still pass if a later change
made the FIRST turn refuse too — and it guards against a vacuous pass by first asserting neither turn took
the `internal` error exit. **Also corrected in the same change:** the RUNBOOK's blast-radius cell said this
flag affects "First turns", which was measurably wrong, since B-region always reached replies.

**RUNBOOK correction in the same PR:** the documented rollback order was wrong. Rolling `ANSWER_FIRST_ENABLED`
back while `CLARIFY_CLICK_ENABLED` is on strands region-less chips as guaranteed refusals, and "both
together" is not a safe shortcut. The correct order is **A off, wait, then B**.

**As-built, 2026-08-26 (session 63) — [#178](../open-questions.md) is now partly FIXED: mechanism A's
click-take path could silently serve a stale figure for a "nu"/"vorige maand"-style option.**
`ClickOption.impliedRecency` is carried from offer time and never re-derived — its own doc comment already
says as much — but that field only ever fed the docs/05 staleness rule (`checkStaleness`, TABLE sync age).
Nothing re-checked whether the option's own STORED period was still the freshest available: a chip minted
weeks earlier for "nu" replayed its baked-in period codes verbatim even after newer data had synced in,
with no staleness marker — the take-path equivalent of the #191 gap this ADR already amended once, a
narrow conformance hole rather than a new decision. Fixed by `clickOptionStillCurrent`
(`src/answer/respond/respond.ts`), which re-derives the current freshest period (at the option's own grain
and region — a first pass caught both `freshestForCanonical` comparing across grains and defaulting to the
national region regardless of the option's own) before the deterministic rung is allowed to fire; a stale
click now falls through to the normal LLM merge instead, exactly like a non-matching reply. Two residuals
confirmed real and deliberately not solved in the same change (documented in
[open-questions #178](../open-questions.md), not silently dropped): a `relative`-derived option
("3 maanden geleden") is *also* `impliedRecency: true` for an unrelated reason (the table might not have
published that calendar point yet, not "wants the latest"), so it will always miss the fast path too — safe
(same fallback as any reply) but a needless cost regression for that one `PeriodSpec` shape, unfixable
without `ClickOption` also recording which spec produced a resolution; and the pending's general lack of a
TTL (the other two findings in the same #178 row — silent staleness beyond this specific case, and GDPR-text
resurrection on a stale reply tab) stays exactly as open as it already was — the age-bound this ADR's own
take-path design never included is still the owner's call on priority, not something this fix expanded or
narrowed.

---

## As-built addendum — chip-carrier pendings on ANSWERS (#197 step 3, session 70, 2026-09-02)

The WP26c rescue pending turned out to be a general mechanism: a `rescueOnly` pending is a **chip carrier** —
not an open clarification round, only the state that lets a byte-equal reply be taken through mechanism A's
deterministic rung. #197 step 3 (ADR [029](029-follow-up-suggestion-chips.md) as-built) mints the same shape
under an ANSWER for its comparison chips ("Vergelijk met Nederland", "Vergelijk met <de G4>", "Vergelijk met
<a year earlier>"), on a new present-only `AnswerResponse.pending`. Three notes:

1. **`isRescuePending` was widened, not bypassed.** The shape check now accepts 1..`MAX_CLICK_OPTIONS` chips
   whose labels are pairwise byte-equal to `options[]` on ≥ 1 declared axis (it was: exactly one chip on one
   `measure` axis). The forgery closure of the session-57 hardening rests on the label binding and the
   re-validation of every intent (`validate-pending.ts`), not on the axis literal — a bare `{rescueOnly: true}`
   still never reaches the fresh-question branch (pinned). The rollback property is unchanged: a carrier
   minted before `CLARIFY_CLICK_ENABLED` goes off keeps routing — its chip label is then parsed as a fresh
   question, the documented post-rollback behaviour of the rescue chip (pinned).
2. **The comparison intents never depend on mechanism B.** Every carried intent names its regions and periods
   explicitly (the answered ones plus the comparison target), so the RUNBOOK's rollback-order warning — chips
   whose intent relied on the B-region default — does not apply to them; `impliedRecency` is `false` because a
   comparison names explicit, already-answered periods (the rescue chip's reasoning).
3. **Thread resume drops carrier-bound labels** (`src/threads/replay.ts`), for the rescue chip and the
   comparison chips alike: a resumed thread restores no pending (ADR 033 ⟨A6⟩), so replaying such a label as a
   plain chip would send it through a parse it was never written for. Question-shaped chips replay as before.

4. **The audited `question` of a taken comparison is the ORIGINAL question**, with the chip label as
   `reply_text` — the existing reply-row convention (a clarification take records the same pair), so R8's
   `response.question === record.question` holds, thread replay shows the label as the user turn, and the
   dashboard history lists the row under the original question. Debatable for a comparison (the row's result
   is Amsterdam + Nederland while its title reads "Hoeveel inwoners had Amsterdam"); kept for consistency and
   pinned in the take test. "History title = `reply_text` on reply rows" is a possible UI follow-up (#197).
5. **Two fallback routes send the short label through a fresh parse**, both bounded and both the rescue
   chip's existing property: (a) after a flag ROLLBACK a carrier still open in a tab routes its label as a
   fresh question (pinned — `respondToQuestion` receives the label; it may refuse or clarify, one ordinary
   charge); (b) during a DEPLOY WINDOW an old client bundle never reads `answer.pending`, so its filled label
   goes through `askQuestion` — until the tab reloads. Full-question labels would make both parse, at the
   cost of the brief's copy; left as the owner's call. Stated in the RUNBOOK's rollback text.
6. **Only takeable intents are minted** (`isClickTakeableIntent`, validate-pending.ts — the click-time
   schema's own `safeParse`): an on-demand-onboarded `onboarded:…` key is outside `CANONICAL_KEYS` by
   design, so a chip for it would have been stripped at click time and the label would have fallen into the
   paid LLM merge. Found by the parallel session's review before the push; pinned.

Same flag, same dormancy pattern, no new entry point, no prompt bytes, no schema change: the carrier rides the
client-held pending and, on the reply row, the existing `audit_answers.pending_clarification` jsonb.

## As-built addendum — BOTH flags LIVE and measured (session 71, 2026-09-03)

- **Mechanism A (`CLARIFY_CLICK_ENABLED`)**: flipped 2026-09-02 (session 69); the owner's first real click
  landed 2026-09-03 — audit row 261 (clarification "Bedoel je Utrecht (PV) of Utrecht (gemeente)?" with two
  `clickOptions`) → row 262 (the take: `parse.model = deterministic/wp26-click-option`, `llm_calls = []`,
  0 tokens, `answer_source = template`, 20 credits, R8 reconstruct clean). The #197 comparison chip on an
  answer took the same path (rows 263 → 264, two `result_ids`, a 2-series bar chart). One RUNBOOK correction:
  the smoke test needs a real question (`Hoeveel inwoners had Utrecht in 2024?`); a one-word "Utrecht" is a
  smalltalk refusal, not a clarification.
- **Mechanism B (`ANSWER_FIRST_ENABLED`)**: flipped 2026-09-03 05:40Z on the owner's explicit yes, deployed by
  `27c79cb` (run 33719897606) together with the [#175](../open-questions.md) fix that passes the flag to the
  anonymous trial (`trial-actions.ts`; the click flag stays out of the trial by decision, ADR 036 D5).
  **B-region proven** — row 269, a fresh thread, "Hoeveel inwoners waren er in 2024?": `regionDefaulted = true`,
  NL01 → 17.942.942, the disclosure line directly under the body, and the G4 comparison chip on top.
  **B-period fires but is gated by the parser's confidence** — row 266, "Hoeveel inwoners telde Amsterdam?": no
  period question any more, but the single reading scored 0.85 (< `answerThreshold` 0.9) with the note "zonder
  specifieke periode genoemd", so R7 rule 3 produced a one-chip confirmation; the click (row 267) delivered the
  2019–2026 trend without an LLM. This is the decision above working as written ("a below-threshold single
  reading still clarifies") meeting a parser that books a missing period as mild doubt. Recorded as
  [#198](../open-questions.md); a prompt-side fix was tried in three wordings and reverted the same day (each
  lowered the onboarded bijstand delivery parse below 0.9); a code-side threshold for that one shape is proposed;
  the owner parked the decision ("later"). Same-thread caveat measured too (row 268): a follow-up inherits the
  previous region from context by design — test B-region in a NEW chat.
- **Rollback order unchanged**: A off first, B a day later, never the reverse (RUNBOOK).
