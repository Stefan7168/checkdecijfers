# Overnight autonomous queue #2 — after session 57's merges

**Written by session 57 on 2026-07-25, owner present, at his request ("let's also do another autonomous session").**
Reading order: `CLAUDE.md` → [`docs/STATUS.md`](../STATUS.md) (the ▶ block is leading) → this file.
The chat will be gone; the repo is the source.

---

## 0. The rules that bind this session — non-negotiable

1. **Branch + PR + owner review** for everything ([#118](../open-questions.md)(b)). Do NOT push to `main`.
   The standing "push everything" authorization applies ONLY when the owner is in the chat. He is asleep.
2. **Zero live-LLM product spend.** No `intent:eval`, no `tablefinder:record`, no `--live` benchmark, no
   fixture re-records. Everything hermetic.
3. **Zero prompt bytes.** `prompt.ts` / `schema.ts` / `parse.ts` stay byte-identical — otherwise ~93 fixtures
   invalidate ([#164](../open-questions.md)) and that needs a supervised window.
4. **No live DDL.** A migration may land as a FILE; it is not applied.
5. **Do NOT flip `CLARIFY_CLICK_ENABLED` or `ANSWER_FIRST_ENABLED`.** WP26 is merged and live but DORMANT.
   The go-live is explicitly the owner's own supervised step — he has now said so twice.
6. **Do not stack deploys** ([#173](../open-questions.md)). Branches do not deploy (the `deploy` job is
   `refs/heads/main`-gated), so this is mostly about not running `--env-file=.env` scripts from the laptop.
   Canary: `curl -s -o /dev/null -w '%{http_code}' https://checkdecijfers.vercel.app/llms.txt` → 200.
7. **Full verification block before every PR**: typecheck (root + web), full backend suite, web suite,
   benchmark (14/14 + 6/6 + 0 fabricated), real `next build`, and a review pass over the diff.
   ⚠ **Always `git fetch` before merging `origin/main` into a branch** — session 57 merged a stale ref and
   only caught it because the test count came out 5 short of the arithmetic. Check the counts.
8. **Delegation** — three tiers, by ROLE (never hardcode model names in reusable prompts):
   | Role | Tier |
   |---|---|
   | Orchestration, scoping, final judgement, merge decisions | session model |
   | Architecture + deep/adversarial analysis | **Fable** (`Agent` with `model: "fable"`) |
   | Mechanical legwork, broad searches, first-pass verification | Sonnet / Haiku |
9. **Nothing here is an owner decision.** If you hit one, record it and move on.

---

## 1. Where the project stands (verified 2026-07-25)

Production is LIVE and handles real money. **All four of session 57's PRs are merged and deployed**
(`e334590` #60 pool 4→2, `ea71c96` #61 fixture snapshot, `29e9e8b` #62 WP26 trust boundary, plus the docs PR).
Production verified healthy after each deploy. **WP26 remains DORMANT behind its two flags.**

Not for this session, but to know: the ~30/7 BBP+PPI syncs (`85880NED` MUST use the chunked escape hatch,
RUNBOOK step 5), the #132 route-B GO, and the WP26 flag flip are all owner-supervised.

---

## 2. The queue — in order, one branch + PR per item

### Item 1 — the conformance bundle (the architecture memo's #3, and its most concrete recommendation) ⏱ medium · tier: session model, legwork to Sonnet

The [architecture memo](2026-07-25-wp26-architecture-review-memo.md) named one cross-cutting problem: this
project **pins every rule about a NUMBER with machinery and every rule about the SYSTEM with prose**. Four
small pins close most of it. Do them as ONE PR:

- **A test for the double-default path.** No test today exercises "no region AND no period on a geo table" —
  the exact branch the flag flip activates. Verified absent by the layer-separation review.
- **Single-source `NATIONAL_REGION_CODE`.** It is declared three ways: the real export in
  `src/answer/intent/resolve.ts`, a hardcoded `'NL01'` in `src/query/run.ts`, and a local copy in
  `src/answer/respond/suggestions.ts`. One layer currently PREDICTS another layer's default this way.
- **An envelope-key manifest test.** A manifest listing every `ComposedResponse`/`ComposedAnswer` key with
  its R8 category (`rederived` / `shape-checked` / `ignored:<reason>`), plus one test diffing it against a
  canonical fixture's key set. Today a new field with no reconstruct check lands silently in "ignored".
- **A query-count pin.** A counting `Db` wrapper asserting the number of DB queries a flags-off
  region-ambiguous turn issues. This is what would have caught [#176](../open-questions.md), and per-request
  DB cost has now grown silently across four work packages.

Done: PR with the four pins, full suite green, and a line in `lessons-learned.md` if anything surprising falls out.

### Item 2 — a clean, same-conditions A/B of the fixture-snapshot saving ⏱ small · tier: session model

Session 57 merged PR #61 quoting "680s → 440s". **That pair was load-confounded** (the baseline ran while six
review agents were working). The mechanism is cleanly measured (build 7.9-10.7 s vs restore 1.16-1.39 s;
3-file run 11.0 s → 2.4 s), but the suite-level ratio is not.

Measure it properly: run the full backend suite twice back-to-back on an otherwise idle machine, once with
the snapshot warm and once with it disabled (delete `node_modules/.cache/cdc-fixture-db` and add a temporary
env guard, or stub `readSnapshot` to return null). Report both numbers with `uptime` load captured alongside.
**Then correct the figure wherever it appears** (`status-archive.md` already carries a correction note;
update it with the real number). A measured "less than we claimed" is a perfectly good result — say it plainly.

### Item 3 — [#177](../open-questions.md), the `llm_calls` role mislabel ⏱ small · tier: Sonnet, judged by the session model

A rescue-path fresh parse is recorded under role `'clarify'` while it actually issues the standalone question
prompt. Cosmetic today, but it is exactly the honesty the sibling comment in `respond-audited.ts` says the
role label protects, and it will mislead any future spend-by-role analysis. Small, self-contained, well
understood. Check whether any test or the audit reconstruction pins the current label before changing it.

### Item 4 — a second adversarial pass, this time on the surfaces WP26 did NOT touch ⏱ medium · tier: Fable

Session 57's four lenses covered WP26's new client-held state thoroughly. The capacity review then pointed at
a different, un-hunted area: **the anonymous trial path** (`web/app/trial-actions.ts`, `web/lib/trial.ts`,
`src/billing/trial-pot.ts`). It is the only anonymous, unauthenticated, money-adjacent surface in the product,
it has no billing gate metering entry, and it is LIVE.

Give Fable agents one lens each: (a) can an anonymous visitor drain or corrupt the pot faster than one
question per real question; (b) the IP-hash limiter — what does it actually bound, and what does it not;
(c) the 90-day bookkeeping sweep in `gdpr:purge` — does it do what ADR 036 claims; (d) capacity, per the
memo's finding that `getTrialGateState` runs two uncached DB queries per anonymous request against a
15-connection ceiling. Findings only; the session model decides what gets fixed and what is recorded.

### Item 5 (only if time remains) — the presence-grammar write-up ⏱ small · tier: session model

The memo's recommendation 6: write down, once, which envelope fields are present-only (absent = pre-feature
or flag-off) and which are required-nullable, and that `suggestions` deliberately differs by response kind.
Docs-only, ~30 minutes. It converts per-field folklore into a rule the next session can check against.

**Do NOT do without the owner:** the WP26 flag flip, the WP30c choice, #132 GO, #172 co-calibration,
#104/#112, the #151 backfill, pricing options #101, and anything in [#174](../open-questions.md)/[#175](../open-questions.md)
(both are product decisions, deliberately left to him).

---

## 3. Closing

Run the full wrap-up ritual from `CLAUDE.md` (lessons, memory, the FULL docset, stale-doc sweep, clean state,
cleanup, kickoff brief, final self-audit). Hold to the golden rule: **verify every fact against reality, never
from memory** — dates via `date`, PRs via `gh`, CI via `gh run view`, production via `curl`.

Two things session 57 learned the hard way, worth repeating:
- **A review pass over your OWN diff found a real defect in both code PRs.** Budget it as a required step.
- **Check the arithmetic on test counts after a merge.** It is what caught a stale-ref merge that had silently
  dropped a whole feature's files.

Leave the owner one overview: which PRs await review, what you deliberately did NOT do and why, and what the
adversarial pass on the trial surface found.
