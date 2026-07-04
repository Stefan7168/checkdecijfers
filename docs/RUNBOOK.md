# RUNBOOK — the owner's guide

Everything **Stefan** does, phase by phase. AI sessions read [CLAUDE.md](../CLAUDE.md); you read this. Like [STATUS.md](STATUS.md), this is a tracker over decisions made elsewhere — tick boxes here, change plans in the docs.

## How work happens

- **One chat session = one work package** — one or two unchecked items from [STATUS.md](STATUS.md), not a whole phase. A fresh session automatically reads CLAUDE.md and STATUS.md and knows where things stand; that is what they exist for. Phases span many sessions.
- **Start a session like this:** *"Continue checkdecijfers.nl. Read CLAUDE.md, docs/STATUS.md, and docs/08-build-plan.md, then do the next work package in the build plan. First confirm back to me: the current phase, the benchmark gate, and the work package — then wait for my go."* The whole brief for each session already lives in the build plan ([08-build-plan.md](08-build-plan.md)), so you don't have to describe the work — just point at it. The confirm-back is your check that the session oriented correctly **before** it touches anything.
- **Big work packages may be delegated:** a session can spawn implementation subagents, as long as each brief names the specific invariants at stake and the session reviews the result — "done" still means green CI, no matter who wrote the code. Don't hardcode model names in reusable prompts; they go stale.
- **Delegation cost rule (your money):** the expensive model you're chatting with does the thinking — scoping, instructions, and reviewing what comes back. The legwork it farms out runs on cheaper models. If you see a session burn budget doing easy repetitive tasks on its own top-tier model, that's a bug: point at this line (and at the same rule in [CLAUDE.md](../CLAUDE.md)).
- **End of every session:** work committed, STATUS.md updated with measured results, process lessons appended to [lessons-learned.md](lessons-learned.md). If a session claims success, the proof is a green CI run — not its word (CLAUDE.md convention).
- **You are the phase-gate backstop:** if a session proposes building something, ask "is that in the current phase?" The docs enforce it, but you can always point at [03-mvp-scope.md](03-mvp-scope.md).

## Account signup checklist

### Now — before the Phase 0 build (~30 min, all free)

- [x] **GitHub** — done 2026-07-02: repo pushed to github.com/Stefan7168/checkdecijfers (private); machine authenticated as Stefan7168. ⚠ **2026-07-03 fix:** this machine's *global* `~/.gitconfig` defaults to a work identity (`redacted-work-id <redacted-work-email>`) — 22 of this repo's first 25 commits inherited it before anyone noticed. Fixed with a **repo-local override** (`git config --local user.name/user.email`, set to `Stefan7168` / `personal-gmail-1-redacted`) plus a one-time history rewrite (`git filter-branch` + force-push) to scrub the old identity from every already-pushed commit. The local override lives only in this working directory's `.git/config` — **a fresh clone of this repo on any machine won't have it**; the first session in a new clone should re-run those two `git config --local` commands before committing, or the work identity leaks back in silently. ✅ **2026-07-03 (WP11): dependency guardrails complete, nothing left for you to toggle** — you enabled Dependabot *alerts* (vulnerability notifications) in repo settings, and the WP11 session enabled Dependabot *security updates* (automatic fix PRs) via the API; weekly version-update PRs were already configured in `.github/dependabot.yml`. Dependabot PRs show up in the repo like any other PR — the monthly maintenance session reviews them.
- [x] **Anthropic API** — account created 2026-07-02 (personal-gmail-1-redacted); key stored in local `.env`; €25 monthly spend cap confirmed set by owner (2026-07-02). ✅ **Billing alert set by owner (2026-07-04)** — an email now warns before the €25 cap silently blocks API calls. Both spend guardrails (cap + alert) are in place; if the alert ever fires unexpectedly, start a session and paste it (see "When an alert arrives" below).
- [x] **Supabase** — account created 2026-07-02, login **personal-gmail-1-redacted**, organization **"stefan"** (lowercase), project **checkdecijfers** (region eu-central-1). ⚠ A second, empty org **"Stefan7324"** also exists on this login — the project is **not** there; always pick "stefan". Nothing vendor-specific will be used (ADR [002](decisions/002-postgres-system-of-record.md)), so this stays swappable. `DATABASE_URL` stored in local `.env` (2026-07-02). ✅ **2026-07-03 Data-API lockdown (done):** the project's "Automatically expose new tables" setting was on, granting `anon`/`authenticated` full CRUD on every table via Supabase's auto-generated Data API — this app never uses that API (ADR 002/003: server-side `pg` over `DATABASE_URL` only), so it was pure unneeded attack surface (not exploitable in practice — Supabase's own RLS-auto-enable safety net had already blocked real access). Fixed on **both** layers: migration `003_lock_down_api_access.sql` revokes the grants + locks default privileges for future tables (code side), **and** the owner disabled the **entire Data API** in the dashboard — **Data API integration → Overview → "Enable Data API" → off → Save** (stronger than just the "Automatically expose new tables" sub-toggle, which is now moot because the whole `/rest/v1/` REST layer is off). Verified 2026-07-03: app's `DATABASE_URL` connection unaffected (direct Postgres via the pooler, a separate path from the REST API); security scan clean. **If the Data API is ever re-enabled** (shouldn't be needed), also turn "Automatically expose new tables" back off at that point, **and re-run a live grants/RLS check first** (WP13 adversarial review, 2026-07-04): the 2026-07-03 verification above only covered migrations 001-002's tables. WP13's four new tables (`credit_transactions`, `action_class_prices`, `credit_packs`, `signup_grant_config`, migrations 005-006) were live-checked the same day migration 003's mechanisms did generalize correctly (zero `anon`/`authenticated` grants, RLS enabled on all four — `information_schema.role_table_grants` / `pg_class.relrowsecurity`), but every *later* migration that adds a table deserves the same one-query check before ever flipping the Data API back on, rather than assuming the 2026-07-03 scan still covers a table it predates.
- [x] **Vercel** — account created 2026-07-02, login **redacted01**@gmail.com (unlike the others). ✅ **2026-07-04 (WP12): live at https://checkdecijfers.vercel.app.** CLI already logged in on the build machine (no interactive step needed), project `checkdecijfers` created and linked (`redacted-team-slug-projects/checkdecijfers`) — **deliberately with no Git integration connected** (Project → Settings → Git shows no repository; ADR [018](decisions/018-chat-ui-and-deploy.md) decision 7 — deploys happen only via the CI `deploy` job, so nothing races a red gate). Two project settings set via the API (no CLI/dashboard equivalent for the second one): **Root Directory = `web`**, and **"Include source files outside of the Root Directory" enabled** — Vercel's documented mechanism for a Next.js app living in a monorepo subdirectory that needs to reach sibling code (here, the backend `src/` this app imports via a symlink; full story in ADR 018 and [lessons-learned.md](lessons-learned.md), it took six deploy attempts to land on this). `ANTHROPIC_API_KEY`/`DATABASE_URL` are in the Vercel env store (Production). Owner created a Vercel access token (dashboard → Account Settings → Tokens) and set it as the GitHub Actions secret `VERCEL_TOKEN` directly from Terminal (`gh secret set`, never pasted in chat). Hobby tier is for non-commercial use: upgrade to Pro (~€20/mo) at Phase 2, when payments go live.
- [ ] Confirm you control the domain **checkdecijfers.nl** (working name; final naming is [open-questions](open-questions.md) #7 — the domain is not needed until pages go public).

### Phase 1 — accounts, billing & private beta

**Moved up from "Phase 2" (2026-07-04):** billing was pulled forward into Phase 1 (see [06-roadmap.md](06-roadmap.md)) because the chat is going onto a real public website page imminently. The KvK/Stripe items below used to sit under a "Phase 2" heading that implied "later" — they don't mean that anymore. Status as of 2026-07-04: **not yet started, timeline undecided** ([open-questions #54](open-questions.md)) — this is the one item on this whole list that isn't a quick account signup, so start deciding on it now even if the engineering work hasn't caught up yet.

**WP13 (2026-07-04) built and hermetically tested the code for all of this — Supabase Auth wiring, the credit ledger, pricing config, Stripe Checkout + webhook — against the live Supabase database's schema only (migrations applied, pricing seeded, both verified). Owner chose "code first, wire live accounts later" this session: nothing below was exercised live (no real magic-link email sent, no real Stripe account, no real checkout). The checklist items below are exactly what's needed to turn the code on for real — do them in order, then a session can do one focused live-verification pass.**

- [x] **Transactional email provider: Resend** (decided 2026-07-04, ADR [006](decisions/006-auth-billing-seams.md) — custom SMTP for Supabase Auth's magic-link emails; Supabase's own built-in sender is dev/test-only and rate-limited) — also carries your owner alerts (ingestion failures, quarantines, missed syncs). **Done 2026-07-04:** sending subdomain `mail.checkdecijfers.nl` (isolates bounce/reputation from the root domain via Resend's default Return-Path `send.mail.checkdecijfers.nl`; click/open tracking deliberately left off — link-rewriting tracking can break one-time magic links if a corporate mail-security scanner pre-fetches them). DNS (DKIM/SPF/MX/DMARC) added in Namecheap Advanced DNS + Mail Settings, verified live against Namecheap's authoritative nameservers. Supabase dashboard → Authentication → Emails → SMTP Settings: host `smtp.resend.com`, port 465, username `resend`, sender `noreply@mail.checkdecijfers.nl` / "checkdecijfers.nl", password = a Resend API key (Sending-access scope) — owner created the key and pasted it directly into the Supabase field himself, never through chat. "Successfully updated settings" confirmed live.
- [x] **Supabase Auth → URL Configuration**: set Site URL and add Redirect URLs for both `http://localhost:3000/auth/callback` (local dev) and the deployed app's `https://.../auth/callback` — required for the magic-link email's link to actually land back in the app (`web/app/auth/callback/route.ts`). **Done 2026-07-04:** Site URL `https://checkdecijfers.vercel.app`; both redirect URLs added and saved (confirmed "Total URLs: 2").
- [x] **Stripe test-mode account** — free, instant, no KvK needed for test mode. Once created: Dashboard → Developers → API keys (test mode) for `STRIPE_SECRET_KEY`; Dashboard → Developers → Webhooks → add endpoint (`.../api/stripe/webhook`) for `STRIPE_WEBHOOK_SECRET`. **Done 2026-07-04:** test-mode sandbox switched into; webhook destination `checkdecijfers-app` created, listening only to `checkout.session.completed` (the only event `src/billing/stripe-webhook.ts` acts on); `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` set in `web/.env.local` + Vercel production (owner pasted both values himself, never through chat). ⚠ **iDEAL deliberately NOT enabled this session** — the existing Stripe account's business address is set to Chiang Mai, Thailand (owner lives there), which Stripe won't allow to offer iDEAL regardless of test/live mode; iDEAL requires a Netherlands (or other eligible EU/EEA) account country, which routes through the same KvK blocker below. **Decision (owner, 2026-07-04): ship card-only for now** — cards process fine regardless of account country; iDEAL is a fast-follow once KvK clears (see [open-questions #54](open-questions.md)). `src/billing/stripe-checkout.ts` needs no code change either way (payment methods are never hardcoded).
- [ ] **Uptime monitor** (free tier, e.g. UptimeRobot) — tells you when the site is down.
- [ ] **Rotate `ANTHROPIC_API_KEY` at go-live/first deploy** (owner decision 2026-07-03: the pre-launch key stayed in use across the machine move, bounded by the $25/mo spend cap; going live is the agreed rotation moment) — new key into local `.env` + the Vercel env store, then delete the old key in the console.
- [ ] **KvK registration + business bank account** — required before Stripe can pay out in the Netherlands (real money; test mode above needs none of this). Start early; this is the slowest item on this list, and its timeline is still undecided ([open-questions #54](open-questions.md)).
- [ ] **Stripe live mode** with iDEAL enabled — can't flip from test to live mode until the item above is sorted; a config change (new keys), not new code.
- [ ] **Vercel: upgrade Hobby → Pro (~€20/mo)** before real payments go live — the Hobby tier's terms are for non-commercial use only; this can happen any time before go-live, it's the cheapest item on this list.

### Phase 2 — public launch (browse layer, SEO)

- [ ] **Google Search Console** — the browse layer's SEO instrumentation.
- [ ] Privacy-friendly analytics (e.g. Plausible) — optional, decide then.

## What sessions need from you (and what they never get)

- **You own every account** and its billing. Sessions never sign up for anything on your behalf.
- **CLI logins, once each:** after creating GitHub/Vercel/Supabase accounts, a session walks you through logging in their command-line tools on your machine. Sessions then work through those logins, with your per-command approval.
- **Secrets:** you create keys; a session tells you exactly where to paste them (local `.env` + the hosting platform's env store). Never in git, never in chat with third parties. Tracked in the register below.
- **Never needed:** your passwords, your email inbox, payment credentials.

## Secrets register (filled in during Phase 0 setup)

| Secret | Lives in | How to rotate (owner-followable) |
|---|---|---|
| `ANTHROPIC_API_KEY` | local `.env` + local `web/.env.local` (separate file, not a symlink — see note below) + Vercel env store (set 2026-07-04, WP12) | Anthropic console → create new key → replace in **all three** places → delete old key. ⚠ Owner decision 2026-07-03: the pre-launch key deliberately stayed in use across the machine move (the $25/mo spend cap bounds the risk) — rotation deferred to go-live/first deploy, tracked in the Phase 1 checklist above |
| `DATABASE_URL` | local `.env` + local `web/.env.local` (separate file, not a symlink — see note below) + Vercel env store (set 2026-07-04, WP12) | Supabase dashboard → reset database password → replace in **all three** places. ⚠ Use the **Session pooler** connection string (Connect → Session pooler), not the direct one: the direct host is IPv6-only and doesn't work from most home networks (verified 2026-07-02). The connection is TLS-verified against Supabase's public root certificate, committed at `config/supabase-prod-ca-2021.pem` — nothing to do at rotation, it's valid to 2031. (The deployed web app receives that same certificate as `DATABASE_CA_CERT`, baked in automatically at build time from the committed file — not a secret, nothing to set or rotate anywhere; ADR 018) |
| `VERCEL_TOKEN` | GitHub Actions repo secret only (set 2026-07-04 by owner, via Terminal — never in chat) | Vercel dashboard → Account Settings → Tokens → create a new one → `gh secret set VERCEL_TOKEN --repo Stefan7168/checkdecijfers` (paste when prompted) → delete the old token in the Vercel dashboard. Used only by the CI `deploy` job (ADR 018) |
| `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | GitHub Actions repo secrets (set 2026-07-04) | Not secret (just identifiers) — read from `web/.vercel/project.json` after `vercel link`, only changes if the Vercel project is ever recreated |
| `NEXT_PUBLIC_SUPABASE_URL` | `web/.env.local` (local dev) + **`web/.env.production`, committed to git** (production builds — moved out of the Vercel env store 2026-07-04, see note below the table) | Not secret (public project URL) — Supabase dashboard → Project Settings → API Keys → Project URL. `NEXT_PUBLIC_` vars are baked into the client bundle by Next.js at build time; that's expected here |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `web/.env.local` (local dev) + **`web/.env.production`, committed to git** (production builds — moved 2026-07-04, note below) | Not secret (Supabase's current name for what used to be called the "anon key" — rate-limited/RLS-scoped by design) — Supabase dashboard → Project Settings → API Keys → Publishable key. ⚠ The same page also shows **Secret keys** — never navigate/screenshot that page as a whole; copy only the publishable key value |
| `STRIPE_SECRET_KEY` | `web/.env.local` + Vercel env store (**not yet set — WP13, 2026-07-04, awaiting the Stripe test-mode account above**) | Real secret. Stripe Dashboard (test mode) → Developers → API keys → create/roll a **restricted key** (prefer over the full secret key — least privilege) → replace in both places → delete the old key in the Stripe dashboard |
| `STRIPE_WEBHOOK_SECRET` | `web/.env.local` + Vercel env store (**not yet set — WP13, 2026-07-04**) | Real secret. Stripe Dashboard → Developers → Webhooks → your endpoint → "Signing secret" → reveal → replace in both places. Rotating it requires updating the webhook endpoint's signing secret in the same dashboard screen |
| `NEXT_PUBLIC_APP_URL` | `web/.env.local` (`http://localhost:3000`) + **`web/.env.production`, committed to git** (`https://checkdecijfers.vercel.app` — moved 2026-07-04, note below) | Not secret — the deployed app's own origin, used to build the magic-link redirect and Stripe Checkout success/cancel URLs (`web/app/login/actions.ts`, `web/app/credits/actions.ts`) |

**Note on `NEXT_PUBLIC_*` vars and the Vercel env store (2026-07-04, production outage post-mortem):** this Vercel team enforces the **sensitive environment-variables policy** — every env var added to the project becomes write-only, no matter how it is added (dashboard or CLI; verified against the API: every var reports `type: sensitive`). Write-only is fine for real runtime secrets (`DATABASE_URL`, `ANTHROPIC_API_KEY`, `STRIPE_*` — Vercel injects them into the running functions), but it is **fatally incompatible with `NEXT_PUBLIC_*`** vars: those must be readable at *build* time, and our builds run in GitHub Actions via `vercel pull`, which receives sensitive values as **empty strings**. Result: the middleware was compiled with empty Supabase credentials and every route returned Internal Server Error — while the deploy job stayed green (a build succeeding says nothing about the app running; the CI deploy job now ends with a post-deploy smoke check for exactly this). The three public values therefore live in **`web/.env.production`, committed to git on purpose** (they ship in every browser bundle by design — same reasoning as the committed CA certificate, ADR 018). Never add a `NEXT_PUBLIC_` var to the Vercel env store expecting CI builds to see it, and never put a real secret in `web/.env.production`.

**Note on `web/.env.local`:** the chat UI (`web/`, its own fully independent npm project — ADR [018](decisions/018-chat-ui-and-deploy.md), it briefly started as an npm workspace and was split mid-session) is a separate Next.js project that loads its own env file rather than the root `.env` — it does **not** automatically see root's values. `web/.env.local` is gitignored, same as root `.env`. An earlier version of this file was a **symlink** to root `.env`, which seemed convenient but backfired the first time `vercel pull` wrote a Vercel-specific token *through* the symlink into the shared root file — fixed by making `web/.env.local` a real, independent copy. This means a key rotation (above) has **three** places to update, not two; there is no technical link keeping them in sync.

## Moving to a new machine (fresh clone bootstrap)

Everything that matters lives in this repository or in your own accounts
(GitHub, Supabase, Anthropic) — nothing project-critical is tied to any one
computer or any one Claude account. A new machine needs, in order:

1. **Install** (one-time): [Node.js](https://nodejs.org) **24 or newer**
   (`node --version` to check — the project requires ≥24), git,
   [Claude Code](https://claude.com/claude-code), and the GitHub CLI
   (`gh`). The CLI is not optional in practice: the repo is private, and
   `gh auth login` (step 2) is what gives git the credentials the clone
   in step 3 needs (measured on the 2026-07-03 bootstrap — the clone
   worked *because* gh was signed in). It also lets you watch CI from
   the terminal.
2. **Sign in**: GitHub (your `Stefan7168` account — `gh auth login` walks you
   through it in the browser) and Claude Code (your Claude account).
3. **Clone and verify — no secrets needed for this step:**
   ```
   git clone https://github.com/Stefan7168/checkdecijfers.git
   cd checkdecijfers
   npm ci
   npm --prefix web ci
   npm run typecheck && npm test
   npm run web:typecheck && npm run web:test
   ```
   (The second `ci` and the `web:*` lines cover the chat UI, which since WP12
   is its own independent npm project with its own lockfile — the root
   install does not cover it. ADR 018.)
   The whole test suite is hermetic (embedded database, recorded LLM
   fixtures), so a green run here proves the clone is complete and healthy
   before any key exists on the machine.
   Two harmless things you may see (both observed on the 2026-07-03
   bootstrap): `npm ci` warns about install scripts it did not run
   (esbuild, fsevents) — expected, the suite runs green without approving
   them; and the very first run is the slowest (everything compiles
   cold). The bootstrap's single first-run test failure was later
   root-caused (same day, WP8) to vitest's 10s *hook* timeout on the
   suites that boot the embedded database — fixed in `vitest.config.ts`
   (`hookTimeout: 30_000`). If a single test still fails on a first run,
   run `npm test` again before concluding anything is broken.
4. **Set the git identity for this clone** — it does NOT come along with a
   clone, and a machine's global default may be a different (work) identity:
   ```
   git config user.name "Stefan7168"
   git config user.email "personal-gmail-1-redacted"
   ```
   (Check with `git config user.email` before the first commit from a new
   machine — a wrong identity on a commit is annoying to fix after pushing.)
5. **Recreate `.env`** from `.env.example`, following the Secrets register
   above. Prefer **rotation over copying**: create a fresh Anthropic API key
   in the console (and confirm the monthly spend cap is set on that
   workspace), and fetch the `DATABASE_URL` from the Supabase dashboard
   (Connect → **Session pooler**). Then deactivate the old machine's key in
   the Anthropic console. (Or decide explicitly to keep the same key and
   record that in the secrets register — done for the 2026-07-03 move:
   rotation deferred to go-live, see the Phase 1 checklist.) Only the
   live-data scripts need `.env`
   (`db:migrate`, `ingest`, `registry:apply`, `intent:eval`/`record`,
   `answer:eval`/`record`) — day-to-day building and CI do not.
   **Creating the file on a Mac:** duplicate `.env.example` in Finder and
   rename the copy to exactly `.env` — a duplicate stays plain text. Do
   NOT write it as a new TextEdit document: TextEdit's default rich-text
   format silently saves `.env.rtf`, with formatting codes wrapped around
   the values, which nothing can read (happened on the 2026-07-03
   bootstrap; the session had to detect, convert and clean it). Dot-files
   are hidden in Finder — Cmd+Shift+. shows them. Once the values are in,
   ask a session to verify: it can live-test both credentials without
   ever displaying them (Anthropic's model-list endpoint costs nothing;
   the database check is a `select 1` through the pinned-CA client).
6. **New Claude account?** Claude Code's login (subscription) and the
   project's `ANTHROPIC_API_KEY` (console.anthropic.com) are independent —
   switching Claude accounts does not invalidate the project key. Chat
   history does not transfer, and is not needed: this repo's docs are the
   source of truth by design. Kick off exactly like any session:
   *"Continue checkdecijfers.nl. Read CLAUDE.md, docs/STATUS.md and
   docs/08-build-plan.md, then do the next work package."*
7. **Not in git, by design:** `.env` (recreate per step 5), `web/.env.local`
   (same two values, copied — not symlinked, see the secrets register note
   above; only needed to run the chat UI locally with `npm run web:dev`) and
   the local `Archive/` folder (competitor-research reference material — copy
   it over manually if you still want it, or let it go; nothing in the build
   depends on it).

## Your recurring duties

- **Sign-offs** at the gates in [STATUS.md](STATUS.md).
- **Monthly maintenance session** — start a chat with: *"Run the monthly maintenance session for checkdecijfers.nl per CLAUDE.md."* Agenda: dependency alerts, provider deprecation notices, spend dashboards, backup status.
- **When an alert arrives** (ingestion failure, quarantine, downtime): start a session and paste the alert. Nothing more is expected of you technically.
- **Phase 1:** recruit the 10–25 beta journalists — outreach only you can do.
- **Phase 2:** the legal/business items (KvK, Stripe onboarding, terms incl. "credits verlopen nooit" wording, privacy policy review).

## The path from today

1. **Doc sign-off** — the open checkbox in [STATUS.md](STATUS.md).
2. **Create the four "Now" accounts** above.
3. **Fresh chat — Phase 0, session 1:** CI skeleton + validate the candidate CBS table IDs (open-questions #1). *(Repo already on GitHub, 2026-07-02.)*
4. Session by session down the [STATUS.md](STATUS.md) Phase 0 checklist, until the benchmark run and the gate decision.
5. Gate passed → Phase 1 per [06-roadmap.md](06-roadmap.md); this runbook's Phase 1 checklist activates.
