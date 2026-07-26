# Session 58B — the second parallel session of the 25/26-07 night

**Written 2026-07-25 by an autonomous session that discovered, four minutes after starting, that it was the
SECOND session running the same overnight queue in the same working tree.** Kept as a separate record on purpose:
two sessions writing `STATUS.md` / `status-archive.md` / `lessons-learned.md` in one night is the next collision,
so this session put its record here and left those three files to the session that owned the main tree.

Numbered **58B** rather than 58 because the other session has an equal claim to 58.

---

## 0. The collision, first, because it changes how to read everything else

At 18:38 local I was started with the queue in
[`2026-07-26-overnight-queue-2.md`](2026-07-26-overnight-queue-2.md). By 18:40 I had established that another
session was **live in the same directory**:

- `tests/audit/envelope-key-manifest.test.ts` advanced its mtime 18:38:34 → 18:40:52 while I was reading the repo.
- `list_sessions` showed `local_fb466947…` ("Checkdecijfers overnight queue") **running**, `cwd` the same repo,
  holding PR #64.
- Its branch `test/conformance-bundle` carried uncommitted work on **queue item 1** — my item 1.

Two sessions editing one working tree corrupt each other: one `git add -A`, `git stash` or `checkout` from either
side swallows the other's work, and concurrent full-suite runs contend on `node_modules/.cache/cdc-fixture-db`.

**What I did about it.** Messaged the other session with a split I then adopted unilaterally (no deadlock if it
never replied), and **moved out of the shared tree entirely** into `git worktree add /Users/amity/cdc-s58`, based
on `origin/main`, with its own `node_modules`. I wrote **nothing** to the main working tree all night.

**Then a more useful fact surfaced:** PR #64's commit message says *"Found by the anonymous-trial hunt (four Fable
lenses, 2026-07-25)"* — the other session had **already run queue item 4**. Repeating the queue would have been
pure waste. So this session's job changed to the thing a second session can do that a first cannot:

1. **Hunt the same surface independently**, without its conclusions, and see what a second set of lenses finds.
2. **Review the open PR the owner has to approve** — a session cannot independently review its own diff.

That reframing is the main thing to take from this document.

---

## 1. Independent review of PR #64 — verdict: **merge as-is**

PR #64 (`fix/guard-argument-types`, `d84aa8d`) hardens
Server Action arguments: `guardLength` checked `.length` without `typeof`, so
`[{type:'text',text:<400 kB>}]` (`.length === 1`) passed a 2000-char spend ceiling.

A Fable reviewer re-derived the exploit path from scratch rather than trusting the commit message, and reached:

- **The vulnerability is real and NOT overstated.** Traced argument → `buildIntentRequest` (`intent/parse.ts:66`,
  no coercion) → `messages: [{role:'user', content: request.question}]` (`src/answer/llm/client.ts:96`). Nothing
  in between runs zod, a schema parse, or string coercion on the question — the intent parser validates the LLM's
  *output*, never its input. The API accepts a content-block array, so the call succeeds and the spend happens on
  input tokens before any parse verdict exists.
- **Complete.** Every `'use server'` export and every route handler was enumerated; no action was missed.
- **No regression.** The real client sends primitive strings and `crypto.randomUUID()` (36 chars, inside the new
  1–100 bound); a normal double-submit sends the *same valid* id and still lands on `duplicate_request`, so the new
  `guardRequestId` never turns a double-submit into an error dialog. `createCheckoutSession` correctly *returns*
  its existing error shape instead of throwing.
- **Tests bite on revert**, including the load-bearing content-block shape.
- **Zero prompt bytes** (`git diff --stat` touches only `web/app/*`, nothing under `src/`, so the ~93 fixtures and
  [#164](../open-questions.md) are untouched), no migration, no invariant.
- **The stated counts are internally consistent**: `status-archive.md` records 1509 backend / 385 web after
  #60–#63; this PR adds 0 backend and exactly 6 web tests → 1509 / 391, as claimed.

One calibration for the owner, which agrees with the PR rather than contradicting it: exposure **today** is
limited — the paid path needs a signed-in account and only the owner has one. It is genuine pre-launch hardening
on a live money path, not an incident in progress.

Only cosmetic observations survived: a couple of non-string shapes (`null`, `Number`) are covered for `requestId`
but not re-covered for `question`, and requestId *format* validation on the paid path stays deferred to the
tracked [#149](../open-questions.md). Neither is worth holding a clean security fix.

---

## 2. What the independent hunt found that the first pass did not

Four Fable lenses, told explicitly that the type-confusion class was already closed, so they had to find
something else. **One real defect, reachable in production today, plus eight tracked findings.**

### The one that matters — a `text` column laundering a non-UUID into the LLM

`web/app/trial-actions.ts` validated `requestId` for type and length but **not shape**. The columns disagree:

| Table | Column | Type |
|---|---|---|
| `trial_questions` (migration 020) | `request_id` | **`text`** |
| `audit_answers` (migration 010) | `request_id` | **`uuid`** |
| `credit_transactions` (migration 005) | `request_id` | `uuid` |

So `askTrialQuestion('…', 'r1')` — any non-UUID — did this: passed the guard → `takeTrialQuestion` succeeded
(text column) → **pot −1** → intent + compose LLM calls paid for on the trial key → `insertAuditRecord` threw
`invalid input syntax for type uuid` → `persistOrFailClosed` caught it, built an internal refusal, and **retried
with the same bad id**, which threw identically → the turn was **served with `auditId: null`**.

Consequences, all verified by reading the code rather than inferred:

- **No R8 audit row for an anonymous answer** — ADR 036's binding owner-frame item 6.
- **The trial key's invoice becomes unreconcilable**, because D4's stated reconciliation mechanism is exactly the
  audit rows' `source_tag`.
- **`maybeAlertInternalRefusal` fires every time**, and `RESEND_API_KEY` + `ADMIN_ALERT_EMAIL` are set in
  production — one admin e-mail per request, from an unauthenticated endpoint.
- The pot drains while delivering nothing.

No number is fabricated (the refusal is honest) and the euro loss is pot-capped, so this is an **R8/audit-fidelity
and abuse** defect, not an R1/R3 one. **The paid path is immune by accident, not design:** its
`credit_transactions.request_id` is `uuid` and is written inside the gate *before* any LLM call, so the same
garbage fails there for free. The trial is the only path where a `text` column launders the value past the take.

**The tell that it went unnoticed: the tests agreed with the bug.** `trial-actions.test.ts` passed `'r1'`…`'r4'`
throughout — precisely the shape production rejects — because `answerQuestionAudited` is mocked there, so the
`uuid` column never participated. Those literals are now real UUIDs.

**Fixed** in this session: the guard requires UUID shape, before the take. Proven by reverting the guard and
watching the new test fail.

### Also fixed here (small, all verified by revert)

1. **The landing told visitors something untrue during an outage.** `getTrialGateState` folded three causes — pot
   read as empty, pot table absent, and *read threw* — into one `'closed'` state whose copy says *"Het gratis
   proefpotje is op dit moment leeg"*. During the #173 pooler exhaustion the pot may well have been full. Split
   into `'closed'` (we read it; the copy may say why) and `'unavailable'` (we could not tell; the copy must not
   name a cause). Same degrade, same fail-safe — only the claim changed.
2. **An empty `x-forwarded-for` never fell through to `x-real-ip`.** `''.split(',')[0]` is `''`, not nullish, so
   `??` short-circuited and bucketed every such request under a third shared hash. `||` fixes it. Not reachable on
   Vercel, which overwrites the header itself; reachable behind any other proxy — which launch contemplates.
3. **`hashedRequestIp` defaulted the HMAC key to `''`.** An unkeyed SHA-256 of an IPv4 address is brute-forceable
   over the whole 2^32 space, i.e. the precise defeat of D2's "raw IPs never persist". `trialConfigured()` makes it
   unreachable today; it now asserts instead of degrading, so the guarantee is loud rather than implicit.
4. **`gdpr:purge`'s two trial legs sat in a bare `catch {}`** that blamed "migration 020 not applied" — a
   migration live in production since 2026-07-17. From that day the catch could only ever misreport a genuine
   failure (lock timeout, permissions, connection blip) as an honest skip, while the script still exited 0. Now a
   `to_regclass` **check**, which is the discipline `retention.ts` states for its own guard: *"the guard must be a
   check, not a catch"*.
5. **`trial_pot_config.remaining_questions` could exceed `cap`** when a refund landed after a supervised refill.
   Now `least(remaining + 1, cap)` — identical below the cap.
6. **The ⟨F2⟩ "one WHERE shape" claim was two copies of a literal.** Hoisted, so the comment is true.

### Recorded, deliberately not fixed — [#179](../open-questions.md)–[#186](../open-questions.md)

Each row carries the reasoning. The ones worth the owner's eye:

- **[#181] is an owner decision on GDPR** and the reason I did not touch it: anonymous trial *content* is kept 2
  years with **no self-service erasure route** (that path binds `user_id`; an anonymous visitor has none), while
  its abuse bookkeeping is deleted at 90 days. The posture is documented — but its justification is *inherited*:
  the 2-year window was decided for account holders with a dashboard and a legally-retained financial trail, and a
  trial turn has neither. ADR 036 applies "retention without purpose" reasoning to the bookkeeping and not to the
  content. Either redact at 90 days too, or write down why 2 years. The present state is neither.
- **[#182] has a launch trigger.** The IP backstop HMACs the *full* address, so it bounds nothing over IPv6 — a
  /64 gives one visitor 2^64 buckets. Measured NOT reachable today (`dig AAAA` empty for both hostnames), and it
  fires the day the apex goes through an IPv6-capable front. Pre-launch checklist, one-line fix.
- **[#183] was left alone for coordination, not doubt.** The trial action accepts 2000 chars while its own UI caps
  at 500 (≈4× the input tokens per pot question). The fix is one constant — in the file PR #64 was concurrently
  rewriting. Two sessions editing one constant in two open PRs is how a merge silently drops one.
- **[#180]** the pot has no low-water alert, so an outsider can switch the lead magnet off for ~€0.50 and the
  owner finds out by looking at the homepage.
- **[#186]** every anonymous homepage GET costs 1–2 uncached queries against the 15-session ceiling, ungated and
  unrated. **Good news inside it:** every failure surface was checked for honesty and all of them degrade without
  a wrong number — a stale Ontdek chart carries its own measured `syncedAt`, `/llms.txt` serves a real 503. The
  only untruth was the gate copy, now fixed.

### Checked and found SOUND — worth recording, because a clean lens is a result

The take's ordering (every early return precedes the decrement; decrement and insert share a transaction);
pot floor and negative-guard; refund idempotency; `duplicate_request` replay, including the refunded-row case;
`setTrialPot` without `where singleton` (the `singleton boolean primary key check(singleton)` makes a second row
structurally impossible) and without the advisory lock (both writers take the same row lock);
`hashtext` advisory-key collisions against the ledger's keys (harmless over-serialization);
`questionsLeft` computed in-transaction; the visitor cookie never reaching SQL unvalidated;
the partial indexes exactly matching both count queries' predicates; trial spend isolation including the
semantic checker; and — the one I most expected to break — **the null-user hole does not exist**: the 2-year purge
keys on scope + age with no `user_id` predicate anywhere, and a test pins it by name.

---

## 3. Item 2 — measured honestly by NOT measuring it

The queue asked for a clean same-conditions A/B of the fixture-snapshot saving, on an idle machine. **The machine
was not idle**: a second session was running full suites, and `uptime` read **32.8, then 41.2, on 8 cores**.
Re-running the A/B under that would have been session 57's mistake with a fresh baseline.

So the deliverable is the analysis instead, recorded as [#179](../open-questions.md). The short version:
**one number was never the right shape for this claim.** 37 files call `createIngestedDb()`; idle-machine build
(7.9–10.7 s) minus restore (1.16–1.39 s) is ~250 s of *CPU*, which at the ~7-way parallelism the vitest config
describes is ~35 s of *wall clock* — nowhere near 240 s. But that same config's history records builds hitting a
**120 s hook timeout** under parallel load. The old design degraded superlinearly with load; the new one does not.
The saving is therefore small on an idle machine and large on a busy one — and CI and a real dev laptop are busy.

Also corrected: `lessons-learned.md` retracted "680 s → 440 s" in one bullet and then **repeated it as fact three
bullets later**. A doc that corrects a figure in one paragraph and restates it in another has not corrected it.

## 3b. Deconfliction — what I withdrew once the other session's PRs appeared

The two sessions talked (twice, via cross-session messages) and both corrected the other. Recorded because the
corrections matter more than the overlap:

- **It corrected me on item 2, and it was right.** My first version of [#179](../open-questions.md) said the
  fixture-snapshot A/B was "still unmeasured". It had in fact been measured 17:15:57-17:57:08, before I started,
  on a quiet machine: four alternating legs, cold **+72 s** and **+145 s**, with the within-arm spread larger than
  the between-arm difference. I rewrote the row around its numbers. My own ~35 s arithmetic estimate was too low
  for the reason its data shows — the ingest cost is not a constant.
- **It declined my [#183](../open-questions.md) fix, and it was right.** I had framed the trial's 2000-char server
  cap versus its 500-char UI cap as a trial bug deferred only for coordination. `web/app/actions.ts` says in as
  many words that 2000 is "the belt behind" a 500-char client cap on the **paid** path too — server-cap-above-
  client-cap is the intended shape, so it is a product call, not a hardening. Row rewritten.
- **I withdrew my presence-grammar section (item 5).** It wrote a dedicated
  [13-envelope-presence-grammar.md](../13-envelope-presence-grammar.md) with a pointer from
  [05-data-rules.md](../05-data-rules.md), backed by the envelope-key manifest test from its conformance bundle.
  That is a better home than my inline section in 05, and two statements of one rule in two files is precisely the
  doc bug this project treats as a bug. Mine is gone; nothing of substance is lost.
- **I withdrew my RUNBOOK maintenance-agenda line** for the same reason — its version carries the tracked row
  number ([#189](../open-questions.md)). I kept only the two operational notes it does not have (the ~2026-10-15
  deadline, and that the "migration 020 not applied" note is now a real signal).
- **Kept, because they are uniquely mine:** the six code fixes, the #177 fix, the `05-data-rules` retention-scope
  correction (its PR does not fix it — that file still names the old two-tag scope while the code has three), the
  trial's two retention windows, and the **Vercel Firewall rule correction**: the RUNBOOK suggested rate-limiting
  `path starts with /api/`, but Server Actions POST to the page path, so on Hobby's one-rule limit that spent the
  only free rule on the two already-authenticated routes and left the sole unauthenticated LLM-spending endpoint
  uncovered.

**Expected merge conflicts, all trivial appends:** `open-questions.md` (my rows 179-186 vs its 187-190),
`lessons-learned.md` and `ADR 036` (adjacent sections), `05-data-rules.md` (different paragraphs).
**Merge order: PR #64 first** — it is the wider, already-reviewed change and my `trial-actions.ts` hunk sits three
lines from its own. After that this branch, then its #65/#66 in any order. One constraint for whoever resolves the
`trial-actions.ts` conflict: **guard order must stay `typeof question → length → trialConfigured → requestId
shape`**, because #64's new test calls `askTrialQuestion(<block array>, 'r1')` and passes only because the question
guard throws before the requestId guard this branch tightened.

## 4. What I did not do, and why

- **Item 1 (conformance bundle)** — the other session owned it and was mid-write. Not touched.
- **Item 3 (#177 `llm_calls` role mislabel)** — left for the session that owned the main tree; I had claimed it in
  my message but could not confirm it had not already started, and a duplicate PR is worse than a missing one.
- **The WP26 flags, WP30c, #132, #172, #104/#112, the #151 backfill, pricing #101, #174/#175** — owner-only, per
  the queue.
- **Any write to the main working tree, and any push to `main`.**
