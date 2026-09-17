# Session 110 — UX audit of the web app as it renders today (2026-09-17)

**How this was audited.** Two real browsers via Playwright: (1) the public production site
`https://checkdecijfers.vercel.app` (landing, `/galerij`, `/login`), and (2) the repo's own hermetic
local harness (`scripts/dev-harness/`, RUNBOOK § "Local real-browser harness") on `:3102` — PGlite
fixture DB, stubbed auth, stubbed LLM, **zero LLM spend, production never written to**. Two questions
were asked through the stub (B4 `Hoe ontwikkelde de inflatie zich per jaar van 2020 t/m 2024?` and
B18 `Wat wordt de inflatie in 2027?`). Viewports 1280×800 and 375×812, light and dark.
Every finding below was seen in a browser or traced to a file; nothing is inferred from code alone
unless the row says so. ADRs 038/039/042/043/044/050/051 were read first so deliberate choices are
not reported as bugs.

**Counts: P1 = 2 · P2 = 14 · P3 = 7.**

---

## Fix now (mechanical — no design decision needed)

| # | Sev | Where | What I saw | Expected | Repro | Proposed fix |
|---|-----|-------|-----------|----------|-------|--------------|
| 1 | **P1** | `web/components/workspace.tsx:488` (`w-64 shrink-0`) + auto-collapse effect at `:193-196` | At 375×812, tapping the sidebar rail toggle expands the chat list to a fixed 264 px **flex sibling**, squeezing the chat pane to ~111 px: the composer input becomes a 30 px square, "Send" is clipped off-screen, each chip wraps to one word per line. Tapping a thread does **not** re-collapse it. | On a phone the expanded chat list overlays the chat pane (drawer), or collapses again on thread select. | 375×812, logged in → tap the rail icon top-left → tap a thread. Screenshots `ws-mobile-sidebar.png`, `ws-mobile-thread.png`. | Below `md`, render the expanded sidebar `absolute inset-y-0 left-0 z-20` over the chat pane + close on thread select. The `:188` comment shows this hole is known by construction ("the user's own manual toggle afterward still wins"). |
| 2 | **P1** | `web/proxy.ts:217` | A malformed/truncated `sb-…-auth-token` cookie makes `supabase.auth.getClaims()` **throw**, so *every* route — including the public `/`, `/login`, `/galerij` — returns **HTTP 500**. The user has no in-app way out; only clearing cookies manually recovers. | A bad cookie is treated as "not signed in": public pages render, private ones redirect to `/login`, and the bad cookie is cleared. | Set the auth cookie to any truncated value, load `/`. Reproduced accidentally and repeatedly this session (server log: `⨯ SyntaxError … at async proxy (proxy.ts:217:20)`). | Wrap the `getClaims()` call in try/catch; on throw treat as no claims and `response.cookies.delete(...)` the auth cookie before redirecting. |
| 3 | P2 | `web/components/gallery.tsx:92` and `:101` (`if (charts.length === 0) return null`), degrade path `web/lib/deadline.ts:60` | On a cold read (>5 s, #190) `/galerij` renders **heading + intro + CTA and zero cards**, and the landing's gallery teaser disappears entirely — no skeleton, no message. Seen on **production** (first load of `/galerij` = 0 cards; immediate reload = 12) and locally (`[galerij] read exceeded 5000ms — degrading instead of waiting (#190)`). | A slow read shows a loading skeleton or a short "still loading, reload in a moment" note — never a page that looks broken/empty. | Load `/galerij` on a cold serverless function. | Render a skeleton row + one-line note instead of `null`; keep the fail-safe, drop the silent-blank. |
| 4 | P2 | `web/lib/thread-groups.ts:8,34,41,46` | With EN selected, the chat sidebar's date headings stay Dutch: **"Vandaag"** (also Gisteren / Afgelopen 7 dagen / Ouder). | Translated via the catalogue. | Switch to EN, look at the sidebar. | Keep the bucket keys, add `history.today/yesterday/last7/older` to `messages.ts` and render `t(...)`. |
| 5 | P2 | `web/lib/dock-visuals.ts:99` and `:113` | The chart dock's tab reads **"Grafiek 1 · Hoe ontwikkelde…"** in the English UI (`label: \`Grafiek ${chartCount}\``, `\`Kaart ${cardCount}\``). | "Chart 1" / "Card 1" in EN. | EN + ask a charted question → look at the dock tab. | Pass `lang` into `buildDockVisuals` and use catalogue keys. |
| 6 | P2 | `web/components/chart-config-panel.tsx:1258` + the Base UI `data-slot="dialog-close"` | The **Chart style** dialog has **two** controls both named "Close" — the × top-right (1129, 82) and a second × at (1084, 160) next to the chart-language select. | One close control. | Open a chart → **Style**. Screenshot `ws-style-panel.png`. | Hide the panel's own close button when the panel renders inside the modal (it is a leftover from ADR 039's inline panel). |
| 7 | P2 | `/credits` package list | On the **English** page: "€30 — **2.000** credits", "€250 — **25.000** credits" (Dutch thousands separator, reads as "two point zero") while the line under it says "≈ **1250** simple questions" with no separator at all. | `Intl.NumberFormat(lang)` for all three, consistently. | `/credits` in EN. | Format numbers through the active language. |
| 8 | P2 | `web/components/site-header.tsx:81` | At 375 px the **Account** button's right edge is at **379 px** — the chevron is clipped by the viewport (measured: `right: 379`, `clientWidth: 375`). | ≥ 12 px right gutter at 375 px. | 375×812 logged in. | Reduce the header's right padding/gap at `<sm`, or let the Account button shrink. |
| 9 | P2 | `web/components/chat.tsx` (answer-card action row) + the chat scroll container | Clicking **"Prove these numbers"** — the product's namesake trust action — expands the proof panel *below the fold*; only a grey "Technical details" strip is visible behind the composer, and nothing scrolls it into view. | The panel scrolls into view on open. | Ask a question → click "Prove these numbers". Screenshot `ws-proof.png`. | `scrollIntoView({ block: 'nearest' })` on the panel when it opens. |
| 10 | P2 | chart card footer (dock, `web/components/chart.tsx` source/actions row) | In the 410 px dock the **Embed** button wraps onto its own row, left-aligned at x≈903, while **Download** stays inline with the source link at x≈1166 — the two actions read as unrelated. | Both actions on one aligned row (or both wrapped together). | 1280×800, ask a charted question, look at the bottom of the dock. Screenshot `ws-proof2.png`. | Put Download + Embed in one flex group that wraps as a unit. |
| 11 | P2 | `web/components/site-footer.tsx:40-41,72` | At 375 px the footer wraps to **two lines / 53 px** (6.5 % of the phone viewport) on *every* screen, and it has **no background colour** (`rgba(0,0,0,0)`), so content sitting at the scroller's bottom edge abuts the footer text with only a hairline between them. The component's own comment already records the 2-line wrap as a known owner complaint. | One line at 375 px, and an opaque footer background. | 375×812 any page. Screenshot `prod-landing-mobile.png`. | Shorten/truncate the attribution at `<sm`, and add `bg-background` to the `<footer>`. |
| 12 | P2 | chart card, `Embed` action | Locally the Embed dialog opens with the title "Embed this chart", the instruction "Paste this code into an article…", **no code box**, and a red "Embedding is not available right now." Production's `/galerij` still says "Inline embedding of your own is coming soon." | When embedding is off, the button is hidden or disabled with the reason on hover — not a dialog that fails after opening. | Open a chart → **Embed**. Screenshot `ws-embed.png`. | Gate the button on the same flag the dialog checks. |
| 13 | P3 | `/credits` | Four buttons whose entire accessible name is **"Buy"** — a screen-reader user hears "Buy, Buy, Buy, Buy". | `aria-label="Buy €5 — 200 credits"` etc. | Snapshot of `/credits`. | Add the package to each button's accessible name. |
| 14 | P3 | `/credits`, `/geschiedenis`, `/login` | The visible `<h1>` repeats the site name: **"Credits — Check de Cijfers"**, "History — Check de Cijfers", "Log in — Check de Cijfers" — the `<title>` string used as a page heading. | "Credits", "History", "Log in" as headings; the site name stays in `<title>`. | Any of the three pages. | Split the heading key from the metadata title key. |
| 15 | P3 | `web/components/chat.tsx:1514-1580` composer chips | "Upload file", "Link sheet", "Connect data" are `disabled`, so they are **not keyboard-focusable**, and their only explanation lives in a `title` tooltip — unreachable without a mouse. | The "coming soon" reason is available to keyboard and screen-reader users. | Tab through the composer. | Use `aria-disabled` + a visible/`aria-describedby` hint instead of the `disabled` attribute. |
| 16 | P3 | `web/components/chart-toggle.tsx` (`chart.formReason.hbarTimeSeries`) | "Horizontal bars only fit a comparison between regions." is rendered as **permanently visible** static text under the form tabs of *every* chart, including the three landing-page cards — two lines of explanation for a disabled tab nobody pressed. | Shown on hover/focus of the disabled tab, or as its `title`. | Any chart card. | Move the reason onto the disabled tab as a tooltip/`aria-describedby`. |
| 17 | P3 | `/geschiedenis` | Each history row's accessible name is one run-on string with no separator: `"Wat wordt de inflatie in 2027?0 credits · 17 September 2026 at 08:19 CBS publiceert…"` (note `2027?0 credits`). | A separator (or a scoped `aria-label`) between question, cost/date and preview. | Snapshot `/geschiedenis`. | Add a space/`aria-label` on the `<summary>`. |

## Needs a design decision (do **not** auto-dispatch)

| # | Sev | Where | What I saw | Why it needs a call |
|---|-----|-------|-----------|---------------------|
| 18 | P2 | `web/components/chart.tsx:2921` | Every chart card shows the **raw CBS dimension key**: `Bestedingscategorieen: 000000 Alle bestedingen`, `SoortMutaties: Volume, t.o.v. zelfde periode vorig jaar`, in **both** languages. A camelCase machine identifier (and a raw `000000` code) is in the journalist's face on the homepage. | Dropping the `${k}: ` prefix is one line, but the key disambiguates when several dimensions are pinned. Needs a call: drop the key, or maintain a human-label map. |
| 19 | P2 | `src/chart/insights.ts:92,212`; `web/lib/i18n/messages.ts:1195` | The Insights carousel labelled **two consecutive cards "Notable low"**: `2020: 1,3 %` *and* `2021: 2,7 %`. 2,7 % was a rise, not a low — the code assigns `recordLow` to **any below-mean point**, which the comment there openly documents. | For a fact-checking product, "Notable low" on a non-low is a credibility risk. Fixing it means either re-wording ("below average") or restricting the label to the actual extreme — a product-voice call. |
| 20 | P2 | `web/components/chat.tsx` composer | The question box is a single-line `<input maxlength="500">` (`overflow-y: clip`, fixed 40 px). A realistic 291-character question shows ~60 characters at a time, never wraps, and the 500-char cap cuts input silently with no counter. | Swapping to an auto-growing `<textarea>` changes Enter-to-send semantics. A cheaper slice (a character counter near the cap) is possible; the owner should pick. |
| 21 | P2 | `web/components/site-footer.tsx:40` `FOOTER_ATTRIBUTION` | On every English page the footer reads **"Cijfers: CBS StatLine (CC BY 4.0) · Elk getal herleidbaar tot een officiële CBS-tabel"** next to translated links ("How we work · Privacy"). | This is **deliberate** — the language-switch design §1 pins `FOOTER_ATTRIBUTION` byte-identical in both languages. It still reads as unfinished on an English page. Owner call to revisit. |
| 22 | P2 | `app/werkwijze`, `app/privacy` (`trust.draftNote`) | Both trust pages, linked from the footer of every page including production, carry a **"Draft — under review."** banner. | Deliberate and test-pinned, but it is the product's public trust explainer. Needs the owner to either sign it off or hide the banner pre-launch. |
| 23 | P2 | refusal answer | B18's refusal ends with a genuinely useful alternative — *"Ik kan wel het gerealiseerde cijfer … voor juni 2026 … voor je opzoeken"* — but only as **prose**. Answers get clickable follow-up chips; refusals do not. | Turning a refusal's alternative into a one-click chip touches the answer pipeline and the credit rules (ADR 015/029). |
| 24 | P3 | chat empty state | A new chat is a bare composer under ~500 px of empty white at 1280×800: no example question, no suggestion chips. | **Deliberate** since session 87 (`chat.tsx:66`: "it is a bare composer now, like a blank LLM chat"). Listed only so nobody "fixes" it unknowingly — and so the owner can reconsider against the journey programme's first-five-minutes goal (ADR 045). |
| 25 | P3 | chart card + proof panel, EN | One card mixes languages by design: EN chrome ("The cells used", "Step by step", "Latest value on the chart") around Dutch backend prose ("Inflatie … steeg sinds 2020.", "Definitie: …", "Voorlopige cijfers zijn gemarkeerd met *.", status "Definitief"). | Documented limitation of the word-list approach (language-switch design §4 — free prose is never machine-translated, principle (a)/(c)). Any change here is a product decision, not a bug fix. |

## What works well (do not "fix" these)

The **refusal path is excellent** and is the product's best screen: "I could not answer this" + a
`no answer = no guess` badge + a specific reason + **0 credits** charged. The **proof panel** content
is exactly what a journalist needs — the exact cells, the table/version/sync/licence line, "Not
chosen:" for the rejected reading, and a numbered step-by-step. **Dark mode contrast is genuinely
good**: every muted string measured ≥ 5.86:1 (footer 7.66, sidebar item 11.23, pricing hint 6.94).
**No console errors, no React key warnings, no hydration mismatches, no broken anchors, no
horizontal page scroll at 375 px**, and production CLS is **0.0009** — effectively no layout shift.
The designed default chart (ADR 042 — Okabe–Ito palette, ends-only markers, quiet horizontal grid,
hairline baseline) reads as publication-ready, the template picker (ADR 043) is clear and well
written, the alternate-reading dropdown (ADR 051) and the From/To window work, and the Chart-style
dialog is correctly modal (`aria-modal`, `aria-labelledby`, focus moves in, Escape closes).

**Performance (production landing, cold):** 26 requests / **595 KB** total; top five —
`0m4ly0j62p01i.js` 169 KB, `01p8a5f5zlljx.js` 89 KB, `3uweg7e7-ae05.js` 71 KB,
`1aegv2umakn9y.js` 63 KB, `83afe278b6a6bb3c…woff2` 47 KB. DOMContentLoaded 5.5 s on a cold function
(warm reloads were far faster). Not alarming, but the 169 KB chunk is the obvious lazy-load
candidate if the landing ever needs to get lighter.

## Surfaces I could NOT reach, and why

- **Anonymous trial answering** (live on production, dormant locally): asking a trial question spends
  real LLM budget on production, and `TRIAL_ENABLED` + the pot are not set in the local harness. The
  logged-out **shell** was audited on production (heading, copy, disabled Ask button, "2 of 2 free
  trial questions left"); the answer flow was not.
- **Stripe checkout** — money path, not exercised.
- **Chart notes / annotations, the journalist headline (ADR 050), the story stage (ADR 044), small
  multiples** — reachable but each needs an LLM call or several more interactions than the audit
  budget allowed. Their *entry points* render correctly ("Suggest headline" button present, five
  `Add a note at …` targets focusable on the chart).
- **`/eurostat-explorer`** — redirects to `/` (feature flag off).
- **`/embed/[token]`** — needs a published embed token; embedding is off.
- **`/bevolking-3d-demo`** — not visited (out of the core flow).
- **`/about`, `/geschiedenis`, `/credits`, the workspace** on *production* — auditing those needs a
  real mailbox for the magic link; they were audited in the harness instead, which runs the same
  code. Where the harness and production differ (`WORKSPACE_ENABLED`, `TRIAL_ENABLED`), the
  production behaviour was checked separately and is **not** reported as a defect.

## Two things I checked and deliberately did **not** report

- **A second scrollbar on the landing page** (`documentElement.scrollHeight` 2480 vs a 800 px shell,
  scrolling the window into blank white). Reproduces only on `next dev` with charts on the page;
  **production reports `scrollHeight` 800 and does not scroll**. Dev-tooling artifact.
- **The chat column staying white for one frame after switching to dark mode.** Computed styles were
  already correct (`--background: lab(2.75%)`, `.dark` on `<html>`); a reload paints correctly. A
  headless-Chromium repaint artifact, not a product defect.
