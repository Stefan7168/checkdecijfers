# WP28 — execute brief: Google SSO next to the magic link

**Frozen design: ADR [028](../decisions/028-google-sso.md). This brief is written for a smaller
executor model — follow it literally; every judgment call is already made.** Per the #118 rule an
autonomous build goes **branch + PR + owner review** (this touches the login path of a live,
money-handling product). The Google/Supabase dashboard configuration and the live round-trip test
are OWNER steps (§4) — the code PR is mergeable before those happen (fail-soft, D4).

## What you change (three files + tests — nothing else)

### 1. `web/app/login/actions.ts` — add one Server Action

Below `signInWithMagicLink`, same style, same file:

```ts
/** Google SSO (WP28, ADR 028): asks Supabase for the provider redirect URL and
 * sends the browser there. The OAuth round trip ends at the SAME
 * /auth/callback route the magic link uses (provider-agnostic code exchange).
 * Fail-soft: any error renders inline; the magic-link path is untouched. */
export async function signInWithGoogle(): Promise<SignInResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
    },
  });
  if (error || !data?.url) {
    console.error('signInWithGoogle failed:', error);
    return { ok: false, error: 'Inloggen met Google is niet gelukt. Probeer het opnieuw of gebruik de inloglink.' };
  }
  redirect(data.url); // next/navigation — throws NEXT_REDIRECT, never returns
}
```

Import `redirect` from `'next/navigation'`. NOTE: `redirect()` throws — code after it is
unreachable; the return type stays `SignInResult` for the error path only. **Read
`web/node_modules/next/dist/docs/` guidance on Server Actions + redirect before writing (this
Next.js version has breaking changes — web/AGENTS.md).**

### 2. `web/app/login/login-form.tsx` — add the button

Keep the existing form byte-identical in behavior. Add below it a visually separated block
(divider + secondary-styled button, Dutch copy):

- Button text: `Doorgaan met Google`.
- On click: `setBusy(true)`, call `signInWithGoogle()`; on an `ok: false` return show its error in
  the existing error slot; on success the browser navigates away (the action redirected).
- A `NEXT_REDIRECT` throw escaping a client-side action call must NOT be rendered as an error —
  follow the Next docs pattern for calling redirecting Server Actions from client components.
- Both buttons share the single `busy` state (no double submits across methods).

### 3. Tests (extend the existing suites, same style)

- `web/app/login/` action tests: stub `createClient` (the existing test seam) — (a) provider URL
  returned → the action redirects to exactly that URL; (b) Supabase error → `{ ok: false }` with
  the Dutch copy, and `signInWithMagicLink` still works (independence pin).
- Form test: both buttons render; Google-error renders inline; magic-link flow untouched
  (existing tests stay green unmodified — that IS the regression pin).
- **Cross-pin (the #113 lesson):** one test asserts the action's `redirectTo` literal ends in
  `/auth/callback` AND that `isPublicPath('/auth/callback')` (from `web/proxy.ts`) is true — the
  pair that silently 307-broke the cron route at the go-live must be provably consistent here.

## What you must NOT touch

`web/app/auth/callback/route.ts`, `web/proxy.ts`, `web/lib/current-user.ts`, anything under
`src/`, any migration (the signup grant already covers OAuth users — ADR 028 D2). If you believe
you need to: STOP and report; do not improvise.

## §4 — Owner steps (RUNBOOK addition; include this text in your PR as a RUNBOOK edit)

1. **Google Cloud Console** (any Google account, free): create a project → "OAuth consent screen"
   (External, app name checkdecijfers, your e-mail) → "Credentials" → "Create credentials → OAuth
   client ID" → type **Web application** → Authorized redirect URI:
   `https://<project-ref>.supabase.co/auth/v1/callback` (the exact value is shown in step 2's
   Supabase screen — copy it from there). Save the **Client ID** and **Client secret**.
2. **Supabase dashboard** → Authentication → Sign In / Providers → Google → Enable, paste Client ID
   + secret → Save. (Secrets live ONLY here — never in the repo or Vercel.)
3. **Live verification (owner present):** log in with Google using an e-mail that ALREADY has a
   magic-link account → in Supabase: Authentication → Users must show ONE user (now with two
   identities), and the ledger must show NO second `signup_grant` row for it (one read-only SQL
   check — the ADR 028 D2 empirical verification). Then a fresh-e-mail Google login → new user,
   exactly one grant.

## Done-definition

Full gate green (root + web typechecks, both vitest suites, benchmark 14/14 + 6/6 + 0 fabricated —
untouched by construction but run it anyway), new tests green, PR opened with plain-language
description + the RUNBOOK edit, owner steps documented. Update docs in the same PR: ADR 028 as-built
note, STATUS, 04-architecture auth row, 06-roadmap. The live round trip (§4.3) is the owner's
acceptance test after merge.
