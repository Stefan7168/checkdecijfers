# Huisstijl — shadcn/ui neutral (current) · "papier & inkt" retired

**Owner decision (session 87, 2026-09-07):** the editorial **"papier & inkt" house style (session 51,
2026-07-17) is retired.** The product now uses **plain shadcn/ui, neutral base colour, no custom brand
theme**, in **light and dark** (via `next-themes`). This is a deliberate identity change, not incidental
cleanup — the owner asked for a better-looking chat/chart experience, reviewed three shadcn-based
mockups and chose **Option B, "Inset Cards"** (mockup source kept at
[superpowers/specs/assets/2026-09-07-redesign-mockups.html](superpowers/specs/assets/2026-09-07-redesign-mockups.html);
decisions in [superpowers/specs/2026-09-07-chat-chart-visual-redesign-design.md](superpowers/specs/2026-09-07-chat-chart-visual-redesign-design.md)).

Tokens live in [web/app/globals.css](../web/app/globals.css) — shadcn's own CSS-variable set (`:root` light,
`.dark` dark), exposed as Tailwind utilities via `@theme inline`. Components use those utilities, never
hex values or raw palette classes for surfaces and text. Generated primitives live in
`web/components/ui/*` (shadcn CLI v4, style `base-nova` on Base UI, `web/components.json`).

## What replaced what

| Retired (papier & inkt) | Now (shadcn neutral) |
|---|---|
| Warm paper ground `bg-paper` | `bg-background`; the workspace's grey ground is `bg-sidebar` |
| Cards `bg-paper-raised border-line` | `bg-card text-card-foreground border-border rounded-xl` |
| Wells / inputs `bg-paper-sunken` | `bg-muted` (hover washes: `bg-accent`, selected chips: `bg-secondary`) |
| `text-ink` / `text-ink-soft` / `text-ink-muted` (3 levels) | `text-foreground` / `text-muted-foreground` (2 levels — shadcn's own hierarchy) |
| Hairlines `border-line`, `border-line-strong` | `border-border` (inputs: `border-input`) |
| The one ink-blue accent `bg-accent`, `text-accent` | Neutral primary: `bg-primary text-primary-foreground`, `text-primary`; focus `outline-ring` |
| `--series-1..4` colour-blind-safe chart palette + dash patterns | Recharts' stock example palette (session 87) → since session 95 the designed `DEFAULT_PALETTE`, colour-blind-safe again, no dash patterns (see Charts below, ADR 042) |
| Serif display headings (Newsreader), `.font-display` | Sans everywhere — **Inter** for interface text (the chosen mockup's face), Geist Mono for code |
| Semantic `text-ok` / `text-warn` / `bg-warn-soft` / `text-danger` | `text-success` / `text-warning` / `bg-warning-soft` / `text-destructive` |

The three `--warning`, `--warning-soft`, `--success` tokens are the one product-specific extension to the
shadcn set (shadcn ships only `destructive`): this product needs an honest amber for "voorlopig", stale-data
and caveat lines and a green for "payment landed". Both light and dark values are defined in `globals.css`.

## Layout (chat screen, mockup Option B)

- The whole logged-in screen sits on the grey ground (`bg-sidebar`); the slim site header is transparent on it.
- **Sidebar** (borderless, on the ground): a full-width **"Nieuwe chat"** button (with a plus icon, session 90)
  stacked above a same-size **"Search chats"** field (owner amendment 2 — a client-side title filter, no
  request), then dense thread rows under small uppercase day-group labels. **Session 90 (owner request):**
  every row has a ⋯ "Chat options" button (revealed on hover/focus, always on touch) opening a one-item
  shadcn `DropdownMenu` — "Delete chat" — which asks for an inline confirmation (the session-23 delete UX)
  before the server redacts that chat's own rows (`deleteMyThread`; redact-not-delete, ledger untouched, the
  thread disappears because its title source is gone — no schema change).
- **Chat** and the **visual dock** are two separate white cards (`rounded-xl border bg-card`), each with a
  48px header bar: the chat card names the thread (or "Nieuwe chat") and carries the three-way
  light/dark/system theme toggle; the dock card says "Charts" + count and uses **underline tabs**.
- **Messages:** user messages are outlined cards aligned right (`border bg-background rounded-lg`);
  assistant answers are plain text aligned left. A clarification keeps a quiet amber wash (`bg-warning-soft`) so
  it reads as a question back, not an answer (#84). Refusals keep their fixed header line.
- **Composer (layout revised session 90, 2026-09-09, owner request at the session-89 close-out):** the chip
  row sits directly **above** the input — source toggles ("CBS data", "Internet" — only when web search is
  enabled), "Add link", "Upload file", "Link with sheet" (session 90, disabled/coming-soon like its
  neighbour), "Connect database" — then the input + "Verstuur" button, then the
  pre-send cost line directly **below** the input. (Session 87's owner amendment 1 had the chip row *below*
  the input, and session 88 (#211) briefly moved the cost line into the site footer; both superseded.)
  Squared chips: selected = filled `bg-secondary` + checkmark, unselected = outlined, "coming soon" = dashed
  + dimmed.
- **Empty state:** a bare composer — no explanatory copy, no example-question chips (the #75 chips were removed
  from the chat screen; the logged-out landing page keeps its own copy).
- Structure is unchanged from ADR 033: sidebar / chat column / right-hand dock at ≥ lg with ≥ 1 visual.

## Charts (Recharts, the designed default — ADR 042)

**Since session 95 (2026-09-11), ADR [042](decisions/042-designed-default-chart.md) — pending the owner's PR
review:** the default look is a designed one, not Recharts' examples. Series colours are `DEFAULT_PALETTE`
(`#0072b2`, `#d55e00`, `#009e73`, `#cc79a7`, then four more in the same luminance band; Okabe–Ito-anchored,
colour-blind-safe for the first four, every colour ≥ 3:1 on both the light and the dark card — test-pinned);
a horizontal-only grid at the two labelled values with a hairline baseline in the grid colour; no axis lines;
markers on the first and last plotted point plus every provisional point ("Eerste en laatste"); a gradient
area fill; 12 px value labels with a card-coloured halo; a height that follows the card's width (256–360 px,
measured, never CSS `aspect-ratio`); a 300 ms fade/rise of the chart container on mount (`motion-reduce`
honoured; Recharts' own animation stays off); a `text-base font-semibold` title over one muted unit + dims
line; chip-style legend entries; a faint solid crosshair (never dashed — the dashed vocabulary belongs to
event markers and the story ring). The session-87 "basic Recharts" look survives as `CLASSIC_PRESENTATION` /
`RECHARTS_PALETTE` for the Classic template. **Templates v1 (session 95, ADR
[043](decisions/043-chart-templates.md), same PR chain):** the Style panel's first tab is "Sjablonen/Templates"
— a radiogroup of six cards with derived, digit-free SVG thumbnails: Basis/Standard (the designed default,
applied explicitly), Klassiek/Classic (the session-87 look incl. its palette), Redactie/Newsroom (3 px line,
no markers but the honesty ring, 16:9), Presentatie/Presentation (dark slate gradient + inset card),
Sociaal/Social (ocean gradient + inset card, 4:5), Minimaal/Minimal (no grid, no axes); plus a Brand card for
signed-in visitors that points to the Colours tab. A template is a bundle of the panel's own options — never
a spec change — and the panel still opens on Grafiek. Everything below this paragraph is the history of the
session-87 decision.

**Superseded (session 87 → session 95):** Owner decision (session 87): **use Recharts' basic/default styling.** Grid, axes and tick text use Recharts'
own defaults; series colours are the palette from Recharts' documentation examples
(`RECHARTS_PALETTE` in [web/components/chart.tsx](../web/components/chart.tsx): `#8884d8`, `#82ca9d`,
`#ffc658`, `#ff7300`, …, cycling). The #197 colour-blind-safe palette and dash patterns are **not** kept —
an accepted trade-off of this decision, not something to silently work around with a new custom palette.
What is NOT styling and therefore unchanged: every displayed number is still a point's own
`formattedValue` (custom honesty-bound axis ticks, tooltip, end/bar labels), the hollow marker / hatched bar
for provisional values (R11), the Grafiek/Tabel switch, the interactive legend, the attribution line +
source badge, and the PNG/SVG export. A CBS `ChartView` renders **frameless inside the dock card** (a card in a
card is the one thing this direction avoids); a user-data `UserChartView` keeps its **dashed frame everywhere**
— that frame is the user-data-vs-CBS distinction (ADR 037 H2), not decoration.

**Built, session 91 (2026-09-09), branch `wp218-chart-styling`, merged as `05ec8ed` and live — WP218, ADR
[039](decisions/039-chart-presentation-panel.md):** the stock look above is now the test-pinned
`STOCK_PRESENTATION` constant in [web/lib/chart-presentation.ts](../web/lib/chart-presentation.ts) (the
`RECHARTS_PALETTE` moved there too, re-exported from `chart.tsx` so nothing else changes). A reader can
restyle a chart through the "Opmaak" panel — thickness, markers, grid, axis lines, label angle, value
labels, baseline, colours and fonts — with a colour guard (`judgeColor`) that refuses any pick which would
make the hollow provisional marker illegible. The Weergave switch now offers five forms: **Lijn · Vlak ·
Staaf · Liggend · Tabel** (line, area, bar, horizontal bar, table).

## Answer card and chart panel layout (session 91, owner-chosen from design canvases)

- **Answers** in the chat render as a shadcn `Card` (`web/components/chat.tsx`): the answer text and its honesty lines in the body; a footer (`border-t`, `bg-muted/40`) with the full source sentence + source badge on the left and the actions on the right — like/dislike FIRST (outline buttons on `bg-background` with `shadow-sm`, lucide thumbs + visible labels), then proof, then (when docked) the "Chart/Card in panel" reference trigger (outline/secondary toggle via `aria-pressed`, mirroring the thumbs' toggle pattern), then citation / CSV as `ghost` buttons with icons, then the cost. Refusals and clarifications keep their plain rendering. **Superseded 2026-09-10 (owner UI feedback, session 94):** the docked reference trigger used to be a `float-right` pill at the top of the card body — it moved into this footer row.
- **The chart's Opmaak panel** is an inline region (`role="region"`) rendered in its own card directly below the chart — identically at every viewport width — with (since session 95, ADR 043) a first tab Sjablonen/Templates ahead of Grafiek/Kleuren/Lettertype, and a fourth tab Kader/Frame — background (None / Colour / Gradient / Own image), padding (None / Small / Medium / Large), corners (Square / Rounded / Very rounded), shadow (None / Soft / Strong), inset (None / Small / Large), aspect ratio (Auto / 16:9 / 4:5 / 1:1 / 1.91:1). The chart-language select sits in the panel header, the "why no pie chart" note + `Standaard` in a footer on the Grafiek tab only. **Superseded 2026-09-10 (owner UI feedback, session 94):** the panel used to float beside the chart as a portaled non-modal dialog (bottom sheet on phones below `lg`) — see ADR 039's dated addendum for the as-built detail.
- **Story mode (session 92):** the "Verhaal / Story mode" trigger is the product's ONE gradient — a 2 px ring (`linear-gradient(135deg, #7c3aed, #ec4899, #f59e0b)`) around a ghost button with the lucide `WandSparkles` icon, a row-mate of the Weergave tabs after Opmaak. The story panel opens in the Opmaak slot under the chart (one open at a time) as bordered step cards in a short scroll area with Previous / Next and a dotted step list. No other control gets a gradient. **Story stage (session 95, ADR [044](decisions/044-story-stage.md), branch `visual-story-stage` — see STATUS for the build state):** a "Presenteren / Present" button on that panel opens the same story as a full-viewport `role="dialog"` overlay — the chart pinned (a second, chrome-less `ChartView`), one full-height caption panel per finding scrolling past it, a CSS-3D tilt on entry that settles flat, a spotlight vignette on the step's point, position dots (never "N of M"), an auto-play toggle off by default, Escape/Close returning focus; reduced motion = no tilt/parallax. CSS 3D + a scroll hook, no library.

## House rules (current)

1. **Tokens, not colours.** Surfaces/text/borders come from the shadcn utilities above; no hex, no raw
   `zinc-*`/`blue-*` classes. Chart series colours (`DEFAULT_PALETTE`, and `RECHARTS_PALETTE` for the Classic look — ADR 042) and the stat-card SVG export (white
   card, fixed greys — the exported PNG must look the same everywhere) are the sanctioned literal-hex spots.
2. **Every number is tabular.** `.tnum` / `data-numeric` / tables get `font-variant-numeric: tabular-nums`
   globally (#91, owner-approved). This is a product convention, not part of the retired identity.
3. **Both themes, always.** Any new surface must read in light and dark — use the paired tokens, never a
   light-only literal. Toggle: the segment in the chat card header (`components/theme-toggle.tsx`).
4. **Primitives first.** Buttons, inputs, badges, cards, separators come from `components/ui/*`; hand-rolled
   tab lists (`role="tablist"`, keyboard handling) stay where tests pin their ARIA contract.
5. **Attribution/definition lines under answers stay quiet:** `text-xs text-muted-foreground` with a
   `border-t border-border` — present, honest, never shouting (R4 inline attribution is sacred; styling may
   not hide it). Caveats read like caveats: `text-sm text-warning`, above the smaller source credit (#92).
6. **Copy lives in the message catalogue with a Dutch and an English entry (superseded 2026-09-09, session
   91, ADR [040](decisions/040-interface-language-switch.md); was "Copy is English for new UI surfaces,
   owner override, 2026-09-06, session 84").** `web/lib/i18n/messages.ts` holds both languages for every
   interface string, switched by the header's NL/EN control; new interface work adds both languages, never
   just English. The CBS chat/answer pipeline's own Dutch output and backend-built text (answer prose,
   refusals, chart notes and definitions) stay Dutch regardless of the interface language — restyling or
   translating the interface never rewrites that output. The two removals in the session-84 restyle ("Over
   dit project" block, example chips on the chat screen) were explicit owner decisions in that spec and are
   unaffected by this change.

## Voice of the product (unchanged)

The product's public claim: *"elk getal herleidbaar tot een officiële CBS-tabel, met bron en datum erbij"*
(CLAUDE.md; never absolute slogans). Surfaces show that claim structurally: sources visible, statuses
(Voorlopig/Definitief) marked, numbers aligned.

## History

- **Session 51 (2026-07-17):** "papier & inkt" — serif display headings, warm paper, ink text, one ink-blue
  accent, light-first. Retired in session 87.
- **Session 69 (#197):** colour-blind-safe chart series palette + dash patterns. Superseded in session 87 by
  the stock Recharts look (owner decision).
- **Session 87:** the stock Recharts look (owner: "use the basic Recharts style"). Superseded in session 95
  (2026-09-11) by the designed default, ADR [042](decisions/042-designed-default-chart.md) — the owner's
  session-94 words ("a graph is just a basic graph, which needs more styling") revised the decision; the
  stock look stays available as the Classic template's literals.
- **Session 87 (2026-09-07):** shadcn/ui neutral, light + dark, mockup Option B "Inset Cards" — this document.
