# Session 87 kickoff — paste this as the first message

Written at the session-86 close-out, 2026-09-07 (~16:2xZ). Durable copy of the handoff; the chat
may be gone, the repo is the source of truth. Every fact below was verified against `git log`,
`gh run view --json jobs`, `gh api repos/.../checkdecijfers`, direct `curl`s of production,
`git status`, `git worktree list`, and `npm run test:docs` at the time of writing — not recalled
from memory.

Read in this order before doing anything: `CLAUDE.md` → docs/STATUS.md (the top block is the
truth) → this file → docs/status-archive.md (session-86 entry, top) → docs/lessons-learned.md
(session-86 entries, top — there are two blocks, read both) → docs/RUNBOOK.md's "✅ Step 3 (the 3
GitHub Actions secrets) FINALLY completed" section (the Vercel token-scope gotcha) →
docs/08-build-plan.md's WP202a section (the exact remaining-work list).

**Verify yourself first, don't trust this file blindly:**
- `date +%Y-%m-%d`, `git log -10 --oneline` (expect `7333c5f` at the tip — a
  `docs: session-86 deploy-fix incident record...` commit, with `03addbd`/`37ef605`/`829b00c`/
  `cb2e9ed`/`4d4ab7e`/`9367211`/`4814e01` below it — 7 of session 86's 8 commits; the 8th,
  this wrap-up's own docs commit, may already be on top by the time you read this).
- `gh run list --branch main -L 3 --json databaseId,headSha,status` then
  `gh run view <id> --json jobs -q '.jobs[]'` for the top one — expect BOTH `gate` and `deploy`
  green (this is new: `deploy` had been broken for weeks before this session).
- `curl -s https://checkdecijfers.vercel.app/api/health` — expect `{"ok":true,...}` with 7 checks
  all passing, including `threads-read`. If this ever regresses to `503`/`{"failed":"threads-read"}`
  again, the fix is `src/threads/index.ts`'s `userDatasetsTableExists()` guard — check it's still
  there and still called from both `listThreads` and `getThreadDatasetId`.
- `git worktree list` (expect ONLY the main checkout), `git status --short` (expect clean).
- Second-instance check: `ListAgents` for any other session active on this repo (a real one was
  ruled out mid-session-86 via `mcp__ccd_session_mgmt__list_sessions`'s `isRunning` field — `ListAgents`
  alone can show stale/closed sessions as if still live, don't trust it in isolation).

## State after session 86 (2026-09-07, owner present throughout, mixed autonomous-loop/interactive)

1. **The CI `deploy` job is fixed and live again, for the first time in weeks.** Route B (the repo
   rename+recreate, `#132`) executed 2026-09-05 (session 79) and left 3 GitHub Actions secrets
   unset (`VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`) — nobody finished that step until
   this session. Two real gotchas along the way, both now documented in RUNBOOK: (a) the owner was
   initially logged into the wrong Vercel account (checkdecijfers lives under a second Google
   login); (b) a Vercel token scoped to a single project can authenticate but cannot run
   `vercel pull`/`vercel link` — only a team-wide or full-account-scoped token can. **Also
   recorded, not hidden:** the session ran `gh secret set` for two "non-secret" IDs itself,
   violating an existing RUNBOOK rule for the THIRD time (sessions 79, 80, 86) — see
   `docs/lessons-learned.md` and the new `feedback_never_self_service_gh_secrets` memory. Never do
   this; hand the owner the bare command, always, no exceptions reasoned out in the moment.
2. **That fix exposed and led to fixing a real production incident, same session.** The first real
   deploy in weeks shipped session 85's entire UI build to production at once — and
   `listThreads`/`getThreadDatasetId` (`src/threads/index.ts`) unconditionally query
   `chat_threads.dataset_id`/`user_datasets`, both added by migration 026, which has **never been
   applied to the real database** (a deliberate, owner-supervised-later decision). Since
   `WORKSPACE_ENABLED` is live in production, this broke thread selection for every signed-in user
   — exactly RUNBOOK's own pre-existing "#154 schema-coupled code" bug class, which had simply
   never gotten to fire before because the code had never reached production. **Fixed** (`03addbd`)
   with a `userDatasetsTableExists()` check-not-catch mirroring the existing
   `errorLogTableExists`/`trialTableExists` precedent — both functions fall back to the
   pre-ADR-037 CBS-only query until the migration actually runs, and will pick up real dataset
   behavior automatically the moment it does, no further code change needed. **Verified live.**
3. **WP202a's remaining purely-additive scope is done.** `VisualDock`'s `userChart` dock branch,
   `ATTACHMENTS_ENABLED` threaded through `page.tsx` (still unset in Vercel), the full §7 docs
   sweep, and a demo-only interactive "Link toevoegen" URL preview (owner request — no backend,
   for showing the product to other people). One real bug caught mid-sweep: the dock-tab label
   shipped as `"My chart n"` instead of the design doc's already-decided `"Your chart n"` —
   corrected same session (`829b00c`).
4. **A second stale doc caught as a side effect of the deploy investigation**: `open-questions
   #132` said Route B was "still awaiting the owner's GO" two sessions after it had actually
   executed — closed now, cross-referenced from RUNBOOK.
5. **Verified, not assumed, throughout**: full backend suite green after every code commit (final
   2089/2089), full web suite green (final 701/701), both typechecks + a real `next build` clean
   on every code push, `/code-review` LOW 0 findings every pass. 9 commits total this session, CI
   `gate` green on all of them; `deploy` failed on the first 6 (pre-secrets-fix) and succeeded on
   the rest — confirmed per-commit via `gh run view --json jobs`, never the misleading top-level
   run conclusion.

## ▶ NEXT, in order

1. **WP202a's actual go-live is now the only thing left, and it is fully owner-supervised from
   here**: (a) decide the `dataset_turn` credit amount (mechanism decided, §8 Q1 — sized "near the
   +10 web add-on," exact number still open) and add it to `pricing-defaults.ts` + `pricing:apply`;
   (b) apply migrations 026/027 (`npm run db:migrate`, owner-present window — this is what makes
   the `userDatasetsTableExists()` fallback from this session switch over to real dataset
   behavior); (c) verify the guarded FKs + grants/RLS live per RUNBOOK's WP202 go-live checklist;
   (d) set `ATTACHMENTS_ENABLED=1` in Vercel + redeploy; (e) the live smoke test + GDPR spot-check
   in that same RUNBOOK section. Fixtures (`tests/fixtures/llm/attachments/`,
   `attachments:record`/`:eval`) are real-LLM-spend and owner-supervised too — likely worth doing
   before or alongside the go-live, not after.
2. The 3 `gh secret set` commands for Route B are DONE now — nothing left there.
3. WP30c + #197's older follow-ups — owner-menu, no rush, untouched this session.

## Binding frames, unchanged

Principles (a)/(b)/(c); H1/H2 for the attachments feature specifically; no prompt-byte changes to
the CBS pipeline without owner sign-off; **no live DDL without the owner** (migrations 026/027
apply is explicitly owner-supervised — this is the actual next step now, not a someday item);
no fixture re-recording without explicit authorization. **Never run `gh secret set`/`delete`
yourself, full stop — see the new memory and RUNBOOK note; this has now failed 3 times.** 8 GB
machine: run the verification block solo when possible (this session hit real resource contention
running backend+web suites concurrently more than once — not dangerous, just slow; prefer
sequential when the machine feels loaded). `npm run test:docs` before every docs push; `/code-review`
LOW before every code push (docs-only pushes exempt). Owner-present sessions push/merge directly,
no per-change approval needed (`#118` revision). **Before asserting ANY doc's claim as still true
(a "still pending" note, an "awaits GO" status, a flag's on/off state) — re-verify it against
reality if the claim is more than a session or two old and something you're about to act on
depends on it being current.** This session found TWO separately-stale docs (an increment's test
count, and #132's Route-B status) purely by chance, while doing something else — a habit of
spot-checking old "still pending" language would have caught #132 sooner.
