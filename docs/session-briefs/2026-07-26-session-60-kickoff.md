# Session 60 kickoff

**Written 2026-07-26 at the close of session 59.** Supersedes
[`2026-07-26-session-59-kickoff.md`](2026-07-26-session-59-kickoff.md) — its queue is done.

## Reading order

`CLAUDE.md` → [`docs/STATUS.md`](../STATUS.md) (the ▶ block leads) → this file.

## State — verify it, don't trust this file

Every number below was true when written. The Golden Rule applies to *reading* a handover too: re-derive
anything you are about to act on (`date +%Y-%m-%d`, `git --no-pager log --oneline -5`,
`gh pr list --state all -L 5`, `curl` the prod URL).

- **Four items shipped in session 59**, each merged serially with a production canary between (#173):
  [#186](../open-questions.md) `e30203a` (PR 72), [#184](../open-questions.md) `1342f79` (PR 74),
  [#181](../open-questions.md) `4a9cb77` (PR 75), [#190(b)](../open-questions.md) `ae7640c` (PR 76).
- **Counts at the close:** backend **1551 / 102 files**, web **453 / 42**, benchmark **14/14 + 6/6 + 0
  fabricated GATE PASS**. Production 200 on `/`, `/llms.txt`, `/login`.
- **Theme was capacity + retention on the ANONYMOUS surface.** If you are picking up capacity work, read
  #186's row first — the measurement in it changed what the right fix was.

## ⚠ The two things that are the owner's, and only his

1. **The WP26 flags** — `CLARIFY_CLICK_ENABLED`, `ANSWER_FIRST_ENABLED`. Still OFF, four sessions running.
   Read [#175](../open-questions.md) before anyone flips them: the anonymous trial receives **neither** flag,
   so flipping changes the paid product and not the surface whose measured misfires motivated WP26c.
2. **`GDPR_PURGE_APPLY=1`.** The monthly cron runs but **reports only**. Since #181 it now has THREE clocks to
   report on (account content at 2 years, anonymous content at 90 days, trial bookkeeping deleted at 90 days),
   and it still deletes nothing until he sets that variable. First anonymous rows purgeable **~2026-10-15**.

## Queue

1. **[#176](../open-questions.md) — the clearly-next capacity item, and it is now de-risked.** With both WP26
   flags OFF, a region-ambiguous question still runs `regionOptionIntents` → `resolvePeriod` (a real query)
   whose result `policy.ts` throws away. The reason nobody has touched it is fear of #164, and that fear is
   now checked: **the fixture key is `sha256(stableStringify(request))` over the LLM REQUEST**
   (`src/answer/llm/client.ts:78`), not over the source file — the kickoff phrase "`parse.ts` byte-identical"
   is conservative shorthand for that. Threading `clickOptionsEnabled` into `resolveCandidate` (which runs
   AFTER the LLM call) cannot invalidate a fixture as long as no prompt string moves, and the intent replay
   suite is the empirical check, since a changed request simply misses its fixture and throws. The shape is
   already scouted: `resolveCandidate` takes an options bag (`resolve.ts:958`), the flag is threaded to
   `policy.ts` from `parse.ts`/`followup.ts`, the waste is at `resolve.ts:994`. Add the counting-`Db` query-count
   pin the review suggested — nothing pins query counts today.
2. **~30/7 BBP+PPI syncs.** `85880NED` MUST use the chunked escape hatch (RUNBOOK step 5). Measure at CBS
   first — session 56 found nothing was actually due.
3. **Re-ask [#132](../open-questions.md) route B.** `forks_count` was 0 at the last check, so T-0 holds.
4. Then the owner menu: WP30c choice, [#162](../open-questions.md), [#170](../open-questions.md) rest (3)+(4).

**Explicitly NOT to do:** [#174](../open-questions.md) (the obvious fix is worse than the bug — it needs a
decision about what the bit MEANS), [#185](../open-questions.md) (declined with reasoning; if it ever becomes
reachable the fix is a refund CAP per visitor, not removing the compensation), [#183](../open-questions.md)
(product call), [#188](../open-questions.md) (concurrency on a live money path — supervised only),
[#190(a)](../open-questions.md) (whether an infrastructure-caused refusal costs a trial question — a conversion
judgement, and it changes what someone is charged).

## Binding constraints

- **Git workflow:** owner-present ⇒ push/merge directly, no per-change asking. Autonomous ⇒ branch + PR + owner
  review, **unless he says otherwise for that session** — in session 59 he did, in writing, mid-session. Do not
  generalise that to the next one. [#118](../open-questions.md)(b).
- **Full verification block before EVERY code push:** typecheck root + web, backend suite, web suite, benchmark
  14/14 + 6/6 + 0, real `next build`, **plus a review pass over your own diff**.
- **Zero prompt bytes** unless you are deliberately doing a #164 re-record.
- **No live DDL** without a supervised window. **No stacked deploys** (#173) — one at a time, canary between:
  `curl -s -o /dev/null -w '%{http_code}' https://checkdecijfers.vercel.app/llms.txt` → 200.
- Delegation by role: session model orchestrates and judges; **Fable** for architecture and adversarial
  analysis; Sonnet/Haiku for legwork. Never hardcode model names in reusable prompts.

## Traps this session paid for

1. **`git rebase --continue` SILENTLY DROPS a subject line starting with `#`.** It bit twice on the same commit
   and reported success both times; `git log --oneline` then shows a 500-character "subject". This repo's
   commits are `#181: …`, and the rebase editor's default cleanup strips `#` lines as comments. `git commit -F`
   does not, which is why the originals were fine. **Use `--cleanup=whitespace` on every rebase and
   cherry-pick here**, or `git -c core.commentChar=';'`.
2. **Squash-merging a stacked PR CLOSES the child, it does not retarget it.** #72's squash deleted #73's base
   branch, which auto-closed #73 and made its base unchangeable. Recovery is `git rebase --onto main <old-base-sha>`
   plus a fresh PR. Stack only when the dependency is real, and expect to re-open the child.
3. **An empty review result can mean "nothing ran".** Five parallel review agents died on `529 Overloaded` and
   the workflow returned `{confirmed: [], refuted: []}` — indistinguishable from clean. Check the failure list.
   Two at a time succeeded.
4. **Run the mutation over the WHOLE suite the change touches, after the last test is written.** A count taken
   from one file went into a commit message and was wrong by 4×.
5. **A test can be tautological in a way that survives review.** One advanced the clock BY the constant it was
   meant to pin (any TTL would have passed); one cannot fail while a sibling module imports the constant. When
   a test survives a mutation it should have caught, relabel it a guard rather than leave it reading as a proof.
6. **The review pass over your own diff has now found something real TEN changes running.** Three of four this
   session were the same class: an incomplete stale-doc sweep, a summary sentence still stating the old rule one
   paragraph above the new one. The fourth was the one trade-off I had not written down while documenting every
   other — **the thing you did not write down is the thing you did not want to.**
   **And budget one more pass over the COMBINED diff at the end of a multi-change session.** Each of the four
   changes was reviewed alone and came back clean; reviewing them together, briefed to hunt only for what breaks
   when two MEET, found a real latch bug in `web/lib/ontdek.ts` — in the file next to the one where that exact
   trap had just been avoided deliberately and documented. Knowing a trap in file A does not protect file B.
8. **A number measured on a branch goes STALE when you rebase it.** Three commit messages this session carried
   counts that were true when measured and wrong when merged (e.g. "web 425/41", correct pre-rebase, 440 after).
   Re-measure after the last REBASE, or put the number in the PR body, which is editable, rather than the commit
   message, which is not.
7. **A doc that explains a MECHANISM is still a claim.** Both #186's row and the RUNBOOK said pooler sessions
   release on node-pg's 10 s idle timer. Measured false — a session was held 174 s, because the timer does not
   fire while a Fluid Compute instance is frozen. Two docs agreeing with each other is not evidence.

---

## Paste-ready

> Sessie 60 voor checkdecijfers.nl. Lees eerst CLAUDE.md, dan docs/STATUS.md (het ▶-blok bovenaan is leidend),
> dan docs/session-briefs/2026-07-26-session-60-kickoff.md — dat is je opdracht.
>
> Stand: sessie 59 leverde vier items, allemaal gemerged en live (PR #72/#74/#75/#76 — #186 pot-cache, #184
> IP-limiet op de gate, #181 anonieme retentie 90 dagen, #190(b) 5s-deadline). Backend 1551/102, web 453/42,
> benchmark 14/14 + 6/6 + 0, productie 200/200/200. Verifieer dat zelf even — niet uit deze tekst overnemen.
>
> ⚠ TWEE DINGEN BLIJVEN VAN MIJ: de WP26-vlaggen UIT, en GDPR_PURGE_APPLY UIT tot ik hem zelf zet.
>
> Volgorde: (1) #176 — nu gede-riskt, de #164-fixture-sleutel hasht het LLM-REQUEST en niet het bestand;
> (2) ~30/7 BBP+PPI-syncs, 85880NED via de chunked escape hatch; (3) #132 route B opnieuw vragen. Houd #174,
> #185, #183, #188 en #190(a) expliciet aan.
>
> Harde grenzen: ben ik er niet bij, dan branch + PR + mijn review vóór de merge (#118(b)) — sessie 59 kreeg
> daar van mij een expliciete uitzondering op, en die geldt NIET automatisch opnieuw; vraag het of ga uit van
> branch + PR. Verder: volledig verificatieblok plus een review-pas over je eigen diff vóór elke push, nul
> promptbytes, geen live DDL, geen gestapelde deploys (#173). Architectuur en diepe analyse naar Fable-agents,
> mechanisch legwork naar Sonnet/Haiku. ⚠ Bij elke rebase/cherry-pick: `--cleanup=whitespace`, anders slikt git
> je `#`-subject.
>
> Sluit af met het volledige wrap-up-ritueel.
