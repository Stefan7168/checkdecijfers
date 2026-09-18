# ADR 056 — Chart co-pilot: one command log, two doorways, two trust tiers

**Status:** accepted 2026-09-18 (session 111, owner present in chat; decisions recorded in
[open-questions #212](../open-questions.md) and #274). Not built. Spec:
[superpowers/specs/2026-09-17-chart-copilot-design.md](../superpowers/specs/2026-09-17-chart-copilot-design.md).
Research that shaped it: [session-briefs/2026-09-17-competitor-g-deep-dive.md](../session-briefs/2026-09-17-competitor-g-deep-dive.md).

## Context

Since session 89 (ADR 038) a shown chart can be adjusted with on-screen controls only (form switch,
zoom, hide/highlight, notes; since session 91 the style panel, templates, colours, fonts; later the
headline, insights, story stage). Chat-driven editing of a CBS chart was designed in session 88 and
deliberately parked ("no LLM instruction schema in v1; build it only on usage evidence"). The own-data
tier (ADR 037) has a narrow chat path — column/filter/line-or-bar selection with a refinement
referent — behind a flag that is unset in every environment.

On 2026-09-17 the owner made chart quality, and specifically **editing charts by chatting, interleaved
with the direct controls**, the top priority, and lifted the session-88 parking: there are no users yet
to produce the usage evidence it waited for. A hands-on study of the closest competitor the same day
showed what a chat co-pilot gets wrong when bolted on: its AI could not reach styling or annotations
("I can't change the line thickness directly"), each AI step was stateless (a later prompt dropped an
earlier filter and un-hid series), and its undo existed only per chat message and lost the title.

Constraints that bind every option: R1/R6/R11 for CBS/Eurostat charts (numbers never pass through the
model; the renderer never computes or omits; provisional marks stay), ADR 037's structural tier
separation for own data, ADR 032 (web findings never become chart data), and the cheapest-mechanism
rule (no LLM/DDL/cost until it earns its place).

## Decision

1. **One state, one log.** Every edit to a chart — from a panel control, a canvas gesture, or a chat
   reply — is a small serialisable command applied to the same client view-state, with `apply` and
   `invert`, on one undo/redo history (one gesture = one entry). The panel is a view over that state,
   so whatever the chat did is visible in the panel afterwards and vice versa.
2. **Two doorways, one vocabulary.** The chat may only emit values the panel already offers for THIS
   chart: the request carries a generated `capabilities` list (applicable presentation keys and values,
   series, period bounds, allowed forms, templates; own-data only: the column profile), the model
   returns a command list constrained by a JSON schema built from it, and deterministic code validates
   every command against the live state before dispatch. The reply is a **recipe**: chips with the
   panel's own icons, one plain sentence per refused item naming the click path. No chat-only
   capability may exist (a contract test enforces it).
3. **Two trust tiers, one surface.** Own data: everything, including aggregate and a fixed set of
   derived columns (difference, share of total, percent change, ratio; owner decision 2026-09-18),
   computed by our executor, never by the model. CBS/Eurostat: selection only; "add another region" is
   a new question through the existing follow-up path, shown as an extension of the same card when
   compatible. Internet findings are not chart data, so there is no third tier.
4. **Persistence in the account from phase 1** (owner decision 2026-09-18, overriding the per-visit-first
   recommendation): a `chart_edits` table holds the command log per (user, chart), numbered migration
   applied supervised, retention under the monthly GDPR purge.
5. **Chart-fit is rule-based.** A deterministic scorer ranks forms with visible reasons and is the
   honesty gate for pie/stacked forms (disqualified unless the parts are a complete whole). No model.
6. **Narrate is the one text the model writes** (headline/caption on request); every digit in it must
   be a plotted value (the existing digit scan).
7. **Input label:** "Pas deze grafiek aan" / "Adjust this chart", with three deterministic example chips.

## Alternatives considered

- **Build on the competitor's SDK** (grammar-of-graphics engine with a command system and AI agents).
  Rejected: closed source under a licence that flips to "contact us" past a size threshold; its engine
  computes inside the chart (stats, stacking), which is hard to reconcile with R6 through code we cannot
  read; a beta dependency at the core of the product.
- **Chat-only editing** (the "AI-native" route). Rejected: the owner explicitly wants both doorways
  interleaved, and the competitor's own designer wrote that clicking beats typing "switch to a heatmap";
  a chat-only path also makes every edit a paid call.
- **Panel-only, keep #212 parked** (the session-88 decision). Superseded by the owner: the evidence it
  waited for cannot arrive before launch, and the feature is now the differentiating UX.
- **Stateless config-in/config-out per AI turn** (the competitor's mechanism). Rejected on the hands-on
  evidence: it loses earlier edits; we apply diffs on the current state instead.
- **Per-visit state first, persistence later.** Recommended by the session, overridden by the owner
  (decision 4) — recorded as such.

## Consequences

- Phase 1 needs no model and no prompt bytes; phases 2–3 add one cheap-tier call per chat edit and one
  new route; phase 1 adds one table and one supervised migration.
- The style panel (#218) and the own-data instruction schema (ADR 037) both change shape: dispatch
  becomes commands; `unsupported.reason: 'aggregation' | 'computation'` disappears.
- Benchmark and audit are untouched: chart edits never write audit rows and never change the answer's
  numbers.

## Revisit triggers

- Logged "could not do" chat requests show demand for free arithmetic on own data → widen the derived set.
- A form the scorer disqualifies is repeatedly requested on CBS data → revisit the honesty rule, not the gate.
- The command log grows beyond what a JSON column comfortably holds per chart → snapshot + tail.
- Recharts cannot draw a phase-5 form cleanly → the engine ADR the plan already foresees (Vega-Lite /
  Observable Plot / own SVG; never the competitor's SDK).
