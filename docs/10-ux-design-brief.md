# UX design brief — site shell (navigation/footer), dashboard, homepage/chatbox

**Status:** LARGELY BUILT — shell (header/footer/logout) via WP135 + session 51; #98 RESOLVED session 51 (`/` = public landing, see open-questions); visual design (explicitly out of scope here) landed as the papier-en-inkt huisstijl, [12-huisstijl.md](12-huisstijl.md). Kept as the design rationale record. Written 2026-07-05/06 (session 21/22 boundary), from reading the current app as it stands, not from a redesign wishlist.

## How to use this document

This is a brief, not a spec ready to build. Sections 1–2 are facts about the app today (evidence-based, file references included). Section 3 onward proposes changes; every place marked **[DECISION NEEDED]** wants your call, with a recommendation already picked so you can just say "yes" or redirect. Once decided, the actual build becomes its own work package in [08-build-plan.md](08-build-plan.md) — same pattern as every other feature in this project. Nothing in this document changes code by itself.

The rich in-message layer (answer bubbles, stat cards, citation/CSV buttons, source chips, drill-through links — the #70/78/80/82/84/86/89/90/91/92 cluster) is **not** this brief's concern; several of those are already built or being built this session. This brief is about the container *around* that layer: the parts of the screen that exist on every page regardless of what's being asked.

## 1. What exists today (verified by reading the code, not assumed)

**Route map:** `/` (the dashboard), `/login`, `/credits`, `/auth/callback` (a redirect handler, no UI). That's the whole site.

**There is no shell.** [`web/app/layout.tsx`](../web/app/layout.tsx) is a bare `<html><body>` wrapper — no header, no footer, no nav, on any page. Every route is its own island with its own hand-rolled markup.

**`/` and "the dashboard" are the same thing.** [`web/app/page.tsx`](../web/app/page.tsx) renders `<Dashboard>` directly: a purchase-confirmation banner, then a two-column grid — chat + question history on the left (2fr), the account panel (balance, low-balance warning, "Credits kopen" link, credits explainer) on the right (1fr). There is no separate "homepage" — there never has been. This was a deliberate Phase 0 choice (ADR [008](decisions/008-ui-foundation.md): *"Sidebar/navigation shell... Phase 1–2 surface"*) — we're now well into Phase 1, so it's a fair time to revisit, not a fair time to assume it's already been revisited.

**Concrete gaps this produces:**
- **There is no way to log out.** I grepped the entire `web/` tree for `signOut`/`logout`/`uitloggen` — zero matches. A logged-in user has no UI path to end their session; only clearing cookies works.
- **`/credits` is a dead end.** It has its own inline `Je huidige saldo: X credits` line and pack list ([`web/app/credits/page.tsx`](../web/app/credits/page.tsx)), but no link back to `/`. The only way back is the browser's back button.
- **Balance is displayed in two unstyled, disconnected places** (`AccountPanel` on `/`, the inline line on `/credits`) rather than one shared piece of chrome.
- **No site-wide attribution or license notice.** R4/CC BY attribution is correctly inline on every *answer* (that's right — it must be), but there is nothing at the site level stating "data: CBS StatLine, CC BY 4.0" the way a masthead states its wire-service credit once, for a visitor who hasn't asked a question yet.
- **No privacy/data link anywhere**, despite [#14](open-questions.md) already deciding a 2-year retention + self-service-deletion policy (flagged urgent, not yet built or linked from anywhere).
- **A logged-out visitor at `/` sees nothing but a redirect to a bare login form** — no product context, no explanation of what this is, before being asked to authenticate.

**What I did not check:** live mobile rendering (the grid is `grid-cols-1 lg:grid-cols-[2fr_1fr]`, which should stack correctly on narrow screens per the Tailwind breakpoint, but I did not open a real small viewport to confirm — flagging this as unverified, not claiming it works).

## 2. Why this matters now, not later

Nothing above was a bug in Phase 0 — a single logged-in power-user screen was the entire point (ADR 008). It becomes a real gap the moment there's more than one route and more than one kind of visitor, which is already true today (three routes, an auth boundary, a purchase flow) and about to become more true: [#53](open-questions.md) (the anonymous-trial page) is next in the standing queue after CSV export, and it is explicitly scoped as **a separate page from the main chat** — which means the site is about to grow a fourth route with no shell to hold it together, unless the shell question gets answered first.

## 3. Proposed site shell: header + footer

**Header** (new component, e.g. `web/components/site-header.tsx`), rendered on every authenticated page:
- Wordmark/text logo linking to `/` (no need for real logo art yet — text is fine).
- Live balance chip — same number `AccountPanel` already shows; a shared component removes the duplication rather than inventing new state.
- "Credits kopen" link (currently buried inside `AccountPanel`; promoting it to the header makes it reachable from `/credits` too, closing the dead-end).
- **A working "Log uit" link** — the concrete missing piece. Small: a server action wrapping Supabase's sign-out, redirecting to `/login`.
- On `/login` itself: a stripped header with just the wordmark (no balance, no logout — there's nothing to show yet).

**Footer** (new component, rendered site-wide including `/login`), one line, Dutch (this part *is* product copy):

> Cijfers: CBS StatLine (CC BY 4.0) · Elk getal herleidbaar tot een officiële CBS-tabel · [Privacybeleid] · [Over dit project]

- `[Privacybeleid]` link target doesn't exist yet — it's #14's own small brief (GDPR-flagged urgent), can point there once built; until then, either omit the link or point at a one-paragraph placeholder.
- `[Over dit project]` can lean on existing language in [01-product-vision.md](01-product-vision.md) rephrased for a visitor — small effort, not new copywriting from scratch.
- This is genuinely just a footer sentence, not a legal page — the per-answer attribution stays the authoritative, detailed one (R4). This is the site-level echo of it, the way a photo credit at the bottom of a page doesn't replace the caption under the photo.

**Where these mount:** recommend the footer goes directly into `layout.tsx` (it needs no data, so this is free) but the header stays a component each authenticated page renders itself, exactly like today's per-page `currentUserId()` guard (the WP13 belt-and-suspenders pattern already in `page.tsx` and `credits/page.tsx`) — rather than centralizing auth/balance-fetching into `layout.tsx`, which would be a bigger structural change than this brief needs to ask for.

**This part is low-risk and not really a design fork** — it's mechanical, once the footer copy is approved (open-questions [#99](open-questions.md)). I've written it up as a placeholder work package (WP24) in [08-build-plan.md](08-build-plan.md) so a build session can pick it up directly.

## 4. Dashboard vs. homepage — the one real fork **[DECISION NEEDED — open-questions #98]**

**Option A — keep merged (recommended for now).** `/` stays exactly what it is: the dashboard, full stop, for a logged-in user. A logged-out visitor at `/` still redirects to `/login`. When [#53](open-questions.md) (anonymous trial) gets built, it lives on its own route (e.g. `/probeer`) — never `/` — matching #53's own already-recorded framing ("a *separate* page... funded from its own capped budget"). **Cost: none — this is what already exists.** Downside: no public marketing/SEO surface at the bare domain, which is fine — that's already a distinct, later phase in the roadmap, not something this brief should pull forward.

**Option B — split into a real public landing page + a moved dashboard.** `/` becomes a marketing pitch for logged-out visitors (maybe even a live teaser wired to #53's trial budget); today's dashboard moves to `/app` or `/dashboard`. Cleaner mental model, but real build cost, and it substantially overlaps #53's own scope — building both at once risks the exact scope creep the phase gate exists to prevent (03-mvp-scope.md).

**Option C — small hybrid.** Keep `/` as the dashboard for logged-in users (Option A), but replace today's *bare redirect to `/login`* for logged-out visitors with one minimal screen: a short pitch + the login link, no live chat teaser. Cheap, and it fixes the "a stranger sees only a login form with zero context" gap without committing to #53's build or its budget/abuse questions.

**My recommendation: A now, C as a small fast-follow once the shell (section 3) ships, B only if/when #53 is actually greenlit for build** — same discipline as everywhere else in this project: decide the cheap thing now, defer the expensive thing to when it's actually needed.

## 5. Smaller dashboard notes (not decisions, just observations)

- The 2:1 chat-to-account-panel ratio already gives the primary action (asking a question) the visual weight it should have — I'm not proposing a change here, just naming that it was a reasonable existing choice worth keeping.
- The purchase-success banner (built, [#95](open-questions.md)) is local to `/` because Stripe's `success_url` points there — fine today, just noting the coupling for whoever next touches the purchase flow.
- Future per-message affordances (the #70/79/89/90 drill-through cluster) should stay inside the message bubble, matching the pattern already used for citation/CSV/source-chip buttons — not pushed into `AccountPanel`, which should stay narrowly about the account, not about any one answer.

## 6. Explicitly out of scope for this brief

- Visual redesign beyond structure (color palette, typography beyond the already-approved #91 tabular figures) — this is an information-architecture brief, not a rebrand.
- #53's own internal design (trial credit count, abuse limits, copy) — its own brief, when greenlit.
- #14's privacy-page content — its own small, already-urgent-flagged brief.

## 7. Suggested next steps

1. Decide [#98](open-questions.md) (A/B/C above) and [#99](open-questions.md) (footer copy) — both are quick owner calls, not open-ended design work.
2. Build WP24 (site shell — header, footer, logout; placeholder in [08-build-plan.md](08-build-plan.md)) — no further decisions block it once #99 is signed off.
3. If C is chosen: a small follow-up WP for the logged-out one-screen pitch.
4. Live-verify the mobile stacking behavior the first time someone is actually on a phone — currently unverified, not broken as far as I know, just untested.
