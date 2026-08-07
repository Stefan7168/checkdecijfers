# Session 61 kickoff

**Written 2026-07-26 at the close of session 60.** Supersedes
[`2026-07-26-session-60-kickoff.md`](2026-07-26-session-60-kickoff.md) — its queue is done.

## ⚠ Read this before the reading order: these docs are NOT on `main`

Everything session 60 wrote lives on the **PR 77 branch** (`perf/176-gate-region-option-intents`). On `main`,
STATUS still opens with "Session 59", and `#191`/`#192`/`#193`, the corrected RUNBOOK step 5, the new
release-day step 6, and this file **do not exist**. Either `git checkout perf/176-gate-region-option-intents`
or merge PR 77 before reading anything.

Why it matters more than a stale tracker: **the ~30/7 sync DATA is already live in production** while the
docs recording it are not on `main`, so `main` and production disagree. A session reading `main` would
conclude that #176 and the syncs still need doing, and — worst of the three — `main`'s RUNBOOK step 5 still
instructs a release-day sync through the chunked escape hatch, which is measured wrong and would quarantine
the table ([#192](../open-questions.md)).

## Reading order

`CLAUDE.md` → [`docs/STATUS.md`](../STATUS.md) (the ▶ block leads) → this file.

## State — verify it, don't trust this file

The Golden Rule applies to *reading* a handover too. Re-derive anything you are about to act on:
`date +%Y-%m-%d`, `git --no-pager log --oneline -5`, `gh pr list --state all -L 5`, `gh run list -L 5`,
`curl` the prod URL.

- **Nothing was merged or deployed in session 60.** The owner was not in the chat and his session-60 prompt
  said session 59's push-to-`main` exception does not carry over, so everything went to a branch.
- **PR 77 is OPEN and is the first thing to deal with** — branch `perf/176-gate-region-option-intents`,
  three commits: `a108ba3` (#176), `a25f3e8` (#132 pin), `06f6209` (a CI fix).
- **Counts at the close, measured on a frozen tree at `a25f3e8`:** backend **1562 / 103 files**, web
  **453 / 42**, benchmark **14/14 + 6/6 + 0 fabricated GATE PASS**, real `next build`. Production
  **200 / 200 / 200**, unchanged — nothing shipped.
- CI: green on `a108ba3`; red once on `a25f3e8` (a 0-second workflow-parse failure, see traps) then fixed
  by `06f6209`. **Check the run for `06f6209` yourself before believing the branch is green.**

## ⚠ The two things that are the owner's, and only his

1. **The WP26 flags** — `CLARIFY_CLICK_ENABLED`, `ANSWER_FIRST_ENABLED`. Still OFF, five sessions running.
   Two things to read before anyone flips them: [#175](../open-questions.md) (the anonymous trial receives
   **neither** flag, so flipping changes the paid product and not the surface WP26c was built for) and now
   **[#191](../open-questions.md)** — new, and a genuine pre-flip blocker, see below.
2. **`GDPR_PURGE_APPLY=1`.** The monthly cron runs but **reports only**. Three clocks depend on it
   (account content 2 years, anonymous content 90 days, trial bookkeeping deleted at 90 days) and it
   deletes nothing until he sets that variable. First anonymous rows purgeable **~2026-10-15**.

## Queue

1. **PR 77 — the owner reviews and merges, or a session merges on his word.** Two independent changes on one
   branch (deliberately not stacked: they touch the same two doc files, and session 59 learned that
   squash-merging a stacked PR closes the child rather than retargeting it). Merge serially per
   [#173](../open-questions.md), canary between.
2. **[#191](../open-questions.md) — answer it before the `ANSWER_FIRST_ENABLED` flip, not after.** The
   clarification REPLY turn never receives that flag, though `ClarifyReplyOptions` declares it and its
   comment says it is threaded (`respond.ts:586-595`). Harmless while off — both turns run pre-B and agree.
   Flip it and they stop agreeing: the first turn defaults a missing region/period and answers, the reply
   turn judges the same option under pre-B rules and can refuse. **The question is not "thread it" — it is
   whether a reply turn SHOULD default like the first turn, or whether the user's reply is exactly the
   moment not to default.** That is a product call sitting on a two-line code change.
3. **The WP26 go-live** (owner-supervised) — one flag at a time, RUNBOOK section "WP26 answer-first +
   clickable options", **#191 first**, NOT during a deploy burst (#173).
4. **`GDPR_PURGE_APPLY=1`** plus one watched run (RUNBOOK).
5. **[#132](../open-questions.md) route B** — `forks_count` measured **0** on 2026-07-26, so the T-0
   go/no-go still holds and the two-phase reversible drill still awaits the owner's explicit in-chat GO.
   It has been re-asked three times now; it is purely waiting on him, nothing has expired.
6. **[#192](../open-questions.md)** — small ingestion fix: `sync-from-capture.ts` passes no options to
   `syncTable`, so the documented escape hatch can never accept the new period code every CBS release brings.
   Thread `--accept-new-codes` / `--rebaseline` through exactly as `src/ingestion/cli.ts:32-33` already does.
7. **[#193](../open-questions.md)** — a product/copy call, not a bug: CBS revised **1,103 already-`Definitief`
   figures** back to 2015KW01 in one release, and the product offers the freshest *Definitief* period as the
   safer one. Three options framed in the row; the ambitious one is [#88](../open-questions.md) revision
   awareness, built on the correction-diff log we already keep.
8. **Three Dependabot PRs arrived during the gap — #80, #81, #82** (undici 7.29.0; `npm-all` ×4;
   `npm-web-all` ×14). Not touched. ⚠ s49 precedent: a bump can pass the gate and go red only at
   `next build` (that is how the TS ^5 pin happened), so watch the deploy job, not just the tests.
9. Then the owner menu: WP30c choice, [#162](../open-questions.md), [#170](../open-questions.md) rest
   (3)+(4).

**✅ ~30/7 BBP+PPI syncs — DONE 2026-08-07, nothing left to do here.** ⚠ *This section first said "measured
2026-07-26, nothing was due" — true that day, and stale twelve days later when the session resumed. CBS
published both on 30/7.* Both are synced, `active`, verified LLM-free, and live: **BBP 2026KW02** j-o-j
**+1.3** / k-o-k **+0.4**; **PPI juni 2026** totaal **5.3** / invoer **7.9**. Two frozen reference values in
[`11-coverage-table-set.md`](../11-coverage-table-set.md) were revised by CBS and are corrected there.
**`85880NED` did NOT need the chunked escape hatch** — the direct stream did 100,240 rows in 77 s. And per
**[#192](../open-questions.md)** the hatch could not have done it anyway: `sync-from-capture.ts` passes no
options, so it can never accept the new period code every release brings. Re-measure before assuming
anything here: `curl -s https://datasets.cbs.nl/odata/v1/CBS/<id>/Properties` returns `Modified` directly.

**Explicitly NOT to do:** [#174](../open-questions.md) (the obvious fix is worse than the bug — it needs a
decision about what the bit MEANS), [#185](../open-questions.md) (declined with reasoning),
[#183](../open-questions.md) (product call), [#188](../open-questions.md) (concurrency on a live money path
— supervised only), [#190(a)](../open-questions.md) (whether an infrastructure-caused refusal costs a trial
question — a conversion judgement that changes what someone is charged).

## Binding constraints

- **Git workflow:** owner-present ⇒ push/merge directly, no per-change asking. Autonomous ⇒ branch + PR +
  owner review, **unless he says otherwise for that session**. He did in session 59; he explicitly did NOT
  renew it for session 60. Do not generalise either way — ask, or assume branch + PR.
  [#118](../open-questions.md)(b).
- **Full verification block before EVERY code push:** typecheck root + web, backend suite, web suite,
  benchmark 14/14 + 6/6 + 0, real `next build`, **plus a review pass over your own diff**.
- **Zero prompt bytes** unless you are deliberately doing a #164 re-record.
- **No live DDL** without a supervised window. **No stacked deploys** (#173) — one at a time, canary
  between: `curl -s -o /dev/null -w '%{http_code}' https://checkdecijfers.vercel.app/llms.txt` → 200.
- Delegation by role: session model orchestrates and judges; **Fable** for architecture and adversarial
  analysis; Sonnet/Haiku for legwork. Never hardcode model names in reusable prompts.
- **Commit messages in English** per CLAUDE.md. Session 59 wrote Dutch; session 60 went back to English and
  flagged the divergence. If the owner wants Dutch, the convention doc should change — not the practice
  drifting again.

## Traps this session paid for

1. **A test can name the issue it does not cover.** `query-count.test.ts` had a case commented "the shape
   #176 was found on"; it passes `regions: null`, which exits at `resolve.ts:166` and never reaches the
   branch. The fix moved none of its numbers, and a no-op gate would have stayed green.
   **Before trusting a test as the verification of a fix, construct the failing input yourself and confirm
   that test would see it.**
2. **A `.yml` edit is a code change with no local gate.** An unquoted colon-space in a workflow step name
   made the whole file unparseable; CI died in **0 s** while the full suite, both typechecks, the benchmark
   and a real build were all green locally — none of them parses `.github/workflows/`. A 0-second red run
   is the signature. Validate: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`.
3. **Freeze the tree, then measure.** Two full-suite runs came back `1 failed`; the first was explained away
   as a race with in-flight edits, and the second failed identically, which killed that theory. The 16-minute
   local suite makes "run it and keep editing" tempting and it is always wrong. **When a failure repeats,
   discard the convenient explanation first.**
4. **A search-and-replace must be checked against the words AROUND its pattern.** Neutralizing
   `PR [#68](url)` → `PR #68` left the word already in front, producing a doubled "PR" — 10 in this
   session's commit and 17 inherited, meaning all three neutralization rounds ever run made the same
   mistake and none noticed.
5. **Derive a pin's pattern from the REASON for the rule, not from the instances in front of you.** The
   first version of the doc-convention regex was anchored on markdown `](…)` syntax, while the rule exists
   because the URL 404s — so bare URLs, reference-style targets and HTML hrefs were all blind spots.
6. **A pin that fires on its own documentation means the rule was stated more loosely than it was meant.**
   The doubled-word check went red on the lessons entry explaining the doubled word. Sharpen the rule
   (prose is checked, backticked quotations are not) rather than exempting the file.
7. **Brief a reviewer with the SHAPE of a bug, not only its location.** #191 was found because the review
   of #176 was told the shape was "an options-bag omission" and went looking for the same shape one module
   over — where it found one, dormant, on the path the owner is about to switch on.
8. **`git rebase --continue` still silently drops a `#`-prefixed subject line** (session 59). Use
   `--cleanup=whitespace` on every rebase and cherry-pick here.

---

## Paste-ready

> Sessie 61 voor checkdecijfers.nl.
>
> ⚠ **EERST DIT: alle documentatie van sessie 60 staat op de BRANCH van PR 77, nog NIET op `main`.**
> `main` z'n STATUS begint nog met "Session 59", en #191/#192/#193, de gecorrigeerde RUNBOOK-stap 5 + de
> nieuwe stap 6, en dit bestand bestaan daar niet. Doe dus één van tweeën vóór je iets leest:
> `git checkout perf/176-gate-region-option-intents`, óf merge PR 77 eerst. Lees NIET de STATUS van `main`
> en concludeer dat #176 en de ~30/7-syncs nog moeten — die zijn klaar, en de sync-DATA staat al live in
> productie terwijl de docs die dat zeggen nog op de branch staan.
> ⚠ Extra scherp: `main` z'n RUNBOOK stap 5 zegt nog dat je op releasedag de chunked escape hatch MOET
> gebruiken. Dat is gemeten onjuist én die hatch quarantainet de tabel (#192). Volg 'm niet.
>
> Lees dan: CLAUDE.md, dan docs/STATUS.md (het ▶-blok bovenaan is leidend), dan
> docs/session-briefs/2026-07-26-session-61-kickoff.md — dat is je opdracht.
>
> ⚠ Let op: sessie 60 liep over TWAALF DAGEN (26/7 geschreven, 7/8 hervat). Draai `date` als eerste — een
> conclusie uit die sessie ("er valt niets te syncen") was door het tijdsverloop juist omgedraaid.
>
> Stand: sessie 60 draaide autonoom en heeft NIETS gemerged en GEEN CODE gedeployd — PR 77 staat open op
> mijn review, **9 commits** (#176, de #132-doc-pin, een CI-fix, en de close-outs). Backend 1562/103, web
> 453/42, benchmark 14/14 + 6/6 + 0, productie 200/200/200. Wél live: de twee CBS-syncs (dat is data, geen
> deploy). Verifieer dit alles zelf — niet uit deze tekst overnemen; CI is groen op HEAD `79fff74`, en
> `a25f3e8` was rood-en-daarna-gefixt door `06f6209`.
>
> ⚠ TWEE DINGEN BLIJVEN VAN MIJ: de WP26-vlaggen UIT, en GDPR_PURGE_APPLY UIT tot ik hem zelf zet.
>
> Volgorde: (1) PR 77; (2) #191 — NIEUW, en het blokkeert de ANSWER_FIRST-flip: de reply-beurt krijgt die
> vlag nooit terwijl z'n eigen type hem declareert, en de vraag is niet "doorgeven" maar of een reply-beurt
> hoort te defaulten zoals de eerste beurt; (3) de WP26-livegang, #191 eerst; (4) GDPR_PURGE_APPLY;
> (5) #132 route B; (6) #192 — de escape hatch kan een release-sync niet afmaken (kleine ingestion-fix);
> (7) #193 — CBS herzag 1.103 al-`Definitief` cijfers tot 2015 terug; wat mag "Definitief" nog impliceren?
> Dat is een product/copy-keuze van jou, drie opties staan in de rij. Er staan ook DRIE Dependabot-PR's open
> (#80/#81/#82) die tijdens de pauze binnenkwamen.
> De ~30/7-syncs zijn op 7/8 GEDRAAID en live — daar hoef je niets meer aan te doen.
> Houd #174, #185, #183, #188 en #190(a) expliciet aan.
>
> Harde grenzen: ben ik er niet bij, dan branch + PR + mijn review vóór de merge (#118(b)) — vraag het of
> ga daarvan uit, een uitzondering geldt nooit automatisch opnieuw. Verder: volledig verificatieblok plus
> een review-pas over je eigen diff vóór elke push, nul promptbytes, geen live DDL, geen gestapelde deploys
> (#173). Architectuur en diepe analyse naar Fable-agents, mechanisch legwork naar Sonnet/Haiku.
> ⚠ Valideer elke `.yml`-wijziging met yaml.safe_load vóór je pusht — een niet-gequote dubbele punt liet
> CI in 0 s falen zonder dat iets lokaals het zag. ⚠ Bij elke rebase/cherry-pick: `--cleanup=whitespace`.
>
> Sluit af met het volledige wrap-up-ritueel.
