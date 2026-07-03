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

- [x] **GitHub** — done 2026-07-02: repo pushed to github.com/Stefan7168/checkdecijfers (private); machine authenticated as Stefan7168. ⚠ **2026-07-03 fix:** this machine's *global* `~/.gitconfig` defaults to a work identity (`socialplus <marketing@social.plus>`) — 22 of this repo's first 25 commits inherited it before anyone noticed. Fixed with a **repo-local override** (`git config --local user.name/user.email`, set to `Stefan7168` / `stefanpeek00@gmail.com`) plus a one-time history rewrite (`git filter-branch` + force-push) to scrub the old identity from every already-pushed commit. The local override lives only in this working directory's `.git/config` — **a fresh clone of this repo on any machine won't have it**; the first session in a new clone should re-run those two `git config --local` commands before committing, or the work identity leaks back in silently.
- [x] **Anthropic API** — account created 2026-07-02 (stefanpeek00@gmail.com); key stored in local `.env`; €25 monthly spend cap confirmed set by owner (2026-07-02).
- [x] **Supabase** — account created 2026-07-02, login **stefanpeek00@gmail.com**, organization **"stefan"** (lowercase), project **checkdecijfers** (region eu-central-1). ⚠ A second, empty org **"Stefan7324"** also exists on this login — the project is **not** there; always pick "stefan". Nothing vendor-specific will be used (ADR [002](decisions/002-postgres-system-of-record.md)), so this stays swappable. `DATABASE_URL` stored in local `.env` (2026-07-02). ✅ **2026-07-03 Data-API lockdown (done):** the project's "Automatically expose new tables" setting was on, granting `anon`/`authenticated` full CRUD on every table via Supabase's auto-generated Data API — this app never uses that API (ADR 002/003: server-side `pg` over `DATABASE_URL` only), so it was pure unneeded attack surface (not exploitable in practice — Supabase's own RLS-auto-enable safety net had already blocked real access). Fixed on **both** layers: migration `003_lock_down_api_access.sql` revokes the grants + locks default privileges for future tables (code side), **and** the owner disabled the **entire Data API** in the dashboard — **Data API integration → Overview → "Enable Data API" → off → Save** (stronger than just the "Automatically expose new tables" sub-toggle, which is now moot because the whole `/rest/v1/` REST layer is off). Verified 2026-07-03: app's `DATABASE_URL` connection unaffected (direct Postgres via the pooler, a separate path from the REST API); security scan clean. **If the Data API is ever re-enabled** (shouldn't be needed), also turn "Automatically expose new tables" back off at that point.
- [x] **Vercel** — account created 2026-07-02. ⚠ Note: this account uses **stefanpeek01**@gmail.com (unlike the others). CLI login happens with the first deploy session. Hobby tier is for non-commercial use: upgrade to Pro (~€20/mo) at Phase 2, when payments go live.
- [ ] Confirm you control the domain **checkdecijfers.nl** (working name; final naming is [open-questions](open-questions.md) #7 — the domain is not needed until pages go public).

### Phase 1 — accounts & private beta

- [ ] **Transactional email provider** (e.g. Resend or Postmark; chosen with magic-link login) — also carries your owner alerts (ingestion failures, quarantines, missed syncs).
- [ ] **Uptime monitor** (free tier, e.g. UptimeRobot) — tells you when the site is down.

### Phase 2 — payments & public launch

- [ ] **KvK registration + business bank account** — required before Stripe can pay out in the Netherlands. Start early; this is the slowest item.
- [ ] **Stripe** with iDEAL enabled.
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
| `ANTHROPIC_API_KEY` | local `.env` (since 2026-07-02) + Vercel env store (at first deploy) | Anthropic console → create new key → replace in both places → delete old key |
| `DATABASE_URL` | local `.env` (since 2026-07-02) + Vercel env store (at first deploy) | Supabase dashboard → reset database password → replace in both places. ⚠ Use the **Session pooler** connection string (Connect → Session pooler), not the direct one: the direct host is IPv6-only and doesn't work from most home networks (verified 2026-07-02). The connection is TLS-verified against Supabase's public root certificate, committed at `config/supabase-prod-ca-2021.pem` — nothing to do at rotation, it's valid to 2031 |
| *(more added at setup)* | | |

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
   npm run typecheck && npm test
   ```
   The whole test suite is hermetic (embedded database, recorded LLM
   fixtures), so a green run here proves the clone is complete and healthy
   before any key exists on the machine.
   Two harmless things you may see (both observed on the 2026-07-03
   bootstrap): `npm ci` warns about install scripts it did not run
   (esbuild, fsevents) — expected, the suite runs green without approving
   them; and the very first run is the slowest (everything compiles
   cold), which can push a single test over its time limit even with the
   raised 30s ceiling in `vitest.config.ts` — if exactly one test fails
   on that first run, run `npm test` again before concluding anything is
   broken (on the bootstrap the re-run was fully green, 306 passed).
4. **Set the git identity for this clone** — it does NOT come along with a
   clone, and a machine's global default may be a different (work) identity:
   ```
   git config user.name "Stefan7168"
   git config user.email "stefanpeek00@gmail.com"
   ```
   (Check with `git config user.email` before the first commit from a new
   machine — a wrong identity on a commit is annoying to fix after pushing.)
5. **Recreate `.env`** from `.env.example`, following the Secrets register
   above. Prefer **rotation over copying**: create a fresh Anthropic API key
   in the console (and confirm the monthly spend cap is set on that
   workspace), and fetch the `DATABASE_URL` from the Supabase dashboard
   (Connect → **Session pooler**). Then deactivate the old machine's key in
   the Anthropic console. Only the live-data scripts need `.env`
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
7. **Not in git, by design:** `.env` (recreate per step 5) and the local
   `Archive/` folder (competitor-research reference material — copy it over
   manually if you still want it, or let it go; nothing in the build depends
   on it).

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
