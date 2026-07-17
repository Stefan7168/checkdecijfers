# #166 — the already-curated guard (design, autonomous chip session, 2026-07-17)

**Problem (verified in code, session 49):** a finder synonym-miss onto an ALREADY-INGESTED table charged
100 credits for data we hold (`triggerOnboarding` had no check) and Step 6 auto-derived duplicate
`onboarded:<id>:*` vocabulary next to curated keys (the pollution #165 cleaned up in prod). The coverage
sprint multiplies the exposure: every new curated table is a new synonym-miss target.

## Decision (implemented on branch `166-already-curated-guard`, PR pending owner review)

Two thin layers; **the money function `triggerOnboarding` stays byte-identical** (reviewability: the charge
path is not touched, it just becomes unreachable for held tables).

1. **Pre-charge guard in the finder closure** (`src/ingestion/onboarding-finder.ts`): a confident pick whose
   table satisfies the job's own `alreadyIngested` predicate (registered `active` + `last_sync_at` set —
   EXPORTED and shared, one definition, no drift) returns `null` → the pipeline emits the **byte-identical
   B15 clarification**, which already names the loaded topics. No acknowledgment, no trigger, no debit —
   structurally. Registered-but-never-synced tables still route (the guard keys on held DATA, not
   registration). Any guard failure degrades to `null` via the closure's existing catch (money-safe).
   **Second leg (session-50 pre-merge review, adversarially confirmed HIGH):** the WP27 fit gate (live
   since session 33) resolves over the WHOLE candidate chain, not just the pick — so an already-held
   ALTERNATE in `candidateIds` would let a charged job skip the fetch and deliver from data we already
   hold (the pick fails the structural fit, the gate falls through to the held alternate). The finder now
   screens the alternates with the SAME predicate (`alreadyIngestedSet`, one batched roundtrip for pick +
   alternates), before the cap-3, so a charged onboarding can only ever resolve to a genuinely new table.
   **Deliberate trade (max-review finding 3):** this removes ADR 027's rescue-delivery for the
   misfitting-pick + held-fitting-alternate case — pre-#166 that path DELIVERED (charged 100 for held
   data, the exact #166 complaint); post-#166 it ends `no_fit` → unanswerable + honest refund. Money-
   correctness wins; the unanswerable e-mail copy was made fetch-neutral in the same change (it claimed
   "opgehaald bij het CBS" on a path that fetches nothing).
   **Ordering (max-review finding 2):** the per-user `findActiveRequest` check runs BEFORE the held-table
   guard — the user's own job commits `last_sync_at` at Step 5 seconds before finalize, and a re-ask in
   that window must keep getting "wordt al voor je opgehaald", not a misleading B15.
2. **Job-side belt in Step 6** (`src/ingestion/onboarding.ts`), **per-MEASURE since the session-50
   follow-up (max-review finding 1)**: measures already covered by a CURATED key (a `canonical_measures`
   row whose key is not `onboarded:`-prefixed) are excluded from auto-derivation
   (`registerOnboardingVocabulary`'s `excludeMeasures`) — never a parallel `onboarded:<id>:*` row next to
   a curated key (the #165 pollution). Measures WITHOUT curated coverage still derive, so a
   partially-curated table stays deliverable for those (the original per-TABLE skip silently downgraded a
   charged question on an uncurated measure from delivery to refund). A question only the curated
   vocabulary covers answers via the standard prompt; one nothing covers ends unanswerable + refund
   (honest, principle c). Reachable only via the trigger-vs-curation race or a pre-guard pending row. The
   skip marker is written to `slice_note` only when the slot is empty (`recordSliceNoteIfEmpty`, session-50
   review: a reclaimed retry may re-enter Step 6 after an earlier attempt already wrote the REAL
   slice-estimate note — never clobber it; console is the diagnostic floor). Retries for genuinely
   onboarded tables are unaffected (they carry only `onboarded:*` keys).

**Answer to the design question posed to the owner** (chosen pending review — the merge IS the approval per
#118(b)): route to the **normal clarification at trigger time** (option a), NOT "run the paid onboarding but
skip the debit" (option b: it keeps the fake wait-UX for data we already hold, and a zero-debit delivered
row would be a new ledger shape on the money path). **Recorded alternative / possible follow-up:** a richer
"bedoel je <curated term>?" clarification pointing at the specific canonical keys — better UX than the
generic B15 list, but new Dutch product copy (owner sign-off) and a new response shape; deliberately NOT in
this PR.

**Accepted residual (widened per max-review finding 7):** the finder-screen→job window is NOT merely
seconds — a fail-soft kick falls back to the daily 06:00 cron, reclaims wait 20 minutes, MAX_ATTEMPTS=3,
and pre-guard queued rows carry unfiltered chains; any concurrent actor (owner curation, another user's
job) can make a screened-clean candidate "held" before the job runs. In ALL those interleavings the row
keeps the old behavior once: charged, then delivered from existing data via the Step-3 piggyback + the
per-measure belt (money conserved — an inherent async-queue race the piggyback absorbs, not a #166
recurrence). Optional hardening (not built): re-check `alreadyIngestedSet` inside `runFitGate`.

**Tests (hermetic, on the gate; all on the 82235NED fixture — the 83693NED coverage-sprint SHAPE, mimicked,
not the literal table):** finder guard fires on an ingested pick / does NOT fire on a registered-unsynced
pick / screens a held ALTERNATE out of the candidate chain with the chain re-filling before the cap / the
user's own active fetch outranks the guard (post-sync window → alreadyPending, a different user still gets
null) (`tests/ingestion/onboarding-finder.test.ts`); job belt per-measure: a synced table with one curated
key delivers via the standard vocabulary with the curated measure never re-derived while uncurated
measures re-derive; a question on an UNCURATED measure of a partially-curated table delivers via freshly
derived vocabulary; the fresh-sync curated path preserves the real slice-estimate note
(`tests/ingestion/onboarding-job.test.ts`).
