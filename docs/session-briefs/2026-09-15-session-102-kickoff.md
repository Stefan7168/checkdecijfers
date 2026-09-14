# Kickoff — session 102 (after session 101's autonomous WP30c E1 build)

Read in the normal order first: `CLAUDE.md` → `STATUS.md` (top block authoritative) → `08-build-plan.md` →
the rest as needed.

## What happened (2026-09-14/15, autonomous overnight, owner asleep/away)

Session 101 continued with WP30c phase E1 (the Eurostat adapter + an internal, flag-gated explorer, ADR
[048](../decisions/048-eurostat-data-source.md)) — the recommended target from the prior kickoff brief.
**Built, PR #23 open against `main`, NOT merged**
(autonomous, core-product code, [#118](../open-questions.md)(b) — branch + PR is the rule regardless of how
thoroughly it was reviewed before opening).

**Process followed exactly per this repo's own WP27/WP30 precedent:** ADR 048 (already design-level
adversarially reviewed) → a line-by-line executor brief → a SECOND, independent 4-lens adversarial review
of that frozen brief (6 confirmed findings, folded in as Amendments B1–B6) → built via parallel subagents →
a whole-branch integration pass (found 2 more real bugs) → the required LOW `/code-review` pass (2 more,
1 fixed) → a dedicated, separate final whole-branch review agent (found 1 more — the most serious of all
four) → the PR.

**Four real bugs, across four different review layers, none caught by any earlier layer:**
1. Merely registering the `eurostat` source made the existing chat UI's dynamic source-chip row surface and
   default-select a live "Eurostat data" chip to real users — a D3(b)/(c) violation with zero Eurostat data
   involved. Fixed via a new `SourceInfo.chatSelectable` field.
2. An implementer subagent reported wiring `adapterFor('eurostat')` as done; it had not touched the file.
   Caught only by re-grepping directly rather than trusting the report.
3. A stray null byte inside a hand-edited file made `git diff` report it as binary.
4. **Most serious**, caught only by the dedicated final whole-branch review agent: the live-chat deny gate
   was built reusing `EUROSTAT_EXPLORER_ENABLED` — the SAME flag the internal explorer's own visibility
   uses. Enabling the explorer (this same PR's own RUNBOOK-documented next step) would have silently
   re-opened the exact hole the guard existed to close. Fixed: the deny gate is now unconditional, no flag.

## Current state (verify against `gh pr view 23`/`git log` before trusting — this is a summary)

- `main` unchanged by this build except one docs-only commit (the frozen brief, `f1d95c5`) — everything
  else lives on branch `wp30c-e1-eurostat-adapter`, PR #23.
- Full verification, measured on the PR's final commit: root+web typecheck clean; backend suite 160 files
  / 2427 tests green (solo); web suite 106 files / 1743 tests green (solo); hermetic benchmark 14/14 + 6/6
  + 0 fabricated, GATE PASS, byte-identical (zero prompt bytes touched); a real `next build` succeeds.
- **CI confirmed green before this session ended** (`gh pr checks 23`, run `34885657335`: `backend (1/2/3)`
  and `web` all `pass`; `deploy` correctly `skipping`). Nothing blocks the PR on the tooling side — it's
  purely an owner-review wait now.
- **"Constraint 0" needs the owner's explicit confirmation on PR review**: this session read
  [08-build-plan.md](../08-build-plan.md)'s "any real Eurostat API spend stays owner-supervised, never
  autonomous" line literally — no live call to the real Eurostat API happened at all, even a free
  read-only one. Every fixture is hand-built and `"synthetic": true`; zero real Eurostat tables exist
  anywhere. If the owner says "spend" meant money specifically, the fixture-capture follow-up (below)
  could have been done autonomously too — but it wasn't, so nothing is lost by asking first.
- Four new residuals recorded: [#249](../open-questions.md) (Constraint 0 + the fixture-capture follow-up),
  [#250](../open-questions.md) (two small Dutch-wording/catalog-status sign-offs), [#251](../open-questions.md)
  (every Eurostat cell renders maximally provisional until a scoped `pipeline.ts` change lands, required
  before E2), [#252](../open-questions.md) (`request_urls` not wired into the live-chat proof panel yet).

## Next steps, in order

1. **Owner reviews and decides on PR #23** — merge, request changes, or reject. CI is already green
   (confirmed at session end, run `34885657335`); this is purely an owner-review wait, not autonomous —
   wait for the owner if this session is autonomous too, or hand it directly to the owner if present.
2. **If merged and Constraint 0 is confirmed**: the supervised follow-up is
   [RUNBOOK.md](../RUNBOOK.md)'s new "WP30c E1" section — run `npm run fixtures:capture:eurostat` under
   supervision, expect to need to correct `statistics-api.ts`'s URL shapes and `jsonstat.ts`'s
   `parseJsonStatCatalog` (both are explicitly commented as unverified), then re-run `tests/sources` and
   check `/eurostat-explorer` against real data.
3. **A good second autonomous target, not yet started**: the CI health-check gap the prior kickoff brief
   flagged — `/api/health`'s smoke check skips flag-gated tables it shouldn't for `pro_subscriptions`
   (the exact blind spot that let last session's real production incident happen). Branch + PR, not a
   merge, if done autonomously.
4. WP30c E2 (natural-language querying) is its own future design round — do not start it without the
   owner; it needs the taxonomy-widening decision, the source-ambiguity chip rule, and the owner-signed
   public-claim wording sweep, none of which are decided yet.

## Standing reminders (unchanged)

- Git workflow ([#118](../open-questions.md)): owner-present sessions push/merge directly; autonomous
  sessions on core-product/money-path code need branch + PR + owner review, no exception, regardless of
  how much review already happened before opening it.
- Live DDL, real API spend/calls, and env-flag flips: owner-supervised only, never autonomous.
- Never call `spawn_task` in this project (owner asked, 2026-09-14) — record follow-ups as
  `open-questions.md` rows instead.
- The Anthropic API usage cap noted in session 101 ([[project_anthropic_api_usage_cap_2026-09-14]] in
  memory) was not re-checked this session — verify live chat actually works end-to-end before assuming it
  does, if that's relevant to whatever this session is asked to do.
