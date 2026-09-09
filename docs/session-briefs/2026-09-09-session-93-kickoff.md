# Session 93 kickoff — paste this as the first message of the next session

Written 2026-09-09 at the end of session 92 (owner present all day). Every fact verified against `git log`,
`gh run view` and `curl` at the time of writing. Read in this order: `CLAUDE.md` → `docs/STATUS.md` (top
block) → this file → `docs/status-archive.md` (session-92 entry, top) → `docs/lessons-learned.md`
(session-92 entries) → `docs/superpowers/specs/2026-09-09-story-mode-and-embed-design.md` (Part B is the
work; Parts A and C are built) → ADR 039 (both session-92 addenda) + ADR 040.

## What is true right now (verified 2026-09-09)

- `main` = `1f13e78` (after the Playwright battle test's six aspect-ratio fixes, `e18c01f`…`1f13e78`), clean,
  pushed; CI `34379480807` gate + deploy green; `/api/health` `{"ok":true}`.
- LIVE since session 92: Story mode, the chat polish batch (eight owner asks), frame styling + the
  floating Style panel, the chart-language select preselecting the current language.
- Verified before the last merge: typecheck ×2, web 1275/1275 (87 files), backend 2198/2198 (solo),
  benchmark 28/28, real `next build`, docs 11/11, `/code-review` LOW 0 findings.
- CHECKED with Playwright on production (public homepage charts, desktop + 375 px): story panel, floating
  Style panel, Frame tab, gradient + own-image exports (PNG/SVG), aspect ratio (now exact, no overflow).
  Still worth a human glance in dark mode. Follow-up: the exported attribution line is single-line and
  can be cut off on a narrow chart (pre-existing).
- Previously NOT checked interactively on production (the owner's Chrome had no chart thread; the Browser
  pane never hydrates the chart subtree): the story panel, the floating Style panel, the Frame tab, and
  the aspect-ratio sizing at a phone width. Do this first, with the owner, on a chart answer.

## Do first
-1. **Alert 2026-09-09 22:44 (audit row 302):** the main Anthropic key hit its monthly usage cap ("regain access on
   2026-10-01") — every model question refuses honestly and emails the owner. Owner step: raise the cap in the
   Anthropic console or wait for 1 October. ALSO check: that question came from a follow-up chip (a zero-LLM click
   take) yet reached the model — sent via a scripted chip click + Send in the owner's Chrome; verify the click-take
   carrier path still fires for a chip clicked by a real user before assuming a regression.
0. A dark-mode glance on production (the Playwright pass ran in light).
1. **Embed (spec Part B)** — the single next build: `superpowers:writing-plans` → SDD. Owner-set at
   go-live (never by the session): `EMBED_TOKEN_SECRET` (a long random string, Vercel, Sensitive) and
   optionally `PRO_ACCOUNT_EMAILS` (the Pro demo switch, comma-separated); RUNBOOK rows + a go-live section.

## Owner steps still pending (do not decide these for him)
- Migrations 028 + 029 (`npm run db:migrate`, RUNBOOK § WP218 go-live). Optional `BRANDFETCH_API_KEY`.
- WP202a go-live steps 2–6 (RUNBOOK § WP202).

## Rules that bind
- Plain English for everything owner-facing; show UI questions as inline mock-ups (session-92 lesson).
- #118: owner present → direct push to `main` after the full verification block; autonomous → branch + PR.
  Live DDL, outside-service keys, env flags and real spend stay owner-supervised; never `gh secret set`.
- Docs never contain "PR #<n>". Backend suite solo (~35 min, OOM beside agents). Dispatch prompts for fix
  rounds must say "do the edits yourself, no subagents, no backgrounding" (session-92 lesson) and check
  `git log` before re-dispatching. Every model constant is Haiku.

## Tracked, not focus
- #222 dark-mode exports low-contrast (pre-existing). Three gradient presets refuse on the stock palette
  (shown disabled — a preset re-tune is a design call). `chart.tsx` ~2 600 lines — the `<ChartAxes>`
  extraction is the next refactor there. Story follow-ups: zoomed steps, story in the embed.
