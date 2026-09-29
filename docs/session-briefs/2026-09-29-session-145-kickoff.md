# Session 145 kickoff (written 2026-09-29, end of session 144 — the gate passed, the rebrand applied)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file. Verify every claim against `git log`,
`gh run list --branch main -L 5`, `gh pr list` and prod (`curl -sI https://checkdecijfers.vercel.app/`) before acting.

## Where things stand

- **The Look is complete.** All three gate parts plus the share picture have the owner's sign-off (ADR 063; #346, #351).
  The homepage leads with a real chart; the Edit popup is fixed-height with a pinned footer; the share picture renders
  in Inter with readable labels and follows the reader's form; the gallery no longer cold-starts (#347).
- **The product is called graphmaker.studio** everywhere a reader looks (ADR 064). The address is still
  `checkdecijfers.vercel.app`: `graphmaker.studio` + `www` are added to the Vercel project, the two Cloudflare A records
  (→ 76.76.21.21, proxy off) are the owner's step (RUNBOOK "Wiring graphmaker.studio"). When they exist: `vercel domains
  inspect graphmaker.studio` → then, owner present, switch `NEXT_PUBLIC_APP_URL` in `web/.env.production` and push.
- **Launch:** deferred by the owner twice on 2026-09-29 (#352). Do not raise it again before 2026-10-27 unless the owner does.
- **Spend:** the $50 roof resets 2026-10-01; session 144 spent nothing.

## Start by asking ONE question (everything inside the dialog)

Which of these the owner wants, with the recommendation first:
1. **Breadth (recommended — the owner's own priority before The Look, #335):** apply migrations 037 + 038 on the live
   database (additive; owner present, `npm run db:migrate`, RUNBOOK "Table lane (breadth step 5)"), then — on or after
   2026-10-01 — the recording + calibration run (#338, ~114k input tokens, cheap tier), step 6's benchmark, the flip.
2. **Domain:** if the owner has set the DNS records, verify and switch the address (15 minutes, owner present).
3. **SEO landing pages (#353)** — only after the domain is live; static, LLM-free, on the gallery pipeline.
4. Regional statistics Part 2 (branch `regional-stats-part2`), Eurostat E2a steps 0/5/6 (#313), Pro plan, brand colours.

## Standing constraints

Principles (a)/(b)/(c). Verification block (typechecks with the FULL error list — never `head` a gate; all suites;
benchmark 14/14 + 6/6 + 0 fabricated; real build) + e2e smoke (`cd web && npx playwright test e2e/cbs-copilot.spec.ts
e2e/chart-copilot.spec.ts e2e/landing.spec.ts`) + `/code-review` LOW + green CI before every push; no prompt bytes
(the seven prompts still say checkdecijfers.nl on purpose — rename at the next recording run), no AI spend without the
owner, no DDL without the owner. Never `gh secret set`, never `spawn_task`. Repo is PUBLIC ("Competitor G"/"Competitor
L"). Owner present: push directly (#118); autonomous: branch + PR, merged on a plain-English GO. Plain English to the
owner; everything the owner must read goes INSIDE the question dialog. Owner-facing screenshots: Playwright against the
running harness (`preview_start` name `harness`, `PLAYWRIGHT_MODULE=$PWD/node_modules/playwright/index.mjs` from `web/`).
`next dev`/`next build` rewrite `web/CLAUDE.md` — `git checkout -- web/CLAUDE.md` before every commit.

## Tracked, not the focus

#349 white-glove service (parked); #350 flake (watch); ESLint tooling break (CI does not lint); the share picture's
remaining fallback: forms other than line/area/bar draw as the line (stated in `previewFormFor`); a graphmaker mailbox +
Resend sender domain and the Supabase auth domain (#7).
