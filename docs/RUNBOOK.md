# RUNBOOK — the owner's guide

Everything **Stefan** does, phase by phase. AI sessions read [CLAUDE.md](../CLAUDE.md); you read this. Like [STATUS.md](STATUS.md), this is a tracker over decisions made elsewhere — tick boxes here, change plans in the docs.

## How work happens

- **One chat session = one work package** — one or two unchecked items from [STATUS.md](STATUS.md), not a whole phase. A fresh session automatically reads CLAUDE.md and STATUS.md and knows where things stand; that is what they exist for. Phases span many sessions.
- **Start a session like this:** *"Continue checkdecijfers.nl. Read CLAUDE.md and docs/STATUS.md, then do the next unchecked Phase 0 item: ⟨item⟩. First confirm back to me: the current phase, the benchmark gate, and the work package — then start."* The confirm-back is your check that the session oriented correctly **before** it touches anything.
- **Big work packages may be delegated:** a session can spawn implementation subagents, as long as each brief names the specific invariants at stake and the session reviews the result — "done" still means green CI, no matter who wrote the code. Don't hardcode model names in reusable prompts; they go stale.
- **Delegation cost rule (your money):** the expensive model you're chatting with does the thinking — scoping, instructions, and reviewing what comes back. The legwork it farms out runs on cheaper models. If you see a session burn budget doing easy repetitive tasks on its own top-tier model, that's a bug: point at this line (and at the same rule in [CLAUDE.md](../CLAUDE.md)).
- **End of every session:** work committed, STATUS.md updated with measured results, process lessons appended to [lessons-learned.md](lessons-learned.md). If a session claims success, the proof is a green CI run — not its word (CLAUDE.md convention).
- **You are the phase-gate backstop:** if a session proposes building something, ask "is that in the current phase?" The docs enforce it, but you can always point at [03-mvp-scope.md](03-mvp-scope.md).

## Account signup checklist

### Now — before the Phase 0 build (~30 min, all free)

- [x] **GitHub** — done 2026-07-02: repo pushed to github.com/Stefan7168/checkdecijfers (private); machine authenticated as Stefan7168.
- [x] **Anthropic API** — account created 2026-07-02 (stefanpeek00@gmail.com); key stored in local `.env`; €25 monthly spend cap confirmed set by owner (2026-07-02).
- [x] **Supabase** — account created 2026-07-02 (stefanpeek00@gmail.com). Nothing vendor-specific will be used (ADR [002](decisions/002-postgres-system-of-record.md)), so this stays swappable. `DATABASE_URL` stored in local `.env` (2026-07-02); its first verified use comes with the ingestion session.
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
