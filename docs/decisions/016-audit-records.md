# ADR 016 — Audit records (R8, WP10)

**Status:** accepted (2026-07-03) · **Owner sign-off:** follows the confirmed principles and the docs/05 audit-trail design; no new product-policy decisions
**Relates to:** docs/05 R8 + "Audit-trail design", ADR [002](002-postgres-system-of-record.md) (Postgres, `audit_answers` named from day one), ADR [004](004-llm-usage.md) (no streaming — the write precedes display), ADR [006](006-auth-billing-seams.md) (nullable `user_id` seam), ADR [007](007-chart-spec-rendering.md) (versioned stored artifacts), ADR [015](015-refusal-clarification-composition.md) ("Notes for WP10" wrap-site obligations)

## Context

Since WP9 the pipeline produces one `ComposedResponse` envelope per question (answer / clarification / refusal), but nothing persisted it: R8 was the invariant suite's last `todo`, and the benchmark scorer had no records to read. WP10 adds the audit layer: one `audit_answers` row per produced response, written **before** the response is returned, complete enough that the row alone *reconstructs* the response.

## Decision 1 — The envelope is the record; scalar columns are promoted copies

The full `ComposedResponse` is stored verbatim in one `response` jsonb column — it already carries the parse outcome, the validated result (result IDs, values, derivations, attribution), the composed answer and the chart spec, each schema-versioned (ADR 007). Columns like `kind`, `final_text`, `intent`, `intent_hash`, `refusal_reason`, `result_ids`, `tables`, `answer_source` are **promoted copies for querying/reporting**, never independent facts; the reconstruction check re-derives each from the envelope and fails on divergence, so a row cannot lie about itself.

**Why:** docs/05 requires the record to be "a complete, renderable snapshot". Storing the envelope whole makes that structural (nothing to forget); promoting scalars keeps the docs/06 measurement queries (intent-hash repeats, spend, template-fallback counts) and future retention tooling on plain indexed columns.

**Alternatives considered:**
- *Fully normalized tables (answers, cells, derivations, calls…)*: rejected — heavy migration surface for records that are written once and read whole; the envelope's inner objects are already versioned contracts.
- *Envelope only, no promoted columns*: rejected — every operational query (docs/06 caching/spend triggers) would scan jsonb; and `intent_hash` needs an index to be a measurement tool.

**"Query plan":** the stored `intent` **is** the query plan — the query layer is deterministic, so plan = f(intent, registry @ `tables.tableVersion`); the cells' coordinates and `batchId`s are the execution evidence. Re-entering the pipeline at the query step with the stored intent is exactly docs/04's drill-down seam.

## Decision 2 — Wrap site, not envelope changes

`src/answer/audit/respond-audited.ts` wraps the WP9 entry points (`answerQuestionAudited`, `answerClarificationReplyAudited`); the WP9 envelope is untouched, per ADR 015's judgement that reply text and prompt versions belong to the audit layer. Recorded at the wrap site: the clarification-**reply** text + the `PendingClarification` it answered (reply rows only, enforced by a check constraint), the three prompt-version constants (`PROMPT_VERSION`, `CLARIFY_PROMPT_VERSION`, `COMPOSE_PROMPT_VERSION`) on **every** row, per-call model IDs + token counts (an `LlmCallTracker` decorator over the shared client seam — transparent, so fixture hashes are unchanged), wall-time latency, the injected reference date, and the nullable `user_id` (ADR 006). Question text is stored here and only here (docs/04 GDPR seam).

## Decision 3 — Fail-closed on audit-write failure

If the audit insert fails:
- **answer or clarification** → the response is **withheld**; the caller gets the `internal` refusal (itself audited, best effort). An unrecorded answer violates R8's "before being shown"; an unrecorded clarification would open a reply round the trail never saw.
- **refusal** → returned as-is with the failure appended to `internalNote`. Refusals carry no data values (ADR 015 decision 1), so principle (c) is not at risk, and masking one honest refusal with a second refusal helps nobody.

**Alternative considered:** best-effort auditing (serve the answer, log the failure). Rejected: R8 is an invariant, not telemetry — the product's public claim ("every number traceable") depends on the record existing.

## Decision 4 — Reconstruction is executable, from the row alone

`reconstructionReport(record)` re-verifies with **no database and no live pipeline objects**: promoted columns re-derive from the envelope; for answers, the stored body re-passes the full R3/R9/R10/R11 validator against the stored result (R1's scan from the record), the attribution line re-derives byte-identically (R4, positional), the structural lines and final text re-assemble byte-identically, and the chart spec re-derives from the stored result through the same deterministic builder (R6) and re-validates. Tamper tests prove each check can fail. This function is also the trust anchor for the future answer-pages/audit-trail UI (docs/04).

## Decision 5 — Benchmark scoring reads the records (and only the records)

`npm run benchmark:run` drives all 20 docs/02 tasks — plus the B15/B16 one-round replies (docs/02: clarify tasks are scored on the post-clarification answer) and the B3/B5 un-disambiguated informational variants — through the **audited** pipeline, hermetically (PGlite + replayed LLM fixtures), then dumps the audit rows read back from the database to `benchmark/audit-run.json` (gitignored; regenerated by CI on every push — committed provenance is STATUS.md, never the artifact). `npm run benchmark:score` scores that dump against the frozen key: the same `checkComposedAnswer` rules the CI suites and live evals use, plus scorer-independent data-level checks (key values verbatim among stored cells/derivations), chart-vs-key point checks, typed refusal reasons, the no-unbacked-numbers scan (answers: `scanBody` over the stored body; non-answers: the WP9 structured whitelist rebuilt from registry labels + the record's own options/freshness + the run's dumped freshest-periods), and `reconstructionReport` on every scored record. Gate per docs/03 (≥12/14, 6/6, zero fabricated); in CI a **missing dump is a failure** — the gate may not silently degrade to structure-only.

**Hermetic vs. live:** the scoreboard's latency from this path measures pipeline overhead over replayed fixtures, and is labeled as such; the *live* 20-task run (real LLM calls, real latency) is WP11's, which records the official scoreboard row in STATUS.

**Adversarial-review judgements (2026-07-03, recorded so they aren't re-litigated):**
- *Non-answer whitelist stays a union over all canonical measures' freshest periods* (a contested HIGH): the scorer's no-unbacked-numbers scan for refusal/clarification texts whitelists period tokens (years, month/quarter ordinals) from **every** canonical measure's freshest period, not only the task's own measure — because the deterministic templates legitimately cite any measure's freshest period (scope refusals and still-ambiguous guidance embed an example question over an arbitrary loaded measure). Only period-shaped tokens from structured sources can enter this whitelist; **cell values can never enter it**, so the fabricated-number guarantee is unaffected. Narrowing it per-task would false-positive on honest texts.
- *B20 value-leak check runs on the user-facing text as numeric tokens plus a structural no-`value`-field check on the freshness payload* — not raw substring matching over the serialized envelope, which false-positived on numeric collisions (e.g. token counts) and missed Dutch-formatted values ("2,9").
- *Reconstruction pins schema versions* (row, envelope, answer): a v1 reconstructor rejects foreign tags loudly; tamper tests cover forged version fields. The reconstructor deliberately does **not** cross-check `llm_calls`/`prompt_versions`/token counts — they are wrap-site telemetry with no independent ground truth inside the record (the envelope's `parse.model`/`answer.model` bindings are asserted by the test suite at write time instead); judged not reconstruction material.

## Revisit triggers

- Phase 1 auth lands → `user_id` gains its FK/meaning; retention policy gets its single enforcement point here.
- Shareable answer pages (Phase 2) → render from `response` + `reconstructionReport` as the publish-time gate; correction handling via open-questions #22.
- Record volume/measurement needs (docs/06 caching/spend triggers) → promoted columns and the `intent_hash` index are the seam; extending them is additive.
- Any change to the envelope's inner schemas bumps their own versions (ADR 007); a change to the row layout itself bumps `AUDIT_SCHEMA_VERSION` (records live forever, readers dispatch on it).

## Addendum (2026-07-04, WP17 — user dashboard): `request_id` on the row

`audit_answers` gains a nullable `request_id uuid` (migration 010), the billing gate's idempotency key, threaded from the wrap site exactly as `source_tag` was in WP13 — an input capture, not reconstruction material (like `llm_calls`, it has no independent ground truth inside the record, so the reconstructor deliberately ignores it). Purpose: the dashboard question history joins it back to `credit_transactions` to reconstruct each question's net cost — the initial debit precedes the audit row by design (ADR 020 decision 1), so `credit_transactions.audit_answer_id` alone (compensation rows only) could never answer "what did this question cost." Null on all pre-migration rows and on runner-script rows that never pass through the billing gate; nothing downstream may assume it present.
