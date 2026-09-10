# Session 96 kickoff — paste this to start (written 2026-09-11 at the end of session 95, autonomous)

Continue checkdecijfers.nl. Read, in order: CLAUDE.md → docs/STATUS.md (top block) → this file →
docs/08-build-plan.md § "Visual upgrade programme" → the phase plan you are executing.

## Where things stand (verified when written — re-verify, don't trust)

- **PR #10** — visual upgrade phase 1, the designed default chart look (ADR 042), branch
  `visual-designed-default` from `main` `e2d5039`, 13 commits `7db14fd..bf5cf44`. Open for the owner's
  review; **not merged, not live**. CI was pending when this was written: `gh pr checks 10`.
- **PR #9** — Embed (branch `embed-charts`), still open. PR #9 and PR #10 both edit `chart.tsx` and the
  tracker docs (STATUS, status-archive, open-questions, lessons-learned, 08-build-plan). Whichever merges
  second will conflict; resolve with the session-94 playbook (combine both sides' additions; where the
  same item was rewritten on both, keep the more accurate wording). Don't let it stall you.
- **Phase 2 — templates v1** has a complete plan:
  `docs/superpowers/plans/2026-09-11-chart-templates-v1.md`. If session 95 ran out of hours before
  building it, it is the next thing to build; if a branch `visual-templates-v1` / a PR #11 already
  exists, read STATUS.md's top block first — it is the plan of record over this file.
- **Phase 3 — the Story stage** (plan §3 of `docs/session-briefs/2026-09-10-visual-next-level-plan.md`)
  follows phase 2. Needs its own plan (`superpowers:writing-plans`) before code.
- **Owner steps still pending, unchanged:** migrations 028 + 029 (`npm run db:migrate`), optional
  `BRANDFETCH_API_KEY`. The usage counter records nothing until 028 is applied — every "escalate on
  measured evidence" step stays blind; do not apply them yourself (live DDL is owner-supervised).

## Binding constraints and steers (from the owner's overnight kickoff — still in force)

- **Branch + PR, never push to `main`** in an autonomous session (CLAUDE.md #118(b)). One PR per
  phase; stack phase 2 on `visual-designed-default` (base = that branch) if PR #10 is still open,
  otherwise branch from `main`.
- **Zero new libraries** (no GSAP, no Three.js, no motion library); Option A (CSS 3D + a scroll hook)
  for the stage. No schema change, no prompt byte, no LLM spend.
- **Honesty invariants R1/R6/R11 in every phase:** no numeric text in a card or the stage that is not
  a spec string; the hollow/hatched provisional marker is never hidden; transforms only on wrappers
  outside the exported `<svg>`; no CSS `aspect-ratio`; no Recharts animation.
- **"3D" = depth/tilt/parallax around a FLAT chart.** Never 3D marks; the 3D municipality map is a
  written proposal at most (only after everything else is done).
- **Templates v1 = looks only**; starter charts are v2. Auto-play off by default. Spotlight, no zoom.
- **Cheapest mechanism first** (CLAUDE.md); model tiers by role (cheap implementers, top-tier review of
  anything touching `chart.tsx` or the honesty scans; the whole-branch review on the most capable tier).
- **The full verification block before every push:** both typechecks, web suite, backend suite (solo —
  the 8 GB machine OOM-kills it beside agents; exclude `tests/docs` while docs are being edited and run
  `test:docs` after), hermetic benchmark 14/14 + 6/6 + 0 fabricated, real `next build`, `/code-review`
  LOW with every finding fixed or dispatched. A real-browser pass (the Browser pane + the `web-db` dev
  server; the hidden pane needs a synthetic `window.dispatchEvent(new Event('resize'))` before Recharts
  measures) for anything layout/motion-related.
- **Screenshots for the PR:** rasterise the live chart `<svg>` (from `javascript_tool`) with `sharp`
  (already in `web/node_modules`), replacing `var(--…)` with the light-theme hexes; commit the PNGs under
  `docs/session-briefs/assets/` and link them as `blob/<branch>/…?raw=true` in the PR body.

## Tracked, not the focus

- open-questions #232 (the ADR 042 calls the owner can veto), #233 (saved account default keeps the old
  geometry until reset), #234 (ADR 042 residuals: hook re-attach edge, one-frame stale width, the stale
  "portals into document.body" comment in `chart.tsx` ~2608).
- The attachments chart (`UserChartView`) keeps classic geometry with the new palette — deliberate
  (ADR 037 H2); align later if the owner wants.
- STATUS.md is still the multi-session dump session 94 flagged; a future session should migrate the
  session-92-and-older blocks into status-archive.md.
- PR #9's own residuals live in its body and in open-questions #224–#231.
