# Session 156 kickoff (written 2026-10-04, at the session-155 wrap)

**Reading order:** CLAUDE.md → docs/STATUS.md top block (THE PLOT + "NEXT SESSION STARTS HERE") → this file →
[the side-by-side brief](2026-10-04-chatgpt-side-by-side.md). Verify every fact below against `git log` / `gh run list`
before trusting it.

## Where things stand (verified at wrap: `main` @ `0f2392a4` + the wrap docs commit; last code commit `3e9679c3` green in
CI incl. deploy; session 155 changed docs only; prod `checkdecijfers.vercel.app` 200)

- CBS and Eurostat any-table routes are LIVE (`TABLE_LANE_ENABLED=1`, `EUROSTAT_FINDER_ENABLED=1`; Eurostat index 7,561).
- **Session 155 ran the ChatGPT side-by-side** (#366): 12 everyday questions. **ChatGPT answered 12/12. We answered 7/12,
  and all 7 equal the official cell.** Our refusals:
  - Poland population and the highest EU debt: the finder found no table.
  - Care workers: the wrong table was picked.
  - Electric cars "op 1 januari 2025": #361. The refusal text says "name a year", although the question named one.
  - Netherlands in 2040: the refusal text falsely says CBS publishes no forecasts (CBS 86244NED exists).
  - Spain unemployment did answer, but only after a 35-option age question, and with an English title in the Dutch
    sentence.

## The owner's state

The owner was sceptical going in. He saw the scorecard and said "wrap up" before answering the recommendation, so
**nothing is decided**. Start by putting the recommendation to him in plain English (everything inside the question
dialog; he cannot see text above it).

## Recommendation awaiting GO

1. **Fix the false forecast refusal text.** This is small and needs no AI. Better still, check whether the lane can
   answer from a CBS prognosis table with the figure labelled as a forecast. Principle (a) holds: it is a published
   official number.
2. **Freeze a ~50-question everyday set** (CBS + Eurostat, everyday phrasing, no year and with a year, rankings,
   forecasts, broad topics). Freeze it like `benchmark/frontdoor-holdout-set.json`. Measure the answer rate, wrong
   numbers and refusals with false reasons. Draft it with a cheap-tier agent; the session reviews it.
3. **Fix the LAYER by failure class.** Order: finder misses (Poland, debt, care) → Eurostat defaults + Dutch titles →
   forecasts → ranking questions ("welk land heeft de hoogste") → "1 januari" (#361). Re-measure after each class.

## Binding constraints

- THE PLOT: the layer, never curating single tables (CLAUDE.md "Breadth comes from the layer"). A fix for "Poland
  population" must be a finder improvement, not a pin.
- Principles (a)/(b)/(c); a fabricated number is the worst bug. Refusal texts must not state false facts either.
- Live DDL, real LLM spend and env-flag flips stay owner-supervised.
- Owner present: push to `main` after the full verification block, `/code-review` LOW and green CI (#118).
- Autonomous sessions: branch + PR.
- A prompt change needs a re-record and a per-case diff (session-154 lesson). A validator change needs
  `npm run audit:verify -- 1 <max id>` before and after.
- Before switching anything on, count the production rows it depends on.

## How to repeat the side-by-side

- ChatGPT, logged out, in the Claude browser pane.
- Production in the owner's account via Claude in Chrome (ask first). An e-mail login link opens in Chrome, not in the
  pane.
- Ground truth from the CBS OData and Eurostat APIs.

## Machine note

Shared with the sibling project. Run `scripts/verify-block.sh` detached and wait on `=== DONE` (RUNBOOK §verification).

## Tracked, not the focus

- Session-155 kickoff items still open:
  - The Danish waste finder pick.
  - A daily refresh of the Eurostat index.
  - The `gov_10dd_ggd` counterpart-sector question.
- #359: audit rows that do not re-derive since the rebrand.
- Dependabot PRs open; GitHub reports 8 vulnerabilities on `main` (2 high). Monthly maintenance item.
