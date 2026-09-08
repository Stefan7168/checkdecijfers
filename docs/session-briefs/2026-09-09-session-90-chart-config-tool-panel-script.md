# Session 90 — the #218 architecture-panel workflow script (durable copy)

Copied verbatim from the session directory so the panel can be re-run or audited from the repo alone.

```js
export const meta = {
  name: 'chart-config-tool-architecture',
  description: 'Design panel + synthesis: architecture and phased plan for a Recharts-style chart CONFIGURATION tool (#218) on checkdecijfers.nl',
  phases: [
    { title: 'Design', detail: 'four independent architecture proposals from different angles (Fable)' },
    { title: 'Synthesize', detail: 'Fable synthesizes the strongest plan, flags invariant risk, lists owner decisions' },
  ],
}

const SHARED_CONTEXT = `
You are designing an architecture + phased execution plan for a chart CONFIGURATION tool on
checkdecijfers.nl (open-questions #218) — a product where chat Q&A over official CBS statistics is
answered ONLY by deterministic code computing every number; the LLM only parses intent and phrases
already-validated results. Every number on screen must trace to a CBS cell. Today is ${args.date}
(session ${args.session}). The repo is the current working directory.

THE OWNER'S ASK (verbatim intent, recorded 2026-09-08 on open-questions row #218): "a Recharts-style
chart configuration tool — pick a chart type, adjust presentation options (the owner's example: line
size/thickness), with the tool PRE-FILLED with whatever the chart currently uses as a starting point,
not blank defaults" and "how far 'people can choose which one they want to use' extends — per-chart
choice? a saved per-user preset?". Reference the owner linked: tillitsdone.com/tools/rechart, a Recharts
config playground. Its actual control inventory (read from the live page today): chart type
(Line / Bar / Pie / StackBar / Area); "Size of line" (px number); Hide Legend (yes/no); Hide Grid;
Hide X Axis; Hide Dots; Suffix for label X (text, e.g. a unit); Label X edge margin (number); Label X
angle (number); Hide Y Axis; Suffix for label Y; Label Y angle; Hide Tooltip; Reference line label
(text). Output: a live preview + a copyable code snippet + "copy link / save". Note this is a
developer playground that emits CODE — the owner wants the end-user analogue on an already-answered
CBS chart, where the "output" is the chart itself (and its PNG/SVG download), never code.

READ THESE BEFORE PROPOSING ANYTHING (do not trust this summary over the files):
1. CLAUDE.md — especially the "cheapest mechanism first" convention (owner standing rule 2026-09-08:
   every new feature defaults to no AI call, no schema/DB change, no added cost; escalate only on
   measured evidence) and the product principles (a)/(b)/(c). Also its UI-copy convention (English for
   new UI chrome since session 84, BUT the CBS chart pipeline's own controls shipped in Dutch in
   session 89: "Lijn/Staaf/Tabel", "Kleine grafieken", "Vanaf/Tot") — flag the language question for
   the owner rather than deciding it.
2. docs/05-data-rules.md IN FULL — R6 (chart specs built by deterministic code; the renderer cannot
   compute or omit; the rendered chart shows no numeric token that is not a spec string), R8 (every
   answer's emitted chart spec is audited and stored FOREVER), R11 (provisional figures are MARKED —
   on the chart today that is the hollow point marker / hatched bar, which a "hide dots" or heavy
   stroke option could erase), R1/R9/R10 (traceability, semantic binding of direction/comparison
   words, unit adjacency — the invariants any NEW chart TYPE such as pie/stacked/area is closest to
   violating: a pie implies parts-of-a-whole, a stack implies additivity, an area implies magnitude
   and therefore a zero baseline). Also the resolved #48 policy: bars floor at zero, lines may zoom
   (see yAxisDomain in web/components/chart.tsx and its comment).
3. docs/decisions/038-chart-view-state-editing.md (ADR 038) — what shipped 2026-09-08 and is LIVE:
   a pure client-only view-state reducer (web/lib/chart-view-state.ts: form line/bar/table,
   hiddenKeys, highlightedKey, periodRange) driven by on-screen controls in web/components/chart.tsx,
   zero LLM/DDL/prompt-byte cost, never audited, never persisted. Its 8 lettered decisions A-H: G
   (transparent PNG) and H (map) are untouched; F (persistence of notes) was built to the
   conservative session-only default. This is the OBVIOUS home for presentation state — say whether
   you extend it, sit beside it, or replace it, and why.
4. docs/decisions/007-chart-spec-rendering.md (ADR 007) — the chart spec is the reserved seam for the
   future "Visualisatie Studio"; renderers dispatch on schemaVersion; the spec vocabulary is
   deliberately minimal. Also src/chart/types.ts (ChartSpec: kind 'line'|'bar', series, unit, dims,
   attribution, provisionalNote, nullNotes, annotations?) and src/chart/render.ts (the server-side
   deterministic SVG renderer — find where it is actually used before claiming anything about it).
5. docs/12-huisstijl.md (Charts section + house rules) and
   docs/superpowers/specs/2026-09-07-chat-chart-visual-redesign-design.md (the "Charts" bullet):
   OWNER DECISION session 87 — "use Recharts' basic/default styling", stock palette
   (RECHARTS_PALETTE), explicitly NOT a custom palette; house rule 1 "tokens, not colours" (the
   series palette is a sanctioned literal-hex spot); house rule 3 "both themes, always" (light AND
   dark — any user-chosen colour or grey must read in both; AXIS_COLOR/GRID_COLOR are theme tokens
   for exactly this reason). A config tool that lets a user change colours or line weights must be
   reconciled with that decision explicitly: does it change the DEFAULT look (it must not, without
   the owner) or only add per-user overrides on top of the stock default?
6. docs/03-mvp-scope.md non-goals row "A full drag-and-drop 'Visualisatie Studio' chart-authoring
   tool" (Phase 2-3, seam reserved via ADR 007). #218 pulls a SLICE of that forward. Design the
   slice; say explicitly what stays in the studio non-goal (e.g. free-form sizing, social formats,
   embeds, arbitrary drag-and-drop).
7. docs/open-questions.md rows #218 (this ask), #212 (the chart-editing architecture history —
   search "| 212 |"; note the session-88 architecture-panel synthesis it links, whose conclusion was
   "no LLM instruction schema in v1, deterministic on-screen controls"), #215 (owner wants PDF export
   and a transparent, no-baked-text PNG — out of scope, but say if your design touches
   web/components/chart-download.tsx), #214 (mobile header squeeze at 375px — any panel you add must
   work on a phone).
8. THE ACTUAL CODE, read it properly: web/components/chart.tsx (ChartView, ~1400 lines: the
   hard-coded presentation today is strokeWidth 2, type "linear", custom SeriesDot r=4 hollow-when-
   provisional, custom SeriesBar with a hatch pattern when provisional, CartesianGrid "3 3", XAxis
   period labels, YAxis with honesty-bound custom ticks (only a point's own formattedValue — Recharts'
   own tick numbers are switched OFF: "no invented axis ticks"; on a zoomed line axis the plotted
   min/max are labelled so a non-zero baseline is disclosed), NO Recharts Legend component (a custom
   SeriesLegend with hide/highlight for >1 series), a custom Tooltip that only shows formattedValue,
   ReferenceLine markers for curated annotations, isAnimationActive=false, end-of-line and per-bar
   value labels from valueLabelPlan, margins computed from label widths, RECHARTS_PALETTE cycling
   at 9+ series); web/lib/chart-view-state.ts; web/components/chart-download.tsx (export clones the
   live svg and inlines COMPUTED paint for var()/currentColor — attributes like stroke-width travel
   as-is; the attribution footer is baked in); web/components/chart-small-multiples.tsx (line-only
   panels); web/components/user-chart.tsx (UserChartView for user-uploaded data reuses chart.tsx's
   pure helpers — say whether your design covers it or CBS ChartView only); web/components/
   visual-dock.tsx and web/components/chart-toggle.tsx (both swap the spec prop on ONE mounted
   ChartView — the reducer's reset-on-spec-swap logic matters for "pre-filled with current values");
   web/components/theme-toggle.tsx and web/app/systeemoverzicht/system-map-content.tsx (the two
   existing localStorage precedents — the cheapest persistence this codebase already uses);
   web/components/chart.test.tsx (how presentation is tested today: data-label-for bindings,
   data-series-dimmed attributes, jsdom).
9. Recharts is ^3.10.1 (web/package.json). Verify any prop you rely on against the INSTALLED
   library in web/node_modules/recharts (e.g. Line: strokeWidth, type curve, dot/activeDot, Bar:
   barSize/radius/stackId, Area, Pie, Legend) — session 89's lesson: a plan's illustrative snippet
   assumed Recharts forwards fillOpacity into a custom shape and it does not. Do not assume.

NON-NEGOTIABLE DESIGN CONSTRAINTS:
- "Cheapest mechanism first": the first shippable phase must need ZERO LLM calls, ZERO database
  migrations, ZERO prompt-byte changes, and no new dependency unless you justify it against the CDN/
  bundle cost. Anything with an LLM or DDL is a LATER, CONDITIONAL phase gated on measured usage.
- The default look of every chart stays exactly the owner's session-87 stock-Recharts decision
  until the owner says otherwise; a config tool adds a user's OVERRIDE on top, pre-filled with the
  current effective values (which after ADR 038 may already differ from the spec's defaults — e.g.
  the user already switched to Staaf or zoomed; "current" means what is on screen NOW).
- Every displayed numeric string stays a spec string bound via data-label-for; no option may make
  Recharts invent axis numbers; R11 marking must remain visible or be replaced by an equally visible
  marking when an option would hide it; bars (and any magnitude-encoding form) keep a zero baseline.
- Both themes, mobile width, keyboard/screen-reader operable (the existing tablist/aria-pressed
  patterns), and the export path must still produce a faithful PNG/SVG of what is on screen.

YOUR JOB: propose a CONCRETE architecture (what code changes, where, which mechanism, exact
modules/files) AND a phased, ordered execution plan (each phase a real shippable increment), covering
ALL THREE of the owner's questions:
(a) CHART-TYPE SELECTION — which chart types beyond line/bar/table are HONEST for which spec shapes
    (single-series time series vs multi-series time series vs multi-region comparison), with explicit
    allow/refuse rules (pie? stacked bar? area? scatter? horizontal bar?), and how a refused type is
    presented (disabled with a reason, like the current disabled "Lijn" tab).
(b) ADJUSTABLE PRESENTATION OPTIONS WITH CURRENT VALUES AS PRE-FILLED DEFAULTS — a full inventory
    of candidate options (take the reference tool's list as the starting menu, add/remove with
    reasons), for EACH: the control type, where its current value comes from, which forms it applies
    to, its honesty/a11y/dark-mode/export guard, and whether it's phase 1 or later.
(c) HOW FAR CHOICE EXTENDS — per-chart only (session-only like ADR 038), a "use this for all my
    charts" saved default (localStorage vs a DB user-preferences row: cost, GDPR, multi-device),
    named presets, a shareable state — pick and justify.
For EVERY piece, state which invariant (R6/R8/R11/#48, R1/R9/R10 for new types) it touches and how
it stays compliant, or flag it as a genuine open risk for the owner's own judgment — never paper over
one to make the plan look cleaner. Write in English, concrete file paths, no code beyond short
illustrative snippets, and be explicit about where YOUR angle is weakest.
`

phase('Design')
const ANGLES = [
  {
    key: 'presets-only',
    prompt: `${SHARED_CONTEXT}\n\nYour specific angle: NAMED PRESENTATION PRESETS ONLY, no free-form controls at all in the first slice — e.g. three or four curated looks ("Standaard" = today's stock Recharts, "Minimaal" = no grid/no dots/thin line, "Presentatie" = thick lines/large labels for a slide or a newsroom screen, maybe "Print"), chosen from a segmented control that is pre-selected to whichever preset matches the chart's current look. Argue this is the cheapest-mechanism-first answer to the owner's ask, define each preset's exact values, say where it clearly strains (the owner literally asked to adjust line thickness — does a preset satisfy that, or does it need one escape hatch?), and design how presets grow into per-option controls later without a rewrite.`,
  },
  {
    key: 'per-chart-panel',
    prompt: `${SHARED_CONTEXT}\n\nYour specific angle: a FULL PER-CHART CONFIGURATION PANEL — a popover/drawer/inline panel on each ChartView with one control per presentation option (line thickness, curve type, dots, grid, legend, axes, label angle, colour choice, bar width/rounding, ...), implemented as a new "presentation" slice on the existing ChartViewState reducer (web/lib/chart-view-state.ts), session-only exactly like ADR 038, pre-filled from the chart's CURRENT effective values. Argue this angle: design the state shape, the pre-fill/derivation rules (including what "current" means after a form switch or a spec swap on the same mounted ChartView), the per-option honesty guards (R6/R11/#48), the dark-mode and export behaviour, the panel's placement on desktop AND a 375px phone, and its a11y contract. Be honest about the cost: how many options is too many, what the test surface looks like, and where a control could quietly break an honesty property.`,
  },
  {
    key: 'saved-defaults-and-types',
    prompt: `${SHARED_CONTEXT}\n\nYour specific angle: focus on "HOW FAR DOES CHOICE EXTEND" and on CHART-TYPE EXPANSION. (1) Persistence: per-chart session-only vs "use this for all my charts" saved defaults — compare localStorage (the codebase's existing cheapest precedent: theme-toggle, systeemoverzicht map state) against a DB user-preferences row (migration, GDPR retention per ADR 037's precedent, multi-device), and against a shareable URL state; decide what phase 1 does and what evidence would justify escalation. (2) Chart types: for each candidate type (area, stacked bar, pie/donut, horizontal bar, scatter; small multiples already exist) give an explicit allow/refuse rule per spec shape (single-series time series, multi-series time series, multi-region single-period comparison) grounded in R1/R9/R10 and #48, and say how a refused type is presented. Argue this angle: is "more chart types" or "remembered preferences" the more valuable next slice, and why?`,
  },
  {
    key: 'spec-seam',
    prompt: `${SHARED_CONTEXT}\n\nYour specific angle: put presentation options INTO THE CHART SPEC VOCABULARY — the seam ADR 007 explicitly reserved for the Visualisatie Studio — either as a schemaVersion-2 "presentation" field or a validated sidecar object, so the client ChartView, the server-side SVG renderer (src/chart/render.ts), exports, and any future OG-image/embed render from ONE description and can never disagree. Argue this angle honestly: what it buys (one source of truth, a future shareable/embeddable chart, presets as data), what it costs (R8 stores every emitted spec forever — does presentation belong in the audited record at all?; schema versioning and reconstruct.ts; every renderer must learn the new fields; the ADR 038 view-state is client-only by design), and whether a HYBRID (a spec-shaped, validated presentation object that lives client-side for now but is designed to slot into the spec later) captures the benefit without the cost. Be explicit about where this angle loses to a pure client-side design.`,
  },
]

const proposals = await parallel(ANGLES.map((a) => () =>
  agent(a.prompt, { label: `design:${a.key}`, phase: 'Design', model: 'fable' })
    .then((text) => ({ key: a.key, proposal: text }))
))

const validProposals = proposals.filter(Boolean)
log(`${validProposals.length}/4 design proposals returned`)

phase('Synthesize')
const synthesisPrompt = `${SHARED_CONTEXT}

Four independent architecture proposals were produced for this same problem, each arguing a
different angle. Read all four in full below, then re-read the actual code they cite where they
disagree (do not trust a proposal's claim about chart.tsx or Recharts over the file itself), and
synthesize the STRONGEST real plan — not a forced compromise, not "a bit of everything". Pick the
best-justified core mechanism, graft in genuinely good ideas from the others where they strengthen
it without contradicting it, and produce ONE Markdown document with EXACTLY these sections, in
this order, with these headings:

## 0. Decisions the owner must make
A lettered list (A, B, C, ...). Each: one bold sentence stating the decision, then 2-3 sentences of
context and your recommended default. Include at minimum: the UI-copy language for the new controls
(Dutch like the sibling Lijn/Staaf/Tabel controls vs English per the session-84 convention); whether
a user override may change colours at all given the session-87 stock-palette decision; persistence
scope; which additional chart types (if any) are offered.

## 1. In plain language
Two or three short paragraphs for a non-developer product owner: what gets built, in what order,
what it costs (AI / database / money), and what he must decide first. Then a numbered stage list
(one line each).

## 2. The architecture decision
The core mechanism, why it beat the alternatives, and the exact modules/files it touches (create /
modify), including how it relates to the existing ChartViewState reducer (extend / beside /
replace) and to UserChartView.

## 3. The control inventory
A Markdown table, one row per candidate option (start from the reference tool's 14 controls, add or
drop with reasons): Option | Control type | Pre-fill source (where the CURRENT value comes from) |
Applies to forms | Honesty / a11y / dark-mode / export guard | Phase (1, 2, later, or REFUSED with
reason).

## 4. Chart-type rules
A table: Chart type | single-series time series | multi-series time series | multi-region comparison
| Reason (R1/R9/R10/#48) | How a refused type is presented.

## 5. Build order
A table: Phase | What ships | AI / database / cost | Needs the owner first? — each phase a real,
shippable increment. Phase 1 must be zero-AI, zero-DDL, zero-cost. Give a rough size (days) per
phase.

## 6. How each piece stays honest
A table: Piece | Numbers stay traceable (R1/R6) | Marking/wording stays accurate (R9/R11/#48) |
Open risk (letter from section 0, or —).

## 7. Considered and set aside
A bulleted list of everything from the four proposals you are DELIBERATELY rejecting, each with a
one-sentence reason.

## 8. Answers to the owner's three questions
Three short paragraphs: (a) chart-type selection, (b) options pre-filled with current values,
(c) how far choice extends — each a direct answer, referencing the sections above.

## 9. What stays in the Visualisatie Studio non-goal
A short bulleted list of what this slice deliberately does NOT pull forward.

Write in English. Be concrete: file paths, state shapes (short TypeScript-ish snippets are fine),
control counts, default values. Where the four proposals contradict each other on a FACT about the
code or the library, say which one is right and how you checked.

--- PROPOSAL: presets-only ---
${validProposals.find((p) => p.key === 'presets-only')?.proposal ?? '(agent failed, not available)'}

--- PROPOSAL: per-chart-panel ---
${validProposals.find((p) => p.key === 'per-chart-panel')?.proposal ?? '(agent failed, not available)'}

--- PROPOSAL: saved-defaults-and-types ---
${validProposals.find((p) => p.key === 'saved-defaults-and-types')?.proposal ?? '(agent failed, not available)'}

--- PROPOSAL: spec-seam ---
${validProposals.find((p) => p.key === 'spec-seam')?.proposal ?? '(agent failed, not available)'}
`

const synthesis = await agent(synthesisPrompt, { label: 'synthesize', phase: 'Synthesize', model: 'fable' })

return { proposals: validProposals, synthesis }```
