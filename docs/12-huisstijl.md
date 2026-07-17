# Huisstijl — "papier & inkt" (editorial direction)

**Owner decision (session 51, 2026-07-17): redactioneel & cijfer-vast.** Serif display headings, tabular
figures for every number, warm paper surfaces, ink text, ONE trustworthy ink-blue accent. Light-first (the
scaffold's auto-dark half-theme was the "black void" login); a real dark counterpart is a tracked follow-up.
Tokens live in [web/app/globals.css](../web/app/globals.css) — components use the Tailwind utilities below,
NEVER raw zinc-*/blue-* palette classes and never hex values.

## Tokens (Tailwind utility names)

| Use | Utility |
|---|---|
| Page background | `bg-paper` |
| Cards, panels, bubbles | `bg-paper-raised` (+ `border border-line`) |
| Wells, input backgrounds, zebra rows | `bg-paper-sunken` |
| Primary text | `text-ink` |
| Secondary text | `text-ink-soft` |
| Captions, metadata, placeholders | `text-ink-muted` |
| Hairlines/borders | `border-line`; emphasized rules `border-line-strong` |
| Actions, links, focus | `text-accent` / `bg-accent` (hover `*-accent-strong`); washes `bg-accent-soft` |
| "Voorlopig"/warnings | `text-warn` on `bg-warn-soft` |
| Success / destructive | `text-ok` / `text-danger` |

## House rules

1. **Headings are serif** — global via `h1/h2/h3`; use `.font-display` for non-heading display text
   (wordmark, big numbers in stat cards may combine `.font-display .tnum`).
2. **Every number is tabular** — wrap numeric spans in `.tnum` (or `data-numeric`); tables get it free.
3. **One accent.** Blue is for actions and links only. Semantic colors are reserved for their meaning —
   never decorative.
4. **Hairlines over shadows.** Cards are `bg-paper-raised border border-line rounded-lg`; shadows at most
   `shadow-sm`. The editorial look is flat paper, not floating glass.
5. **Buttons:** primary `bg-accent text-white hover:bg-accent-strong rounded-md px-4 py-2 font-medium`;
   secondary `border border-line-strong bg-paper-raised text-ink hover:bg-paper-sunken`. Focus:
   `focus-visible:outline-2 outline-offset-2 outline-accent`.
6. **Inputs:** `bg-paper-raised border border-line-strong rounded-md px-3 py-2 text-ink
   placeholder:text-ink-muted` + the focus rule.
7. **Attribution/definition lines under answers stay quiet:** `text-xs text-ink-muted` with a `border-t
   border-line` — present, honest, never shouting (R4 inline attribution is sacred; styling may not hide it).
8. **Copy is Dutch, calm and concrete** (no marketing superlatives); restyling never rewrites copy — text
   changes are their own reviewed change.

## Voice of the product (for future surfaces)

The product's public claim: *"elk getal herleidbaar tot een officiële CBS-tabel, met bron en datum erbij"*
(CLAUDE.md; never absolute slogans). Surfaces show that claim structurally: sources visible, statuses
(Voorlopig/Definitief) marked, numbers aligned.
