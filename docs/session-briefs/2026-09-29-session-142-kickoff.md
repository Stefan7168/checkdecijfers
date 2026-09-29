# Session 142 kickoff (written 2026-09-29 local, end of session 141 — the vision review)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file. Verify every claim against `git log`,
`gh run list --branch main -L 3`, `gh pr list` and prod (`curl https://checkdecijfers.vercel.app/`) before acting on it.

## Where things stand

- **Direction changed on 2026-09-29 (owner vision interview, session 141, ADR 063).** ONE product: a beautiful,
  sourced chart of official Dutch and European statistics, for anyone who has to publish a number. Ask a question, see
  the chart. ONE Edit button → ONE popup with ALL editing. Nothing removed, everything tidied. Competitor G is the
  simplicity reference, not a template. Read `docs/session-briefs/2026-09-29-vision-vs-build-review.md` (the honest
  review) and `docs/decisions/063-chart-first-refocus-look-is-the-gate.md` (the five owner answers) before touching UI.
- **The gate:** the owner says "I would share this" about (a) the answer chart, (b) the Edit popup, (c) the homepage.
  Then the owner invites people. Record each sign-off with its date in open-questions #346.
- **`main`:** the table-lane step-5 branch (`breadth-step-5`, 17 commits) was merged DARK to `main` in session 140 (`763b91e7`, CI 36518156649) with
  the full verification block; see the session-140 entry in `docs/status-archive.md`. Everything
  else built-but-dark (Pro plan, Eurostat, brand colours, regional Part 2 on its branch) is PAUSED until the gate.
- **Spend:** the $50 monthly roof resets 2026-10-01. The Look needs no AI spend.

## Next: WP-LOOK part (a) — the answer chart (docs/08-build-plan.md, "WP-LOOK")

1. **Load the design skills first** (interface design, data-visualisation, component-library guidance) — a required
   step. Then look at the live gallery (`https://checkdecijfers.vercel.app/galerij`, reload once if it shows
   placeholders) and at Competitor G side by side, and write down in one paragraph what "finished untouched" means for
   our card before editing anything.
2. **Brainstorm with the owner ONLY on what is genuinely theirs** (the decisions in ADR 063 are taken: keep everything,
   one Edit button, one popup). Show mockups as screenshots or an artifact; the owner cannot see text above a question
   dialog, so put everything needed inside the question or in a sent file.
3. **Build part (a)** in `web/components/chart.tsx` (4,847 lines — the card's own JSX) and the chat card in
   `web/components/chat.tsx`: headline, one number, chart as hero (70 %+), one source line, Edit / Download / Share.
   Move the form tabs, period dropdowns, undo/redo/history, Insights, goal lines, period ranges, notes/caption, derived
   overlays and the co-pilot input into `web/components/chart-edit-modal.tsx` (the existing popup shell). Keep the "not
   CBS data" marking visible wherever an annotation renders. Light AND dark must look finished.
4. **Show the owner screenshots next to Competitor G** after every iteration; stop when they say "I would share this".
   Then part (b) the popup, then part (c) the homepage + the gallery cold start (#347).

## Standing constraints

Principles (a)/(b)/(c) — presentation only, every number still from the stored envelope. Verification block +
`/code-review` LOW + green CI before every push; no prompt bytes, no AI spend, no DDL. Never `gh secret set`, never
`spawn_task`. Repo is PUBLIC (never name Competitor G in repo docs). Owner present: push directly (#118); autonomous:
branch + PR, merged on a plain-English GO. Plain English to the owner, no shorthand.

## Tracked, not the focus

Breadth step 6 / `TABLE_LANE_ENABLED` (needs migrations 037 + 038 and the recording run after 10-01), regional Part 2,
Eurostat E2a (#313), Pro plan, #245, #275, #328, #330 — all paused by ADR 063 until the gate.
