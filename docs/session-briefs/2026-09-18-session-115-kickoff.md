# Session 115 kickoff — checkdecijfers.nl / graphmaker.studio

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it).
Verify everything below against `git log` / `gh run list` before trusting it.

## The short version

Session 114 (2026-09-18, owner present at the start, then delegated: "het maakt me niet uit wat je
doet, ga er gewoon voor") did two things:

1. **The three owner steps for phase 2, as far as the world allowed.** Migrations 034 + 035 are
   APPLIED to production (11:14 UTC, all RUNBOOK post-checks pass); `npm run pricing:apply` put the
   `dataset_turn` price row in place; `ATTACHMENTS_ENABLED=1` is set in Vercel Production and deployed
   (by re-running the last green CI run — a bare `vercel --prod` from a laptop fails, see
   lessons-learned). **`npm run attachments:record` is BLOCKED** by the Anthropic workspace usage cap
   (400 "regain access on 2026-10-01"), the same cap that refuses every live chat since 2026-09-14
   ([#288](../open-questions.md)). The own-data tier is LIVE for upload, chart, Data panel, undo and
   persistence; its chat doorway refuses until the cap lifts.
2. **Chart co-pilot phase 3 — the CBS/Eurostat chat doorway — BUILT and pushed to `main`**
   (`6c7d9c4e..f09945c7` + docs; ADR [056](../decisions/056-chart-copilot.md) "As built — phase 3";
   plan [superpowers/plans/2026-09-18-chart-copilot-phase3.md](../superpowers/plans/2026-09-18-chart-copilot-phase3.md)).
   Four implementer tasks in two worktree waves, one fix round, one final review on the most capable
   tier (eight minor findings, four fixed in a final wave, four recorded). The full verification block
   ran before the push; CI's verdict for the push is in STATUS.

## What phase 3 is (one paragraph, plain words)

Under a CBS or Eurostat chart the reader can now type "Pas deze grafiek aan". One cheap model call
returns a list of VIEW changes by label — form, which series to hide or spotlight, a period range,
style, template, title, caption, a note at a plotted point — and a flag saying "this asks for other
data". Code turns labels into keys by looking them up in the chart, refuses any text with a number
that is not on the chart, and the card checks every command again before applying it on the same undo
history the panel uses. The figures never change through the chat. A request for other data becomes
one chip, "Stel als vervolgvraag", that sends the reader's own words as a normal follow-up question;
if that answer's chart is compatible (same table, unit, kind, dims) it is badged "Grafiek uitgebreid"
and opens in the previous card's saved form and look. Each chat edit costs the `clarification` price
(10 credits) through the existing ledger — no migration, no audit row.

## Owner steps pending (RUNBOOK)

- After 2026-10-01 (or after raising the workspace limit in the Anthropic Console): `npm run
  attachments:record` and `npm run chart-copilot:record`, read the diffs, update the cases files,
  commit ([#288](../open-questions.md)).
- Then the real smoke tests that need the model: WP202 step 6 (a question on an uploaded file, a chat
  edit on its chart) and a CBS chat edit on production ("verberg Rotterdam" on a two-region chart).
- Two pricing decisions ([#285](../open-questions.md)): re-price the CBS chart edit with its own
  action class later; and whether an `edit` reply that applied nothing (the data-request hand-off,
  "Nothing could be applied.") should refund like a clarification.
- Unchanged from sessions 110/111: `npm run registry:apply`, `npm run backfill:eurostat-doi -- --apply`,
  `npm run benchmark:run:live`, region-set Task 9 ([#267](../open-questions.md)), audit row 22.

## Your job: phase 4 — storytelling primitives via both doorways (spec §5 phase 4)

Goal line (a reader-typed value — a NOTE-like annotation, never a computed number), average line
(server-derived, traced to its cells), difference arrow (a registered derivation), dim-not-hide, era
shading, headline number. Design via `superpowers:brainstorming` → `writing-plans` (the spec is
approved at the §5 level only; each primitive needs its provenance rule spelled out against R1/R6),
then subagent-driven development. Cheapest mechanism first: every primitive is a panel control FIRST
and a chat command SECOND (the chat vocabulary may never exceed the panel's — the contract test pins
it). Anything server-derived (average, difference) is computed by deterministic code from the
validated result and carried in the spec or a sibling record with resultIds — never by the model,
never in the browser from plotted values. Get the owner's eye on the provenance rule before building.

## Binding constraints and owner steers

- Cheapest mechanism first; plain full-sentence Dutch or English for the owner; no shorthand.
- Git: owner-present → push to `main` after the full verification block (typechecks, root + web
  suites run SOLO on this 8 GB machine, benchmark 14/14 + 6/6 + 0 fabricated, the three Playwright
  proofs `chart-copilot`, `own-data-copilot`, `cbs-copilot`, `next build`, `/code-review` LOW);
  autonomous → branch + PR ([#118](../open-questions.md)). Migrations file-only; live DDL, real LLM
  spend, env flags owner-supervised. The repo is public: "Competitor G" only.
- Tier rule: the session model thinks; implementers on a cheaper tier; the whole-branch final review
  on the most capable tier — and budget a fix wave for it (it found four real UI defects this time).
- Worktree mechanics that worked: `git worktree add -b <task> ../cdc-wt-<task> main` (LOCAL main, so
  nothing has to be pushed mid-phase), symlink `node_modules` and `web/node_modules`, never
  `git add -A`; wait on a subagent with a background `until git log -1 | grep …` loop on its worktree,
  not `TaskOutput`; if an agent reports "running in the background", check the worktree's HEAD and
  stop the agent once the commit exists.
- Never write a soft word ("acceptable", "fine to skip for now") next to a required leg in a plan.

## Tracked, not the focus

[#285](../open-questions.md)–[#288](../open-questions.md) (phase-3 residuals: pricing, no turn record
for CBS chat edits, series merge + the remount/colour-key residuals of "Grafiek uitgebreid", the
`:record` scripts blocked by the cap); [#280](../open-questions.md)–[#284](../open-questions.md)
(phase-2 residuals); [#277](../open-questions.md)–[#279](../open-questions.md); rebrand to
graphmaker.studio ([#7](../open-questions.md)); homepage themes row ([#275](../open-questions.md)).
