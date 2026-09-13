# Session 101 kickoff — paste-ready prompt for the next session

Saved verbatim so the handoff survives a clean 0%-context restart (per CLAUDE.md's wrap-up
ritual item 7). Paste the block below as the opening message of the next session.

---

You're continuing checkdecijfers.nl. Read in this order: `CLAUDE.md` → `docs/STATUS.md`
(top block first — it's the authoritative current state) → `docs/08-build-plan.md` → this
brief. Don't re-derive anything below from memory; it's already verified.

## Current state (verified 2026-09-13, session 101 wrap-up)

**One open action, owner's to take: merge PR #21.**
It's R3 — the confirm-first chip before the automatic 100-credit onboarding fetch, reversing
[open-questions #109](../open-questions.md). Decisions 4 (yes, add a confirm button) and 5 (no
change to the 100-credit signup grant) were answered directly by the owner in chat — don't
re-litigate them. `ONBOARDING_OFFER_SECRET` is confirmed set in Vercel. Per this decision's own
standing rule (money path — see [#118](../open-questions.md) and the build plan), it always gets
branch + PR + explicit owner go, with **no exception for an owner-present session** — do not
merge it yourself even if asked to "just push," without the owner's explicit go on the merge
itself.

**Known wrinkle from this session's own wrap-up, likely already resolved by the time you read
this — verify, don't assume:** the wrap-up's docs-only push to `main` (`ac08356`) touched the
same doc sections PR #21 had edited, which briefly flipped it to `mergeable_state: dirty`.
Fixed same session with a merge commit (`79b7649`, `journey-r3-fetch-confirm` ← `main`, no
rebase) — `mergeable_state` returned to `unstable` (clean merge, just waiting on CI) with the
`gate` check (run `34748057564`) `in_progress` as of 08:35 UTC on the final head SHA. The
session subscribed to PR #21's activity, so if you're a continuation of that same session and
a red-CI event already arrived, that takes priority over anything else in this brief — go fix
it (push a real fix, per this repo's PR-stewardship rules; PR #21 is a PR this session opened,
so red CI there is this session's to resolve, not the owner's to notice). If you're a **fresh**
session instead: first thing, check `pull_request_read` (method `get` + `get_check_runs`) on
PR #21 yourself — don't trust this paragraph's numbers past their timestamp.

**Also shipped and live in production, no action needed:** the chart Style panel is now a real
modal popup (#243, `7e71e5a`, deployed), with a real-browser-review follow-up fix for a
header-row overflow bug jsdom structurally couldn't catch (`5aa02c7`, deployed).

**Recorded but not started — [open-questions #245](../open-questions.md):** a build/CI
performance diagnosis (owner-requested). Full report:
[2026-09-13-build-performance-diagnosis.md](2026-09-13-build-performance-diagnosis.md). Its
"first 3 actions" (fix `tests/billing/ledger.test.ts` + `tests/ingestion/ingestion.test.ts`
booting a fresh Postgres per test instead of per file/suite; shard the CI `gate` job 3-way;
generalize the fix into a full call-site sweep) don't need to wait on the report's 3 owner
sub-questions about the CI-sharding tier specifically — those only gate how far to take that
one tier, not whether the cheap DB-boot fix is worth doing. Nobody has asked for this to be
picked up next; it's parked until the owner prioritizes it or asks explicitly.

**Carried forward, unverified this session, not this session's to chase:** live-DDL migrations
028+029 (`npm run db:migrate`, owner-supervised) and `npm run usage:report` once; `/werkwijze` +
`/privacy` still need real copy (currently marked drafts); `EMBED_TOKEN_SECRET` unset (blocks
the embed feature, PR #9 — check whether that's since merged, this brief predates that check);
the `auth.users` pooler-read check for Live embeds; Dependabot PRs #16/#17 open and untouched.
None of these are blocking each other — pick whichever the owner actually asks about.

## Standing constraints (don't relearn these the hard way)

- **Git workflow ([#118](../open-questions.md)):** owner-present session → push/merge directly,
  no per-change approval needed, full verification block + green CI still the hard gate. Docs-
  only changes skip CI and can go straight to `main` even mid-feature-branch-work — but **check
  your current branch before every push** (`git branch --show-current`), especially right after
  switching branches for a side task; an unexpectedly-instant "Everything up-to-date" on a push
  is a red flag, not confirmation. R3/money-path code is the one standing exception to
  direct-push: always branch + PR + explicit owner go, regardless of who's in the chat.
- **If you push docs to `main` while a feature branch/PR is open on an overlapping doc
  section, expect to need a follow-up merge of `main` back into that branch** — GitHub will
  flag the PR `dirty` until you do. Not a sign anything is broken, just a mechanical follow-up
  (merge commit, no rebase, verify `mergeable_state` clears).
- **Model tiers:** the session's own model does scoping/briefs/synthesis/final review; delegate
  legwork (searches, catalog lookups, mechanical implementation, first-pass verification) to
  cheaper tiers, named by role not hardcoded model name.
- **Full verification block before any code push:** typechecks + all suites + benchmark 14/14 +
  6/6 + 0 fabricated + a real build; `audit:verify` on validator changes; an automatic
  `/code-review` pass at LOW effort over the diff, findings fixed or consciously dispatched.
  Docs-only pushes are exempt (no code diff to review).
- **This is a remote/cloud session container:** no persistent cross-session `MEMORY.md` or
  memory-file store exists here (confirmed empty this session) — the repo's own docs are the
  only durable store. Don't go looking for a memory directory that isn't there; see
  `docs/RUNBOOK.md`'s cloud-session-quirks entry (item 10) for the full explanation.

## End of session checklist

Before you wrap up, re-run the CLAUDE.md "Session wrap-up" ritual in full (8 items, Golden Rule
fact-verification, reproduce the checklist with ✅/⏭️ marks) — don't assume a partial pass is
enough, and don't skip the final self-audit step even under time pressure.
