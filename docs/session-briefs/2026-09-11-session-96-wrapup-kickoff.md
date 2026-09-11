# Session 96 wrap-up kickoff — where the next session actually starts (written 2026-09-11, owner present)

> **PARTIALLY SUPERSEDED as the primary entry point** by
> [session-97-journey-programme-kickoff.md](2026-09-11-session-97-journey-programme-kickoff.md) (written
> later the same day, after the owner's explicit "work for hours, move the project big steps" mandate) —
> that file is now what STATUS.md's top block points to. This file's own PR #9/#13 status tracking and the
> #239 numbering-collision note below are still accurate background, just read the journey-programme
> kickoff first for the actual task.

Read in this order: [CLAUDE.md](../../CLAUDE.md) → [STATUS.md](../STATUS.md) top block (verify every fact
below against reality first — the Golden Rule — before repeating any of it to the owner) →
[08-build-plan.md](../08-build-plan.md) → this file.

## Why this file exists

Session 96 ran long: PR #9 merge-conflict work, five experience-improvement-plan quick wins, a
parallel-session discovery (Thread A/B), a full wrap-up — then the owner asked to continue Story-mode
visual work "in a fresh session," but no new session actually started; the same conversation kept going.
That work shipped as **PR #13**. This file is the real handoff point, written after all of it, superseding
[2026-09-11-story-mode-visual-polish-kickoff.md](2026-09-11-story-mode-visual-polish-kickoff.md) (now
historical — read the banner at its top) and complementing (not replacing)
[2026-09-11-session-97-kickoff.md](2026-09-11-session-97-kickoff.md) (Thread B's own handoff, still live).

## Two open PRs — verify state fresh, don't trust this file's numbers past their timestamp

- **PR #9** (`Stefan7168/checkdecijfers#9`, embed, ADR 041, branch `embed-charts`) — last confirmed via the
  GitHub API at 2026-09-11T11:45:54Z: `mergeable_state: "clean"`, `gate` PASS. Waiting on the owner
  (`EMBED_TOKEN_SECRET` + review), not on any session action. A `send_later` check-in
  (`trig_01HBFeL8Xiz2GRXKo2SRV17z`, next fire ~2026-09-11T15:14 UTC) is armed — re-verify it actually fired
  and re-armed, don't assume.
- **PR #13** (`Stefan7168/checkdecijfers#13`, Story stage motion/atmosphere upgrade, ADR 044's addendum,
  branch `visual-story-motion`) — opened 2026-09-11T13:42:05Z, head `9407440`. **CI (`gate`) CONFIRMED
  PASS** (`conclusion: "success"`, completed `2026-09-11T13:53:42Z`, ~11.5 min run), `mergeable_state:
  "clean"` — green and mergeable as of the end of this session, waiting on the owner's review, not on any
  further session action. A `subscribe_pr_activity` subscription stays active for any later review comment
  or conflict. This PR was opened and is driven by this session per CLAUDE.md's PR rules: **do not leave it
  unaddressed** if a future check finds CI red or an unresolved review thread — push a fix, or say once
  what's blocking, per the
  drive-to-green rules. If it's green and mergeable, it's simply waiting on the owner's review from there.

## What's tracked but not started

- **Journey programme** (Thread B's own plan, [08-build-plan.md § Journey programme](../08-build-plan.md),
  [open-questions #238](../open-questions.md)) — Phase 0 (apply migration 028, build the usage report,
  decide the audit re-run) is the first real step. Phase 1 is already done (the quick wins,
  [#239](../open-questions.md) on this branch). **R3 (the money-path confirm-before-fetch chip) needs an
  explicit owner go before any build** — never assume it.
- **Repositioning/ICP** ([#237](../open-questions.md)) — needs the owner in the chat; not a build task yet.
- **Further Story-mode visual work**, if the owner wants more after seeing PR #13 — the original kickoff
  doc (now historical, see its banner) still lists concrete starting points (ADR 044's own revisit
  triggers: no true multi-layer parallax was attempted, ruled architecturally impractical against Recharts'
  single-SVG render; native scroll-driven CSS is a re-check-later, not a now — Firefox stable still lacks it
  as of Firefox 152).

## A doc-consistency note for whoever picks this up

`docs/open-questions.md` row **#239 means two different things** depending on which branch you're reading
from: on `claude/checkdecijfers-embed-pr-review-acbrd5` (this branch) it's the experience-improvement-plan
quick wins; on `visual-story-motion`/PR #13 it's the Story-stage motion upgrade. This is the same
"two branches independently number a new row the same way" collision that recurred repeatedly this
session — resolve it exactly the same way when either branch reaches `main`: keep whichever side merges
first, renumber the other, add a cross-reference both ways. Row **#240** on this branch already
cross-references PR #13's work as a placeholder for this.

## Binding constraints, unchanged from earlier this session

- Owner-present work: push/merge directly to `main` after the full verification block, no per-change
  approval needed. Autonomous/unattended multi-hour work (task chips, overnight runs, and — per this
  session's own precedent — "spawn multiple agents for hours" even when kicked off by the owner in chat):
  **branch + PR, never direct to `main`** (#118(b)).
- Full verification block before any push: root + web typecheck, both test suites, hermetic benchmark
  (14/14 + 6/6 + 0 fabricated, or the equivalent 28/28 framing), real `next build`, `test:docs`, and a LOW
  `/code-review` pass with findings fixed or consciously dispatched.
- Cheapest viable mechanism first — no AI call, no schema change, no new library — escalate only on
  measured evidence.

## Golden Rule reminder

Every date, PR#, SHA, test count, and "green"/"merged"/"waiting" word in this file was verified against
the GitHub API or a real command output at write time (2026-09-11, ~13:52 UTC) — but time has passed by
the time you read it. Re-verify before repeating any of it to the owner.
