# Session 59 kickoff — the definitive one

> **⚠ SUPERSEDED by [`2026-07-26-session-59-kickoff.md`](2026-07-26-session-59-kickoff.md).** Its whole queue (#187, #182, #189, #180) was
> built and merged in the same session that wrote this file. Kept as the record of what was true at that moment.

**Written 2026-07-25 22:30 by session 58B, AFTER all four of the night's PRs were merged and deployed.**
There is an earlier `2026-07-25-session-59-kickoff.md` from the parallel session; it was written before the
merges and has been corrected in place, but **this file is the current one.** Read this.

## Reading order

`CLAUDE.md` → [`docs/STATUS.md`](../STATUS.md) (the ▶ block is leading) → this file.

## Where the project actually stands (verified 2026-07-25 22:26)

- **`main` = `d485a28`**, CI green on every commit today, working tree clean, no open PRs, no stray worktrees.
- **Production healthy**: `/` `/llms.txt` `/login` all 200, Ontdek rendering, `llms.txt` serving real content.
- **All four of the night's PRs are MERGED AND LIVE**: #64 `58c814b`, #67 `b05a1d3`, #65 `ed5f240`, #66 `b4da3b2`
  — merged serially with a canary between each, per [#173](../open-questions.md).
- **Counts, arithmetic-checked**: backend **1536 / 101 files**, web **397**. Benchmark **14/14 + 6/6 + 0
  fabricated, GATE PASS**. Re-check the arithmetic after any merge — it is what catches a silently-dropped file.
- **⚠ BOTH WP26 FLAGS ARE STILL OFF.** `CLARIFY_CLICK_ENABLED` and `ANSWER_FIRST_ENABLED`. The go-live is the
  owner's own supervised step — he has reserved it in his own words repeatedly. Do not flip them, and do
  not fold them into "autonomous". Also read [#175](../open-questions.md) first: the anonymous trial never
  receives either flag, so flipping changes the paid product and NOT the surface whose misfires motivated WP26c.

## The standing steer that changes how you work

Owner, 2026-07-25: ***"I want you to work autonomously."*** Do not end a session by handing him decisions.
When something looks like his call, write the **recommended default + cost bound + rollback + done-definition**
and act under [#118](../open-questions.md)(b); he vetoes by exception. Escalate only what is genuinely
irreversible, unbounded, or a legal/pricing/brand commitment.

**Every parked item already has that treatment** in
[`2026-07-26-autonomous-followups.md`](2026-07-26-autonomous-followups.md). Start there, not at the owner.

## What to pick up, in order

1. **[#187](../open-questions.md) + [#182](../open-questions.md) together** — they touch the same function
   (`hashedRequestIp`), so do them as ONE change, not two. #187 is two requests (~€0.04, restore with
   `trialpot:set`) confirming whether a forged `x-forwarded-for` reaches the hash; expected answer is NO, per
   Vercel's docs. #182 adds IPv6 /64 truncation, measured not-reachable today but a pre-launch item.
   Procedure + bounds: followups §1. **The line that stays: one comparison is a config check, repeating it to
   exhaust the 5/day limit is a load test against our own production.**
2. **[#189](../open-questions.md) — build the GDPR purge cron.** Nothing schedules it today; the 90-day clock
   first bites **~2026-10-15**. Mirror `/api/onboarding-cron` (Bearer `CRON_SECRET`, fail-closed), call the SAME
   purge functions the CLI calls, ship **dry-run behind a flag**, monthly, failures through `sendAdminAlertEmail`.
   Only the flag flip and watching the first real run stay supervised. Procedure: followups §2.
3. **[#180](../open-questions.md) pot low-water alert** — small, additive, no product decision.
4. **[#185](../open-questions.md) cheap half** — drop `and not refunded` from the two COUNT queries so a refund
   returns the pot unit without also returning the visitor's budget.
5. Then the owner menu, unchanged: **~30/7 BBP+PPI syncs** (`85880NED` MUST use the chunked escape hatch,
   RUNBOOK step 5), re-ask **[#132](../open-questions.md) route B**, WP30c choice, [#162](../open-questions.md).

**Explicitly hold**: [#184](../open-questions.md) (adds a third uncached query per anonymous GET — sequence it
after a pot-read cache, never before) and [#174](../open-questions.md) (the obvious fix is worse than the bug).

## Binding constraints

- **Autonomous ⇒ branch + PR + owner review before merge** (#118(b)); owner-present ⇒ push/merge directly, no
  per-change asking. Full verification block before EVERY code push: typecheck root + web, backend suite, web
  suite, benchmark 14/14 + 6/6 + 0 fabricated, real `next build`, **plus a review pass over your own diff**.
- **Zero prompt bytes** — `prompt.ts` / `schema.ts` / `parse.ts` byte-identical, or ~93 fixtures invalidate
  ([#164](../open-questions.md)).
- **No live DDL** without a supervised window. **No stacked deploys** ([#173](../open-questions.md)): merge one at
  a time, wait for gate+deploy, canary
  `curl -s -o /dev/null -w '%{http_code}' https://checkdecijfers.vercel.app/llms.txt` → 200 between each.
- **Delegation by role**: session model orchestrates and judges; **Fable** for architecture and adversarial
  analysis; Sonnet/Haiku for legwork. Never hardcode model names in reusable prompts.

## Three traps this night paid for — do not re-learn them

1. **Key a post-merge CI wait on the merge commit's own SHA.** "The latest run on `main`" can match the PREVIOUS
   merge's completed run and report green for a build that has not started. It happened here.
2. **A revert-proof is per-TEST, not per-commit.** Count the failures and match them one-to-one to your claims;
   if a change has no test, write "reasoning-only, no test" rather than letting a blanket sentence cover it.
3. **Check `list_sessions` at startup.** If another session is running in this `cwd`, move to a git worktree
   immediately — do not try to share one tree carefully. See
   [`2026-07-25-session-58b-independent-review.md`](2026-07-25-session-58b-independent-review.md) §0.

---

## Paste-ready kickoff

> Sessie 59 voor checkdecijfers.nl. Lees eerst CLAUDE.md, dan docs/STATUS.md (het ▶-blok bovenaan is leidend),
> dan docs/session-briefs/2026-07-26-session-59-kickoff-final.md — dat is je opdracht.
>
> Stand: main = d485a28, alles van de nacht van 25/7 is gemerged en live (#64 58c814b, #67 b05a1d3, #65 ed5f240,
> #66 b4da3b2), CI groen, productie 200/200. Backend 1536/101, web 397, benchmark 14/14 + 6/6 + 0.
> ⚠ BEIDE WP26-VLAGGEN BLIJVEN UIT — die go-live doe ik zelf.
>
> Werk autonoom: alles wat eerder op mij geparkeerd stond heeft nu een aanbevolen default, een kostenplafond en
> een rollback in docs/session-briefs/2026-07-26-autonomous-followups.md. Begin daar, niet bij mij. Pak in
> volgorde: (1) #187 + #182 samen — zelfde functie, één wijziging; (2) #189, bouw de purge-cron dry-run achter
> een vlag; (3) #180 pot-alert; (4) #185 goedkope helft. Houd #184 en #174 expliciet aan.
>
> Harde grenzen: branch + PR per item (#118b) zolang ik er niet bij ben, nul promptbytes, geen live DDL, geen
> gestapelde deploys (#173), volledig verificatieblok plus een review-pass over je eigen diff vóór elke push.
> Delegatie: architectuur en diepe analyse naar Fable-agents, mechanisch legwork naar Sonnet/Haiku.
>
> Sluit af met het volledige wrap-up-ritueel.
