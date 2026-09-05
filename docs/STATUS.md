# STATUS

> **Tracker, not a source of truth.** Scope and the gate are defined in [03-mvp-scope.md](03-mvp-scope.md), the benchmark in
> [02-user-scenarios.md](02-user-scenarios.md). This file only records progress against them. Update it whenever project state changes (see the
> definition of done in [CLAUDE.md](../CLAUDE.md)) — with **measured results only, never aspirational ones**.

> **Session log lives in [status-archive.md](status-archive.md)** — full per-session "Last updated" entries, verbatim, newest on top.
> **Convention (since 2026-07-12, session 41):** at session wrap-up, PREPEND the full session entry to
> [status-archive.md](status-archive.md) and update only the lean top block below. Keep STATUS.md readable in one
> Read call: hard-wrap every line at ~150 chars, no kilobyte-long lines.

**▶ SESSION 79 (2026-09-05, OWNER PRESENT, session still ongoing — this entry will be extended at actual
wrap-up) — ROUTE B EXECUTED, #197 IDEAS 6+8 BUILT + MERGED + LIVE (pending Vercel secrets), #162 STILL BLOCKED
(twice, second time by tooling, not the experiment).** Kickoff verified clean against
`docs/session-briefs/2026-09-05-session-79-kickoff.md`. Owner said "ALL" to the priority menu — worked all four
threads in parallel rather than picking one.

**Route B: DONE.** Fresh secret-exposure scan across all 807 commits (common key-prefix patterns for every major
provider + Stripe + Supabase + JWT-shaped tokens) found nothing real — the three filename-flagged hits
(`web/.env.production`'s public Supabase URL/key, a `FAKE_URL` test fixture, a public CA cert) were all verified
safe by reading their actual content, converging with session 37's original 2026-07-12 audit. Old repo renamed
to `checkdecijfers-pre-rewrite-archief` (private), new public `Stefan7168/checkdecijfers` created and pushed
(807 commits, `refs/pull` confirmed empty), Dependabot re-enabled. **Still needed from the owner:** 3
`gh secret set` commands (`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`/`VERCEL_TOKEN`) on the new repo — until then every
`deploy` CI job fails at "Pull Vercel project settings," harmlessly (production keeps serving the last
successful deployment; confirmed live via `checkdecijfers.vercel.app/api/health` → 200 — the custom domain
`checkdecijfers.nl` isn't reachable from this session's sandbox network, unrelated to the app).

**#197 ideas 6 (hide/show a series) + 8 (small multiples): BUILT, reviewed, MERGED + LIVE in git — `main`
`e49862c`, CI `gate` job green (8m49s).** Brainstormed in-chat, written up as
[session-briefs/2026-09-05-chart-ideas-4-6-8-design.md](session-briefs/2026-09-05-chart-ideas-4-6-8-design.md)
(idea 4, the takeaway headline, is bigger than the original research brief implied — correctly rescoped out,
unscheduled) and [superpowers/plans/2026-09-05-...md](superpowers/plans/2026-09-05-chart-series-toggle-and-small-multiples.md),
executed via subagent-driven-development (haiku implementers, sonnet task reviewers, opus for the final
whole-branch review) in an isolated worktree. **The final whole-branch review earned its cost:** it found a
Critical bug no task-level review could see — `ChartView` isn't remounted per spec at two live call sites
(`visual-dock.tsx`, `chart-toggle.tsx` both swap `spec` on the same mounted instance) — so the new hidden-series
state could leak across a chart switch and either silently blank a chart with no legend to recover it (index-
based series keys can coincidentally collide across different charts) or bake a false "N van M reeksen
verborgen" claim into an export. Fixed (reset the three new presentation states on a real spec-identity change,
React's own documented pattern, no Effect) and proven with a rerender-same-instance-different-spec test. Also
fixed from the same review: inverted `aria-pressed` polarity on the new legend buttons (a repeat of a mistake
this codebase had already fixed once elsewhere), small-multiples panels overflowing their fixed-height
container past ~4 series, and — raised explicitly to the owner rather than picked unilaterally — "eigen assen"
mode's panels auto-scaled with no axis labels, contradicting this file's own stated axis-honesty policy; owner
asked for the best UX, so per-panel own-axis labels were added, reusing the chart's existing honesty-bound
tick mechanism (never an invented number). Final state: root+web typecheck clean, backend suite 118/118 files
1792/1792 tests, benchmark GATE PASS (14/14+6/6+0 fabricated), web suite 51/51 files 605/605 tests, `next build`
clean — all independently re-verified by this session, not just trusted from subagent reports. **Docs updated
in the same push:** open-questions rows #46 and #197.

**#162 (slot-filling A/B): still no phrasing-quality verdict, blocked twice for two different reasons.** First
attempt (owner-authorized real spend, ~€0.50 of the ~€1-2 budget) correctly stopped at real hard-gate failures
before the judge ever ran — 3 root-caused validator/prompt bugs, one of which (a shared-validator false
positive on "Op &lt;year&gt;..." phrasing) turned out to be a **latent bug in the live production pipeline
too**, not just this experiment (recorded, not yet fixed — needs its own follow-up). Second attempt (asked to
fix the 3 bugs and complete the experiment) hit a genuine **tooling failure, not a code problem**: partway
through, its sandbox got bound to a worktree it had no relation to (`chart-series-toggle-small-multiples`,
this same session's OWN concurrent worktree) and every Bash/Edit call was refused from that point on. This
session independently reproduced the identical symptom directly afterward (an app-level directory-change
notification collided with this session's own `EnterWorktree` isolation, refusing every command including
explicit correct paths, until `ExitWorktree` + fresh `EnterWorktree` cleared it) — worth a RUNBOOK note: **don't
run `EnterWorktree` in the orchestrating session while a background agent is still active**, and if a
background agent starts reporting worktree-isolation refusals for a path it never touched, that is this bug,
not a real permissions problem. **Third attempt (clean environment): real progress, still no verdict.** All 3
diagnosed bugs fixed plus a 4th found live during end-to-end verification (the bug-3 pre-fill fix alone was a
no-op until the POST-fill validator belt was also patched) — template-falls 18→3 (leg1/B1-B14 specifically
7→1), confirmed via a git-stash-controlled full-suite run (1806/1807, the 1 failure a pre-existing
worktree-`node_modules` gap, RUNBOOK item 3) and an independent benchmark re-run (GATE PASS, legacy pipeline
unaffected, 0 fabricated throughout). **Remaining gap (2 of 34 cases): a second, independent same-sentence
check — `checkBinding` in `validate.ts`'s own R9 pass — fused into the shared validator's core logic in a way
that isn't safely patchable after the fact, unlike the first three fixes.** Given a full plain-language
walkthrough of that gap, owner's call: **stop here, not a 4th attempt** — 31/34 (91%) clean is the recorded
result; the judge never ran, so no phrasing-quality verdict exists either way. Cumulative spend, all 3 rounds:
≈$1.14 (~€1.05). Branch `experiment/162-slot-filling-ab` (head `f26d01e`) kept as a 91%-fixed foundation, not
merged, not deleted. **Worth a separate look:** the Tier-B fix (the "op" marker addition to the shared
validator) is a genuine, small, well-tested production correctness fix, independent of the rest of the
slot-filling experiment — a candidate for extracting and shipping on its own, not yet done.

**Also this session:** two new roadmap ideas recorded from the owner mid-conversation — user-connectable Google
Sheets ([#201](open-questions.md), explicitly blocked on auth the owner doesn't want to build yet) and
drag-and-drop chat attachments ([#202](open-questions.md)) — both deliberately NOT built, cross-referenced to
each other and to ADR 032's existing "unofficial content gets its own attributed section" pattern. WP30c stays
at "wait" (not decided this session).

**A fourth, unrelated bug found and fixed: negation-blindness in R9's direction-word checker, MERGED + LIVE
(`main` `54694ae`).** `UP_WORDS`/`DOWN_WORDS`/`FLAT_WORDS` in `src/answer/compose/validate.ts` matched a bare
trend word with no regard for a preceding negation, so honest prose like "groeide gestaag, zonder tussentijdse
dalingen" (grew steadily, without intermediate declines) was rejected as a false decline claim. Found
incidentally during #162's diagnostic work, correctly spun off as its own task since it's unrelated to
slot-filling and affects the live production pipeline directly — fixed on request the same session. A trend
word preceded by zonder/geen/niet in the same clause is now treated as no claim at all (same as a clause with
no trend words), verified not to mask a genuinely wrong unnegated claim sitting alongside a correctly-negated
true one in the same sentence. Verified: typecheck clean, backend suite 118/118 files 1795/1795 tests (3 new),
benchmark GATE PASS, `next build` clean.

**▶ NEXT, in order — nothing urgent except the one owner-blocking item:** (a) the 3 `gh secret set` commands
for Route B's new repo (yours); (b) consider extracting the #162 Tier-B validator fix (the "op" marker) for a
standalone ship, independent of the rest of the slot-filling experiment; (c) #162 itself — parked at 91% clean,
pick up `checkBinding` whenever the idea gets revisited, no rush; (d) **Route B's repo recreation reset
Dependabot's PR numbering — the old #124 npm-all zod-regression PR no longer exists as such; the same
underlying group is now PR #2 on the fresh repo** (confirmed: zod 4.4.3→4.5.4 among the same 5 packages, other
4 at newer targets since time passed), still blocked by the same fixture-hash issue; an early-session agent
was investigating this (see the tooling-gotcha note above) and its output should be checked against PR #2, not
the defunct #124; (e) #199 — declined again this session (owner said leave it parked); (f) idea 4 (takeaway
headline) — designed, not built.

**▶ SESSION 78 (2026-09-04 into 2026-09-05, OWNER PRESENT — merge day for the four PRs sessions 76/77 left
open) — #126/#127/#128/#129 ARE ALL MERGED + LIVE.** Kickoff verified clean against
`docs/session-briefs/2026-09-04-session-78-kickoff.md`: `git log -3` matched, `gh pr list` showed exactly the
six PRs expected, all CI runs `success`, no stray worktrees/branches. Asked the owner what to prioritize;
answer: review + merge #126–129 first.

**Merge order:** #127 (clean) → #129 (clean) → #126 (doc conflict) → #128 (doc conflict, twice — see below).
Squashed serially, one deploy at a time, gate+deploy+3-canary (`/`, `/llms.txt`, `/api/health`, all 200) checked
before starting the next merge, matching the established discipline. Final SHAs: #127 `676facf`, #129 `30098e9`,
#126 `95c7487`, #128 `be9144f`.

**Conflicts were doc-only in every case (no code conflicts at all)** — expected, since these branches were cut
before sessions 76/77's own docs-direct-to-main pushes moved `docs/STATUS.md`/`open-questions.md` on. #126
conflicted only on ADR 033; #128 conflicted on `04-architecture.md` + `RUNBOOK.md` (round 1) and then
`STATUS.md` again (round 2, because `main` advanced past #128's stale branch a second time when #126 merged
in between) — each resolved in a scratch worktree, pushed back to the PR branch, re-verified green before
merging into `main`.

**One resolution mistake, self-caught and fixed the same session:** the ADR 033 conflict was resolved with a
blind `git checkout --theirs` (taking `main`'s side) on the assumption main's copy was more current — **wrong**:
direct comparison of both sides (`git show ca2c76f:...` vs `git show 146594c:...`) showed the PR branch's own
note was the fuller, more accurate one (it documented the companion carrier-onto-`ChatMessage` move that main's
thinner stub omitted entirely), while for the OTHER two conflicting files (`04-architecture.md`, `RUNBOOK.md`)
main's side genuinely was more current and `--theirs`/a hand-merge was correct. Caught by re-checking every
resolution against both raw sides directly instead of trusting the first read — fixed with a direct edit to
`main` (folding the branch's fuller text back in, updated to MERGED+LIVE wording) rather than left wrong.
**Lesson: never resolve a docs conflict by assuming which side is newer — `git show <sha>:<path>` both sides
and compare content, every time,** logged in [lessons-learned.md](lessons-learned.md).

**Also caught mid-sweep:** the local working tree had drifted 4 commits behind `origin/main` (only `git fetch`
had been run, not `git pull`/`merge --ff-only`) — a stale-wording grep against local files silently returned
results for content that had already been fixed on `origin/main` minutes earlier. Fast-forwarded before
re-running the sweep for real. `curl` is not installed in this sandbox (canaries used `node -e "fetch(...)"`
instead, working reliably throughout).

**Post-merge docs sweep:** grepped for "pending owner review"/"awaiting merge"/"not yet merged"/"OPEN,
gate-green" tied to these four PRs across `docs/`; fixed every real hit — `04-architecture.md`, `RUNBOOK.md`,
`open-questions.md` rows #79/#196, ADR 029, ADR 033 (the correction above) — to MERGED + LIVE with the real
squash SHAs. `git status` clean, no stray worktrees.

**Dependabot #125 merged too** (squash `938f742`, session 76's prior verification re-confirmed still accurate —
head unchanged since it opened, gate green) — gate+deploy+canary all green. `gh pr list --state open` now shows
only #124 (still blocked, zod regression, unchanged).

**Then, owner-directed: `GDPR_PURGE_APPLY=1` is now SET and VERIFIED LIVE (2026-09-05).** `npm run gdpr:purge`
dry-run baseline first (0 rows everywhere, same as every prior measurement); `vercel env add
GDPR_PURGE_APPLY production` = `1`, empty-commit redeploy (`490362f`, gate+deploy+canary green); triggered one
real run with `vercel crons run /api/gdpr-purge-cron` (Vercel's own CLI invokes it pre-authenticated — no need
to retrieve `CRON_SECRET`, which is Sensitive-typed and cannot be read back via `vercel env pull` by design;
an earlier attempt to fetch it that way and call the route directly correctly got 401, since a Sensitive var
pulls as the literal placeholder `[SENSITIVE]`, not its real value). `vercel logs` confirmed `Applied —
redacted 0 audit_answers ... 0 trial_questions ... 0 error_log`, matching the dry-run baseline exactly, per
RUNBOOK's procedure. The monthly cron now actually enforces retention. Docs updated everywhere this was stated
as dormant: RUNBOOK's secrets table + maintenance-agenda note, 05-data-rules.md (two spots), CLAUDE.md's
maintenance-agenda line, open-questions #189.

Asked again what to prioritize; owner said "You choose." None of the three remaining options (real spend +
owner read-back on #162, a personal-privacy GO/defer call on #132 route B, unscoped feature work on the owner
menu) were appropriate to pick unilaterally — surfaced the reasoning back rather than picking blind. Owner's
next reply, "Continue," was read as endorsing the implicit recommendation to close out here — full session
wrap-up run per CLAUDE.md's ritual.

**▶ NEXT, in order — nothing urgent, all owner-gated:** (a) Dependabot #124 (still blocked, zod regression,
PR #124's comments have the bisection); (b) #162's A/B (~€1-2 real spend, needs your read-back); (c) #132
route B GO or defer (deferred repeatedly since 2026-09-02); (d) the owner menu: WP30c choice, #199 (proof
panel — needs a small read-model WP, brainstorm first), #197 ideas 4–8. **The hermetic follow-up queue stays
confirmed exhausted** (sessions 76+77) — nothing new to autonomously triage without a genuinely new angle.

**▶ SESSION 77 (2026-09-04, AUTONOMOUS — owner said "up to you, work autonomously for hours and hours" in an
owner-present chat, then left) — RE-TRIAGED open-questions.md FOR MORE HERMETIC FOLLOW-UPS: MOSTLY NOISE, ONE REAL
NEW BUILD (#200b), NOTHING MERGED.** Kickoff: verified session-76's kickoff brief against reality first (matched
exactly — `main` `3b959b3`, PRs #124-128 as described, CI green ×3); `ListAgents` showed an interactive peer
`check-de-cijfers-ee` — flagged to the owner, who confirmed no other session was actually running, so this session
proceeded as the sole active one. Per #118(b) (autonomous, core-product code): branch + PR + owner review, never
merge — asked and got an explicit owner answer ("leave queued for your review") before touching anything, so
**#126/#127/#128/#125 were deliberately left untouched, exactly as session 76 left them.**

Dispatched a 5-agent Workflow to re-triage all 150 live open-questions.md rows for anything a session could safely
pick up without owner input (session 76 had declared that queue "exhausted"). It returned 8 candidates; **verifying
every one by hand found 7 were wrong** — 3 were exact duplicates of what session 76 already built as open PRs
(#73/#79/#196, i.e. #126/#127/#128), 1 (#63) was already investigated and deliberately deprioritized last session,
1 (#199) is the same owner-menu item every session since 72 has correctly left alone, and 2 (#90, #99) described
content that doesn't match the real row at all (row #90 doesn't exist in the live file; row #99 is the long-since
signed-off site footer, unrelated to what the agent invented). **Only one candidate survived verification: open-
questions row #200 direction (b)** — a diagnostic-error improvement for the hermetic LLM fixture-replay harness
(confirmed real by reading `src/answer/llm/client.ts` directly, not from the triage summary). A second,
evidence-required sweep for stale "still open" doc claims flagged 2 more candidates; **both mostly evaporated on
verification too** — row #196 turned out to compare an unmerged PR branch against `main` (row's "still open"
framing was correct), row #34 already recorded its own fix further down the same long cell (this session read only
part of it before drawing the wrong conclusion, caught before writing anything). Only row #110 was a real minor
gap (fixed directly, docs-only: its closing PR reference didn't say which sub-items that PR actually covered).
Full detail on both false-positive patterns: [lessons-learned.md](lessons-learned.md) session-77 entry — **this is
the main, reusable finding of this session's triage phase**, since the actual net-new hermetic work found was one
small item, confirming session 76's "the three follow-ups exhausted the queue" was correct.

**Built PR #200(b) exactly like session 76's pattern (build → HIGH-review → fix-if-needed, worktree-isolated):**
**PR #129** (`fix/200-fixture-hash-diagnostic`, round-2 head `c5e5b34`) adds a diagnostic to
`ReplayLlmClient.complete()` (`src/answer/llm/client.ts`) — on a fixture-hash miss, it now scans the same fixtures
directory for a near-miss fixture whose request is identical in every field except `jsonSchema`, and if found,
names that near-miss and explains the two possible causes (a non-behavioral schema-serialization-library bump, or
a genuine intentional zod-schema edit that didn't touch the prompt) instead of the old generic "no recorded
fixture" message — see #200's PR #124 bisection for the original diagnosis this closes the loop on. HIGH review
found 1 real low-severity finding (the first draft overclaimed the dependency-bump cause as the "usual" one when
the signal genuinely can't distinguish it from an intentional schema edit); fixed in round 2 to present both causes
neutrally with a concrete disambiguation method. `requestHash()`, `stableStringify()`, `RecordingLlmClient`, and all
four `jsonSchema`-building call sites are untouched — zero prompt-byte risk, and `ReplayLlmClient` is CI/test-replay
only (never used in production). **Verified independently by this session (not just trusted from the agent
report):** `gh pr view 129` head SHA matches the reported `c5e5b34` exactly; `git diff main...origin/fix/200-…`
shows exactly the 3 files reported (`src/answer/llm/client.ts` +76/-7, a new `tests/answer/llm-client.test.ts`
+161, `docs/open-questions.md` +1/-1); read the actual diff — the no-near-miss message is untouched (byte-identical
template literal, just re-indented) and the near-miss message hedges correctly. Build agent's own measured
verify-block: typecheck clean, `tests/answer/llm-client.test.ts` 4/4, full `npm run test:answer` 757/757 (30
files) — **CI gate on the round-2 push confirmed PASS by this session** (`gh pr checks 129` after the fact: both
`gate` runs `pass`, 16m29s/16m51s; `deploy` correctly `skipping`, non-main). PR #129 is fully green, ready for
review.

**Maintenance, read-only:** `npm audit` root and `web/` both 0 vulnerabilities (the web check needed one retry after
a transient registry timeout); `gdpr:purge` dry-run 0 rows everywhere (fresh baseline, matches every prior
measurement this project has taken). **Docs fixed, docs-only:** open-questions row #110's closing sentence now says
which sub-items PR #111 actually shipped ((b)+(c); only (d) is genuinely open) instead of reading as if all of
(b)/(c)/(d) were still open.

**No spend, no prompt bytes, no DDL, no flag flips, no merges — matches every autonomous session before it.**

**▶ NEXT, in order — nothing urgent, unchanged from session 76 except PR #129 is now added to (a):** (a) review +
merge #126/#127/#128/#129 (independent files, expect trivial docs/STATUS.md + open-questions.md conflicts, not code
ones — same as session 76 predicted for the first three); (b) Dependabot #125 (clean, ready); **#124 still blocked,
do not merge as-is** (zod regression, PR #124's comments have the bisection); (c) `GDPR_PURGE_APPLY=1` + one watched
run; (d) #162's A/B; (e) #132 route B GO or defer; (f) the owner menu: WP30c choice, #199, #197 ideas 4–8, the three
#197 follow-ups. **The hermetic queue is now confirmed genuinely exhausted** — two independent triage passes this
session, one open-ended and one evidence-gated, together found exactly one small new item; further re-triaging the
same doc without new information is unlikely to be worth the tokens.

**▶ SESSION 76 (2026-09-04, AUTONOMOUS — owner said "I will be gone for hours... use multiple sub-agents", no reply
expected in chat) — THE THREE RECORDED HERMETIC FOLLOW-UPS (rows #73, #79, #196) ARE BUILT, EACH ON ITS OWN PR,
EACH HIGH-REVIEWED, NOTHING MERGED.** Kickoff verified clean first (`main` `da71ccb`, open PRs = exactly #124/#125
Dependabot as expected, last 3 CI runs `success`, prod alias on `da71ccb` per its deploy job's `this run == main
tip`, canaries 200×3; `ListAgents` showed 3 other `check-de-cijfers-*` interactive peers with no visible
running/idle state — not investigated further since nothing here touched `main` until this docs push). Per #118(b)
(autonomous session, owner absent, core-product code): branch + PR + owner review, never merge — so all three PRs
below are OPEN, not merged, exactly like session 72's batch.

Dispatched one Workflow (build → HIGH-review → fix-if-needed, 7 agents, worktree-isolated, ~2.33M subagent tokens,
~4h wall-clock): **PR #126** (`fix/73-carrier-on-chatmessage`,
head `146594c`) moves the WP29 click-chip carrier off an index-keyed ref onto `ChatMessage` itself (now that #123
freed `chat-message.ts`) and drops `capturedThreadId` + the carrier's own `threadId` (proved equivalent to always
sending the live `threadId`) — HIGH review: clean, 0 findings, independently re-verified. **PR #127**
(`fix/79-shared-derived-predicate`, head `5bda716`)
extracts one shared `isDerivedResult()` for R5's marking-line rule and fixes `csv.ts`'s real divergence — it was
silently omitting the "Bewerking: ..." disclosure for a direction/first_last-only derivation while every other
surface (chat answer, citation, proof panel) correctly showed it — HIGH review: clean, 0 findings. **PR #128**
(`fix/196-eviction-resolve-race`, round-2 head
`ef4e35a`) closes the recorded structural gap: `resolveIntent`'s own registry reads (before `run.ts`'s
already-hardened arc) now take a per-table `pg_advisory_xact_lock_shared`, matched by an `EXCLUSIVE` lock in
eviction's per-table transaction — "eviction yields to in-flight reads" by construction, no DDL. HIGH review found
3 real findings (medium: the new SHARED lock collides, undisclosed and with no `lock_timeout`, with
`pipeline.ts`'s pre-existing EXCLUSIVE `--rebaseline` lock on the same key — a documented-not-fixed trade-off,
see below; medium: the query-count tripwire undercounted the true cost as +1 statement when wrapping in
`db.withTransaction` actually costs +3 round trips; low: an explicit-target/pinned-table assumption was
undocumented) — a fix round addressed all three (disclosure + a source-pin test for the lock coupling, corrected
tripwire numbers across query-count.test.ts + ADR 029 + row #195, an **Assumption** comment + a new pinning test
for the pinned-table dependency), re-verified, pushed as `ef4e35a`.

**Verified independently by this session (not just trusted from agent reports, per the GOLDEN RULE):** `gh pr
list --state open` shows exactly #126/#127/#128/#125/#124; `gh pr checks` on all three new PRs shows both `gate`
runs `pass` (19–26 min each) and `deploy` correctly `skipping` (non-main); `git rev-parse origin/fix/196-…` matches
the fix round's claimed head `ef4e35a`. Each PR's own verify-block: backend 116-117 files / 1780-1788 tests,
benchmark refusal 6/6 + 0 fabricated + GATE PASS, web 50 files / 584-585 tests, real `next build`. Cleaned up the
4 workflow worktrees + their throwaway local branches after confirming origin had every final commit.

**⚠ Worth your attention on #128 specifically (not a blocker, a disclosed trade-off):** the new lock is `SHARED` in
every chat query's `resolveIntent` and `EXCLUSIVE` in both `tables:evict --apply` (rare, manual, already true) AND
`--rebaseline` (the annual gemeente-reorg sync, ALSO manual but on a table that can be actively queried, e.g. via
`src/chart/curated.ts`'s homepage charts) — with no `lock_timeout`, matching this codebase's existing no-timeout
convention on every other advisory-lock site, but new for this particular coupling. Today both sides are
manual/supervised so it's the same accepted rare-contention risk eviction already carried, not a new production
hazard — just something to know about given this project's #173/#188/#190 pooler-incident history
(`MAX_POOL_CLIENTS_PER_PROCESS=2`) before merging. Full reasoning in PR #128's "Review round 2" section.

**No spend, no prompt bytes, no DDL, no flag flips — pure engineering.** The three build agents' own PRs already
carry their docs/open-questions.md row updates (#73/#79/#196) and touched ADRs/RUNBOOK — those land on `main` when
each PR merges, not before; this block is this session's own summary, pushed docs-only straight to `main` per the
established "code on branches+PRs, docs direct to main" convention (session 72's precedent) — a doc-only conflict
between a sibling PR's own STATUS.md/open-questions.md edit and this block, if any, is expected and gets resolved
at merge time exactly as session 73 resolved one for the #121/#122 batch.

**Later the same session (owner: "continue working autonomously... get as much work done as possible with
subagents") — Dependabot #124/#125 verification legwork done (still your merge click), plus one closed
investigation:** dispatched two more agents to checkout each Dependabot PR into its own worktree, run the full
verify block, and read the actual changelogs against real call sites — **PR #125 (web, 8 packages): clean, safe to
merge**, everything green (backend 116/1780, benchmark GATE PASS, web 50/584, real `next build`), no relevant
breaking change in any of the 8 bumps (checked each against actual usage — e.g. next's CVE fix doesn't apply, no
`next/image` in the app), comment posted. **PR #124 (root, 5 packages): DO NOT MERGE AS-IS — a real, reproducible
regression**, confirmed on CI itself (both gate runs fail identically) and locally: benchmark refusal/clarify gate
0/6 (needs 6/6), 49/1780 backend tests fail. Root cause identified AND bisection-confirmed (not just hypothesized):
`zod` 4.4.3→4.5.4 changes `z.toJSONSchema()`'s output bytes, which changes the SHA-256 hash the hermetic LLM
replay-fixture system keys on (`requestHash()` in `src/answer/llm/client.ts`) — pinning `zod` alone back to 4.4.3
in the same worktree (all 4 other bumps left in place) restored a clean `GATE VERDICT: PASS`, proving it by
elimination. The other 4 packages (`@anthropic-ai/sdk`, `stripe`, `@electric-sql/pglite`, `@types/node`) have no
evidence of any problem. Both findings posted as PR comments (not merges/approvals — that stays yours); new
open-questions row #200 records the underlying fragility (the fixture-hash system breaks on ANY non-behavioral zod
serialization change, not just this once) for whoever eventually revisits it. Also investigated (read-only, no
code touched) whether open-questions row #63's residual — `buildNeedsClarificationAsClarification`'s region
presets, never dry-run-verified — is still reachable now that WP26 is live: **yes, confirmed reachable** (traced
the call chain, corroborated by an existing passing test that deletes a live NL01 row and asserts the clarification
fires), but the fix's real payoff today is small (the one chip-able preset would almost always fail its own
dry-run at the exact moment this path fires under `ANSWER_FIRST_ENABLED`) — recorded in row #63, left open,
deliberately not prioritized. Also resolved a naming confusion in row #63's own prose: this builder is a QUERY-layer
missing-axis mechanism, architecturally unrelated to `policy.ts`'s rule-4 name-ambiguity mechanism the row's text
bundled it with. No spend, no prompt bytes, no DDL, no flag flips, no merges.

**▶ NEXT, in order — nothing urgent:** (a) review + merge #126/#127/#128 (any order, independent files except all
three touch docs/STATUS.md and docs/open-questions.md in different rows — expect trivial doc conflicts, not code
ones); (b) Dependabot #125 (verified clean, ready for your merge click) — **#124 is now blocked, do not merge
as-is** (see above; PR #124's comments have the full bisection); (c) `GDPR_PURGE_APPLY=1` + one watched run; (d)
#162's A/B; (e) #132 route B GO or defer; (f) the owner menu: WP30c choice, #199, #197 ideas 4–8, the three #197
follow-ups. **The three recorded hermetic follow-ups are now exhausted** — nothing else in the docs is currently
flagged as safe for a session to pick up without your input, so no further code work was started this session.

**▶ SESSION 75 (2026-09-03, OWNER PRESENT in the desktop chat — the session-73 kickoff pasted a THIRD time; a cloud
session calling itself session 74 was RUNNING on the same kickoff in parallel) — THE FOUR-PR BATCH IS MERGED AND LIVE:
#121 `527ef2e`, #120 `069a03e`, #122 `4fd6ea5`, #123 `ddca024`.** After ONE targeted question the owner chose staged
merges by the session (17:50Z). Serial squash merges, each with its own main run, deploy and canaries. Verification before
each step: a merge simulation with the cloud session's new #122 head (three orders → one tree `37fa0621…`) and the full
block on it (backend 116 files / 1780 tests, benchmark refusal 6/6 + 0 fabricated + GATE PASS, web 49 / 579, real `next
build`); a backstop block on merged `main` `4fd6ea5`; the final tree `main` + #123 = `9394d9c6…` — byte-identical to the
tree the cloud session's own block verified — re-verified locally (backend 116 / 1780, GATE PASS, web 50 / 584, `next
build`). **One process miss, recorded honestly:** #122 was merged at head `002f5b0`, two cloud-session commits past the
locally verified `04affae` (its gates were green, the cloud block covered it, the backstop confirmed it) — from now on
`gh pr merge --match-head-commit <full sha>` (RUNBOOK batch item 11); #123 was merged that way. The cloud session
(idle since its close-out `a249493`) is invisible to `list_sessions`; `ListAgents` is the second-instance check.
Post-merge docs push: every "PR pending owner review" wording → MERGED + LIVE (ADR 024/029, 04-architecture, 06-roadmap,
08-build-plan, RUNBOOK, open-questions rows 70/73/79/89/178/195/196/197); rows #195/#196, ADR 029's note and
04-architecture now carry #121's round-2 state. Details: [status-archive.md](status-archive.md) session-75 entry.

| PR | Merged as | Main run → deploy on the alias | Canaries `/`, `/llms.txt`, `/api/health` |
|---|---|---|---|
| **#121** | `527ef2e` 17:50Z | 33786945030 gate + deploy → `checkdecijfers-1zwvn3hh1…` | 200 ×3 at 18:09Z |
| **#120** | `069a03e` 18:10Z | 33788899139 gate + deploy → `checkdecijfers-b6smn8m5i…` (TypeScript 7.0.2 builds production since) | 200 ×3 at 18:26Z |
| **#122** | `4fd6ea5` 18:26Z (head `002f5b0`) | 33790545774 gate green, deploy SKIPPED itself (tip had moved to `a249493`); live via `a249493`'s run 33791021811 → `checkdecijfers-aw4si6dls…` | 200 ×3 at 18:44Z |
| **#123** | `ddca024` 18:51Z (head `92d4db7`, `--match-head-commit`) | 33793011578 gate + deploy → `checkdecijfers-5ofg8pp7v…` | 200 ×3 at 19:09Z |

**⚠ STILL ONLY YOURS:** `GDPR_PURGE_APPLY` (fully untouched — the flip + one watched run), the #162 A/B (real spend),
and now **Dependabot #124 (root, 5 updates) + #125 (web, 8 updates)** — opened minutes after #120 removed the ignore
stanza; review normally, never blind-merge. #198 stays PARKED at your word. Both WP26 flags ON.

**▶ NEXT, in order — nothing urgent:** (a) Dependabot #124/#125 (owner review; the monthly agenda's dependency item);
(b) `GDPR_PURGE_APPLY=1` + one watched run; (c) #162's A/B; (d) #132 route B GO or defer; (e) the owner menu: WP30c
choice, #199 (a proof panel on the dashboard history — a small read-model WP), #197 ideas 4–8, the three #197
follow-ups.
**The three review follow-ups recorded here are now ALL BUILT + MERGED** (built session 76, merged session 78):
the carrier on `ChatMessage` + the ⟨A6⟩ `capturedThreadId` simplification (row #73, PR #126, merged `95c7487`);
one shared R5 predicate — `csv.ts` had applied a narrower rule (row #79, PR #127, merged `676facf`); eviction now
YIELDS to in-flight reads via a per-table `pg_advisory_xact_lock`, SHARED in `resolveIntent`'s read arc and
EXCLUSIVE in eviction's per-table transaction (row #196, PR #128, merged session 78) — see
[open-questions #196](open-questions.md) for the full as-built note.

**▶ SESSION 74 (2026-09-03, AUTONOMOUS — the SESSION-73 kickoff pasted again from the phone app; no owner reply in chat;
`list_sessions`: the earlier session 73 idle, no second RUNNING instance) — HIGH-EFFORT PASSES ON #122 AND #123 BEFORE
MERGE DAY, BOTH FIXED ON THEIR BRANCHES, THE BATCH RE-SIMULATED AND RE-VERIFIED — WHILE A SECOND, OWNER-PRESENT SESSION
MERGED #121, #120 AND THEN #122 IN PARALLEL; #123 IS THE ONE STILL OPEN — GATES GREEN, MERGE PENDING.** A remote-control session started
17:33Z (owner present) squash-merged #121 as `527ef2e` (17:50Z; main run 33786945030 green, its deploy on the alias, the
canaries 200) and #120 as `069a03e` (18:10Z; main run 33788899139 success — gate 18:10→18:23Z, deploy 18:23→18:25Z; its deployment `dpl_GjA6ge1ZCTp3SuRjbEsGRrGTbwsr` (`checkdecijfers-b6smn8m5i…`, created 18:24:59Z, `meta.githubCommitSha` = `069a03e`) is on the alias; `/`, `/llms.txt`, `/api/health` 200 at 18:26–18:27Z — TypeScript 7.0.2 builds production from here on) — this session saw it on the `git fetch`
before its docs push, not before; Dependabot opened #124 (root, 5 updates) and #125 (web, 8 updates) within two minutes
of #120's merge, the ignore stanza being gone. That session then squash-merged #122 as `4fd6ea5` (18:26:47Z, head `002f5b0` —
this session's round 2 included). New `main` + #122 + #123 is the very tree block 4 verified (`9394d9c6…`, both orders),
so `4fd6ea5` + #123 is too. #122's round-1 client fix could discard an OPEN clarification round (a glance at an older chip, then a typed reply → sent
as a fresh question, the paid round lost) and lost the race with an in-flight answer; a B-defaulted answer's chips named
no place over an explicit `NL01` intent (the take served with no R7 disclosure); a stripped carrier's fresh parse was
recorded as `clarify` (#177). #123's "Geen bewerking toegepast … de waarde uit de cel" fired SINGULAR under "Gelezen: N
cellen" on every multi-cell comparison (the G4 chips, live); a stored derivation of an unknown kind would have thrown in
the component, outside the builder's try/catch; the panel contradicted the answer's own CC BY marking on a
`first_last`-only result. All fixed and pinned on the branches, each delta LOW-reviewed (RUNBOOK batch item 10 measured
again: nine + six HIGH findings, and every LOW pass over a fix found more — two of them the session's own wrong claims).
Blocks: both branches and the combined tree of the FINAL heads green — typecheck ×2, backend 116 files / 1780 tests, benchmark answerable 14/14 + refusal 6/6 + 0 fabricated (GATE PASS), web 50 files / 584 tests, real `next build` under TypeScript 7.0.2 (TypeScript step 0.7 s); three merge orders → one tree
`9394d9c6…`. Gates on the final heads: #122 `002f5b0` runs 33788083444 (push) + 33788089643 (pull_request), both success; #123 `92d4db7` runs 33788997612 (push) + 33789010370 (pull_request) both success (18:27:48Z / 18:27:58Z). Details: [status-archive.md](status-archive.md) session-74 entry.

| PR | Head now | Merge | Left for you |
|---|---|---|---|
| **#121** | MERGED 17:50Z by the parallel session — squash `527ef2e` | — | nothing; the post-merge docs wording waits for #122 (conflict zone) |
| **#120** | MERGED 18:10Z by the parallel session — squash `069a03e` (TS 7.0.2 in production once its deploy lands) | — | if a deploy ever goes red on the TypeScript step, revert this one commit |
| **#123** | `92d4db7` (round 2 on top of `3d185a1`, one code commit) | clean | merge — or veto a default (label, inline vs dock, ids toggle, collapsed) |
| **#122** | MERGED 18:26:47Z by the parallel session — squash `4fd6ea5` (head `002f5b0`: round 2 included) | — | its main run + deploy + canaries: the parallel session's close-out records them; veto point still open in substance: a defaulted answer's chips now say "… in Nederland …" (revert = one PR) |

**▶ NEXT, in order — nothing urgent:** (a) merge #123 (conflict-free against the new `main`; the parallel session was
presumably waiting for its gates), let its deploy finish, a canary on `/`, `/llms.txt`, `/api/health` (from a cloud
session: through the Vercel MCP tools — RUNBOOK multi-agent item 10); then the post-merge docs push that turns the
"PR pending owner review" wordings (ADR 029, rows #73/#79/#195/#196, the build plan) into MERGED + LIVE and brings rows
#195/#196 + ADR 029's note + 04-architecture to #121's round-2 state; (b) `GDPR_PURGE_APPLY=1` + one watched run; (c)
#162's A/B (real spend); (d)–(e) as in the session-72 block below, which otherwise still holds. Recorded, not built: the
carrier on `ChatMessage` once #123 has merged; the ⟨A6⟩ `capturedThreadId` simplification; one shared R5 predicate
(`csv.ts` applies a narrower rule) — rows #73 and #79. Also new: Dependabot #124/#125 — the first update PRs since the
TypeScript hold left the ignore stanza; the monthly agenda's dependency item, yours to review (never blind-merge).

**▶ SESSION 73 (2026-09-03, AUTONOMOUS — the session-73 kickoff pasted, no owner reply in chat, `list_sessions` showed
no second instance) — THE FOUR PRs ARE NOW MERGE-CLEAN IN ANY ORDER; STILL NOTHING MERGED, NOTHING FLIPPED.** A
serial-merge simulation of session 72's four PRs (scratch worktree, #121 → #120 → #123 → #122) merged all CODE cleanly
— the shared `chat.tsx` of #122/#123 included — and conflicted only on DOCS between #121 and #122 (ADR 029's header +
top as-built note, open-questions rows 195–197). Fixed ahead of merge day: PR #121's docs lifted onto `main`
(`8a3fb06`, hunks identical to the PR's), `main` merged into #122 with the overlap resolved once (head `db3aabb` →
`0ffe4c0`) and into #121 (head `93db80a` → `0a7bad8`); code on both branches byte-identical to the heads session 72
reviewed. Re-simulated in three merge orders: all clean, one and the same tree, identical to the tree the FULL block
passed on (typecheck ×2, backend 116 files / 1771 tests, benchmark 14/14 + 6/6 + 0 fabricated, web 49 files / 575
tests, real `next build` under TS 7.0.2). CI: main run 33749095613 (`8a3fb06`) success, its deploy
`checkdecijfers-87b7zd0jh…` on the production alias (tip check matched), `/`, `/llms.txt`, `/api/health` 200; the
gates on the moved heads all success — #121 runs 33749196246 + 33749200112, #122 runs 33749190942 + 33749196611; all
four PRs `MERGEABLE`/`CLEAN` at close. Session-73 notes on #121 and #122 record the moved heads. Rollback if #121 is
vetoed: `git revert 8a3fb06`. Details: [status-archive.md](status-archive.md) session-73 entry.

**Later the same session (owner: "pick up another task autonomously"; the merge question got no reply, so the merges
stayed yours): a HIGH-effort adversarial review of #121 found fifteen verified items on the session-72 fix, which LOW
had passed clean — the moved touch still queued behind the eviction's row lock, a TOCTOU in the re-check that could
re-create the false `not_published`, raw period codes / a too-new sync date / a silenced staleness warning in the same
race, and the benign race paging you as an internal error. All fixed on the branch (`0a7bad8` → `ebd341f`: skip-locked
touch, one-snapshot fetch, check-last, a `table_evicted`/`evicted` refusal with honest Dutch copy, the registry facts
carried on the result, docs/05 row); one structural follow-up recorded (eviction must yield to in-flight reads before
any live automation). Branch block green, LOW 0, the combined tree re-verified (three orders → one tree, full block
green); gates on `ebd341f`: runs 33756815650 (push) + 33756820787 (pull_request) both success; all four PRs
`MERGEABLE`/`CLEAN` at close (GitHub read `UNKNOWN` for ~30 s right after the docs push — the recompute window,
RUNBOOK batch item 8).**

| PR | Head now | Merge | Left for you |
|---|---|---|---|
| **#121** | `ebd341f` (review round 2 on top of `0a7bad8`; code + tests + one docs/05 row) | clean | merge |
| **#120** | `5c4c88f` (unchanged) | clean | merge; revert this one commit if a deploy ever goes red on the TypeScript step |
| **#123** | `3d185a1` (unchanged) | clean | merge — or veto a default (label, inline vs dock, ids toggle, collapsed) |
| **#122** | `0ffe4c0` (docs resolved against `main`, code unchanged) | clean | merge — veto point: template phrasing on chip takes |

**▶ NEXT, in order — nothing urgent:** (a) merge the four PRs — any order is conflict-free now; still one at a time,
each deploy allowed to finish, a canary on `/`, `/llms.txt`, `/api/health` after each (the session-67 discipline);
then a docs push that turns the "PR pending owner review" wordings (ADR 029, rows #73/#195/#196, the build plan) into
MERGED + LIVE and brings rows #195/#196 + ADR 029's note to the round-2 state (`table_evicted`/`evicted`, the
one-snapshot fetch); (b) `GDPR_PURGE_APPLY=1` + one watched run; (c) #162's A/B (real spend); (d)–(e) as in the
session-72 block below, which otherwise still holds.

**▶ SESSION 72 (2026-09-03, AUTONOMOUS — you said "work hours and hours autonomously, use multiple subagents") —
FOUR PRs WAIT FOR YOUR REVIEW, NOTHING MERGED, NOTHING FLIPPED.** The session-66 pattern: code on branches + PRs
(#118 rule b), docs direct to `main`. Every PR carries a review comment from the session with the measured full
verification block (typecheck ×2, backend suite, benchmark 14/14 + 6/6 + 0 fabricated, web suite, real
`next build`) and a LOW code-review pass; every PR's CI gate is green (all four verified at close, 2026-09-03). **Merge order
suggestion:** #121 → #120 → #123 → #122 (the last two both touch `chat.tsx` — #122 only adds a ref and a click
handler, #123 adds a field on `ChatMessage`; no shared lines, but merge serially and let each deploy finish).

| PR | Branch (head) | What | Left for you |
|---|---|---|---|
| **#121** | `fix/195-196-eviction-probe-touch` (`93db80a` → `0a7bad8`, session 73: docs-only merge from `main`) | #195/#196: servability probes no longer bump `last_queried_at`; the bump runs after the fetch (a read never waits behind an eviction lock); an eviction landing mid-query yields an honest refusal. Round 2 (session 73, `ebd341f`): skip-locked bump, one-snapshot fetch, check-last, `table_evicted`/`evicted`; tripwires re-measured again (21 / 8 / 12). Tripwires 27→24 / 12→10 / 18→15. | merge |
| **#120** | `chore/ts7-lift` (`5c4c88f`) | The TypeScript-7 hold lifted: Next 16.3 type-checks through the `tsc` CLI; TS 7.0.2 root + web, Dependabot ignore stanza removed; proven with a real `next build` twice (agent + session). | merge; if the deploy ever goes red on the TypeScript step, revert this one commit |
| **#123** | `feat/70-79-89-drill-through` (`3d185a1`) | "Bewijs dit cijfer": one panel, three depths (reading + alternates / the cells / the step list), client-side over the stored envelope, no backend, no flag. Design brief with defaults on `main` (`093380b`). | merge — or veto a default (label, inline vs dock, ids behind a toggle, collapsed by default) |
| **#122** | `feat/73-v2-click-take-chips` (`db3aabb` → `0ffe4c0`, session 73: docs-only merge from `main`) | #73 v2: every follow-up chip is a zero-LLM click take on the WP26 carrier (adjacent period, trend, region variant, same topic — not only the comparisons). Review round 1 fixed a carrier-validation defect and a per-message binding trap. | merge — veto point: template phrasing on chip takes instead of LLM phrasing; 20 credits per take unchanged |

**Also on `main` this session (docs only):** the stale-doc sweep `5aa48c3` (ADR 029's #138 line, the build plan's #111
framing, rows #34/#65/#66/#72/#42/#116 to their real state, #151 measured: 0 rows to backfill) and the drill-through
design brief `093380b`. **Read-only maintenance, all clean:** `gdpr:purge` dry-run 0 rows in every leg; RLS audit
18/18 tables; `npm audit` 0 in root and web; no Dependabot alerts. `scripts/verify-block.sh` + RUNBOOK
"Multi-agent autonomous sessions" 6–9 record the day's operational finds (the `pgrep -f vitest` self-deadlock, the
10-minute Bash cap, ~8-minute full blocks on an idle machine, `npm ci` before any local verification).

**⚠ STILL ONLY YOURS:** `GDPR_PURGE_APPLY` (fully untouched — the flip + one watched run) and the #162 A/B (real
spend). #198 stays PARKED at your word. Both WP26 flags are ON and smoke-tested (sessions 69–71).

**▶ NEXT, in order — nothing urgent:** (a) review + merge the four PRs above (serially, each deploy allowed to finish;
a canary on `/`, `/llms.txt`, `/api/health` after each — the session-67 discipline); the RUNBOOK's migration-025
section already records #195/#196 closed (lifted to `main` in session 73, `8a3fb06`); (b) **`GDPR_PURGE_APPLY=1`** plus one watched run — dry-run
baseline re-measured today (0 rows everywhere); (c) **#162's A/B** (~€1-2 live spend, needs your read-back);
(d) **#132 route B** GO or defer (last asked 2026-09-02); (e) the owner menu: WP30c choice (Rijksfinanciën `80504NED`,
`Gediscontinueerd`), #199 (a proof panel on the dashboard history — needs a small read-model WP), #197 ideas 4–8
(unscheduled), the three recorded #197 follow-ups (tautology / history titles / carrier on resume — untouched).

**Tracked, deliberately NOT built:** [#174](open-questions.md), [#185](open-questions.md) (held), [#188](open-questions.md)
(concurrency on a live money path — supervised), [#190(a)](open-questions.md) (yours), [#178](open-questions.md)'s
age-bound/TTL half (yours; the per-message carrier binding in #122 narrows the label-collision part of it, the age
bound is still open).

**▶ SESSION 71 (2026-09-03, owner present) — WP26 SMOKE TEST PASSED, #197 STEP 3 MERGED + LIVE, A DEPLOY RACE
FOUND AND GUARDED.** Started by checking production instead of asking: still zero chip-click takes. Your
first attempt (the one-word "Utrecht", row 260) was refused as smalltalk and refunded — the RUNBOOK's
"bare Utrecht works" was a wrong summary of the test case, fixed in `2d27175`. The real flagship question
`Hoeveel inwoners had Utrecht in 2024?` clarified with two chips (row 261) and your click on "Utrecht
(gemeente)" produced row 262: `parse.model = deterministic/wp26-click-option`, 0 tokens, `template`,
20 credits, `audit:verify` 2/2 clean. On that evidence PR #118 was squash-merged as `83f790e` (CI run
33699880673 gate + deploy green). **Then the deploy race:** the docs run for `2d27175` finished its
deploy one minute AFTER the merge's and re-aliased production to the PRE-merge code while both runs were
green; caught by `vercel inspect`, fixed instantly with `vercel promote` of the `83f790e` deployment, and
guarded for good: the deploy job now skips itself when its commit is no longer the tip of `main`
(RUNBOOK "Two CI runs in flight") — measured working on its first real overlap the same night (run
33702138479 skipped its deploy in favour of 33702205292, both green, alias on the newer deployment). Also: the RUNBOOK's click-row query looked in the wrong column
(`llm_calls` is `[]` on a click take; the model lives in `response->'parse'->>'model'`), corrected.
Hygiene: the s70-reviewer worktree removed, 28 stale local branches + 9 merged remote branches deleted;
open-questions.md triaged (every row read) — 25 terminally-closed rows moved to its archive twin, 147 live.
**`CLARIFY_CLICK_ENABLED` ON and proven; `ANSWER_FIRST_ENABLED` ON since 2026-09-03 on your explicit go in
chat (env set 05:40Z, deployed by run 33719897606 together with the #175 fix that gives the anonymous trial
the same flag). Canaries measured: the REGION default is proven live (row 269: `regionDefaulted`, national figure with the
disclosure line, G4 chip); the PERIOD default fires but the live parse scores a period-less reading 0.85 < 0.9,
so R7 still confirms with one chip (row 266 → click → the trend, row 267) instead of answering directly —
[#198](open-questions.md). You chose option 1 (a prompt rule); three wordings were tried and REVERTED the same
session — each made the parser hesitate on the on-demand bijstand delivery parse (0.92 → 0.88 → 0.85, under the
0.9 line). Nothing shipped, ≈ $10 Haiku spend, measurements + a concrete option-2 proposal in #198; you said
"later" — PARKED, not blocking (one click answers). Also fixed on your report: the double footer on the
logged-in page (one site-wide footer with the gear icon to `/systeemoverzicht`, live and verified).
`GDPR_PURGE_APPLY` still untouched — yours.** Details, every SHA and run id:
[status-archive.md](status-archive.md). **Step 6 (the comparison chip) also PASSED later the same day: rows 263/264 — the take
has the click model, 0 tokens, GM0363 + NL01, a 2-series bar chart, 20 credits, R8 clean.** **Nothing is
waiting on you:** #198 parked at your word; `GDPR_PURGE_APPLY` and the #162 A/B stay yours for whenever.

**▶ SESSION 70 (2026-09-02, later the same day — TWO sessions received the kickoff in the same tree; the
second became the independent reviewer in a worktree) — #197 STEP 3 BUILT ON A BRANCH (merged in session
71, above).** Two comparison generators ("Vergelijk met Nederland" / "Vergelijk met Amsterdam, Rotterdam,
Den Haag en Utrecht" / "Vergelijk met <a year earlier>"), each a dry-run-proven `ClickOption` on a
present-only `AnswerResponse.pending` in the WP26c chip-carrier shape, taken through the zero-LLM
`templateOnly` path as a NEW validated result (R6), 20 credits; only with `CLARIFY_CLICK_ENABLED` on,
byte-identical off. Reviewer's 7 verdicts folded in. Verified: backend 114 files / 1733 tests, benchmark
14/14 + 6/6 + 0 fabricated, web 537/537, `next build`, LOW review 0 findings; branch CI green on `02a328e`
and `e6b5846`. Owner's rows 257–259 (02-09 12:43Z) were Anthropic 529 overloads, refunded. Two docs
commits went red on the #132 no-live-PR-links test, fixed in `fcbb479`. Details: ADR 029 first as-built
note, ADR 024 last addendum, [status-archive.md](status-archive.md).

**▶ SESSION 69 (2026-09-02, owner present) — cleared most of the RUNBOOK queue.** Applied all 4 pending
migrations (022 found undocumented but additive/023/024/025) to production, verified clean. Flipped
`CLARIFY_CLICK_ENABLED` live — gate+deploy green, but **the live chip-click smoke test is still
unconfirmed** (Claude has no login access; you still need to run it — RUNBOOK's 3-step procedure).
Closed [#193](open-questions.md) for real: live `audit:verify` found zero divergent rows against
production, nothing to pin. Mid-session you redirected to chart/graphics UX research (see below) and
pulled [#170](open-questions.md)(3) forward: chart download-as-image now ships, **both PNG and SVG**, via
a new `ChartDownloadMenu` (`web/components/chart-download.tsx`) — mirrors StatCard's #80 PNG pattern,
adds a shared attribution footer baked into the exported image itself so a downloaded chart still carries
its source once it leaves the page. 502/502 web tests green, LOW code-review run (2 findings fixed:
missing SVG failure-handling, duplicated width/height derivation), pushed directly (`4d7ac2d`), CI green.
**Declined to flip `GDPR_PURGE_APPLY=1` or run the #162 A/B** — real deletion and real spend are exactly
the owner-supervised carve-out CLAUDE.md excludes from standing push authorization, so the dry-run
baseline (0 rows everywhere) stays the only thing captured this session. [#132](open-questions.md) route
B re-asked, you said defer again. Ran a 5-agent background research workflow (`chart-graphics-research`;
`claude-fable-5-1` for the UX-vision and architecture angles) on how to improve the charts for end
users. Result: [#197](open-questions.md), full proposal in
[session-briefs/2026-09-02-session-69-chart-ux-research.md](session-briefs/2026-09-02-session-69-chart-ux-research.md)
(also a Claude Artifact for a readable version) — 8 ranked ideas, a first-three build order, 10 owner
decisions. One fabricated claim in the raw research (a nonexistent "palette validator" script) was
caught and removed before publishing. **GO given in-chat the same day (after switching the session to
Fable 5.1); step 1 BUILT:** numbers back on the chart (axis min/max, end-of-line and per-bar labels —
spec strings only, bound to resultIds), colour-blind-safe `--series-1..4` palette + dash patterns +
hatched provisional bars, accessible name + announced tooltip, tap-to-pin on touch, ≥ 24 px targets,
download menu with real menu semantics AND computed-paint inlining (the #170(3) export had serialized
`var(--token)` strokes no standalone file can resolve — found and fixed here), toggle as a radiogroup,
a `schemaVersion` guard in the web renderer, ADR 014 as-built rule for optional v1 fields. Web
renderer only; spec/builder/audit rows untouched. 27 new tests render the real svg in jsdom; web suite
529/529. **Step 2 BUILT too:** a Grafiek/Tabel switch on every chart (period × series, comparisons one
row per region, null cells as "— (reason)", >15-series comparisons open on the table); no duplicate CSV
entry in the menu — WP21's button already sits under every chat answer. Step 3 (comparison chips) was
built in session 70 and merged + LIVE in session 71 (`83f790e`, above).

**▶ SESSION 68 (2026-08-28 into 2026-08-31, local +07, owner present, spanned three calendar days in one
continuous conversation) BUILT `/systeemoverzicht` — a public architecture reference page, on direct
owner request, NOT a queued work package.** Mirrors the equivalent system-map page on the owner's other
project (GlaiBaan): the big-picture system diagram, the 8-step journey of one question, an ALLOWED/NEVER
AI-scope list, every external service with cost/status, scheduled automations, and the "built, off"
flags — reachable via a gear icon in the footer. Three commits, one per follow-up request: `0fbd37a` the
page itself, `d328213` an EN/NL toggle added two days later (English default per owner instruction, Dutch
second), `f2b3975` a visual double-footer fix one day after that. Two real issues found and fixed before
their respective pushes: the route was missing from `proxy.ts`'s public-path allowlist (would have
silently redirected every visitor to `/login`) and `StatusLegend` hand-duplicated `StatusPill`'s styling
(caught by the pre-push LOW code-review). Full narrative, every verification step:
[status-archive.md](status-archive.md) (prepended below).

**FOUR OPEN PRs (2026-09-03, session 72): #120, #121, #122, #123 — every one with a green gate and a session-72 review
comment; see the session-72 block above for what each does and the suggested merge order. Their four branches plus
`origin/main` are the only remote branches.** Verify yourself: `gh pr list --state open` shows exactly those four;
`gh run list --branch main -L 3` all `success`. #197 steps 1+2+3 are LIVE on prod.

Full session-67 record (reviewed + merged all 19 PRs session 66 left open, #99-#117): [status-archive.md](status-archive.md) (prepended) +
[session-briefs/2026-08-28-session-67-close.md](session-briefs/2026-08-28-session-67-close.md).

Full session-62 record: [status-archive.md](status-archive.md) +
[session-briefs/2026-08-26-session-62-resume-log.md](session-briefs/2026-08-26-session-62-resume-log.md).
Full session-63 record: [status-archive.md](status-archive.md) (prepended) +
[session-briefs/2026-08-26-session-63-resume-log.md](session-briefs/2026-08-26-session-63-resume-log.md).
Full session-64 record (the 8-PR bridge chain + Dependabot backlog that got `main` to zero open PRs that
day): [status-archive.md](status-archive.md) (prepended).
Full session-65 record (the root-`nanoid` HIGH-alert fix, `#194`, and the queue session 66 executed):
[status-archive.md](status-archive.md) (prepended) +
[session-briefs/2026-08-27-session-66-autonomous-queue.md](session-briefs/2026-08-27-session-66-autonomous-queue.md).
Full session-66 record (the entire queue executed, 17 PRs, zero merged):
[status-archive.md](status-archive.md) (prepended) +
[session-briefs/2026-08-28-session-66-close.md](session-briefs/2026-08-28-session-66-close.md).
Full session-68 record (this session — `/systeemoverzicht`, direct owner request):
[status-archive.md](status-archive.md) (prepended above).

---

**(Historical — the pause, 2026-08-15 to 2026-08-26.)** Project was paused ~2 months (owner decision) and the
repo set PRIVATE at the same time ([#132](open-questions.md) option D). Production stayed live and unattended
throughout, correctly: `/` and `/llms.txt` 200 the whole time, no data corruption, the trial pot untouched.
The GDPR retention clock does not pause — first purgeable rows land ~2026-10-15, right at the resume point;
handled above. Full pause-era detail in the session-61 halt entry, [status-archive.md](status-archive.md).

**(Historical from here down.)**

**(Sessions 58 + 58B, 2026-07-25 evening/night — TWO AUTONOMOUS overnight runs. ⚠ THE OWNER
STARTED TWO SESSIONS ON THIS BRIEF; both ran, split the queue over a cross-session channel, and both shipped.
Read [status-archive.md](status-archive.md) for the full record and the merge order.**

**✅ ALL FOUR ARE MERGED AND LIVE** (owner present in-chat, 2026-07-25 evening; he delegated the merge call to
the session with *"jij bent de expert"*). Merged **serially**, one deploy at a time, gate+deploy green and a
production canary between each — the #173 discipline. **Both WP26 flags are still OFF; that go-live is his.**

| # | PR | Squash | What | CI + canary |
|---|---|---|---|---|
| 1 | PR #64 | `58c814b` | Server Action arguments were type-checked only by `.length`, so a content-block array (`.length === 1`) drove a ~1 MB prompt at a flat credit price — on the PAID path too, not just the trial. | gate+deploy ✅, 200/200 |
| 2 | PR #67 | `b05a1d3` | 58b's trial hardening: a non-UUID requestId reached the LLM and was rejected only by the R8 insert (served with `auditId: null`); the landing asserting an unverified "pot is leeg"; `x-forwarded-for`/HMAC-secret defaults; the purge's bare `catch`; the cap clamp. **Plus [#177](open-questions.md)** (the rescue parse now records `'intent'`, not `'clarify'`). Rebased onto #64 — guard order `typeof question → length → trialConfigured → requestId shape`. | gate+deploy ✅ (run 30160467319), 200/200 |
| 3 | PR #65 | `ed5f240` | The conformance bundle: the double-default test, single-sourced `NL01`, the envelope-key manifest, the query-count pin. Disjoint — floated. | gate+deploy ✅, 200/200 |
| 4 | PR #66 | `b4da3b2` | This docs close-out. Conflicted with #67 in `open-questions.md`, `lessons-learned.md` and the RUNBOOK — resolved by **taking both sides** (rows #179-#186 from 58b, #187-#190 from 58; both session sections kept). | — |

**Measured on `main` AFTER all four merges, arithmetic checked:** backend **1536 / 101 files**
(1509 + 3 from #67 + 24 from #65) and web **397** (385 + 6 from #64 + 6 from #67); benchmark **14/14 + 6/6 +
0 fabricated, GATE PASS**; real `next build`. Redo that arithmetic after any future merge — it is the check
that catches a silently-dropped file.

**The measured result the queue asked for:** the fixture-snapshot saving is **70-145 s, not the retracted
240 s** — and the within-arm spread exceeds the between-arm difference, so at n=2 the magnitude is not
resolvable. Full four-leg table in ADR [009](decisions/009-hermetic-test-database.md).

**✅ [#189](open-questions.md) — `gdpr:purge` IS scheduled now** (it was not, and nothing had noticed: no cron,
no CI schedule, no RUNBOOK duty, while two retention clocks depended on that one command). A monthly Vercel cron
runs it, **dormant** until `GDPR_PURGE_APPLY=1`. The first trial rows become purgeable **~2026-10-15**, so the
flip has time — but it is the one thing standing between the code and the promise.

**▶ NEXT, in order:** (a) ~~review + merge~~ **DONE — all four merged and live, see the table above**; (b) the **owner-supervised WP26
go-live** — one flag at a time, RUNBOOK section "WP26 answer-first + clickable options", NOT during a deploy
burst (#173); (c) **~30/7 BBP+PPI syncs** (`85880NED` MUST use the chunked escape hatch, RUNBOOK step 5);
(d) re-ask **#132 route B**.

**✅ THREE MORE ITEMS BUILT AND LIVE under the autonomy steer, each deployed on its own with a production canary
between** (serial per [#173](open-questions.md)). Measured after those three (`e88cfea`): backend
**1544 / 102 files**, web **417 / 41 files** — the FINAL numbers are below, after the review round. CI green on
every commit, production 200 on `/`, `/llms.txt`, `/login` after each deploy.

| # | PR | Squash | What | Left for you |
|---|---|---|---|---|
| [#189](open-questions.md) | PR #68 | `fbffe48` | The GDPR purge is **scheduled monthly** at last — nothing ran it before, and the first trial rows become purgeable **~2026-10-15**. Ships **DORMANT**: reports only. A review caught a blocker first — the route was missing from the proxy allowlist, which would have made the cron read as scheduled AND healthy while never running once. | **`GDPR_PURGE_APPLY=1`** + one watched run (RUNBOOK). Unsetting it is a full rollback. |
| [#182](open-questions.md) + [#187](open-questions.md) | PR #69 | `33a051d` | The per-IP backstop bounded **nothing** over IPv6 (a /64 gives one visitor 2^64 buckets); now keyed on the /64. #187 answered from Vercel's docs — `x-forwarded-for` is **not** forgeable on Hobby — and the code now reads the proxy-safe `x-vercel-forwarded-for` first, which matters the day Cloudflare fronts the apex. | — |
| [#180](open-questions.md) | PR #70 | `e88cfea` | The trial pot now **warns at 5 and reports empty**. It had no watcher: an outsider drains a 25-question pot for well under a euro and you'd find out by looking at the homepage. | — |

**✅ THEN A MAX-EFFORT REVIEW OF THAT WORK — PR #71, `d4ade6d`.**
Ten finder angles over the three merged PRs returned 15 findings; **four were defects introduced hours earlier the
same night**, the sharpest being a `??` that reintroduced an empty-header bug three lines above the comment
explaining why it had to be `||`. **14 fixed, 1 skipped with reasoning.** Three findings turned out to be three
spellings of one bug, so `ipBucketKey` was rebuilt to normalise once rather than gain a fourth special case; the
pot-alert latch now keys on DELIVERY rather than on the attempt; the proxy allowlist splits into exact and prefix
lists. Live-verified after deploy: `/api/gdpr-purge-cron` returns 401 (its own auth) and
`/api/gdpr-purge-cron-status` returns 307 — the prefix widening is genuinely closed. Final: backend **1545 / 102
files**, web **425 / 41 files**, benchmark **14/14 + 6/6 + 0 GATE PASS**.

**[#185](open-questions.md) was DECLINED with reasoning, not shipped** — the suggested fix would charge
infrastructure failures to visitors to close a hazard that is unreachable and already bounded by the trial key's
hard spend cap. A reviewer asked to attack that decision agreed. Better future fix recorded in the row.

**▶ AND FOR AN AUTONOMOUS SESSION — start here, not at the owner.** Owner steer 2026-07-25: *"I want you to work
autonomously."* Everything previously parked on him now has a written default, bound and rollback in
**[session-briefs/2026-07-26-autonomous-followups.md](session-briefs/2026-07-26-autonomous-followups.md)** (and the kickoff: **[session-briefs/2026-07-26-session-59-kickoff.md](session-briefs/2026-07-26-session-59-kickoff.md)** — the two earlier session-59 kickoffs are superseded) —
**#187** (two requests, ~€0.04, expected result: the header is NOT forgeable), **#189** (build the purge cron,
dry-run behind a flag), **#181/#183** and the residuals #180/#182/#184/#185/#186/#174 each with a recommended
default. Act under #118(b) (branch + PR) and let him veto by exception. **The ONE exception is the WP26 flag
flip — he has reserved it in his own words, repeatedly, and it stays his.**

Full session record in [status-archive.md](status-archive.md).)**

**Session 57 (2026-07-25 — autonomous overnight, then owner-present for the
merges. **ALL FOUR PRs ARE NOW MERGED AND LIVE** (`e334590` #60, `ea71c96` #61, `29e9e8b` #62, `447fca9` #63), each deployed separately with a settling gap and a production check between — deliberately, per #173.
Production verified healthy after every deploy: `/llms.txt` 200, `/` 200, Ontdek section rendering.
**⚠ THE WP26 FLAGS ARE STILL OFF — that go-live is yours, and the corrected rollback order below matters.**

**▶ THE NEXT SESSION IS ANOTHER AUTONOMOUS OVERNIGHT RUN** — queue in
[session-briefs/2026-07-26-overnight-queue-2.md](session-briefs/2026-07-26-overnight-queue-2.md):
the conformance bundle, a clean A/B of the fixture-snapshot saving, #177, and a Fable adversarial pass on the
anonymous-trial surface (the only anonymous money-adjacent surface, and un-hunted).

(Historical, from the autonomous phase of this session: €0 live-LLM product spend, zero prompt bytes, no DDL, both WP26 flags still OFF.**

| PR | What | CI |
|---|---|---|
| PR #60 | #173(c): pg pool `max` 4 → 2 per process. 3 busy processes fitted under the 15-session ceiling; now 7 do. | green |
| PR #61 | Fixture DB ingested once per run, not once per suite. Measured per suite: **build 7.9-10.7s → restore 1.2-1.4s**. Suite level, MEASURED properly 25/7 in a 4-leg alternating A/B: **70-145 s saved, not the 240 s first quoted** (ADR 009). | green |
| PR #62 | WP26 trust-boundary hardening + the corrected RUNBOOK rollback order. | green |
| PR #63 | Doc-consistency sweep, the Fable architecture memo, and this close-out. | green |

**⚠ TWO THINGS TO KNOW BEFORE THE WP26 GO-LIVE — both found tonight, both change what you should do:**
1. **The RUNBOOK's rollback order was WRONG.** Correct order: turn `CLARIFY_CLICK_ENABLED` **off first**, leave
   `ANSWER_FIRST_ENABLED` on for a day, then turn that off. Rolling B back while A is on strands region-less
   chips in open tabs as guaranteed refusals, and "both together" is **not** a safe shortcut (same refusal, plus
   a wasted LLM call). Fixed in PR #62 — merge it before the flip.
2. **The anonymous trial never receives either flag** ([#175](open-questions.md)). Flipping them changes the paid
   product and NOT the trial — the surface whose measured misfires motivated WP26c. Also: a logged-out smoke test
   would therefore prove nothing. This is a product decision, so the session did not make it.

**The Fable architecture review** (5 agents, one per question, + a synthesiser) is at
[session-briefs/2026-07-25-wp26-architecture-review-memo.md](session-briefs/2026-07-25-wp26-architecture-review-memo.md).
Verdict: architecture in good shape, the honesty seam came through WP26 clean; the one cross-cutting problem is
that the project **pins every rule about a NUMBER with machinery and every rule about the SYSTEM with prose**.
Its top three: fix the RUNBOOK (done, PR #62), decide the trial-flag question, and add the small conformance
bundle (a double-default test, a single-sourced `NL01`, an envelope-key manifest, a query-count pin).

**Also recorded, not fixed — [#174-#178](open-questions.md)**, each with the reasoning for deferring. The one
worth reading is **#174**: a client-held `impliedRecency` bit can turn a stale-table refusal into a served
figure, and the obvious fix is *worse than the bug* (it would make legitimate historical chips start refusing).
It needs a decision about what the bit means.

**▶ NEXT, in order:** (a) review + merge the four PRs; (b) the **owner-supervised WP26 go-live** — one flag at a
time, RUNBOOK section "WP26 answer-first + clickable options", NOT during a deploy burst (#173, `/llms.txt` = 200
is the cheapest canary); (c) **~30/7 BBP+PPI syncs** (`85880NED` MUST use the chunked escape hatch, RUNBOOK step
5); (d) re-ask **#132 route B**; (e) then the owner menu: WP30c choice / #162 / #170 rest (3)+(4).

Item 5 of the overnight queue (#162 slot-filling) was **not started** — it was explicitly "only if time remains",
and verifying the review findings was the better use of the session.

Full session record in [status-archive.md](status-archive.md).)**

**Session 56 (2026-07-25, owner-present, Opus 5. **WP26 IS COMPLETE and pushed —
mechanism A + B-region + B-period + WP26c — all DORMANT behind two independent flags. €0 LLM spend: nothing in
this WP needed a live model, so the planned €5 / capped €10 was never touched. Zero prompt bytes, zero pricing
change, no DDL.**

**Owner read-back this session (in-chat):** safelist re-read aloud, approved UNCHANGED; take-path **A2** chosen
over ADR-024's A1; **WP26c in scope** (severable); **#132 route B: "nog niet, later beslissen"** — the row still
awaits an explicit GO, and `forks_count` was measured **0** today, so the T-0 condition holds. **Re-ask #132 next
session.**

**Shipped (each with the full verification block + its own /code-review LOW pass):**
(1) **Mechanism A** `8ee71c8` (CI 30117971427 green) — clarification options carry a dry-run-verified intent; a
reply byte-equal to an offered label resolves deterministically with ZERO LLM calls, composed via the template
rung. Chips reuse the existing suggestions surface (#75 handler unchanged). Flag `CLARIFY_CLICK_ENABLED`.
(2) **B-region** `37a3c55` (CI 30119491343 green) — no place named on a measure with a national row → the
national figure, disclosed + correctable. ADR 024's flagged assumption was MEASURED: both geo tables have the
NL01 row. The existence check runs per-measure every time; without a row it still clarifies (pinned).
(3) **B-period** `1a99b3d` — no period signal → a bounded recent trend, **walked** backwards so gaps SHORTEN the
window instead of causing a refusal (this replaces the brief's let-completeness-refuse design, which would have
manufactured dead ends). Flag `ANSWER_FIRST_ENABLED`, independent of A's.
(4) **WP26c** `1a4ca89` — the two MEASURED trial misfires ("Wat was de inflatie in juni 2026?" → forecast; "Wat is
het consumentenvertrouwen?" → meta) now carry ONE deterministic rescue chip beside the unchanged, still-honest
refusal. Offered only when code proved the figure loaded and servable; taking it never re-enters the parse that
misfired. Rides A's flag.

**⚠ FOUND BY THE OWNER'S SANITY CHECK (2026-07-25, after the build): a ~6-minute PRODUCTION degradation.**
`/llms.txt` served its 503 fail-safe and the homepage Ontdek charts were omitted, because five deploys in
quick succession exhausted Supabase's free-tier **15-connection session pool**
(`EMAXCONNSESSION`). It SELF-HEALED; all routes verified 200 again, Ontdek back, llms.txt serving real
content. Both surfaces degraded exactly as designed — no stale or invented data — so this is CAPACITY, not
correctness. New [#173](open-questions.md) + a RUNBOOK section with a diagnosis recipe that works while the
pooler is full. **Note the CI post-deploy smoke passed: it runs ~10s after deploy, before instances stack —
a green smoke is not a claim about a minute later.**

**▶ NEXT, in order:** (a) the **owner-supervised go-live** of the two flags — NOT during a deploy burst
(#173: both mechanisms add DB work per request; `/llms.txt` = 200 is the cheapest go/no-go canary) — RUNBOOK section "WP26
answer-first + clickable options", one flag at a time with rollback + live smoke; (b) **~30/7 BBP+PPI syncs** — measured at CBS today: nothing was due yet (`85880NED` still on Modified 2026-07-01,
`85770NED` on 2026-06-30, both behind our 17/7 sync). `85880NED` MUST use the chunked escape hatch (RUNBOOK step
5); (d) **re-ask #132 route B**; (e) then the owner menu: WP30c choice / #162 / #170 rest (3)+(4).

**▶ DE VOLGENDE SESSIE IS EEN AUTONOME OVERNACHT-RUN.** Wachtrij + regels + de Fable-opdracht staan in
[session-briefs/2026-07-26-overnight-autonomous-queue.md](session-briefs/2026-07-26-overnight-autonomous-queue.md).
Kort: sessiemodel Opus 5 orkestreert, **architectuur en complexe analyses gaan naar Fable-agents**
(owner-steer 25-07), mechanisch legwork naar Sonnet/Haiku. Branch+PR per #118(b), €0 live-LLM, nul
promptbytes, geen DDL, vlaggen blijven UIT, en geen gestapelde deploys (#173). Slotfase: Fable
controleert de architectuur van WP26 + #154/#121/#138/#172-stap-0/#170.

Full session record in [status-archive.md](status-archive.md).)**

**Design marathon (2026-07-18 overnight, AUTONOMOUS docs-only — FABLE'S LAST SESSION before the model
switch; from now sessions run Opus/Sonnet (top model = Opus; the delegation cost-tier rule survives: the session model thinks, fan-out on
Sonnet/Haiku). SIX EXECUTE-READY DESIGNS delivered (commits `8ac0e59`→`ead1ead`, all `[skip ci]`, zero live-LLM spend / prompt bytes / DDL):
(1) [WP26 execute-brief](session-briefs/2026-07-19-wp26-execute-brief.md) — corpus-grounded, safelist read-back doc, NO live DDL needed
(jsonb confirmed), A2 take-path recommendation + WP26c forecast/meta rescue-chips (severable), plan €5/cap €10;
(2) [#162 slot-filling ADR-DRAFT](session-briefs/2026-07-19-adr-draft-slot-filling.md) — typed-slot contract + A/B meetopzet; measured:
compose fixtures are a SEPARATE hash domain, #162 does NOT trigger #164; (3) [#172 escalation
protocol](session-briefs/2026-07-19-172-escalation-protocol.md) — structural shortlist-walk fix FIRST, RerankProfile co-calibration,
separation-gap ≥0.05 ×4 as the go-number; (4) [#154 design](session-briefs/2026-07-19-154-design.md) — NULL-sentinel `last_seen_batch_id`,
migration-021 plan, flag-free; (5) [WP30c beslismemo](session-briefs/2026-07-19-wp30c-rijksfinancien-dossier.md) — BOTH candidates
live-scouted (rijksfinancien: begroot≠uitgegeven verified, Defensie 2023 18% gap, CC0, measured API bugs; politie: v3-on-dataderden
CONFIRMED, byte-identical period codes, CC0, `47013NED` first candidate), 4 framed options, choice stays the owner's;
(6) [small designs](session-briefs/2026-07-19-small-designs.md) — #138 (no owner question, ready), #121 (one-line owner question +
uncaught-throw finding), 85792NED (bounded regionDimensionOverride + honest fallback). Phase 7 (#170 smalls build) deliberately SKIPPED —
capacity went to the full wrap-up; the smalls are the ready first build task. Kickoff for the first post-Fable session:
[session-briefs/2026-07-19-session-post-fable-kickoff.md](session-briefs/2026-07-19-session-post-fable-kickoff.md).
▶ NEXT: owner dates (22/7 06:30 sync `85773NED` generale; 23/7 06:30 sync `83693NED` julicijfer; ~30/7 BBP+PPI syncs — 85880NED via the
chunked escape hatch; #132 route B on/after 19/7), then the owner-decision stack — NOW WITH DESIGNS ON THE TABLE: WP26 (trial-conversion
stake; needs the safelist read-back + 2 read-back items), #170 smalls (sparring-approved, build-ready, branch+PR per #118(b) if
autonomous), WP30c (memo ready — 4 options), #172 (supervised WP, step-0 verify first), #154 (rider on any supervised window), #138
(ready, no question), #121 (one-line owner call), #162 (after WP26). Trial ops: pot was 23/25 at s52 close, `npm run trialpot:set`.
Outstanding owner clicks: GitHub Budgets (the 2026 gotcha), Resend free-confirm, optional Vercel Firewall rate-limit rule. Full session
record in [status-archive.md](status-archive.md).)**

**Session 54 (2026-07-18, owner-present — THE COVERAGE SPRINT'S TABLE SET IS COMPLETE: [#168](open-questions.md)
RESOLVED end-to-end. ALL NINE coverage tables are LIVE AND ANSWERING (the six #4-#9 joined #1-#3): PR #56 merged `5e3a8e2` → vocab batch
`49135ef` (10 canonical keys; prompt v6 = the deferred ADR-023 bare-'tot' fix + a grain-sibling tie-break rule SCOPED to named pairs after the
generic first wording broke B2 4/4; ONE #164 re-record over SIX calibration rounds — final gate intent 72/72 ×3 ZERO flips, conf min 0.92 /
median 0.95, followup 23/23, clarify 7/7, tablefinder 11/11 live + hermetic; three reasoned relabels with measured rationale; the B16
region_unknown options gap fixed — clarifications now carry choice labels) → live syncs ×6 (batches 19-24, 136,511 rows, 0 corrections, 0
quarantines — 85828NED's excludeMeasures proved itself live, no chunk hatch needed) + registry:apply (17 tables / 26 keys) AFTER verified
deploy + 10 LLM-free spot-checks ALL exact incl. the regional key (NL01 479.527 / Amsterdam 630.621 & 303.925). Measured LLM spend ~€10-12
(calibration loops multiply — NOT sub-euro; within the €25 cap). ⚠ NEW TRACKER [#172](open-questions.md): finder-chain regression
(bijstand-stock lost 37789ksz from the Haiku chain on a byte-identical prompt — upstream drift; the class is honest-but-undeliverable via
refuse+refund) + the measured-and-REVERTED Sonnet escalation (temperature-0 rejection + muddy confidence distribution; needs model+threshold
CO-calibration as its own supervised WP). Also this session: the BILL-SHOCK AUDIT (owner-asked): Vercel=hobby, Supabase=free, repo public,
Anthropic 2× hard-capped → surprise bill structurally impossible TODAY; RUNBOOK "Bill-shock protection" = the record + the Pro-upgrade
spend-cap rule; outstanding owner clicks: GitHub Budgets (the 2026 gotcha), Resend free-confirm, optional Vercel Firewall rate-limit rule.
The MODEL SWITCH the owner announced this day (Fable through 2026-07-19 only, then Opus/Sonnet) was executed as the overnight design
marathon — see the ▶ block above. Full entry in [status-archive.md](status-archive.md).)**

**Session 53 (2026-07-17→18, AUTONOMOUS — tables #4-#9 BUILT DORMANT on PR #56 per #118(b): measured on both platforms via 6 parallel
agents, CC11-CC31 frozen with explicit targets, the #167 probe caught 7 slice-empty Productie-measures, the `--catalog-add` finder-fixture
trap found and scheduled. Superseded same-day by session 54's go-live above; full entry in [status-archive.md](status-archive.md).)**

**Sparring session (2026-07-18, owner-present, parallel to the s54 build session — NO build, docs-only `203a371`/`fab0433`: competitive
teardown of nederlandinbeeld.org + aidscope.co.uk; verdienmodel doubt addressed (access ≠ answers) with a parked LLM-benchmark test
[#169](open-questions.md); four visibility smalls owner-approved [#170](open-questions.md); API/MCP + transparency + correlation ideas
parked with rationale [#171](open-questions.md); rijksfinancien.nl added as second-source candidate [#123](open-questions.md), DNB on the
long-term roadmap list. Architecture sketches + analysis in
[session-briefs/2026-07-18-sparring-competitive-analysis.md](session-briefs/2026-07-18-sparring-competitive-analysis.md) +
[…-parked-ideas-architecture-sketches.md](session-briefs/2026-07-18-parked-ideas-architecture-sketches.md). Priority stack UNTOUCHED —
#168 remains the single next owner-present build step. Full entry in [status-archive.md](status-archive.md).)**

**Session 52 (2026-07-17 — PRODUCT-AF DELIVERED: (a) "Ontdek Nederland in grafieken" LIVE on `/` (`752af59`, ADR
[035](decisions/035-homepage-discovery-charts.md)); (b) the #53 anonymous trial pot (`9317acb`, ADR [036](decisions/036-anonymous-trial-pot.md))
BUILT + supervised go-live RUN same day — THE TRIAL IS LIVE on `/` (pot 23/25 after smoke; ops via `npm run trialpot:set`). ⚠ WP26 stake
raised: both casual smoke phrasings drew honest conservative refusals — trial conversion now leans on WP26. Full entry in
[status-archive.md](status-archive.md).)**

**Session 51 (2026-07-17 — the PRODUCT-FINISH pivot: papier-en-inkt huisstijl + public landing on `/` + all surfaces restyled, live
`4dc5273`; #98 resolved (homepage = the product's face); #53 owner refinements recorded (trial ON the homepage, empty-pot fail-safe, two
belts). Full entry in [status-archive.md](status-archive.md).)**

**Session 50 (2026-07-17 — sprint tables #2 `85880NED` (FULL ingest) + #3 `85770NED` DONE END-TO-END + LIVE (build `57be40a`; all six frozen
cells LLM-free exact on prod); PRs #54/#55 reviewed + merged incl. the 12-finding parallel max-review dispatch `c7f6063`; #167 phantom-measure
exclusion mechanism; slow-stream escape hatch (chunked capture + sync-from-capture — needed for every 85880NED release-day sync); ONE #164
re-record (62/63 + ×3, os-v02 deliberately re-labelled, r-autos live-unstable but gate-deterministic). Full entry in
[status-archive.md](status-archive.md).)**

**Session 49 (2026-07-17 — coverage-sprint table #1 `83693NED` DONE END-TO-END + LIVE (build `c4134bc`, sync batch 15, registry:apply 9/11,
#165 trim 115/115, LLM-free verify −39); sprint-wide finds #164/#165/#166 recorded; #118 code-review-LOW governance addition `09b6191`;
overnight addendum: PR #54 (#166 guard) + PR #55 (table #3 prep) built awaiting review, tables #2-#9 measured (specs doc), "80590NED v3-only"
REFUTED, table #2 descoped pending the slice decision (since resolved s50). Parallel review session same day: PR #54 max-review 12 findings
(dispatched s50), dependabot #51-#53 merged, #53 deploy-red → TS ^5 pin `eec3973`. Full entries in [status-archive.md](status-archive.md).)**

**Session 48 (2026-07-17 — the parallel owner-"spar" strategy session, docs-only: ELEVEN owner decisions #153-upd/#158–#163 + the #118
standing-push revision; #153 proefrit executed (wbn.nl ❌ −4% claimed vs +13,7% CBS-measured); coverage sprint scouted + briefed (8 gap tables,
two load-bearing finds: no full-gemeente price index anywhere [CONFIRMED s49]; "80590NED is v3-only" [REFUTED s49 overnight — v4 works with the lowercase id, docs/07 quirk #1]). Full entry in [status-archive.md](status-archive.md).)**

**Session 47 (2026-07-16→17 — THREE adversarial security/data-integrity hunts (each 4-6 lenses, dual-verified, Sonnet
fan-out) + a frontend-render scout. THREE fixes merged+live, each on an EXPLICIT owner word (#118b). (1) BILLING/MONEY-PATH: NO live credit-
conservation bug; one reachable-today gap FIXED ([#145], PR #48 `7e42656`) — `guardPending` bounds the untrusted reply-turn `pending`. (2) GDPR-
REDACTION: a real HIGH leak the inline scout MISSED — `pending_table_requests.fit_note` (LLM sentence paraphrasing the question) + topic-disclosing
table-ids survived erasure; FIXED ([#151], PR #49 `af287e1`; fit_note all rows, table-ids terminal only). (3) INGESTION/DATA-INTEGRITY: quarantine
ENFORCEMENT on the value path is airtight (`resolve.ts:306` refuses a needs_review table before any cell is served); two hardenings FIXED ([#155]
freshestForCanonical status gate + [#156] one validated dimension set per sync, PR #50 `b654010`). CLEAN lenses: money-conservation, cross-user,
derived-surface, frontend XSS/injection. Tracked NOT built: [#146] Stripe payment_status (dormant, card-only; RUNBOOK pre-delayed-method gate added),
[#147]-[#150] billing low/latent, [#152] feedback insert-race (self-healing), [#154] retained-cell false-fresh date (MEDIUM-HIGH, a DESIGN WP — the
finder's batch_id sketch is flawed), [#157] a/b deliberately dropped. ⚠ [#151] is FORWARD-ONLY: pre-deploy prod rows keep unredacted fit_note/table-
ids until a purge/re-deletion — a one-off backfill is a supervised step. See open-questions #145-157.)**

**Session 46 (2026-07-16 — #144 DONE END-TO-END in ONE session:** built + adversarially reviewed + merged (PR #47, squash `94b90e4`, owner in-chat
approval per #118(b)) + the supervised go-live EXECUTED (calibration, fail-open+admin-alert decision, flag flip, live smoke). The semantic checker is
LIVE and ACTIVE in production; the whole session-44 data-integrity hunt list is now CLOSED.)

- **#144 — the semantic fabrication check — ✅ DONE END-TO-END (ADR [034](decisions/034-semantic-fabrication-check.md); PR
  PR #47 squash `94b90e4` + go-live commits `8eef383`/`deabbfb`; all gates + deploys green,
  prod HTTP 307).** The additive REJECT-ONLY cheap-tier LLM checker over validated bodies that leaned on a residual-prone exemption
  (`ClassifiedToken.soft`) — the shared close for the #140 (descriptor-echo) and #141 (temporal-marker+un-listed-noun) deterministic ceilings.
  Corpus-MEASURED scope (the brief's "most answers skip the call" assumption inverted: naive = 100% trigger on the 18 stored legit bodies →
  shipped = 0%, while both residual shapes still fire); a fabricated verdict takes the same R3 ladder (regenerate → template); verdict stored on
  the envelope, recorded-not-rederived, its SCOPE re-derived by R8 with tamper teeth; checker calls = `llm_calls` role `semantic_check`; wired on
  all three answer paths (question, reply, onboarding delivery). **Adversarial review (5 lenses × dual refute-verify + a SERIALIZED mutation
  probe, 26 agents, cheap tier): 1 CRITICAL confirmed with executed repro + closed same day (the date-form compound-noun bypass — "nog 31
  januari-meldingen extra" skipped the checker gate; DATE_FORM_AFTER now requires a year/punctuation after the month), 2 refuted-but-adopted
  hardenings (maxTokens scales with suspects; treat-as-data covers all payload fields), mutation probe 5/5 RED, flag-off byte-neutrality 0
  findings.** **Go-live (owner present): calibration run 1 (prompt v1) = 8/9 — FN on the month-compound case, the model fell into the SAME trap
  the code had; prompt v2 (teaches the DATE_FORM_AFTER rule) = 9/9 FP=0 FN=0 flips=0, also at --repeat=3; replay leg pins the calibrated behavior
  on the gate (`tests/answer/semantic-check-replay.test.ts`, commit `8eef383`). Owner decisions in-chat: merge ✓; FAIL-OPEN + ADMIN ALERT per
  skip (`src/answer/audit/alerts.ts` → e-mail via Resend to ADMIN_ALERT_EMAIL with audit row/user/question/error/meaning, console.error as the
  floor; SEMANTIC_CHECK_FAILMODE deliberately unset). Env flags set via vercel CLI; the flip-deploy (`deabbfb`, run 29513127181) gate+deploy ✓;
  live smoke: owner question → audit row 253 carries `skipped_no_suspects` (prompt v2, ZERO extra LLM calls), pre-#144 row 252 has no key (A1),
  `npm run audit:verify -- 253 253` exit 0.** Merge-block verification: backend 1333/1333, web 314/314 (solo re-run; 2 parallel-load flakes),
  benchmark 14/14 + 6/6 + 0 fabricated, real next build, `audit:verify -- 1 252` exit 0 (225/227 + the 2 pre-existing pinned divergences).

**Session 45 (2026-07-16, THREE PRs merged + LIVE, all data-integrity; full entries in [status-archive.md](status-archive.md)):** #141 HIGH
period-exemption hole (PR #44 `d192775`), the #142/#143/row-227 trio (PR #45 `6291dfc`), format.ts raw-NUL cleanup (PR #46 `f909e66`); merges
that session in-chat DELEGATED (#118(b) precedent — NOT automatically renewed; session 46 asked and received explicit per-merge approval);
the #144 design brief was written there and executed by session 46.

**Session 44 (2026-07-13 → 2026-07-16, 3 PRs merged: #134(b) too-old retry chip PR #41 `12518eb`, auth/ownership hunt CLEAN + open-redirect fix
PR #42 `4e2a2fd`, the #140 validator narrowing PR #43 `882c808`; full entries in [status-archive.md](status-archive.md)).**

- **Next — the coverage sprint ([#163](open-questions.md)(3), owner-approved 2026-07-17):** build order, validated slices and caveats in
  [session-briefs/2026-07-17-coverage-sprint-brief.md](session-briefs/2026-07-17-coverage-sprint-brief.md); per-table measured record in
  [11-coverage-table-set.md](11-coverage-table-set.md). **Table #1 `83693NED` ✅ DONE + LIVE (session 49); next = #2 `85880NED` + #3 `85770NED`
  before 30/7 as ONE batch (#164 re-record constraint).**
  **Fresh hunts are PAUSED per #163(1)** — un-hunted surfaces (auth/session-flow, answer-composition/LLM-harness) stay listed for when hunts
  resume. Tracked follow-ups #146-150 + #152 low/latent; #151 backfill sweep = supervised; #154 = a design WP, owner's call on priority.
- **Next — owner decisions (queue behind the sprint per #163) — every item below now has an execute-ready design from the 2026-07-18
  overnight marathon (see the ▶ block above for links):** **#138 ✅ DONE + LIVE (session 55, `f2d015a` — off this menu)**, **WP26**
  (execute-brief ready — safelist read-back + 2 read-back items), **#121** (one-line owner question), **#131** (multilingual L1 — no
  design yet), **WP30c** (beslismemo ready, 4 options), **#162** (ADR-draft ready — after WP26). Tracked-not-focus: #132 route B
  ~2026-07-19 (check on/after 19 juli), #104/#112 (need live-LLM spend). (The /login header cosmetic that used to be
  listed here was FIXED 2026-07-24, session 55 — see the ▶ block.)


**▶ TOP PRIORITY STACK — owner decision, session 23 (2026-07-05); this ORDER overrides the "decision-gated" framing below.** The owner set an explicit
sequence; everything else queues behind it:
0. **✅ DONE + live-verified on production (2026-07-05): GDPR retention purge + self-service deletion (#14).** `npm run gdpr:purge` + a "Verwijder mijn
   vraaggeschiedenis" button, both **redact** the content (question + answer + the topic columns gone; the financial skeleton stays — a
   `credit_transactions` FK blocks a real row-DELETE). Reviewed + committed (`6aafb40`); 715 backend + 135 web tests green. The purge ran clean on
   prod (0 rows — nothing is 2 years old yet); ongoing retention = the monthly maintenance session — **which did NOT list the purge on its agenda until 2026-07-25 ([#189](open-questions.md)); it does now, and nothing else schedules it.** Owner confirmed the redact-and-retain posture.
   *Full detail: the session entry in [status-archive.md](status-archive.md) + the #14 section in [08-build-plan.md](08-build-plan.md). ([#59](open-questions.md) — the separate
   account-deletion FK tension — stays open; #14 does not touch it.)*
1. **On-demand CBS fetch when data is missing — WP16.** If a question needs data not in our DB, fetch the CBS table via API → verify → store → answer,
   with *"je tabel wordt voorbereid"* wait-messaging (email + dashboard "wordt aan gewerkt"). Was Phase 2-3, now **#1, the biggest build.
   Execute-ready brief in [08-build-plan.md](08-build-plan.md); Fable-authorized on the hard sub-parts (owner).** **Sub-part 1 (table discovery) — ✅
   HERMETIC FOUNDATION BUILT (session 24, 2026-07-05), full gate green; design + the Fable judgment in ADR
   [025](decisions/025-cbs-catalog-table-discovery.md).** Shipped hermetically (€0 spend, no live DDL): a `cbs_catalog` mirror (migration 011) + Dutch
   FTS (verified on PGlite), `CbsSource.fetchCatalog()`, and `src/catalog/` = ingest + Stage-1 FTS recall + Stage-2 rerank (hard allowlist,
   `TABLE_RERANK_MODEL='claude-haiku-4-5'`) + the `findTable` router (confident/disclose/none). **The Fable answer (owner asked): topic→table does NOT
   earn Fable in v1** — a closed shortlist multiple-choice with a hard allowlist, safer structurally than by model size; one named constant with a
   recorded Haiku→Sonnet→Fable escalation ladder gated on a measured miss. **Sub-part 1 supervised live step — ✅ DONE (session 25, owner present):**
   migration 011 applied to prod (grants/RLS live-confirmed locked by inheritance — 0 anon/authenticated grants, RLS on, 0 policies); real
   `catalog:refresh` mirrored 4,858 rows; `tablefinder:record` run live (Haiku) → `DEFAULT_FIND_TABLE_CONFIG.highConfidence` **calibrated to 0.8**
   (confident floor 0.85 measured/stable, failure-safe = disclose) + an end-to-end replay test now on the gate (`tests/catalog/find-replay.test.ts`,
   8/8 hermetic); 3 finder misses fixed (1 mislabel zonnepanelen→85004NED + 2 alias recall gaps) → 8/8. **Residual — ✅ CLOSED session 31 (WP27 stage
   A, PR #17):** the labelled set now has a disclose-expected case (`inkomen-vaag`) and the confident/disclose boundary is directly measured
   ([#104](open-questions.md)). **WP16 sub-part 2 — ✅ LIVE IN PRODUCTION (go-live session 28, 2026-07-06, owner-supervised).** On-demand CBS fetch
   works end to end; both paths verified live (delivered: consumentenvertrouwen→CBS `83694NED`, −24, full CC BY attribution, 100 credits kept;
   unanswerable+refund: bijstand → `85615NED`, ledger compensation +100). A go-live proxy bug was caught pre-flight + fixed (`42b275b`). **➡ Both
   go-live follow-ups are DONE: #115 shipped sessions 28–29; #111 CLOSED via WP27 (sessions 31–33, ADR [027](decisions/027-finder-shape-fit-gate.md))
   — the bijstand question now ANSWERS live (stage-D acceptance test, session 33). See the session log in [status-archive.md](status-archive.md) for the records.** (Built session
   27: 888 backend tests, benchmark 14/14 + 6/6 + 0 fabricated, 154 web tests.) Full build detail in the WP16 section of
   [08-build-plan.md](08-build-plan.md); residuals [#111](open-questions.md) (delivery coverage: national single-dimension tables answer,
   geo/sub-coordinate refuse-and-refund) + [#112](open-questions.md) (extended-vocab prompt variant unmeasured). The original seam notes, for the
   record: **Seam precision (session-26 review): that seam is TWO structurally different exits, not one** — the `unmatchedMeasureTerm` parse exit
   carries free text and fits `findTable(topic)` directly (the live seam); the `runQuery`→`buildQueryRefusal`/`table_not_registered` branch has no
   free-text phrase left and needs its own adapter (and is effectively unreachable with the current hand-curated registry) — exact shapes in the WP16
   brief ([08-build-plan.md](08-build-plan.md)). Sub-part-2 design inputs logged as [#107](open-questions.md)–[#110](open-questions.md) (slice
   greediness, successor re-discovery, onboarding chip, data lifecycle/eviction — incl. the verified gap that `sync --all` is seed-bound, not
   registry-driven). **All four blocking decisions now LOCKED (session 26, ADR [026](decisions/026-on-demand-fetch-job-architecture.md)): Vercel Cron
   job engine, 100-credit pricing on the existing "heavy" tier, internal-consistency-only verification for v1, core-loop-only scope**
   (successor/chip/eviction deferred, except the one verified #110(a) registry-driven-refresh bug). **Ready for an execute build session — no further
   owner decisions needed to start the hermetic foundation** (mirrors sub-part 1: build + gate green first, live DDL + real spend in a separate
   supervised step after).
2. **New data sources beyond CBS** (likely API-based). **▶ ARCHITECTURE DESIGNED (session 30, 2026-07-08, owner-steered
   source-neutral/Nederland-scope): ADR [030](decisions/030-multi-source-architecture.md) + [audit
   dossier](session-briefs/2026-07-08-multi-source-dossier.md); build = WP30 in [08-build-plan.md](08-build-plan.md), after WP27; the concrete first
   source is an OPEN owner decision (WP30c).** Broadens the public claim from "official CBS cell" to "official sources" (CLAUDE.md needs a matching
   update) and likely triggers the ADR 001 Python split.
3. **Answer/question-quality optimization on the widened data base** — re-run the experience audit + ship the clarify-policy fix (**WP26 ✅ BUILT session 56, dormant behind two flags — only the supervised flip remains; the "tier-3, after the data work" sequencing below is historical**,
   ready but after the data work).

*Grounded in the session-23 experience audit (110 questions, live, measured): 40 answer / 32 clarification / 38 refusal; **20 of 56 answerable
questions did not just answer**, and **all 14 out-of-coverage questions hit the wall** — the coverage wall (1/2) is a bigger lever than the
clarify-policy (3) alone.*

**Current phase:** Phase 0 complete; **WP21 (CSV export #52) + WP22 (live-feedback smalls #95/#96a/#97a) + WP23 (display smalls
#84/#86/#90/#91/#92/#71/#75) all shipped 2026-07-05, session 22 overnight**, **#14 GDPR retention + self-service deletion shipped 2026-07-05
(code-only/hermetic session, item 0 above)** on top of the #77 fix (session 21, ADR [023](decisions/023-explicit-date-range-parsing.md)), WP19+WP20
(session 20), WP18/WP17 and the live-verified end-user flow — **next follows the TOP PRIORITY STACK above (GDPR #14 done → WP16 → new sources → WP26),
NOT the old "decision-gated" framing:** the session-22 wrap-up items (#98/#99 site shell, #96b, #97b, #53) and the **#65 error logging** brief
([08-build-plan.md](08-build-plan.md)) are real open items but no longer the front of the queue; anonymous-trial [#53] has its full brief (the
session-19 owner-delegated order is complete), **plus a large decided-but-unbuilt backlog — everything below is owner-confirmed, no priority order
implied:**
  - **Bug-shaped, from live testing:** explicit multi-period/multi-region auto-display ([#64](open-questions.md)); durable error logging beyond
    Vercel's short retention ([#65](open-questions.md))
  - **WP16, demand-driven table onboarding:** now owner-confirmed wanted, with its user-facing copy and "costs credits" pricing decided
    ([08-build-plan.md](08-build-plan.md), [#24](open-questions.md))
  - **Clarification UX — one WP (WP26), designed session 23 (ADR [024](decisions/024-answer-first-defaults-and-clickable-options.md)), ✅ BUILT session 56 and DORMANT behind two flags; the text below describes the design as it awaited
    owner read-back of the safelist + a supervised build:** clickable pre-verified suggestion buttons ([#66](open-questions.md)/Mechanism A) +
    smart-default-with-escape-hatch on the narrow safe set instead of always clarifying ([#72](open-questions.md)/Mechanism B) — the two root causes
    of the "paid dead-end" (net 10 credits for nothing), zero prompt bytes, pricing deferred ([#101](open-questions.md))
  - **Dashboard polish — ✅ all four built in WP19 (session 20, entry in [status-archive.md](status-archive.md)):** collapse a clarification round into one history item
    ([#67](open-questions.md)); live balance updates instead of only-on-reload ([#68](open-questions.md)); low-balance warning banner
    ([#69](open-questions.md)); a brief credits-economy explainer under the "Credits kopen" button ([#76](open-questions.md))
  - **"Next-level" UX ideas, all owner-approved:** clickable source-attribution drill-through ([#70](open-questions.md)); a visual "voorlopig" badge
    ([#71](open-questions.md)); follow-up suggestion chips under an answer ([#73](open-questions.md)); a live status panel for pending WP16 onboarding
    requests ([#74](open-questions.md)); example-question chips on an empty chat ([#75](open-questions.md))
  - **GDPR:** [#14](open-questions.md) question-log retention — **✅ built** (2026-07-05, code-only/hermetic session): 2-year purge CLI + self-service
    deletion, both via redaction (see item 0 above). Live purge run against production is still outstanding, owner-supervised, whenever a maintenance
    window opens.
  - **Second creative-brainstorm batch (2026-07-05, owner-filtered, rows [#78–#93](open-questions.md)):** top-5 = citation-copy button (#78), "bewijs
    dit cijfer" audit exposure (#79, brief first — merge with #70/#90), stat card + PNG download (#80), revision-risk gauge (#81, LARGE — needs
    revision statistics, brief with #88), pre-send cost transparency (#82); plus batch questions (#83), message-type styling (#84), honest
    waiting-steps (#85, real steps blocked on the ADR 018 streaming seam), CBS deep-link (#86), historical-range chip (#87, real R5 derivation),
    revision awareness (#88), "waarom dit antwoord" (#89), source chip (#90), number typography (#91), chart-footer rearrangement (#92); **three ideas
    explicitly REJECTED by the owner (#93: watch-list, pattern-encoding, comparison card)**. Owner authorized immediate execution alongside recording
    — **the three small top-5 items (#78/#80/#82) were built the same day as WP20 (session 20, entry in [status-archive.md](status-archive.md))**;
    CSV export [#52] stays next in the standing order after that
  
  **KvK is deliberately parked until the website is finished (owner decision 2026-07-04, [#54](open-questions.md)) — do not raise it as a next step.**

## Phase 0 checklist

- [x] Open questions #10, #18, #20 answered by Stefan (2026-07-02 — see [open-questions.md](open-questions.md))
- [x] Doc-set sign-off by Stefan (2026-07-02)
- [x] CBS table set chosen; IDs validated against the live catalog (2026-07-02, open-questions #1 resolved — 8 tables, all v4-reachable, every
      benchmark period confirmed present: [07-phase0-table-set.md](07-phase0-table-set.md))
- [x] Benchmark answer key frozen (2026-07-03: [benchmark/answer-key.json](../benchmark/answer-key.json) — 14/14 answerable tasks + B20 freshness
      reference, values re-verified against the live ingest, not just copied from docs; [02-user-scenarios.md](02-user-scenarios.md), Scoring)
- [x] Ingestion + validation pipeline with fixture tests (2026-07-03: five ordered checks, quarantine, correction-diff log, idempotent syncs; the 10
      inherited `todo` obligations are now 21 real fixture tests + 8 adapter tests on an embedded real-Postgres test DB (ADR
      [009](decisions/009-hermetic-test-database.md)); adversarial review found and fixed 2 ordering/defaulting bugs; live ingest recorded above)
- [x] Table registry + alias list (2026-07-03: ADR [010](decisions/010-registry-canonical-measures.md);
      `cbs_tables.default_coordinates`/`.period_semantics` populated for all 8 tables, `canonical_measures` alias list seeded with 8 canonical
      concepts, applied live and idempotently; 14 hermetic tests incl. cross-checks against the frozen benchmark key)
- [x] Intent parsing (schema-validated, ranked candidates + confidence) (2026-07-03: `src/answer/intent/` per ADR
      [012](decisions/012-intent-parsing-llm-harness.md) — LLM emits registry vocabulary only, deterministic resolution to CBS codes, R7 thresholds
      calibrated at 0.9/0.35 against a 45-case labelled set, 45/45 measured live with zero flips over 3 repeats; CI replays committed LLM fixtures
      hermetically)
- [x] Deterministic query + validation + registered derivations (2026-07-03: `src/query/` per ADR [011](decisions/011-query-contract.md) — intent
      contract fixed for WP6, coordinate result-ids, registered derivations with CC BY marking, ten-kind refusal taxonomy incl. slice-vs-unpublished
      distinction and value-free freshness refusals; B1–B14 reproduce the frozen key + B20 refuses correctly, hermetically in CI)
- [x] Answer composition with verbatim/semantic/unit checks (2026-07-03: ADR [013](decisions/013-answer-composition.md) — `src/answer/compose/` +
      shared LLM harness; R1/R2/R3/R4/R5/R9/R10/R11 answer-side invariant tests real; B1–B14 end-to-end hermetic in CI with zero fabricated numbers;
      14/14 measured live, prompt v3, zero template fallbacks)
- [x] Chart spec + dumb renderer (2026-07-03: `src/chart/` per ADR [014](decisions/014-chart-spec-v1-and-renderer.md) — versioned zod-validated
      ChartSpec v1 built deterministically from validated results, pure dependency-free SVG renderer, R6 real; B4/B8 line charts reproduce the frozen
      key hermetically in CI; Recharts client wrapper deferred to the chat-UI session per ADR 014)
- [x] Refusal & clarification behavior (2026-07-03: ADR [015](decisions/015-refusal-clarification-composition.md) — `src/answer/respond/`
      deterministic templates + one-round clarify-reply merge; B15–B20 6/6 hermetic in CI; staleness both branches clock-injected; clarify-reply
      calibrated live 7/7, zero flips ×3)
- [x] Audit record per answer (R8) (2026-07-03: ADR [016](decisions/016-audit-records.md) — migration 004 `audit_answers`, one row per
      answer/refusal/clarification written before the response returns, fail-closed on audit failure; `reconstructionReport` re-verifies every row
      from the stored row alone with tamper tests proving teeth; benchmark scorer reads audit records: hermetic run/score pair in CI, gate PASS
      measured 14/14 + 6/6 + 0 fabricated)
- [x] CI gate live (2026-07-02): GitHub Actions runs typecheck + the eight gate suites + the benchmark run/score pair on every push. State after WP10
      (2026-07-03): **432 real tests + 0 todos** — the query suite scores B1–B14 against the frozen key (hand-authored intents), the answer suite
      drives B1–B14 **and B15–B20 plus the clarification round** end-to-end over replayed intent/answer/clarify fixtures (ADR
      [012](decisions/012-intent-parsing-llm-harness.md)/[013](decisions/013-answer-composition.md)/[015](decisions/015-refusal-clarification-composition.md)),
      the chart suite proves B4/B8 line charts against the frozen key, the audit suite proves R8 (rows reconstruct, fail-closed, tamper detection),
      and `benchmark:run`+`benchmark:score` produce and score the full 20-task run from audit records (a missing dump is a CI failure) — still no
      secrets and no network. After WP11 (2026-07-03): **445 real tests** — the benchmark suite gained the scorer-teeth tests, which score tampered
      dumps through the real scorer subprocess and pin every docs/03 gate leg (both sides of the ≥12/14 boundary, 6/6, zero-fabricated, the
      fail-closed duplicate-id/missing-dump guards). **After WP12 (2026-07-04): `gate` job also runs `web/`'s own typecheck + 6-test suite; a second
      job, `deploy`, is gated on `gate` via `needs:` and is the only thing that ever deploys (Vercel git integration deliberately not connected) —
      deploy-blocking-on-red is live, not just planned.**
- [x] Provider spend caps, billing alerts, and dependency alerts set (complete 2026-07-04: Anthropic €25/mo spend cap confirmed set 2026-07-02;
      **Anthropic billing alert confirmed set by the owner 2026-07-04** (RUNBOOK step done); **dependency alerts complete** 2026-07-03 — weekly
      grouped version-update PRs via `.github/dependabot.yml`, Dependabot *security alerts* enabled by the owner (verified via the GitHub API,
      `/vulnerability-alerts` → 204), Dependabot *security-update PRs* enabled via the API in WP11 (`/automated-security-fixes` → `enabled: true`);
      web/'s own independent lockfile got a matching second Dependabot entry in WP12)
- [x] Full benchmark run recorded below (2026-07-03, WP11: live run through the audited pipeline — gate criteria measured PASS, see scoreboard;
      provenance in [benchmark/live-benchmark-report.json](../benchmark/live-benchmark-report.json), policy in ADR
      [017](decisions/017-live-benchmark-run.md))
- [x] Minimal chat UI + first deploy (2026-07-04, WP12: [web/](../web/) — Next.js App Router chat UI over the audited entry points, Recharts wrapper
      over ChartSpec v1, CI-gated Vercel deploy; ADR [018](decisions/018-chat-ui-and-deploy.md). **Live at https://checkdecijfers.vercel.app** — all
      four `ComposedResponse` kinds (answer, chart, clarify-then-refusal, direct refusal) measured working against the real deployment)

## Benchmark scoreboard

| Date | Answerable (of 14) | Refusal (of 6) | Fabricated numbers | Median response | Gate verdict |
|---|---|---|---|---|---|
| 2026-07-03 (live, WP11) | **14/14** | **6/6** | **0** | 6,465 ms (all 20 first turns; answerable-only 7,289 ms) | **PASS** |

Gate: ≥12/14 answerable, 6/6 refusal, **zero** fabricated numbers ([03-mvp-scope.md](03-mvp-scope.md)). Also reported, informational: median latency,
clarification count on B1–B14, template-fallback count, un-disambiguated phrasing check ([02-user-scenarios.md](02-user-scenarios.md), Scoring).


## Phase history

| Phase | Status | Gate result |
|---|---|---|
| Docs / discovery | ✅ complete (2026-07-02) | — |
| Phase 0 | ✅ complete (started 2026-07-02, closed 2026-07-04) | **PASS** — criteria measured 2026-07-03 (live run, see scoreboard row + [benchmark/live-benchmark-report.json](../benchmark/live-benchmark-report.json)); owner (Stefan) signed off in session, 2026-07-04; WP12 (chat UI + deploy) closed the checklist 2026-07-04 |
| Phase 1 | — | — |
| Phase 2 | — | — |
