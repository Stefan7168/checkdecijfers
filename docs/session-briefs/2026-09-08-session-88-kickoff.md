Session 88 kickoff — paste this as the first message

Written at the session-87 close-out, 2026-09-08. Durable copy of the handoff; the chat may be gone,
the repo is the source of truth. Every fact below was verified against `git log`, `gh run view --json jobs`,
`curl` of production, `git status`, `git worktree list`, and `npm run test:docs` at the time of writing —
not recalled from memory.

Read in this order before doing anything: `CLAUDE.md` → docs/STATUS.md (the top block is the truth) →
this file → docs/status-archive.md (session-87 entry, top) → docs/lessons-learned.md (session-87 entry,
top) → docs/open-questions.md rows #210-214 (the redesign effort's own tracking rows) → docs/RUNBOOK.md's
WP202 go-live checklist (still the actual next owner-supervised step, unchanged this session).

Verify yourself first, don't trust this file blindly:

* `date +%Y-%m-%d`, `git log -20 --oneline` (expect `23b0a69` at the tip — the wrap-up docs commit —
  with `468a8e6`/`13ac568`/`b912175`/`cb262df`/`49bbc23`/`6499ab6`/`a29dbd7`/`8350988`/`728372e`/`c1ba880`/
  `6327864`/`c0e4047`/`626f6ee`/`e6f5b21`/`90fda5d`/`a8ae15b` below it — the 16 session-87 commits).
* `gh run list --branch main -L 3 --json databaseId,headSha,status,conclusion` then confirm the HEAD
  run's `gate` AND `deploy` jobs are both green (deploy actually ran its real steps, not "skip the
  deploy when main has moved on" — check via `gh run view <id> --json jobs -q '.jobs[] | select(.name=="deploy") | .steps[]'`
  if in doubt).
* `curl -s https://checkdecijfers.vercel.app/api/health` — expect `{"ok":true,...}` with 7 checks
  passing.
* `git worktree list` (expect ONLY the main checkout), `git status --short` (expect clean).
* Quick visual sanity check that the redesign is actually what's live: the chat screen should be a
  bare composer (no "Over dit project" text, no example-question chips), shadcn-neutral styling, a
  light/dark/system toggle in the chat card's header bar.

State after session 87 (2026-09-07 owner-present start → explicit "continue working autonomously"
into 2026-09-08, spanning a day boundary with the owner away most of that time)

1. **A real production bug found and fixed.** Investigating a vague owner report ("tabs don't
   open") led to finding `/geschiedenis` frozen redirecting to `/` in production — the same
   build-time-static-prerendering bug class as an earlier `/login` fix (session 55,
   [#135](../open-questions.md)). Fixed with `export const dynamic = 'force-dynamic'` (`a8ae15b`),
   verified live. A route audit found no other instances. A stale RUNBOOK claim from session 55
   ("the /geschiedenis redirect signal still works") was also corrected — it had silently been
   false since 2026-07-24, since `/geschiedenis` never got the same fix `/login` did until today.
2. **The chat + chart visual redesign shipped and is LIVE**, built by a Fable subagent against a
   committed spec (`docs/superpowers/specs/2026-09-07-chat-chart-visual-redesign-design.md`),
   reviewed/amended/deep-reviewed by the session across several follow-up commits. shadcn/ui
   neutral + `next-themes` dark mode; papier & inkt retired (`docs/12-huisstijl.md` is the current
   house style doc); Recharts basic/default palette (the old colour-blind-safe palette + dash
   patterns dropped, an accepted owner trade-off); "Over dit project" + example-question chips
   removed from the chat screen only. A deep adversarial review (real browser, measured contrast)
   then caught and fixed 5 real regressions the mechanical restyle introduced (dark-mode chart
   illegibility, tooltip contrast, missing focus rings, a colour-only active-thread cue, overflowing
   dock tabs). A mobile-viewport check found and fixed the sidebar's total lack of a responsive
   breakpoint (auto-collapse reusing the existing collapsed UI, [#213](../open-questions.md)); the
   header's own mobile wrapping was flagged but NOT fixed — needs new nav UI, a design decision,
   [#214](../open-questions.md).
3. **Two research briefs produced for sub-projects 2 and 3 of the redesign effort — neither built,
   both need a real brainstorming round with the owner before any implementation:**
   - Sub-project 2 ([#211](../open-questions.md), chat interaction polish / streaming): a genuine
     product tension was found, not resolved — the pipeline validates the LLM's phrased answer
     ONLY AFTER full generation and can silently retry/fall back to a different body, which is in
     real tension with "stream tokens as they generate." Needs an owner decision on how (or
     whether) to reconcile that before any streaming work starts. A "no architecture change"
     fallback (staged busy-state text) was also examined and found to not hold up honestly (would
     require faking progress the client has no real signal for) — so there is currently NO safe
     default increment queued for this sub-project; it genuinely needs the brainstorm first.
   - Sub-project 3 ([#212](../open-questions.md), conversational chart editing for CBS charts): the
     ADR-037 `ChartInstruction` mechanism transfers, but CBS's narrower per-query data scope means
     a CBS-specific vocabulary is needed (3 concrete approach options given in the row). Tier 3
     ("ask for different data") was EMPIRICALLY CONFIRMED already-working live on production with
     zero new code — the existing follow-up/clarification flow already handles it correctly,
     including an honest PV-vs-gemeente-style disambiguation. Tiers 1-2 (presentation, in-hand
     filtering) are the actual open design surface and sit closest to R1/R9/R10 of anything in this
     effort — the brainstorm round should re-verify the brief's own invariant-risk read rather than
     build straight from it.
4. **A full open-questions re-triage — the first complete one since session 71's** — every row
   read, in 5 parallel agents, cross-checked against git history where load-bearing. 32 rows
   archived total this session (11 in an initial spot-check, 21 more in the full pass). Several
   real stale/contradictory claims were found and corrected in the process (a cross-reference
   claiming a shipped feature was "still deferred"; a GDPR row claiming a purge had never run
   though it has since session 78; two status-label/body mismatches; an alerting-channel claim
   verified to be true only narrowly, not as broadly as it read). A doc-wide finding — historical
   PR-number citations across the doc and its archive point at a prior, now-nonexistent GitHub repo
   instance and will 404, though the underlying commits all check out — was recorded as a standing
   header note rather than chased row by row.
5. **Dependency/security check: clean** — 0 npm audit vulnerabilities (root + web), 0 open
   Dependabot alerts, 0 open PRs.
6. **Verified, not assumed, throughout:** full backend suite 2089/2089 (measured once, after
   `e6f5b21` — the last commit touching `src/` this session; nothing after it could have broken
   backend, so per established practice it wasn't rerun for the web/docs-only commits that
   followed) and full web suite 701/701 (rerun and reconfirmed after every commit touching `web/`,
   final count, not a stale one — both counts grew slightly with the redesign's own test-file
   updates); both typechecks + a real `next build` clean on every code push; `/code-review` LOW: 0
   findings every pass. Every push's CI was
   individually watched to completion (`gh run watch`) before the next push started, without
   exception — this is what caught and let the session correctly stop when one push's `deploy` job
   showed "skip the deploy when main has moved on" (harmless leapfrog behaviour when pushes land in
   quick succession — only the LAST push in a burst actually deploys; not a failure).

▶ NEXT, in order

1. **Sub-project 2 or 3's brainstorming round** — whichever the owner wants to tackle first. Both
   need a real conversation, not a session's unilateral build; see the research briefs at
   [#211](../open-questions.md)/[#212](../open-questions.md) above for exactly what's already known
   vs. still genuinely open. Sub-project 3 is arguably lower-risk to start (tier 3 already
   confirmed working, tiers 1-2 have 3 concrete approach options on the table); sub-project 2 has
   a real unresolved tension that needs settling before any code.
2. **[#214](../open-questions.md), the mobile header wrapping** — a smaller, contained follow-up if
   wanted: needs a real design decision (hamburger/overflow menu? hide the balance badge? drop
   secondary links behind "Account"?) since there's no existing collapsed-header UI to reuse the
   way [#213](../open-questions.md)'s sidebar fix did.
3. **WP202a's actual go-live** — unchanged from session 86/87's kickoff, still the standing
   owner-supervised item whenever picked up: (a) decide the `dataset_turn` credit amount; (b) apply
   migrations 026/027; (c) verify guarded FKs + grants/RLS live; (d) set `ATTACHMENTS_ENABLED=1` +
   redeploy; (e) live smoke test + GDPR spot-check. See `docs/RUNBOOK.md`'s WP202 go-live checklist
   for the exact steps.
4. WP30c + #197's older follow-ups — owner-menu, no rush, untouched again this session.

Binding frames, unchanged from prior kickoffs
Principles (a)/(b)/(c); no prompt-byte changes to the CBS pipeline without owner sign-off; no live
DDL without the owner (migrations 026/027 apply is still explicitly owner-supervised); no fixture
re-recording without explicit authorization. Never run `gh secret set`/`delete` yourself, full stop.
8 GB machine: prefer running heavy suites (backend, especially) solo rather than alongside several
background agents — this session ran the full backend suite (~15-20 min each time) several times
without contention issues, but stayed mindful of it. `npm run test:docs` before every docs push;
`/code-review` LOW before every code push (docs-only pushes exempt). Owner-present sessions push/
merge directly, no per-change approval needed (#118 revision) — and per this session's own explicit
instruction, that authorization extends to an owner-away autonomous stretch too, PROVIDED the full
verification block still runs before every push and nothing owner-supervised (live DDL/spend/env
flips, or a genuine new product/design decision) gets decided unilaterally. If the Agent tool is
used to delegate a build task, do NOT call it a second time to "message" the same in-progress
agent — it spawns an independent duplicate instead of continuing it (see
[[feedback-agent-tool-no-resume]] memory / this session's lessons-learned entry); hold amendments
for the agent's own report-back, or stop and restart with a complete fresh brief.
