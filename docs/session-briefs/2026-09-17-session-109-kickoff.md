# Session 109 kickoff — checkdecijfers.nl

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it).
Verify everything below against `git log`/`gh run list` before trusting it — this brief may be stale
by the time you read it.

## The short version

Session 108 (2026-09-17, owner present throughout) closed out THREE independent, parallel-dispatched
pieces of work, all verified against reality (not just taken on a subagent's word), all merged or
documented, CI green throughout. `main` is at `4746f18`. There is **no owner-queued priority right
now** — same situation session 108 itself opened with.

## What happened this session

Local checkout started 32 commits behind `origin/main` — always `git pull --ff-only` and verify a
kickoff brief against real `git log`/`gh run list` output before trusting it, this doc included.

With nothing queued, three candidates were surfaced from `open-questions.md` and the owner said "All
use subagents" — three background agents dispatched in parallel, each scoped to its real risk level:

1. **[#263](../open-questions.md) migration-number collision check — MERGED (`eeae1b2`).** A CI check
   (`scripts/check-migration-numbers.ts`) now fails a push/PR if two migration files share a leading
   number. Small, safe, done.

2. **[#264](../open-questions.md) Eurostat DOI sourcing — RESEARCHED, not built (`fb503f9`).**
   Verified LIVE that Eurostat mints one DOI per dataset (`10.2908/<CODE>`, confirmed via the real
   DataCite API for `tipsbd30`, the one table already in production). Turns a previously-unscoped gap
   into a real, precisely-specified next step — building it is still a future session's call.

3. **[#254](../open-questions.md) level-vs-%-change chart toggle — MERGED (`4746f18`), [ADR
   052](../decisions/052-period-over-period-percent-change.md) ACCEPTED.** A new mechanism (distinct
   from ADR 051's toggle) computing period-over-period % change for 7 measures with no CBS-published
   mutation sibling. The owner explicitly delegated 4 open design questions to the session ("You are
   deciding that, okay?") — decided, applied, merged. One thing deliberately NOT built: a real
   producer-price-index alternate (`M003288` found and verified) would invalidate the intent parser's
   recorded LLM fixtures project-wide — needs an owner-supervised session budgeting a real
   `npm run intent:record` run (real API spend), logged in #254.

**A recurring process issue, worth knowing about before dispatching similar work:** subagents given a
long verification suite to run kept backgrounding the test command and ending their turn before it
finished, reporting something like "waiting for the notification" — which subagents never receive.
Detected each time via `ps aux | grep vitest` + `git status`/`git log` in the agent's own worktree
(real processes still running, nothing committed, contradicting the "completed" report), fixed each
time by resuming the SAME agent via `SendMessage` (never a fresh `Agent` call — that spawns an
amnesiac duplicate). One agent needed this correction THREE times before an explicit "stop
backgrounding entirely, run every step as one blocking foreground call" instruction stuck. If you
dispatch a subagent for a verification-heavy task, say this up front rather than waiting to discover
it — and still verify its worktree's actual git state yourself afterward regardless of what it reports.
Full account: [lessons-learned.md](../lessons-learned.md)'s session-108 entry,
[[feedback-subagent-background-command-stall]] in memory.

Full verification, all three threads (run independently, not just taken on the agents' word):
backend up to 167 files/2500 tests, web 117 files/1854 tests, benchmark 14/14+6/6+0 fabricated every
time, real `next build`, `/code-review` LOW clean throughout. CI green on every push
(`eeae1b2`→run `35176853182`, `4746f18`→run `35182601362`).

## What's next — no owner-queued priority

Same situation as session 108's own opening. Standing candidates from `open-questions.md`, none
urgent, roughly in order of how buildable they are:

- **[#264](../open-questions.md) DOI construction** — now precisely scoped (see above): a one-function
  addition to `registerTables`, plus a backfill of the one already-registered row. Small, safe,
  no design decision needed.
- **The two new [#254](../open-questions.md) follow-ups**: household income's alternate income
  concepts (needs its own registry-data check before deciding anything), and the producer-price-index
  fixture re-record (needs owner presence for the real API spend).
- **[#253](../open-questions.md) map/geo library comparison** — still explicitly blocked on a
  region-set query capability that doesn't exist yet; re-check whether that's still true before
  assuming it's still blocked.
- **[#260](../open-questions.md) Supademo visual polish** — explicitly deferred by the owner, needs
  the brainstorming skill when picked up (an architectural revision to ADR 042, several
  interconnected areas).
- Stripe live-mode / KvK — off-limits to raise as a next step, standing owner rule ([#54](../open-questions.md)).

If the owner gives no explicit next task, the honest move (confirmed again this session) is to ask
what they want, or — if delegated, as happened this session — make a scoped, principle-grounded call
and say so plainly, not silently pick something and present it as the only option.

## Standing reminders (unchanged)

Full verification block + `/code-review` LOW before every push (docs-only pushes exempt from the
code-review step, not from being pushed promptly). Owner-present sessions push/merge directly to
`main` once green, no per-change approval needed. Autonomous sessions (task chips, overnight/cron)
keep branch+PR for core-product/money-path code. Live DDL, real spend, and env-flag flips stay
owner-supervised.

## Worktree state

Clean — `git worktree list` shows only the main checkout. All worktrees and local/remote branches
from this session's three dispatched agents were removed after confirming clean status and full
merge into `main`. Other pre-existing worktrees from earlier sessions (`embed-charts`,
`experiment/162-slot-filling-ab`, `journey-programme`, `visual-*`,
`worktree-chart-alternate-reading-toggle`) are untouched — out of session 108's scope, not
necessarily stale; check their own state before assuming anything about them.
