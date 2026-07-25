# Adversarial hunt: the anonymous trial surface

**Autonomous overnight session, 2026-07-25. Four Fable agents, one lens each, read-only.**
Commissioned by [overnight-queue-2](2026-07-26-overnight-queue-2.md) item 4: the anonymous trial is the only
unauthenticated, money-adjacent surface in the product, it has no billing-gate metering entry, and it is LIVE.
Session 57's hunts covered WP26's client-held state; this surface had never been hunted.

Lenses: **(A)** can a visitor drain or corrupt the pot faster than one question per served question;
**(B)** what does the IP-hash limiter actually bound; **(C)** does the 90-day sweep do what ADR 036 claims;
**(D)** DB capacity against the 15-session ceiling.

Every finding below was **re-verified by the session model against the source before being recorded** — one
lens's headline finding did not survive that check (see *Adjudicated* below), which is the reason the step
exists.

---

## The headline — and it is not in the trial

**`guardLength` validates only `.length`, never the type — on the PAID path too.** CONFIRMED.

```ts
// web/app/actions.ts:99
function guardLength(text: string): void {
  if (text.length > MAX_INPUT_LENGTH) { throw new Error(...); }
}
```

Server-Action arguments are attacker-controlled and this repo knows it: the sibling `guardPending`
(`actions.ts:129`) checks `typeof value !== 'string'` on every field it bounds, for exactly this reason, and
its comment names "array-stuffed" payloads as the threat. `question` and `reply` never got the same check.

A crafted call passing `question = [{ type: 'text', text: 'A'.repeat(400_000) }]` has `.length === 1`, so the
guard passes; the value then flows unchanged into `messages: [{ role: 'user', content: request.question }]`
(`src/answer/llm/client.ts:96`), where a content-block array is *valid* Anthropic input and is accepted rather
than rejected. Reachable at three call sites:

| Site | Guard | Reached by |
|---|---|---|
| `actions.ts:340` `guardLength(question)` | length only | any signed-in user — **the main API budget** |
| `actions.ts:611` `guardLength(reply)` | length only | any signed-in user |
| `trial-actions.ts:93` `question.length > …` | length only | **anyone, unauthenticated** |

Cost is a per-request token amplification (~50× for a 400 kB payload against a ~2 kB question) at a flat
credit price on the paid path and at one pot-question on the trial path. It does not fabricate a number and
does not violate principle (a) — the blast radius is spend, bounded only by the Anthropic hard caps, which
this finding shows are load-bearing rather than belt-and-braces.

**Fixed in this PR**, matching `guardPending`'s existing idiom exactly.

## Also found — small, safe, each matching a precedent already in the repo

> **Handed to the parallel session.** A second autonomous session was started on the same brief at 18:38 and
> took these as its own PR (see the collision note in the session record). They are listed here because this is
> the dossier that records WHY each one matters; the implementation is not in this PR.

1. **An empty `x-forwarded-for` does not fall through to `x-real-ip`.** `web/lib/trial.ts:46` reads
   `(forwarded?.split(',')[0] ?? h.get('x-real-ip') ?? 'unknown')`. `''?.split(',')[0]` is `''`, which is not
   nullish, so `??` does not fire and the request lands in an empty-string bucket instead of using the
   platform header. Same for a leading comma.
2. **`hashedRequestIp` defaults the HMAC secret to `''`.** Unreachable today (`trialConfigured()` gates every
   caller), but it silently produces a well-formed digest that is an *unkeyed* SHA-256 of an IP —
   brute-forceable across IPv4 in seconds, which would break ADR 036 D2's "never a raw IP" privacy claim with
   nothing failing. Now throws.
3. **`getTrialPotStatus`'s bare `catch { return null }` swallows pool exhaustion and renders it as "the pot is
   empty", with no log line.** (`src/billing/trial-pot.ts:39`.) During the exact #173 failure mode the visitor
   is told something untrue and the operator gets no trial-branded log at all — and Vercel's log retention is
   short. **The fix here is a `console.warn`, NOT the `to_regclass` check used in (4).** That check is the
   repo's idiom, but this is the hottest anonymous path in the product — one pooled query per landing render —
   and adding an existence probe would double it, worsening the very capacity finding (D) this hunt raised.
   Keep the degrade, make it visible.
4. **The same bare-catch bug in `scripts/gdpr-purge.ts`** (both the dry-run and the `--apply` leg). Since
   migration 020 is applied in production, the "table absent" case it was written for is dead there, so today
   the catch exclusively masks *real* GDPR-deletion failures as a benign skip — while the script exits 0.
5. **The refund in `askTrialQuestion`'s catch is itself unguarded** (`trial-actions.ts:159`): it is awaited
   *before* `console.error`, and it needs a pool client and the global advisory lock — precisely the resources
   likely to be unavailable when the pipeline just threw. If it throws, the original error is never logged
   anywhere. Now the refund is guarded and both errors are logged.
6. **`countPurgeableTrialBookkeeping` and `purgeExpiredTrialBookkeeping` hand-write the same WHERE twice**
   while the comment claims they "share one WHERE shape, so they can never disagree". Now they actually do,
   matching `AUDIT_SCOPE` / `PENDING_PURGE_WHERE` in `retention.ts`.
7. **Docs:** the RUNBOOK's suggested Vercel firewall rule targets `path starts with /api/` — but Server
   Actions POST to the page path, so the trial lives at `/`. On Hobby's one-rule-per-project limit, the single
   rule the owner is told to create would protect everything **except** the only unauthenticated
   LLM-spending endpoint. Also: `docs/05-data-rules.md` had **zero** mentions of the trial while the code's
   `AUDIT_SCOPE` already includes `anonymous_trial`.

## Adjudicated: one lens's HIGH finding did not survive verification

Lens B reported, as HIGH, an "unmetered, unlimited free-LLM loop": both abuse counters exclude `refunded`
rows, the refund fires on any thrown pipeline error, and the LLM client throws on `stop_reason === 'refusal'`
and `max_tokens` (`src/answer/llm/client.ts:105-112`) — *after* the tokens are billed. Repeat forever.

**Refuted.** `respondToQuestion` wraps its entire body in `try { … } catch { return toInternalRefusal(...) }`
(`src/answer/respond/respond.ts:503-536`). Those client throws are converted into a **returned** internal
refusal, not a propagated exception. `answerQuestionAudited` therefore returns normally, the trial action's
catch is never entered, the row is never refunded, and the question **is** consumed. Lens A independently
reached the same conclusion by hunting for this exact primitive and failing to build it.

Recorded because the *coupling* is real even though the exploit is not: if a future change ever makes a
pipeline throw escape to the action, both abuse counters would start leaking. The `and not refunded` filter
belongs on the pot question ("did we serve you value?") but not obviously on the abuse question ("how hard are
you hammering us?").

## Recorded, not fixed — with the reasoning

**A second autonomous session ran the same brief in parallel** (see the session record). It hunted this surface
independently and recorded [#179–#186](../open-questions.md). Where we overlap we agree, which is the strongest
thing that can be said about either hunt — in particular it reached the same conclusion about the refund
coupling that the adjudication above reached from the other direction, and its IPv6 row carries a MEASURED fact
this hunt lacked (`dig AAAA checkdecijfers.vercel.app` — not reachable over IPv6 today, so that exposure is
latent rather than live).

So the rows below are only what those eight do **not** already cover. Read them together, not instead.

**#187 — the limiter reads a header entry the client may be able to choose, and nobody has measured whether it
can.** `hashedRequestIp` takes `x-forwarded-for`'s **FIRST** entry (`web/lib/trial.ts:46`). That is correct
behind a proxy that OVERWRITES the header and wrong behind one that APPENDS — and the safety argument is a code
comment, not a measurement. Vercel's own non-forgeable `x-vercel-forwarded-for` appears nowhere in the repo,
and the existing test asserts only that a different header value yields a different hash, which is precisely
the attacker's capability asserted as correct behaviour. Distinct from [#182](../open-questions.md) (IPv6),
which is about the KEY being too fine; this is about the INPUT being untrusted. **One live request with a
forged header settles it.** Until then, assume the backstop bounds nothing against scripted traffic and treat
the Anthropic hard cap on the trial key as the real ceiling.

**#188 — waiting for the trial's global advisory lock PINS one of the 15 pooler sessions.**
`takeTrialQuestion` acquires a pool client, opens a transaction, and takes `pg_advisory_xact_lock` over ONE
constant key as its first statement, so every queued take holds a session for the whole time it waits —
converting a request burst into session-occupancy time on the scarce resource. Rejections are not cheap
either: the per-IP and per-visitor checks run INSIDE the locked transaction, so traffic the limiter correctly
refuses still pays the full session-plus-lock cost. [#186](../open-questions.md) covers the per-GET query cost;
this is the concurrency amplification on top of it, and it is what makes a burst hurt the PAID product.
Measured query budget, from code: **1 pooled query per warm anonymous landing render** (~2 with a cookie,
~33–42 on a cold instance or cache expiry) and **~25–50 per served trial question**, 8 of them under the lock.
The fix is understood — run the read-only counts BEFORE the lock and re-check inside it — but it is a
concurrency change on a live money path and belongs in a supervised window.

**#189 — nothing schedules `gdpr:purge`. At all.** The 90-day trial sweep is real code, correctly wired into
the CLI — and no cron, no CI schedule and no RUNBOOK duty invokes it. `web/vercel.json` has exactly one cron
and it is the onboarding job. The first `trial_questions` rows become purgeable ~2026-10-15 and on current
wiring nothing will happen on that date. [STATUS.md](../STATUS.md) has been claiming "ongoing retention = the
monthly maintenance session" while that session's standing agenda never mentioned the purge. Distinct from
[#181](../open-questions.md), which is about what the 2-year purge RETAINS; this is about whether anything
runs at all. The agenda entry and the STATUS correction are in this PR; a cron is an owner decision.

**#190 — an infrastructure failure spends the visitor's whole trial on apologies, and the anonymous landing
HANGS rather than degrading.** Any DB failure after the take becomes a served `'internal'` refusal (the
pipeline never rethrows — `respond.ts:503-536`), and "every served response consumes the trial question" then
consumes it. Right for honest refusals; an infrastructure-caused one is a different class and is already
distinguishable at the call site (`refusalReason === 'internal'`). During the measured ~6-minute #173 window a
first-time visitor would have burned both free questions on "ik kan deze vraag nu niet betrouwbaar
beantwoorden" — the worst possible first impression for the surface WP26 exists to protect. Separately: on
LOCAL pool saturation the gate and the Ontdek rebuild simply WAIT, because `connectionTimeoutMillis` is
deliberately unset, so the visitor gets a page that never finishes instead of the designed "closed" degrade.
The fail-safe engages on errors, not on waits. Both halves are owner decisions.

## What the lenses checked and found genuinely clean

Worth protecting, and worth not re-hunting:

- **Check-before-serve holds.** The pot take, both limit checks and the duplicate check all complete before
  any LLM client is constructed. A rejected visitor costs zero tokens. Two lenses verified this independently.
- **Pot concurrency is sound.** One global advisory lock; the decrement is guarded
  `where singleton and remaining_questions > 0`; a negative pot is structurally impossible
  (`check (remaining_questions >= 0)`); the race for the last question is unit-tested. No deadlock shape —
  one lock and one client per transaction, and nesting throws.
- **Idempotency holds** on both the take (unique `(visitor_id, request_id)`, checked before the decrement) and
  the refund (`and not refunded`, so a replay cannot inflate the pot). `trialQuestionId` is never
  client-supplied, so a refund cannot be aimed at another visitor's row.
- **No auth bypass, and no paid-add-on surface is reachable anonymously.** The trial is its own action;
  `askQuestion`'s anonymous rejection is untouched; `/` is allowlisted by *exact match* in the proxy; and the
  trial injects no `tableFinder`, `webClient`, `webBilling` or `sourceSelection`.
- **The outer belt is wired as claimed** — every LLM client on the path, including the #144 semantic checker's
  own, is constructed from `ANTHROPIC_TRIAL_API_KEY`, so no trial spend can reach the main budget.
- **Raw IPs never persist**; forged cookies never reach SQL as-is (UUID-validated, `uuid` column).
- **The FK direction is safe:** `trial_questions.audit_answer_id → audit_answers(id)` is a child-side
  reference, so the 90-day sweep can never orphan or be blocked by the 2-year audit retention.
- **Cutoff arithmetic is correct** — UTC, no DST, month/year rollover normalised, and the strict `<` means a
  row exactly 90 days old survives, which is what "older than 90 days" should mean.
