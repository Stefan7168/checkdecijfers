# Session 113 kickoff — checkdecijfers.nl / graphmaker.studio

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it).
Verify everything below against `git log` / `gh run list` before trusting it.

## The short version

Session 112 (2026-09-18, owner present) built and shipped **chart co-pilot phase 1** (ADR
[056](../decisions/056-chart-copilot.md)): one command log with undo/redo behind every chart control,
⌘Z at the card, a history menu, in-place title and caption, and per-account persistence of the log
(`chart_edits`, migration 034 — **file-only, the owner applies it**). Merged to `main`
`7a9b737..3c295f1`, CI run `35306079885` green incl. deploy, production 200. Zero model calls.
Plan with every ruling: [superpowers/plans/2026-09-18-chart-copilot-phase1.md](../superpowers/plans/2026-09-18-chart-copilot-phase1.md).

## Your job: phase 2 — the own-data co-pilot (spec §3.2, §3.3, §5 phase 2)

Design via `superpowers:writing-plans` (the brainstorm is the approved spec), then subagent-driven
development. Two facts an Explore pass established at the end of session 112 that the plan must
resolve **before** any task is dispatched:

1. **`UserChartView` (`web/components/user-chart.tsx`) does not reuse `ChartView`.** It renders a
   `UserChartSpec` that, by ADR 037 D11, must NOT parse as a `ChartSpec` (a trust guard), reusing only
   ChartView's pure helpers. So the phase-1 machinery (commands, history, style panel, title/caption,
   `chart_edits`) is not on the own-data card yet. Options: (a) a shared card shell that takes a
   "plottable" adapter so both tiers mount the same controls while the D11 type guard stays; (b) port
   a subset. Recommendation from session 112: (a) — one history, one panel, one vocabulary is the
   whole point of ADR 056 decision 1; keep the D11 guard at the type/adapter boundary. Persistence key
   for own-data charts: the dataset thread's message id (there is no `audit_answers` row).
2. **Widening the instruction schema costs real model calls.** `src/attachments/instruct/schema.ts`
   (`chartInstructionSchema`, `unsupported.reason: 'aggregation'|'computation'|…`) and
   `DATASET_INSTRUCT_PROMPT_VERSION = 1` (`prompt.ts`) — adding `aggregate` (sum/mean/min/max/count per
   group) and `derived` (difference, share of total, percent change, ratio of two columns; the owner's
   FIXED set), all forms, style, notes and narrate means a prompt bump and re-recorded fixtures. There
   is **no `attachments:record` script today** (the `*:record` scripts cover intent/clarify/followup/
   answer/tablefinder/measurefit/semantic-check); `tests/attachments/instruct-parse.test.ts` uses a stub
   client. Plan: build schema + executor + validation + UI hermetically with hand-authored instruction
   fixtures (the executor is pure: `src/attachments/execute.ts`), add an `attachments:record` script,
   and leave the recording run + `ATTACHMENTS_ENABLED` flip as owner-supervised steps.

Then the chat doorway itself: the input "Pas deze grafiek aan" / "Adjust this chart" under the
chart, `capabilities` generated from the live chart state, a JSON-schema-constrained cheap-tier call
(`jsonSchema` on `LlmRequest`, see `src/answer/llm/client.ts`), deterministic validation of every
returned command (`validateCommand` from phase 1) before dispatch with `source: 'chat'`, the reply as
recipe chips + one plain sentence per refused item, per-reply Undo/Retry/👍👎 (logged, no model call),
three deterministic example chips. The contract test from phase 1 (every command kind has a control)
is the "no chat-only capability" guard — keep it green.

## Binding constraints and owner steers

- Cheapest mechanism first; one cheap-tier call per chat edit, zero for panel edits.
- Own data = full freedom (aggregate + the fixed derived set, computed by the executor, never by the
  model); CBS/Eurostat = selection only (phase 3, not this session).
- Chat may only emit what the panel offers; refusals name the click path, never "request a feature".
- Plain full-sentence Dutch or English for the owner; no shorthand, no R-codes.
- Git: owner-present → push to `main` after the full verification block (typechecks, all suites,
  benchmark 14/14 + 6/6 + 0 fabricated, `next build`, `/code-review` LOW); autonomous → branch + PR
  ([#118](../open-questions.md)). Migrations file-only; live DDL, real LLM spend, env flags stay
  owner-supervised. The repo is public: "Competitor G" only.
- Tier rule: the session model thinks; implementers/reviewers on cheaper tiers, the whole-branch
  final review on the most capable tier. One implementer at a time in a shared tree; reviewers, a
  docs subagent and the verification block may run alongside (owner asked for parallelism).
- Watch disk space before `next build` (`df -h`); a verification subagent may background a suite
  and stall — resume it with an explicit foreground instruction.

## Owner steps pending

`npm run db:migrate` for migration 034 (RUNBOOK § "Supervised live step — migration 034");
`npm run registry:apply`; `npm run backfill:eurostat-doi -- --apply`; `npm run benchmark:run:live`;
region-set Task 9 ([#267](../open-questions.md)); audit row 22.

## Tracked, not the focus

[#277](../open-questions.md) headline not on the history + embed page not reading `chart_edits`
(phase 3); [#278](../open-questions.md) exports exclude reader text; [#279](../open-questions.md)
seeded generator vs fast-check; the plan ledger's parked minors (replayed note labels trusted; a
failed save is invisible; caption has no "your own words" marker; the top history entry click is a
no-op; `templateById`'s non-null signature); rebrand to graphmaker.studio ([#7](../open-questions.md));
homepage themes row ([#275](../open-questions.md)); [#271](../open-questions.md).
