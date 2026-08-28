# Session 67 — close-out (2026-08-28, local +07, owner present)

**What was asked:** review and merge the 19 PRs session 66 left open (#99-#117), with two named
items to give extra attention (PR #111's disclosed cost, PR #113's invariant sensitivity). Not a
queue — a review-and-decide task, "merge where you agree."

**What happened: all 19 reviewed, all 19 merged, zero held. Two real (non-live) bugs found and
fixed before merging; two residuals logged as new tracked rows, not merge-blocking.**

## Review pass

A Workflow fanned out 19 independent review agents before any merge was attempted — 13 at
normal/medium effort, 4 at high-effort/adversarial on the PRs the kickoff flagged risky (#101
money-path, #110 error-log/health-route, #111 eviction/TTL, #113 slot-filling), 2 low-effort
triaging the two Dependabot PRs. Every verdict came back `merge` or `merge_with_note` — nothing was
held for a real defect.

**#110 — a real bug, fixed before merge.** The retention-purge job's admin-alert email hardcoded
"the trial leg failed" in both composition roots (the cron route, the CLI's own log line)
regardless of which leg actually threw. On an error_log-leg failure this directly contradicted the
underlying error's own message (which correctly said "the trial leg also already ran") — exactly
the misdiagnosis-during-an-incident class WP25 exists to prevent. Fixed: `RetentionPurgePartialError`
now carries a `leg: 'trial' | 'errorLog'` field both composition roots branch on instead of
guessing, and the missing symmetric test (an error_log-leg-throws-after-commit case) was added
alongside the existing trial-leg one. Verified: 24 tests across the two affected files, clean.

**#111 — two residuals, logged not fixed (nothing live depends on them yet).** The disclosed
eviction cost ("+1 DB round-trip per served turn") is understated — tracing the real
`src/answer/respond/respond.ts` call graph (not just the two functions the PR's own cost-tripwire
test measures directly) shows the true multiplier is ~4-6x, via follow-up-suggestion and
disambiguation probes that ALSO keep a table artificially "warm" without ever actually serving it —
undermining the eviction feature's own "unqueried for 30 days" premise. Separately, a genuine (if
currently unreachable — `--apply` is manual, no cron) race: a concurrent eviction transaction can
serve a live query a false "no data" refusal, because the eviction guard only checks for an active
onboarding job, not an in-flight read. Both logged as [#195](../open-questions.md) and
[#196](../open-questions.md) — not merge blockers, but MUST close before any live/automated apply.

**#113 — confirmed in advance, not a surprise when the real merge happened.** The elevated review
pre-emptively merge-simulated #113 against #102 and #103 (both open at review time, all three
touching `compose.ts`) in a scratch worktree and predicted the real conflict would be mechanical but
landing #113 last would ALSO silently break two hand-rolled test assertions with no idea a sibling
PR existed. Exactly true when the real merge happened — see below.

## Merge order and what needed hand resolution

A `gh pr diff --name-only` scan across all 19 PRs, done before starting any merge, found real code
overlap in three places the kickoff's "no fixed order needed" framing had missed: `compose.ts`
(#102/#103/#113), the ingestion pipeline (#100/#111), and `actions.ts`/webhook code (#101/#110/#113).
Merge order was chosen foundational-first within each cluster:

| Cluster | Order | Conflicts |
|---|---|---|
| Isolated/docs | #99→#105→#109→#112→#106→#104 | None — all clean squash merges |
| Ingestion | #100→#111 | None |
| Money-path/actions | #101→#110 | None |
| Compose engine | #102→#103→#113 | **#113: 4-file hand resolution** (below) |
| Dashboard | #107→#108 | **#108: 1-file hand resolution** (below) |
| Chart | #114 | None |
| Session 66's own wrap-up | #115 | **#115: 2-file hand resolution** (below) |
| Dependabot | #116→#117 | None |

**#113's conflict** (`docs/13-envelope-presence-grammar.md`, `src/answer/audit/reconstruct.ts`,
`src/answer/compose/compose.ts`, `src/answer/respond/respond.ts`) was entirely mechanical once
understood: two doc-table rows needed both sides' content kept, two import lines needed merging, and
one interface field (`RespondOptions.clickOptionsEnabled`/`answerFirstEnabled`) had been moved by
#102's refactor to an inherited base type, so #113's own copy of those fields had to be dropped and
only its new `slotPhrasing` field re-added standalone. Exactly as the review predicted, two test
files then needed fixing beyond the git conflict itself:
`tests/audit/envelope-key-manifest.test.ts`'s hardcoded `ComposedAnswer` member count (15→16, for
both #103's and #113's new fields) and `tests/audit/slot-phrasing-r8.test.ts`'s `rebuildTexts()`
helper (a hand-rolled expected-text reassembly that didn't know about #103's new `alternatesLine`
field, and would have silently diverged from `compose.ts`'s real line order). Verified in the scratch
worktree before pushing: typecheck ×2 clean, 697/697 answer tests, 138/138 audit tests, 464/464 web
tests.

**#108's conflict** (`web/components/question-history.test.tsx`) was purely additive — #107 and
#108 each added an independent `describe`/`it` block to the same insertion point. Kept both. 27/27
(the one file) + 481/481 (full web) + 286/286 (catalog+ingestion backend) all green after.

**#115's conflict** (`docs/STATUS.md`'s "▶ NEXT" block, `docs/04-architecture.md`'s Ontdek-charts
row) was two real content conflicts, not insertion clashes — but in both cases one side
(`origin/main`, i.e. the *unchanged pre-session-66 base*, since none of the 15 already-merged PRs
happened to touch these exact paragraphs) was genuinely stale next to the other (`HEAD`, #115's own
more complete account of what session 66 actually did). Kept the more accurate side each time, the
same rule the historical PR #94 resolution used.

## Verification standard held on every merge

`gh pr merge <n> --squash --delete-branch` first (mergeable stayed `UNKNOWN` on literally every PR
checked, confirming session 65's same finding — never blocked on it, just merged), then the
resulting `main` commit's CI confirmed via `gh run view` (never `gh run watch`'s exit code alone —
the session-65/66 "watch lies" precedent held, checked independently every time, no discrepancy this
session), then a production canary (`https://checkdecijfers.vercel.app/` + `/llms.txt`, 200/200 —
19-for-19) plus one live functional check of the new `/api/health` route.

## One process detour, caught before it reached the owner

The first canary attempt used `https://checkdecijfers.nl/` — assumed from the project's own name —
and timed out at the TCP level, which looks exactly like a production outage (no HTTP response at
all, not even a 404). Investigation via the Vercel API (`get_project`'s `domains` field lists only
the two `.vercel.app` hostnames) and the RUNBOOK (which already correctly names
`https://checkdecijfers.vercel.app` as the deployed URL) resolved it in a few minutes:
`checkdecijfers.nl` sits on Namecheap's default parking nameservers and is used only for
`mail.checkdecijfers.nl`'s Resend transactional-email DNS — it was never wired to Vercel. Production
was never at risk; this was a wrong assumption on this session's part, corrected before being
reported as a finding. Recorded in [RUNBOOK.md](../RUNBOOK.md)'s new operational section and
[lessons-learned.md](../lessons-learned.md) so a future session checks the documented URL first.

## Docs updated this session (full list, for the stale-doc-sweep record)

- `docs/open-questions.md`: 18 rows (#34, #39, #63, #65, #74, #85, #108, #109, #110, #114, #146-150,
  #162, #170, #193) got a merge-confirmation note appended (PR number + squash SHA), all existing
  technical content preserved untouched; 2 new rows added (#195, #196).
- `docs/04-architecture.md`: new rows for #39 (alternate-reading disclosure, now LIVE unconditional
  default behavior) and #110 (eviction/TTL hermetic half); corrected #162's and #65+#114's rows from
  "pending owner review, not yet merged" to their actual merged state.
- `docs/08-build-plan.md`: WP25 section header updated to merged.
- `docs/RUNBOOK.md`: two new "Supervised live step" sections (migrations 023, 025 — 024 already had
  one, just re-dated); one new "Reviewing and merging a large PR batch" operational section.
- `docs/lessons-learned.md`: this session's process lessons prepended.
- `docs/status-archive.md`: this session's full narrative prepended.
- `docs/STATUS.md`: top block replaced (session 66's block moves to the archive as history).

## Cleanup

One stray git worktree (`/private/tmp/pr101-wt`, left by the #101 adversarial review's own
"independent checkout" verification step) and two stray local branches (`pr-102`, `pr114`, same
cause — review-scratch checkouts of already-squash-merged content) removed; `git worktree list` and
`git branch` both clean of session-67's own artifacts now.

**Stale-branch count corrected, not acted on:** session 66's close-out said "two stale pre-pause
branches." A full `git fetch --prune` + `git branch -vv` this session found **26** — the original 2
pre-pause branches plus 5 more of the same kind (`fix/178-click-freshness-recheck`,
`fix/191-reply-turn-answer-first`, `fix/193-soften-definitief-copy`, `fix/34c-sync-table-lock`,
`perf/176-gate-region-option-intents`), 7 old Dependabot branches whose remote is already gone
(content long since merged, part of the session-64 bridge chain), and 12 `worktree-agent-*` orphans
from past agent-tool sessions (all pointing at already-superseded commits, no remote tracking at
all). None affect `main` or production. Not deleted — `git branch -D` stays a deliberate,
owner-present action, same caution session 66 applied to the two it found.

## What stays owner-supervised (unchanged pattern, nothing new)

- **Three live migration applies**: 023 (#147, compensation bound), 024 (#65/WP25, error_log), 025
  (#110, eviction/TTL columns) — each a `npm run db:migrate` once you're ready; RUNBOOK has a
  dedicated section per migration now, with the exact verification steps for each.
- **#193's live `audit:verify` pass** against production + `known-divergences.ts` pinning.
- **#162's A/B measurement** — blind pairwise phrasing judge + your read-back, ~€1-2 real spend —
  now unblocked, PR #113 is merged.
- **#111's live `--apply`** of the eviction CLI — not yet meaningful, no on-demand table is old
  enough — and per [#195](../open-questions.md)/[#196](../open-questions.md), shouldn't run
  unsupervised even once one is.
- **The two production flags** (`CLARIFY_CLICK_ENABLED`/`ANSWER_FIRST_ENABLED`/`GDPR_PURGE_APPLY`)
  — untouched, exactly as every prior session.

## Session-68 starting point

Zero open PRs. No queue. The natural next session is owner-present, picking from the "▶ NEXT" list
in [STATUS.md](../STATUS.md) at your own pace — none of it is urgent. Paste-ready kickoff:
[2026-08-28-session-68-kickoff.md](2026-08-28-session-68-kickoff.md).
