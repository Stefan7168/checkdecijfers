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
2. **Job-side belt in Step 6** (`src/ingestion/onboarding.ts`): when the target table carries CURATED
   vocabulary (a `canonical_measures` row whose key is not `onboarded:`-prefixed), skip auto-derivation;
   the delivery re-run parses with `extraCanonicalMeasures: []` — the curated vocabulary is already in the
   standard prompt, so covered questions deliver normally and uncovered ones end unanswerable + refund
   (honest, principle c). Reachable only via the trigger-vs-curation race or a pre-guard pending row. The
   skip is recorded on `slice_note` when steps 4-5 were skipped (else console — never clobbers a real
   slice-estimate note). Retries for genuinely onboarded tables are unaffected (they carry only
   `onboarded:*` keys).

**Answer to the design question posed to the owner** (chosen pending review — the merge IS the approval per
#118(b)): route to the **normal clarification at trigger time** (option a), NOT "run the paid onboarding but
skip the debit" (option b: it keeps the fake wait-UX for data we already hold, and a zero-debit delivered
row would be a new ledger shape on the money path). **Recorded alternative / possible follow-up:** a richer
"bedoel je <curated term>?" clarification pointing at the specific canonical keys — better UX than the
generic B15 list, but new Dutch product copy (owner sign-off) and a new response shape; deliberately NOT in
this PR.

**Accepted residual:** a table becoming curated between the finder check and the trigger (seconds-wide,
owner-caused only) keeps the old behavior once — charged, then delivered from existing data via the belt.

**Tests (hermetic, on the gate):** finder guard fires on an ingested pick / does NOT fire on a
registered-unsynced pick (`tests/ingestion/onboarding-finder.test.ts`); end-to-end job run on a synced table
with only curated vocab delivers with zero `onboarded:*` rows created and the skip noted
(`tests/ingestion/onboarding-job.test.ts`, the exact 83693NED scenario).
