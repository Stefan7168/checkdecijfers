Session 90 kickoff — paste this as the first message

Written at the session-89 close-out, 2026-09-08. Durable copy of the handoff; the chat may be gone,
the repo is the source of truth. Every fact below was verified against `git log`, `gh run list`,
`curl` of production, `git status`, `git worktree list`, and `npm run test:docs` at the time of
writing — not recalled from memory.

Read in this order before doing anything: `CLAUDE.md` → `docs/STATUS.md` (the top block is the
truth) → this file → `docs/status-archive.md` (session-89 entry, top, 10 numbered items) →
`docs/lessons-learned.md` (session-89 entries, top) → `docs/open-questions.md` rows #216/#217/#212
(this session's own new/touched rows) → `docs/RUNBOOK.md`'s WP202 go-live checklist (step 1 done,
steps 2-6 the actual next owner-supervised action).

Verify yourself first, don't trust this file blindly:

## What's true right now (verified 2026-09-08)

- `main` HEAD is `0ed1205`. Working tree clean, single worktree, nothing uncommitted, nothing
  unpushed. CI green on every one of today's ~14 pushes to `main` (all owner-present direct
  pushes — no open PRs, no feature branches).
- Production live and healthy: `curl https://checkdecijfers.vercel.app/api/health` →
  `{"ok":true,"checks":[7 checks]}`.
- **Chart view-state editing (Phases 1-3, [#212](../open-questions.md)) is merged and LIVE.**
  Built autonomously (owner away) on `feat/chart-editing-p1`, then the owner returned before the
  branch was pushed and authorized a direct fast-forward merge (no PR was ever opened — see
  [ADR 038](../decisions/038-chart-view-state-editing.md) and open-questions #212's own
  "Superseded" note). Line/bar/table form switch, period-range zoom, series hide+highlight,
  click-to-annotate notes — all client-only, zero LLM/DDL/prompt-byte cost. Two of three
  owner-flagged UX gaps were fixed same day (small multiples now gates off a non-line form; the
  zoom range now clamps); the third (form persisting across an unrelated chart swap) was reviewed
  and left as intentional.
- **`PHRASING_MODEL` and `WEBSEARCH_MODEL` are now `claude-haiku-4-5`** (owner decision, cost).
  `COMPOSE_PROMPT_VERSION` is 4 (new rule 6b: a multi-period series must state every period's
  value). Hermetic benchmark 14/14+6/6+0 fabricated. A live end-to-end run also passed 14/14
  answerable/0 fabricated; one refusal task (B20) needs recalibrating for unrelated reasons (see
  #216 below) — this is NOT a phrasing regression, don't re-litigate it as one.
- **WP202a go-live checklist step 1 is done**: `dataset_turn` = 20 credits, in
  `ACTION_CLASS_PRICES`. **Steps 2-6 are NOT done** — migrations 026/027 are still file-only,
  `ATTACHMENTS_ENABLED` doesn't exist as a Vercel env var, no live spend has happened. This is the
  single most valuable "ready but idle" thing in the codebase right now.

## The single next priority

**WP202a go-live, steps 2-6** ([RUNBOOK.md](../RUNBOOK.md)'s WP202 section). Chat-with-your-own-data
is fully built and tested, priced, and has been sitting idle since session 86. Remaining, in order,
owner present: (2) `npm run db:migrate` (migrations 026+027, additive-only); (3) `npm run
pricing:apply`; (4) a read-only FK/RLS verification query against production (RUNBOOK has the exact
SQL); (5) set `ATTACHMENTS_ENABLED=1` in Vercel and redeploy; (6) a live smoke test — upload a real
small CSV, ask a chartable question (real ~20-credit spend), verify the balance debits correctly and
the chart/badge render as designed. **Live DDL, the flag flip, and the real-spend smoke test are
exactly the three categories CLAUDE.md flags as owner-supervised even in an owner-present
session — don't blast through all of it silently; narrate each step as you do it.**

## Tracked but not this session's focus

- **[#216](../open-questions.md)** — B20 (a benchmark refusal task) needs its freshness condition
  recalibrated; the real CBS CPI table has caught up to what the task assumed was always-uncovered.
  A benchmark-maintenance task, small, no rush, but don't forget it's open.
- **[#217](../open-questions.md)** — the owner wants true model-independence (swap any model
  without a manual prompt-tuning cycle). The real answer already exists as an unshipped draft:
  `SLOT_PHRASING_ENABLED` ([#162](../05-data-rules.md), R3's note) — deterministic slot-filling
  instead of free-form model prose. Needs its own scoping/brainstorm before any code; not
  something to build reactively inside another task.
- **[#172](../open-questions.md)** — a DIFFERENT, still-open model question (`TABLE_RERANK_MODEL`
  Haiku→Sonnet calibration for the catalog finder-chain) — unrelated to today's `PHRASING_MODEL`/
  `WEBSEARCH_MODEL` switch, don't conflate the two. This row's own stale "PHRASING_MODEL is already
  Sonnet" framing was corrected in place today (2026-09-08) — read the correction, not just the
  original 2026-07-26 quote.
- **[#214](../open-questions.md)** — mobile header (`SiteHeader`) wraps untidily at 375px; needs a
  real design decision (hamburger menu? hide the balance badge?), not a mechanical fix. No rush.
- **[#215](../open-questions.md)** — chart download: PDF instead of SVG, transparent/smaller PNG
  with no baked-in attribution. Owner explicitly said not now.

## Git workflow reminder ([#118](https://github.com/Stefan7168/checkdecijfers/issues/118))

If the owner is present in the chat: push/merge directly to `main`, no per-change approval needed,
full verification block still required before every push (typecheck ×2, all suites, hermetic
benchmark 14/14+6/6+0, real `next build`, `/code-review` LOW). If this becomes an autonomous
session (spawned task chip, overnight/cron) touching core-product or money-path code: branch + PR +
owner review before merge — do not push to `main` directly. **New precedent from today**: if a
session starts autonomous and the owner returns before anything is pushed, the MERGE step follows
whichever mode is true at the moment of the merge decision (owner present at merge time → direct
push, no PR), not how the code was built.

## Model-tier discipline reminder

Every model constant in the codebase is now `claude-haiku-4-5` except none — `PHRASING_MODEL` and
`WEBSEARCH_MODEL` joined everything else today. If a future request asks to change a model tier
again (either direction), treat it as a real decision, not a config edit: check sampling params
(Haiku wants `temperature: 0`, no `thinking` override; Sonnet is the reverse — see
[#172](../open-questions.md) for the failure mode of getting this wrong), re-record any fixture the
model is hashed into, and actually read the live output rather than trusting a green count.
