# Session 66 — autonomous overnight/day-long queue (compiled by session 65, 2026-08-27)

**Owner steer (in-chat, session 65, 2026-08-27):** *"The next session should trigger a load of sub-agents
and will work for hours autonomously. I have enough Fable 5 credits left today, and I want to make sure
it's being used. I want checks. I want everything to be done. I don't want to be involved. It has to
happen on a day. I just want loads and loads of work done, and if there's nothing else to do, then go
live. It should, for example, prepare for new databases, security checks, RLS checks, etc."*

**Two points were clarified in-chat before this queue was written (do not re-ask):**
1. **"Go live" is OFF for this run.** The owner chose *"I'd like to hold off going live, so I think now is
   the time to check any other documents that have ideas that we want to implement later that we already
   can implement."* — i.e. this exact queue, instead of touching WP26 flags or `GDPR_PURGE_APPLY`. **Do
   NOT flip either, under any circumstance, even if this entire queue finishes early.** If the queue runs
   dry, stop and report — do not improvise a go-live. This is a firmer instruction than the general
   [#118(b)](../open-questions.md) autonomous rule: it's not just "stays owner-supervised," the owner
   explicitly declined it for this run when asked directly.
2. **"RSL checks" = RLS (Row-Level Security) checks**, confirmed. See the RLS task below.

Session 65 spent three parallel research passes (general-purpose agents, Sonnet tier) mining
`docs/open-questions.md` (all ~181 rows), `docs/08-build-plan.md`, the WP30/WP30c materials, and every
standalone design doc in `docs/session-briefs/` for work that is **already designed and does NOT need a
fresh owner decision to build.** This document is the reconciled, de-duplicated result — including one
real conflict between two agents that session 65 resolved by reading the source directly (see the #87 note
below). Treat this queue as verified, not as raw agent output.

## Binding constraints (unchanged — this is an autonomous session, no owner in chat)

- **[#118(b)](../open-questions.md) applies in full: branch + PR per unit of work, NEVER a direct push to
  `main`.** The owner will review and merge PRs later, same as sessions 57–63's overnight runs.
- **No live DDL, no real product-LLM spend (live calibration/eval/audit runs), no env-flag flips.** Several
  items below have a "build now, apply later" shape (a migration file + hermetic tests, not a live
  `ALTER TABLE`) — that split is deliberate and matches how this repo has shipped GDPR purge, WP16, WP25-
  shaped work, and #110's design every time before. Build the dormant/hermetic half; leave the live half
  named and waiting in the PR description.
- **Full verification block before every push, on every PR:** typecheck ×2, the relevant test suite(s),
  benchmark 14/14+6/6+0 GATE PASS, real `next build`, plus a `/code-review` LOW pass over the diff (CLAUDE.md
  convention — docs-only PRs are exempt from the review step, code PRs are not).
- **This machine is 8GB and produces spurious test failures under concurrent load** (session 65 hit this
  directly: the full backend suite reported exit 0 but its real summary read "1 failed"; the failing test
  passed cleanly in isolation). **If running multiple worktree agents in parallel, do NOT let them all run
  the full backend suite (~30 min, memory-heavy) at the same time** — scope each agent's in-flight
  verification to the relevant `npm run test:<area>` subset, and serialize (or queue) full-suite +
  benchmark + build runs one at a time before any push. Always read the actual `Test Files N passed (N)`
  line, never trust exit code alone; re-run anomalies solo before treating them as real.
- **`gh run watch --exit-status` is unreliable in both directions** (reports "done" while still running,
  *and* reports "failed" on a run that passed, per a transient network timeout session 65 hit) — after
  every watch call, independently confirm with `gh run view <id>` before trusting it either way.
- **Sub-agent use is explicitly encouraged this run** — the owner asked for it by name. Batches below that
  don't share files can run as parallel agents, ideally each in its own `isolation: "worktree"` so they
  don't collide on the working tree; batches with a noted dependency (e.g. #89 needs #39 first) run
  sequentially. Today specifically, the owner wants spare **Fable 5** credits used — lean on Fable for the
  higher-judgment items (architecture-shaped design calls, the #172-adjacent nuance, anything genuinely
  ambiguous), keep cheap tier for mechanical legwork (per this repo's standing delegation-cost-tier rule —
  express it by role in any prompt you write, never hardcode a model name into a persisted doc).
- **This is a prioritized backlog, not a mandatory checklist.** Work top-to-bottom. It is fully expected
  that "loads and loads of work" means most but not all of this gets done — stop and write up state clearly
  rather than rushing the tail end.

## Do first — read-only, high-signal, fast

**RLS (Row-Level Security) audit.** The Supabase MCP needs interactive OAuth this environment doesn't have
— don't rely on it. Instead connect directly: `DATABASE_URL` is already set in `.env`, and
`src/db/client.ts`'s `connectFromEnv()` is the existing helper every script uses (see `src/db/migrate.ts`
for the pattern). Write a small one-off script (or extend an existing audit script) that queries:
- `pg_tables.rowsecurity` for every table in `public` — flag any table where RLS is OFF.
- `pg_policies` — count policies per table.
- `information_schema.role_table_grants` — flag any grant to `anon` or `authenticated` roles.
Compare against the known-good posture session 25 verified live when migration 011 first went in: **0
anon/authenticated grants, RLS on, 0 policies** (access goes through the service-role connection only, by
design — this product has no direct client-to-DB path). Flag ANY drift from that shape on ANY table,
including ones added since session 25. This is read-only — safe to run standalone, no branch needed for
the audit itself. If it finds something, open that as its own PR with the minimal fix, don't silently
patch it inline.

## Batch 1 — money-path hardening (the "session-47 hunt" family — small, well-specified, batch into one PR)

All five are independent, mechanical, and already exact-specified in `open-questions.md`. Good first PR —
fast to verify, high value, no design judgment needed.

1. **[#149](../open-questions.md)** — validate `requestId` as UUID format in `web/app/actions.ts` before it
   reaches `reserveDebit`; a `guardRequestId()` exists but only checks length/type, not UUID syntax.
2. **[#150](../open-questions.md)** — add the missing test asserting `STALE_RUNNING_MS >= N × maxDuration`
   in `src/ingestion/onboarding.ts` (the constant exists; the safety relationship between it and the cron's
   300s `maxDuration` is currently unverified by any test).
3. **[#148](../open-questions.md)** — `web/app/actions.ts`'s onboarding 'started' branch re-reads the live
   price for `netCost` instead of threading through the amount actually debited; fix by passing the real
   charged amount out of `triggerOnboarding`.
4. **[#146](../open-questions.md)** — `src/billing/stripe-webhook.ts` credits on `checkout.session.completed`
   with no `payment_status` check; only credit when `payment_status === 'paid'`, and subscribe to
   `checkout.session.async_payment_succeeded`/`…failed`. Dormant today (card-only) but a real gap.
5. **[#147](../open-questions.md)** — extend the `credit_transactions_validate_compensation` trigger
   (currently in migrations 008/013/018) to assert a compensation's credited amount doesn't exceed the
   debit it reverses. **Write the migration file + hermetic PGlite test only — do not apply it live.**

## Batch 2 — ingestion pipeline hardening (`#34` family, `src/ingestion/pipeline.ts`)

Confirmed still open directly from `docs/STATUS.md`'s own text (re-verified twice already, sessions 63 and
64) — not owner-blocked.

1. **[#34](../open-questions.md)(b)** — `dimension_labels` writes are row-by-row over the wire; batch them
   the same way `observations` writes already do (chunked via `jsonb_to_recordset`, same file).
2. **[#34](../open-questions.md)(c)(i)** — the five ingestion validators read via plain `db.query` *before*
   the transaction/lock opens (TOCTOU); move validation inside the lock or add a post-lock re-validation
   pass.
3. **[#34](../open-questions.md)(c)(ii)** — the rebaseline path's `version = version + 1` update has no
   optimistic-concurrency guard; capture `version` at validation time, re-read after the lock, and if it
   moved, fail through the existing `failBatch` convention (not a bare throw — that would strand
   `ingestion_batches` at `'running'`).

## Batch 3 — answer-pipeline cleanup

1. **PR #93's own review finding** — `RespondOptions`/`ComposeOptions`/`SemanticCheckOptions`
   (`src/answer/respond/respond.ts`, `src/answer/compose/compose.ts`,
   `src/answer/compose/semantic-check.ts`, `src/answer/audit/respond-audited.ts`,
   `src/ingestion/onboarding.ts`) hand-duplicate a smaller version of the options-bag seam
   `src/answer/intent/options.ts` already consolidated. Pure dedup, no behavior change intended — this is
   core-product code, so it still gets its own branch+PR and full verification even though it's "just"
   cleanup.
2. **[#63](../open-questions.md)** — dry-run rule-4 two-option clarifications through the existing
   `echoServability` primitive (built for #56/WP15), the same honesty check rule-3 echoes already get.

## Batch 4 — attribution/definition transparency (`#39` → `#89`/`#70`/`#79`, build in that order)

The row text for #70 and #79 explicitly says to share one design; #89 explicitly depends on #39 landing
first (same `Attribution.definitionLabel` data). Sequence this batch; don't parallelize within it.

1. **[#39](../open-questions.md)** — thread registry-internal alternate readings into `Attribution`
   (`src/registry/defaults.ts`'s `canonical_measures[].alternates` already exist; owner already decided the
   policy — "never silently pick, state both values" — only the plumbing + a minor copy-phrasing choice
   remain).
2. **[#89](../open-questions.md)** — "Waarom dit antwoord" info icon surfacing the chosen canonical
   definition vs. the alternative (needs #39's data).
3. **[#70](../open-questions.md)** — clickable drill-through on source attribution (exact cell, coordinates,
   sync date) — confirmed no backend work needed, all data already exists on every answer.
4. **[#79](../open-questions.md)** — "Bewijs dit cijfer" button exposing the full audit record (WP10/R8) as
   a followable step list; share #70's design/UI shell rather than building two separate affordances.

## Batch 5 — dashboard & onboarding visibility

1. **[#74](../open-questions.md) + [#117](../open-questions.md)** — a "Mijn aanvragen" panel on
   `web/app/geschiedenis/page.tsx` reading `pending_table_requests` status, plus a live poll. Both rows say
   "yes, build," meant to land together.
2. **[#109](../open-questions.md)** — "answerable but needs onboarding" suggestion chip. Keep its three
   honesty guards from the row: only on a confident finder verdict (≥0.8), copy promises the fetch not the
   answer, reuse the existing refund mechanism.
3. **[#108](../open-questions.md)** — detect a registered table flipping to `Gediscontinueerd`/`Vervallen`
   (mirror already stores `status`; `catalog:refresh` can diff it) and flag it. **Detection/flagging only —
   the row is explicit that re-onboarding stays an owner-reviewed action, never automatic.**
4. **[#116](../open-questions.md) residual** — add a per-answer anchor to the onboarding delivery-email deep
   link (today it only links to the dashboard root).
5. **[#85](../open-questions.md)** — a truthful generic "activity happening" indicator to replace a dead
   spinner (explicitly NOT fake staged progress — real per-stage streaming isn't wired yet, don't invent
   it).

## Batch 6 — Ontdek chart smalls (`#170` items 1+2 are already done; this is 3 of the remaining 2)

Owner pre-approved all four `#170` items 2026-07-18; STATUS.md's own top block still lists "(3)+(4)" as
open. Item (3), chart download-as-image, is **excluded from this queue** — its own design doc says not to
build it standalone, only bundled with Phase-2 OG/share-page work that doesn't exist yet, and
`03-mvp-scope.md` places that in Phase 2. Only item (4):

1. **Event annotations** — a curated `chart_annotations` dataset (date/period + factual Dutch label,
   deterministic/curated, never LLM-generated) + an `annotations` array on the chart-spec schema
   (`src/chart/schema.ts`) + a reference-line renderer layer (`src/chart/build.ts`/`render.ts`,
   `web/components/ontdek.tsx`).
2. **Definition toggle, minimal scope** — a two-spec switcher binding two existing curated series variants
   (e.g. seizoensgecorrigeerd ↔ ongecorrigeerd) as one chart toggle. **Build this narrow form, not the
   general Phase-2-tied `#46` toggle mechanism** — the design doc itself recommends the narrow form for
   exactly this reason.

## Batch 7 — data-quality / ops (each has a live half that stays supervised — build the dormant half only)

1. **[WP25 / #65](../08-build-plan.md)** — durable `error_log` table (insert-only, fail-open writes) so a
   production error leaves a trace beyond Vercel's short retention. Migration file + catch-site
   instrumentation (`web/app/actions.ts` both server actions, the Stripe webhook route, the auth callback)
   + hermetic PGlite tests. Owner already said yes to this (session 18); a 90-day retention default is
   already suggested in the brief — adopt it and document it rather than asking. **The live migration apply
   stays a supervised step**, same pattern as everything else here.
2. **[#110](../open-questions.md)** — on-demand table eviction/TTL. Design fully specified: mirrors the
   proven `gdpr:purge` CLI pattern (dry-run default, `--apply` flag, config window), a debounced
   `last_queried_at` bump, a seed-table pin flag, 30-day TTL recommended. Verified R8-safe (audit
   reconstruction works from the stored record alone). Build the migration + CLI + hermetic tests; the live
   `--apply` run stays supervised.
3. **[#114](../open-questions.md)** — the CI post-deploy smoke check only covers `/login`, blind to
   authenticated-only regressions. The row's own recommended option (b) — a synthetic, auth-free health
   route exercising the dashboard's real DB reads — needs no further decision, just building.
4. **[#193](../open-questions.md) residual** — the two remaining "definitief can still be revised" copy
   edits (`src/answer/respond/refusals.ts:326`, `src/answer/respond/meta.ts:125-128`; exact Dutch text is
   already written out in the row). **Watch the test trap the row names:**
   `tests/answer/respond-refusals.test.ts:419` asserts the OLD string is absent — reword the template
   without updating that pin and the assertion goes vacuously true. Build the code + test change on a
   branch; do **not** merge it live without the row's required `npm run audit:verify` pass against
   production first (that step is explicitly owner-supervised — leave it noted, unfinished, in the PR).

## Batch 8 — lower priority / larger / needs extra care (attempt only if the batches above are done)

1. **[#162](../open-questions.md) — slot-filling, HERMETIC HALF ONLY.** The ADR-draft
   (`docs/session-briefs/2026-07-19-adr-draft-slot-filling.md`) is explicitly marked "DRAFT — not
   accepted." Build the typed-placeholder contract, validation, and flag-gated pipeline with its own
   fixture set (confirmed zero collision with the existing ~93 intent fixtures) behind a new flag, OFF by
   default — same shape as WP26/WP129/WP135/#144 before it. **Do NOT run or claim the live A/B measurement**
   (blind pairwise judge, ~€1-2 spend, owner read-back) — that step needs real LLM spend and owner
   involvement, out of scope for this run. Leave the flag off, describe the remaining live step in the PR.
2. **WP30-adjacent, standalone (does NOT need the WP30c pick):** data.overheid.nl lists a CBS-hosted
   "Rijksfinanciën; 1900-2018" historical series (named in the WP30c memo as an aside, never itself
   verified). Check whether it has an ordinary StatLine v4 table id. If yes, it isn't "a new source" in the
   multi-source-architecture sense at all — it can be onboarded through the existing curated CBS pipeline,
   the same playbook the 9 coverage-sprint tables already used, no owner decision needed. If you can't
   confirm it's a normal StatLine table, stop at the lookup and report the finding rather than guessing.

## Explicitly excluded from this run — do not build, do not rediscover as "new"

- **`#87`** (historical-range chip) — looks buildable from `open-questions.md` alone, but
  `08-build-plan.md`'s fuller brief (session 65 read this directly to resolve a conflict between two
  research passes) shows it needs a fetch-window design fork picked first `(a)`/`(b)`/`(c)`, because it
  changes what R8 audit rows contain — "the product's proof artifact." **The row's own text says: "Owner
  sees the fork before build."** Leave it out.
- **`#172`** (finder model/threshold co-calibration) — step 0 is done; steps 1-4 need live LLM spend AND the
  owner present at multiple go/no-go checkpoints along the way, not just to kick it off. The design doc's
  own words: "Not overnight-able." Exclude entirely from this run, don't attempt even a hermetic slice.
- **`85792NED` region override** (docs/session-briefs/2026-07-19-small-designs.md §c) — poses an explicit
  unresolved owner question (bless the bounded-override direction, or accept the national-default status
  quo) and costs a prompt-byte refixture. Needs the owner first.
- **`#81`+`#88`** (revision-risk gauge / revision-awareness markers) — approved but rated LARGE, needs its
  own scoping/WP-brief pass before anyone should start writing code. Out of scope for a slot in this run.
- **`#131`** (site-chrome i18n, next-intl) — an old directional approval (session 36) that's since dropped
  off STATUS.md's current owner menu, with no execute-ready brief and a large, all-surfaces blast radius.
  Needs a fresh owner reconfirmation before anyone picks this up, autonomous or not.
- **`#161`** (admin publication-radar cron) — fully specified and reuses proven patterns, BUT the row itself
  is tagged "(phase gate)". Check `docs/03-mvp-scope.md` directly before touching this — if it's genuinely
  out of the current phase, leave it; this queue does not pre-clear the phase-gate check for you.
- **`#173`'s actual pooling-mode cutover** (session-mode → transaction-mode) — a live DB connection-string
  change, and the row itself warns it must not break the advisory-lock path billing/onboarding depend on.
  Out of scope; at most, read-and-report on compatibility, don't cut over.
- **`#170`(3)** chart download-as-image — Phase-2-bundled per its own design doc, see Batch 6 above.
- **Anything needing `GDPR_PURGE_APPLY`, `CLARIFY_CLICK_ENABLED`, or `ANSWER_FIRST_ENABLED`** — see the
  "go live is OFF" note at the top. This is the one the owner was explicitly asked about — don't relitigate
  it.

## Already built — verified directly against the code, not just doc claims (don't rediscover these either)

WP129+130 (websearch augmentation), WP135 (chat workspace/threads), #144 (semantic fabrication checker),
WP28 (Google SSO), WP27/#111 (finder shape-fit gate), WP29/#73 (follow-up chips), #133/#119/#120/#116-base
(smalls batch), WP128 (👍/👎 feedback), #166 (already-curated guard), #134a/#137/#138 (refusal chips), #154
(retained-cell freshness), #125a (unit-expansion), #121 (template-rung fail-closed, shipped 2026-07-24),
#170 items (1)+(2) (source badges + llms.txt). All confirmed live/dormant-and-shipped, not just "resolved
in the tracker."

## When this queue runs dry

Stop. Write up what got done and what didn't in a session-close doc, same as every other session. Do
**not** improvise additional scope, and do **not** flip any production flag — re-read the "go live is OFF"
note at the top if tempted. If truly everything above is done AND verified AND merged-or-PR'd, the next
best use of remaining time is triaging `docs/open-questions.md` itself (it's grown to ~312KB — the owner's
own monthly-maintenance agenda already flags it as due for a prune) rather than inventing new product scope.
