# WP16 sub-part 2 — continuity brief (✅ BUILD COMPLETE + MERGED 2026-07-06 — historical; only the RUNBOOK supervised live step remains)

> **Closed out session 27:** all build stages, the gate, the adversarial review, and the final Fable review completed; the branch was squash-merged to `main` (stage history preserved in the [handoff log](2026-07-06-wp16-sub2-handoff-log.md)); the `wp16-sub2` branch + worktree were removed. The ONLY remaining work is the owner-supervised live step — checklist in [RUNBOOK.md](../RUNBOOK.md). The text below is the brief as it stood during the build.

**Purpose:** the owner has ~5% Fable budget left. This file lets ANY session — any model tier — pick up the WP16 sub-part 2 build mid-flight without Fable and without prior context. The Fable-grade thinking is already frozen in the [canonical design](2026-07-06-wp16-sub2-design.md); what remains is execution, which deliberately does NOT need the top tier. Read this file, then the design, then act.

## Where we are going

Build WP16 sub-part 2: when a question needs a CBS table we don't have, the product debits 100 credits, tells the user *"we halen het op"*, fetches + ingests + verifies the table on a Vercel-Cron background job, answers through the normal validated pipeline, and emails the user — refunding in full on any failure. Product decisions are LOCKED in ADR [026](../decisions/026-on-demand-fetch-job-architecture.md); implementation decisions are LOCKED in the [canonical design](2026-07-06-wp16-sub2-design.md) (binding — do not redesign). Definition of done: full hermetic gate green (backend suites + benchmark 14/14+6/6+0 fabricated + web), adversarial review clean, diff reviewed against [docs/05-data-rules.md](../05-data-rules.md), landed on `main`, CI green. The LIVE steps (apply migration 012 to prod, set CRON_SECRET + RESEND_API_KEY, first real fetch) are a separate owner-supervised session — never autonomous.

## What has been done (update this list as stages land)

- ✅ Sub-part 1 (table finder) built, live-calibrated, sanity-reviewed clean — sessions 24–26; ADR 025; prod has migration 011 + the 4,858-row catalog.
- ✅ ADR 026: the four unblocking decisions (job engine / pricing / verification scope / v1 cut) — owner-confirmed.
- ✅ Canonical implementation design written and committed (session 27, Fable): [2026-07-06-wp16-sub2-design.md](2026-07-06-wp16-sub2-design.md).
- ✅ Build worktree exists: branch `wp16-sub2` (branched from main @ `1bb8536`), checked out at `/private/tmp/claude-502/-Users-amity-Documents-Check-de-Cijfers/2c39b13a-0681-42f9-9369-649593d26671/scratchpad/wp16-sub2`, dependencies installed. **If that tmp path is gone (reboot):** `git worktree prune && git worktree add <new-dir> wp16-sub2 && cd <new-dir> && npm ci && npm run web:ci` — the branch's committed stage work survives in the repo's own .git regardless of the worktree directory.
- ✅ Build workflow (re)launched with all stages pinned to Opus/Sonnet — **zero Fable needed downstream** (session 27). A first launch (run `wf_453ff0ea-909`, two Fable design agents) was lost to a process exit before anything completed; nothing was salvageable and nothing was built by it.
- ⬜ SCAFFOLD stage (migration 012, ledger sibling, pending-row store, #110a sync fix) — commit `wp16-sub2 stage: scaffold` on the branch when done.
- ⬜ CORE-1 (trigger seam, envelope, money orchestration) — commit `wp16-sub2 stage: core-1`.
- ⬜ CORE-2 (cron job, slice, delivery, notify) — commit `wp16-sub2 stage: core-2`.
- ⬜ PERIPHERY (dashboard states) — commit `wp16-sub2 stage: periphery`.
- ⬜ Gate green in the worktree; adversarial review (money-path, invariants, design-conformance, executing test-honesty) + confirmed-findings fixes.
- ⬜ Final: session reviews the branch diff against docs/05, squash-lands on `main`, pushes, CI green, docs (STATUS/build-plan/open-questions #110a) updated in the same change, lessons-learned + memory per CLAUDE.md item 6.

## How to see where it actually stopped (trust these, not this file's checkboxes, if they disagree)

1. `git log --oneline wp16-sub2` — one commit per completed stage (the crash-safe record).
2. `HANDOFF-wp16-sub2.md` in the worktree root — stage-by-stage: what exists, decisions, assumptions, what the next stage needs. THE fine-grained ground truth.
3. The workflow's live progress: `/workflows` in the session UI; scripts live under `~/.claude/projects/-Users-amity-Documents-Check-de-Cijfers/<session-id>/workflows/scripts/`.

## How to resume after any interruption

- **Workflow died / new session:** the ACTIVE run (launched session 27, 2026-07-06) is run id `wf_0f3042e9-aac`, script at `~/.claude/projects/-Users-amity-Documents-Check-de-Cijfers/b4a9fc2b-ef71-4323-b3b1-89234c1223e7/workflows/scripts/wp16-sub2-build-wf_0f3042e9-aac.js`. Relaunch with `Workflow({scriptPath: <that path>, resumeFromRunId: "wf_0f3042e9-aac"})` — completed agents return cached. If the script file is gone: check `git log wp16-sub2` for the last completed stage commit and launch a fresh workflow (or manual stages) skipping what's done.
- **No workflow at all (simplest fallback, works for any model):** run the stages manually as plain subagent tasks or directly in-session, one at a time, in the design's §9 order, each stage = read handoff → implement per design section → run suites + typecheck → update handoff → commit on the branch. The design is written so this works.
- **Fable exhausted:** nothing left in this build needs it. Use Opus for CORE-1/CORE-2 and the review lenses, Sonnet for the rest. The final docs/05 diff review should be done by the most capable model available — Opus is acceptable; the adversarial review workflow's double-verified findings are the safety net either way.

## Standing constraints (from CLAUDE.md — binding even mid-crisis)

Hermetic only: no live CBS/LLM/Resend calls in tests, migration 012 never applied to a real DB, no pushes of the branch, never touch `main` until the final reviewed landing. Green CI is the only "done". A fabricated number is the worst possible bug — when in doubt, refuse/refund paths win.
