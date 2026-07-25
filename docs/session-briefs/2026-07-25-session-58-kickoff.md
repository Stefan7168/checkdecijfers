# Kickoff — session 58 (the session after the autonomous overnight run)

**Written by session 57 on 2026-07-25 (autonomous, owner asleep).** The chat is gone; this file and the
repo are the source. Reading order: `CLAUDE.md` → [`docs/STATUS.md`](../STATUS.md) (the ▶ block at the top
is leading) → this file.

---

## 0. Everything from session 57 is MERGED AND LIVE — nothing is waiting

Session 57 ran autonomously and produced four PRs; the owner then came into the chat and they were all
merged and deployed the same day. **There is nothing left to review.**

| PR | Squash | What |
|---|---|---|
| [#60](https://github.com/Stefan7168/checkdecijfers/pull/60) | `e334590` | #173(c): pg pool `max` 4 → 2 per process |
| [#61](https://github.com/Stefan7168/checkdecijfers/pull/61) | `ea71c96` | Fixture DB ingested once per run, not once per suite |
| [#62](https://github.com/Stefan7168/checkdecijfers/pull/62) | `29e9e8b` | WP26 trust-boundary hardening + the corrected RUNBOOK rollback order |
| [#63](https://github.com/Stefan7168/checkdecijfers/pull/63) | `447fca9` | Doc consistency, the architecture memo, the close-out |

Merged **one at a time**, with the gate+deploy completing and a production check between each — deliberately,
because four stacked deploys is what caused the #173 degradation. #60 went first on purpose: a smaller pool
per instance buys headroom for the deploys behind it. CI green on every run; production verified after each
(`/llms.txt` 200, `/` 200, Ontdek rendering).

**⚠ The WP26 flags were NOT flipped.** The owner reserved that go-live for himself, twice, and "push live"
was not read as overriding it. Section 1 below is what he needs before he does.

**▶ The next session is another AUTONOMOUS overnight run** — its queue is
[`2026-07-26-overnight-queue-2.md`](2026-07-26-overnight-queue-2.md). Read that instead of improvising: the
conformance bundle, an honest A/B of the fixture-snapshot saving, #177, and a Fable adversarial pass on the
anonymous-trial surface.

## 1. ⚠ Before you flip the WP26 flags — two things changed tonight

**(a) The rollback order in the RUNBOOK was wrong.** The correct order is:

> turn `CLARIFY_CLICK_ENABLED` **off first** → leave `ANSWER_FIRST_ENABLED` on for about a day → then turn
> `ANSWER_FIRST_ENABLED` off.

Why: a chip offered for a question that named no place carries an intent with **no region in it**. It was
proven servable by the B-region national default, and that default is applied at *query* time under the flag
as it stands *at the moment of the click*. Roll B back while A is on and every such chip still sitting in an
open tab becomes a guaranteed refusal. And "both together", which an earlier version of the correction
recommended, is **not** a safe shortcut — it produces the same refusal plus a wasted LLM call. Fixed in PR #62.

**(b) The anonymous trial never receives either flag** ([#175](../open-questions.md)). `web/app/trial-actions.ts`
passes neither, so flipping them changes the paid product and not the trial — the surface whose two measured
misfires motivated WP26c in the first place. Two consequences: a logged-out smoke test proves nothing about
the flip, and a period-less trial question still burns one of the visitor's two free questions on a
clarification they structurally cannot reply to. **This is a product decision and the session did not make
it.** The clear half is `answerFirstEnabled` (it needs no reply endpoint); the open half is whether the trial
should show chips a visitor cannot take without spending question #2.

---

## 2. The architecture review, and what it recommends

Five Fable agents, one per question from the overnight brief's §3, plus a synthesiser. Memo:
[`2026-07-25-wp26-architecture-review-memo.md`](2026-07-25-wp26-architecture-review-memo.md). Not an ADR —
the decisions are the owner's.

**Verdict:** the architecture is in good shape. Every reviewer went looking for a principle-(a) violation or
a fabrication path and none found one; every defect found fails closed. **The cross-cutting problem is that
this project pins every rule about a NUMBER with machinery (validator, R8 reconstruction, benchmark gate)
and every rule about the SYSTEM with prose** — which constant is canonical, what grammar the envelope
speaks, which surfaces a flag reaches, what an answer costs in queries. Under one WP at a time culture held;
under four in a week it slipped exactly where prose was doing the work.

Its ordered list, condensed: (1) fix the RUNBOOK — done in PR #62; (2) decide the trial-flag question;
(3) a small **conformance bundle** — a test for the double-default path (no region AND no period, which
nothing exercises today), a single-sourced `NATIONAL_REGION_CODE` (it is declared three ways), an
envelope-key manifest test, and a query-count pin; (4) pool timeout + refund backstop; (5) a trial-gate TTL
cache before the #53 trial go-live; (6) write the envelope's presence grammar down.

It is also explicit about what **not** to do: don't move B-period into `query/`, don't fold the defaulted
booleans into a modelled concept yet, don't build an R8 rule registry, don't split the two flags into three.
Those "don'ts" are as load-bearing as the "dos" — each blocks a tempting refactor with a measured price.

---

## 3. Recorded but not fixed: [#174–#178](../open-questions.md)

Read **#174** if you read only one. A client-held `impliedRecency` bit can turn a stale-table refusal into a
served figure — and the obvious fix is *worse than the bug*, because re-deriving it would make legitimate
chips for explicitly-named historical periods start refusing where they correctly warn-and-serve today. It
needs a decision about what the bit means, not a patch.

The others: **#175** trial flags (above), **#176** flags-off extra DB queries on region-ambiguous questions
(matters because of #173), **#177** an `llm_calls` role mislabel on the rescue path, **#178** pending
TTL / user binding / version enforcement.

---

## 4. Standing constraints that have not changed

- **Git workflow:** owner-present sessions push and merge directly ([#118](../open-questions.md) revision,
  2026-07-17). **Autonomous sessions use branch + PR + owner review** — that is why tonight produced four PRs
  and merged none.
- **Verification block before every code push**, plus a `/code-review`-equivalent pass over the diff. Green CI
  is the gate. Docs-only pushes have no code diff and are exempt from the review pass.
- **#173:** the Supabase free tier caps session-mode pooling at 15 connections for the whole project. Do not
  stack deploys; do not run `--env-file=.env` scripts from the laptop during a deploy window. `curl` on
  `/llms.txt` returning 200 is the cheapest canary.
- **Delegation:** the session model orchestrates, scopes and judges; architecture and hard adversarial analysis
  go to Fable agents; mechanical legwork to Sonnet/Haiku. Express tiers by ROLE, never hardcode model names in
  reusable prompts.
- **Live DDL, real LLM spend and env-flag flips stay owner-supervised.**
- **Not without the owner:** WP30c choice, #132 GO, #172 co-calibration, #104/#112, the #151 backfill, pricing
  options #101, and the WP26 go-live itself.

## 5. Tracked but not the focus

~30/7 BBP+PPI syncs (`85880NED` **must** use the chunked escape hatch, RUNBOOK step 5); #132 route B (re-ask —
`forks_count` measured 0 on 2026-07-24, so the T-0 condition still holds); #170 smalls 3+4; WP30c; #162
slot-filling — **item 5 of the overnight queue, deliberately not started**, since it was scoped as
"only if time remains" and verifying the review findings was worth more.
