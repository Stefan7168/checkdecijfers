# Session 112 kickoff — checkdecijfers.nl / graphmaker.studio

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it).
Verify everything below against `git log` / `gh run list` before trusting it.

## The short version

Session 111 (2026-09-17/18, owner present) was research + decisions, no product code. The owner made
**chart quality, and specifically editing a chart by chatting interleaved with the existing controls**,
the top priority, and lifted the session-88 parking of [#212](../open-questions.md). The decision is
ADR [056](../decisions/056-chart-copilot.md); the spec is
[superpowers/specs/2026-09-17-chart-copilot-design.md](../superpowers/specs/2026-09-17-chart-copilot-design.md);
the work package is the last section of [08-build-plan.md](../08-build-plan.md). The competitor study that
shaped it: [2026-09-17-competitor-g-deep-dive.md](2026-09-17-competitor-g-deep-dive.md) — **the repo is
public; never name the competitor, its people or investors** (call it "Competitor G").

## Your job: Chart co-pilot phase 1 (no LLM, no prompt bytes)

Design via SDD (brainstorm is done — the spec is approved by the owner; go to writing-plans, then
subagent-driven execution), build:

1. `web/lib/chart-commands.ts` — pure, serialisable commands with `apply`/`invert`; the existing
   `chartViewReducer` actions (`web/lib/chart-view-state.ts`) become command kinds; new kinds for notes,
   headline, caption, template.
2. One history per chart instance (one gesture = one entry; transient + seal for drags), ⌘Z/⇧⌘Z at the
   chart card, a small history popover with source icons (panel / canvas / chat).
3. Every existing control (`chart-config-panel.tsx`, `chart-edit-modal.tsx`, `chart-notes.tsx`, form
   switch, zoom, hide/highlight, templates) dispatches commands. Honesty locks in `resolvePresentation`
   keep running per render — unchanged.
4. In-place title/caption editing on the chart card (the headline stays digit-scanned).
5. `chart_edits` persistence: numbered migration (FILE ONLY — the owner applies it supervised, live DDL),
   write on every sealed command, restore on reopen, GDPR retention leg in `gdpr:purge` ([#274](../open-questions.md)).
6. Tests per the spec §6: apply/invert property test; a contract test that every command kind has a
   panel control; Playwright (hermetic harness): click → ⌘Z → panel reverts; embed still serialises
   the same state.

Then phase 2 (own-data co-pilot: widen `src/attachments/instruct/schema.ts` per ADR 037's addendum —
aggregate + the FIXED derived set, all forms, style, notes, narrate; recipe chips; per-reply
Undo/Retry) if the session has room. Phase 2's flag flip (`ATTACHMENTS_ENABLED`) is the owner's.

## Binding constraints and owner steers

- Cheapest mechanism first: phase 1 has zero model calls; phases 2–3 one cheap-tier call per chat edit.
- Two tiers: own data = full freedom (stop restating honesty caveats for it); CBS/Eurostat = selection
  only, numbers never through the model (R1/R6/R11 by construction).
- Chat may only emit what the panel offers (no chat-only capability); reply = recipe chips + one plain
  sentence per refused item naming the click path.
- Input label "Pas deze grafiek aan" / "Adjust this chart"; three deterministic example chips.
- Plain, full-sentence Dutch or English for the owner; no shorthand, no R-codes in owner-facing text.
- Git: owner-present sessions push to `main` directly after the full verification block (typechecks,
  all suites, benchmark 14/14 + 6/6 + 0 fabricated, real build, `/code-review` LOW); autonomous
  sessions use branch + PR ([#118](../open-questions.md)). Migrations are file-only; live DDL, real
  LLM spend and env flags stay owner-supervised.
- Tier rule: the session model thinks; mechanical fan-out on cheaper tiers, pinned per subagent.

## Owner steps still pending (from session 110 + 111)

`npm run registry:apply`; `npm run backfill:eurostat-doi -- --apply`; `npm run benchmark:run:live`;
region-set Task 9 ([#267](../open-questions.md)); audit row 22. Nothing new from session 111 — the
owner closed [#276](../open-questions.md) (accept) and said to leave the stray test chart alone.

## Tracked, not the focus

Rebrand to graphmaker.studio ([#7](../open-questions.md)); homepage themes row ([#275](../open-questions.md));
the engine question (Recharts vs Vega-Lite / Observable Plot / own SVG — phase 5 trigger only);
[#271](../open-questions.md) EN interface answers in Dutch; the session-110 residual rows.
