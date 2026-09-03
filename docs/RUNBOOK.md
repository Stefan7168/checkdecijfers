# RUNBOOK — the owner's guide

Everything **Stefan** does, phase by phase. AI sessions read [CLAUDE.md](../CLAUDE.md); you read this. Like [STATUS.md](STATUS.md), this is a tracker over decisions made elsewhere — tick boxes here, change plans in the docs.

## How work happens

- **One chat session = one work package** — one or two unchecked items from [STATUS.md](STATUS.md), not a whole phase. A fresh session automatically reads CLAUDE.md and STATUS.md and knows where things stand; that is what they exist for. Phases span many sessions.
- **Start a session like this:** *"Continue checkdecijfers.nl. Read CLAUDE.md, docs/STATUS.md, and docs/08-build-plan.md, then do the next work package in the build plan. First confirm back to me: the current phase, the benchmark gate, and the work package — then wait for my go."* The whole brief for each session already lives in the build plan ([08-build-plan.md](08-build-plan.md)), so you don't have to describe the work — just point at it. The confirm-back is your check that the session oriented correctly **before** it touches anything.
- **Big work packages may be delegated:** a session can spawn implementation subagents, as long as each brief names the specific invariants at stake and the session reviews the result — "done" still means green CI, no matter who wrote the code. Don't hardcode model names in reusable prompts; they go stale.
- **Delegation cost rule (your money):** the expensive model you're chatting with does the thinking — scoping, instructions, and reviewing what comes back. The legwork it farms out runs on cheaper models. If you see a session burn budget doing easy repetitive tasks on its own top-tier model, that's a bug: point at this line (and at the same rule in [CLAUDE.md](../CLAUDE.md)).
- **End of every session:** work committed, STATUS.md updated with measured results, process lessons appended to [lessons-learned.md](lessons-learned.md). If a session claims success, the proof is a green CI run — not its word (CLAUDE.md convention).
- **⚠ Largely historical since 2026-07-11: the repo is PUBLIC (open-questions #126) — Actions minutes are unlimited/free on standard runners, so the minutes-exhaustion cause below cannot recur while it stays public. Keep this entry: it applies again the day the repo returns to private.** **CI red that is NOT code — the GitHub Actions billing block (first seen 2026-07-08):** if a gate job fails within seconds showing **0 steps** and the annotation *"The job was not started because recent account payments have failed or your spending limit needs to be increased"*, no code ever ran — it's your GitHub account's Actions billing (account-wide: it hit both your repos the same day). Fix: github.com → Settings → **Billing & plans** → resolve the payment / raise the spending limit, then re-run the failed checks (`gh run rerun <run-id>`, or ask the session to re-push). A session seeing this must say "billing-blocked, code unproven on CI" — never claim the gate passed on local runs alone. **Verify the fix actually landed (learned 2026-07-09 — a "fixed" that wasn't):** rerun one check and watch the duration — a real gate run takes minutes; another seconds-long 0-step failure means the block is still active. The four usual causes, in order: you were logged into the wrong GitHub account (this repo's Actions bill belongs to **Stefan7168**, not the work account); the outstanding failed payment was never explicitly retried (look for the "Retry payment"/"Pay now" banner on Billing & plans — a new card alone does not clear it); the Actions **spending limit** stands at $0; or — **the actual cause when this hit us (resolved 2026-07-09)** — the monthly **included Actions minutes were simply used up** on this private repo, which the annotation's wording never names: buying a plan (now 3,000 included min/month) lifted the block immediately, confirmed by the duration signal on the first rerun. Ongoing duty: a full gate run costs ~8–10 minutes, usage stood at ~2,000/3,000 on purchase day — **check the Actions minutes meter in the monthly maintenance session** so the block never surprises mid-build again. **⚠ This entry is ACTIVE again — the repo went back to PRIVATE at the 2026-08-15 pause.** **A second, VARIANT symptom seen 2026-08-26 (session 63, ~15:12–16:00 UTC): `gate` jobs sat `queued` indefinitely (30min+, no runner ever assigned, no fast 0-step failure/annotation like the pattern above) across MULTIPLE branches simultaneously, then CI resumed normal runs on its own ~45 min later** — same suspected root cause (private-repo Actions-minutes pressure) but a different-looking symptom (a session can't tell "queued forever" apart from "GitHub is just busy" without waiting it out; there was no billing annotation to confirm the cause this time, and billing/usage could not be checked from a session — needs the `user` OAuth scope, which a session should not request unilaterally). **New learning: once CI recovers, a run that was ALREADY `queued` when the block started does not automatically get picked up** (`gh run rerun <id>` fails with "workflow is already running"; closing+reopening the PR does not help either — checks are keyed to the head commit SHA, which reopening doesn't change) — **the fix is a fresh commit** (an empty one is fine if no code needs to change), which forces a new check run against a new SHA. Full session-63 record: `docs/session-briefs/2026-08-26-session-63-resume-log.md`.
- **Merging a queue of several PRs (learned 2026-08-27, session 64 — cleared 14 in one sitting): don't trust `gh` async fields, and re-check the security posture after, not just the PR count.** `gh pr view <n> --json mergeable` can sit at `UNKNOWN` for 40s+ — don't wait it out, call `gh pr merge <n> --squash` directly, it resolves the real state itself. `gh run watch --exit-status` reported "completed successfully" on a run that `gh run view` on the same id still showed `in_progress`, three times in one session — always independently re-query `gh run view` before trusting a canary. A broader PR merging can auto-close an older one as "superseded" that was fixing something UNRELATED (session 64: a 17-package `next` bump auto-closed a `postcss`-only security PR that bump never touched) — before treating a self-closed PR as safely redundant, diff what it fixed against what actually landed; `@dependabot recreate` (comment on the closed PR) regenerates a fresh one for the residual. After the visible backlog is clear, run `gh api repos/OWNER/REPO/dependabot/alerts --jq '[.[] | select(.state=="open")]'` once more — a session's starting PR-list snapshot can miss an alert Dependabot hadn't generated a PR for yet.
- **`gh run watch --exit-status` is unreliable in BOTH directions (learned 2026-08-27, session 65) — never trust its verdict, only `gh run view`.** Session 64 already found it reporting "completed successfully" while the run was still `in_progress`. Session 65 hit the inverse the same day: `gh run watch` exited 1 ("failed") on a run that had genuinely passed — the real cause was a transient `read tcp ...: operation timed out` on the watch command's own polling connection to the GitHub API, nothing to do with the workflow. `gh run view <id>` immediately after showed the true state (`gate` ✓, `deploy` ✓). The rule this generalizes to: **`gh run watch`'s exit code is a hint to go check, never itself the check** — after it returns (success OR failure), always independently confirm with `gh run view <id>` before acting on the result.
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
- [ ] **Stripe live mode** with iDEAL enabled — can't flip from test to live mode until the item above is sorted; a config change (new keys), not new code. **⚠ Partially closed (2026-08-27, session 66, autonomous, branch `fix/146-150-money-path-hardening`, [open-questions #146](open-questions.md)) — the CODE side of this gate is now shipped:** `handleStripeEvent` (`src/billing/stripe-webhook.ts`) (1) only credits `checkout.session.completed` when `session.payment_status === 'paid'`, and (2) handles `checkout.session.async_payment_succeeded` (credits) + `checkout.session.async_payment_failed` (no-op/log). **REMAINING GATE before enabling any DELAYED-notification payment method (SEPA Direct Debit, Bacs/ACH, bank transfer, vouchers — NOT card or iDEAL, both of which settle synchronously):** the Stripe Dashboard webhook DESTINATION must be subscribed to the two async event types above — today it still only listens to `checkout.session.completed` (the 2026-07-04 note above), and Stripe never sends an event type a destination isn't subscribed to, so the new code paths stay dormant until that Dashboard change happens. This is a live config step, still owner-supervised, not done by this PR. Dormant + safe today because the account is card-only.**
- [ ] **Vercel: upgrade Hobby → Pro (~€20/mo)** before real payments go live — the Hobby tier's terms are for non-commercial use only; this can happen any time before go-live, it's the cheapest item on this list. **⚠ INSEPARABLE from the upgrade (same sitting, before any announcement): configure Spend Management with a monthly amount AND the opt-in "Pause production deployment" auto-action** — on Pro without that, on-demand usage is unlimited and bill-shock becomes possible for the first time (see the "Bill-shock protection" section below; audited 2026-07-18).

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
| `CRON_SECRET` | Vercel env store only (**✅ SET 2026-07-06, Production, marked Sensitive — WP16 go-live, session 28**) | Real secret you invent yourself: any long random string (password-manager generator). Vercel automatically sends it in the `Authorization` header of its cron requests; the onboarding cron route (`web/app/api/onboarding-cron/route.ts`) returns 503 when the var is missing and 401 on a wrong value — fail closed either way. Rotation: generate a new string → replace in Vercel → redeploy; no third party involved **⚠ Blast radius widened 2026-07-25 (#189): this secret now gates TWO crons — the onboarding job AND `/api/gdpr-purge-cron`, the GDPR retention purge. Removing it stops both, and the purge failing closed is silent by nature (it is a scheduled job nobody watches), so treat a `CRON_SECRET` rotation as also needing a purge-run check.** |
| `GDPR_PURGE_APPLY` | Vercel env store only (**NOT SET — deliberately; the purge cron ships DORMANT, 2026-07-25 #189**) | Not secret — the literal value `1`. **The only thing separating "reports what it would delete" from "redacts and deletes".** `/api/gdpr-purge-cron` runs monthly (`0 4 1 * *`) either way and logs a summary; while this is unset it writes NOTHING. **Supervised flip:** `vercel env add GDPR_PURGE_APPLY` → `1` → redeploy → trigger one run and read the counts in `vercel logs` against a `npm run gdpr:purge` dry run from the laptop; they must agree. Unsetting it is a COMPLETE rollback — nothing else in that route writes. Do NOT flip it in a deploy burst ([#173](open-questions.md)). |
| `RESEND_API_KEY` | Vercel env store only (**✅ SET 2026-07-06, Production, marked Sensitive — WP16 go-live, session 28; key "checkdecijfers-data-retrieved", Sending scope, separate from the Supabase SMTP key**) | Real secret. Resend dashboard → API Keys → create a key with **Sending access** scope → paste into Vercel (mark Sensitive) → redeploy. This is a SECOND key, separate from the one pasted into Supabase's SMTP settings (that one sends magic-link emails; this one lets the app itself send "je tabel is klaar" onboarding notifications). Without it the app still works — notification emails are skipped with a log line; the dashboard stays the source of truth |
| `ONBOARDING_ENABLED` | Vercel env store only (**✅ SET `1` 2026-07-06, Production — the WP16 master switch, WP16 go-live session 28**) | Not secret — the literal value `1`, now LIVE. While set, on-demand fetch is active. **Removing it is the instant kill-switch** — the deployed app then never constructs the table finder and behaves exactly as before WP16 sub-part 2 (the honest clarification), no rerank spend, no touch of the migration-012 tables, no code change needed. (Owner marked it Sensitive at set time — harmless; the value `1` is just hidden in the UI.) |
| `ANTHROPIC_TRIAL_API_KEY` | Vercel env store only (**✅ SET 2026-07-17 by the owner, Production, Sensitive — #53 go-live, session 52; key lives in its own Anthropic workspace with its own hard spend cap**) | Real secret, and deliberately a SEPARATE key from `ANTHROPIC_API_KEY`: Anthropic console → create a key **with its own hard spend cap** (the trial's outer belt — abuse can never touch the main budget) → paste into Vercel (mark Sensitive) → redeploy. Rotation: same as `ANTHROPIC_API_KEY` but only the Vercel store. Removing it (or `TRIAL_ENABLED`) is the trial's kill-switch — the homepage section disappears, nothing else changes |
| `TRIAL_IP_HASH_SECRET` | Vercel env store only (**✅ SET 2026-07-17, Production — #53 go-live, session 52; generated and piped straight into `vercel env add`, value never displayed anywhere**) | Real secret you invent yourself (password-manager generator, long random string). Used ONLY to HMAC visitor IPs for the per-IP trial limit — raw IPs never persist. Rotation: replace in Vercel + redeploy; consequence is benign (per-IP counts restart) |
| `TRIAL_ENABLED` | Vercel env store only (**✅ SET `1` 2026-07-17, Production — #53 go-live, session 52**) | Not secret — the literal value `1`. The trial master switch: while unset the whole homepage trial renders NOTHING (dormant, byte-identical landing). **Removing it is the instant kill-switch** |
| `SLOT_PHRASING_ENABLED` | Nowhere (**NOT SET — deliberately; the [#162](open-questions.md) slot-phrasing experiment ships DORMANT, hermetic half built 2026-08-28, session 66**) | Not secret — the literal value `1`. The number-free-phrasing experiment rung ([session-briefs/2026-07-19-adr-draft-slot-filling.md](session-briefs/2026-07-19-adr-draft-slot-filling.md)): while unset every compose call runs the see-and-echo ladder **byte-identically** (test-pinned). **Do NOT set it** until the owner-supervised A/B (slot-fixture recording via `npm run answer:record -- --slots`, blind pairwise phrasing judge + owner read-back, ~€1–2) has run and decided — the ADR-draft is not accepted and the slot fixture set is not yet recorded. Unsetting is a complete rollback (the legacy fixtures never left the repo) |

**Note on `NEXT_PUBLIC_*` vars and the Vercel env store (2026-07-04, production outage post-mortem):** this Vercel team enforces the **sensitive environment-variables policy** — every env var added to the project becomes write-only, no matter how it is added (dashboard or CLI; verified against the API: every var reports `type: sensitive`). Write-only is fine for real runtime secrets (`DATABASE_URL`, `ANTHROPIC_API_KEY`, `STRIPE_*` — Vercel injects them into the running functions), but it is **fatally incompatible with `NEXT_PUBLIC_*`** vars: those must be readable at *build* time, and our builds run in GitHub Actions via `vercel pull`, which receives sensitive values as **empty strings**. Result: the middleware was compiled with empty Supabase credentials and every route returned Internal Server Error — while the deploy job stayed green (a build succeeding says nothing about the app running; the CI deploy job now ends with a post-deploy smoke check for exactly this). The three public values therefore live in **`web/.env.production`, committed to git on purpose** (they ship in every browser bundle by design — same reasoning as the committed CA certificate, ADR 018). Never add a `NEXT_PUBLIC_` var to the Vercel env store expecting CI builds to see it, and never put a real secret in `web/.env.production`.

**Note on `web/.env.local`:** the chat UI (`web/`, its own fully independent npm project — ADR [018](decisions/018-chat-ui-and-deploy.md), it briefly started as an npm workspace and was split mid-session) is a separate Next.js project that loads its own env file rather than the root `.env` — it does **not** automatically see root's values. `web/.env.local` is gitignored, same as root `.env`. An earlier version of this file was a **symlink** to root `.env`, which seemed convenient but backfired the first time `vercel pull` wrote a Vercel-specific token *through* the symlink into the shared root file — fixed by making `web/.env.local` a real, independent copy. Which secret lives where is per-row above — do NOT assume "all three": as of 2026-07-11 (verified) `web/.env.local` holds ONLY the three `NEXT_PUBLIC_*` values; `ANTHROPIC_API_KEY` and `DATABASE_URL` live in root `.env` + Vercel (two places), and only need to be added to `web/.env.local` if you run the chat UI's full answer pipeline locally. There is no technical link keeping any of these in sync — follow the per-secret "Lives in" column at rotation time.

## Bill-shock protection — per-provider spend limits (audited 2026-07-18, session 54; owner asked after "woke up to a huge Vercel bill" stories)

**Measured conclusion first: on today's setup a surprise bill is structurally impossible.** The horror stories are
Vercel **Pro** teams with on-demand usage and NO spend cap configured — we are not that. Every provider was checked
against the live account (not from memory) on 2026-07-18; billing-rule claims verified against current official
docs the same day (sources in the session archive entry).

| Provider | Measured state (2026-07-18) | Can it bill us today? | Hard limit |
|---|---|---|---|
| Vercel | plan **hobby** (API-verified) | **No** — Hobby has no billing cycle at all; hitting a limit PAUSES the resource (~30 days), never charges. Verified: vercel.com/docs/plans/hobby | The plan itself is the cap |
| Anthropic (main key) | €25/mo workspace cap + billing alert (set 2026-07-02/04) | Only up to the cap — API pauses at the cap, no overage | ✅ set |
| Anthropic (trial key) | SEPARATE workspace with its own hard cap (owner-created, #53 go-live) | Only up to that cap | ✅ set |
| Supabase | org "stefan" plan **free** (API-verified) | **No** — Free needs no card; risk is pause-after-1-week-inactivity, not money | The plan itself is the cap |
| GitHub | repo **PUBLIC** (verified) → Actions minutes free/unlimited on standard runners | **⚠ Only via the 2026 gotcha below** | Owner check below |
| Resend | Free tier (3,000/mo, 100/day, no overage fee) | **No** if no card is on file — quota just stops sending | Owner confirm below |
| Stripe | test-mode sandbox; fee-per-transaction model | No (it takes fees from payments, it never bills usage) | n/a |
| Namecheap | fixed yearly domain fee | No usage component | n/a |

**App-level spend brakes that already exist (for the record):** anonymous trial = deterministic pot +
2 questions/visitor + 5/day/IP on a hard-capped separate key; authenticated chat = credits-gated; the cron route is
`CRON_SECRET`-gated fail-closed; the homepage charts are LLM-free behind a 30-min cache. Runaway LLM spend is
bounded twice (app logic + Anthropic hard caps).

### Owner actions (the only three things a session cannot click)

1. **GitHub — the one real 2026 change (do this one):** GitHub replaced the old "$0 spending limit by default"
   with **Budgets** (~Nov 2025). If a payment method is on file, metered overage now auto-bills UNLESS a budget
   with **"Stop usage when budget limit is reached"** exists. Our Actions are free (public repo), but check once:
   github.com/settings/billing → if a payment method is on file, create a Budget covering metered products at €0
   (or a few €) WITH the stop-toggle ON; if no payment method exists, nothing can bill and you're done.
2. **Resend:** resend.com dashboard → Billing: confirm plan = Free and no card on file. (Free cannot bill; this
   just confirms we're on Free.)
3. **Vercel (optional, free, availability-belt not money-belt):** the Hobby risk is the SITE PAUSING if bots burn
   the included allotment. Free mitigations on Hobby: Firewall → Configure → New Rule → action **Rate Limit**
   (Hobby: **1 rule/project**) and **Attack Challenge Mode** as the panic button (blocked traffic doesn't count
   toward usage).
   **⚠ The rule this entry used to suggest — "path starts with `/api/`" — spends the single free rule on the
   wrong target (corrected 2026-07-25, session 58B).** Next.js **Server Actions POST to the PAGE path, not to
   `/api/`**, and the anonymous trial's action is on `/`. So that rule would have covered the two routes that
   are *already* authenticated — `/api/onboarding-cron` (Bearer `CRON_SECRET`) and `/api/stripe/webhook`
   (Stripe signature verification) — while leaving **the only unauthenticated, LLM-spending endpoint in the
   product** untouched. With one rule available, target the trial: **request path `/` with method `POST`**,
   a per-IP limit in the low tens per minute (a real visitor sends at most 2). Rate-limiting GET `/` as well
   would also blunt [#186](open-questions.md)'s per-request DB cost, but weigh it against ordinary traffic
   first — the POST leg is the one that spends money. Monthly usage glance:
   dashboard → Usage (also on the maintenance-session standing agenda under "spend dashboards").

### ⚠ STANDING RULE — the day Hobby → Pro happens (the launch checklist item)

The moment we upgrade for real payments, the no-bill guarantee DISAPPEARS: on Pro, new teams get spend
*notifications* by default but usage continues unless a hard limit is manually configured. **In the SAME sitting
as the upgrade, before any announcement:** Team Settings → Billing → **Spend Management** → set a monthly amount
(suggestion: €40) → **enable the automatic "Pause production deployment" action** (it is OPT-IN — a notification
alone does not stop anything). If Supabase ever goes Pro: its **Spend Cap** (org Billing → Cost Control) is ON by
default — leave it ON. This rule is also welded into the Phase-1 checklist item above.

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

## Standing rule for schema-coupled code (added 2026-07-24, #154 lesson)

**Before shipping any change that both adds a migration AND reads/writes the new column in code: walk BOTH deploy
orders explicitly.** A design's "apply the migration later" claim is worthless the moment the code SELECTs the new
column on a hot path — pre-apply code then breaks every query (#154's brief claimed deploy-order-safe; measured
inverted at build time). For a purely ADDITIVE nullable column the safe order is: **apply the migration to prod
FIRST** (`npm run db:migrate`, owner-present window; the running old code ignores the new column), verify prod
still serves, **then** push the code. Plus the standard per-migration check when a migration adds a TABLE
(grants/RLS, migration-011 queries); a column on an existing RLS-locked table inherits its table's posture.

## Supervised live step — migration 024 error_log (NOT YET RUN; built session 66, 2026-08-27, autonomous; merged into `main` session 67, 2026-08-28, PR #110)

**⏳ TO RUN in the next owner-present window.** Migration `024_error_log.sql` (#65 / WP25: the durable,
insert-only production error log — catch sites in the chat actions, the Stripe webhook, the auth callback
and the #114 health route write to it) shipped FILE-ONLY per the house rule. Until this step runs, every
error_log write on production fails OPEN into `console.error` — exactly the pre-WP25 behavior, by design —
and the daily gdpr-purge cron reports its error_log leg as `skipped: 'table-absent'` (EXPECTED, not an
incident; the operator line says so itself).

Both deploy orders walked (the #154 standing rule above): **code-first (what actually shipped) is safe** —
every write site is fail-open and the retention job checks `to_regclass` before touching the table;
migration-first would also have been safe (an empty table nothing writes to yet). No flag exists for this
feature on purpose: fail-open IS the dormancy mechanism.

The step itself (owner present):
1. `npm run db:migrate` from the repo root (applies only what's missing; expect `024_error_log.sql`).
2. The standard per-migration check for a NEW table (migration-011 queries): `error_log` must show
   **0 `anon`/`authenticated` grants + RLS enabled, 0 policies** (migration-003 auto-lockdown).
3. Verify one write lands: hit `https://checkdecijfers.vercel.app/api/health` (should be 200 — it only
   writes on failure), then simply confirm `select count(*) from error_log` runs and returns 0+ rows;
   the first real production error after this step becomes the first row.
4. From then on: errors are queryable by the owner (`select occurred_at, source, message from error_log
   order by occurred_at desc limit 20`) — no more racing Vercel's log retention. Rows self-expire at 90
   days via the existing gdpr-purge cron (dormant-apply rules unchanged: the DELETE only runs once
   `GDPR_PURGE_APPLY=1`, same as every other leg — until that flag flips, the monthly manual
   `npm run gdpr:purge -- --apply` is what actually deletes).

## Supervised live step — migration 023 compensation-amount bound (NOT YET RUN; built session 66, 2026-08-27, autonomous; merged into `main` session 67, 2026-08-28, PR #101)

**⏳ TO RUN in the next owner-present window — low urgency: defense-in-depth, not a live gap.**
Migration `023_compensation_amount_bound.sql` ([#147](open-questions.md)) widens the existing
`credit_transactions_validate_compensation` trigger (migration 008, already widened by 013/018) to also
bound a compensation's credited `delta` to the magnitude of the debit it reverses. **Verified NOT
reachable through any live caller today** (`gate.ts`, `refundOnboarding`, `settleWebAddon` all already
compensate at or under the original debit) — this closes a gap for a FUTURE caller (an admin refund tool,
a hand-run fix), not a live bug.

The step itself (owner present): `npm run db:migrate` from the repo root. No new table, no new grants to
check — this only `CREATE OR REPLACE`s an existing trigger function, so there is nothing to verify beyond
the migration completing (the pinned tests already exercise the new bound hermetically). No production
behavior changes on apply — every live caller already stays under the new ceiling.

## Supervised live step — migration 025 table-eviction lifecycle columns (NOT YET RUN; built session 66, 2026-08-27, autonomous; merged into `main` session 67, 2026-08-28, PR #111)

**⏳ TO RUN whenever convenient — nothing downstream depends on it yet.** Migration
`025_table_eviction_lifecycle.sql` ([#110](open-questions.md)) adds two columns to `cbs_tables`:
`pinned boolean` (TRUE = eviction-exempt; the migration itself pins the full curated seed set) and
`last_queried_at timestamptz` (debounced to ~1 write/table/day, read by the eviction GC). Applying it does
**nothing observable** on its own — the eviction CLI (`scripts/table-eviction.ts`, `npm run tables:evict`)
only ever runs manually, there is no cron, and no on-demand-onboarded table is old enough yet to be a
real eviction candidate.

**⚠ Before ever running `tables:evict --apply` against a live table (not before this migration, but
before that later step) — two residuals a session-67 review found and logged, neither closed yet:**
[#195](open-questions.md) (the disclosed "+1 round-trip per served turn" cost is understated — the real
path is ~4-6x that, and the same probes that inflate the count also keep a table artificially "warm") and
[#196](open-questions.md) (a concurrent eviction can false-refuse a live query for the table it's
evicting — the guard only checks for an active onboarding job, not an in-flight read). Read both before
scheduling any automation on top of this.

The step itself (owner present): `npm run db:migrate` from the repo root, then optionally `npm run
tables:evict` (dry-run, no `--apply`) to confirm it reports the pinned seed set as exempt and everything
else as `never queried` (expected — `last_queried_at` starts NULL for every existing row until the query
executor's next write).

## Supervised live step — migration 021 applied (2026-07-24, session 55 continued, owner present)

**✅ DONE.** `npm run db:migrate` applied `021_observation_last_seen.sql` (adds
`observations.last_seen_batch_id bigint` nullable, FK → `ingestion_batches`; NULL = present in the latest sync —
exactly the pre-#154 behavior). Verified live: column exists nullable, `schema_migrations` records version 21,
0 marked rows, prod served 200 on the OLD code post-DDL (additive column invisible to it), THEN the #154 code
deployed (`cef42b2`, gate+deploy green). No new table ⇒ no grants/RLS step needed (inherits `observations`).

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
**[Update 2026-07-24, session 55: the cosmetic residual is FIXED — `/login` is now `force-dynamic` (commit `0cfbd3d`), so the header
renders and the route reads env vars per request. That also retires the "⚠ /login HTML is a FALSE NEGATIVE" caveat above: `/login` is
no longer statically prerendered. The `/geschiedenis`-redirect signal still works and remains the belt-and-braces check.]**

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

## ⚠ Supabase free tier: 15 SESSION-MODE connections — deploy bursts exhaust it (measured 2026-07-25)

**Measured live, session 56.** After five production deploys inside ~an hour, the pooler refused new
connections with `(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to
pool_size: 15` — from a local script AND from production functions. Consequences observed on prod:

- `GET /llms.txt` → **503** with its honest fail-safe body for ~6 minutes;
- the homepage **Ontdek charts silently omitted** (`[ontdek] charts unavailable, serving previous set if
  any`) while `/` still served 200.

**Both surfaces degraded exactly as designed** — an honest 503 and an omitted section, never stale or
invented data. It SELF-HEALED once the extra function instances were **torn down** and their sessions
released; nothing had to be restarted. (This sentence used to say "went idle and their sessions were
reclaimed". That mechanism is **measured wrong** — see the bullet below: idleness alone does not release
a session, so the recovery clock is instance lifetime, not an idle timer.)

What to know:
- **Each deploy spins up new function instances, and each opens its own pg pool.** Several deploys in
  quick succession therefore stack sessions against a hard ceiling of 15 (free tier, session mode).
- **Diagnose it** with the management API (it does NOT go through the pooler, so it still works when the
  pooler is full): `select count(*) from pg_stat_activity where application_name like 'Supavisor%'`, or
  simply `vercel logs <prod-url>` and grep for `EMAXCONNSESSION`.
  **This recipe was VERIFIED 2026-07-26** (session 59, #186): application sessions really do report
  `application_name = 'Supavisor'`, so the count is the number of the 15 slots in use. Add
  `, state, now() - state_change as idle_for, left(query, 60)` to see WHICH query each slot last ran —
  that is what identified the landing's pot read as the holder.
- **⚠ A session is NOT released after ~10 seconds.** An earlier version of this section (and
  [#186](open-questions.md)) said idle instances release on node-pg's 10 s `idleTimeoutMillis`, and that
  the incident self-healed that way. **Measured false 2026-07-26:** one anonymous homepage GET left a
  Supavisor backend **idle for 174 s and counting**, and 4 of the 15 slots were held (72-174 s) at a
  quiet hour from about two page views. The timer does not fire while a Fluid Compute instance is
  **frozen** between requests — the slot comes back when the instance is torn down. Practical
  consequence: after a burst, wait **minutes**, not seconds, before concluding anything, and treat
  "sessions held" as roughly "instances alive recently", not "requests in flight".
- **Know the baseline before you read the number.** Sampled twice at a quiet hour on 2026-07-25
  (22:54 and 23:29 Amsterdam, no deploy, essentially no human traffic): **4 of the 15 slots were held
  both times**, individual sessions living up to **447 s**. So ~27% of the pool is occupied by ordinary
  drive-by traffic before any deploy stacks on top — "4 sessions" is normal, not a symptom.
- **The cheapest structural relief is to make a page need fewer queries.** Since #186 the landing's pot
  read is served from a 20 s in-process cache (`TRIAL_POT_TTL_MS`, `web/lib/trial.ts`), and since #184
  the two limit counts share one round trip — so a steady-state anonymous render costs **one** query,
  cookie or no cookie, down from 1-2 (the render that refreshes the pot costs two, at most once per
  TTL per instance).
- **The public landing now DEGRADES under saturation instead of hanging** (#190(b), 2026-07-26). Both
  anonymous reads are bounded at 5 s (`ANONYMOUS_READ_DEADLINE_MS`, `web/lib/deadline.ts`): the trial
  gate falls back to the login nudge, the Ontdek section to its stale set or to nothing. Before this
  they simply WAITED — the fail-safe engaged on errors and never on waits, so during the 2026-07-25
  incident a visitor got a page that never finished rather than the honest degrade designed for it.
  ⚠ It does NOT free the pooler session: a race does not cancel the query, so the client stays checked
  out until the work finishes. It buys the VISITOR, not the connection — the connection fix is still
  transaction-mode pooling, (b) below.
- **Do not panic-restart anything.** Wait a few minutes and re-check `/llms.txt`; that is the cheapest
  canary because it needs a fresh connection on a cache miss.
- **Avoid stacking deploys** when you can — batch doc commits instead of pushing each one, and leave a
  couple of minutes between a code push and a live smoke.
- Running `audit:verify`, `catalog:refresh` or any `node --env-file=.env scripts/…` from a laptop takes a
  session from the SAME pool of 15. Do not run them during a deploy window.

**Structural fix — option (c) is DONE, option (b) stays open** (#173):

- ✅ **(c) smaller per-instance pool — done 2026-07-25** (autonomous session 57). `src/db/client.ts` now
  caps each process at **2** pooler sessions instead of 4, pinned by `tests/db/pool-config.test.ts` so a
  later bump has to argue with a failing test. Doubles the number of processes that fit under the 15:
  four busy processes used to be able to exhaust the project on their own, now it takes eight. This is
  a *headroom* change, not a cure — a big enough deploy burst still hits the ceiling.
- ⬜ **(b) transaction-mode pooling — still open, and still the real fix.** It multiplexes far more
  clients per connection, but the billing gate and the onboarding trigger both use
  `pg_advisory_xact_lock`, and the ingestion staging step relies on session-scoped temp tables. Those
  have to be checked one by one before switching. Owner's call, supervised.
- Deliberately NOT changed: `connectionTimeoutMillis` stays at node-pg's default (wait indefinitely for
  a free client). A bounded wait turns pool contention into a thrown error, and one place that error
  could land is between a committed credit debit and its compensating refund — a money-path failure
  mode, not a capacity knob. Reasoning is written into `src/db/client.ts` beside the setting.

The ceiling itself is a free-tier property; a paid tier raises it but does not remove it.

## WP26 answer-first + clickable options — the supervised go-live (built session 56, 2026-07-25; `CLARIFY_CLICK_ENABLED` ✅ LIVE 2026-09-02 + smoke test ✅ PASSED 2026-09-03, session 71; `ANSWER_FIRST_ENABLED` NOT YET)

Two INDEPENDENT flags, both dormant. Either can go live first and roll back on its own — deliberate,
so a problem with one mechanism never forces the other off.

| Flag | What it turns on | Blast radius when on |
|---|---|---|
| `CLARIFY_CLICK_ENABLED=1` | Clarification options carry a pre-verified intent; a reply byte-equal to an offered label resolves deterministically (no LLM). Chips render on clarifications. | Reply turns only. Worst case: a chip is missing (an option failed its dry-run) — never a wrong answer. |
| `ANSWER_FIRST_ENABLED=1` | A question with no region (on a measure with a national row) answers nationally; a question with no period at all answers with the recent trend. Both disclosed in-sentence. | **First turns AND clarification-reply turns** (corrected 2026-08-07 — this cell said "First turns" and that was measurably wrong; see #191 below). Questions that used to clarify now ANSWER — the biggest visible behavior change of the two. |

✅ **[#191](open-questions.md) is FIXED (2026-08-07, session 61) — the pre-flip blocker is cleared.**
It was recorded as "the reply turn never receives the flag", but measurement showed something worse: the
reply turn ran **half** of mechanism B, a state nobody chose. B has two axes in two different layers —
**B-region** lives in the QUERY layer (`src/query/resolve.ts:393`) and already reached reply turns through
the `{ ...options }` spread into `respondToIntent` (`respond.ts:652`), while **B-period** lives in the
INTENT layer (`src/answer/intent/resolve.ts:731`) and is fed by the `ClarifyReplyOptions` bag that
`respondToClarificationReply` built without the flag. So with the flag on, a reply turn silently defaulted
the REGION the user never mentioned and then REFUSED over the PERIOD it was allowed to default.

Measured on the hermetic fixture DB, flag ON, before the fix: first turn → **answer**, reply turn →
**refusal (`still_ambiguous`)** on the same intent. After the fix both **answer**. Pinned by
`tests/answer/answer-first-reply-turn.test.ts`, whose load-bearing case asserts the two turns AGREE rather
than asserting a particular verdict.

Why defaulting is the right answer, not merely the convenient one: **R7's third branch**
([05-data-rules.md](05-data-rules.md)) authorizes filling in a structurally-determined axis under four
conditions and draws **no first-turn/reply-turn distinction** — the safelist is code, not configuration —
so applying it to one axis and not the other was an invariant conformance gap. And a reply is the LAST
round by rule (R7: a reply never asks again), which makes it the turn where refusing costs the most.

⚠ **Flip a flag only when the last deploy has SETTLED** (see the connection-ceiling section directly above):
each flip triggers a redeploy, and both mechanisms add DB work per request — B-region an existence probe on
a region-less question, B-period a window query. On the 15-connection free tier, flipping both during a
deploy burst is the wrong moment. Check `/llms.txt` is 200 first; it is the cheapest canary.

Steps (owner present):
1. `git log --oneline -1` on prod — confirm the deploy carrying commits `8ee71c8`/`37a3c55`/`1a99b3d`/`1a4ca89` is live.
2. Flip ONE flag: `vercel env add <FLAG>` (Production) `= 1`, then redeploy. **Not both at once** —
   if something reads wrong you want to know which mechanism did it.
3. Live smoke, LLM-free where possible: ask a period-less question ("Hoeveel inwoners telde
   Amsterdam?") and a region-less one ("Hoeveel inwoners telde Nederland?" on a geo measure).
   Confirm the disclosure sentence renders DIRECTLY UNDER the answer body, and that the answer's
   numbers still match the cells (`npm run audit:verify -- <row> <row>` → exit 0).
4. For the click flag: ask something that clarifies — use the flagship case
   `Hoeveel inwoners had Utrecht in 2024?` (Utrecht without "gemeente"/"provincie" is ambiguous, so it
   clarifies with the chips "Utrecht (gemeente)" / "Utrecht (provincie)"). NOT the single word
   "Utrecht": that is no statistics question, the intent parser refuses it as smalltalk (measured in
   production 2026-09-03, audit row 260, refunded) and no chips appear. Confirm the chips appear, click one, confirm the answer arrives and the audit row records
   `model = deterministic/wp26-click-option` with zero token usage. **Where that model lives:** in the stored
   envelope, `response->'parse'->>'model'` — NOT in the promoted `llm_calls` column, which is `[]` on a click
   take because no LLM was called (a `llm_calls::text like '%wp26-click-option%'` query is a false negative —
   session 70 used it, and it happened to be right only because there were no takes yet). Read-only check:
   `select id, reply_text, input_tokens, answer_source from audit_answers where response->'parse'->>'model' =
   'deterministic/wp26-click-option'`. Measured first pass 2026-09-03 (session 71): row 261 = the clarification
   (`pending_clarification.clickOptions` = "Utrecht (PV)" / "Utrecht (gemeente)", 10 credits net), row 262 =
   the click ("Utrecht (gemeente)", 0 tokens, `template`, 20 credits, `audit:verify` 2/2 clean).
5. Watch the first day's rows: `answer_source = 'template'` on clicked answers is EXPECTED
   (ADR 024 — a clicked take composes without the LLM and therefore reads plainer).
6. **#197 step 3 (once its branch is merged):** ask a gemeente question that answers ("Hoeveel inwoners
   had Amsterdam in 2024?"), confirm a "Vergelijk met Nederland" chip under the answer, click it, press
   Verstuur: the answer must be a TWO-bar comparison (Amsterdam + Nederland, same period), 20 credits, and
   the audit row again `model = deterministic/wp26-click-option` with zero tokens and
   `reply_text = 'Vergelijk met Nederland'`. Typing anything else instead of the chip must be answered as a
   fresh question. Rollback of the flag makes these chips disappear on new answers; a chip still open in a
   tab is then parsed as a fresh question (it may refuse — same as the rescue chip, below). The same
   fresh-parse fallback applies during the deploy window itself: a tab still running the OLD bundle never
   reads the answer's carrier, so a comparison chip clicked there goes through the ordinary question path
   until the tab reloads — one ordinary charge, never a wrong number.

Rollback: unset the flag and redeploy — fully dormant again. Rows written while it was on stay
valid for R8: the disclosure re-derives from the stored result's own flags, not from the flag state.

⚠ A pending clarification offered while `CLARIFY_CLICK_ENABLED` was on, and replied to after it was
turned off, simply falls through to the normal LLM merge — today's behavior, no error. **Two corrections
to that sentence, from the adversarial review of 2026-07-25 (session 57) — read them before you roll back:**

- **A RESCUE pending (WP26c) is the exception.** It is not an open round, so after the flag goes off a
  reply to it is answered as a FRESH question rather than merged. That is deliberate and it keeps working
  after a rollback — the reply-turn branch is gated on the pending's SHAPE, not on the flag, exactly so an
  open tab keeps behaving correctly. What you should expect: a rescue chip clicked after the rollback is
  parsed as a normal question (one normal charge, and it may well refuse again, since the chip's label is
  a sentence and not a question).
- **⚠ ROLLBACK ORDER, stated plainly: turn `CLARIFY_CLICK_ENABLED` off FIRST, leave `ANSWER_FIRST_ENABLED`
  on for a day, and only then turn `ANSWER_FIRST_ENABLED` off.** Never the other way round.

  Why. A chip offered for a question that named no place carries an intent with no region in it. It was
  proven servable by the B-region national default — and that default is applied at QUERY time, gated on
  `ANSWER_FIRST_ENABLED` *at the moment of the click*, not at the moment of the offer. So the instant B goes
  off, every such chip still sitting in someone's open tab becomes a guaranteed still-ambiguous refusal:
  the paid dead-end, on exactly the chips that promise to prevent it.

  Turning A off first does not delete those chips either — but with B still on, a click falls to the normal
  LLM merge, which resolves to the same region-less reading, gets the national default, and **answers**. A
  day later the tabs are gone and B can go off harmlessly.

  ⚠ **"Both at once" is NOT a safe shortcut**, contrary to what an earlier version of this line said: with
  both off, the merge produces the same region-less intent, hits the same refusal, and has now also spent an
  LLM call to get there. Harm is bounded in every ordering — the reply turn is refunded and no wrong number
  is ever served, though the original clarification's 10 credits stay spent — but only A-first actually
  avoids it.

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
5. **Seed the pot small:** `npm run trialpot:set -- 25`. The trial opens without a deploy — but since
   [#186](open-questions.md) the landing serves the pot from a **20 s in-process cache**
   (`TRIAL_POT_TTL_MS`, `web/lib/trial.ts`), so **if the first reload still shows the old state, wait
   ~20 s and reload again before concluding anything failed.** The script prints this reminder itself.
   Each instance has its own cache, so two reloads can even disagree for a moment.
6. **Live smoke:** one real anonymous trial question (private browser window) → answer with R4 attribution;
   check the audit row (`source_tag = 'anonymous_trial'`, `user_id` null) and the `trial_questions` row
   (linked `audit_answer_id`); watch the Anthropic console: the call landed on the TRIAL key.
7. **Refill/close later:** `npm run trialpot:set -- <n>` (0 closes it; the UI degrades to the login prompt
   automatically, within the ~20 s cache window from step 5). Optional owner-side hardening outside the
   repo: Vercel Firewall rate rules (ADR 036 D2) — and note the rule must target **`POST /`**, not
   `/api/`, because Server Actions POST to the page path.

## ⚠ Two CI runs in flight on `main` — the LAST deploy to finish owns production (measured 2026-09-03, session 71)

Every push to `main` runs `gate` and then `deploy`, and `deploy` aliases **its own commit** to
`checkdecijfers.vercel.app`. Two runs overlap whenever a second push lands while the first is still in
its ~15-minute gate — typically a docs-only push right after a merge. Whichever deploy job finishes LAST
wins the alias, regardless of commit order. Measured: the docs commit `2d27175` (pushed 00:26Z) finished
its deploy at 00:44Z, one minute AFTER the merge `83f790e` (pushed 00:31Z) had gone live, and production
silently went back to the pre-merge code while both runs showed green.

Since session 71 (2026-09-03, the commit that added this section) the deploy job checks `git ls-remote origin main` first and **skips every deploy
step when its commit is no longer the tip** (the newer commit's own run deploys it; the stale run stays
green because its gate verdict is still real). Runs started before that commit do not have the guard.

How to see it: `vercel inspect https://checkdecijfers.vercel.app` gives the deployment id/url that holds the
alias; the deploy job's log of each run prints the SHA it shipped (`gh run view <run> --job <deploy-job>
--log | grep -o '<sha>'`). Fix, instant and reversible: `vercel promote <deployment-url> --yes` with the URL of
the deployment built from the newest commit (the `vercel deploy` line in that run's deploy log). Habit that
avoids it entirely: after a merge, let its run finish before pushing anything else.

## Resuming after a long pause (written 2026-08-15, at the ~2-month halt)

**✅ RUN 2026-08-26 (session 62, autonomous) — ~11 days into the pause, not the full ~2 months, by owner
request.** All 7 steps below were worked in order; results in the session-62 entry in
[status-archive.md](status-archive.md) and
[session-briefs/2026-08-26-session-62-resume-log.md](session-briefs/2026-08-26-session-62-resume-log.md).
Kept below unmodified as reusable guidance for any future pause — nothing here stopped being accurate, it's
just now also a completed record.

The project was paused **2026-08-15** by owner decision, expected back **~2026-10-15**, and the GitHub repo
was set **private** at the same time. Production was left **live** (`/llms.txt` and `/` both 200). Work
through this in order — the first item has a deadline, the rest are checks.

1. **`date +%Y-%m-%d` FIRST, before reading anything else.** Two sessions running have outlived their own
   dates (session 60 spanned 12 days, session 61 spanned 8). Every measured number in `docs/` is stale until
   re-measured; treat the whole tree as a historical document until you have re-derived what you act on.

2. **⚠ THE GDPR CLOCK — deal with this before PR #85, before anything.** Three clocks run off
   `npm run gdpr:purge` (see the maintenance section above): account audit rows redact at 2 years,
   `anonymous_trial` audit CONTENT redacts at 90 days, and `trial_questions` bookkeeping (visitor UUID +
   HMAC'd IP) is **DELETED** at 90 days. The first rows became purgeable **~2026-10-15**, i.e. right at the
   end of this pause, and **`GDPR_PURGE_APPLY` was left OFF**, so the monthly cron has been reporting and
   deleting nothing the whole time. **Run the purge in report mode first and read what it says it WOULD
   delete**, then set `GDPR_PURGE_APPLY=1` (owner action) and do one watched run. If the answer is "there is
   nothing to purge because nobody used the trial", that is a fine answer — but it must be MEASURED, not
   assumed, because it is the one promise that kept running while the project did not.

3. **Re-sync CBS before trusting any answer.** No sync ran during the pause; CBS publishes BBP quarterly and
   PPI monthly regardless. Expect several releases' worth of drift. The staleness net behaves correctly
   (recency questions REFUSE rather than serve old numbers; covered historical periods warn-and-serve), so
   the product is not lying — it is just increasingly unable to answer. ⚠ **Read step 6 (release-day sync)
   before running one**: diff the CBS code lists read-only first, then sync **with** `--accept-new-codes`.
   Several releases' worth of new period codes will be waiting, and a bare sync quarantines the table.

4. **Check the money path and the spend.** The anonymous trial and Stripe were live and unwatched. The trial
   pot is hard-capped so exposure is bounded, but verify: the pot balance, the Anthropic workspace spend, and
   any Stripe activity. Nothing should have moved if nobody visited — confirm that rather than assume it.

5. **Dependency backlog.** Dependabot kept opening PRs throughout. Expect the three that were open
   (#80/#81/#82) to have gone stale or conflicted, plus new ones. ⚠ Re-verify locally before merging — CI's
   `gate` deliberately does not run `next build` (it is hermetic; `next build` fetches fonts over the
   network), so a build-breaking bump only shows up in `deploy`, after merge.

6. **The repo is PRIVATE now.** Consequences: GitHub Actions minutes come out of the account quota instead of
   being free (irrelevant while paused, relevant again once pushes resume — watch the billing page), and
   every `github.com` link to this repo 404s for anyone not signed in as a collaborator, which reinforces
   rather than replaces [#132](open-questions.md) interim rule (i). Verify the **Vercel↔GitHub integration
   still deploys** on the first push back: the integration holds its own repo access, and a visibility change
   is exactly the kind of thing that can silently invalidate it. Do that with a trivial docs commit, not with
   a real change.

7. **Then the normal queue** — [session-briefs/2026-08-07-session-62-kickoff.md](session-briefs/2026-08-07-session-62-kickoff.md),
   starting with PR #85 (which carries the WP26 pre-flip blocker fix).

## Multi-agent autonomous sessions — worktree/subagent operational gotchas (added session 66, 2026-08-27→28)

Session 66 ran a whole queue's worth of work (16 PRs from the queue, plus its own wrap-up PR — 17 total)
through parallel worktree-isolated subagents on this 8GB machine. Five patterns worth knowing before the next session does the same, promoted here from
memory (per CLAUDE.md's "durable knowledge lives only in the repo" rule) rather than left as a
per-machine cache:

1. **A dispatched agent reporting "stalled: no progress for 600s" is usually still fine — it means the
   ORCHESTRATING harness ended that agent's turn while it idle-waited on a long-running background
   command (`npm test`/`benchmark:run`/`web:build`, each 5-40 min here), not that work was lost.** All
   worktree state, including the eventually-completed command's real output, survives. **Resume it with
   SendMessage — never restart it, and never start driving the same worktree yourself in parallel with
   it** (git handles a genuine race safely, but it is not something to rely on — pick one driver per
   worktree and stick with it). Expect 3-4 resume cycles per agent to be normal on a task with a full
   verification block, not a sign of trouble.
2. **Never run more than one vitest process at a time anywhere on this machine — not just to avoid OOM,
   but because concurrent vitest runs can break vitest's own worker pool**, with its own distinct failure
   signature (`[vitest-pool-runner]: Timeout waiting for worker to respond`, `Failed to start forks
   worker`) that reads exactly like a real regression until you notice three suites were running at once.
   Re-running the SAME suite alone, once nothing else is running, has cleared it every time it's been hit.
   This generalizes the existing "8GB machine, run solo" rule — it now also applies ACROSS worktrees, not
   only within one process.
3. **A fresh worktree created for a subagent can end up with an incomplete `node_modules` (root or
   `web/`) — check before trusting a test failure.** `ls node_modules | wc -l` should read ~70 in the
   repo root and ~380-500 in `web/`; if either is far below that (single digits has happened), run `npm
   install` (or `npm install` inside `web/`) before treating any test failure in that worktree as real.
   The failure mode is misleading: MOST tests still pass (Node's module resolution walks up to the parent
   repo's `node_modules`), so it looks like an isolated, real bug rather than a missing-dependency
   artifact.
4. **When several autonomous branches build in parallel, each one's first new migration file will often
   independently claim the same "next free" number** (nothing on a separate branch can see another
   branch's uncommitted file). This is expected, not an error — catch it before pushing (check the
   highest migration number across ALL sibling branches you know about, not just `main`) and renumber.
   Session 66 hit this four times in one run (four branches all reaching for `022`); final numbers ended
   up 023/024/025, each noted in its own PR description.
5. **A shared scratchpad path can silently collide between two agents running at the same time.** If you
   brief multiple parallel agents that might write to a common scratch directory, tell each one to use a
   distinctly-named file (its own task slug or agent id as a prefix) rather than a generic name like
   `notes.md` or `pr-body.md`.

## Reviewing and merging a large PR batch (added session 67, 2026-08-28 — reviewed + merged all 19 open PRs left by session 66)

1. **Review in parallel, merge in serial.** The review pass (does each PR actually do what it claims,
   any invariant risk) is read-only and independent per PR — fan it out (19 agents this session: 13
   normal-effort, 4 adversarial/high-effort on the flagged risky ones, 2 low-effort on Dependabot). The
   MERGE itself must stay sequential — it mutates shared `main`, and merge order changes what conflicts
   with what.
2. **Before picking a merge order, check actual file overlap (`gh pr diff <n> --name-only` for every open
   PR), not just PR titles.** This session's kickoff assumed "no fixed order needed" for most of the 19;
   the file-overlap scan found three real code clusters (the `compose.ts` trio, the ingestion-pipeline
   pair, the `actions.ts`/webhook trio) that needed a deliberate foundational-first order, plus several
   more that shared `open-questions.md`/`STATUS.md` insertion points (docs conflicts, always mechanical).
3. **`gh pr merge <n> --squash --delete-branch` first; only fall back to a manual worktree merge on the
   `GraphQL: Pull Request has merge conflicts` error.** Most merges in a same-base batch resolve cleanly
   server-side even when they touch the same file, as long as they don't touch the same LINES — don't
   pre-emptively hand-merge everything just because two PRs share a file.
4. **The manual-conflict recipe, when it's needed:** `git worktree add /tmp/wt-prNNN <branch>` (isolated,
   never the shared checkout) → `git merge origin/main --no-edit` to surface the real conflicts → resolve
   by hand (prefer the objectively more-accurate/more-complete side on a real content conflict, same rule
   as the historical PR #94 resolution) → `git add -A && git commit --no-edit` → `npm ci` (root AND
   `web/`, a fresh worktree has neither) → typecheck both + the specifically-affected test files + the
   broader suite one level up (e.g. all of `tests/answer/` when the conflict touched `compose.ts`) → push
   → remove the worktree → wait for that PR's own CI to go green → THEN `gh pr merge`.
5. **A textually-clean auto-merge can still be semantically wrong when two PRs both add a field to the
   same interface/type.** This session's adversarial review pre-emptively caught it: merging #113 after
   #102+#103 needed not just a conflict resolution but two test-file fixes the git merge itself couldn't
   flag — a hardcoded member-count assertion (`tests/audit/envelope-key-manifest.test.ts`) and a
   hand-rolled text-reassembly helper that didn't know about a sibling PR's new field
   (`tests/audit/slot-phrasing-r8.test.ts`'s `rebuildTexts()`). Running the review's own merge-simulation
   BEFORE starting real merges (fetch both branches into a scratch worktree, merge-simulate) found this in
   advance — worth doing for any PR the review flags as touching the same file as another open PR.
6. **Back-to-back merges do NOT cancel each other's CI — this repo's `ci.yml` has no `concurrency:`
   group.** Five isolated/low-risk merges in a row each kicked off their own independent full-gate run; all
   five completed, none was cancelled by the next push. Convenient for a safe batch (docs-only, no shared
   code), but it means N merges = N full CI runs' worth of Action minutes — worth waiting for one merge's
   CI before the next once the PRs start touching real code, both to avoid wasted minutes on a run that
   will be superseded before it finishes mattering, and because only the LAST run in a burst actually
   validates the full combined state.
7. **`checkdecijfers.nl` is NOT the production URL — it resolves to Namecheap's default parking
   nameservers and is used only for `mail.checkdecijfers.nl`'s Resend DNS records.** The real production
   URL is `https://checkdecijfers.vercel.app` (this RUNBOOK already said so; the mistake was not checking
   before curling). A canary check against the wrong host times out at the TCP level (never even reaches
   an HTTP response) rather than 404ing, which can look alarmingly like a real outage — verify the actual
   deployed domain via `get_project`'s `domains` field (or this doc) before treating a failed canary as a
   production incident.
8. **`gh pr view <n> --json mergeable` stayed `UNKNOWN` for every PR checked this session, even well after
   the PR was created — this is now the expected steady state on this repo, not a transient race
   (confirms and hardens session 65's same finding).** Never gate a merge attempt on this field resolving;
   just call `gh pr merge` and read ITS result.

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
1. Re-validate identifiers LIVE against v4 `MeasureCodes` on `datasets.cbs.nl` (the brief's names can be v3 column names — the `Consumentenvertrouwen_1` trap) and cross-check frozen-key values on BOTH platforms. **Also probe for PHANTOM measures ([#167](open-questions.md), found on 85880NED — 17 of 210):** compare the fixture/live distinct-measure set in Observations against MeasureCodes (or probe suspects with `$orderby=Perioden desc&$top=1`); any code with ZERO rows table-wide goes in the seed's `excludeMeasures` with its title as a comment — without this the per-measure plausibility check quarantines a fully healthy ingest. **For SLICED tables probe per measure WITHIN the registered slice first** (session 53, found on 85828NED: the 7 Productie-measures exist table-wide but have zero rows for the retail branches — slice-EMPTY, same quarantine, same `excludeMeasures` cure; probe table-wide only to classify phantom vs slice-empty, docs/11 quirk #4).
2. Code: `COVERAGE_TABLES` seed entry + registry defaults + canonical measures (`src/registry/defaults.ts`) + `AVAILABLE_GRAINS` keys + fixtures (`node --import ./scripts/force-ipv4.mjs scripts/capture-cbs-fixtures.ts <id>` + `--catalog-add <id>`) + `tests/fixtures/cbs/conformance.json` entry + CC verification tasks in `benchmark/coverage-key.json` scored by `tests/query/coverage-key.test.ts` (docs/05 onboarding rule). **⚠ `--catalog-add` can invalidate FINDER fixtures (measured session 53): when the new table's topic overlaps a labelled finder case, the added rows shift the Stage-1 shortlist in the sampled `_catalog.json` and the recorded rerank fixtures miss on hash → those cases drop to failure-safe `disclose` (4 of 11 cases on the #4-#9 batch). Schedule `--catalog-add` together with a `tablefinder:record` re-record (LLM spend, owner-present) — in a spend-free prep session, leave the catalog fixture untouched.**
3. **A vocab addition re-hashes ALL ~93 intent/followup/clarify/delivery LLM fixtures ([#164](open-questions.md))**: clear those four `tests/fixtures/llm/` dirs first (the record scripts do NOT remove stale hash files), then `intent:record` / `followup:record` / `clarify:record` / `onboarding-delivery:record` (Haiku-tier, sub-euro, owner-approved spend) + `intent:eval -- --repeat=3` (expect zero flips) — group multiple tables into ONE re-record.
4. Full verification block + `/code-review` low + push; after green CI the live step: `node --import ./scripts/force-ipv4.mjs --env-file=.env src/ingestion/cli.ts sync <id>` (auto-registers) + `npm run registry:apply`, then an LLM-free spot-check of the frozen-key cell(s) with `node --env-file=.env scripts/spot-check-canonical.ts <key> <periodCode>` (committed session 50; exit 0 = answer printed, exit 2 = refusal shown). **Run `registry:apply` only AFTER the CI deploy job is verified live** (max-review #166 finding 8, 2026-07-17): the live chat parses with the COMPILED `CANONICAL_MEASURES` constant — a curated DB row whose key is not in the running bundle (apply-before-deploy, or a rollback after apply) makes the #166 belt suppress auto-derivation for a measure the delivery re-run then can't parse → guaranteed refund-loop for that table until code and DB agree again.
5. **Slow-stream escape hatch (session 50, measured on 85880NED):** CBS's UNFILTERED v4 Observations stream can serve at ~6KB/s from a local network with mid-body terminations — a big-table live sync then fails at the fetch stage after ~3×45-min attempts (fetch failures do NOT quarantine; the table just stays unsynced). Fix: fetch the table in PARALLEL per-dimension chunks (each connection gets its own bandwidth; 5 SoortMutaties chunks = 99,676 rows in ~6 min): copy the table's metadata files into a work dir, run `node --import ./scripts/force-ipv4.mjs scripts/capture-observations-chunked.ts <id> <partitionDimension> <dir>` (committed session 50; one worker per code of the chosen dimension, verbatim pages + manifest), then `node --env-file=.env scripts/sync-from-capture.ts <id> <dir>` — the SAME pipeline/validators/batch bookkeeping, only the transport differs; that script refuses a capture not made the same day. ~~⚠ Expect this for every 85880NED release-day sync (incl. ~30/7) until the slow stream turns out network-specific.~~

   **⚠ BOTH HALVES OF THAT LAST SENTENCE ARE NOW MEASURED FALSE (2026-08-07, the ~30/7 release sync).** Corrected, because this step is operational guidance and a session following it as written would have made things worse:
   - **The slow stream WAS network-specific.** The direct `ingest sync 85880NED` fetched **100,240 rows in 77 s**. Do NOT reach for the hatch by default — **try the direct sync first**; a fetch failure does not quarantine, so the attempt is free. Reach for the hatch only when the direct fetch actually stalls.
   - **✅ [#192](open-questions.md) FIXED 2026-08-07 (session 61) — the hatch can now complete a release sync.** It previously called `syncTable(db, source, tableId)` with **no options bag**, so `acceptNewCodes` was permanently false and unreachable from its CLI, while every CBS release brings a new period code by definition. Following this step on a release day would fail `dimension_mapping`, set the table to `needs_review`, and (quarantine being enforced on the value path) make it **refuse in production** — it had only ever been used for FIRST-TIME registration, where nothing is new. It now accepts `--accept-new-codes` and `--rebaseline` with the same spelling and the same never-implicit defaults as `ingest sync`, and on a bare `dimension_mapping` failure it prints the recovery command instead of leaving you to work it out. Pinned by `tests/ingestion/sync-from-capture.test.ts`, which drives the script's own exported entry points (driving `syncTable` directly would have proven the pipeline works and said nothing about the entry point that was broken).

6. **Release-day sync procedure (added 2026-08-07 after the ~30/7 syncs; read this BEFORE running one).** A release always adds a period code, and a bare sync therefore does not "play it safe" — it quarantines the table and takes it out of service. Order:
   1. **Measure**: `curl -s https://datasets.cbs.nl/odata/v1/CBS/<id>/Properties` → compare `Modified` against `cbs_tables.last_sync_at`. Nothing newer ⇒ nothing to do.
   2. **Diff the code lists read-only, per dimension**, CBS (`…/<Dimension>Codes`) against `dimension_labels`. This IS the "reviewed mapping update" the guard demands — do it before, not after.
   3. If the only delta is the expected next period (and nothing was removed): `node --env-file=.env src/ingestion/cli.ts sync <id> --accept-new-codes`. **With the flag from the start.** Anything else — removed codes, a new non-period code, a changed schema fingerprint — is a genuine stop: report it, do not force it.
   4. If the table is ALREADY `needs_review`, the pipeline refuses to sync it without `--rebaseline` as well. That is a re-baseline of dimensions/units/fingerprint, but nothing persists unless all five validators pass, so a failed rebaseline leaves the registry untouched. Check the fingerprint afterwards: **unchanged ⇒ it was a pure quarantine clear**, changed ⇒ the schema really moved and deserves a look.
   5. **Verify LLM-free**: `node --env-file=.env scripts/spot-check-canonical.ts <key> <periodCode> …`, and re-check the table's frozen reference values in [11-coverage-table-set.md](11-coverage-table-set.md) — **they can legitimately move**, see [#193](open-questions.md).

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
- **Stale merged-PR branches accumulate because `delete_branch_on_merge` is `false` on this repo**
  (checked 2026-08-27, session 64) — dozens of local + remote branches for long-merged PRs are still
  sitting around (`fix/191-...`, `refactor/shared-intent-options`, old `ops/173-...` branches, etc.),
  none of them harmful, all of them clutter. A session should never delete branches in bulk unprompted
  (destructive git action), so this is an owner decision: flip **Settings → General → "Automatically
  delete head branches"** to on (stops future accumulation, changes nothing retroactively), and/or ask a
  session to sweep the existing backlog (`gh pr list --state merged --json headRefName` minus branches any
  open PR still needs, confirmed safe the same way the one accidental branch was checked this session —
  `git branch --contains <merge-commit>` before deleting).
- **Monthly maintenance session** — start a chat with: *"Run the monthly maintenance session for checkdecijfers.nl per CLAUDE.md."* Agenda: dependency alerts, provider deprecation notices, spend dashboards, backup status, **and `npm run gdpr:purge` (dry-run first, then `-- --apply`)**.
  - ⚠ **Until `GDPR_PURGE_APPLY=1` is set, this command is the ONLY thing that actually enforces retention** ([#189](open-questions.md), found 2026-07-25 and BUILT the same day). A monthly Vercel cron (`/api/gdpr-purge-cron`, `0 4 1 * *`) now runs the same job, but it **reports only** until the owner sets that env var — so the earlier wording here ("there is no cron and no CI schedule") is out of date, and the duty is still real. **THREE clocks run off this one command** (since [#181](open-questions.md), 2026-07-26): account audit rows redact at **2 years**, `anonymous_trial` audit content redacts at **90 days**, and `trial_questions` bookkeeping (visitor UUID + HMAC'd IP) is **DELETED** at 90 days. The first trial rows become purgeable **~2026-10-15**; if nobody runs this and the flag stays unset, they simply stay.
  - **And if a run prints `note: trial_questions absent (migration 020 not applied)` against production, that is a REAL signal, not a shrug** — migration 020 has been live since the 2026-07-17 go-live, so the table exists; investigate rather than continue. (The script no longer reports it from a bare `catch`: since #67 it is a `to_regclass` check, so this note now only ever means the table is genuinely absent.)
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

**Session-69 additions (2026-09-02) — a working recipe for a real visual check of the Ontdek charts:**
- Port 3000 is often held by the owner's OTHER project's dev server (a `node …/Glaibaan/scripts/dev-web.mjs`
  process — never kill it). Add a temporary `.claude/launch.json` entry on another port
  (`"runtimeArgs": ["--prefix", "web", "run", "dev", "--", "-p", "3010"], "port": 3010`), use it via
  `preview_start`, and REMOVE the entry before committing (`git status` must not show `.claude/launch.json`).
- For the charts to render locally, append root `.env`'s `DATABASE_URL` line to `web/.env.local` for the
  duration of the check only (`grep '^DATABASE_URL=' .env >> web/.env.local`, after backing the file up) and
  restore the original 6-line file afterwards — the RUNBOOK's "what lives where" table above stays true.
  The first Ontdek read on a cold pooler can exceed the 5 s budget and log the #190 "degrading" warning;
  reload once.
- Browser-pane quirks that cost time this session: a Claude Artifact URL needs the owner's claude.ai login
  (the pane has none → "Page not found"); a `file://` page opens as a "static snapshot" that none of the read
  tools can inspect while the pane is hidden; scrolled screenshots come back blank (session-68 lesson) — use
  a tall `resize_window` + one screenshot, and verify interactions through `javascript_tool` DOM queries.
