# Session 146 kickoff (written 2026-09-29, end of session 145)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file. Verify every claim against `git log`,
`gh run list --branch main -L 5`, `gh pr list` and prod (`curl -sI https://checkdecijfers.vercel.app/`) before acting.

## Where things stand

- **Breadth is back on and its migrations are live.** 037 + 038 applied on the live database in session 145 (verified
  read-only). Nothing reaches readers yet: `TABLE_LANE_ENABLED` is unset and the table parser has never called the AI.
- **The next step is the 1 October recording run**, fully planned: [2026-10-01-recording-run-plan.md](2026-10-01-recording-run-plan.md)
  — A table parser (39 cases, ~114K tokens) → B regional Part 2 (branch `regional-stats-part2`, re-record intent/clarify/
  follow-up, merge, prod load of `70072ned`) → C Eurostat step 0 (~10 country questions). ~$4.35 budget; the $50 roof
  resets 2026-10-01 00:00 UTC (02:00 CEST). Three owner decisions are listed in the plan — ask them in ONE dialog first.
- **SEO page `/netherlands-cbs-data` is live but noindex** (#353). The switch `SEO_PAGES_INDEXABLE` flips only after the
  graphmaker.studio domain is wired (RUNBOOK "Wiring graphmaker.studio" steps 1–3, then "SEO landing pages").
- **Domain:** Cloudflare A records are the owner's step; none existed on 2026-09-29. `cd web && vercel domains inspect
  graphmaker.studio` tells you. Address switch = `NEXT_PUBLIC_APP_URL` in `web/.env.production`, owner present.
- **Launch:** deferred twice by the owner (#352). Do not raise before 2026-10-27 unless the owner does.
- **Brand colours / Pro plan:** built, off, owner account steps only (RUNBOOK); owner said "neither today" — do not push.

## Start by asking ONE question (everything inside the dialog)

If today is on/after 2026-10-01 and the owner is present: **run the recording plan** — put its three decisions and the
budget in the dialog and ask for the GO. If before 2026-10-01: the domain (only if DNS exists), else the Eurostat page
cannot be built (no curated series), else offer the parked owner steps or a wrap.

## Standing constraints

Principles (a)/(b)/(c). Verification block (typechecks with the FULL error list — never `head` a gate; all suites;
benchmark 14/14 + 6/6 + 0 fabricated; real build) + e2e smoke + `/code-review` LOW + green CI before every push. No
prompt bytes except the two renames the plan lists (owner GO), no AI spend without the owner, no DDL without the owner.
Never `gh secret set`, never `spawn_task`. Repo is PUBLIC ("Competitor G"/"Competitor L"). Owner present: push directly
(#118); autonomous: branch + PR, merged on a plain-English GO. Plain English; everything the owner must read goes INSIDE
the question dialog. `next build`/the e2e leg rewrite `web/CLAUDE.md` — `git checkout -- web/CLAUDE.md` before every
commit. The verification block's e2e leg leaves the dev harness on port 3102; navigate the browser pane there directly.
Owner-facing screenshots: Playwright against that harness (`PLAYWRIGHT_MODULE=$PWD/node_modules/playwright/index.mjs`
from `web/`).

## Tracked, not the focus

#349 white-glove service (parked); #350 flake (watch); ESLint tooling break (CI does not lint); the share picture's
line-fallback for other forms; a graphmaker mailbox + Resend sender domain and the Supabase auth domain (#7); the eight
prompts that keep "checkdecijfers.nl" until a full re-record is budgeted (ADR 064).
