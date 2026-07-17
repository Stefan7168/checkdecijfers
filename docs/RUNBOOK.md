# RUNBOOK — the owner's guide

Everything **Stefan** does, phase by phase. AI sessions read [CLAUDE.md](../CLAUDE.md); you read this. Like [STATUS.md](STATUS.md), this is a tracker over decisions made elsewhere — tick boxes here, change plans in the docs.

## How work happens

- **One chat session = one work package** — one or two unchecked items from [STATUS.md](STATUS.md), not a whole phase. A fresh session automatically reads CLAUDE.md and STATUS.md and knows where things stand; that is what they exist for. Phases span many sessions.
- **Start a session like this:** *"Continue checkdecijfers.nl. Read CLAUDE.md, docs/STATUS.md, and docs/08-build-plan.md, then do the next work package in the build plan. First confirm back to me: the current phase, the benchmark gate, and the work package — then wait for my go."* The whole brief for each session already lives in the build plan ([08-build-plan.md](08-build-plan.md)), so you don't have to describe the work — just point at it. The confirm-back is your check that the session oriented correctly **before** it touches anything.
- **Big work packages may be delegated:** a session can spawn implementation subagents, as long as each brief names the specific invariants at stake and the session reviews the result — "done" still means green CI, no matter who wrote the code. Don't hardcode model names in reusable prompts; they go stale.
- **Delegation cost rule (your money):** the expensive model you're chatting with does the thinking — scoping, instructions, and reviewing what comes back. The legwork it farms out runs on cheaper models. If you see a session burn budget doing easy repetitive tasks on its own top-tier model, that's a bug: point at this line (and at the same rule in [CLAUDE.md](../CLAUDE.md)).
- **End of every session:** work committed, STATUS.md updated with measured results, process lessons appended to [lessons-learned.md](lessons-learned.md). If a session claims success, the proof is a green CI run — not its word (CLAUDE.md convention).
- **⚠ Largely historical since 2026-07-11: the repo is PUBLIC (open-questions #126) — Actions minutes are unlimited/free on standard runners, so the minutes-exhaustion cause below cannot recur while it stays public. Keep this entry: it applies again the day the repo returns to private.** **CI red that is NOT code — the GitHub Actions billing block (first seen 2026-07-08):** if a gate job fails within seconds showing **0 steps** and the annotation *"The job was not started because recent account payments have failed or your spending limit needs to be increased"*, no code ever ran — it's your GitHub account's Actions billing (account-wide: it hit both your repos the same day). Fix: github.com → Settings → **Billing & plans** → resolve the payment / raise the spending limit, then re-run the failed checks (`gh run rerun <run-id>`, or ask the session to re-push). A session seeing this must say "billing-blocked, code unproven on CI" — never claim the gate passed on local runs alone. **Verify the fix actually landed (learned 2026-07-09 — a "fixed" that wasn't):** rerun one check and watch the duration — a real gate run takes minutes; another seconds-long 0-step failure means the block is still active. The four usual causes, in order: you were logged into the wrong GitHub account (this repo's Actions bill belongs to **Stefan7168**, not the work account); the outstanding failed payment was never explicitly retried (look for the "Retry payment"/"Pay now" banner on Billing & plans — a new card alone does not clear it); the Actions **spending limit** stands at $0; or — **the actual cause when this hit us (resolved 2026-07-09)** — the monthly **included Actions minutes were simply used up** on this private repo, which the annotation's wording never names: buying a plan (now 3,000 included min/month) lifted the block immediately, confirmed by the duration signal on the first rerun. Ongoing duty: a full gate run costs ~8–10 minutes, usage stood at ~2,000/3,000 on purchase day — **check the Actions minutes meter in the monthly maintenance session** so the block never surprises mid-build again.
- **You are the phase-gate backstop:** if a session proposes building something, ask "is that in the current phase?" The docs enforce it, but you can always point at [03-mvp-scope.md](03-mvp-scope.md).

## Account signup checklist

### Now — before the Phase 0 build (~30 min, all free)

- [x] **GitHub** — done 2026-07-02: repo pushed to github.com/Stefan7168/checkdecijfers (private); machine authenticated as Stefan7168. ⚠ **2026-07-03 fix:** this machine's *global* `~/.gitconfig` defaults to a WORK identity (redacted here per [#132](open-questions.md) — the repo is public now) — 22 of this repo's first 25 commits inherited it before anyone noticed. Fixed with a **repo-local override** (`git config --local user.name/user.email`, set to `Stefan7168` / the GitHub noreply address below) plus a one-time history rewrite + force-push to scrub the old identity from every already-pushed commit. The local override lives only in this working directory's `.git/config` — **a fresh clone of this repo on any machine won't have it**; the first session in a new clone should re-run those two `git config --local` commands before committing, or the work identity leaks back in silently. ✅ **2026-07-03 (WP11): dependency guardrails complete, nothing left for you to toggle** — you enabled Dependabot *alerts* (vulnerability notifications) in repo settings, and the WP11 session enabled Dependabot *security updates* (automatic fix PRs) via the API; weekly version-update PRs were already configured in `.github/dependabot.yml`. Dependabot PRs show up in the repo like any other PR — the monthly maintenance session reviews them.
- [x] **Anthropic API** — account created 2026-07-02 (personal gmail #1, see the redaction note under Provider logins); key stored in local `.env`; €25 monthly spend cap confirmed set by owner (2026-07-02). ✅ **Billing alert set by owner (2026-07-04)** — an email now warns before the €25 cap silently blocks API calls. Both spend guardrails (cap + alert) are in place; if the alert ever fires unexpectedly, start a session and paste it (see "When an alert arrives" below).
- [x] **Supabase** — account created 2026-07-02, login **personal gmail #1**, organization **"stefan"** (lowercase), project **checkdecijfers** (region eu-central-1). ⚠ A second, empty org **"Stefan7324"** also exists on this login — the project is **not** there; always pick "stefan". Nothing vendor-specific will be used (ADR [002](decisions/002-postgres-system-of-record.md)), so this stays swappable. `DATABASE_URL` stored in local `.env` (2026-07-02). ✅ **2026-07-03 Data-API lockdown (done):** the project's "Automatically expose new tables" setting was on, granting `anon`/`authenticated` full CRUD on every table via Supabase's auto-generated Data API — this app never uses that API (ADR 002/003: server-side `pg` over `DATABASE_URL` only), so it was pure unneeded attack surface (not exploitable in practice — Supabase's own RLS-auto-enable safety net had already blocked real access). Fixed on **both** layers: migration `003_lock_down_api_access.sql` revokes the grants + locks default privileges for future tables (code side), **and** the owner disabled the **entire Data API** in the dashboard — **Data API integration → Overview → "Enable Data API" → off → Save** (stronger than just the "Automatically expose new tables" sub-toggle, which is now moot because the whole `/rest/v1/` REST layer is off). Verified 2026-07-03: app's `DATABASE_URL` connection unaffected (direct Postgres via the pooler, a separate path from the REST API); security scan clean. **If the Data API is ever re-enabled** (shouldn't be needed), also turn "Automatically expose new tables" back off at that point, **and re-run a live grants/RLS check first** (WP13 adversarial review, 2026-07-04): the 2026-07-03 verification above only covered migrations 001-002's tables. WP13's four new tables (`credit_transactions`, `action_class_prices`, `credit_packs`, `signup_grant_config`, migrations 005-006) were live-checked the same day migration 003's mechanisms did generalize correctly (zero `anon`/`authenticated` grants, RLS enabled on all four — `information_schema.role_table_grants` / `pg_class.relrowsecurity`), but every *later* migration that adds a table deserves the same one-query check before ever flipping the Data API back on, rather than assuming the 2026-07-03 scan still covers a table it predates.
- [x] **Vercel** — account created 2026-07-02, login **personal gmail #2** (a DIFFERENT address than the others). ✅ **2026-07-04 (WP12): live at https://checkdecijfers.vercel.app.** CLI already logged in on the build machine (no interactive step needed), project `checkdecijfers` created and linked (team slug redacted per #132 — `vercel link` resolves it) — **deliberately with no Git integration connected** (Project → Settings → Git shows no repository; ADR [018](decisions/018-chat-ui-and-deploy.md) decision 7 — deploys happen only via the CI `deploy` job, so nothing races a red gate). **⚠ DRIFT FLAGGED 2026-07-10 (session 32): a Vercel GitHub integration IS now active on the repo** — every commit/PR gets a "Vercel" status + preview build (all currently FAILING, incl. on green-deployed main commits; the Actions `deploy` job remains the real, working deploy path). Failing is accidentally safe, but a SUCCEEDING git-integration build on main would deploy production OUTSIDE the gate — exactly what decision 7 forbids. **Owner action: Vercel dashboard → project `checkdecijfers` → Settings → Git → disconnect the repository** (or explicitly re-decide ADR 018 d7). The session's Vercel MCP token cannot reach this team scope (403), so this cannot be automated from a session. **Owner initiated the disconnect at session-32 close (2026-07-10, the "Remove Git Connection" dialog — settings/env preserved; the CI deploy job is unaffected since it uses VERCEL_TOKEN+CLI, not the Git link). VERIFY on the next PR: no "Vercel" statuses should appear; if they do, the disconnect didn't land — redo it.** Two project settings set via the API (no CLI/dashboard equivalent for the second one): **Root Directory = `web`**, and **"Include source files outside of the Root Directory" enabled** — Vercel's documented mechanism for a Next.js app living in a monorepo subdirectory that needs to reach sibling code (here, the backend `src/` this app imports via a symlink; full story in ADR 018 and [lessons-learned.md](lessons-learned.md), it took six deploy attempts to land on this). `ANTHROPIC_API_KEY`/`DATABASE_URL` are in the Vercel env store (Production). Owner created a Vercel access token (dashboard → Account Settings → Tokens) and set it as the GitHub Actions secret `VERCEL_TOKEN` directly from Terminal (`gh secret set`, never pasted in chat). Hobby tier is for non-commercial use: upgrade to Pro (~€20/mo) at Phase 2, when payments go live.
- [ ] Confirm you control the domain **checkdecijfers.nl** (working name; final naming is [open-questions](open-questions.md) #7 — the domain is not needed until pages go public).

### Phase 1 — accounts, billing & private beta

**Moved up from "Phase 2" (2026-07-04):** billing was pulled forward into Phase 1 (see [06-roadmap.md](06-roadmap.md)) because the chat is going onto a real public website page imminently. The KvK/Stripe items below used to sit under a "Phase 2" heading that implied "later" — they don't mean that anymore. Status as of 2026-07-04: **not yet started, timeline undecided** ([open-questions #54](open-questions.md)) — this is the one item on this whole list that isn't a quick account signup, so start deciding on it now even if the engineering work hasn't caught up yet.

**WP13 (2026-07-04) built and hermetically tested the code for all of this — Supabase Auth wiring, the credit ledger, pricing config, Stripe Checkout + webhook — against the live Supabase database's schema only (migrations applied, pricing seeded, both verified). Owner chose "code first, wire live accounts later" this session: nothing below was exercised live (no real magic-link email sent, no real Stripe account, no real checkout). The checklist items below are exactly what's needed to turn the code on for real — do them in order, then a session can do one focused live-verification pass.**

- [x] **Transactional email provider: Resend** (decided 2026-07-04, ADR [006](decisions/006-auth-billing-seams.md) — custom SMTP for Supabase Auth's magic-link emails; Supabase's own built-in sender is dev/test-only and rate-limited) — also carries your owner alerts (ingestion failures, quarantines, missed syncs). **Done 2026-07-04:** sending subdomain `mail.checkdecijfers.nl` (isolates bounce/reputation from the root domain via Resend's default Return-Path `send.mail.checkdecijfers.nl`; click/open tracking deliberately left off — link-rewriting tracking can break one-time magic links if a corporate mail-security scanner pre-fetches them). DNS (DKIM/SPF/MX/DMARC) added in Namecheap Advanced DNS + Mail Settings, verified live against Namecheap's authoritative nameservers. Supabase dashboard → Authentication → Emails → SMTP Settings: host `smtp.resend.com`, port 465, username `resend`, sender `noreply@mail.checkdecijfers.nl` / "checkdecijfers.nl", password = a Resend API key (Sending-access scope) — owner created the key and pasted it directly into the Supabase field himself, never through chat. "Successfully updated settings" confirmed live.
- [x] **Supabase Auth → URL Configuration**: set Site URL and add Redirect URLs for both `http://localhost:3000/auth/callback` (local dev) and the deployed app's `https://.../auth/callback` — required for the magic-link email's link to actually land back in the app (`web/app/auth/callback/route.ts`). **Done 2026-07-04:** Site URL `https://checkdecijfers.vercel.app`; both redirect URLs added and saved (confirmed "Total URLs: 2").
- [x] **Stripe test-mode account** — free, instant, no KvK needed for test mode. Once created: Dashboard → Developers → API keys (test mode) for `STRIPE_SECRET_KEY`; Dashboard → Developers → Webhooks → add endpoint (`.../api/stripe/webhook`) for `STRIPE_WEBHOOK_SECRET`. **Done 2026-07-04:** test-mode sandbox switched into; webhook destination `checkdecijfers-app` created, listening only to `checkout.session.completed` (the only event `src/billing/stripe-webhook.ts` acts on); `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` set in `web/.env.local` + Vercel production (owner pasted both values himself, never through chat). ⚠ **iDEAL deliberately NOT enabled this session** — the existing Stripe account's business address is set to Chiang Mai, Thailand (owner lives there), which Stripe won't allow to offer iDEAL regardless of test/live mode; iDEAL requires a Netherlands (or other eligible EU/EEA) account country, which routes through the same KvK blocker below. **Decision (owner, 2026-07-04): ship card-only for now** — cards process fine regardless of account country; iDEAL is a fast-follow once KvK clears (see [open-questions #54](open-questions.md)). `src/billing/stripe-checkout.ts` needs no code change either way (payment methods are never hardcoded).
  - **Correction (2026-07-05, session 18/20, first real test purchase):** the note above was wrong about *where* — `STRIPE_SECRET_KEY` actually creates checkout sessions under a separate Stripe **Sandbox** ("GlaiBaan sandbox", a distinct account ID, `acct_1TpJfCATKgdSn8Uc`) nested under the same login, not under the "Check de Cijfers" Test-mode account (`acct_1TpJevAS07S6LQh2`) where the webhook above was actually configured. Real payments always succeeded there (confirmed: `POST /v1/checkout/sessions` 200s in that sandbox's own API logs) but zero webhook ever fired, because no webhook destination existed in that sandbox at all — credits silently never landed regardless of how many times a purchase was completed. **Fixed:** a new webhook destination (`checkdecijfers-webhook`, same URL, same single event) created inside **GlaiBaan sandbox** itself; `STRIPE_WEBHOOK_SECRET` in Vercel replaced with that destination's signing secret (marked Sensitive); a fresh production deploy picked it up (env vars are baked in at deploy time, a dashboard edit alone does nothing until redeployed). **Verified end-to-end live**: a real test purchase produced ledger row `id=22`, `reason='purchase'`, `delta=+200`, its `stripe_checkout_session_id` matching the actual completed session — the first successful `purchase` row this ledger has ever recorded. **If a second Stripe Sandbox/account ever appears again**, check which one `STRIPE_SECRET_KEY` actually posts to (via that account's own Workbench → Logs, not just "does a webhook look configured somewhere") before assuming the webhook is broken — the webhook can be perfectly correct and still never fire if it lives in the wrong account.
- [ ] **Uptime monitor** (free tier, e.g. UptimeRobot) — tells you when the site is down.
- [ ] **Rotate `ANTHROPIC_API_KEY` at go-live/first deploy** (owner decision 2026-07-03: the pre-launch key stayed in use across the machine move, bounded by the $25/mo spend cap; going live is the agreed rotation moment) — new key into local `.env` + the Vercel env store, then delete the old key in the console.
- [ ] **KvK registration + business bank account** — required before Stripe can pay out in the Netherlands (real money; test mode above needs none of this). **Timing decided (Stefan, 2026-07-04, session 18): starts only when the website is completely finished — deliberately parked, not "start early." Sessions: do not raise this as a next step or blocker until Stefan says the site is done** ([open-questions #54](open-questions.md)).
- [ ] **Stripe live mode** with iDEAL enabled — can't flip from test to live mode until the item above is sorted; a config change (new keys), not new code. **⚠ GATE before enabling any DELAYED-notification payment method (SEPA Direct Debit, Bacs/ACH, bank transfer, vouchers — NOT card or iDEAL, both of which settle synchronously): the webhook (`src/billing/stripe-webhook.ts`) currently credits on `checkout.session.completed` with NO `payment_status` check and subscribes to no async settlement event, so it would credit a payment that hasn't settled and can still fail ([open-questions #146](open-questions.md), session-47 hunt). Enabling such a method is "just a Dashboard toggle, no code" — which is exactly the trap. BEFORE flipping one on: (1) in `handleStripeEvent` only credit when `session.payment_status === 'paid'`; (2) subscribe the webhook destination to `checkout.session.async_payment_succeeded` (credit then) + `checkout.session.async_payment_failed` (no-op/log). Dormant + safe today because the account is card-only.**
- [ ] **Vercel: upgrade Hobby → Pro (~€20/mo)** before real payments go live — the Hobby tier's terms are for non-commercial use only; this can happen any time before go-live, it's the cheapest item on this list.

### Phase 2 — public launch (browse layer, SEO)

- [ ] **Google Search Console** — the browse layer's SEO instrumentation.
- [ ] Privacy-friendly analytics (e.g. Plausible) — optional, decide then.

## What sessions need from you (and what they never get)

- **You own every account** and its billing. Sessions never sign up for anything on your behalf.
- **CLI logins, once each:** after creating GitHub/Vercel/Supabase accounts, a session walks you through logging in their command-line tools on your machine. Sessions then work through those logins, with your per-command approval.
- **Secrets:** you create keys; a session tells you exactly where to paste them (local `.env` + the hosting platform's env store). Never in git, never in chat with third parties. Tracked in the register below.
- **Never needed:** your passwords, your email inbox, payment credentials.

## Provider logins (which account owns what — for dashboard access + secret rotation)

A fresh machine needs to know which login owns each provider to rotate a secret or read a dashboard. The four core ones are recorded in the checklist above; **three are NOT yet written down and only the owner can supply them — fill these in before/at the machine switch:**

**Redaction note ([#132](open-questions.md), 2026-07-12 — the repo is PUBLIC since #126):** personal e-mail addresses are redacted to **"personal gmail #1"** (GitHub, Anthropic, Supabase) and **"personal gmail #2"** (Vercel — the one that differs). The owner knows which is which; a session that needs the literal address asks the owner in-chat, never writes it into the repo.

| Provider | Login | Notes |
|---|---|---|
| GitHub | `Stefan7168` / personal gmail #1 | repo owner; other gh accounts 404 on repo-admin actions |
| Anthropic (API) | personal gmail #1 | console.anthropic.com; €25/mo cap + alert set |
| Supabase | personal gmail #1, org **"stefan"** | ⚠ a second empty org "Stefan7324" exists on this login AND a second Supabase account (glaibaan) is often the browser's active session — always confirm org "stefan" |
| Vercel | personal gmail #2 | **different email from the others**; project `checkdecijfers` |
| **Resend** | ⚠ **NOT RECORDED — owner to fill in** | transactional email (magic-link SMTP + onboarding notifies); dashboard at resend.com |
| **Stripe** | ⚠ **NOT RECORDED — owner to fill in** | test-mode; the key posts to the "GlaiBaan sandbox" (`acct_1TpJfCATKgdSn8Uc`) nested under this login — record the login email |
| **Namecheap** (domain/DNS) | ⚠ **NOT RECORDED — owner to fill in** | holds `checkdecijfers.nl` DNS (Resend DKIM/SPF/MX/DMARC records) |

## Secrets register (filled in during Phase 0 setup)

| Secret | Lives in | How to rotate (owner-followable) |
|---|---|---|
| `ANTHROPIC_API_KEY` | root `.env` (live-data scripts) + Vercel env store (production, set 2026-07-04, WP12). ⚠ NOT in `web/.env.local` (verified 2026-07-11 — that file carries only the three `NEXT_PUBLIC_*` values); add it there too ONLY if you run the chat UI's full answer pipeline locally, since `next dev` reads `web/.env.local`, not root `.env` | Anthropic console → create new key → replace in **both** stores (root `.env` + Vercel; and `web/.env.local` too if you added it there) → delete old key. ⚠ Owner decision 2026-07-03: the pre-launch key deliberately stayed in use across the machine move (the $25/mo spend cap bounds the risk) — rotation deferred to go-live/first deploy, tracked in the Phase 1 checklist above |
| `DATABASE_URL` | root `.env` (live-data scripts) + Vercel env store (production, set 2026-07-04, WP12). ⚠ NOT in `web/.env.local` (verified 2026-07-11 — same as ANTHROPIC_API_KEY above; add there only for local full-pipeline web dev) | Supabase dashboard → reset database password → replace in **both** stores (root `.env` + Vercel; and `web/.env.local` too if you added it there). ⚠ Use the **Session pooler** connection string (Connect → Session pooler), not the direct one: the direct host is IPv6-only and doesn't work from most home networks (verified 2026-07-02). The connection is TLS-verified against Supabase's public root certificate, committed at `config/supabase-prod-ca-2021.pem` — nothing to do at rotation, it's valid to 2031. (The deployed web app receives that same certificate as `DATABASE_CA_CERT`, baked in automatically at build time from the committed file — not a secret, nothing to set or rotate anywhere; ADR 018) |
| `VERCEL_TOKEN` | GitHub Actions repo secret only (set 2026-07-04 by owner, via Terminal — never in chat) | Vercel dashboard → Account Settings → Tokens → create a new one → `gh secret set VERCEL_TOKEN --repo Stefan7168/checkdecijfers` (paste when prompted) → delete the old token in the Vercel dashboard. Used only by the CI `deploy` job (ADR 018) |
| `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | GitHub Actions repo secrets (set 2026-07-04) | Not secret (just identifiers) — read from `web/.vercel/project.json` after `vercel link`, only changes if the Vercel project is ever recreated |
| `NEXT_PUBLIC_SUPABASE_URL` | `web/.env.local` (local dev) + **`web/.env.production`, committed to git** (production builds — moved out of the Vercel env store 2026-07-04, see note below the table) | Not secret (public project URL) — Supabase dashboard → Project Settings → API Keys → Project URL. `NEXT_PUBLIC_` vars are baked into the client bundle by Next.js at build time; that's expected here |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `web/.env.local` (local dev) + **`web/.env.production`, committed to git** (production builds — moved 2026-07-04, note below) | Not secret (Supabase's current name for what used to be called the "anon key" — rate-limited/RLS-scoped by design) — Supabase dashboard → Project Settings → API Keys → Publishable key. ⚠ The same page also shows **Secret keys** — never navigate/screenshot that page as a whole; copy only the publishable key value |
| `STRIPE_SECRET_KEY` | `web/.env.local` + Vercel env store (**set 2026-07-04** — this row lagged the actual state; see the correction note above about which Stripe Sandbox this key actually belongs to, "GlaiBaan sandbox", not the "Check de Cijfers" Test-mode account) | Real secret. Stripe Dashboard (test mode) → Developers → API keys → create/roll a **restricted key** (prefer over the full secret key — least privilege) → replace in both places → delete the old key in the Stripe dashboard |
| `STRIPE_WEBHOOK_SECRET` | Vercel env store (**set 2026-07-05, marked Sensitive** — replaced once already, see the correction note above: the original destination lived in the wrong account and never fired) | Real secret. Stripe Dashboard → the correct account/sandbox (the one `STRIPE_SECRET_KEY` actually posts to — verify via that account's own Workbench → Logs before assuming) → Developers → Webhooks → your endpoint → "Signing secret" → reveal → replace in Vercel. A dashboard-only edit does nothing until the next deploy |
| `NEXT_PUBLIC_APP_URL` | `web/.env.local` (`http://localhost:3000`) + **`web/.env.production`, committed to git** (`https://checkdecijfers.vercel.app` — moved 2026-07-04, note below) | Not secret — the deployed app's own origin, used to build the magic-link redirect and Stripe Checkout success/cancel URLs (`web/app/login/actions.ts`, `web/app/credits/actions.ts`) |
| `CRON_SECRET` | Vercel env store only (**✅ SET 2026-07-06, Production, marked Sensitive — WP16 go-live, session 28**) | Real secret you invent yourself: any long random string (password-manager generator). Vercel automatically sends it in the `Authorization` header of its cron requests; the onboarding cron route (`web/app/api/onboarding-cron/route.ts`) returns 503 when the var is missing and 401 on a wrong value — fail closed either way. Rotation: generate a new string → replace in Vercel → redeploy; no third party involved |
| `RESEND_API_KEY` | Vercel env store only (**✅ SET 2026-07-06, Production, marked Sensitive — WP16 go-live, session 28; key "checkdecijfers-data-retrieved", Sending scope, separate from the Supabase SMTP key**) | Real secret. Resend dashboard → API Keys → create a key with **Sending access** scope → paste into Vercel (mark Sensitive) → redeploy. This is a SECOND key, separate from the one pasted into Supabase's SMTP settings (that one sends magic-link emails; this one lets the app itself send "je tabel is klaar" onboarding notifications). Without it the app still works — notification emails are skipped with a log line; the dashboard stays the source of truth |
| `ONBOARDING_ENABLED` | Vercel env store only (**✅ SET `1` 2026-07-06, Production — the WP16 master switch, WP16 go-live session 28**) | Not secret — the literal value `1`, now LIVE. While set, on-demand fetch is active. **Removing it is the instant kill-switch** — the deployed app then never constructs the table finder and behaves exactly as before WP16 sub-part 2 (the honest clarification), no rerank spend, no touch of the migration-012 tables, no code change needed. (Owner marked it Sensitive at set time — harmless; the value `1` is just hidden in the UI.) |
| `ANTHROPIC_TRIAL_API_KEY` | Vercel env store only (**✅ SET 2026-07-17 by the owner, Production, Sensitive — #53 go-live, session 52; key lives in its own Anthropic workspace with its own hard spend cap**) | Real secret, and deliberately a SEPARATE key from `ANTHROPIC_API_KEY`: Anthropic console → create a key **with its own hard spend cap** (the trial's outer belt — abuse can never touch the main budget) → paste into Vercel (mark Sensitive) → redeploy. Rotation: same as `ANTHROPIC_API_KEY` but only the Vercel store. Removing it (or `TRIAL_ENABLED`) is the trial's kill-switch — the homepage section disappears, nothing else changes |
| `TRIAL_IP_HASH_SECRET` | Vercel env store only (**✅ SET 2026-07-17, Production — #53 go-live, session 52; generated and piped straight into `vercel env add`, value never displayed anywhere**) | Real secret you invent yourself (password-manager generator, long random string). Used ONLY to HMAC visitor IPs for the per-IP trial limit — raw IPs never persist. Rotation: replace in Vercel + redeploy; consequence is benign (per-IP counts restart) |
| `TRIAL_ENABLED` | Vercel env store only (**✅ SET `1` 2026-07-17, Production — #53 go-live, session 52**) | Not secret — the literal value `1`. The trial master switch: while unset the whole homepage trial renders NOTHING (dormant, byte-identical landing). **Removing it is the instant kill-switch** |

**Note on `NEXT_PUBLIC_*` vars and the Vercel env store (2026-07-04, production outage post-mortem):** this Vercel team enforces the **sensitive environment-variables policy** — every env var added to the project becomes write-only, no matter how it is added (dashboard or CLI; verified against the API: every var reports `type: sensitive`). Write-only is fine for real runtime secrets (`DATABASE_URL`, `ANTHROPIC_API_KEY`, `STRIPE_*` — Vercel injects them into the running functions), but it is **fatally incompatible with `NEXT_PUBLIC_*`** vars: those must be readable at *build* time, and our builds run in GitHub Actions via `vercel pull`, which receives sensitive values as **empty strings**. Result: the middleware was compiled with empty Supabase credentials and every route returned Internal Server Error — while the deploy job stayed green (a build succeeding says nothing about the app running; the CI deploy job now ends with a post-deploy smoke check for exactly this). The three public values therefore live in **`web/.env.production`, committed to git on purpose** (they ship in every browser bundle by design — same reasoning as the committed CA certificate, ADR 018). Never add a `NEXT_PUBLIC_` var to the Vercel env store expecting CI builds to see it, and never put a real secret in `web/.env.production`.

**Note on `web/.env.local`:** the chat UI (`web/`, its own fully independent npm project — ADR [018](decisions/018-chat-ui-and-deploy.md), it briefly started as an npm workspace and was split mid-session) is a separate Next.js project that loads its own env file rather than the root `.env` — it does **not** automatically see root's values. `web/.env.local` is gitignored, same as root `.env`. An earlier version of this file was a **symlink** to root `.env`, which seemed convenient but backfired the first time `vercel pull` wrote a Vercel-specific token *through* the symlink into the shared root file — fixed by making `web/.env.local` a real, independent copy. Which secret lives where is per-row above — do NOT assume "all three": as of 2026-07-11 (verified) `web/.env.local` holds ONLY the three `NEXT_PUBLIC_*` values; `ANTHROPIC_API_KEY` and `DATABASE_URL` live in root `.env` + Vercel (two places), and only need to be added to `web/.env.local` if you run the chat UI's full answer pipeline locally. There is no technical link keeping any of these in sync — follow the per-secret "Lives in" column at rotation time.

## Route B drill (#132) — TWO-PHASE, reversible: rename-private first, delete only weeks later

**Why:** GitHub permanently serves the pre-rewrite history via read-only `refs/pull/N/head` refs
(measured: delete AND overwrite pushes are rejected, "deny updating a hidden ref"; official docs
confirm only GitHub Support — or removing the repo — clears them). **Upgraded after the owner's
pre-mortem request (2026-07-12): NOTHING is destroyed on day one.** Phase 1 renames the old repo
to `checkdecijfers-pre-rewrite-archief` and flips it PRIVATE — the PII is off the public internet
the moment that lands, while everything still exists as rollback. A new public repo under the
original name then takes over (research-verified: a new repo takes priority over the rename
redirect — GitHub docs + community, links in #132). Phase 2 (a LATER maintenance session, after
the new repo is proven) deletes the private archive — the only irreversible step, deliberately
weeks away. **Rollback at any point in phase 1 (~2 min): delete the new repo, rename the archive
back, flip public — the exact pre-operation state returns (the redirect resurfaces on deletion,
which is why the archive must eventually go or stay private forever).**

**Pre-mortem results (2026-07-12, all measured read-only):** forks 0 / stars 0 (RE-CHECK at
T-0 — a fork would keep the old history alive publicly and route B would NOT help); branch
protection none, rulesets 0, deploy keys 0, webhooks 0, issues 0, collaborators 1; the two
GitHub "environments" (Preview/Production) are EMPTY shells (0 secrets, 0 rules — old
Vercel-integration residue, nothing to migrate); ci.yml uses no GITHUB_TOKEN and no GitHub
environment refs (deploy = VERCEL_TOKEN only); the Vercel CLI is logged in on this machine
(whoami verified); production serving is fully decoupled from GitHub — the site stays up during
the whole operation, worst case is one red deploy job to rerun. Docs prepared: all 89 PR links
neutralized (PR numbers ≤27 = the pre-2026-07-12 repo instance, historical labels like the
pre-rewrite SHAs). What NO route fixes: the ~9 days of prior public exposure and any search-engine
caches of old PR pages (they 404 over time) — the addresses stay treated as harvested (#132).

**Execution (session drives, owner present; ~20 min):**

0. Prep, non-destructive: owner creates a fresh Vercel token (dashboard → Account Settings →
   Tokens) and keeps it ready in his password manager; session captures the two non-secret IDs
   (`cd web && npx vercel link --yes` → `.vercel/project.json`; fallback: dashboard) and
   re-checks forks == 0.
1. **OWNER GO in-chat** → rename: `gh api -X PATCH repos/Stefan7168/checkdecijfers -f
   name=checkdecijfers-pre-rewrite-archief` → flip private: `-F private=true`. (PII now
   non-public. Reversible.)
2. `gh repo create Stefan7168/checkdecijfers --public` (empty).
3. `gh secret set VERCEL_ORG_ID` + `VERCEL_PROJECT_ID`; **owner** runs
   `gh secret set VERCEL_TOKEN --repo Stefan7168/checkdecijfers` from his own terminal (paste
   hidden, value never in chat).
4. `git push -u origin main` (same remote URL) → CI gate + deploy green in one go.
5. Re-enable Dependabot: `gh api -X PUT repos/Stefan7168/checkdecijfers/vulnerability-alerts`
   and `.../automated-security-fixes` (dependabot.yml rides the repo; weekly PRs resume).
6. Verify the POINT of it all: `git ls-remote origin 'refs/pull/*'` → **empty**; the Actions
   runs API serves only the noreply address; a fresh clone is clean (the #132 audit method);
   the live site still answers.
7. Record in #132; the support ticket becomes unnecessary. **Phase 2 goes on the monthly
   maintenance agenda: delete `checkdecijfers-pre-rewrite-archief` once the new repo has been
   green for weeks** (`gh repo delete` — token holds the scope). The old-machine warning below
   STANDS (its clone predates even the rewrite); the local bundle
   `~/checkdecijfers-pre-rewrite-2026-07-12.bundle` remains the owner's last-resort copy.

## ⚠ History rewritten 2026-07-12 (#132) — old clones are POISON, re-clone instead

The public repo's full git history was rewritten on 2026-07-12 (owner-approved: commit authors →
the GitHub noreply address, personal identifiers scrubbed from all old file versions — the
[#132](open-questions.md) record has the measured proof). Consequence: **any clone made before
that date (e.g. on the previous laptop) carries the OLD history. Never commit or push from such a
clone — it would resurrect the scrubbed identifiers. Delete it and `git clone` fresh.** The
build machine's local safety bundle (`~/checkdecijfers-pre-rewrite-2026-07-12.bundle`) contains
the old history on purpose (rollback insurance); the owner deletes it when satisfied. Commit
identity for every clone: the noreply address in the fresh-clone step below — never a personal
e-mail (the repo is public).

## Adding a data source (WP30c and later)

The step-by-step recipe lives in [docs/how-to-add-a-source.md](how-to-add-a-source.md) (WP30b,
session 37): registry entry → adapter → fixtures + manifest → the conformance harness green
(`npx vitest run tests/sources`) → registration. It is an **owner decision + WP30c-lane work,
never an autonomous add** — the owner preconditions (source choice #123, license check,
owner-signed public-claim wording) are at the top of that guide, and its "known WP30c wiring
points" section lists the verified landmines (e.g. the catalog-refresh prune wipe) that must be
fixed WITH the first second source.

## Supervised live step — migrations 016 + 017 applied (2026-07-12, session 37-continued, owner present)

**✅ DONE.** `npm run db:migrate` applied both 016 and 017 to production in one run
(`Applied 2 migration(s): 016_source_column.sql, 017_answer_feedback.sql`) — additive, no
FK/index/data change on either. **(a) The A1 re-verification found + fixed TWO real bugs live**
(`node scripts/verify-audit-rows.ts 1 240`, the full historical range): `buildDefinitionLine`
and the onboarding-envelope consistency check both crashed on real historical rows missing a
key added by a later session (`?? null` fix, same A1 discipline as `attribution.source`) —
full detail + the two remaining known historical-versioning anomalies (rows 76 and 227, not
bugs, not fixed tonight) in [open-questions #133](open-questions.md). **Final measured result:
213/215 checkable rows reconstruct clean** (25 GDPR-redacted rows structurally skipped by the
script, per #133). **(b) ✅ DONE** — grants/RLS on `answer_feedback` LIVE-VERIFIED: 0 anon/authenticated grants, RLS enabled, 0 policies (migration-003 auto-lockdown confirmed working on this table too).
**(c)** the owner's live 👍/👎 click test — ✅ DONE (session 39, 2026-07-12, owner in-chat). Baseline verified read-only at 0 rows (sessions 38+39); the owner then asked real questions on production and clicked feedback on two real answers. Read-only verification (`select audit_answer_id, verdict, feedback_text from answer_feedback order by created_at asc`) confirmed exactly the expected shape: row 1 (audit_answer_id 242) verdict='down' with feedback_text set ("Dit is een test. Ik heb aangeklikt dat deze antwoord 'duimpje omlaag' is."); row 2 (audit_answer_id 243) verdict='up' with feedback_text null. **WP128 is now fully complete — no remaining steps.**

**Script usage** (kept for the next time a range needs re-checking):
`node --env-file=.env scripts/verify-audit-rows.ts <fromId> <toId>` (NOT `npm run audit:verify --`
— the `--` passthrough breaks direct `node` invocation; use `npm run audit:verify -- <from> <to>`
OR call the script directly without `--`).

## WP129+130 web search — the supervised go-live (✅ RUN 2026-07-12, session 40, owner present)

**As-executed record:** all five steps ran 2026-07-12. Migration 018 applied clean; pricing
verified (5 rows incl. `web_addon`=10); flag set via `vercel env add` + empty-commit redeploy
(gate+deploy green). **The first smoke test FAILED honestly** — web section "niet gelukt", add-on
auto-refunded, cost 20 — and the audit row's stored `webSection` (R8 paying off) + one local
diagnostic call (~€0,05) found the measured root cause: the `web_search_20260209` filtering
variant returns citation-less text blocks on `claude-sonnet-5`, which the extraction rightly
rejects. Fixed same window (commit `6e23fb2`): basic `web_search_20250305` variant (4 cited
findings on the same question), per-path `console.error` logging (the failure had been invisible
in Vercel logs), and the owner-requested busy-indicator copy ("…CBS-cijfers en het web…"). The
re-run smoke tests PASSED both modes, ledger-verified: CBS+web = −20 −10 kept (row 247, 4
findings); web-only = −20 +20 −10 ⇒ net 10 (row 248, reason `web_only`, 4 findings); orphan
query returned exactly the two delivered-section debits, zero orphans. Full detail: ADR 032
§ Go-live correction.

The code ships DORMANT: until every step below is done, production behaves byte-identically to
pre-WP129+130 (no chips, no web calls, no new charges — the `WEBSEARCH_ENABLED` flag pattern,
same as `ONBOARDING_ENABLED` was). Steps, in order, owner present:

1. **Apply migration 018** — `npm run db:migrate` (adds the `websearch_cost` ledger reason +
   its idempotency index, widens the compensation trigger, adds the `web_addon` action class to
   the pricing CHECK). Additive only; no data change.
2. **Apply pricing** — `npm run pricing:apply` (inserts the `web_addon` = 10 credits row).
   Verify read-only: `select * from action_class_prices;` should now show five rows.
3. **Set the flag** — in Vercel: add env var `WEBSEARCH_ENABLED=1` (Production), then redeploy.
   Also confirm the plan's function-duration ceiling accepts `maxDuration = 90` (current Vercel
   default ceiling is 300s — fine as of 2026-07).
4. **Live smoke test (~€0.05 API spend):** ask one real question with the Internet chip ON.
   Expect: normal CBS answer, then the bordered "Van het web (niet door checkdecijfers
   geverifieerd)" block with ≤4 one-sentence findings and domain-only links; cost caption 30.
   Verify the ledger read-only: one `question_cost` −20, one `websearch_cost` −10, no
   compensation. Then ask one question with the CBS chip OFF (web-only): expect the honest
   "geen geverifieerd antwoord" line + the web block; net cost 10 (the −20 base auto-refunded).
5. **Orphan check (also a monthly-maintenance query):** a platform-killed request can in theory
   leave a `websearch_cost` debit without its settlement (documented accepted residual, ≤10
   credits per occurrence). Read-only:
   `select d.id, d.created_at, d.delta from credit_transactions d where d.reason = 'websearch_cost' and not exists (select 1 from credit_transactions c where c.reason = 'compensation' and c.related_transaction_id = d.id) order by d.created_at desc;`
   — every row here should correspond to a turn whose chat actually showed a web section; a row
   without one is an orphan the owner refunds by asking a session to run `compensate` for it.

Rollback at any point: unset `WEBSEARCH_ENABLED` and redeploy — the feature goes fully dormant
(migration 018 and the pricing row are harmless to leave in place).

## WP135 chat workspace — the supervised go-live (✅ RUN 2026-07-13, session 42, owner present)

**As-executed record (2026-07-13, session 42):** all steps ran clean, owner supervising. Migration 019 applied (exactly one);
FK `chat_threads_user_id_fkey` + lockdown live-verified (0 anon/authenticated grants, RLS on, 0 policies; `audit_answers_thread_id_fkey`
present); `WORKSPACE_ENABLED=1` via `vercel env add` + empty-commit CI redeploy (`ae604db`, gate+deploy green). ⚠ Verify a flag flip on a
RUNTIME route: `/login` HTML is a FALSE NEGATIVE (statically prerendered; sensitive env vars are empty at build) — the real signal:
unauthenticated `/geschiedenis` 307s to `/login` (flag on) vs `/` (flag off). Smoke tests PASS (2 threads, 1+3 audit rows, zero orphans,
live credits chip, chart dock, resume identical). Logout worked but gave no pending feedback → fixed same session (`5ba3fb8`, live).
Cosmetic residual: `/login`'s stripped header does not render in prod while that route is static — harmless. Step 5 (GDPR spot-check)
deliberately skipped (optional, owner's call). Rollback unchanged: unset the flag + redeploy.

The workspace (conversation sidebar + right-pane dock + site shell) ships DORMANT behind
`WORKSPACE_ENABLED`: until every step below is done, production behaves byte-identically to
pre-WP135 on every route (`/`, `/credits`, `/login`; `/geschiedenis` redirects to `/`). Built
session 41 (2026-07-12) per ADR 033 + the frozen brief; merged only after owner PR review.
Steps, in order, owner present:

1. **Apply migration 019** — `npm run db:migrate` (adds `chat_threads` — id/user/timestamps
   only, NO text columns by design — and nullable `audit_answers.thread_id`). Additive only.
2. **Verify the guarded FK exists on prod** (CI is structurally blind to it — the hermetic test
   DB has no `auth` schema). Read-only:
   `select conname from pg_constraint where conrelid = 'chat_threads'::regclass;`
   — expect `chat_threads_user_id_fkey` (plus the PK). Also confirm grants/RLS inherited
   locked: 0 anon/authenticated grants, RLS on, 0 policies (the migration-003 posture, same
   check as 011/018).
3. **Set the flag** — in Vercel: add env var `WORKSPACE_ENABLED=1` (Production), then redeploy.
4. **Live smoke test (€0 extra spend beyond one normal question):** (a) ask a question → answer
   lands, sidebar shows the conversation (title = your question), credits chip in the top nav
   updates live; (b) ask a chart question → the visual docks right with a tab, the message shows
   the "in het paneel" chip, the web section (if any) stays IN the conversation; (c) "nieuwe
   chat" → fresh conversation, old one clickable in the sidebar, resuming shows the identical
   transcript incl. cost captions; (d) "Log uit" works and `/login` shows the stripped header.
   Verify read-only: `select id, user_id, created_at, last_activity_at from chat_threads;` —
   one row per conversation, no orphans (a row with zero `audit_answers.thread_id` references
   is a bug, not expected).
5. **GDPR spot-check:** press "Verwijder mijn vraaggeschiedenis" on a THROWAWAY conversation
   day only if you want to test it — a fully-redacted conversation must disappear from the
   sidebar (the dashboard keeps its "verwijderde vraag" placeholder, unchanged posture).

Rollback at any point: unset `WORKSPACE_ENABLED` and redeploy — fully dormant again (migration
019 is harmless to leave in place; threads simply stop being written or read).

## #144 semantic checker — the supervised go-live (✅ RUN 2026-07-16, session 46, owner present)

**As-executed record:** all five steps ran 2026-07-16, same session as the build+merge. Calibration
run 1 (prompt v1) measured **8/9 — FN on F4**, the month-compound residual ("nog 31
januari-meldingen extra"): the model read "31 januari" as a date, the same trap the deterministic
layer had (review CRITICAL). Prompt v2 teaches the DATE_FORM_AFTER rule + the compound example →
**9/9, FP=0 FN=0 flips=0, at record AND --repeat=3** (history in
benchmark/semantic-check-eval-report.json). Replay leg added to the gate
(tests/answer/semantic-check-replay.test.ts, commit 8eef383, gate+deploy ✓). Owner decided at the
flip (in-chat): **fail-open + ADMIN ALERT** — src/answer/audit/alerts.ts e-mails the owner per
fail-open skip (audit row, user, question, error, meaning; commit deabbfb). Env vars set via
vercel CLI (SEMANTIC_CHECK_ENABLED=1 + ADMIN_ALERT_EMAIL; FAILMODE deliberately unset =
fail-open); the deabbfb deploy (run 29513127181, gate+deploy ✓, prod 307) was the flip. Live
smoke: owner asked a real chat question → audit row 253 carries semanticCheck
`skipped_no_suspects` (prompt v2, zero extra LLM calls — llm_calls shows intent+compose only),
pre-#144 row 252 has no key (A1), and `npm run audit:verify -- 253 253` exits 0.


The code ships DORMANT (ADR [034](decisions/034-semantic-fabrication-check.md)): until every step
below is done, production behaves byte-identically to pre-#144 — no extra LLM calls, no spend, no
behavior change (the `SEMANTIC_CHECK_ENABLED` flag pattern, same as `ONBOARDING_ENABLED` /
`WEBSEARCH_ENABLED`). No migration needed (the verdict rides the existing envelope jsonb). Steps,
in order, owner present:

1. **Record the calibration fixtures (small real spend, ~7 Haiku calls ≈ cents):**
   `npm run semantic-check:record`. Then the stability run:
   `npm run semantic-check:eval -- --repeat=3`. **Gate: FP=0, FN=0, flips=0** — a false positive
   on a legit body or a missed seeded fabrication is a flag-flip BLOCKER (ADR 034 §6); fix the
   prompt/labelled set first and re-record. The report history lands in
   `benchmark/semantic-check-eval-report.json` (commit it).
2. **Add the CI replay leg** — ask the session to add the replay test over the recorded fixtures
   (the eval's `--replay` mode is the manual equivalent) so the calibrated behavior is pinned
   hermetically on the gate from then on.
3. **OWNER DECISION — `SEMANTIC_CHECK_FAILMODE` — ✅ DECIDED (owner, 2026-07-16, in-chat, eval
   results in hand): FAIL-OPEN + ADMIN ALERT.** `SEMANTIC_CHECK_FAILMODE` stays UNSET (fail-open
   default: serve the deterministically-validated answer, record the skip). Every fail-open skip
   e-mails the owner (ADR 034 §5-resolution: audit row, user, question, error, meaning) via
   `src/answer/audit/alerts.ts` — requires `ADMIN_ALERT_EMAIL` (below); without it the
   `console.error` line in Vercel logs is the floor.
4. **Set the env vars** — in Vercel (Production): `SEMANTIC_CHECK_ENABLED=1` +
   `ADMIN_ALERT_EMAIL=<owner e-mail>` (NOT `SEMANTIC_CHECK_FAILMODE` — unset = the decided
   fail-open), then redeploy (gate + deploy green).
5. **Live smoke test (~cents):** ask one real question whose answer is residual-shaped (e.g. one
   that phrases a bracket like "personen van 45 tot 65 jaar") and one plain question. Verify
   read-only on the audit rows: the plain answer's envelope has `semanticCheck` status
   `skipped_no_suspects` (zero checker calls), the residual-shaped one status `ok` with verdicts,
   and `llm_calls` shows the `semantic_check` role. Then
   `npm run audit:verify -- <that row> <that row>` → exit 0.

Rollback at any point: unset `SEMANTIC_CHECK_ENABLED` and redeploy — fully dormant again; stored
verdicts on already-written rows stay valid for R8 (the reconstructor checks them whenever the
key is present, flag state irrelevant).

## #53 anonymous trial pot — the supervised go-live (✅ RUN 2026-07-17, session 52, owner present)

**THE TRIAL IS LIVE.** All 7 steps executed 2026-07-17 (owner made the key in its own hard-capped Anthropic
workspace and set it in Vercel himself; session set TRIAL_ENABLED + TRIAL_IP_HASH_SECRET — the secret piped
straight into `vercel env add`, never displayed; migration 020 applied + live-verified RLS on/0 anon grants;
deploy `2609435`; pot seeded 25). Live smoke, measured: two anonymous questions served end-to-end on prod —
audit rows 255/256 (`source_tag='anonymous_trial'`, `user_id` NULL, `npm run audit:verify -- 255 255` = 1/1
clean), both trial_questions rows audit-linked, pot 25→23, visitor counter 2→1→0 with the used-up login
nudge, closed→open flip after `trialpot:set` WITHOUT a deploy (the auto-re-enable fail-safe, proven).
Owner-side check (only the owner can see the console): verify the trial workspace shows the smoke calls' spend and the main workspace shows none — asked at go-live, confirm/annotate here.
Answer-quality note (NOT a trial bug — main-pipeline behavior): both casually-phrased smoke questions drew
honest conservative refusals rather than answers ("Wat was de inflatie in juni 2026?" → the forecast guard;
"Wat is het consumentenvertrouwen?" → the meta template) — the WP26 clarify-policy/answer-first theme now
directly affects the trial's first impression; see the open-questions #53 note. The checklist below stays as
the RE-RUN/refill reference:

1. **Anthropic console:** create a NEW API key for the trial with **its own hard spend cap** (start small,
   e.g. $5/mo — the outer belt). Never reuse the main key.
2. **Vercel env store:** add `ANTHROPIC_TRIAL_API_KEY` (Sensitive), `TRIAL_IP_HASH_SECRET` (Sensitive, any
   long random string) and `TRIAL_ENABLED=1` (see the secrets register rows above).
3. **Live DDL:** apply migration 020 (`npm run db:migrate` against prod, owner present) — creates
   `trial_pot_config` (seeded 0/0 = still closed) + `trial_questions`, widens the audit `source_tag` CHECK.
   Verify grants/RLS as usual (migration 003 auto-locks new tables).
4. **Redeploy** (env edits never apply to a running deployment). Landing now shows the trial section in its
   CLOSED state ("proefpotje is leeg") — correct: the pot is still 0.
5. **Seed the pot small:** `npm run trialpot:set -- 25`. The trial opens on the next request — no deploy.
6. **Live smoke:** one real anonymous trial question (private browser window) → answer with R4 attribution;
   check the audit row (`source_tag = 'anonymous_trial'`, `user_id` null) and the `trial_questions` row
   (linked `audit_answer_id`); watch the Anthropic console: the call landed on the TRIAL key.
7. **Refill/close later:** `npm run trialpot:set -- <n>` (0 closes it; the UI degrades to the login prompt
   automatically). Optional owner-side hardening outside the repo: Vercel Firewall rate rules (ADR 036 D2).

## Moving to a new machine (fresh clone bootstrap)

Everything that matters lives in this repository or in your own accounts
(GitHub, Supabase, Anthropic) — nothing project-critical is tied to any one
computer or any one Claude account. A new machine needs, in order:

> **Returning to a PREVIOUSLY-used machine instead?** (measured, session 36,
> the 2026-07-11 switch-back): the old clone may be stale or even gutted —
> session 36 found every tracked file deleted from the working tree with
> `.git` intact. Recovery is three git commands, no re-clone: `git stash push`
> (restores all files AND keeps the deletion state as a poppable undo — also
> the move when a permission classifier misreads `git restore .` as
> destructive), `git fetch origin`, `git merge --ff-only origin/main`. Then
> read STATUS as usual. ⚠ The machine's local AI memory files predate the
> switch — where they contradict STATUS, STATUS wins (the doc-freshness rule).

1. **Install** (one-time): [Node.js](https://nodejs.org) **24 or newer**
   (`node --version` to check — the project requires ≥24), git,
   [Claude Code](https://claude.com/claude-code), and the GitHub CLI
   (`gh`). The CLI is not optional in practice: the repo is private, and
   `gh auth login` (step 2) is what gives git the credentials the clone
   in step 3 needs (measured on the 2026-07-03 bootstrap — the clone
   worked *because* gh was signed in). It also lets you watch CI from
   the terminal. **Optional but recommended for incident response:** the
   **Vercel CLI** (`npm i -g vercel`, then `vercel login` as
   personal gmail #2 and `vercel link` to project `checkdecijfers`) —
   the supervised-live-step playbooks below tell you to run `vercel logs`
   as the first move when a deploy misbehaves, and that needs the CLI
   installed + linked. Not needed for building or CI (those use
   `VERCEL_TOKEN` in GitHub Actions).
2. **Sign in**: GitHub (your `Stefan7168` account — `gh auth login` walks you
   through it in the browser) and Claude Code (your Claude account).
   **Multi-account gotchas (previously only in AI session memory — recorded
   here 2026-07-10 ahead of the laptop/account switch):**
   - **GitHub:** the machine may hold several gh accounts (work ones —
     redacted per #132). The repo lives under `Stefan7168`; other accounts
     404 on admin actions. If git ever says "Repository not found", run
     `gh auth switch -u Stefan7168`. To make this clone immune to the active
     gh account, set the repo-local credential helper once:
     ```
     git config --local credential.helper ""
     git config --local --add credential.helper '!gh auth git-credential'
     ```
     (This is how the 2026-07 machine was set up; it does not travel with a
     clone — redo it on every new machine.)
   - **Browser / Google:** ALL browser work for this project — Google Cloud
     Console, Supabase, Vercel dashboards, and any AI-session browser
     automation — runs under your PERSONAL Google identity: the Chrome
     profile named **'Personal'** (owner steer 2026-07-10). Work profiles
     risk parking OAuth projects/credentials under the wrong identity.
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
   git config user.email "100549875+Stefan7168@users.noreply.github.com"
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
   **Also gone with the old account/machine (and fine, by design):**
   - **The AI's per-project memory directory** (session-to-session notes on
     the old machine). As of 2026-07-10 its entire durable content is
     mirrored in this repo (the gh/Chrome account quirks above, project
     state in STATUS.md) — and the CLAUDE.md convention now requires every
     future session to keep it that way, so losing memory loses nothing.
   - **MCP connectors** (Supabase, Vercel, etc. hooked into Claude) are
     account-tied conveniences; reconnect them on the new account if you
     want them, but no project workflow depends on them — sessions work
     through the repo's own CLIs and `gh`.
7. **Not in git, by design:** `.env` (recreate per step 5), `web/.env.local`
   (recreate: the two `NEXT_PUBLIC_SUPABASE_*` values copied from the
   committed `web/.env.production` **plus `NEXT_PUBLIC_APP_URL=http://localhost:3000`**
   — `next dev` does NOT read `.env.production`, measured session 34; only
   needed to run the chat UI locally with `npm run web:dev`) and the local
   `Archive/` folder (competitor-research reference material — copy it over
   manually if you still want it, or let it go; nothing in the build depends
   on it).

## WP16 sub-part 2 — the supervised live step (owner present; ✅ DONE 2026-07-06, session 28)

**✅ COMPLETED 2026-07-06 (session 28, owner present). On-demand CBS fetch is LIVE in production.** All steps below ran successfully; both paths were verified live — a DELIVERED answer (consumentenvertrouwen → CBS table 83694NED, full CC BY attribution, 100 credits kept) and an UNANSWERABLE + full refund (bijstand → 85615NED, ledger compensation +100). The kick is proven live (jobs finished seconds after the trigger, not at the 06:00 UTC backstop). **Go-live bug caught + fixed pre-flight (before any credit was spent): `/api/onboarding-cron` was missing from `web/proxy.ts`'s `PUBLIC_PATH_PREFIXES`, so the session proxy 307'd it to /login before its own CRON_SECRET auth ran — the kick/cron would have silently never executed (commit `42b275b`, + `web/proxy.test.ts`).** Owner-flagged follow-up: the bijstand question must answer — finder mis-picked a flow table over a stock table ([#111](open-questions.md), elevated). The checklist is kept below as the record + the template for any future supervised live step.

The on-demand-fetch code was built and merged (2026-07-06, hermetic — full detail in [STATUS.md](STATUS.md)); it was dormant in production until this checklist ran, in order, in one supervised session:

1. **Apply migrations 012 + 013** to production: `npm run db:migrate` from the repo root (it applies only what's missing). Then the standard per-migration check: `pending_table_requests` must show 0 `anon`/`authenticated` grants + RLS on (the migration-011 procedure above, same queries).
2. **Set `CRON_SECRET`, `RESEND_API_KEY` and `ONBOARDING_ENABLED=1`** in the Vercel env store (rows in the secrets register above) and **redeploy** (env edits never apply to a running deployment). `ONBOARDING_ENABLED` is the master switch: until it is `1`, the deployed app behaves exactly as before WP16 sub-part 2 (the finder is never constructed), so steps 1–2 can be done safely in any order — nothing is user-visible until the flag flips.
3. **Trigger cadence — kick-on-trigger, DECIDED ([#113](open-questions.md), Stefan, session 27) and BUILT (session 28, commit `c64e2a2`).** The Vercel Hobby plan only allows DAILY crons, so the committed cron (`/api/onboarding-cron`, daily 06:00 UTC) is only the backstop sweep. The kick is the real cadence: after `triggerOnboarding` commits, the app fires the route itself (`web/lib/onboarding-kick.ts`, via Next's `after()` in `maybeTriggerOnboarding`) — fail-soft — so the delivery re-run starts within minutes, making the "meestal een kwestie van minuten" promise hold. **The kick needs two env values to fire:** the SAME `CRON_SECRET` from step 2, **and** Vercel's `VERCEL_PROJECT_PRODUCTION_URL` system env var (auto-exposed as long as project Settings → 'Automatically expose System Environment Variables' is on — it is by default; no manual secret to set). If either is unset, the kick logs a skip and the daily backstop still sweeps — nothing breaks, the promise just weakens to "within a day". **Vercel Pro (~€20/mo) is the owner's kept fallback if kick-on-trigger ever falls short — do not build further homegrown scheduling beyond this.** Verify TWO things: (a) Vercel dashboard → Settings → Cron Jobs shows the route, and an invocation returns 200 with the job-summary JSON — on an empty queue `{"reclaimed":[],"capExhausted":[],"processed":null}`; there is NO `claimed` field (the earlier `{"claimed":N}` wording here described a shape the route never returns — session-30 review) — once the secret is set (503/401 before that is the fail-closed design, not a bug); (b) **after the first real onboarding trigger (step 4), run `vercel logs` and look for the kick's own line — `onboarding kick dispatched …`** (that is the proof the kick fired, not the daily backstop coincidentally being close in time). A `onboarding kick skipped (… unset)` line means an env value is missing; a `onboarding kick returned non-OK status 401` line means `CRON_SECRET` mismatches between the app and the route.
4. **First real fetch, supervised**: ask the live app a question about a topic outside the 8 loaded tables (e.g. bijstand). Expect: the acknowledgment message, a 100-credit charge, the dashboard "Wordt voorbereid" entry, then within minutes the answer + email. Also verify the refund path once by checking the ledger after any failure. **`FOR UPDATE SKIP LOCKED` concurrency was NOT testable hermetically (PGlite is single-connection)** — the first live run doubles as that check.
5. If anything misbehaves: `vercel logs` immediately (short retention) and stop the cron by removing `CRON_SECRET` (the route then refuses all invocations — fail closed).

## WP27 stage D — the supervised live step (owner present; ✅ DONE 2026-07-10, session 33)

**✅ COMPLETED 2026-07-10 (session 33, owner present, PR #22). The finder→chain→fit-gate machinery is LIVE and PROVEN in production — #111 closed on the owner's live acceptance.** The checklist below ran in order, each live action owner-confirmed first; kept as the record + the template for future supervised live steps:

1. **Precondition verified**: PR #21 merged, gate+deploy green on `main` (CI job breakdown checked, not just the run status), working tree clean.
2. **Migration 015 applied** (`npm run db:migrate` — applies only what's missing), then the standard per-migration check (the migration-011 queries): `pending_table_requests` showed 0 `anon`/`authenticated` grants, RLS on, all three new columns with correct defaults, every index (incl. the dedupe partial unique) untouched. The pre-015 legacy row read back `candidate_ids: []` — the designed legacy path, live-confirmed.
3. **Fit fixtures recorded + threshold calibrated** (owner-approved ~cent spend): `npm run measurefit:record` → 6/6 correct at uniform 0.95 confidence; `acceptThreshold` kept at 0.8 ("calibrated, not moved" — ADR 027 as-built stage D has the numbers); hermetic replay e2e (`tests/ingestion/fit-replay.test.ts`) added to the gate. Code/calibration changes went through branch + PR per #118 — the migration itself is the only thing that touches prod directly, owner present.
4. **Pre-flight before the paid step** (the session-28 lesson): `curl` the deployed `/api/onboarding-cron` → 401 (fail-closed auth, NOT 307/503); dedupe/active-row state checked read-only (no active rows — the old unanswerable row can't block); credit balance confirmed sufficient.
5. **The live acceptance test**: the owner asked the #111 question in the app — ack + 100-credit debit → kick claimed the job in 2s → chain recorded, fit gate accepted `37789ksz`/`D000203_2` (fit_note filled) → ingest → **delivered in 88s**: "Het totaal aantal bijstandsuitkeringen kwam in 2023 uit op 390,2 x 1000" with full attribution; credits kept, ledger-verified no refund.
6. If anything had misbehaved: `vercel logs` immediately (short retention); the kill switches are unchanged (remove `ONBOARDING_ENABLED` for the whole feature, remove `CRON_SECRET` to stop the cron/kick — both fail closed).

**Standing rule — owner-run CBS fetches from a local network:** if node times out reaching `datasets.cbs.nl` while `curl` works, it's the known IPv6 black-hole; prefix the CLI with the committed preload: `node --import ./scripts/force-ipv4.mjs <cli> [...args]` (works for `catalog:refresh`, `ingest sync`, fixture captures, `measurefit:record`). Don't debug the app — it's the network. The deploy host is unaffected.

**Standing procedure — adding a curated coverage-sprint table (template = 83693NED, session 49; authority: [11-coverage-table-set.md](11-coverage-table-set.md) + the sprint brief):**
1. Re-validate identifiers LIVE against v4 `MeasureCodes` on `datasets.cbs.nl` (the brief's names can be v3 column names — the `Consumentenvertrouwen_1` trap) and cross-check frozen-key values on BOTH platforms. **Also probe for PHANTOM measures ([#167](open-questions.md), found on 85880NED — 17 of 210):** compare the fixture/live distinct-measure set in Observations against MeasureCodes (or probe suspects with `$orderby=Perioden desc&$top=1`); any code with ZERO rows table-wide goes in the seed's `excludeMeasures` with its title as a comment — without this the per-measure plausibility check quarantines a fully healthy ingest.
2. Code: `COVERAGE_TABLES` seed entry + registry defaults + canonical measures (`src/registry/defaults.ts`) + `AVAILABLE_GRAINS` keys + fixtures (`node --import ./scripts/force-ipv4.mjs scripts/capture-cbs-fixtures.ts <id>` + `--catalog-add <id>`) + `tests/fixtures/cbs/conformance.json` entry + CC verification tasks in `benchmark/coverage-key.json` scored by `tests/query/coverage-key.test.ts` (docs/05 onboarding rule).
3. **A vocab addition re-hashes ALL ~93 intent/followup/clarify/delivery LLM fixtures ([#164](open-questions.md))**: clear those four `tests/fixtures/llm/` dirs first (the record scripts do NOT remove stale hash files), then `intent:record` / `followup:record` / `clarify:record` / `onboarding-delivery:record` (Haiku-tier, sub-euro, owner-approved spend) + `intent:eval -- --repeat=3` (expect zero flips) — group multiple tables into ONE re-record.
4. Full verification block + `/code-review` low + push; after green CI the live step: `node --import ./scripts/force-ipv4.mjs --env-file=.env src/ingestion/cli.ts sync <id>` (auto-registers) + `npm run registry:apply`, then an LLM-free spot-check of the frozen-key cell(s) with `node --env-file=.env scripts/spot-check-canonical.ts <key> <periodCode>` (committed session 50; exit 0 = answer printed, exit 2 = refusal shown). **Run `registry:apply` only AFTER the CI deploy job is verified live** (max-review #166 finding 8, 2026-07-17): the live chat parses with the COMPILED `CANONICAL_MEASURES` constant — a curated DB row whose key is not in the running bundle (apply-before-deploy, or a rollback after apply) makes the #166 belt suppress auto-derivation for a measure the delivery re-run then can't parse → guaranteed refund-loop for that table until code and DB agree again.
5. **Slow-stream escape hatch (session 50, measured on 85880NED):** CBS's UNFILTERED v4 Observations stream can serve at ~6KB/s from a local network with mid-body terminations — a big-table live sync then fails at the fetch stage after ~3×45-min attempts (fetch failures do NOT quarantine; the table just stays unsynced). Fix: fetch the table in PARALLEL per-dimension chunks (each connection gets its own bandwidth; 5 SoortMutaties chunks = 99,676 rows in ~6 min): copy the table's metadata files into a work dir, run `node --import ./scripts/force-ipv4.mjs scripts/capture-observations-chunked.ts <id> <partitionDimension> <dir>` (committed session 50; one worker per code of the chosen dimension, verbatim pages + manifest), then `node --env-file=.env scripts/sync-from-capture.ts <id> <dir>` — the SAME pipeline/validators/batch bookkeeping, only the transport differs; that script refuses a capture not made the same day. ⚠ Expect this for every 85880NED release-day sync (incl. ~30/7) until the slow stream turns out network-specific.

## WP28 Google SSO — owner configuration steps (✅ ALL DONE 2026-07-10, session 34 — Google SSO is LIVE and #122-verified; kept as the record + troubleshooting reference)

The "Doorgaan met Google" button is **merged + deployed** (PR #23, merge `e8b09be`, gate + deploy green, 2026-07-10) **and fully configured + live-verified the same day** — all three steps below are done; they are kept as the record and for troubleshooting. The magic link is unchanged throughout (two independent doors, D4). **What "not configured yet" looks like (measured in the build session):** clicking the button sends the browser to Supabase's authorize URL, Supabase rejects the disabled provider and bounces back to `/login?error=auth` — the user just lands on the login page again, without an inline message. The inline Dutch error copy only appears for server-side failures (missing env, Supabase client error). So don't be surprised by the silent bounce before you finish these steps.

**⚠ TWO-SUPABASE-ACCOUNTS QUIRK (discovered 2026-07-10, session 34 — the reason steps 2–3 paused):** you have (at least) two Supabase accounts. **checkdecijfers lives in the account with org "stefan"** (`emycswhsinjqdjhzlzmx` — the account the project's Supabase MCP connector is authorized to); your browser is often logged into the OTHER account (org "glaibaan") because of parallel GlaiBaan work, and that account CANNOT see the checkdecijfers project — the dashboard silently bounces to the glaibaan org. Before any checkdecijfers dashboard step, check the org name in the top-left breadcrumb; if it says "glaibaan", you're in the wrong account. To avoid disturbing a parallel GlaiBaan session, do checkdecijfers dashboard work in an **incognito window** (separate login, nothing else touched) or log out/in when the other work is idle. The Supabase MCP connector is unaffected either way (its own auth, org "stefan").

1. ✅ **Google Cloud Console — DONE (2026-07-10, session 34, driven in-browser with the owner present; Chrome profile 'Personal' / personal gmail #1).** As executed (Google's console has changed since the brief — the consent screen now lives under "Google Auth Platform"): project **`checkdecijfers`** created (No organisation) → Google Auth Platform "Get started" wizard (app name `checkdecijfers`, support/contact personal gmail #1, audience **External**, API-services user-data policy agreed by the owner) → **Create OAuth client**: type Web application, name `checkdecijfers-supabase`, Authorized redirect URI `https://vqvohfqapjfdpbojtezx.supabase.co/auth/v1/callback` → **published to production** (Audience page "Publish app" — REQUIRED: a testing-mode app only admits listed test users; basic scopes need no Google verification review). **Client ID (public):** `448260358563-s3mncv63s5tkn7j5b24ivuk319ioosap.apps.googleusercontent.com`. The **Client secret** stays in the Google console — read it from [Clients](https://console.cloud.google.com/auth/clients?project=checkdecijfers) → `checkdecijfers-supabase` when doing step 2; it goes NOWHERE else (not in the repo, not in Vercel, not in chat).
2. ✅ **Supabase dashboard — DONE (2026-07-10, incognito window on the org-"stefan" account, per the quirk above):** `https://supabase.com/dashboard/project/vqvohfqapjfdpbojtezx/auth/providers` → Google → Enable, paste the Client ID from step 1 + the Client secret → Save. (Secrets live ONLY here — never in the repo or Vercel.) **Two gotchas hit and solved, keep for next time:**
   - **Google shows a client secret ONLY at creation** ("Viewing and downloading client secrets is no longer available") — the create-dialog offers it once (or via Download JSON); afterwards the console shows a masked stub (`****xxxx`). If it was missed — as happened here — DON'T paste the stub: use **"+ Add secret"** on the client page (rotation without downtime), copy the NEW secret via its copy icon (clipboard-only, never through chat/repo), paste into Supabase, Save, and after verifying login works **Disable the old secret** (done; the console itself warns against keeping two).
   - **The enabled-but-secret-missing signature:** clicking the button then yields a raw JSON 400 at the authorize URL — `{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: missing OAuth secret"}`. That exact message means the toggle saved but the secret field did not — re-paste and Save.
3. ✅ **Live verification — DONE + PASSED (2026-07-10, owner present, both halves, read-only SQL before AND after each login):** (a) Google login with the EXISTING magic-link e-mail → user count unchanged, that user's identities went `[email]` → `[email, google]`, signup grants unchanged (NO duplicate — the ADR 028 D2 linking verified); (b) fresh-e-mail Google login → exactly ONE new user (google-only identity) + exactly ONE +100 grant written in the same instant (the migration-005 trigger fired once). The fresh-e-mail login deliberately created a real account with a real grant — it doubles as the new-user path check. **Cosmetic residual → [#7](open-questions.md):** the Google consent screen shows the raw Supabase project domain until a custom auth domain is configured with the future product domain.

## Your recurring duties

- **Sign-offs** at the gates in [STATUS.md](STATUS.md).
- **Monthly maintenance session** — start a chat with: *"Run the monthly maintenance session for checkdecijfers.nl per CLAUDE.md."* Agenda: dependency alerts, provider deprecation notices, spend dashboards, backup status.
  - **⚠ Standing dependency hold — TypeScript major pinned to ^5 (since 2026-07-17):** TypeScript 7 (the native-compiler line) breaks `next build`'s TypeScript step on Next 16.x — dependabot PR #53 turned main's DEPLOY red while every gate stayed green (the `tsc` CLI works under TS 7; only Next's in-build integration rejects it, so no test catches it pre-deploy). Fixed in `eec3973`: `typescript: ^5` in BOTH package.json files + `ignore` rules (semver-major, typescript) in both npm entries of `.github/dependabot.yml`. **Each maintenance session: check Next's release notes for TypeScript-7 support; lift BOTH ignore rules and BOTH pins together, and prove it with a real `next build` before pushing** — a green test gate is not proof for this one.
- **Catalog mirror refresh** (WP16, since session 25 / 2026-07-05) — `npm run catalog:refresh` bulk-mirrors CBS's full ~4,858-row dataset catalog into the `cbs_catalog` table (the table-finder searches this local mirror, never CBS live — principle b). Cadence is an open choice ([open-questions #106](open-questions.md)); default to running it in the monthly maintenance session. **Two gotchas a session must know:** (1) it's **slow (~19 min)** — row-by-row upserts over the Supabase pooler; let it finish, it isn't hung. (2) From a network where CBS's IPv6 address black-holes, **node/undici times out reaching CBS while `curl` works** — prefix with the committed preload `node --import ./scripts/force-ipv4.mjs …` (promoted from the lessons-learned recipe in WP27 stage D; see the standing rule in the stage-D section above). The deploy host is unaffected. **Lockdown already confirmed:** `cbs_catalog` (migration 011) was live grants/RLS-checked on 2026-07-05 — 0 `anon`/`authenticated` grants, RLS on, 0 policies, inherited from migration 003 exactly like the WP13 tables; still re-check it (and any newer table) before ever re-enabling the Supabase Data API.
- **Backfilling a NEW metadata field onto an already-onboarded table** (procedure from #115, session 29 — e.g. a future enrichment of `cbs_tables.units` or `canonical_measures`): a **plain `ingest sync` does NOT rewrite a table's stored `units` metadata** — only `sync --rebaseline` does (units aren't part of the schema fingerprint; metadata changes are treated as deliberate, reviewed events). Sequence: `node --env-file=.env src/ingestion/cli.ts sync <tableId> --rebaseline` (recomputes + persists `units` from the fresh CBS schema — safe on an unchanged schema, just a metadata refresh + version bump), then `node --env-file=.env scripts/onboarding-reregister.ts <tableId> <topicTerm>` (idempotently re-derives the `canonical_measures` rows, incl. the new field, from the refreshed metadata). **Same IPv6 gotcha as catalog refresh** — from a v6-black-holed local network, prefix the sync with the committed preload `node --import ./scripts/force-ipv4.mjs …` (landed in WP27 stage D; was queued since session 29). A read-only, LLM-free verify (construct the intent → `runQuery` → `buildDefinitionLine`) confirms the rendered answer without spending credits.
- **When an alert arrives** (ingestion failure, quarantine, downtime): start a session and paste the alert. Nothing more is expected of you technically.
- **Phase 1:** recruit the 10–25 beta journalists — outreach only you can do.
- **Phase 2:** the legal/business items (KvK, Stripe onboarding, terms incl. "credits verlopen nooit" wording, privacy policy review).

## The path from today

1. **Doc sign-off** — the open checkbox in [STATUS.md](STATUS.md).
2. **Create the four "Now" accounts** above.
3. **Fresh chat — Phase 0, session 1:** CI skeleton + validate the candidate CBS table IDs (open-questions #1). *(Repo already on GitHub, 2026-07-02.)*
4. Session by session down the [STATUS.md](STATUS.md) Phase 0 checklist, until the benchmark run and the gate decision.
5. Gate passed → Phase 1 per [06-roadmap.md](06-roadmap.md); this runbook's Phase 1 checklist activates.

## Local web dev server (session 51, for visual work)

`npm --prefix web run dev` (or the `.claude/launch.json` "web" entry) needs TWO env vars in `web/.env.local`
that `vercel env pull` does NOT deliver (all Vercel vars are Production-scoped, Development is empty):
`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Both are PUBLIC client values (they ship
in every prod browser bundle) — fetch them via the Supabase MCP (`get_project_url` / `get_publishable_keys`,
project `vqvohfqapjfdpbojtezx`) and append to `web/.env.local` (gitignored). Without them the middleware
crashes on every request ("Your project's URL and Key are required"). Logged-in pages additionally need
DATABASE_URL (a secret — supervised only); logged-out surfaces (landing, /login) render without it.
Session-52 note: without DATABASE_URL the landing's "Ontdek Nederland in grafieken" section degrades to
nothing by design (the ADR 035 fail-safe) — locally you see the landing minus the charts; the charts
themselves are verified hermetically on the gate (`tests/chart/curated.test.ts`) and visually on production.
