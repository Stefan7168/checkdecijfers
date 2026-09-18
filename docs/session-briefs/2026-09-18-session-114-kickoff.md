# Session 114 kickoff — checkdecijfers.nl / graphmaker.studio

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it).
Verify everything below against `git log` / `gh run list` before trusting it.

## The short version

Session 113 (2026-09-18, owner present) built and merged **chart co-pilot phase 2 — the own-data
co-pilot** (ADR [056](../decisions/056-chart-copilot.md) "As built — phase 2"): on a chart from a
reader's own uploaded file, the reader can change the data (a fixed aggregate/derived set, computed
by our executor), the form, the style, notes and title/caption — by clicking a Data panel or by
typing "Pas deze grafiek aan" under the chart — all on the one undo history phase 1 built, saved per
account. Merged to `main` `f5bb6cd..caa23a7`; every suite, the benchmark, two real-browser proofs and
`next build` green at merge. The feature is DORMANT until the owner sets `ATTACHMENTS_ENABLED=1`.
Plan with every ruling: [superpowers/plans/2026-09-18-chart-copilot-phase2.md](../superpowers/plans/2026-09-18-chart-copilot-phase2.md).

## Owner steps that come BEFORE the next build (RUNBOOK)

1. `npm run db:migrate` — applies migrations 034 + 035 together (`chart_edits` + its own-data key).
   Until then chart edits are silently not saved on either card.
2. `npm run attachments:record` — four real cheap-tier calls; read the printed diff between the
   hand-authored fixtures and the real model output; update `tests/fixtures/attachments/cases.ts`
   if any case differs; commit.
3. Set `ATTACHMENTS_ENABLED=1` in Vercel + redeploy; run the WP202 smoke test (RUNBOOK § WP202).
Plus the unchanged list: `npm run registry:apply`, `npm run backfill:eurostat-doi -- --apply`,
`npm run benchmark:run:live`, region-set Task 9 ([#267](../open-questions.md)), audit row 22.

## Your job: phase 3 — the CBS/Eurostat chat doorway (spec §3.3, §5 phase 3)

Design via `superpowers:writing-plans` (the brainstorm is the approved spec), then
subagent-driven development. What phase 2 leaves ready for you:
- `web/components/chart-copilot-input.tsx` (`ChartCopilotInput`, `RecipeChips`) and
  `web/lib/chart-copilot-reply.ts` (`acceptReply` — shape-parse + `validateCommand` before dispatch,
  `refusalLine`) are tier-agnostic; `web/lib/chart-capabilities.ts` has the own-data capability
  builder to mirror for CBS (`resolvePresentation().applicable`, allowed forms, templates, series
  labels, period bounds).
- The backend pattern to mirror, one directory over: `src/attachments/copilot/{schema,prompt,parse,
  map,text-guard,respond}.ts`. For CBS the schema is SELECTION-ONLY (form within `lineFormAllowed`,
  period range, hidden/highlighted series by label, style keys, template, note text at a plotted
  point, title/caption) — no instruction, no data change; "en Amsterdam erbij" is a NEW question
  through the existing follow-up path (ADR 021), shown as "Grafiek uitgebreid" in the same card when
  compatible. Numbers never through the model (R1/R6/R11); the digit guard for narrate text must
  use the CBS spec's `formattedValue`/period labels. Where the turn is recorded: a CBS chart edit
  must NOT write `audit_answers` (spec §6) — decide the record (probably `chart_edits` only + a
  cost row) in the plan and get the owner's eye on it early.
- Persistence key for CBS charts already exists (`{ kind: 'answer', id: auditId }`).
- Watch: the CBS card (`chart.tsx`, ~4,600 lines) has embed/story/stage modes the own-data card does
  not — the input must be gated exactly like the history actions (`!embedMode && !inStage`, story
  lock).

## Binding constraints and owner steers

- Cheapest mechanism first; one cheap-tier call per chat edit, zero for panel edits.
- Own data = full freedom (done); CBS/Eurostat = selection only; refusals name the click path.
- Plain full-sentence Dutch or English for the owner; no shorthand, no R-codes.
- Git: owner-present → push to `main` after the full verification block (typechecks, all suites,
  benchmark 14/14 + 6/6 + 0 fabricated, both Playwright proofs, `next build`, `/code-review` LOW);
  autonomous → branch + PR ([#118](../open-questions.md)). Migrations file-only; live DDL, real LLM
  spend, env flags owner-supervised. The repo is public: "Competitor G" only.
- Tier rule: the session model thinks; implementers/reviewers on cheaper tiers; the whole-branch
  final review on the most capable tier. Two implementers at a time in disjoint worktrees works on
  this 8 GB machine (symlink `node_modules`, never `git add -A`); Playwright and `next dev` only in
  the main checkout. Check `df -h` before the first build; delete superseded `ms-playwright`
  browser folders. Wait on a subagent with a background `until` loop on its worktree's HEAD, not
  `TaskOutput` with a timeout (it dumps the transcript into your context).

## Tracked, not the focus

[#280](../open-questions.md)–[#284](../open-questions.md) (phase-2 residuals: chip click opens the
panel not the row, `count` semantics, the Data panel's English problem line, the reply lives in
the card, fixture scripts); [#277](../open-questions.md)–[#279](../open-questions.md) (headline not
on the history + embed page not reading `chart_edits`; exports exclude reader text; seeded
generator); rebrand to graphmaker.studio ([#7](../open-questions.md)); homepage themes row
([#275](../open-questions.md)); [#271](../open-questions.md).
