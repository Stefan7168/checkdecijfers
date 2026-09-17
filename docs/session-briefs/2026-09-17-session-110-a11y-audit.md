# Session 110 — axe-core accessibility audit of the public production pages (2026-09-17)

**How this was audited.** axe-core **4.10.2** (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`,
`best-practice` tags) injected via `browser_evaluate`/`browser_run_code_unsafe` from the
`cdnjs.cloudflare.com` CDN (reachable, no fallback needed) against
`https://checkdecijfers.vercel.app`, driven by Playwright MCP. Viewports 1280×800 and 375×812;
light and dark via `page.emulateMedia({ colorScheme })`; NL/EN via the header language toggle.
No trial question was asked (zero LLM spend) — only navigation, the theme/language controls, and
scrolling. No tracked file was changed; this file is the only write.

**Pages requested vs. actually public:** `/`, `/galerij`, `/login`, `/werkwijze`, `/privacy` are
public. **`/about` and `/credits` redirect anonymous visitors to `/login`** (checked at 1280×800) —
they are not public pages today, so no axe run applies to them; both were already audited via the
local harness in the session-110 UX briefs.

**Timing caveat (methodology note, not a defect):** the landing and `/galerij` pages render some
content (the gallery's chart cards, `/galerij`'s Insights panel) after the initial paint. An axe
run fired immediately on `load` undercounts — e.g. a naive first pass on `/galerij` reported 0
violations. Every count below is from a run taken **after** a `waitForTimeout` and (for `/galerij`)
scrolling the full page, and was reproduced at least twice.

**Counts across all pages/viewports/themes/languages tested: 0 critical · 2 serious rule types
(color-contrast, scrollable-region-focusable) · 2 moderate rule types (landmark-one-main + region,
heading-order) · 0 minor.** Instance totals: color-contrast 17 nodes (light theme only, 0 in dark),
scrollable-region-focusable 1 node, landmark-one-main 3 nodes (1 per affected page),
region 4 nodes, heading-order 1 node.

---

## `/` (landing)

| Impact | Rule | Count | Example selector | Occurs | Proposed fix |
|---|---|---|---|---|---|
| serious | color-contrast | 3 | `article:nth-child(1) .rounded-full.px-2[target="_blank"]` (CBS source-badge pill) | light only (EN+NL, 1280 and 375) | See token fix #1 below |

No other violations, either theme, either viewport, either language. Heading order (h1→h2→h3),
main landmark, and dark-mode contrast are all clean. Tab order (15 tabs) is sensible and every
stop shows a visible focus ring (`outline: solid 2px` or a box-shadow on custom buttons) — matches
what pass 1/2 already reported for the logged-in app.

## `/galerij`

| Impact | Rule | Count | Example selector | Occurs | Proposed fix |
|---|---|---|---|---|---|
| serious | color-contrast | 12 (one per story card's source pill) | same pill as above | light only | Token fix #1 |
| serious | scrollable-region-focusable | 1 | `.max-h-40.space-y-2.overflow-y-auto` (Insights findings list) | light + dark | Fix #3 below |
| moderate | heading-order | 1 | `.rounded-xl.p-5:nth-child(1) > h3` ("Hoe optimistisch zijn Nederlanders?") | light + dark | Fix #4 below |

`<h1>De galerij</h1>` is followed immediately by twelve `<h3>` story titles — no `<h2>` between
them (axe only flags the first jump per its rule, but all twelve are structurally the same).
Only the first card's Insights panel is open by default (by design, per the code's own comment),
which is why only one scrollable-region-focusable instance appears. Same page in EN ("The
gallery") behaves identically. No horizontal scroll at 375 px, no other violations found.

## `/login`

| Impact | Rule | Count | Example selector | Occurs | Proposed fix |
|---|---|---|---|---|---|
| moderate | landmark-one-main | 1 | `html` | light + dark, 1280 + 375, NL + EN | Fix #2 below |
| moderate | region | 2 | `.gap-1` (heading+body block), `input` (email field) | same | Fix #2 |

`<h1>` text is exactly "Log in" / "Inloggen" (the earlier "Log in — Check de Cijfers" duplicate-title
issue from pass 1's row 14 is **not present** — already fixed). Tab order (6 stops: logo → NL → EN →
email → "Send login link" → "Continue with Google") is sensible with visible focus throughout.

## `/werkwijze`

| Impact | Rule | Count | Example selector | Occurs | Proposed fix |
|---|---|---|---|---|---|
| serious | color-contrast | 1 | `.bg-muted` ("Draft — under review.") | light only | Token fix #1 |
| moderate | landmark-one-main | 1 | `html` | light + dark, 1280 + 375 | Fix #2 |
| moderate | region | 1 | `.mx-auto` (page content wrapper) | same | Fix #2 |

## `/privacy`

Identical violation set and locations to `/werkwijze` (shares the same page shell) — same three
rules, same counts, same light/dark split.

## `/about`, `/credits`

Both **redirect anonymous visitors to `/login`** — not public today. No axe run applies.

---

## Fix now (mechanical — no design decision needed)

| # | Sev | Where | What axe found | Fix |
|---|-----|-------|-----------------|-----|
| 1 | **Serious** | `web/app/globals.css:34-35` (light theme: `--muted: oklch(0.97 0 0)` / `--muted-foreground: oklch(0.556 0 0)`, i.e. `#f5f5f5` on `#737373`) | Contrast ratio **4.34:1**, below the required **4.5:1** for normal text. This single token pair is the root cause of every color-contrast hit above: the CBS source-badge pill (`web/components/source-badge.tsx:52`, used on `/` ×3 and `/galerij` ×12) and the "Draft — under review" note (`werkwijze`/`privacy` inline `bg-muted`/`text-muted-foreground` classes). The same pairing is also used at `web/components/chat.tsx:1101` (a logged-in surface, not directly tested here, but the same bug). Dark theme's pairing (`oklch(0.269 0 0)`/`oklch(0.708 0 0)`) already passes — 0 contrast violations in dark, on every page. | Darken light-theme `--muted-foreground` (e.g. to `oklch(0.50 0 0)` or lower) until 12 px text on `--muted` clears 4.5:1. One CSS change fixes all of the above at once. |
| 2 | Moderate | `web/app/login/page.tsx`, `web/app/werkwijze/page.tsx`, `web/app/privacy/page.tsx` | All three wrap their page content in a plain `<div>` — no `<main>` landmark anywhere on the page (`SiteHeader` renders a `<header>` only). Axe: `landmark-one-main` + `region` on all three, every viewport/theme/language tried. | Change the outer content wrapper (`<div className="mx-auto flex w-full max-w-md ...">` on `/login`, `<div className="mx-auto flex w-full max-w-2xl ...">` on `/werkwijze`/`/privacy`) to `<main>`. |
| 3 | Serious | `web/components/chart-story.tsx:236` (`<div ref={scrollRef} className="mt-2 max-h-40 space-y-2 overflow-y-auto pr-1">`) | The Insights findings list is scrollable but has no `tabIndex`, so a keyboard user cannot reach or scroll it — even though sibling copy in the same panel says "Scroll of gebruik de pijltjes" (scroll or use the arrow keys). Reproduced on `/galerij`'s first (auto-opened) story card, light and dark. | Add `tabIndex={0}` and a `role="region"` + `aria-label` (e.g. "Chart insights") to the scrollable div. |
| 4 | Moderate | `web/components/gallery.tsx:57` (`<h3 className="text-lg text-foreground">{t(lang, titleKey)}</h3>`) rendered by `web/app/galerij/page.tsx` directly under its own `<h1>` | `GalleryCard`'s `<h3>` is shared between the landing teaser (correctly nested under landing's own `<h2>Stories from the gallery</h2>`) and the standalone `/galerij` page (nested directly under `<h1>De galerij</h1>`, skipping `<h2>`). Axe flags the level jump on the first card; all twelve share the same structural defect. | Add a `headingLevel` prop (`'h2' | 'h3'`) to `GalleryCard`/`GalleryGrid`, defaulting to `'h3'` for the landing teaser and passed as `'h2'` from `app/galerij/page.tsx` — or add a visually-hidden `<h2>Stories</h2>` above the grid on that page only. Don't just globally change `h3`→`h2`; that would break the landing page's own heading order. |

## Needs a design decision

None found beyond what pass 1/pass 2 already flagged (the "Draft — under review" banner sign-off,
etc.) — this pass only adds evidence (finding #1 above) to the existing contrast concern; no new
product-voice or scope calls are needed for what axe surfaced on these five public pages.

## What works well (do not "fix" these)

Dark mode is **contrast-clean on every public page tested** — 0 color-contrast violations in dark,
matching pass 2's dark-mode findings for the logged-in app. `/` and `/galerij` both have a correct
`<main>` landmark. `/login`'s heading no longer duplicates the page title (pass 1 row 14 — verified
fixed). Tab order on `/` (15 stops) and `/login` (6 stops) is logical and every stop shows a visible
focus indicator. No horizontal scroll at 375 px on any of the five pages, in either theme or
language. NL/EN switching correctly updates both the rendered strings and the `<html lang>`
attribute on full navigations (`/login` → `lang="nl"`/`h1` "Inloggen" after clicking NL); it does
**not** retranslate the current page in place without a navigation — noted here as a methodology
detail, not scored as a defect since every audited page is a full Server Component render.
