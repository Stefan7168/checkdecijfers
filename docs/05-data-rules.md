# Data rules

The CBS data strategy and the anti-hallucination guardrails, written as **checkable invariants** — each rule states how a test or code review verifies it. These operationalize the three confirmed principles (see [CLAUDE.md](../CLAUDE.md)).

## Data access strategy (confirmed: bulk ingestion)

- Ingestion uses **CBS OData v4 / bulk channels** through the `CbsSource` adapter — never the 10,000-cell-capped v3 API, never live queries from the request path (ADR [003](decisions/003-cbs-access-layer.md)).
- Each table in scope is registered in `cbs_tables` with: CBS table ID, title, dimensions, units, expected update cadence, last sync time, covered periods, schema fingerprint, version.
- Ingestion is idempotent and batch-recorded (`ingestion_batches`): re-running a sync must not duplicate observations. **Verify:** ingestion test runs the same sync twice, asserts identical row counts.

## Validation pipeline (ingestion side)

Order of checks per sync; any failure marks the table `needs_review` and excludes it from answering — failures are loud, never silent:

1. **Schema fingerprint** matches the registry (dimension names, measure codes, units). Mismatch = suspected CBS redesign.
2. **Row plausibility**: row count within expected bounds vs. previous sync; no empty measures.
3. **Period parsing**: every CBS period code (`2024JJ00`, `2025KW04`, …) converts to a typed period; unparseable codes fail the batch.
4. **Region mapping**: every region code resolves in `dimension_labels`; unknown codes fail the batch (new municipalities appear via reviewed mapping updates, not silently).
5. **Unit consistency**: units per measure unchanged vs. registry, or flagged.

**Verify:** ingestion test suite feeds a fixture with each corruption type (renamed dimension, bad period code, unknown region, changed unit) and asserts the batch fails with the right reason and the table is excluded from answering.

## Anti-hallucination invariants (answer side)

| # | Invariant | Verified by |
|---|---|---|
| **R1** | Every numeric value in an answer traces to a query-result ID recorded in the audit record. | Automated test: scan rendered answer for numeric tokens; each must appear in (or be a registered derivation of) the linked result set. Runs on every benchmark task. |
| **R2** | The answer-phrasing prompt receives **only validated result objects and attribution metadata** — never raw table rows, never the ingested table. | Code review rule: exactly one module builds that prompt, typed to accept `ValidatedResult[]` only. Test asserts the serialized prompt contains no fields outside the schema. |
| **R3** | Numbers in LLM output match result objects **verbatim** (formatting may localize, value may not change; rounding only via registered derivations). | Post-generation validator in the pipeline (blocking); mismatch → one regeneration, then fail closed to a template answer. Unit-tested with seeded mismatches. |
| **R4** | Every answer displays: CBS table ID(s), table title, our last-sync date, covered period. | Snapshot/UI test on the answer component; spec-level test that chart specs contain attribution (ADR [007](decisions/007-chart-spec-rendering.md)). |
| **R5** | Derived values (differences, rankings, growth) are computed by deterministic code, marked as derived, and list their source cells. | Derivations exist only as registered functions in the query module (code review); R1's scan accepts a numeric token only if a derivation record links it to source result IDs. |
| **R6** | Chart specs are built by deterministic code from validated results; the renderer cannot compute or omit. | Spec builder unit tests (results in → spec out); renderer is a pure component over the spec (code review). |
| **R7** | The LLM's intent output is schema-validated; below-threshold confidence or multiple plausible intents → clarification, never a best guess. | Schema validation at the call site; benchmark tasks B15–B16 regression-test the behavior. |
| **R8** | Every answer writes an audit record (question, intent, plan, result IDs, numbers, table versions, timestamps) **before** being shown. | Integration test: answer rendered ⇒ audit row exists and reconstructs the answer; benchmark scoring reads these records. |

## Failure behavior (confirmed principle: refuse, don't guess)

| Condition | Behavior | Regression test |
|---|---|---|
| Ambiguous intent (region/period/measure unresolved) | One compact clarifying question with concrete, *actually available* options; no numbers | B15, B16 |
| Requested data outside loaded scope | Refusal naming the scope limit + nearest answerable alternative | B17 |
| Question asks for prediction/opinion/causal interpretation | Refusal of the interpretation; offer underlying descriptive stats only if in scope | B18, B19 |
| Data exists but doesn't cover the requested period (stale/not yet published) | Freshness refusal: state freshest available period, offer it | B20 |
| Table marked `needs_review` (failed validation / suspected redesign) | Treated as out of scope; never served | ingestion fixture test |
| Table past its expected update cadence | Served **with an explicit staleness warning** if the requested period is covered; refused if the request implies recency the data can't support | clock-injected test |

## Source attribution & CC BY 4.0 obligations

CBS open data is licensed **CC BY 4.0**: attribution is required, and modified/derived data must be marked as such. Rules:

- **Attribution line on every answer and chart** (exact Dutch wording to be legal-checked, logged in [open-questions.md](open-questions.md)): *"Bron: CBS StatLine, tabel {ID} — {titel}. Gegevens gesynchroniseerd op {datum}. Licentie: CC BY 4.0."*
- **Derived-data marking**: any computed value carries *"bewerking van CBS-gegevens door checkdecijfers.nl"* alongside its source cells (pairs with R5).
- Attribution is part of the chart spec and answer schema, so it cannot be dropped by a rendering path (pairs with R4/R6).

## CBS platform-change risk

- **Table redesigns / mid-year schema changes** are expected, sometimes politically driven (definitions like "bijstand" change). Defense: schema fingerprints + `needs_review` quarantine (validation pipeline above); the registry keeps versions so an archived table's successor is an explicit re-mapping.
- **Silent retroactive corrections**: CBS corrects historical figures without announcement. Defense: syncs diff against previous values; changed historical cells are logged per batch (this diff is also the future scoop-alert seam).
- **No fixed publication times**: cadence metadata is *expected* cadence, enforced as staleness warnings, not hard schedules.
- **SDMX/.Stat migration** (announced; postponed indefinitely as of early 2026, not cancelled): the `CbsSource` adapter is the isolation seam (ADR [003](decisions/003-cbs-access-layer.md)). **Revisit trigger:** any CBS announcement re-activating the migration or deprecating OData → schedule a second adapter implementation.

## Audit-trail design

One `audit_answers` record per produced answer (and per refusal, with the refusal reason): question text, parsed intent, query plan, executed query references, result IDs and values, derivations applied, table IDs + versions + sync dates, model IDs and prompt versions used, timestamps.

Purpose now: benchmark scoring and R1/R8 verification (backend-only in Phase 0). Purpose later: the user-facing audit trail and premium exports (roadmap), and the single enforcement point for GDPR retention decisions ([04-architecture.md](04-architecture.md)).
