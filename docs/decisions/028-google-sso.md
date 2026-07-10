# ADR 028 — Google SSO alongside the magic link (owner request, 2026-07-08)

**Status:** accepted (design frozen session 30; owner-requested addition to the live product).
Execute brief: [session-briefs/2026-07-08-google-sso-brief.md](../session-briefs/2026-07-08-google-sso-brief.md) (WP28).

**As-built (session 34, 2026-07-10, autonomous per #118 — branch `wp28-google-sso`):** built exactly per
the brief — `signInWithGoogle` Server Action (the brief's literal code), the "Doorgaan met Google"
button below a divider sharing the single `busy` state, and the test set incl. the #113 cross-pin
(the action's `redirectTo` path and `isPublicPath('/auth/callback')` proven consistent in one test).
The callback route, proxy, `current-user`, `src/` and migrations are byte-untouched as designed.
The client button follows Next's documented `unstable_rethrow` pattern so a NEXT_REDIRECT control-flow
throw is never rendered as an inline error. **One D4 claim refined by measurement (dev-server round
trip, build session):** server-side `signInWithOAuth` only *builds* the authorize URL — it does not
validate that the provider is enabled. Pre-configuration, the button therefore does NOT show the
inline error copy; the browser round-trips to Supabase, which rejects the disabled provider and
bounces to `/login?error=auth` (the callback's existing no-code path) — a silent return to the login
page. Fail-soft still holds (no crash, no session, magic link untouched); the inline Dutch copy
covers server-side failures (missing env / Supabase client error). The RUNBOOK owner-steps section
documents this so the owner isn't surprised before completing the dashboard config. **D2 is now
VERIFIED (2026-07-10, same day, owner present, live production — open-questions [#122](../open-questions.md) RESOLVED):**
same-e-mail Google login linked to the EXISTING user (identities `[email]` → `[email, google]`, user
count and grant count unchanged — no duplicate grant), and a fresh-e-mail Google login created
exactly ONE new user with exactly ONE +100 grant. Config as-executed (incl. Google's secret-shown-
once gotcha and the "missing OAuth secret" 400 signature) is in the RUNBOOK WP28 section. The
consent screen shows the raw Supabase project domain — owner wants the product domain there once
[#7](../open-questions.md) lands (recorded on that row; also a revisit trigger below).
One precision on the trade-offs' "no shared failure mode" line, raised by the pre-PR review: the two
buttons DO share the single `busy` flag (brief-mandated, anti-double-submit), so while a Google
action call is in flight both doors are disabled. This does not couple the doors to Google's
availability — the awaited call reaches only OUR server, where `signInWithOAuth` merely builds the
authorize URL (measured 9ms, no Google/Supabase network dependency); a stall there means the app
itself is unreachable, which stalls the magic link equally. Error paths reset `busy` (tested), so
"no shared failure mode" holds where it matters: a broken/unconfigured Google provider never blocks
the magic-link door beyond the millisecond-scale action round trip.

## Context

Login today is magic-link only (WP13, ADR 006 seam 1): `signInWithOtp` → emailed link →
`/auth/callback` exchanges the code for a session. The owner wants "Doorgaan met Google" next to it.
Auth identity is load-bearing for money: `credit_transactions.user_id` keys off `auth.users.id`, and
the 100-credit signup grant fires from a DB trigger on `auth.users` insert (migration 005,
idempotent per user).

The existing seams make this small BY CONSTRUCTION — verified against the code, not assumed:

- `/auth/callback/route.ts` is already provider-agnostic: it exchanges whatever `?code=` arrives
  (`exchangeCodeForSession`), which is exactly what Supabase's OAuth flow sends back. **Zero changes.**
- `web/proxy.ts` already lists `/auth/callback` in `PUBLIC_PATH_PREFIXES`. **Zero changes.**
- The signup grant is per-`auth.users`-row and idempotent — a Google-created user fires the same
  trigger once, exactly like a magic-link user. **Zero changes.**

## Decisions

**D1 — Google via Supabase Auth's built-in provider, not a second auth system.** One-line server
flow: `supabase.auth.signInWithOtp` gets a sibling `signInWithOAuth({ provider: 'google', options:
{ redirectTo: NEXT_PUBLIC_APP_URL + '/auth/callback' } })`, whose returned `data.url` the Server
Action redirects to. Sessions, cookies, `currentUserId()` and the billing identity are untouched.
*Rejected alternative:* NextAuth.js / custom OIDC — a second session system beside Supabase's would
fork the identity the ledger keys on; maximal risk for zero benefit while Supabase hosts auth anyway.

**D2 — Account identity policy: one verified e-mail = one account, automatic.** Supabase links a
verified-email OAuth sign-in to the existing `auth.users` row with the same e-mail (Google e-mails
are verified), so someone who used the magic link earlier and Google later keeps ONE account, ONE
credit balance, ONE question history — no duplicate signup grant. A user whose Google e-mail
DIFFERS from their magic-link e-mail is genuinely a second account (own grant) — identical to
someone using two e-mail addresses today; accepted, not new abuse surface. **The build session must
VERIFY the linking behavior empirically on the live Supabase project during the supervised step
(magic-link login, then Google login with the same address → assert one `auth.users` row, one
`signup_grant` ledger row) — never assume a provider default.** *Rejected alternative:* manual
identity linking UI — Phase-2+ complexity with no current need.

**D3 — Server-initiated flow reusing the existing callback; no client-side Supabase JS.** The login
form stays a thin client component calling Server Actions (the WP13 pattern). The Google button
posts to a new `signInWithGoogle()` action in `web/app/login/actions.ts`; failure shows the same
inline error style and NEVER affects the magic-link path (independent buttons, independent actions).

**D4 — Configuration lives where the secrets live: Google Cloud Console + Supabase dashboard, owner-
executed via a RUNBOOK checklist.** Client ID/secret are pasted into Supabase's Google-provider
settings (they never enter the repo, `.env`, or Vercel — consistent with the secrets convention).
No new app env vars (`NEXT_PUBLIC_APP_URL` already exists). Until the owner completes the dashboard
steps, the button fails soft while magic link keeps working — the provider config is therefore NOT a
deploy-order hazard. *(As-built refinement, measured: pre-configuration the failure surfaces as a
silent bounce back to `/login?error=auth` via Supabase's authorize endpoint, not as the inline error
copy — see the as-built note above and the RUNBOOK WP28 section.)*

**D5 — Testing: hermetic for our code, a supervised live checklist for the round trip.** The OAuth
dance itself (Google ↔ Supabase) cannot be exercised hermetically; our code CAN be: the new action
with a stubbed Supabase client (url returned → redirect; error → soft failure), form rendering both
buttons, and source-pins that the redirect target is `/auth/callback` (the same literal the proxy
allowlists — the #113 cross-pin lesson). The live round trip + the D2 linking check are RUNBOOK
steps with the owner present.

## Trade-offs accepted

- Google outages or consent-screen misconfiguration surface as a failing button — magic link is the
  always-available fallback (deliberate: two independent doors, no shared failure mode in our code).
- Google's consent screen shows the Supabase project domain (`<ref>.supabase.co`) until a custom
  auth domain is configured — cosmetic; defer to the branding/domain decision (#7).

## Revisit triggers

- A second OAuth provider request (Microsoft/Apple) → generalize the button/action into a provider
  list, not before.
- Custom domain go-live (#7) → revisit the Supabase custom auth domain for the consent screen.
- Any measured duplicate-grant incident → revisit D2 with a linking UI.
