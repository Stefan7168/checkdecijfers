# Session 155 kickoff (written 2026-10-04, at the session-154 wrap)

**Reading order:** CLAUDE.md → docs/STATUS.md top block (THE PLOT + "NEXT SESSION STARTS HERE") → this file. Verify every
fact below against `git log` / `gh run list` before trusting it.

## Where things stand (verified at wrap: `main` @ `3e9679c3` + the wrap docs commit; every code commit green in CI incl.
deploy; prod `checkdecijfers.vercel.app` 200)

- **CBS and Eurostat any-table routes are LIVE.** `TABLE_LANE_ENABLED=1` (since 2026-10-01), `EUROSTAT_FINDER_ENABLED=1`
  (since 2026-10-04). The live table index holds 4,858 CBS + 7,561 Eurostat datasets (Eurostat loaded by hand with
  `npm run catalog:refresh -- --source eurostat`; monthly maintenance step, RUNBOOK).
- Public wording names CBS and Eurostat everywhere (owner-signed); Eurostat has its own source chip (CBS only /
  Eurostat only / both; the search follows the choice).
- Live read-only probe (`scripts/eurostat-live-probe.ts`): 9 Dutch Eurostat questions → 5 answered, 5/5 match
  Eurostat's own API, 0 wrong numbers. The owner's own live question (Poland road deaths 2023) answered 1.893 = Eurostat.
- AI spend session 154 ≈ $5–6 of the $50 monthly roof.

## The owner's mood — read this first

The owner said he is getting sceptical about the app ("ik begin echt sceptisch te worden"), after the first live
Eurostat question was refused (the Eurostat index had never been loaded — our miss). He also asked why we keep a table
index when ChatGPT "just fetches it" (answer given: the index is the library's card catalogue, names only; we fetch the
numbers live and can prove the cell; ChatGPT cannot). He said "decide nothing, just continue" mid-session.

**Start by asking him what he wants.** Recommendation, if he leaves it to you: an honest side-by-side of ~10 everyday
questions (CBS + Eurostat) against ChatGPT — where we are better (proven cell, source, date, refusal over guess) and where
worse (breadth of phrasing, speed, button questions). Present it plainly; one committed recommendation after it.

## Open items (owner picks; none decided)

1. **English measure titles inside Dutch answer sentences** — e.g. "Youth unemployment rate - % of active population
   aged 15-24 — % van de beroepsbevolking in Spanje was in 2023 28,7%". Most visible Eurostat quality issue (every
   Eurostat answer). Cheapest mechanism first (no AI).
2. **Button questions a reader finds awkward:** `une_rt_a` asks the age group (7 options; no age total, Eurostat's
   headline is 15–74 — is a default honest?); `gov_10dd_ggd` asks "Counterpart sector" (14 options; the total-like
   member is not taken as default).
3. **Danish municipal waste per inhabitant** → the finder picked `ten00110` (tonnes, possibly frozen); `cei_pc031` (per
   capita) exists. A ranking question, not per-table curation (THE PLOT).
4. **Daily refresh of the Eurostat index** (proposed, not decided; the current upsert is row by row, ~30 min — too slow
   for the cron as is).

## Binding constraints

- THE PLOT: the layer, never curating single tables (CLAUDE.md "Breadth comes from the layer").
- Principles (a)/(b)/(c); a fabricated number is the worst bug.
- Live DDL, real LLM spend and env-flag flips stay owner-supervised. Owner-present: push to `main` directly after the full
  verification block + `/code-review` LOW + green CI (#118). Autonomous sessions: branch + PR.
- A validator change needs `npm run audit:verify -- 1 <max id>` before and after (byte-identical, or pin per #133).
- Before switching anything on: count the production rows it depends on (session-154 lesson).

## Machine note

Shared with the sibling project; run `scripts/verify-block.sh` detached and wait on `=== DONE` (RUNBOOK §verification).

## Tracked, not the focus

- #359: older audit rows no longer re-derive since the rebrand (269/313 clean over 1–349; pin as one documented divergence).
- Dependabot PRs #50–#55 open.
- Workspace redesign: a Claude Design mockup was rejected; if it returns, start from the live screen + one question on
  what bothers him.
