# Execute-ready follow-ups for an autonomous session

**Written 2026-07-25 (session 58B) on an explicit owner steer: *"you better document it for later because I want
you to work autonomously."*** Every item below was previously written down as "needs the owner". That framing was
partly right and partly my own over-caution. This file replaces each one with a **procedure, a cost bound, a
rollback, and a done-definition**, so a future autonomous session can execute it under the normal
[#118](../open-questions.md)(b) rules (branch + PR + owner review before merge) without a decision round first.

**The standing rule this establishes:** when something looks like an owner decision, do not stop at "recorded,
owner's call". Write the recommended default, the reasoning, the bound and the reversal — then a session can act
and the owner can veto by exception. Escalate only what genuinely cannot be undone, cannot be bounded, or is a
legal/pricing/brand commitment.

**Still deliberately NOT autonomous — one item.** The **WP26 flag flip** (`CLARIFY_CLICK_ENABLED`,
`ANSWER_FIRST_ENABLED`). The owner has reserved it in his own words three separate times. It stays his until he
says otherwise; if he does, the procedure is already written (RUNBOOK §"WP26 answer-first + clickable options",
one flag at a time, and note [#175](../open-questions.md): the trial never receives either flag).

---

## 1. [#187](../open-questions.md) — is the trial's IP bucket forgeable? ⏱ ~20 min · cost < €0.05

**What is actually unknown.** `hashedRequestIp` (`web/lib/trial.ts`) hashes `x-forwarded-for`'s FIRST entry. That
is right behind a proxy that OVERWRITES the header and wrong behind one that APPENDS — where the trustworthy
value is the LAST entry and `[0]` is whatever the sender typed. Today the safety argument is a code comment, not
a measurement.

**The documentary answer, already gathered and probably sufficient.** Vercel's own request-headers documentation
states it overwrites `X-Forwarded-For` and does not forward client-supplied values, specifically to prevent IP
spoofing; custom XFF handling is an Enterprise "trusted proxy" feature this project does not have. Production DNS
resolves to Vercel edge IPs. **So the expected result is NOT forgeable.** The measurement below confirms a fact
rather than discovering one — which is exactly why it is cheap and safe.

**I over-cautioned when I called this "probing abuse limits."** It is two ordinary requests. It exhausts nothing,
loops nothing, and costs two pot questions.

### Procedure

1. **Not during a deploy window** ([#173](../open-questions.md)). Canary first:
   `curl -s -o /dev/null -w '%{http_code}' https://checkdecijfers.vercel.app/llms.txt` → 200.
2. Note the pot level before (`select remaining_questions, cap from trial_pot_config`).
3. Send **exactly two** trial questions to production, each with a fresh cookie jar so they are distinct visitors:
   one **with** a forged header (`-H 'x-forwarded-for: 203.0.113.99'`), one **without**. Any short real question.
   Server Actions POST to the page path (`/`), not `/api/` — see the RUNBOOK's firewall note.
4. Read the two rows: `select id, ip_hash, created_at from trial_questions order by id desc limit 2`.
   - **Hashes identical** → Vercel overwrote the header. The current code is correct. Record it.
   - **Hashes differ** → the forged value reached the hash. The backstop bounds nothing against a scripted
     client. Fix: prefer `x-vercel-forwarded-for`, then `x-real-ip`, and fall back to the **last** XFF entry.
5. **Restore the pot**: `npm run trialpot:set -- <original level>`.
6. Record the measured result in the RUNBOOK **and** replace #187's answer column with it, so the next session
   inherits a fact instead of a comment. Add a test that pins whichever behaviour is real.

**Bound:** 2 pot questions, ~€0.04 on the capped trial key, 2 rows in `trial_questions` (swept at 90 days anyway).
**Rollback:** `trialpot:set`. Nothing else is written.
**Do NOT:** loop, script it, send more than the two requests, or try to exhaust the 5/day IP limit to observe it.
That is the line — one comparison is a config check, repetition is a load test against your own production.

---

## 2. [#189](../open-questions.md) — nothing schedules `gdpr:purge` ⏱ medium · recommended: build the cron

**Recommendation: build it, do not leave it manual.** The manual route has already failed for the entire life of
the feature — nobody ran it, and nobody noticed until an adversarial pass went looking. A maintenance-agenda line
is a promise of exactly the kind that just failed. The 90-day clock first bites **~2026-10-15** (go-live
2026-07-17 + 90). Two retention windows depend on one command nobody runs.

**Precedent to copy, not invent:** `/api/onboarding-cron` — a route handler authenticated by a `CRON_SECRET`
Bearer token, fail-closed (503 when the secret is unset, before any DB work), registered in `web/vercel.json`'s
`crons`. Read it first; mirror its shape exactly.

### Procedure

1. Branch + PR per #118(b). New route `web/app/api/gdpr-purge-cron/route.ts`, same auth shape as the onboarding
   cron, calling the SAME `purgeExpiredQuestionHistory` / `purgeExpiredTrialBookkeeping` the CLI calls — never a
   second copy of the retention logic (the ⟨F2⟩ discipline: one WHERE shape, one code path).
2. **Ship it dormant first**, this project's standing pattern: the route defaults to **dry-run** and only applies
   when an env flag (e.g. `GDPR_PURGE_APPLY=1`) is set. A cron that deletes on its first-ever run, unattended, on
   a money-path project, is not a change to make blind.
3. Register a **monthly** schedule in `web/vercel.json`. Monthly matches the retention windows (90 days / 2 years);
   daily buys nothing and multiplies the blast radius of a bug.
4. Report through the existing seam: log the counts, and use `sendAdminAlertEmail` (`src/answer/audit/alerts.ts`)
   on failure — the #144/#121 posture. A silent retention job is the bug this row is about, one level up.
5. Tests: the route is fail-closed without the secret; dry-run applies nothing; apply-mode calls the real purge.
   Note `scripts/` has no harness today, so the ROUTE is where the coverage goes.
6. **The supervised part is small and specific:** setting `GDPR_PURGE_APPLY=1` in Vercel, and watching the first
   real run's counts. Everything up to that is autonomous.

**Done:** the cron exists, runs monthly, is dry-run until the owner flips one env var, and #189 says so.

---

## 3. [#181](../open-questions.md) — anonymous trial content, 2 years vs 90 days · recommended: redact at 90 days

**This one has a genuine policy edge, but a safe default.** An anonymous visitor's question and answer are kept 2
years with **no self-service erasure route** (that path binds `user_id`; they have none), while their abuse
bookkeeping goes at 90 days. The 2-year window was decided for account holders, justified by dashboard history and
a legally-retained financial trail — **a trial turn has neither**. ADR 036 applies "retention without purpose"
reasoning to the bookkeeping and not to the content.

**Recommended default:** redact `source_tag = 'anonymous_trial'` rows at the same 90-day cutoff, as one extra
scoped leg reusing `redactMatchingRows` — buildable autonomously, ~30 lines plus tests. The redaction posture is
unchanged (skeleton survives, content goes), so nothing about the ledger or R8 reconstruction moves.

**The one thing that would change the answer, and the only reason to ask:** if the owner wants anonymous trial
questions retained as *product* data — what people actually ask before signing up is the most valuable corpus this
product has for #169-style work. That is a business call, not a legal one. **So: ask that specific question in one
line, not the whole retention question** — and if he doesn't answer, the privacy-preserving default is 90 days.

---

## 4. [#183](../open-questions.md) — trial input length · recommended: change nothing

Not a bug; the framing that made it look like one has been corrected in the row. `MAX_INPUT_LENGTH = 2000` is the
intended server belt behind a 500-char client cap on the **paid** path too, and `web/app/actions.ts` says so
outright. Server-cap-above-client-cap is defence-in-depth, not an oversight. Leave it unless the owner wants a
shorter anonymous question for cost reasons — a product preference with no security content.

---

## 5. The other tracked residuals, with their defaults

So a session is never blocked wondering which of these it may touch:

| Row | Recommended default for an autonomous session |
|---|---|
| [#180](../open-questions.md) pot has no low-water alert | **Build it.** Fire the existing `sendAdminAlertEmail` seam from `takeTrialQuestion` at a threshold. Small, additive, no product decision. |
| [#182](../open-questions.md) no IPv6 /64 truncation | **Build it when #187 is settled** (they touch the same function — do them in one change, not two). Measured not reachable today; fires the day the apex goes through an IPv6-capable front. |
| [#184](../open-questions.md) gate never checks the IP limit | ✅ **DONE 2026-07-26 (session 59)**, in exactly that sequence — and the "third query" objection turned out to be dischargeable: folding both limit counts into one round trip means a steady-state anonymous render costs ONE query, not three. ~~Hold. Sequence it AFTER a pot-read cache, never before.~~ |
| [#185](../open-questions.md) refund restores the abuse counters | ⚠ **SUPERSEDED — do NOT build this.** It was DECLINED with reasoning in session 58B (see the row and STATUS), and a reviewer asked to attack that decision agreed: the fix would charge infrastructure failures to visitors to close a hazard that is unreachable and already bounded by the trial key's hard spend cap. If it ever becomes reachable, the fix is a refund CAP per visitor, not removing the compensation. |
| [#186](../open-questions.md) anonymous per-GET DB cost | ✅ **DONE 2026-07-26 (session 59): measured first, then built at 20 s.** The measurement changed the design — the cost is the pooler SESSION a query forces open (one GET held a slot 174 s), not the 0.44 ms query. Full record in the row. |
| [#174](../open-questions.md) client-held `impliedRecency` | **Hold, and do not "fix" it.** The obvious fix is worse than the bug: it would make legitimate historical chips start refusing. Needs a decision about what the bit MEANS, not code. |
