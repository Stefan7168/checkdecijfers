# ADR 036 — Het #53-proefpotje: anonieme proefvragen op de homepage

**Status: ACCEPTED — BUILT DORMANT (session 52, 2026-07-17); go-live pending, owner-supervised.** Designed
and built per the session-52 kickoff ("ontwerp eerst kort uitschrijven, dan bouwen"). The owner-decided core
(open-questions [#53](../open-questions.md) refinements, session 51) is fixed and restated below; the
D-decisions marked **[proposed]** are this session's design calls within that frame — reviewable at the
supervised go-live, which stays owner-present regardless (new secret, live DDL, spend-cap setup). **As
built:** migration 020 (file-only until the supervised apply), `src/billing/trial-pot.ts`,
`web/lib/trial.ts`, `web/app/trial-actions.ts`, `web/components/trial.tsx`/`trial-chat.tsx`,
`scripts/trial-pot-set.ts` (`npm run trialpot:set -- <n>`); gates: `tests/billing/trial-pot.test.ts`
(hermetic PGlite) + web trial suites. Two design revisions made DURING the build, both stricter than the
draft: see D5.

## Owner-decided frame (binding, session 51 — not up for redesign)

1. The trial lives ON the public homepage `/`: 2 free questions for anonymous visitors.
2. Pot measured in QUESTIONS: a deterministic DB counter, checked BEFORE serving — never after.
3. Empty pot → the trial input degrades to "log in om verder te gaan" and re-enables automatically on
   refill. The site NEVER breaks.
4. Two belts: our own per-question counter inside; a SEPARATE Anthropic API key with its own hard spend cap
   outside (owner creates it in the Anthropic console — supervised step).
5. Per-visitor limit + rate limiting; abuse can never touch the main product's budget.
6. R8 audit rows are written for anonymous answers too.

## Context (what the codebase gives us — measured session 52)

`askQuestion` rejects anonymous callers as its first act (`web/app/actions.ts:283-286`) — correct, and it
stays that way: the trial gets its OWN action, never a bypass of the auth gate. `audit_answers.user_id` is
already nullable by design ("null = anonymous", migration 004) — but `source_tag` has no anonymous value,
the GDPR purge scope is an explicit allowlist that must be widened consciously, and `credit_transactions`
structurally CANNOT hold an anonymous row (NOT NULL uuid + FK auth.users) — confirming the separate counter
is necessary, not just decided. `AnthropicLlmClient` already accepts an injected SDK instance
(`constructor(sdk?: Anthropic)`) — the second-key belt needs zero changes to the LLM harness and zero
prompt-byte changes. No rate limiting or visitor identity exists anywhere today (proxy, actions, platform).

## Decisions

### D1 — Anonymous identity: signed first-party cookie, issued on first use **[proposed]**

A visitor gets a random UUID in an HttpOnly, Secure, SameSite=Lax cookie (`cdc_trial`, ~180 days), set by
the trial Server Action on the FIRST trial question — not on page view (no tracking of passive visitors;
the cookie exists only to enforce the limit for someone who chose to use the trial). Server-side, the
visitor id is the key of the per-visitor count. The known caveat from #47/#53 stands and is accepted:
cookies can be cleared — the pot itself is the blast-radius cap, per-visitor enforcement only needs to stop
casual overuse.

*Alternatives rejected:* IP-only identity (shared NAT/carrier IPs punish innocents; IPs are personal data
we'd rather not key on); fingerprinting (disproportionate and consent-hostile); Supabase anonymous auth
sessions (creates real `auth.users` rows for drive-bys — pollutes every user_id FK table and the GDPR
account story for zero benefit).

**Owner check at go-live:** the cookie is functional (fraud/limit enforcement, set only on use), which we
believe falls under the "strikt noodzakelijk" consent exemption (Telecommunicatiewet art. 11.7a) — verify
this reading (and the privacy-page mention) before launch; not legal advice.

### D2 — Abuse boundaries: three layers, cheapest first **[proposed]**

1. **The pot** (global, in questions) — the hard ceiling. Atomic check-and-decrement inside one
   transaction with an advisory lock, mirroring `reserveDebit` (`src/billing/gate.ts`), with per-request
   idempotency like the ledger's partial unique index. Decrement BEFORE the LLM call; compensating
   increment if the pipeline throws before an answer is delivered (mirror of the billing compensation
   pattern).
2. **Per-visitor: 2 questions** per D1 cookie id, counted in a `trial_questions` table (one row per served
   trial question: visitor id, HMAC-hashed IP, request id, audit id, timestamp).
3. **Per-IP backstop: max 5/day** on the HMAC-hashed IP (same table) — blunts cookie-clearing without
   punishing shared IPs too hard. IPs are stored ONLY as `HMAC(secret, ip)` — never raw.

Burst smoothing beyond this (Vercel Firewall / WAF rules) is a dashboard-side owner option, deliberately
outside the repo; flagged in the RUNBOOK go-live checklist, not depended on.

### D3 — The outer belt: `ANTHROPIC_TRIAL_API_KEY`, dormant by default

The trial action constructs its LLM clients as
`new AnthropicLlmClient(new Anthropic({ apiKey: ANTHROPIC_TRIAL_API_KEY }))` via the EXISTING constructor
seam — main-product calls are untouched, prompt bytes are untouched (intent fixtures stay valid). The
whole feature is dormant unless `TRIAL_ENABLED=1` AND the trial key is set AND the pot row exists with
remaining > 0 (the WP129/WP135 dormancy pattern: flag off ⇒ byte-identical landing, deploy-order-safe).
The key is created by the owner in the Anthropic console with its own hard spend cap (supervised); RUNBOOK
gets the secrets-register entry + rotation steps.

### D4 — R8/GDPR for anonymous rows: new `source_tag 'anonymous_trial'` **[proposed]**

Audit rows are written exactly as today with `user_id = null` and a NEW `source_tag = 'anonymous_trial'`
(migration widens the CHECK by exact-name drop/re-add — the 007/013/018 pattern; `AuditSourceTag` union
widened in code). The tag is ADDED to the GDPR retention allowlist (`AUDIT_SCOPE`, retention.ts) so the
2-year purge sweeps anonymous rows — without this conscious add they'd be silently retained forever (the
allowlist is deliberately not automatic). Self-service deletion structurally doesn't exist for anonymous
rows (no account to invoke it from) — retention is the 2-year purge; `trial_questions` rows (the limit
bookkeeping, incl. ip-hashes) get their own shorter sweep (90 days) since their purpose expires with the
limit window. **As built (the adversarial review caught this promised-but-unbuilt; fixed same session): a
DELETE leg (`purgeExpiredTrialBookkeeping`, `src/billing/trial-pot.ts`) wired into `npm run gdpr:purge`
(dry-run count + apply; a pre-migration database skips the leg honestly). DELETE, not redaction: no ledger
FK references these rows and the R8 record lives on `audit_answers` independently. Documented consequence:
a returning visitor's 2-question budget refreshes after the window — deliberate; a lifetime cap would mean
keeping visitor ids forever.** Spend reconciliation for the separate key = the audit rows' `source_tag`
(all 'anonymous_trial' llm_calls ran on the trial key); no new llm_calls field needed.

### D5 — Trial scope: the core answer loop, nothing that needs an account **[proposed]**

A trial question runs the same deterministic pipeline (parse → query → compose, R1-R11 all apply; the #144
semantic checker rides along when live, its checker call ALSO on the trial key — all trial spend stays
inside the trial belt). NOT available in the trial: web-search add-on (separate spend, no anonymous
ledger), WP16 on-demand fetch (pending_table_requests requires a user; a trial question about missing data
gets the normal honest refusal + a "maak een gratis account" nudge), threads/history/feedback/CSV (all
keyed on real users). The trial section sits under the masthead with its own input + the 2-question budget
shown honestly; empty pot or dormant flag ⇒ the same area renders the login prompt (server-checked per
request, so refill re-enables it without a deploy — the #53 fail-safe).

**Build revision 1 — NO clarification reply round in v1** (stricter than this ADR's draft, which allowed
one): the reply would be an UNMETERED anonymous LLM endpoint — nothing decrements when a visitor replies,
so deliberately vague questions would buy unlimited free clarify-merge calls against the trial key. A trial
clarification renders read-only with its options as text + the account nudge; the visitor's second question
can incorporate what they learned. Revisit if trial conversion measurably suffers.

**Build revision 2 — every SERVED response consumes the trial question; refund ONLY on a thrown pipeline
error** (draft was silent): refunding refusals/clarifications would make unanswerable questions free,
uncounted LLM spend (the refunded row also stops counting toward the abuse limits). "2 proefvragen" = 2
served responses — answer, clarification or honest refusal alike; the paid product's subtler
partial-refund semantics need a ledger the trial deliberately doesn't have.

### D6 — What the pot is NOT

Not a `credit_transactions` row (schema forbids it — and mixing anonymous spend into the money ledger
would poison conservation invariants); not a per-instance in-memory counter (would multiply the pot by the
instance count); not an Anthropic-side-only cap (belt 2 exists precisely because our counter could have a
bug — and vice versa).

## Build plan — ✅ executed session 52 (dormant); only the supervised go-live below remains

1. Migration 020: `trial_pot_config` singleton (remaining_questions, cap), `trial_questions` bookkeeping
   table, `source_tag` CHECK widening. Hermetic tests on PGlite; prod DDL only in the supervised step.
2. `src/billing/trial-pot.ts` (or sibling module): atomic take/compensate/refill + per-visitor/per-IP
   checks — the deterministic core, fully unit-tested.
3. `web/app/trial-actions.ts`: `askTrialQuestion` — guardLength, visitor id, limits, pot take,
   trial-key clients, `answerQuestionAudited(source_tag 'anonymous_trial')`, compensate-on-throw.
4. `web/components/trial-chat.tsx` + landing wiring, dormancy-tested like WP129/WP135 (flag off ⇒
   byte-identical landing).
5. Docs: this ADR → accepted; RUNBOOK go-live checklist (key + cap + env + pot seed + smoke); retention
   doc note; #53 row.

**Supervised go-live (owner present):** create trial key + hard cap in the console; `vercel env add`
ANTHROPIC_TRIAL_API_KEY + TRIAL_ENABLED + TRIAL_IP_HASH_SECRET; apply migration 020 to prod; seed the pot
small (e.g. 25 questions); live smoke (one real trial question end-to-end + audit row check); then refill
to taste.

## Revisit triggers

- Any confirmed abuse pattern (pot drains in hours) → tighten D2 limits or add Firewall rules.
- KvK/launch marketing push → pot size and refill cadence become a real budget decision.
- The #166 "bedoel je …?"-copy follow-up ships → trial refusal copy aligns with it.
