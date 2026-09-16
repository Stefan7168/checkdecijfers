# Session 108 kickoff — checkdecijfers.nl

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it). Verify everything below against `git log`/`gh pr list`/`gh run list` before trusting it — this brief may be stale by the time you read it.

## The short version

Session 107 (2026-09-16, spanning into 2026-09-17) closed out TWO independent threads, both merged to `main`, both CI green. Nothing is paused, nothing is mid-build. There is **no owner-queued priority** right now — the next session needs either a fresh owner ask, or its own judgment call on what's highest-result (see "What's next" below for how session 107 approached that same question, so you don't have to re-derive the survey from scratch).

## What shipped this session

1. **The chart alternate-reading toggle** ([ADR 051](../decisions/051-chart-alternate-reading-toggle.md), [open-questions #254](../open-questions.md)/[#262](../open-questions.md)) — resumed from session 106's pause, finished, whole-branch reviewed, merged (`b31d84a`, CI run `35115201383`). ~20 registered CBS measures now show a real alternate-reading toggle (raw vs. seasonally-adjusted, index level vs. year-mutation, etc.) in chat, dock, and the anonymous trial. Level-vs-%-change stays a separate, unscheduled gap.

2. **Eurostat WP30c E1's "Constraint 0" resolved** ([ADR 048](../decisions/048-eurostat-data-source.md)'s As-built addendum, [#249](../open-questions.md)) — the owner confirmed "no real API spend" meant money, not any live call. A live fixture capture found and fixed two real API-shape defects (the Catalogue endpoint's real TSV shape, not the guessed JSON one; the Statistics API's real sparse `value` object shape) and a genuine cross-branch migration-number collision (two different `031_*.sql` files from two branches — renumbered to 032/033). Merged (`46527a8` + `1b23298`, CI run `35125746817`).

**Full verification, both threads combined:** backend 165 files/2466 tests, web 117 files/1854 tests, benchmark 14/14+6/6+0 fabricated, real `next build`, both typechecks clean, `/code-review` LOW clean on each thread (1 finding on the Eurostat thread, fixed same session).

## What's genuinely next for Eurostat (owner-supervised, not autonomous)

Registering a real Eurostat table needs migrations 032/033 applied first (`npm run db:migrate`) — RUNBOOK "WP30c E1" steps 4-5. This is the ONE remaining owner-gated step before `/eurostat-explorer` (internal, flag-gated, `EUROSTAT_EXPLORER_ENABLED`, unset in production) can show real data end-to-end. Nothing here is a public go-live; Eurostat is not answerable from live chat until phase E2 (its own future design round).

## "What's next" — how session 107 approached it, so a future session doesn't have to re-derive this

When asked "what's next" with no owner priority queued, session 107 did NOT default to the nearest small item — it surveyed the whole roadmap (`docs/06-roadmap.md`, `docs/08-build-plan.md`, `docs/open-questions.md` broadly) via a dedicated research pass. Findings, still true as of this writing (re-verify before trusting):

- **Stripe live mode / KvK registration** — code-ready (Pro subscription tier + credit packs both fully built, test-mode only), but **explicitly off-limits to raise** as a next step (owner's standing rule, [#54](../open-questions.md): "STOP raising KvK as a next step or blocker" until he declares the site done). Do not suggest this even if it looks like the obvious highest-leverage move.
- **`#253`** (map/geo chart library comparison) — still blocked on its own stated precondition: `src/query/` has no way to ask for "every region," only a fixed named list. Check this precondition again before assuming it's still blocked; it may have changed.
- **`#260`** (matching Supademo's broader chart visual polish) — explicitly deferred by the owner, a real design task needing the brainstorming skill (architectural path, revises ADR 042).
- **`#263`** (new this session) — a process finding, not a feature: this project's migration numbering has no cross-branch collision check. Not urgent, logged for whenever CI/process tooling is next revisited.

If the owner gives no explicit next task, the honest answer is: there is no queued priority, and the responsible move is to ask what they want rather than picking a default — the standing "#118(a) owner-present" push authorization does not extend to silently choosing which feature to build next.

## Standing reminders (unchanged)

Full verification block + `/code-review` LOW before every push (docs-only pushes exempt from the code-review step, not from being pushed promptly). Owner-present sessions push/merge directly to `main`, no per-change approval needed once green; autonomous sessions keep branch+PR for core-product/money-path code. Live DDL, real spend, and env-flag flips stay owner-supervised regardless of how broad the general push/merge authorization is. When resuming a long-unmerged branch, check drift in BOTH directions (`git log --oneline HEAD..main` AND the reverse) before finalizing any doc edit — session 107 hit this twice in one session, once each direction.

## Worktree state

`.claude/worktrees/chart-alternate-reading-toggle` currently sits on branch `wp30c-e1-eurostat-adapter`, fully merged into `main` (safe to `git checkout` a different branch in place if reused, or leave as-is). No stray worktrees.
