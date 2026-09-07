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
| `--series-1..4` colour-blind-safe chart palette + dash patterns | Recharts' stock example palette (see Charts below) |
| Serif display headings (Newsreader), `.font-display` | Sans everywhere — **Inter** for interface text (the chosen mockup's face), Geist Mono for code |
| Semantic `text-ok` / `text-warn` / `bg-warn-soft` / `text-danger` | `text-success` / `text-warning` / `bg-warning-soft` / `text-destructive` |

The three `--warning`, `--warning-soft`, `--success` tokens are the one product-specific extension to the
shadcn set (shadcn ships only `destructive`): this product needs an honest amber for "voorlopig", stale-data
and caveat lines and a green for "payment landed". Both light and dark values are defined in `globals.css`.

## Layout (chat screen, mockup Option B)

- The whole logged-in screen sits on the grey ground (`bg-sidebar`); the slim site header is transparent on it.
- **Sidebar** (borderless, on the ground): a full-width **"Nieuwe chat"** button stacked above a same-size
  **"Search chats"** field (owner amendment 2 — a client-side title filter, no request), then dense thread
  rows under small uppercase day-group labels.
- **Chat** and the **visual dock** are two separate white cards (`rounded-xl border bg-card`), each with a
  48px header bar: the chat card names the thread (or "Nieuwe chat") and carries the three-way
  light/dark/system theme toggle; the dock card says "Charts" + count and uses **underline tabs**.
- **Messages:** user messages are outlined cards aligned right (`border bg-background rounded-lg`);
  assistant answers are plain text aligned left. A clarification keeps a quiet amber wash (`bg-warning-soft`) so
  it reads as a question back, not an answer (#84). Refusals keep their fixed header line.
- **Composer:** the input + "Verstuur" button, with the chip row **below** it (owner amendment 1): source
  toggles ("CBS data", "Internet" — only when web search is enabled), "Link toevoegen", "Bestand uploaden",
  "Databron verbinden". Squared chips: selected = filled `bg-secondary`, unselected = outlined,
  "coming soon" = dashed + dimmed. The cost line stays last.
- **Empty state:** a bare composer — no explanatory copy, no example-question chips (the #75 chips were removed
  from the chat screen; the logged-out landing page keeps its own copy).
- Structure is unchanged from ADR 033: sidebar / chat column / right-hand dock at ≥ lg with ≥ 1 visual.

## Charts (Recharts, stock look)

Owner decision (session 87): **use Recharts' basic/default styling.** Grid, axes and tick text use Recharts'
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

## House rules (current)

1. **Tokens, not colours.** Surfaces/text/borders come from the shadcn utilities above; no hex, no raw
   `zinc-*`/`blue-*` classes. Chart series colours (`RECHARTS_PALETTE`) and the stat-card SVG export (white
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
6. **Copy is English for new UI surfaces (owner override, 2026-09-06, session 84)**, calm and concrete; the
   CBS chat/answer pipeline's own Dutch output and existing shipped Dutch strings are unchanged unless a change
   is explicitly asked for — restyling never rewrites copy. The two removals in this restyle ("Over dit
   project" block, example chips on the chat screen) were explicit owner decisions in the spec.

## Voice of the product (unchanged)

The product's public claim: *"elk getal herleidbaar tot een officiële CBS-tabel, met bron en datum erbij"*
(CLAUDE.md; never absolute slogans). Surfaces show that claim structurally: sources visible, statuses
(Voorlopig/Definitief) marked, numbers aligned.

## History

- **Session 51 (2026-07-17):** "papier & inkt" — serif display headings, warm paper, ink text, one ink-blue
  accent, light-first. Retired in session 87.
- **Session 69 (#197):** colour-blind-safe chart series palette + dash patterns. Superseded in session 87 by
  the stock Recharts look (owner decision).
- **Session 87 (2026-09-07):** shadcn/ui neutral, light + dark, mockup Option B "Inset Cards" — this document.
