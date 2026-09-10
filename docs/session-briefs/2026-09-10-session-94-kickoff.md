# Session 94 kickoff — paste this as the first message of the next session

Written 2026-09-10 at the end of session 93 (autonomous — owner away for the whole build, checked in
once with "ok wrap up when done"). Every fact verified against `git log`, `gh pr view`/`gh run list`,
and the real repo state at the time of writing. Read in this order: `CLAUDE.md` → `docs/STATUS.md`
(top block) → this file → `docs/status-archive.md` (session-93 entry, top) → `docs/lessons-learned.md`
(session-93 entries) → ADR [041](../decisions/041-public-embed-pages.md) (the whole Embed feature,
as-built).

## What is true right now (verified 2026-09-10)

- `main` is unchanged from session 92's close (`7cea0ad`) — this session did **not** touch `main`.
- The whole Embed feature (spec Part B) is built, reviewed, and tested on branch `embed-charts`
  (21 commits ahead of `main`), pushed to `origin`, and **a PR is open against `main`** — not merged.
  Find it with `gh pr list --head embed-charts` (this doc deliberately doesn't hardcode the PR number,
  per this repo's own doc-convention test).
- **CI on the PR is green** (run `34433304606`, `gate` passed in 10m16s; `deploy` correctly did not
  run — PRs never deploy, only a push to `main` does, per ADR 018). Verified directly before this
  session ended, not assumed — re-check with `gh run list --branch embed-charts` if picking this up
  much later, since a stale claim here would be exactly the kind of thing CLAUDE.md's own wrap-up
  ritual exists to prevent.
- Full local verification block was green on the branch's final commit before this session ended:
  typecheck ×2, web suite 1380/1380 (91 files), backend suite 2229/2229 (145 files, solo), hermetic
  benchmark 14/14 + 6/6 + 0 fabricated (GATE PASS), real `next build`, docs test 11/11.
- **The single fact worth remembering about Embed: Live re-render is fully built and tested, but
  permanently GATED CLOSED** — no code in this app can look up an arbitrary user's email by their user
  id, which the Live Pro-check needs (the anonymous embed visitor is never who's checked — the embed's
  *owner* is, and that's resolved days/weeks after the fact, with no session of their own).
  [#224](../open-questions.md) records this; ADR 041's Consequences/Revisit triggers have the detail.

## Do first

1. **The PR itself is the owner's decision, not this session's** — review it, decide whether to merge
   (CI is already green, see above — re-confirm if much time has passed, since a new commit could
   change that). If merged: the go-live is in `docs/RUNBOOK.md` § "Embed go-live" (set
   `EMBED_TOKEN_SECRET`, optionally `PRO_ACCOUNT_EMAILS`, redeploy, run the smoke test + the header
   proof — both steps in that section were corrected this session to test against the real deployed
   origin, not `checkdecijfers.nl`, which still resolves to registrar parking as of this writing per
   [#7](../open-questions.md)).
2. If the owner wants Live to actually work, the real next engineering task is
   [#224](../open-questions.md): a "look up a user's email by user id" mechanism (new Supabase
   admin/service-role plumbing — this needs its own scoping/brainstorm, it was deliberately not built
   in session 93 as an unbounded expansion of a plan that was already large).

## Owner steps still pending (do not decide these for him)

- Everything from before session 93, untouched: migrations 028 + 029 (`npm run db:migrate`), optional
  `BRANDFETCH_API_KEY`, WP202a go-live steps 2–6.
- New from session 93: review/merge the PR; if merged, `EMBED_TOKEN_SECRET` (+ optionally
  `PRO_ACCOUNT_EMAILS`, which does **not** by itself turn Live on).

## Rules that bind

- Plain English for everything owner-facing.
- #118: owner present → direct push to `main` after the full verification block; autonomous → branch +
  PR (this is what session 93 did). **A brief owner check-in message mid-session ("ok wrap up when
  done") is NOT the same as sustained owner-present supervision — it does not by itself authorize a
  direct merge; the owner's own explicit "go ahead, merge" would.**
- Docs never contain a literal `PR #<n>` — find the PR by branch name (`gh pr list --head
  embed-charts`) instead.
- Backend suite solo (~10–35 min depending on machine contention; ran in ~10.5 min in session 93 with
  nothing else running). A subagent's own `run_in_background` bash job can make it look permanently
  stuck when its turn ends mid-job — verify via `git log`/`git status`/`ps aux` before concluding it's
  orphaned and dispatching a replacement (session 93 hit this twice; the "stuck" agent resumed and
  finished on its own both times — see lessons-learned for the full account).
- Every model constant is Haiku. A tier change is a decision, not a config edit.

## Tracked, not focus (residuals from session 93 + earlier, in open-questions.md)

- [#224](../open-questions.md) the Pro-owner-email lookup (the big one, above).
- [#227](../open-questions.md) `isRedacted` triplicated by hand across 3 files — correct today, not
  consolidated (one copy lives in a `'use server'` module that can't be plainly imported elsewhere).
- [#228](../open-questions.md) a Live embed's query never counts toward table-eviction demand — moot
  until #224, easy to forget once it isn't.
- [#229](../open-questions.md) a pre-existing (not introduced in session 93), narrow gap: a >15-series
  chart can still embed as a Table view outside the `?form=` path this plan controls.
- From before session 93, untouched: #223 (the exported attribution line can be cut off on a narrow
  chart), #222 (dark-mode exports low-contrast), three gradient presets refusing on the stock palette,
  `chart.tsx` ~2850 lines (the `<ChartAxes>` extraction), Story mode follow-ups (zoomed steps, story in
  the embed, a map chart type).
