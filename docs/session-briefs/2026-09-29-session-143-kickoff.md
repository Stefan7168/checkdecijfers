# Session 143 kickoff (written 2026-09-29 local, end of session 142 — WP-LOOK part (a), round 1)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file. Verify every claim against `git log`,
`gh run list --branch main -L 3`, `gh pr list` and prod (`curl https://checkdecijfers.vercel.app/`) before acting on it.

## Where things stand

- **Direction (ADR 063, session 141):** ONE product = a sourced chart of official statistics; ONE Edit button → ONE popup
  with ALL editing; nothing removed; gate = the owner says "I would share this" for (a) chart, (b) popup, (c) homepage.
- **Part (a), round 1, is on `main` (session 142: `14e1687a`, then `298d4d80` for the e2e smoke + popup scroll; CI 36529117701 green incl. deploy):** the card is title → headline / big number → chart → caveats →
  source line → one action row **Edit · Download · Embed · Share · Insights** (the owner's own five, open-questions
  #346). Every control moved into the popup (`web/components/chart.tsx`, `chart-edit-modal.tsx`); the popup opens in
  table form too; the caption / notes / goal-line / period-range strips show on the card only when they hold content;
  Share copies a link to the public embed page (`web/components/chart-share-button.tsx`, same signed token as Embed).
  Verified in the hermetic harness at desktop dark + light and phone width; screenshots were sent to the owner.
- **Waiting on the owner:** their reaction to those screenshots. Either "I would share this" → record the date in #346
  and start part (b), or change requests → iterate part (a) (screenshots after every round).
- **Spend:** the $50 monthly roof resets 2026-10-01. The Look needs no AI spend.

## Next

1. If the owner reacted: act on it (see above). If not: ask, inside ONE question dialog with the four screenshots'
   content described in words (the owner cannot see text above a dialog), whether part (a) is "I would share this".
2. **Part (b), the popup**, once (a) is signed off: load the design skills first (interface design, data-visualisation,
   component library). The popup today is functional, not designed: a "Chart" section (undo/redo, form tabs, reading,
   period, overlays, small multiples, headline draft), a "Style" section (the old Style panel, absent in table form),
   the Download/Embed footer and the co-pilot input, with the live chart + annotation strips on the left. The owner
   chose to decide its shape when they see it (the six-tab + live-preview mockup at
   https://claude.ai/artifact/46r9SfvfnLgXkxGYxR8Qzk is a proposal, not a decision). Fix #348 there (roving tabindex on
   the plot so Edit is one Tab away).
3. Then part (c): homepage chart above the fold + the gallery cold start (#347).

## How to look at it locally (zero spend, no production)

`preview_start` name `harness` → open `http://localhost:3102` → set the cookie from
`scripts/dev-harness/session-cookie.json` via `document.cookie` (RUNBOOK § "Local real-browser harness", session-137
note) → ask "Hoe ontwikkelde de inflatie zich per jaar van 2020 t/m 2024?" → the card sits in the right-hand dock at
desktop width, in-flow at phone width. HMR shows edits live; `resize_window` gives phone / dark / light.

## Standing constraints

Principles (a)/(b)/(c) — presentation only, every number still from the stored envelope. Verification block +
`/code-review` LOW + green CI before every push; no prompt bytes, no AI spend, no DDL. Never `gh secret set`, never
`spawn_task`. Repo is PUBLIC (never name Competitor G in repo docs). Owner present: push directly (#118); autonomous:
branch + PR, merged on a plain-English GO. Plain English to the owner, no shorthand.

## Tracked, not the focus

Breadth step 6 / `TABLE_LANE_ENABLED` (needs migrations 037 + 038 and the recording run after 10-01), regional Part 2,
Eurostat E2a (#313), Pro plan, #245, #275, #328, #330 — all paused by ADR 063 until the gate. #348 (keyboard cost of the
action row) is part (b)'s.
