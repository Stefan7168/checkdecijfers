# PR #54 (#166 already-curated guard) — max-effort review findings (2026-07-17)

> **DISPATCH RECORD (session 50, same day — every finding verified in code before acting; the file
> arrived from a parallel session AFTER PR #54 had merged, so the fixes landed as a follow-up commit
> on `main`):** 1 ✅ fixed (per-measure belt via `excludeMeasures`; partial-curation delivery test added).
> 2 ✅ fixed (active-fetch check reordered before the guard + post-sync-window test). 3 ✅ dispatched as
> recommended (filter kept — money-correct; design-doc sentence corrected; unanswerable e-mail copy made
> fetch-neutral). 4 ✅ accepted; richer clarification stays the recorded follow-up (owner sign-off, new
> copy) — noted in the #166 row. 5 ✅ fixed (batched `alreadyIngestedSet`, one roundtrip). 6 ✅ fixed
> (wording corrected + partial-curation test). 7 ✅ doc fixed (residual paragraph rewritten; optional
> `runFitGate` re-check recorded, not built). 8 ✅ RUNBOOK line added (apply-after-deploy ordering).
> 9 ✅ STATUS line fixed. 10 ✅ ADR 027 updated. 11 ✅ partially: `ONBOARDED_KEY_PREFIX` exported from
> `onboarding-vocab.ts` (the owning module) and used in `onboarding.ts`; `query/resolve.ts`'s literal is
> left deliberately — a query→ingestion import would cross the ADR-001 module boundary for a cosmetic
> dedup. 12 ✅ fixed (`OnboardedMeasure[]`).

Input for the session finishing PR #54 (branch `166-already-curated-guard`, INCLUDING the uncommitted
session-50 working-tree changes: second-leg alternates screen + `recordSliceNoteIfEmpty`). Produced by a
separate owner-present review session: 10 finder angles + 6 adversarial verifiers + gap sweep (fan-out on
the cheap tier, judgment by the session model). **Per the #118 verification block: fix or consciously
dispatch every finding below before the branch is pushed/merged.** None is a wrong-number or lost-money
bug (every bad path ends in an honest refund); the top three are service regressions on the money path.

## Needs a fix or an explicit owner dispatch (ranked)

1. **CONFIRMED · `src/ingestion/onboarding.ts:410` — the Step-6 belt is per-TABLE, not per-measure.**
   One curated key disables auto-derivation for every uncurated measure on the table. 83693NED shape:
   8 measures, 3 curated, all 8 empty-dims (pre-#166 all derivable). In the registered+curated-but-unsynced
   window (real sprint state: `registry:apply` needs registration only; #164 encourages batching vocab
   ahead of syncs) a question on an uncurated measure is CHARGED, Steps 4-5 sync for real, then delivery
   refuses + refunds where pre-#166 delivered. Once synced, the finder null-routes the table forever —
   uncurated measures have NO automatic vocabulary route left (`scripts/onboarding-reregister.ts` only
   rewrites `onboarded:*`). **Recommended fix:** make the skip per-measure — derive vocab only for measures
   NOT already covered by a curated key (filter inside/around `registerOnboardingVocabulary`), which keeps
   the #165 anti-duplication goal AND keeps uncurated measures deliverable. OWNER CALL (money-path change).
2. **CONFIRMED · `src/ingestion/onboarding-finder.ts:77` — guard ordered before `findActiveRequest`.**
   A user re-asking while their own paid job is between sync-commit (Step 5 commits `last_sync_at` in its
   own tx) and finalize (Steps 6-7, seconds-to-tens-of-seconds) now gets "Ik heb geen CBS-cijfers over X
   geladen" instead of "wordt al voor je opgehaald, geen nieuwe kosten". **Fix:** check `findActiveRequest`
   BEFORE the held-table guard (pure reorder). Test gap: the existing alreadyPending test never sets
   `last_sync_at`; add the post-sync-window case.
3. **CONFIRMED · `src/ingestion/onboarding-finder.ts:86` — the alternates screen removes ADR 027's rescue
   path.** Misfitting confident pick + already-held fitting alternate: pre-PR the chain delivered (ADR 027's
   own founding scenario/calibration case); post-PR → `no_fit` → refund, and `onboarding-notify.ts:85`'s
   email then FALSELY opens "We hebben cijfers over {topic} opgehaald bij het CBS" (nothing was fetched).
   Money-correctness vs answer-completion trade. **Recommended dispatch:** keep the filter (money-correct),
   but fix the design doc's wrong "ends unanswerable + honest refund as before" sentence AND the email copy
   for the no-fetch path. OWNER CALL if the rescue path should instead be preserved somehow.
4. **CONFIRMED · `src/answer/intent/policy.ts:172` (via the guard's null) — B15 lead is factually false for
   held tables** ("geen CBS-cijfers … geladen" right after the finder concluded, above the confidence
   floor, that the term maps to a held table). The design doc's "B15 names the loaded topics" only holds in
   the no-nearest-keys fallback branch. The recorded richer "bedoel je <curated term>?" follow-up is the
   real fix (new Dutch copy → owner sign-off). Dispatch: accept for this PR, keep the follow-up recorded.
5. **CONFIRMED · `src/ingestion/onboarding-finder.ts:87` — 1+N sequential DB roundtrips on the live chat
   path** (alternativeIds uncapped by schema — prompt says "tot 3" but code never slices; worst ~23).
   **Fix:** one batched `select id from cbs_tables where id = any($1) and status='active' and last_sync_at
   is not null` over `[pick, ...alternativeIds]`; also collapses the any-failure→null surface to 1 query.
6. **CONFIRMED · test-coverage/doc claim — "the exact 83693NED scenario" is not tested.** The design brief
   (line 51) and the test comment (`tests/ingestion/onboarding-job.test.ts:515`) claim it, but both #166
   job tests run 82235NED with ONE manually-inserted curated key. The partial-curation failure mode
   (finding 1) has zero coverage. **Fix:** correct the wording AND add the partial-curation test (question
   on an uncurated measure of a multi-key table) alongside the finding-1 fix.

## Doc corrections (same-change per doc-freshness rule)

7. **PLAUSIBLE · design brief line 44 — the accepted-residual paragraph understates the window.**
   "Seconds-wide, owner-caused only" omits the finder-screen→fit-gate window entirely (fail-soft kick →
   daily 06:00 cron backstop, 20-min reclaim, MAX_ATTEMPTS=3; any concurrent actor can ingest a
   screened-clean candidate; `runFitGate`/Step-3 never re-check; pre-guard queued rows carry unfiltered
   chains). Verified as an inherent async-queue race the piggyback absorbs — NOT a #166 recurrence — but
   the doc claim is wrong. Optional hardening: re-check `alreadyIngested` in `runFitGate` (also covers
   pre-existing rows).
8. **PLAUSIBLE · `src/ingestion/onboarding.ts:164` — belt keys on DB rows; the job's delivery re-run parses
   only the COMPILED constant + extra=[]** (`loadOnboardedVocabulary` is live-chat-only). A curated DB row
   absent from the running bundle (apply-before-deploy deviation, or rollback after apply) → guaranteed
   refund-loop for that table. **Fix:** RUNBOOK line: "registry:apply only after the CI deploy job is
   verified live; a rollback after apply reopens the drift."
9. **CONFIRMED · `docs/STATUS.md:20`** still says "#166 self-onboarding guard gap" — contradicts the
   updated open-questions #166 row (DESIGNED+BUILT, PR #54). Update in the same change.
10. **CONFIRMED · `docs/decisions/027-finder-shape-fit-gate.md:94`** — candidateIds description not updated
    for the #166 ingested-filter ("allowlist-sanitized alternativeIds … cap 3" now incomplete).

## Small code cleanups

11. **CONFIRMED · `src/ingestion/onboarding.ts:166`** — third hardcoded `'onboarded:'` literal (also
    `onboarding-vocab.ts:313`, `query/resolve.ts:275`). Export a shared prefix constant / `isCuratedKey`
    predicate from `onboarding-vocab.ts` (the owning module).
12. **CONFIRMED · `src/ingestion/onboarding.ts:409`** — type `extraVocabulary` as plain `OnboardedMeasure[]`
    (exported at `src/answer/intent/prompt.ts:78`) instead of `Awaited<ReturnType<…>>['onboarded']`.

## Refuted during verification (do NOT re-raise)

- Dutch skip-note string: the `slice_note` channel is owner-readable Dutch by design (§4; existing notes
  in `onboarding-slice.ts` are Dutch).
- "Belt burns billed LLM spend before refunding": the delivery attempt with the standard prompt is the
  belt's intended benefit (covered questions answer), not waste.
- Transient DB error on one alternate's check nulling the routing: the closure's documented ANY-failure →
  B15 contract (money-safe); folds into finding 5's batching anyway.
- `recordSliceNoteIfEmpty` as near-twin, test-helper dedup, test `LIKE`-interpolation / `as never`:
  idiomatic or purpose-distinct; no concrete failure.
