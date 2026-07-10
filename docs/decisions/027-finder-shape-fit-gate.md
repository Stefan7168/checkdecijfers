# ADR 027 — Finder precision: question-aware rerank + in-job measure-fit gate with candidate fallback (#111)

**Status:** accepted (design frozen session 30, 2026-07-07/08; owner authorized Fable for this design
step; **amended same session after a 3-lens adversarial design review** — the amendments are marked
inline). Build not started.

## Context

The first real live onboarding — *"Hoeveel mensen zaten er in 2023 in de bijstand?"* — dead-ended: the
finder confidently picked `85615NED` (a FLOW table: bijstand in/outflows) over a stock/count table,
delivery correctly found no fitting measure, and 100 credits were refunded. Owner verdict (binding):
simple questions MUST answer, and the fix must be **general**, never per-topic aliases.

Three verified code facts bound the design (problem dossier, [2026-07-07-111-problem-dossier.md](../session-briefs/2026-07-07-111-problem-dossier.md)):

1. The finder receives only the parser's `unmatchedMeasureTerm` ("bijstand") — the question's shape
   ("hoeveel mensen **zaten er in**" = stock) is discarded before Stage 1 runs.
2. The Stage-2 rerank sees only id/status/type/title/240-char summary — no measure names, no
   dimensions. Topic-word overlap is exactly the signal that misleads (the flows table's
   title/summary match "bijstand" *better* than a kerncijfers table).
3. Fit is only tested AFTER the 100-credit debit, at delivery — and the rerank's `alternativeIds`
   never survive the confident path (they are dropped INSIDE `findTable`'s confident branch,
   `src/catalog/find.ts` — review correction: not "at the trigger boundary"; the confident
   `FindTableOutcome` variant must be WIDENED to carry them), so there is no try-next-candidate.

## Decision (five parts)

**D1 — Shape data comes from a per-candidate `fetchTableSchema` metadata call INSIDE the async job**
(the "fit gate"), not from catalog enrichment and never from the synchronous request path.
`CbsTableSchema` already carries measures (code/title/unit/description) + dimension kinds — one
cheap metadata call, no observation data.

**D2 — The debit stays at trigger time; the fit gate runs in the job BEFORE any ingest, with
try-next-candidate.** Per candidate: fetch schema → fit check → on a genuine "geen" verdict, advance
to the next candidate; ingest + vocabulary + delivery only for the first FITTING candidate. Money
mechanics (debit at trigger, stored-delta refund on any non-delivery) are unchanged; what changes is
that a mis-pick now usually becomes an ANSWER instead of a refund.

**D2a (review amendment — identity vs resolution).** `pending_table_requests.table_id` is **never
mutated**: it stays the original confident pick, preserving (i) the `(user_id, table_id)` active-
unique partial index (a `running` row IS inside its predicate — the original design's "safe while
running" claim was backwards) and (ii) the asking-twice-costs-nothing dedupe, which keys on it. The
fit gate's choice lands in a NEW nullable column **`resolved_table_id`** (outside the index);
ingest/vocabulary/delivery read `resolved_table_id ?? table_id`. This also makes retries
deterministic: `resolved_table_id` is persisted BEFORE ingest, and a reclaimed re-attempt that finds
it set SKIPS the fit loop and resumes at ingest — one request can never ingest two tables across
attempts.

**D2b (review amendment — errors are not verdicts).** A per-candidate metadata-fetch or fit-LLM
ERROR advances to the next candidate but is recorded as *errored*, not *misfit*. End states: at
least one candidate ACCEPTED → proceed; all candidates got verdicts and none fit → `unanswerable`
with the honest scoped message ("geen van de **onderzochte** tabellen bevat een maat die deze vraag
beantwoordt"); ALL candidates errored (nothing was ever inspected — the correlated CBS/LLM-outage
case) → `failed` via the existing "Onverwachte fout" path. The product never asserts a fact about
CBS tables it did not verify (principle c), and the owner's diagnostics keep outages distinguishable
from genuine no-fit.

**D2c (review amendment — legacy rows).** A row with empty `candidate_ids` (anything in flight when
the migration deploys, or created by older code) **skips the fit gate entirely** and takes today's
exact path (ingest `table_id` → delivery decides). Deploy-order-safe by construction and the
"legacy behaves exactly as today" test criterion is literally true.

**D3 — The question's shape signal is the FULL QUESTION TEXT, threaded to both LLM steps; no new
parser-side taxonomy.** (a) The Stage-2 rerank prompt gains the full question alongside the topic
term (still a closed shortlist choice, hard allowlist unchanged; the prompt-byte change forces a
full fixture re-record — note the re-record is forced by the BYTES, not by the documentation-only
`RERANK_PROMPT_VERSION` constant; `RERANK_SCHEMA_VERSION` and the prompt's "version is altijd 1"
line refer to the OUTPUT schema and must NOT be touched). (b) The new **measure-fit check** is the
real stock-vs-flow discriminator: a closed choice over the candidate table's OWN measure list
(titles + units + descriptions, verbatim) + an explicit "geen" option, with a hard allowlist on
measure codes — structurally the same safety shape ADR 025 chose. The job already has the verbatim
question (`pending_table_requests.question_text`).

**D4 — Model tier: Haiku for both the widened rerank and the new fit check**, same recorded
Haiku→Sonnet→Fable escalation ladder as ADR 025 decision 3, moved only on a MEASURED miss. Both
steps remain closed multiple-choice over supplied lists; structural safety (allowlist + fail-toward-
disclose/next/refund) does not depend on model size.

**D5 — Measurement first.** Before product code: extend `benchmark/tablefinder-labelled-set.json`
with stock-vs-flow discriminating cases (bijstand-stock must NOT land on `85615NED`; a flow-phrased
question targets `85615NED`; plus the still-missing disclose-expected case — closes the #104 gap),
and add a small measure-fit labelled set. **Sequencing correction (review):** the replay test that
consumes the labelled set sits ON the CI gate, and the new cases need fixtures that can only be
recorded AFTER the prompt change — so the labelled-set additions, the prompt change, and the
re-recorded fixtures merge as ONE gate-green unit whose recording is a short supervised step
(~cents, the session-25 pattern). Both bijstand tables must be ADDED to the hermetic
`_catalog.json` (neither is in the current 61-row fixture) and get per-table fixture docs for the
job e2e tests.

## Mechanics the decision implies

- **The candidate chain is explicit** (review: every carrier named, or the build session strands the
  data): widen `FindTableOutcome`'s confident variant (`src/catalog/types.ts` + `find.ts`) with the
  rerank's allowlist-sanitized `alternativeIds` → `OnboardingRouting.candidateIds`
  (`src/answer/intent/policy.ts`; pick first, then alternatives, cap 3) → the `onboarding`
  `ParseOutcome` variant (`intent/types.ts`) → `OnboardingEnvelope` (`respond/types.ts`; BOTH
  construction sites in `respond/respond.ts`) → `web/app/actions.ts` `maybeTriggerOnboarding` →
  `TriggerOnboardingInput` (`onboarding-trigger.ts`) → `createPendingRequest` + `fromRow`
  (`onboarding-store.ts`).
- **Migration 015**: `candidate_ids jsonb not null default '[]'` + `resolved_table_id text` (both
  outside every index; defaults keep old rows and old code valid in either deploy order).
- The fit gate runs before piggyback/ingest for candidate-carrying rows; the accepted candidate is
  written to `resolved_table_id` via a store helper that updates the DB row AND the in-memory
  `PendingTableRequest` (review: every downstream step reads the in-memory object).
- Only the fitting candidate is ingested + vocabulary-registered on the happy path (a misfit table
  no longer pollutes the registry; across a crash-retry, D2a's resume rule keeps it to one table).
- The delivery-must-answer gate stays untouched as defense in depth: the fit check is an answer-rate
  optimizer, never a validator replacement — a fit-pass that still fails delivery refunds exactly as
  today. R1/R8 untouched: the fit check reads METADATA only, never data cells.
- Money invariant, scoped precisely (review): the LEDGER primitives (`debitOnboarding`,
  `compensate`) and `refundOnboarding` stay byte-identical; `triggerOnboarding`/
  `createPendingRequest` widen to CARRY `candidate_ids` but the debit amount, idempotency keys and
  refund semantics are unchanged.
- Non-confident finder outcomes (disclose/none → B15 clarification) are byte-unchanged; the intent
  parser's prompt is byte-untouched (no new taxonomy — D3), so intent fixtures, thresholds and the
  benchmark are unaffected by construction.

## Alternatives rejected

1. **Catalog-wide shape enrichment at `catalog:refresh`** (store measures per table in `cbs_catalog`):
   principle-(b)-clean but ~4,858 per-table metadata calls per refresh (refresh already takes ~19 min;
   this multiplies it) and ~99% is never used. Revisit trigger: measured SHORTLIST-recall misses —
   i.e. the right table doesn't even enter the top-20, which no rerank/fit improvement can fix.
2. **Shortlist metadata fetch at rerank time (synchronous turn)**: puts live CBS calls in the request
   path (principle (b) exception) and adds seconds to every unmatched-topic turn. Rejected; the async
   job is the sanctioned out-of-band fetch path.
3. **A structured stock|flow|rate hint emitted by the intent parser**: changes the calibrated hot
   prompt for every turn (fixture re-record + R7 threshold re-calibration) to benefit only the finder
   path. Rejected for v1; revisit if the fit check's measured accuracy proves question-text-in-prompt
   insufficient.
4. **Debit AFTER a fit check** (charge only when fit-confirmed): requires sync metadata fetches
   (rejected in 2) or moving money into the background job (worse auditability; the ack copy already
   promises the refund-on-failure semantics). Rejected — the refund mechanism is proven.
5. **Mutating `table_id` to the fitting candidate** (the original sketch): rejected by the design
   review — a `running` row is inside the `(user_id, table_id)` partial-unique predicate (update can
   collide with the user's other active row → spurious terminal failure of a deliverable request),
   and the drifting key silently breaks the asking-twice dedupe (double 100-credit debit window).
   `resolved_table_id` (D2a) provides the same capability with zero index/dedupe interaction.

## Trade-offs accepted

- A mis-picked FIRST candidate now costs one extra metadata fetch + one small LLM call before the
  right table answers — seconds, inside the async wait the user already accepts.
- The fit check can wrongly reject a fitting measure (false "geen") → falls to the next candidate or
  an honest refund; that is the fail-safe direction (principle c). It can also wrongly accept — then
  delivery's existing gate catches it and refunds, exactly today's behavior.
- Two more recorded-fixture LLM surfaces to maintain (rerank v2 prompt, fit prompt) — the eval/replay
  infra for both already exists (sub-part 1 pattern).
- Two different active questions from one user may land on overlapping candidate sets; each request
  resolves independently against its OWN question (two debits for two genuinely different questions
  is correct behavior; the dedupe continues to key on the unchanged original pick).

## Amendments A1–A3 (2026-07-08, session 31 — owner-approved, driven by pre-build MEASUREMENTS)

The stage-A build session measured the frozen design against live CBS metadata + a hermetic PGlite
run of the real recall code over the full live 4,858-row catalog (€0 — public metadata only) and
found three facts the design review had not surfaced. The owner approved three amendments the same
day (all general, none per-topic — the session-28 steer holds):

**Measured facts.** (i) *No live person-level bijstand stock table is v1-deliverable*: every one
(`85585NED`, `82016NED`, `85692NED`) carries person-characteristic dimensions — so ingestion stores
no `dims = '{}'` rows and `registerOnboardingVocabulary` registers ZERO measures (this, not the
measure-fit judgment, is what actually killed the live bijstand attempt) — and none has yearly
codes, so the year-explicit question fails `requireGrain('JJ')` even after a perfect pick. The only
table that can deliver *"Hoeveel mensen zaten er in 2023 in de bijstand?"* is **`37789ksz`**
("Sociale zekerheid; kerncijfers, uitkeringen naar uitkeringssoort": Regulier, time-only dimension,
JJ+MM grains, 2023JJ00 = 390.2 ×1000 "Totaal bijstandsuitkeringen"). (ii) *The raw recall top-20
buries the answer*: for "bijstand"+aliases, 14 of 20 slots were discontinued tables and `37789ksz`
sat at overall position **51** (18th of 27 Regulier matches) — Stage 2 can only choose among what
Stage 1 shows, so no prompt or fit improvement could ever reach it. (iii) *A measure-honest fit
gate accepts undeliverable tables*: `85585NED` genuinely HAS a fitting measure ("Personen met
bijstand", aantal) — D3b's closed measure choice would accept it, ingest it, register zero vocab,
and refund WITHOUT trying the next candidate.

**A1 — the bijstand-stock target is `37789ksz`.** The labelled case, the fixture captures and the
stage-D acceptance test all point at it. Nuance the owner explicitly accepted: it counts
UITKERINGEN (benefits; a couple = one benefit), not persons — the answer names CBS's measure title
verbatim, so it stays honest. Person-level tables become deliverable only via the #111(b)
delivery-coverage widening (a later WP).

**A2 — Regulier-first recall quotas** (`src/catalog/recall.ts`): the shortlist is now selected as
up to `RECALL_REGULIER_SLOTS` (20) current tables by FTS rank plus `RECALL_HISTORIC_SLOTS` (4)
strongest non-Regulier matches (total 24); either class fills the other's unused slots, and the
merged shortlist stays ordered by pure relevance — the quota decides membership, not order.
Topic-agnostic by construction; explicitly-historical questions keep candidates plus the rerank
prompt's "TENZIJ historisch" rule. This supersedes ADR 025's "Stage-2 does the real work" for the
measured discontinued-crowding case: Stage 2 cannot rank what Stage 1 never shows.

**A3 — deterministic deliverability pre-checks in the fit gate** (stage C, before the Haiku
measure-fit, from metadata the job already fetches): (a) a candidate whose dimensions are not
time-only is v1-undeliverable (no `dims='{}'` rows will exist — exactly #111's recorded v1 scope);
(b) a question naming a bare year requires JJ period codes on the candidate. Either failure records
an `undeliverable` verdict (grouped with `geen` for D2b's end states — the table WAS inspected) and
advances to the next candidate. Fail direction unchanged: at worst an honest refund, never a wrong
figure; the checks are code, not model judgment.

**Residual risk, deliberately measurement-gated:** even with A1–A3, the acceptance question only
answers if the question-aware rerank puts `37789ksz` in the candidate chain (pick or top-3
alternatives) — its title contains no "bijstand" (weight-B description match only). This is
measured at the stage-A supervised record step; if Haiku cannot do it reliably, the recorded
escalation ladder (D4 → Sonnet) is the next step, not a redesign. A second discovered risk is
recorded as open-questions #124: the vocabulary step tags EVERY registered measure of a
multi-measure table with the topic term (`37789ksz` registers 18 measures, three bijstand-titled)
— parser ambiguity at delivery could clarify instead of answer; stage C's e2e test measures it
hermetically.

**MEASURED at the stage-A supervised record (2026-07-08, same day, ~55 Haiku calls ≈ €0.15
total):** (1) Haiku reads the stock shape correctly but picks the — undeliverable — person-level
stock table `85585NED`, with `37789ksz` at chain position 3: the chain gate holds, the exact-pick
expectation does not, so the `bijstand-stock` labelled case was moved to **chain semantics**
(`chainContains: 37789ksz` under Stage B's cap 3 + `notPick: 85615NED`) — the system-level success
condition the fit gate actually acts on; a tier escalation was rejected because deliverability is
not present in title/summary for ANY model to see. (2) The first `inkomen-vaag` measurement showed
Haiku confidently picking among six near-equal Regulier income tables; prompt v2 gained a
**vague-question honesty rule** (question no more specific than the topic + materially different
candidates ⇒ confidence below 0.8 + alternatives listed; a SPECIFIC question still earns a
confident pick — the first, broader wording measurably over-corrected two legitimate cases and was
sharpened). (3) The legacy `werkloosheid` case (question == topic) then HONESTLY disclosed under
that rule — it got a realistic question, since production always passes the full question post-WP27
(the other bare-topic legacy cases stay as robustness pins). Final: **11/11, twice, byte-stable;
confident floor 0.85 over threshold 0.8; the disclose boundary is now directly measured (#104).**

## As built — stage B (2026-07-10, session 32, [PR #18](https://github.com/Stefan7168/checkdecijfers/pull/18))

Stage A merged + deployed as [PR #17](https://github.com/Stefan7168/checkdecijfers/pull/17)
(2026-07-09, merge `478a852`). Stage B landed per the brief's letter — `candidateIds` (pick first,
then sanitized `alternativeIds`, cap 3) constructed in `onboarding-finder.ts` and carried as a
REQUIRED field through routing → parse outcome → envelope (both respond.ts sites) → web action →
trigger → store; migration `015_candidate_chain.sql` committed as a FILE (applied by PGlite/CI
only; production waits for stage D). Two as-built notes beyond the letter:

1. **`fit_note text` ships in 015 now** — stage C's spec pins it to the *"same migration"*, and
   completing 015 at creation avoids editing a merged migration file later. Stage C therefore
   touches no schema.
2. **Deploy-order safety is code, not luck (D2c made real):** stage B deploys on merge while
   production still runs the pre-015 schema. `createPendingRequest` probes `pg_attribute` for
   `candidate_ids` before naming it in the INSERT (a SELECT cannot abort the money tx) and falls
   back to the legacy INSERT — rows created in that window read back `[]`, i.e. exactly the D2c
   legacy path. Without this, the design's "either deploy order is safe" claim is false and every
   live onboarding trigger in the window would error. Pinned by drop-the-columns tests at store
   and trigger level; `fromRow` defaults absent columns (`[]` / `null`).

Invariants diff-proven on the PR: `src/billing/` untouched, zero prompt/fixture bytes, `table_id`
never mutated. A 5-lens pre-PR adversarial review (dual refute-by-default skeptics) found the
money/chain/deploy/byte lenses clean; its one confirmed finding (the live respond.ts construction
site had zero pipeline-level coverage — mutation-verified) was closed with a B15+injected-finder
pipeline test whose exact-envelope assertion kills the mutation.

## As built — stage C (2026-07-10, session 32, [PR #21](https://github.com/Stefan7168/checkdecijfers/pull/21))

Stage B merged + deployed the same day ([PR #18](https://github.com/Stefan7168/checkdecijfers/pull/18),
merge `d8e02b5`). Stage C landed per the brief's pseudocode: `src/ingestion/onboarding-fit.ts`
(fit prompt/schema/validator/version constants mirroring `rerank-*.ts`; Haiku per D4; hard
allowlist over the table's OWN measure codes + `'geen'`), amendment A3's deterministic pre-checks
BEFORE any LLM call (time-only dims; JJ codes for bare-year questions), and the gate driven from
`processOneRow` (resolved → resume, never re-fit — D2a; `[]` → byte-identical legacy path — D2c;
loop with errored-vs-verdict accounting — D2b: all-errored → `failed` with the honest infra
message, any real verdict → `unanswerable` with the scoped message). `setResolvedTable` writes DB
row + in-memory object; `fit_note` is diagnostics only. As-built notes:

1. **Acceptance threshold 0.8 is a documented PRE-CALIBRATION placeholder** (✅ done — stage D
   below calibrated it: kept at 0.8, measured) — stage D calibrates
   it from `benchmark/measurefit-labelled-set.json` (new, seeded there); the boundary is
   inclusive (`>=`) and PINNED by a test that references the constant (adversarial-review
   finding, mutation-confirmed: the comparator was previously unpinned at exactly the threshold).
2. **The #124 risk was MEASURED and does not materialize**: a real recorded Haiku delivery parse
   (owner-approved spend, `scripts/onboarding-delivery-record.ts`) of the bijstand question over
   all 18 tagged `37789ksz` measures resolves "Totaal bijstandsuitkeringen" directly — no rule-4
   clarification; delivered "Totaal bijstandsuitkeringen was in 2023 390,2 (x 1000)". Pinned as a
   hermetic replay e2e on the CI gate.
3. **Production dormancy is mechanical**: until stage D applies migration 015, every production
   row's chain reads back `[]` (the stage-B probe) → legacy path → the fit gate cannot run and
   the fit LLM cannot spend. The cron route's new `fitClient` is inert for legacy rows.

Review: 5 lenses (money+terminal-state, brief-letter, safety, deploy-dormancy, test-mutation-
resistance), dual skeptics — four lenses clean, two raw findings refuted, one confirmed (the
threshold boundary above), fixed in-session.

## As built — stage D (2026-07-10, session 33 — owner-supervised live step, [PR #22](https://github.com/Stefan7168/checkdecijfers/pull/22))

Executed per the brief's § Stage D, owner present and confirming before every live action:

1. **Migration 015 applied to production** (`npm run db:migrate`), per-migration check clean:
   0 `anon`/`authenticated` grants, RLS on, all three columns with correct types/defaults
   (`candidate_ids` → `'[]'`), every index — including the `pending_one_active_per_user_table`
   dedupe — untouched. The pre-015 session-28 bijstand row reads back `candidate_ids: []`
   (the D2c legacy path), live-confirmed.
2. **Threshold CALIBRATED — kept at 0.8** ("calibrated, not moved", the finder's session-25
   precedent). `benchmark/measurefit-labelled-set.json` seeded per the brief: 6 cases (3 accept /
   3 `geen`) over both bijstand tables + 4 new onboarding-plausible schema-only fixtures
   (`80416ned` pump prices, `85554NED` WW, `84826NED` wrong-entity trap, `83163NED` wrong-kind
   trap), labels verified from live CBS measure lists. Live Haiku record (single run, temp 0):
   **6/6 correct, every verdict at confidence 0.95** — correct-accept floor 0.95 (uniform, margin
   0.15 above the threshold), wrong-code ceiling UNMEASURED (zero wrong picks), so raising the
   threshold would be a guess, not a calibration. Hermetic replay e2e now on the gate
   (`tests/ingestion/fit-replay.test.ts`), accept cases pinned `>=` the constant.
3. **The owner's live acceptance test PASSED — #111 closes.** The dead-end question *"Hoeveel
   mensen zaten er in 2023 in de bijstand?"* ANSWERED in production: *"Het totaal aantal
   bijstandsuitkeringen kwam in 2023 uit op 390,2 x 1000"* (audit answer 240; measure
   `D000203_2` named verbatim per amendment A1; CBS definition + CC BY attribution). Mechanics
   live-verified on row 4: finder pick `37789ksz` at 0.85 on the real 4,858-row mirror, chain
   `["37789ksz","85585NED","85692NED"]` recorded, fit gate accepted candidate 1 (`fit_note` =
   D000203_2 + a sound Dutch stock-vs-flow reading), kick claimed the job **2 seconds** after the
   trigger (not the daily backstop), question → delivered answer in **88 seconds**, 100 credits
   debited and KEPT (no refund — ledger-verified).

Operational addition: `scripts/force-ipv4.mjs` is now committed (the lessons-learned IPv4-force
preload, 3rd recurrence = standing requirement for owner-run CBS fetches; RUNBOOK line added).

## Revisit triggers

- Measured shortlist-recall miss (right table absent from the top-20) → alternative 1 (enrichment),
  scoped lazily to shortlist-entered tables first.
- Fit-check measured accuracy < the labelled-set gate after threshold calibration → escalate the
  ladder (Sonnet), then reconsider alternative 3 (parser shape hint).
- Any measured wrong-table CONFIDENT answer reaching a user → tighten `highConfidence`/fit threshold
  first (failure-safe direction), then redesign.
