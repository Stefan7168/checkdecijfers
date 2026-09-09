# Session 92 kickoff — paste this as the first message of the next session

Written 2026-09-09 at the end of session 91 (autonomous). Every fact below was verified against
`git log`, `git status`, the test runs and `gh` at the time of writing — not recalled. Read in this
order before doing anything: `CLAUDE.md` → `docs/STATUS.md` (top block is the truth) → this file →
`docs/status-archive.md` (session-91 entry, top, 11 items) → `docs/lessons-learned.md` (session-91
entries, top) → `docs/RUNBOOK.md` § "WP218 chart styling — the supervised go-live" →
`docs/decisions/039-chart-presentation-panel.md` + `040-interface-language-switch.md`.

## What is true right now (verified 2026-09-09)

- Branch `wp218-chart-styling` holds the whole WP218 chart styling programme (phases 0–6), 41+
  commits on top of `main`'s `867393d`, opened as a pull request for the owner's review. `main` is
  unchanged since session 90. **Nothing of WP218 is merged or live.** Check `gh pr list` and
  `gh run list` first: if the PR is merged, the CI deploy of `main` has shipped the panel, the
  language switch and the new chart types; the account default, the counter and brand lookup stay
  dormant until the owner's steps below.
- Verification at the branch head (`eab25b6` when this was written): typecheck ×2 clean, web
  1121/1121, backend 2191/2191, benchmark suite 28/28, `next build` clean, docs test 11/11, Opus
  whole-branch review + fix round + re-review Approved, LOW-effort review pass 0 findings.
- Migrations `028_user_chart_styles.sql` and `029_brand_cache.sql` are FILE-ONLY; `BRANDFETCH_API_KEY`
  is not set anywhere. Every code path degrades honestly without them (no error pages).

## The owner's open items (do not decide these for him)

1. Merge the PR (owner-present sessions may push/merge directly — CLAUDE.md #118 revision).
2. Apply migrations 028 + 029 with `npm run db:migrate` (owner present; RUNBOOK § WP218 go-live has
   the verification queries and the smoke test).
3. Brandfetch: sign up + set the key only if he wants brand colours; the free tier is 100 lookups in
   TOTAL, then ≈ $99/month (re-check the pricing page); the endpoint path form is UNCONFIRMED without
   a key (one constant in `src/chart/brandfetch.ts`).
4. The three CI minute-saving changes proposed in chat (skip docs-only pushes, cancel superseded
   runs, no double run for PR branches) — he had not yet said "do it".
5. WP202a go-live steps 2–6 (RUNBOOK § WP202) remain pending from before.

## If the owner asks for changes to WP218

Work on the branch until it is merged (rebase on `main` first if `main` moved). The SDD ledger with
every task, review verdict and deferred minor is `.superpowers/sdd/progress.md` (git-ignored; if
gone, `git log 867393d..` and the plans in `docs/superpowers/plans/2026-09-09-wp218-phase-*.md`
are the map). Known, documented limitations to keep in mind (not bugs): backend prose stays Dutch on
an English chart; the citation stays Dutch; the definition toggle's label and the source badge follow
the app language, not the per-chart override; a PNG export cannot embed a web font (SVG can);
`chart.tsx` is ~2 300 lines with the grid/axis block written five times — the `<ChartAxes>`
extraction is the next refactor in that file, not urgent.

## Reminders

- Plain English for everything owner-facing (memory `feedback_plain_english_no_jargon`).
- Git workflow (#118): owner present → direct push after the full verification block; autonomous →
  branch + PR. Live DDL, outside-service keys, env flags and real spend stay owner-supervised; never
  run `gh secret set/delete` yourself.
- The backend suite takes ~35 minutes solo on this machine and is OOM-killed beside subagents; the
  dev server (`web-db`) must be restarted after new files appear under `src/` (Turbopack + the
  `web/backend` symlink); the Browser pane's clicks time out while it is hidden — drive checks
  through `javascript_tool`.
- Every model constant is Haiku; a tier change is a real decision, not a config edit.
