# Session 125 kickoff — checkdecijfers.nl / graphmaker.studio

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it, including
this file). Verify everything here against `git log` / `gh pr list` / `gh pr checks` before trusting it:
this file is a snapshot written 2026-09-23, session 124, not a live source.

## The short version

`main` is at `a996d3fa` plus session 124's wrap-up docs commits (docs only). **Own-data chart-fit + verified-whole
parity is LIVE** (`7694cf5c`, CI run 35766585479 green incl. deploy). Session 124 then worked autonomously
(owner: "Continue working autonomously, for hours and hours") and left **four PRs for the owner's review**,
plus a **design proposal** for Eurostat in chat. Nothing is half-built on a local branch: all four PR
branches are pushed.

## First: the four PRs (owner review, #118(b))

All four were locally fully verified (root + web typecheck, root and web vitest, real-browser Playwright on
the two chart specs, hermetic benchmark 14/14+6/6+0 fabricated, real `next build`, `/code-review` LOW) and
were `MERGEABLE` against `main` at close. They each edit different rows of `docs/open-questions.md`, so after
one merges the next may need a rebase. The adjacent-row edits WILL conflict, and a conflicting PR gets NO CI
run. Check `gh pr view <n> --json mergeable` after each merge.

1. **PR #37** `own-data-whole-focus-restore`: keyboard focus stays on a pie slice / stack segment after Enter
   designates it (the root cause was Recharts' `AnimatedItems` remounting every slice per render, not the
   reviewer's guess), plus `web/lib/chart-form-lists.test.ts`. CI green at close.
2. **PR #38** `own-data-incomplete-aggregate-note` ([#314](../open-questions.md)): own-data group totals that
   skipped blank cells are named under the chart; the total check refuses on them; audit reconstruction
   tolerates only pre-flag rows. **Owner veto point:** disclose (the PR) vs. refuse such totals outright. CI
   green at close.
3. **PR #39** `derived-overlay-distinct-ids` (#292/#294/#298): a repeated point in a difference/average overlay
   is refused at all three gates; eras ordered by axis position; two drift-guard tests. It was rebased after a
   conflict at close, so **confirm its CI is green first.**
4. **PR #40** `chart-phase4-ux-residuals` (#291/#293): remove chip visible on every form; era labels instead of
   raw codes; theme colour; dead code removed. CI green at close.

If the owner is present and approves, merge them (owner-present sessions merge directly per the #118
revision), then confirm `main`'s CI and flip the docs (#312/#314/#291–#298 rows, STATUS) from "PR" to "LIVE".

## Then: the main architectural candidate — Eurostat in chat, slice E2a

Design PROPOSAL: `docs/superpowers/specs/2026-09-23-eurostat-e2a-country-answers-design.md`
([open-questions #313](../open-questions.md)). Six owner decisions are in its §7 (slice first; one source per
answer; confirm-chip wording; which 3 topics; country list; build steps 1–4 dark now). **Do not build it
before the owner answers those.** Its step 0 (recording real AI parses of ~10 country questions under the
unchanged prompt) needs live model spend, and the Anthropic API cap lifts 2026-10-01. If the owner approves
before then, steps 1–4 (Dutch country-name list, source-aware region predicate, sibling map + clarification
chip, wiring point 3, `b`-flag refusal) are zero-spend and can be built dark on a branch.

## Binding constraints and owner steers (carried forward)

- Cheapest mechanism first; plain full-sentence English for the owner; no shorthand.
- Git (#118): owner present → push/merge to `main` directly after the full verification block + `/code-review`
  LOW; autonomous → branch + PR + owner review. Live DDL, real LLM spend and env-flag flips stay
  owner-supervised.
- **Before any docs-only push: `npx vitest run tests/docs`** (docs-only pushes skip CI; #132 rule (i) forbids
  PR links in docs; this bit session 124).
- Tier rule: the session model does the thinking; research/legwork goes to cheaper tiers (session 124 used
  Sonnet `Explore` agents for the three read-only surveys).
- Never call `spawn_task`; track follow-ups as open-questions rows.
- The repo is public: "Competitor G" only.
- [[feedback_architecture_over_polish]]: session 124's autonomous PRs were mostly correctness/polish because
  the architectural work (E2a) is owner-gated. Say so when proposing what's next.

## Tracked, not the focus

- Owner steps blocked on the API cap until 2026-10-01: registry:apply, DOI backfill, live benchmark,
  region-set Task 9, audit row 22, all `:record` confirmations.
- Dependabot PRs #35/#36 (maintenance-session item).
- Stale worktree `chart-copilot-phase6` @ `58db5097` (fully merged into `main`): the owner's call to remove.
- #277(b) (should a public embed show the author's later edits?) and #309 (`setDimmed` replaces the hidden
  set) are product decisions for the owner; #287 is deferred until a merged-card design exists.
