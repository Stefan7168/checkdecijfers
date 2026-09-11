# Session 96 kickoff — paste this to start (written 2026-09-11 at the end of session 95, autonomous; refreshed after phase 3)

Continue checkdecijfers.nl. Read, in order: CLAUDE.md → docs/STATUS.md (top block) → this file →
docs/08-build-plan.md § "Visual upgrade programme" → ADR 042/043/044.

## Where things stand (verified when written — re-verify, don't trust)

- **The whole overnight visual-upgrade programme is BUILT, in three stacked pull requests, none merged,
  none live:**
  - **PR #10** — phase 1, the designed default chart look (ADR 042), branch `visual-designed-default`
    from `main` `e2d5039`, base `main`. CI gate PASS.
  - **PR #11** — phase 2, templates v1 (ADR 043), branch `visual-templates-v1`, base =
    `visual-designed-default`. CI gate PASS.
  - **PR #12** — phase 3, the Story stage (ADR 044), branch `visual-story-stage`, base =
    `visual-templates-v1`. CI was pending when this was written: `gh pr checks 12`.
  Merge order: #10 → #11 → #12 (each PR's base is the previous branch; after #10 merges, retarget #11
  to `main` — GitHub does this automatically for stacked PRs when the base branch is deleted on merge —
  then #12 the same way).
- **PR #9** — Embed (branch `embed-charts`), still open, older than the three above. It edits
  `chart.tsx` and the tracker docs (STATUS, status-archive, open-questions, lessons-learned,
  08-build-plan) too. Whichever merges second will conflict; resolve with the session-94 playbook
  (combine both sides' additions; where the same item was rewritten on both, keep the more accurate
  wording). Don't let it stall you.
- **Owner steps still pending, unchanged:** migrations 028 + 029 (`npm run db:migrate`), optional
  `BRANDFETCH_API_KEY`. The usage counter records nothing until 028 is applied — every "escalate on
  measured evidence" step stays blind; do not apply them yourself (live DDL is owner-supervised).

## The single next priority: the owner's review of PRs #10 → #11 → #12

Everything is built and verified — including the real-browser re-check of the stage on the final code
(session 95 ran it at the very end after diagnosing the hidden pane; ADR 044's as-built addendum lists
what was checked and the two things that were not: classic always-visible scrollbars, and smooth-scroll
motion itself, which a hidden tab does not animate). If you have a visible browser, those two are a
five-minute check worth doing on `visual-story-stage`. Otherwise: verify `gh pr checks 10 11 12` are
green, fix anything red on the same branch (branch + PR rule below), and leave the merging to the owner
(never merge in an autonomous session).

When the owner merges: #10 first (base `main`), then #11 (retarget to `main` if GitHub did not do it
automatically), then #12. PR #9 will conflict with whichever merges second — the session-94 playbook.

## If there is time after that ("if you finish everything", from the owner's overnight kickoff)

In this order, each as its own branch + PR, nothing that needs a library, a schema change or LLM spend:
native scroll-driven CSS where it simplifies the stage hook; a WRITTEN proposal for the 3D-map idea
(never a build); the homepage template strip. See 08-build-plan § "Visual upgrade programme".

## Binding constraints and steers (from the owner's overnight kickoff — still in force)

- **Branch + PR, never push to `main`** in an autonomous session (CLAUDE.md #118(b)). Stack on
  `visual-story-stage` while PR #12 is open, otherwise branch from `main`.
- **Zero new libraries** (no GSAP, no Three.js, no motion library). No schema change, no prompt byte,
  no LLM spend.
- **Honesty invariants R1/R6/R11 in every phase:** no numeric text in a card or the stage that is not
  a spec string; the hollow/hatched provisional marker is never hidden; transforms only on wrappers
  outside the exported `<svg>`; no CSS `aspect-ratio`; no Recharts animation.
- **"3D" = depth/tilt/motion around a FLAT chart.** Never 3D marks; the 3D municipality map is a
  written proposal at most.
- **Cheapest mechanism first** (CLAUDE.md); model tiers by role (cheap implementers, top-tier review of
  anything touching `chart.tsx` or the honesty scans; the whole-branch review on the most capable tier).
- **The full verification block before every push:** both typechecks, web suite, backend suite (solo —
  the 8 GB machine OOM-kills it beside agents; exclude `tests/docs` while docs are being edited and run
  `test:docs` after), hermetic benchmark 14/14 + 6/6 + 0 fabricated, real `next build`, `/code-review`
  LOW with every finding fixed or dispatched — it found a real bug in session 95 after three review
  seats had passed the code. **Never overlap the chain's `next build` with an implementer's RED step**
  (a test importing a not-yet-existing module fails the build's typecheck).
- **Run the browser pass EARLY in a phase and again right after the fix wave** — the hidden pane
  degrades over a long session (session 95 lesson). The synthetic `resize` trick only fixes the
  "Recharts never measured" mode, not the "no layout at all" mode.
- **Screenshots for a PR:** rasterise the live chart `<svg>` (from `javascript_tool`) with `sharp`
  (already in `web/node_modules`), replacing `var(--…)` with the light-theme hexes; commit the PNGs under
  `docs/session-briefs/assets/` and link them as `blob/<branch>/…?raw=true` in the PR body.

## Tracked, not the focus

- open-questions #232 (ADR 042 calls the owner can veto), #233 (a saved account default keeps the old
  geometry until reset), #234 (ADR 042 residuals), #235 (ADR 043 calls), #236 (ADR 044 calls — every
  item defaults to "as built", the owner vetoes by exception).
- ADR 044's "Parked" list (rects read while tilted; `readSpot` re-renders per resize tick; the short
  desktop entry ramp; the compact observer can snap the step on CLOSE reflow; scrollbar-thumb drags
  don't stop auto-play).
- The attachments chart (`UserChartView`) keeps classic geometry with the new palette — deliberate
  (ADR 037 H2); align later if the owner wants.
- STATUS.md is still the multi-session dump session 94 flagged; a future session should migrate the
  session-92-and-older blocks into status-archive.md.
- PR #9's own residuals live in its body and in open-questions #224–#231.
