# Frontend component-library research — sanity check + recommendation

**2026-09-06, session 83, owner-requested** ("Full sanity check... do comprehensive research on which
design components would fit well on this project"), following a quick exploratory answer in-chat that
turned out to undersell the real situation. Recorded as [open-questions #204](../open-questions.md) —
**a candidate, NOT scheduled**; this doc is the research behind that row, not an implementation plan.

Method: an Explore agent mapped the current `web/` codebase (routes, components, styling, forms, package.json)
factually — file paths and quoted excerpts, no recommendations from it. Cross-checked against
`docs/decisions/008-ui-foundation.md`, `docs/decisions/033-chat-workspace-redesign.md`,
`docs/decisions/035-homepage-discovery-charts.md`, `docs/decisions/007-chart-spec-rendering.md`,
`docs/12-huisstijl.md`, `docs/06-roadmap.md`, and a live browser check of the production homepage
(`checkdecijfers.vercel.app`) including the anonymous trial flow. Everything below is sourced, not assumed.

## The sanity-check correction

My in-chat answer said "the web app currently has no component library at all... shadcn slots in cleanly."
That's the code-level truth, but it skips the real story: **shadcn/ui (on Radix) was already decided as the
UI foundation two months ago** — [ADR 008](../decisions/008-ui-foundation.md), accepted 2026-07-02, named
"Next.js App Router, TypeScript, Tailwind CSS, **shadcn/ui (on Radix)**, Recharts, TanStack Table,
react-hook-form + zod, Lucide icons, next-themes, sonner toasts, Vercel AI SDK chat primitives" as the
default stack, explicitly to avoid re-litigating it later.

**It was never built — verified directly, not inferred from a doc's wording.** `web/package.json` and
`web/package-lock.json` contain no `@radix-ui/*` or `radix-ui`, no `components.json` exists anywhere in the
repo, there is no `components/ui/` directory, and none of ADR 008's other named pieces (`next-themes`,
`lucide-react`, `react-hook-form`, `sonner`, `@tanstack/react-table`, the Vercel AI SDK's `ai` package) are
installed either — only Recharts and zod (server-side only, not for forms) made it in.

**Correction to an earlier draft of this doc:** I initially cited [ADR 018](../decisions/018-chat-ui-and-deploy.md)'s
"As-built addendum (session 51)" as the record of shadcn/Radix being superseded — re-reading it directly
shows that addendum is about something adjacent but different: it says the session-51 papier-en-inkt huisstijl
superseded *ADR 018's own* "minimal, ugly is acceptable" WP12-era visual framing, not ADR 008's shadcn/Radix
stack choice specifically. **No ADR anywhere explicitly records a decision to drop the shadcn/Radix half of
ADR 008** — it simply was never picked up while the team built the huisstijl by hand. The practical
conclusion is the same (shadcn/ui is absent from the codebase today, confirmed directly above), but I want to
be precise about what is *measured* (the absence) versus what would have been an overclaim (a specific
documented reason for it).

**So this isn't "should we adopt a component library" — it's "a 2-month-old accepted decision was never
executed; is it worth finishing now, and does the ORIGINAL plan still fit the visual direction that superseded
it?"** The second half of that question is the one that actually needed research, because the answer isn't
obviously yes.

## Current state (verified, not assumed)

### The house style is real, deliberate, and well-specified — just not componentized

`web/app/globals.css` defines a genuine design-token system (CSS custom properties), owner-decided session 51
("papier & inkt" — paper and ink, an explicitly editorial direction, not a SaaS-dashboard one):

```css
--paper: #faf8f5;        /* page background — warm off-white */
--paper-raised: #ffffff; /* cards, panels, chat bubbles */
--paper-sunken: #f3efe9; /* wells, zebra rows, input backgrounds */
--ink: #1c1917;          /* primary text */
--ink-soft: #44403c;
--ink-muted: #78716c;
--line: #e5e0d8;          /* hairlines, borders */
--line-strong: #d6cfc4;
--accent: #1e40af;        /* the ONE accent — trustworthy ink-blue */
--accent-strong: #1e3a8a;
--accent-soft: #eef2fc;
--series-1..4: <Okabe-Ito/Tol colorblind-safe chart palette>
```

Typography: **Newsreader** (serif, `next/font/google`) forced on every heading site-wide, **Geist**
sans for body text, **Geist Mono** for numbers/code — tabular figures (`font-variant-numeric:
tabular-nums`) enforced on every numeric context. Light-only, deliberately: the CSS's own header comment
says the original scaffold's auto-dark media query produced a broken "half-dark black void" login and was
removed; dark mode is named as a **tracked future follow-up, not present functionality**.

`docs/12-huisstijl.md` writes this down as **house rules** meant to be followed by convention — e.g. rule 5
(primary button = `bg-accent text-white hover:bg-accent-strong rounded-md px-4 py-2 font-medium`), rule 6
(input = `bg-paper-raised border border-line-strong rounded-md px-3 py-2 text-ink placeholder:text-ink-muted`),
and an explicit ban: **"NEVER raw zinc-\*/blue-\* palette classes and never hex values."**

### The "documentation convention, not componentized" gap is already measurably leaking

The Explore agent found the exact `bg-accent` button fragment independently repeated across **8 files**
and the input-field fragment across **7 files** — copy-pasted, not shared. And the house rule's own "never
hex values" ban is already broken once, for a real reason: `web/components/stat-card.tsx` draws its card as
a hand-built SVG (for PNG export) and hardcodes a second, independent hex palette (`#52525b`, `#18181b`,
`#fef3c7`, ...) because SVG-to-canvas export can't resolve `var(--token)` CSS custom properties at
render/export time. `chart-download.tsx` solves the identical problem correctly (`inlineComputedPaint`
inlines the *computed* token value into the exported SVG at export time); `stat-card.tsx` just hardcoded a
parallel palette instead. **This is exactly the kind of drift a documentation-only design system produces
over many AI sessions, and exactly what a componentized one (or at minimum, a shared "resolve this token to
its computed value for export" helper) would have caught by construction.**

### There's a lot of already-built, already-tested surface — this is a retrofit, not a green field

`web/components/` has 24 feature-specific `.tsx` files, none of them generic primitives — `chat.tsx` (~1000
lines: the core chat, source chips, per-message chart/stat-card/proof/citation/feedback), `workspace.tsx` +
`thread-sidebar.tsx` + `visual-dock.tsx` (the WP135 chat-workspace shell — [ADR 033](../decisions/033-chat-workspace-redesign.md):
persisted threads, a day-grouped conversation sidebar, a right-pane tab dock for charts/stat-cards),
`site-header.tsx` (top nav + an account **dropdown menu** with logout + delete-history),
`chart.tsx`/`chart-toggle.tsx`/`chart-small-multiples.tsx`/`chart-download.tsx` (the Recharts wrapper family),
`delete-history-button.tsx` (an inline two-stage confirm, not a modal), `feedback-buttons.tsx`,
`answer-proof.tsx`, `question-history.tsx`, `landing.tsx` (the full marketing homepage), and more.

Live-verified on production (`checkdecijfers.vercel.app`): the public homepage matches the huisstijl
description exactly — serif headline, cream background, one indigo primary button, a live trial chat widget
(right-aligned gray user bubble / left-aligned bordered-card answer with definition + source line), and an
"Ontdek Nederland in grafieken" section with five real charts, each behind a properly-`role="tab"`-marked
Grafiek/Tabel toggle (confirmed via the accessibility tree, not just visually) plus a download button and a
StatLine deep link.

**This means any component-library adoption is a retrofit onto shipped, invariant-tested, byte-identity-pinned
code** — [ADR 033](../decisions/033-chat-workspace-redesign.md)'s D4 explicitly pins that suggestion chips,
feedback buttons, source-selection chips, the attribution chip, provisional badges, and more render
**byte-identically** to today as a build-brief gate. A drive-by reskin risks tripping those pins for no
product benefit. This is the single biggest reason NOT to treat this as a green-field "just run `shadcn init`
and add everything."

### Charts are the one place a naive migration would be actively dangerous

[ADR 007](../decisions/007-chart-spec-rendering.md) makes `ChartView` (`web/components/chart.tsx`) a "dumb
renderer" over a server-built, invariant-tested chart spec — R1 (result-id traceability), R4 (attribution in
the spec), R6 (deterministic projection), R7 (stated definition), R10 (units), R11 (provisional marking) all
depend on the renderer faithfully drawing exactly what the spec says, never reinterpreting it. The Explore
agent confirmed the current `ChartView` implements this correctly: every displayed number comes from the
point's own `formattedValue`, never Recharts' own formatting, via custom tooltip/axis/label components bound
to `data-label-for="<resultId>"`. **shadcn's own `chart` component is itself just a themed Recharts
wrapper** — so a migration here is really a THEMING exercise (colors, fonts, card chrome) layered on the
existing spec-rendering logic, never a replacement of it. Anyone picking this up must treat the data-binding
internals of `chart.tsx` as off-limits and only touch the surrounding chrome, verified against the existing
gate tests (`tests/chart/curated.test.ts` and friends) after every change — not a "swap the library" move.

## Product UI surfaces — current and roadmap (what a component system actually has to serve)

| Surface | Status | Current implementation | Where it's designed |
|---|---|---|---|
| Public landing / trial chat | LIVE | `landing.tsx`, `trial.tsx`, `trial-chat.tsx` — hand-rolled | ADR 035, ADR 036 |
| Core chat (question box, message list, chips) | LIVE | `chat.tsx` (~1000 lines) — hand-rolled | ADR 029 (chips) |
| Chat workspace shell (sidebar, right-pane dock, top nav) | LIVE (`WORKSPACE_ENABLED`) | `workspace.tsx`, `thread-sidebar.tsx`, `visual-dock.tsx`, `site-header.tsx` — hand-rolled | ADR 033 |
| Charts (line/bar + table view) | LIVE | `chart.tsx` + family — Recharts, hand-themed | ADR 007, ADR 014 |
| Stat cards | LIVE | `stat-card.tsx` — hand-built SVG, its own hex palette | — |
| Login (magic link + Google SSO) | LIVE | `login-form.tsx` — native form | ADR 028 |
| Credits / billing | LIVE | `credits/page.tsx`, `buy-button.tsx` — hand-rolled | ADR 006 |
| Account menu / dropdown | LIVE | inside `site-header.tsx` — hand-rolled dropdown | ADR 033 D6 |
| Question history | LIVE | `question-history.tsx` — native `<details>/<summary>` | — |
| Delete-history confirm | LIVE | `delete-history-button.tsx` — inline 2-stage, not a modal | — |
| Feedback (👍/👎 + text panel) | LIVE | `feedback-buttons.tsx` | open-questions #128 |
| System-overview diagram page | LIVE (public, noindexed) | `system-map-content.tsx` + a hand-drawn inline SVG | — |
| **Free browse layer** (public data pages, gemeente × topic) | Phase 1(late)–2, not built | — | roadmap feature pool |
| **Visualisatie Studio** (formats, sizes, interactivity, embeds) | Phase 2, not built | — | ADR 007 (the reserved seam), roadmap |
| **Saved/pinned-charts dashboard** | Phase 2, not built | — | open-questions #60 |
| **Shareable answer pages + OpenGraph images** | Phase 2, not built | — | roadmap |
| **Source-selection chips** (multi-source, registry-driven) | With the first 2nd source | — | open-questions #129 |
| **Pre-spend cost transparency** (estimate → confirm) | Phase 2, not built | — | roadmap |
| **Numeric data export (CSV/table)** | Phase 1, not built | — | roadmap |
| **Multilingual UI (L1)** | Layered, not built | — | open-questions #131 |
| **Newsroom / enterprise admin surfaces** | Phase 3, option | — | roadmap feature pool |

The roadmap is not small: browse-layer pages, a Studio with format/size pickers, a saved-charts gallery,
shareable pages, cost-confirmation dialogs, multi-source chip pickers, CSV export, and (eventually) an
admin/newsroom tier. Every one of these is a *new* surface — meaning every one of them is a chance to adopt
components cleanly, with zero byte-identity risk, regardless of what happens with the existing surfaces.

## Component-fit mapping

Mapped against shadcn/ui's own component menu, re-themed to the EXISTING papier-en-inkt tokens (see
Design-fit section below) rather than shadcn's own "new-york" dashboard defaults:

| Need (current or roadmap) | shadcn component | Fit |
|---|---|---|
| Primary/secondary buttons (currently 8x-duplicated `bg-accent` fragment) | `Button` (with a custom `variant` mapped to `--accent`) | Direct — closes the measured duplication |
| Question box, feedback textarea, future form fields | `Input`, `Textarea`, `Label` | Direct |
| Login form, future settings forms | `Form` (react-hook-form + zod wrapper) | Direct — ADR 008 already named this pairing |
| Delete-history confirm, future destructive actions (Studio "discard," account deletion) | `AlertDialog` | Better than the current inline 2-stage pattern — a standard, accessible confirm |
| Account dropdown in `site-header.tsx` | `DropdownMenu` | Direct — hand-rolled dropdowns are the #1 place subtle a11y/focus bugs hide |
| Grafiek/Tabel toggle (already `role="tab"`), workspace visual-dock tabs, future seizoengecorrigeerd toggle | `Tabs` | Direct — the current markup already reaches for tab semantics by hand; `Tabs` formalizes it |
| Source badges, provisional-cijfer marker, staleness markers | `Badge` | Direct |
| Chat workspace thread sidebar | `Sidebar` (or a lighter custom pattern using `ScrollArea` + `Separator`) | Good fit, but this is existing byte-pinned UI — retrofit candidate, not urgent |
| Charts | `Chart` (Recharts wrapper + theming conventions) | Theming-only — the existing `ChartView` data logic stays, see caveat above |
| Loading/empty/error states (browse-layer pages, Studio) | `Skeleton`, `Alert` | New-surface candidate |
| Global search / command palette (if the browse layer or Studio ever wants quick-jump) | `Command` | Speculative, Phase 2+ |
| Studio format/size picker | `Select`, `RadioGroup`, `Tabs` | New-surface candidate |
| Toasts (feedback confirmation, copy-to-clipboard, credit purchase confirm) | `sonner` (ADR 008 already named this) | Direct — there's no toast mechanism today at all |
| CSV/table export menu, chart download menu | `DropdownMenu` (already exists as `chart-download.tsx`, hand-rolled) | Retrofit candidate |

## Design-fit: why NOT shadcn's own defaults

The `vercel:shadcn` skill's own guidance says: "Default to dark mode for dashboards, AI apps... Use light
mode only when the product is clearly content-first or editorial." **Check de Cijfers is exactly the
editorial case** — a deliberate, owner-decided, already-shipped light-only "papier & inkt" identity, closer
to a newspaper/magazine than a SaaS dashboard. Adopting shadcn's own "new-york" dark-first dashboard
aesthetic (zinc/neutral base, dark-mode-primary) would directly contradict both the explicit house rule
("never raw zinc-\*/blue-\* palette classes") and the owner's session-51 decision. **The correct adoption
path is: init shadcn, then immediately replace its generated CSS variables with the existing
`--paper`/`--ink`/`--accent`/... tokens** (the shadcn skill's own theming section supports this directly —
it's a token-mapping exercise, not a redesign) — keeping every existing visual decision, gaining
componentized, accessible, de-duplicated primitives underneath. Dark mode stays exactly what it is today
(a documented future follow-up), not something adopting shadcn forces a decision on.

One more concrete data point: the competitive teardown of nederlandinbeeld.org (a direct competitor,
recorded in `docs/status-archive.md`, session 51) found it built on "Vite+React+**shadcn/Recharts**+Supabase" —
the same stack ADR 008 named. That competitor's problems were about AI honesty (fabricated numbers), not
about the UI kit — but it's a second independent signal that shadcn+Recharts is the ecosystem-standard
choice for exactly this kind of product.

## Recommendation

1. **Finish executing ADR 008, but re-themed** — `npx shadcn@latest init -d`, then replace the generated
   theme block with the existing `globals.css` tokens verbatim (light-only; no dark-mode work triggered).
   This isn't a new decision, it's completing a 2-month-old one with better information about the visual
   direction that came after it.
2. **New surfaces get shadcn components from day one** — the free browse layer, Visualisatie Studio,
   saved-charts gallery, and any settings/admin screens are all *not built yet*, so there's zero
   byte-identity risk and full component-library benefit. Start here, not with a retrofit.
3. **Existing surfaces migrate opportunistically, one component at a time** — the account dropdown and the
   delete-history confirm are the best first candidates (self-contained, no chart/audit data-binding
   involved, immediate accessibility win). `chat.tsx` and the chart family should NOT be touched as a
   "let's adopt shadcn" project — only as part of whatever future work already touches them, verified
   against the existing byte-identity and invariant tests each time.
4. **Never let a component-library adoption touch `chart.tsx`'s data-binding internals** — theming only,
   through the wrapper ADR 007 already designed for exactly this kind of swap.
5. **Fix the `stat-card.tsx` hex-palette drift as a small, separate, low-risk cleanup** — either give it the
   same `inlineComputedPaint`-style token-resolution `chart-download.tsx` already has, or accept and document
   the hex duplication explicitly as the SVG-export exception `docs/12-huisstijl.md` doesn't currently name.
   Independent of the shadcn question either way.

**Not recommended:** a big-bang "migrate everything to shadcn" project. The existing hand-rolled
implementation is not broken — it's a real, deliberate, well-documented design system that happens to be
copy-pasted instead of componentized. The value of shadcn here is de-duplication + accessibility hardening +
a faster path for the large amount of *roadmap* UI that doesn't exist yet, not a rescue of anything currently
failing.

## Open questions / owner decisions this surfaces

- Timing: is this worth doing now (Phase 1, alongside the roadmap's browse-layer/Studio work), or does it
  wait until one of those new surfaces is actually being built (so the first shadcn components go in
  alongside real new-surface work rather than as a standalone infra task)?
- Scope of the "existing surface" retrofit: none of it is urgent (nothing is broken) — worth an explicit
  owner steer on whether ANY retrofit work is wanted, or whether "new surfaces only" is the whole policy.
- The `stat-card.tsx` hex-palette drift: worth its own small fix regardless of the shadcn decision.

Recorded as [open-questions #204](../open-questions.md) — not scheduled, pending an owner decision on the
above.
