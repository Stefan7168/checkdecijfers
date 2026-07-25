# Closing synthesis — the WP26 architecture review, five lenses reconciled

*The numbers are pinned by machinery; the architecture is still held together by memory. One habit change closes most of the gap.*

> **What this is.** The closing deliverable of the autonomous overnight session of 2026-07-25 (session 57),
> commissioned by the owner: Fable agents were to check the architecture of the recent work packages, one
> agent per question from §3 of the overnight brief, plus one to synthesise. This memo is that synthesis.
> **It is deliberately NOT an ADR** — an ADR is a decision, and decisions are the owner's.
>
> Scope: WP26 (mechanism A, B-region, B-period, WP26c) plus #154, #121, #138, #172 step-0, #170.
> Method: five independent agents, one lens each, each told that a review which only agrees is not a review,
> each judging the as-built code rather than the docs written about it.
>
> The session model's own commentary — including where it disagrees — is in the section at the very bottom,
> kept separate so Fable's judgement is not silently edited.

## Verdict

After four work packages landed in quick succession, this architecture is in good shape — genuinely, not politely. The seam that carries the product's honesty (LLM parses, deterministic code computes, R8 replays) came through WP26 clean: all five reviewers went looking for a violation of principle (a) or a fabrication path and none found one, and every defect they did find fails *closed* — a refusal, a hang, a stale doc — never a wrong number. The problems that remain are real but cheap, they cluster around one nameable cause, and three of them must be fixed **before the flag flip**, because the flip is the next supervised action and one of the written instructions for it is currently backwards.

## What is genuinely good, and worth protecting

Four properties are load-bearing. First, the **failure posture**: every surface degrades honestly, and #173 proved it live rather than in theory (Q5, verified). Second, the **restraint under pressure**: in the same week ten optional fields landed, #154 was *folded into* `attribution.syncedAt` instead of becoming an eleventh, and `assumptionLine` was built as a cached rendering that re-derives byte-identically — evidence the envelope grows by decision, not reflex (Q2, verified). Third, **R8's implicit rule is actually coherent**: across roughly a dozen reconstruction checks, no item sits on the wrong side of re-derive vs. record-and-check (Q3). Fourth, the **#121 call**: known-failing rows still fail, with a triage label — a marker, not an exemption. Do not trade any of these away for tidiness.

## The cross-cutting pattern: one problem wearing four faces

Q1 found a double-default branch no test exercises and a constant declared three times. Q2 found the envelope's presence grammar living only in field-level comments — and the `suggestions` convention forked precisely because of that. Q3 found that R8's categorization rule exists only in comments and ADR addenda, so a sixth item added in the wrong category passes CI silently. Q4 found an inverted RUNBOOK rollback rule and a flag that never reaches the trial path. Q5 found per-request DB cost growing silently for four straight WPs because nothing pins query counts.

That is not four problems. It is **one**: this project pins every rule about a *number* with machinery — validator, byte-identical reconstruction, benchmark gate, CI — but pins rules about the *system itself* with prose and recollection. Which constant is canonical, what grammar the envelope speaks, which surfaces a flag reaches, what an answer costs in queries: all culture, no structure. Under one WP at a time, culture held. Under four in quick succession, it slipped exactly where the memos found it — and nowhere the machinery reaches, which is the strongest evidence for the diagnosis.

The single change that addresses most of it: adopt the rule **"a convention ships with its pin"**, and pay down the existing backlog with one small conformance bundle — the double-default test plus a single-sourced `NATIONAL_REGION_CODE` (Q1), the envelope-key manifest test (Q3), and the counting-`Db` query-count pin (#176, Q5). Three tests and one manifest, no envelope change, no stored-row risk. Had a "flags reach every user surface" assertion existed, Q4's trial-path omission would have been caught too.

## The disagreement, adjudicated: `connectionTimeoutMillis`

Q5 wants a pool acquisition timeout because exhaustion currently means **hanging**, and every fail-safe in this product triggers on errors, never on hangs. PR #60 deliberately left it unset because a bounded wait could throw between a committed credit debit and its compensating refund — the refund's own connection acquisition times out and the debit stands.

Both risks are real. **The hang is larger**, for a reason PR #60's reasoning doesn't survive: under true exhaustion, the unset timeout does not protect the refund — the request hangs until Vercel kills the function, and a killed function runs no refund either. So the no-timeout world loses the refund *with certainty* under exhaustion, while adding retry-storm amplification (hanging submits breed fresh requestIds) and invisibility — a hang is the one failure mode this product's honesty machinery cannot see or refund. The timeout world loses the refund only in the narrower case where the compensation itself fails fast with no backstop. PR #60's unset timeout only wins during *brief* contention that resolves within the wait — and per Q5, PR #60 itself makes in-process queuing more likely.

**The narrower fix gets both:** set a generous acquisition timeout (seconds, comfortably under Vercel's kill), and give the compensating refund specifically a backstop — a short retry, or a journaled pending-refund a sweep completes. Errors become fast, loggable, and refundable; the debit-strand window PR #60 feared is closed by the backstop rather than by hoping waits stay short. Whether to accept a handful of fast-fail errors on the money path under contention is a product-risk preference, and PR #60 is in review with the opposite choice already made — **this one is the owner's call.** My recommendation is clearly yes: land both parts with PR #60.

## The ordered list

1. **Fix the RUNBOOK flip/rollback section.** The safe rollback is A off first, grace period, then B — "both off together" reproduces the refusal *plus* a wasted LLM call, and B-region rollback strands minted chips while B-period never does. Add: logged-out smoke tests prove nothing (trial ignores both flags), and smoke with the two measured misfire questions. Price: docs-only, under an hour. **When: before the flag flip** — an inverted instruction in a supervised go-live is the most dangerous artifact this review found.
2. **Wire the flags into the trial path — or record not doing so as a decision.** Verified: `trial-actions.ts` reads neither flag, and (inferred from its omission-list comment) by oversight, not choice. As stands, the flip changes nothing for the surface whose misfires motivated WP26c, and a period-less trial question still burns a free question on a clarification the visitor cannot answer. Price: pass two flags through plus tests, small. **When: the decision before the flip; the wiring before the trial go-live.**
3. **The conformance bundle** (double-default test, single-sourced NL01, envelope-key manifest, query-count pin — see above). Price: one short session, zero envelope change. **When: before the flip** — the first two pin the exact branch the flip activates.
4. **Pool timeout + refund backstop**, per the adjudication. Price: one line plus a small backstop plus the verification block; owner accepts fast-fail-under-contention. **When: with PR #60.**
5. **Trial-gate TTL cache (5–10 s) and confirm whether the trial Anthropic key shares the org rate limit.** Q5's most plausible next #173: two uncached queries per anonymous request plus one global advisory lock against a 15-connection ceiling. Price: refill re-opens seconds late. **When: before the trial go-live (#53).**
6. **Write the presence grammar down** — present-only vs. required-nullable, and that `suggestions` differs by kind deliberately. Price: ~30 minutes, docs. **When: next build session.**
7. **Decide the mass-divergence policy** for the known-divergences register (inferred but structural: one-entry-per-row cannot absorb a wording change that legitimately diverges every historical row). Price: a decision plus an open-questions tripwire now. **When: before any change to attribution wording or source-registry labels — not now.**
8. **The split-pooler move** (transaction pooling for chat/pages; session pooler only for ingestion — the advisory-lock objection is overstated since all three sites use `pg_advisory_xact_lock`). This retires #173 rather than managing it. Price: a second env var, a route-scoped pool, a careful verification pass. **When: at the trigger — connection pressure recurring, or real trial traffic.**

## What should NOT be done

Preserve these verdicts; each blocks a tempting refactor. **Don't move B-period into `query/`** — an `INTENT_SCHEMA_VERSION` bump breaks every stored pending and audit intent, ~10 files and a 282-line suite reworked, for zero user-visible gain on dormant code; the asymmetry is principled (each default lives at the last point its triggering fact is observable). **Don't fold the booleans into `disclosedDefaults` now** — negative expected value while the safelist is owner-capped at two; the tipping point is written down (a third axis, or a cross-field consistency need), and if it fires, do it *before* rows carry these keys. **Don't build an R8 rule registry** — ~350 lines that risk tripping verbatim-pinned divergence strings; the manifest test buys the missing guarantee at a fraction of the price. **Don't split the two flags into three**, and **don't build a shared cache for deploy bursts**. And two named non-scares: `getBalance`'s full-ledger SUM and the onboarding queue drain are fine — don't let a future session rediscover them as alarms.

The short version: the honesty machinery held under the fastest build cadence this project has had. Give the *architecture* the same kind of pins the *answers* already have, fix the one backwards instruction before anyone follows it, and flip the flags.

---

## Session-model commentary (Opus 5, the orchestrator — where I agree and where I don't)

Kept separate on purpose: the owner asked for Fable's judgement, not for my edit of it.

**Where I acted on this already, tonight:**

- **Recommendation 1 is DONE** and is in PR #62. I had actually written the rollback correction *wrongly*
  first — my version said "roll A back first, **or both together**" — and Q4 caught that "both together"
  is not safe. The RUNBOOK now states the A-first-wait-then-B rule plainly, and explicitly marks the
  "both together" shortcut as wrong. This is the single most valuable thing the review produced.
- **Recommendation 2's finding is recorded as [#175](../open-questions.md)** with the product decision
  left open, which is where I think it belongs — whether the trial shows chips it cannot afford to let
  you take is a product call, not a bug fix.
- **#176 (Q5's/byte-neutrality's flags-off extra queries) and #177/#178 are recorded** rather than fixed,
  each with the reasoning for deferring.

**Where I disagree, or would qualify:**

- **On recommendation 4, I was wrong and Fable is right — but I still did not change the code, and I
  think that is correct.** My reasoning in PR #60 was that a bounded wait could throw between a committed
  debit and its refund. Q5's counter is decisive: under *true* exhaustion the unbounded wait does not
  save the refund either, because Vercel kills the function and a killed function refunds nothing. So my
  argument only covered brief contention, which is the case that matters least. I have left the code as
  shipped because changing money-path failure semantics autonomously, overnight, on a live system, is
  exactly the class of change the owner reserved for supervised windows — but the PR should be read with
  this counter-argument in hand, and I would now recommend landing the timeout **together with** a refund
  backstop, not alone.
- **On recommendation 3 I would reorder slightly.** Of the conformance bundle, the double-default test is
  the one with real urgency: it pins the exact branch the flag flip activates, and Q1 verified no test
  exercises it today. The envelope-key manifest and the query-count pin are genuinely valuable but are
  hygiene, not go-live gates. If only one thing gets done before the flip, do the double-default test.
- **On the cross-cutting diagnosis I think Fable is right and slightly understates it.** "Conventions
  pinned by culture, not structure" also explains a defect found in *my own work tonight*: the allowlist
  in PR #62 silently dropped `conversationContext`, and my own new test pinned the truncated key set as
  correct. A reviewer caught it only by *running* the function. That is the same failure mode, one level
  down — which makes me more confident in the diagnosis, not less.
- **One thing I would not describe as "good shape" without a caveat:** the review was of dormant code.
  Every WP26 judgement here is about behaviour no real user has exercised yet. The flip is still the
  moment of truth, and the honest summary is "the architecture is sound and the go-live instructions were
  not" rather than "it is proven".
