# Scoping: the Pro-owner-email lookup (open-questions #224)

**Status: scoping only — nothing built, nothing decided.** Written while PR #9 (Embed, ADR 041) sits
open awaiting the owner's merge decision. Planning/research only, per explicit instruction — no code
changes, no secrets touched, no branch other than this doc.

## The problem, restated plainly

The Embed feature lets someone paste a chart into another website. There's a "Live" option (the chart
updates itself automatically) that's meant to be a paid-only perk. Today, **nobody can use Live** — not
because it's broken, but because the code has no way to answer the question "is the person who created
this embed a paying customer?" once that person isn't actively logged in (which, for a chart pasted into
someone else's article, is basically always — the code checked "should we go live? and every time we
have to ask that, the actual owner has usually logged out days or weeks ago).

This doc lays out how to build that lookup, whenever it's wanted. It does not assume it should be built
now — see Recommendation.

## Why this doc exists now

ADR 041 (the Embed feature, built session 93, branch `embed-charts`, PR #9 open) explicitly named this
as real, unprovisioned scope, correctly deferred rather than improvised: *"building one needs new
Supabase admin/service-role plumbing... correctly judged out of scope for this plan."* Tracked as
[open-questions #224](../open-questions.md). This session was asked to scope it properly rather than
build it under time pressure a second time.

## Verified current state (read directly, not from memory)

- **No admin/service-role Supabase client exists anywhere in this codebase.** Repo-wide search for
  `service_role`, `auth.admin`, `getUserById`, `SUPABASE_SERVICE_ROLE_KEY` turns up nothing outside the
  docs that describe this exact gap.
- **The only identity lookup that exists** (`web/lib/current-user.ts`, `currentUserId()` /
  `currentUserEmail()`) reads the CURRENT request's own verified JWT claims
  (`supabase.auth.getClaims()`) — it can only ever answer "who is making this request right now," never
  "what is user X's email," for an arbitrary other user id.
- **The Supabase client this app already has** (`web/lib/supabase-server.ts`) is built from
  `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — both explicitly non-secret,
  RLS-scoped, safe-by-design values. A service-role key is a fundamentally different, far more
  dangerous credential: it bypasses Row Level Security entirely and can read or write any user's data.
  This is the most privileged secret this app would ever hold if it gets added.
- **`hasProPlan`'s signature already anticipates this** (`src/billing/pro.ts`): it takes
  `{ id: string; email: string | null }`, so the lookup only needs to fill in a real `email` where
  `web/app/embed/[token]/page.tsx` currently hardcodes `email: null`. No signature change needed
  anywhere in the feature — confirms ADR 041's own claim.
- **The RUNBOOK's secrets table** shows the pattern any new secret follows here: a row naming where it
  lives (Vercel env store, "Sensitive"), and plain-language get-it-from-here instructions. The two
  existing Supabase values are public and were deliberately moved to a committed `.env.production` —
  a service-role key must NEVER follow that path; it stays Vercel-only, Sensitive-flagged, never
  committed, never `NEXT_PUBLIC_*`.
- **The project lives under the Supabase org "stefan"** (project ref `emycswhsinjqdjhzlzmx`) — the
  RUNBOOK already documents a two-account mix-up gotcha for dashboard steps; whoever eventually
  generates the service-role key needs to check the org breadcrumb first, same as any other dashboard
  step.

**Not verified — flag for whoever builds this:** this session's environment has no installed
`node_modules` (a fresh remote checkout), so the exact Supabase Admin API method name/shape below is
stated from well-established, long-stable Supabase documentation, not confirmed against this repo's
pinned `@supabase/supabase-js@^2.113.0` types. `web/CLAUDE.md` explicitly warns against coding this
stack from memory — **verify `auth.admin.getUserById` against the installed package's own `.d.ts`
before writing real code**, exactly as ADR 041's own build sessions did for other APIs.

## Options

### Option A — a narrow service-role lookup, called live, at render time

One new server-only file (e.g. `src/billing/user-lookup.ts` or similar), exporting exactly one
function: `getUserEmailById(userId: string): Promise<string | null>`. Internally: a Supabase client
built with the service-role key (never the publishable key), calling the Admin API's user-by-id lookup,
returning `null` on any failure (not found, network error, bad id) — same fail-closed shape
`hasProPlan` already has, same shape `rerunLive`'s own `parseStoredIntent` already uses ("any shape
surprise returns null, never a bare cast"). The embed route's `hasProPlan({ id: record.userId ?? '',
email: null })` becomes `hasProPlan({ id: ..., email: await getUserEmailById(record.userId) })`.

- **No schema change, no migration.** Reads Supabase Auth's own live record — always current.
- **Naturally respects account deletion.** If a user deletes their account, the lookup returns nothing
  (or fails) automatically — no second copy of their email sitting in our own database that also needs
  purging. This matters a lot given how seriously this project already takes GDPR retention (monthly
  `gdpr:purge`, the whole redaction machinery R1-R11 sits next to).
- **Small, contained blast radius if scoped tightly:** the service-role client must be constructed
  ONLY inside this one file, and the file must export ONLY the narrow `getUserEmailById` function —
  never the raw admin client — so no future session reaches for `auth.admin.*` for something unrelated
  and accidentally bypasses RLS somewhere else. Worth a loud warning comment in the file itself, the
  way `web/lib/supabase-server.ts` already warns about its own memoization trap.
- **Costs a live network call per Live-embed render** (this route already re-runs the whole live query
  on every `?live=1` request with no page cache — ADR 041 point 12 explains why — so one more small
  call in the same request is consistent with that existing design, not a new category of cost).
- **New privileged secret** (`SUPABASE_SERVICE_ROLE_KEY`) — Vercel, Production, Sensitive, generated
  from the Supabase dashboard, owner-supervised per this project's own convention for live secret
  changes.

### Option B — a mirrored `email` column, kept in sync by a database trigger

A small `app_users` (or similar) table in our own Postgres, populated by a Postgres trigger on
Supabase's `auth.users` table (`on_auth_user_created` / `on_auth_user_updated`) — Supabase's own
commonly-documented pattern for this. The embed route would then just join against our own DB, the same
way it already reads everything else.

- **No live external call at render time** — matches this project's general instinct (principle (b):
  prefer our own database over live external reads) more closely than Option A on the surface.
- **But it's a second, hand-maintained copy of PII (an email address) that must be kept in sync
  forever**, and this project has JUST hit exactly this shape of problem elsewhere in the SAME PR:
  `isRedacted` exists as three independent hand-copies today (open-questions #227), flagged as a real,
  if small, maintainability risk. A mirrored-email table is the same pattern at a more sensitive
  level (an actual PII field, not a boolean check) — if a user changes or deletes their email in
  Supabase Auth and the trigger has a gap, our copy silently goes stale.
  - **Needs a migration** (numbered, committed — this project's standing rule for any schema change),
    and its own row in the GDPR purge sweep — one more place account-deletion handling must reach,
    not fewer.
- Overall: **more mechanism, not less**, for a feature with literally zero real users today. Doesn't
  fit "cheapest mechanism first" as well as Option A does, specifically because avoiding a live call
  here doesn't carry the same weight it does for CBS data (CBS data is queried on every single chat
  answer — the core, latency- and uptime-critical path; this lookup fires only on a Live-embed render,
  a narrow, non-critical path with a safe, correct fallback already built — frozen render — if it ever
  fails).

### Option C — defer entirely; fold it into the real #205 Pro/billing plan

ADR 041 already flags that a real Pro plan (#205, parked, not yet scoped) will need its OWN way to
resolve "this user id → is this account Pro," which is the same missing plumbing, not automatically
solved by billing existing. So whichever option above gets picked, that work will very likely be
touched again once #205 is actually scoped — possibly superseded by a fuller `customers`/subscription
table that carries email as a side effect of carrying billing status.

- **Costs nothing today.** No new secret, no new code, no new surface to maintain in the meantime.
- **Risk:** if the owner wants to demo Live to a specific person (not just himself) before #205 exists,
  this option can't serve that without being revisited anyway.

## Recommendation

**Mechanism, whenever this gets built: Option A.** It's the smaller, safer addition — no schema
change, no second PII copy, no new sync-drift risk to track, and it naturally inherits Supabase's own
account-deletion handling instead of duplicating it. Concretely, when it's time: one new ~15-20 line
server-only file, one new Vercel secret, one call-site change in the embed route replacing
`email: null`. No other code in the Embed feature changes — exactly as ADR 041's own revisit-trigger
note predicted.

**Timing: hold off, don't build it yet.** Reasoning, following this project's own standing rule
("default to the cheapest mechanism first, escalate only on measured evidence, not speculation"):

- Live embed has **zero real users today** — it's gated closed for everyone, and even once unlocked
  it only serves a manually owner-set demo allowlist (`PRO_ACCOUNT_EMAILS`), not paying customers
  (there's no real Pro plan to pay for yet, #205).
- This is the **first-ever privileged Supabase credential** this app would hold. That's worth doing
  deliberately, at the moment there's an actual reason, not speculatively.
- The real #205 Pro/billing plan will need overlapping plumbing — building this narrowly now risks
  redoing part of it once billing's actual shape is known.

**Concretely: build this the moment either becomes true** — (1) the owner wants to actually demo a
live-updating embed to someone who isn't him, or (2) #205 (real Pro/billing) gets scoped, at which
point build the user-id→email lookup as part of that work, since billing needs it too and more.
Until then, Live embed stays exactly what ADR 041 already calls it: "a demonstrated-but-dormant
capability, not a shipped one."

## If/when it's decided to build — a ready checklist

1. Verify `auth.admin.getUserById` (or current equivalent) against the installed
   `@supabase/supabase-js` types — don't assume from training data or from this doc.
2. New file, server-only, exports exactly one narrow function; never export the raw admin client.
3. New secret `SUPABASE_SERVICE_ROLE_KEY` — Vercel, Production, Sensitive; RUNBOOK gets a new row
   in the secrets table, written the way every other row there is (plain get-it-from-here steps);
   owner-supervised generation (checking the "stefan" org breadcrumb first, per the existing
   two-account gotcha).
4. One call-site change in `web/app/embed/[token]/page.tsx`: real lookup in place of `email: null`.
5. Tests: the lookup itself (found / not-found / malformed id / network failure → all fail closed to
   `null`, mirroring `parseStoredIntent`'s existing discipline), plus a regression test that Live
   actually renders live content end-to-end for a Pro row once this lands (today's suite can only
   test the fail-closed path, since nothing else is possible yet).
6. Revisit #228 (the eviction-GC blind spot) at the same time — ADR 041 already flags it as "moot
   until #224 is resolved," which is precisely this moment.
7. Update ADR 041 (not a new ADR — this is that ADR's own named revisit trigger) with the as-built
   note, and close out #224 in open-questions.md with the real mechanism and date.

## Assumptions marked

- **Assumption:** Supabase's Admin API rate limits / quotas are generous enough for demo-scale Live
  embed traffic. Not verified against current Supabase documentation in this session — worth a quick
  check at build time, not a blocker for the plan itself.
- **Assumption:** no caching layer is needed for the lookup at today's (effectively zero) traffic
  scale. If Live traffic ever becomes real, a short in-memory or short-TTL cache (same shape as the
  existing Brandfetch 30-day cache, WP218 phase 3) is a cheap addition at that point — not built
  speculatively now, per the same cheapest-mechanism-first rule.

Both should be mirrored into [open-questions.md](../open-questions.md) once this doc's home branch
and the embed-charts branch (which currently owns #224's row) are reconciled — deliberately not edited
directly here to avoid two divergent copies of the same row before PR #9 merges.
