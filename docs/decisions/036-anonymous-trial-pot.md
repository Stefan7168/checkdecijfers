# ADR 036 — Het #53-proefpotje: anonieme proefvragen op de homepage

**Status: ACCEPTED — LIVE (built session 52, 2026-07-17; supervised go-live RUN the same day, owner present — record in the RUNBOOK's #53 section).** Designed
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
rows (no account to invoke it from) — retention is the age-based purge, and since [#181](../open-questions.md)
(2026-07-26) that is **90 days for anonymous content**, not 2 years: exactly the reasoning this D4 already
applied to the bookkeeping, finished. Both windows are one constant now. `trial_questions` rows (the limit
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

**As-built note, 2026-07-26 (session 59, [#186](../open-questions.md)):** "server-checked per request" is
now *per request, from a pot reading at most 20 s old* (`TRIAL_POT_TTL_MS`, `web/lib/trial.ts`). The
fail-safe is unchanged in kind — a refill still re-enables the trial without a deploy, to within the TTL —
and the cache **cannot over-serve**, because the atomic take under the advisory lock is the real gate and
refuses honestly whatever the landing invited. What is cached is the invitation, never a question. It was
built after measuring that the cost of the per-request read is not its 0.44 ms but the pooler SESSION it
forces an instance to open: one anonymous GET was observed holding a slot for 174 s, since node-pg's idle
timer does not fire while a Fluid Compute instance is frozen. Only the POT is cached; the per-visitor count
stays live on every request, because sharing it across requests on a reused instance would hand one
visitor another's budget.

**As-built note, 2026-07-26 (session 59, [#184](../open-questions.md)):** the landing gate now also
reports the **per-IP backstop** as its own state (`ip_limit`), instead of letting a capped visitor type a
question and learn one round-trip later. Both limit counts share ONE round trip, so with the #186 cache
a steady-state anonymous render costs one query (two on the render that refreshes the pot) — the fix
pays for itself rather than adding a third. Three
consequences worth having written down: the check runs even with **no cookie**, because the visitor this
is for is usually a first-timer behind a network someone else already spent; the gate's precedence
mirrors `takeTrialQuestion`'s (visitor before network) so the two surfaces never name different causes;
and the visitor's own `questionsLeft` is **never** clamped by the network's headroom, because telling
someone they used a question they never asked is exactly the unverified claim D2's honesty posture and
principle (c) forbid. ⚠ The accepted cost: this gate can be **stricter** than the take, because the IP is
read at RENDER time and a CGNAT pool may hand the later submit a different address — a rare over-refusal,
self-healing on reload, traded against the common wasted effort D2's per-IP backstop otherwise imposes. The visitor-facing sentences for these states now live once, in
`web/lib/trial-copy.ts`.

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

## As-built corrections from the independent adversarial pass (2026-07-25, session 58B)

An independent hunt over this surface — deliberately run without the concurrent session's conclusions —
confirmed the design but found six things the ADR either claimed or implied that were not true of the code.
Fixed in the same change; the reasoning for each lives in the commit message and
[session-briefs/2026-07-25-session-58b-independent-review.md](../session-briefs/2026-07-25-session-58b-independent-review.md).

1. **D4's "R8 audit rows are written for anonymous answers too" was defeatable from outside.**
   `trial_questions.request_id` is `text` (migration 020) while `audit_answers.request_id` is `uuid`
   (migration 010), and the action checked `requestId` for type and length but not SHAPE. A non-UUID id
   therefore spent a pot question and both LLM calls and was refused only by the R8 insert, whose
   fail-closed retry re-used the same id — so the turn was served with **no audit row**, which also
   destroys the spend-reconciliation mechanism D4 names (the audit rows' `source_tag`) and fires one admin
   alert e-mail per request. The action now requires a UUID, before the take.
2. **The "empty pot degrades the UI, never breaks it" fail-safe was honest about DOING and dishonest about
   SAYING.** The gate folded "pot read as empty", "pot table absent" and "the pot read threw" into one
   `closed` state whose copy states the pot is empty — so during a [#173](../open-questions.md) pooler
   exhaustion the landing told every visitor something untrue about a possibly-full pot. `TrialGateState`
   now separates `closed` (read it) from `unavailable` (could not tell); same degrade, different claim.
3. **D2's "raw IPs never persist" rested on call ordering alone.** `hashedRequestIp` defaulted the HMAC key
   to `''`, and an unkeyed SHA-256 of an IPv4 address is brute-forceable over the whole 2^32 space. It now
   throws instead of degrading. Also: a present-but-empty `x-forwarded-for` never fell through to
   `x-real-ip` (`''` is not nullish, so `??` short-circuited) — not reachable on Vercel, reachable behind
   any other proxy.
4. **D4's 90-day DELETE had no trigger whatsoever** — no cron, no RUNBOOK step, no maintenance-agenda line —
   so "rows are DELETED after 90 days" was a promise nothing kept. Added to the RUNBOOK monthly agenda; the
   first real deadline is **~2026-10-15** (the 2026-07-17 go-live + 90 days). A cron remains the sturdier fix.
5. **Both trial legs of `gdpr:purge` sat in a bare `catch {}`** that blamed a migration live since the
   go-live, so a genuine failure was reported as an honest skip while the script exited 0. Now a
   `to_regclass` check, per `retention.ts`'s own "the guard must be a check, not a catch".
6. **The promised "retention doc note" was never delivered** — [05-data-rules.md](../05-data-rules.md) did
   not mention the trial at all, and still stated a 2-tag retention scope the code had widened to three.
   Written now, including the trial's TWO windows.

**Left to the owner, not changed (as of that first pass — see the SECOND as-built note below, which closes two
of these; ✅ RESOLVED 2026-07-26 by [#181](../open-questions.md) — content now goes at 90 days too):** anonymous *content* was retained 2 years with no self-service erasure route while its bookkeeping went
at 90 days ([#181](../open-questions.md)); ~~the IP backstop bounds nothing over IPv6~~ **✅ fixed 2026-07-26**
([#182](../open-questions.md)); ~~the pot has no low-water alert~~ **✅ fixed 2026-07-26**
([#180](../open-questions.md)); a refund restores the abuse counters as well as the pot, and is near-dead code
because the pipeline swallows every attacker-shaped throw ([#185](../open-questions.md) — deliberately kept, see
below).

**Confirmed sound** (a clean lens is a result): the take's ordering and atomicity, the pot floor,
`setTrialPot`'s missing `where singleton` (structurally impossible to need it), advisory-key collisions,
refund idempotency, `duplicate_request` replay including refunded rows, the partial indexes matching both
count queries exactly, trial spend isolation including the semantic checker, and — the one most expected to
break — the 2-year purge genuinely reaching `user_id`-null rows.

## As-built, second pass (2026-07-26) — D2's backstop, and the pot finally gets a watcher

Three more changes to this ADR's surface, all merged and live. They matter to D2 in particular, whose
"the pot is the real ceiling" framing the [first as-built note](#as-built-corrections-from-the-independent-adversarial-pass-2026-07-25-session-58b) already qualified.

1. **The per-IP backstop bounded NOTHING over IPv6** ([#182](../open-questions.md), `33a051d`). It HMAC'd the full
   address; a residential delegation is a /64 at minimum, so one visitor had 2^64 buckets each with its own fresh
   5/day. `ipBucketKey()` now keys on the /64 — the household, which is the unit the limit is about. Zero
   behavioural change today (all traffic is IPv4, `dig AAAA` empty for both hostnames), which is why it shipped
   BEFORE the launch trigger rather than after.
2. **D2's header assumption is now a citation, and the header changed** ([#187](../open-questions.md)). The old
   comment asserted that `x-forwarded-for`'s first entry is the platform-set address. That is TRUE and documented —
   Vercel overwrites the header and does not forward external IPs (overriding it is an Enterprise trusted-proxy
   purchase; we are on Hobby) — so the backstop's input was never forgeable here. **But the code now reads
   `x-vercel-forwarded-for` FIRST**, because Vercel documents that one as identical *except* that
   `x-forwarded-for` can be overwritten by a proxy on top of Vercel. Put Cloudflare in front (the launch plan) and
   the old read would have collapsed every visitor into a handful of edge buckets, locking real people out of a
   limit they never used. **Revisit trigger for D2, restated:** any proxy in front of Vercel — not "a proxy that
   appends", which was the wrong framing.
3. **The pot has a watcher** ([#180](../open-questions.md), `e88cfea`). D2 named the pot as the blast-radius cap but
   nothing observed it, so the documented revisit trigger ("pot drains in hours") was unobservable — the owner would
   have learned at the next `trialpot:set`. It now alerts at `TRIAL_POT_LOW_WATER = 5` and at empty, through the
   existing admin-alert seam, fired by the caller (never inside the advisory-locked take) and latched so it is a
   warning shot rather than a stream.

**Deliberately NOT changed:** the refund still restores the visitor's and the IP's budget as well as the pot
([#185](../open-questions.md)). Dropping that would charge infrastructure failures to the visitor to close a hazard
that is unreachable today and already bounded in euros by D3's separate capped key. If it ever becomes reachable,
the recorded fix is a refund CAP per visitor, not removing the compensation.

## Revisit triggers

- Any confirmed abuse pattern (pot drains in hours) → tighten D2 limits or add Firewall rules.
- KvK/launch marketing push → pot size and refill cadence become a real budget decision.
- The #166 "bedoel je …?"-copy follow-up ships → trial refusal copy aligns with it.

---

## As-built note — the 2026-07-25 adversarial hunt

Two independent autonomous sessions hunted this surface on the same night (four Fable lenses here, dossier in
[session-briefs/2026-07-25-trial-surface-hunt.md](../session-briefs/2026-07-25-trial-surface-hunt.md); the other
session's rows are [#179–#186](../open-questions.md), this session's are #187–#190). **The core design held:**
check-before-serve is genuinely correct (the pot take and both limit checks complete before any LLM client is
constructed, so a rejected visitor costs zero tokens); the pot cannot go negative; the take is idempotent and
the refund cannot inflate it; raw IPs never persist; and there is no auth bypass. Two lenses verified the first
of those independently.

Three claims in this ADR need qualifying, and none of them is fixed by a code change alone:

- **D2's "the pot is the real ceiling" is too strong.** The per-IP backstop bounds an ordinary person clearing
  cookies — the case D2 names — and little else. It does not bound a script (the server mints a fresh visitor id
  per request and keeps no record one was issued), it is keyed on the *exact* address so an IPv6 /64 yields 2^64
  buckets (#182 — measured NOT reachable over IPv6 today, so latent), and it reads an `x-forwarded-for` entry
  whose trustworthiness has never been measured (#187). Treat the **hard spend cap on the trial API key as
  load-bearing**, not as a belt-and-braces extra.
- **D4's "its purpose expires" is true of `visitor_id`, not of `ip_hash`** — the rolling 24-hour count is its
  only consumer anywhere, yet it is retained the full 90 days.
- **D4's deletion happens only if someone runs the CLI.** Nothing schedules `gdpr:purge` (#189); the RUNBOOK's
  monthly-maintenance agenda now lists it.

Also recorded: the revisit trigger above ("pot drains in hours") is currently **unobservable** — `ip_limit`,
`pot_empty` and refunds are all silent, so the owner would find out at the next `trialpot:set`.
