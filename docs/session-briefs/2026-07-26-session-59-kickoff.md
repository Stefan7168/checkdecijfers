# Session 59 kickoff

**Written 2026-07-26 01:40, refreshed 03:43 at the close of session 58B.** Supersedes both earlier session-59 kickoffs
(`2026-07-25-session-59-kickoff.md` and `2026-07-26-session-59-kickoff-final.md`) — their queues are now DONE.

## Reading order

`CLAUDE.md` → [`docs/STATUS.md`](../STATUS.md) (the ▶ block leads) → this file.

## State, verified 2026-07-26 03:43

- **Last CODE commit on `main` = `d4ade6d`** (PR #71, the review-findings fixes). CI green on every commit, tree
  clean, no open PRs, no stray worktrees or branches.
- **Production healthy**: `/`, `/llms.txt`, `/login` all 200, Ontdek rendering.
- **Backend 1545 / 102 files · web 425 / 41 files · benchmark 14/14 + 6/6 + 0 fabricated GATE PASS.**
- **Eight PRs merged in this session**, each deployed on its own with a canary between (serial per
  [#173](../open-questions.md)): #64 `58c814b`, #67 `b05a1d3`, #65 `ed5f240`, #66 `b4da3b2`, #68 `fbffe48`,
  #69 `33a051d`, #70 `e88cfea`, #71 `d4ade6d`.
- **#180, #182, #187 and #189 are DONE** (see the STATUS table). A max-effort review of that work then fixed 14 of
  its own 15 findings in #71 — so the trial surface has just been reworked twice; read `web/lib/trial.ts` and
  `web/app/trial-actions.ts` before touching either.

## ⚠ The two things that are the owner's, and only his

1. **The WP26 flags** — `CLARIFY_CLICK_ENABLED`, `ANSWER_FIRST_ENABLED`. Still OFF. He has reserved this go-live
   in his own words, repeatedly. Do not flip them and do not fold them into "autonomous". Read
   [#175](../open-questions.md) first: the anonymous trial receives NEITHER flag, so flipping changes the paid
   product and not the surface whose misfires motivated WP26c.
2. **`GDPR_PURGE_APPLY=1`** — the purge cron is live and scheduled monthly but **reports only**. Until this is set,
   nothing is actually redacted or deleted. The 90-day trial-bookkeeping clock first bites **~2026-10-15**.
   Procedure in the RUNBOOK; unsetting it is a complete rollback.

## How to work here

Owner steer, 2026-07-25: ***"I want you to work autonomously."*** Do not end a session by handing him decisions.
Write the **recommended default + cost bound + rollback + done-definition** and act under
[#118](../open-questions.md)(b); he vetoes by exception. Every parked item already has that treatment in
[`2026-07-26-autonomous-followups.md`](2026-07-26-autonomous-followups.md) — start there.

## Queue

0. **Nothing is half-finished.** The queue below is fresh work, not a continuation.

1. **[#186](../open-questions.md) — measure, then cache.** Every anonymous homepage GET costs 1-2 uncached queries
   against a 15-connection ceiling, ungated and unrated. **Measure first** (`pg_stat_activity` via the management
   API, which bypasses the pooler — quiet hour vs deploy), then the 15-30 s in-process cache on the POT READ ONLY.
   It cannot over-serve, because the atomic take is the real gate, and it preserves the owner's "a refill re-opens
   without a deploy" decision to within the TTL.
2. **[#184](../open-questions.md) — only AFTER #186.** It adds a third uncached query per anonymous page view,
   straight into the pressure #186 is about. Sequencing matters more than the fix.
3. **[#181](../open-questions.md) — one narrow owner question, then build.** Anonymous trial CONTENT is kept 2
   years with no self-service erasure route while its bookkeeping goes at 90 days. The default is to redact at 90
   days too; the ONLY thing that would change it is whether he wants that corpus as product data. Ask that one
   line, don't re-open the whole retention question.
4. Then the standing menu: **~30/7 BBP+PPI syncs** (`85880NED` MUST use the chunked escape hatch, RUNBOOK step 5),
   re-ask **[#132](../open-questions.md) route B**, WP30c choice, [#162](../open-questions.md).

**Explicitly NOT to do:** [#174](../open-questions.md) (the obvious fix is worse than the bug — it needs a decision
about what the bit MEANS), and [#185](../open-questions.md) (declined with reasoning this session; if it ever
becomes reachable the fix is a refund CAP per visitor, not removing the compensation).

## Binding constraints

- Autonomous ⇒ **branch + PR + owner review before merge**; owner-present ⇒ push/merge directly, no per-change
  asking. Full verification block before EVERY code push: typecheck root + web, backend suite, web suite,
  benchmark 14/14 + 6/6 + 0, real `next build`, **plus a review pass over your own diff**.
- **Zero prompt bytes** (`prompt.ts`/`schema.ts`/`parse.ts` byte-identical, or ~93 fixtures invalidate, #164).
- No live DDL without a supervised window. **No stacked deploys** (#173) — one at a time, canary between:
  `curl -s -o /dev/null -w '%{http_code}' https://checkdecijfers.vercel.app/llms.txt` → 200.
- Delegation by role: session model orchestrates and judges; **Fable** for architecture and adversarial analysis;
  Sonnet/Haiku for legwork. Never hardcode model names in reusable prompts.

## Seven traps this session paid for

1. **A review pass over your own diff has now found something real SIX changes running**, including a
   max-effort pass that found four defects shipped hours earlier the same night. Budget it as a required
   step, and re-run it if you keep editing after it returns — a review certifies a tree, not an intention.
2. **A docs-search INDEX is not the page.** "Undocumented" is a claim that needs the page open; getting it wrong
   here reversed a code decision.
3. **Key a post-merge CI wait on the merge commit's own SHA** — "the latest run on `main`" can match the previous
   merge's completed run and report green for a build that has not started.
4. **A revert-proof is per-TEST, not per-commit.** Count the failures and match them one-to-one to your claims; if
   a change has no test, write "reasoning-only, no test" rather than letting a blanket sentence cover it.
5. **A new self-authenticating route must go in `web/proxy.ts`'s `PUBLIC_EXACT_PATHS`** or it 307s to `/login`,
   returns 200 to the caller, and looks healthy while never running. (Exact-match now, not prefix — a sibling under
   an existing cron's name used to inherit the exemption.)
6. **A scripted edit whose anchor has drifted is a SILENT no-op.** `replace()` without an assert reported success
   and did nothing; only a later typecheck caught it. Assert every anchor. Same family as the stale-ref merge and
   the latest-CI-run trap — a tool that reports success without acting is the expensive kind.
7. **When a SECOND instance of a bug shows up, stop patching and normalise.** Three review findings were three
   spellings of one bug in `ipBucketKey`, each closed alone while the next stayed broken. The third instance is
   already in the input space by the time you see the second.

---

## Paste-ready

> Sessie 59 voor checkdecijfers.nl. Lees eerst CLAUDE.md, dan docs/STATUS.md (het ▶-blok bovenaan is leidend),
> dan docs/session-briefs/2026-07-26-session-59-kickoff.md — dat is je opdracht.
>
> Stand: laatste code-commit op main = d4ade6d, alles van sessie 58B is gemerged en live (acht PR's, #64 t/m #71 — inclusief een max-effort review die 14 van z'n eigen 15 bevindingen fixte), CI groen, productie
> 200/200. Backend 1545/102, web 425/41, benchmark 14/14 + 6/6 + 0.
> ⚠ TWEE DINGEN ZIJN VAN MIJ: de WP26-vlaggen blijven UIT, en GDPR_PURGE_APPLY blijft UIT tot ik hem zelf zet.
>
> Werk autonoom: alles wat eerder op mij geparkeerd stond heeft een aanbevolen default, kostenplafond en rollback
> in docs/session-briefs/2026-07-26-autonomous-followups.md. Begin daar, niet bij mij. Volgorde: (1) #186 eerst
> METEN, dan de korte pot-read-cache; (2) #184 pas NA #186; (3) #181 met één gerichte vraag aan mij. Houd #174 en
> #185 expliciet aan.
>
> Harde grenzen: branch + PR per item zolang ik er niet bij ben, nul promptbytes, geen live DDL, geen gestapelde
> deploys (#173), volledig verificatieblok plus een review-pass over je eigen diff vóór elke push. Architectuur en
> diepe analyse naar Fable-agents, mechanisch legwork naar Sonnet/Haiku.
>
> Sluit af met het volledige wrap-up-ritueel.
