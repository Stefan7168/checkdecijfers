# Session 62 kickoff

**Written 2026-08-07 at the close of session 61.** Supersedes
[`2026-07-26-session-61-kickoff.md`](2026-07-26-session-61-kickoff.md) — its queue is done.

## Reading order

`CLAUDE.md` → [`docs/STATUS.md`](../STATUS.md) (the ▶ block leads) → this file.

Unlike last time, **`main` is current**: PR 77 is merged, so every session-60 and session-61 document is on
`main`. There is no branch you must check out before reading.

## State — verify it, don't trust this file

The Golden Rule applies to reading a handover too. Re-derive anything you act on: `date +%Y-%m-%d`,
`git --no-pager log --oneline -5`, `gh pr list --state all -L 8`, `gh run list -L 5`, and
`curl -s -o /dev/null -w '%{http_code}' https://checkdecijfers.vercel.app/llms.txt`.

- **PR 77 is MERGED and DEPLOYED** — squash `1a16eed`, CI run 31159544689 `gate` ✅ + `deploy` ✅, canary 200.
- **PR #85 is OPEN on the owner's review** — branch `fix/191-reply-turn-answer-first`. Four concerns:
  **#191**, **#192**, **#132**, **#193**, plus the review fixes and the wrap-up docs. **Nothing from it is
  merged or deployed.** ⚠ No commit count here on purpose: session 61 removed one from STATUS for going
  stale on the next commit, then wrote a wrong one into this very file and caught it in the final
  self-audit. Ask git: `gh pr view 85 --json commits --jq '.commits | length'`.
- **Counts at the close, measured on a frozen tree with the block run SOLO:** backend **1572 / 105 files**,
  web **453 / 42**, benchmark **14/14 + 6/6 + 0 fabricated GATE PASS**, real `next build` compiled, both
  typechecks clean.
- ⚠ **Do not run the verification block next to agents.** On this 8 GB machine the backend suite (105
  PGlite-backed files) is **OOM-killed, exit 137**, and the log simply stops after the `RUN` banner with no
  failure line. That happened twice this session and the first was misread as green. Run it solo and capture
  the code: `npm test > log 2>&1; echo $?`.

## ⚠ The two things that are the owner's, and only his

1. **The WP26 flags** — `CLARIFY_CLICK_ENABLED`, `ANSWER_FIRST_ENABLED`. Still OFF.
   ✅ **[#191](../open-questions.md), the pre-flip blocker, is fixed** (in PR #85 — merge that first).
   Still read [#175](../open-questions.md) before flipping: the anonymous trial receives **neither** flag.
2. **`GDPR_PURGE_APPLY=1`.** The monthly cron runs but **reports only**; nothing is deleted until he sets it.
   First anonymous rows purgeable **~2026-10-15**.

## Queue

1. **Review + merge PR #85.** Serial, canary between ([#173](../open-questions.md)). It carries the WP26
   pre-flip blocker, so it gates item 2.
2. **The WP26 go-live** (owner-supervised) — one flag at a time, RUNBOOK "WP26 answer-first + clickable
   options". #191 no longer blocks it. ⚠ The RUNBOOK's rollback ORDER is load-bearing and counter-intuitive:
   `CLARIFY_CLICK_ENABLED` off FIRST, leave `ANSWER_FIRST_ENABLED` on for a day, then that one.
3. **`GDPR_PURGE_APPLY=1`** plus one watched run (RUNBOOK).
4. **Dependabot #80 → #81 → #82**, in that risk order, one deploy at a time.
   - **#80** `undici` 7.28→7.29 (web, patch) — low.
   - **#81** `@anthropic-ai/sdk` 0.114→**0.115** (a 0.x minor can break under semver) + `stripe` 22.3→22.4
     (money path) + `@types/*`. **Not yet built locally — do that first.**
   - **#82** `next` 16.2.11→**16.3.0** + `jsdom` ^29→**^30 major**. ✅ **Already fully verified locally this
     session**: root `npm ci` 0, web typecheck 0, 42/42 files and 453/453 tests, `next build` **0**.
   - ⚠ **CI cannot catch a build-breaking bump on a PR, and that is DELIBERATE** — `gate` is hermetic and
     `next build` fetches fonts over the network, so it only runs inside `deploy`, downstream of green (see
     the comment at the top of `.github/workflows/ci.yml`). **The mitigation is a local build, not a CI
     change.** To do one: `git worktree add <dir> origin/<dependabot-branch>`, then **`npm ci` at the ROOT
     as a real install** (not a symlink — Turbopack rejects a `node_modules` symlink pointing outside the
     project, the ADR 018 error) **and** `npm --prefix web ci`, then build. Read exit codes directly, never
     through a `| tail` pipe.
5. **[#193](../open-questions.md)'s two remaining copy edits** — decided, strings written down in the row,
   deliberately unshipped. They change a refusal TEMPLATE, so per [#133](../open-questions.md) live rows
   would need **row-id-pinned** `known-divergences` entries, and finding the ids needs `audit:verify`
   against the live DB. Owner-supervised. ⚠ `tests/answer/respond-refusals.test.ts:419` asserts
   `.not.toMatch(/laatste definitieve/)` — reword the template without updating that pin and the assertion
   goes **vacuously true**.
6. **[#132](../open-questions.md) route B** — `forks_count` was 0 on 2026-07-26; still purely waiting on the
   owner's explicit in-chat GO.
7. Then the owner menu: WP30c choice, [#162](../open-questions.md), [#170](../open-questions.md) rest
   (3)+(4).

**Explicitly NOT to do:** [#174](../open-questions.md) (the obvious fix is worse than the bug),
[#185](../open-questions.md) (declined with reasoning), [#183](../open-questions.md) (product call),
[#188](../open-questions.md) (concurrency on a live money path — supervised only),
[#190(a)](../open-questions.md) (whether an infrastructure-caused refusal costs a trial question).

## Binding constraints

- **Git workflow:** owner-present ⇒ push/merge directly, no per-change asking. Autonomous ⇒ branch + PR +
  owner review, **unless he says otherwise for that session** — and an exception never carries over.
  [#118](../open-questions.md)(b). Session 61 was autonomous with ONE merge authorised by name (PR 77).
- **Full verification block before EVERY code push:** typecheck root + web, backend suite, web suite,
  benchmark 14/14 + 6/6 + 0, real `next build`, **plus a review pass over your own diff**. Run it SOLO.
- **Zero prompt bytes** unless deliberately doing a #164 re-record. **No live DDL** without a supervised
  window. **No stacked deploys** (#173) — one at a time, `/llms.txt` → 200 between.
- Delegation by role: session model orchestrates and judges; **Fable** for architecture and adversarial
  analysis; Sonnet/Haiku for legwork.
- **Commit messages in English** per CLAUDE.md.

## Traps this session paid for

1. **A missing summary line is not a pass.** Exit 137 (OOM) leaves a log that just stops. Capture `$?`.
2. **Never read an exit code through a pipe.** `cmd | tail -N; echo $?` reports **`tail`'s** status — always
   0. Two "BUILD_EXIT=0" readings this session meant nothing.
3. **A local dependency check must install BOTH lockfiles.** `npm --prefix web ci` alone made 9 web test
   files fail on unresolvable root deps reached through the `web/backend` symlink — the session's error
   presented as the PR's defect.
4. **A line reference written while editing the file above it is stale on arrival.** The comment added for
   #191 moved the cited line from 630 to 652, and the docs written in the same commit still said 630.
5. **A subagent's conclusion and its evidence are separate claims.** One review agent supported a correct
   conclusion with a citation to `tests/answer/audit-reconstruct.test.ts` — a file that has never existed.
   The adversarial verifier caught it. Always `ls`/`grep` a path before copying it into a doc.
6. **A pin can inherit the blind spot it was written to close.** The #132 doc-convention test, written from
   the lesson "derive the pattern from the REASON for the rule", was itself scoped to the directory the
   instances lived in, leaving `CLAUDE.md` unscanned.
7. **A test asserting ABSENCE goes vacuous when you reword its target.** Grep for `not.toMatch` /
   `not.toContain` against any string you are about to change.
8. **Check whether an invariant already answers your "open product question."** #191 looked like a product
   fork; R7's third branch had already decided it.
9. **`git rebase --continue` still silently drops a `#`-prefixed subject line.** Use `--cleanup=whitespace`
   on every rebase and cherry-pick here.

---

## Paste-ready

> Sessie 62 voor checkdecijfers.nl.
>
> `main` is bij: PR 77 is gemerged en gedeployd, dus alle documentatie van sessie 60 én 61 staat er nu op.
> Je hoeft niets uit te checken vóór je leest. Lees: CLAUDE.md, dan docs/STATUS.md (het ▶-blok bovenaan is
> leidend), dan docs/session-briefs/2026-08-07-session-62-kickoff.md — dat is je opdracht.
>
> ⚠ Draai `date` als allereerste commando.
>
> Stand: sessie 61 draaide autonoom. PR 77 is gemerged (squash `1a16eed`, gate+deploy groen, canary 200).
> **PR #85 staat OPEN op mijn review** — #191 (de WP26-blokkade, opgelost), #192, #132 en #193. Niets
> daarvan is gemerged of gedeployd. Backend 1572/105, web 453/42, benchmark 14/14 + 6/6 + 0, echte
> next build. Verifieer dit alles zelf.
>
> ⚠ TWEE DINGEN BLIJVEN VAN MIJ: de WP26-vlaggen UIT, en GDPR_PURGE_APPLY UIT tot ik hem zelf zet.
> #191 blokkeert de ANSWER_FIRST-flip niet meer.
>
> Volgorde: (1) PR #85 — review + merge, serieel met canary ertussen; (2) de WP26-livegang, één vlag tegelijk
> — let op de omgekeerde rollback-volgorde in de RUNBOOK; (3) GDPR_PURGE_APPLY=1 + één bewaakte run;
> (4) Dependabot #80 → #81 → #82 in die volgorde — #82 is al lokaal volledig geverifieerd (incl. next build),
> #81 nog niet; (5) #193's twee resterende copy-edits (beslist, maar ze raken een refusal-template, dus
> `audit:verify` tegen de live DB eerst); (6) #132 route B wacht op mijn expliciete GO; (7) daarna het
> owner-menu: WP30c, #162, #170-rest.
>
> Houd #174, #185, #183, #188 en #190(a) expliciet aan.
>
> Harde grenzen: ben ik er niet bij, dan branch + PR + mijn review vóór de merge (#118(b)); een uitzondering
> geldt NOOIT automatisch opnieuw. Volledig verificatieblok plus een review-pas over je eigen diff vóór elke
> push, nul promptbytes, geen live DDL, geen gestapelde deploys (#173). Architectuur en diepe analyse naar
> Fable-agents, mechanisch legwork naar Sonnet/Haiku.
>
> ⚠ Vier valstrikken die deze sessie betaald zijn:
>  - Draai het verificatieblok SOLO. Naast agents wordt de backend-suite OOM-gekilld (exit 137) en stopt het
>    log gewoon, zonder foutregel. Een log zonder samenvatting is een kill, geen pass — lees `$?`.
>  - Lees NOOIT een exitcode door een pipe: `cmd | tail -N; echo $?` geeft de status van `tail`, altijd 0.
>  - Een lokale dependency-check moet BEIDE lockfiles installeren, en de root-install moet echt zijn (geen
>    symlink — Turbopack weigert een node_modules-symlink buiten het project).
>  - Een regelnummer dat je opschrijft terwijl je erboven in hetzelfde bestand edit, is meteen verouderd.
>
> Sluit af met het volledige wrap-up-ritueel.
