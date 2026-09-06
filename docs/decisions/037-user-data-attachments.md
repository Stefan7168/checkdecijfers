# ADR 037 — "Eigen data": file/link attachments as a second, structurally separate trust tier

**Status:** accepted, 2026-09-06 (session 84) — promoted from the ADR-DRAFT that carried this
number during design. Nothing built as of acceptance; WP202a implementation starts the same
session. Full design detail, the 7-lens adversarial review, and every "Fixed in review" correction
live in [session-briefs/2026-09-06-chat-with-data-design.md](../session-briefs/2026-09-06-chat-with-data-design.md)
— this ADR records the accepted decision; that doc is the executor brief.

## Context

Open-questions [#201](../open-questions.md) (Google Sheets as a data source) and
[#202](../open-questions.md) (drop a link/file into the chat box) asked for a way to bring outside
content into chat. A same-session brainstorm sharpened this into: click a data source → chat with
the data → generate a chart → refine the chart by chatting. The owner set two hard constraints:

- **(H1)** the LLM only ever emits a structured, validated instruction (which columns, which
  filter, which chart type) — deterministic code alone renders the chart from the user's own
  stored data; no LLM-emitted value may ever become a plotted number.
- **(H2)** a chart built from a user's own data must be visibly and structurally impossible to
  confuse with an official CBS chart.

This sits directly against this product's core claim — "every number traceable to an official CBS
cell" — so the design had to answer: how do you let people chart *unofficial* data without ever
laundering it into that claim, or letting the LLM anywhere near a displayed number.

## Decision

**User-supplied data (file, link, later PDF) lives in a second, structurally separate trust tier —
the [ADR 032](032-websearch-augmentation.md) shape, applied end to end, not just styled
differently:**

1. **A new top-level module, `src/attachments/`** (ADR [001](001-single-app-vs-split.md)
   boundary) — its own ingest pipeline, its own tables (`user_datasets`, `dataset_turns`,
   migrations 026/027), its own chat action (`askDataset`, sibling of `askQuestion`), its own chart
   type (`UserChartSpec`, distinct from `ChartSpec`), its own renderer chrome. It never enters the
   CBS pipeline: zero prompt bytes in `intent/`/`compose/`/`clarify`/`followup`, never in
   `audit_answers`, `ChartSpec`, or `ConversationContext`, never in the benchmark.
2. **H1 is enforced by construction, not by convention:** the LLM's whole output surface is a
   `ChartInstruction` — column ids, enumerated filter values, a chart kind — validated against a
   **closed vocabulary manufactured per dataset at ingest time** (`DatasetProfile`), the same
   allowlist shape as `src/catalog/rerank-schema.ts`'s `validateRerankOutput`. `execute.ts` and
   `buildUserChartSpec` are the *only* code that can read a stored cell into a plotted value; there
   is no field in `ChartInstruction` capable of carrying a display value. A stripped
   `ClientChartInstruction` type — never the LLM's free-text `reading`/`unsupported.detail` fields
   — is the only shape that ever reaches the browser, closing a gap the adversarial review found
   (this exact codebase has rendered the structurally identical field verbatim elsewhere, twice).
3. **v1 computes nothing.** No sums, means, percentages, differences — every plotted value is one
   parsed, stored cell. Aggregation is refused honestly (`unsupported.reason: 'aggregation'`) until
   a future WP registers deterministic, source-cell-listing functions for it, mirroring
   `src/query/derivations.ts`'s discipline.
4. **H2 is a distinct type, not a style:** `UserChartSpec` cannot parse as a `ChartSpec`
   (`chartSpecSchema` is `strictObject`, no attribution/license fields exist) — `ChartView` refuses
   it outright. Every user-data chart carries a permanent "Eigen data · niet geverifieerd" badge, a
   dashed frame, no CBS source badge/StatLine link/CC BY line — baked into exports too.
5. **File bytes live in Postgres `bytea` behind a `FileStore` interface in v1** (not Supabase
   Storage) — the product only needs the extracted cells to chart; keeping bytes in the same
   database as everything else keeps GDPR deletion inside one transaction and CI hermetic (PGlite)
   at zero new operational surface. Revisit only past ~100MB stored, a second real user, or files
   >4MB.
6. **GDPR from day one** (ADR 033's own rule: "every new store of question-derived text must be
   inside the redaction scope from day one"): `user_datasets`/`dataset_turns` join the existing
   single-enforcement-point retention machinery (`src/answer/audit/retention.ts`) on their first
   commit — self-service delete, a new per-file delete, and the monthly purge, all in the same
   transaction discipline already proven for CBS question history.
7. **Cost rides the existing one-time-credit ledger** (`dataset_ingest`, `dataset_turn` — new
   reason `dataset_cost`, migration 027), never a new subscription model. CSV/TSV upload is free
   (deterministic, no AI work); each dataset-chat turn costs credits.
8. **Phased build, smallest useful slice first:** WP202a (CSV/TSV upload → dataset chat → line/bar
   charts with filters, flag-gated, supervised go-live) → WP202b (web links + Excel) → WP202c (PDF,
   fast-follow — the one stage where LLM output *is* the data source, so it gets a verbatim-token
   belt, a rendered-page-vs-extraction visual preview, and a stronger badge) → WP202d
   (presentation extras, registered aggregations).

**Owner decisions locked in (2026-09-06, full detail in the session-brief §8):** mechanism only for
pricing (amounts still open); 2-year retention for extracted data/turns, 90 days for raw file
bytes; per-file delete ships in v1; PDF and XLSX both deferred past v1; proposed copy accepted;
user data and CBS data are never combined in one chart for v1; dataset charts appear in the
existing history page from day one; the proposed size/quota caps (4MB, 10k rows, 50 cols, 500
points/chart, 25 datasets/50MB per user) are accepted as starting constants.

**Pre-build adversarial review (7 independent lenses — H1 boundary, GDPR/cross-user isolation,
audit/replay/reconstruction, UI byte-identity, the money path, upload security/SSRF, the LLM
allowlist) confirmed the core guarantee — no LLM output can become a plotted chart value — held
under every attempt to break it.** Real gaps found elsewhere (several independently by more than
one reviewer) are fixed inline in the session-brief and carried into the WP202a implementation:
the free-text LLM fields never reaching the client, a delete-vs-write race, a GDPR redaction gap
on two plain-text columns, a hardened SSRF/zip-bomb/PDF-hidden-text posture, and several
billing/money-path edge cases (a compensation function's foreign key, the ledger's inability to
represent a $0 charge, a missing double-click guard).

## Alternatives considered

1. **Treat an upload as a temporary [ADR 030](030-second-data-source.md)-style official source.**
   Rejected — would launder unverified, user-supplied data into the "every number traceable to an
   official CBS cell" claim. A user dataset has no registry, no canonical measures, no
   verification gate; registering it as a source lets it flow into the validated waist this
   product's whole premise depends on staying narrow.
2. **A new `ComposedResponse` kind inside the existing CBS answer envelope**, rather than a fully
   separate module/table/type. Rejected — touches the pinned envelope, the manifest test,
   `reconstruct.ts`, and the benchmark scorer, all of which are CBS-shaped; every reader downstream
   would need a new branch for a capability that isn't CBS data at all. ADR 032 already
   demonstrated the alternative (a fully separate, additively-attached tier) works cleanly.
3. **LLM-free, column-picker buttons only** (no chat). Rejected as the *only* mechanism — it's
   safe by construction but abandons the "chat with the data" ask the owner explicitly wants; kept
   as the deterministic fallback path (profile-card suggestion chips) alongside the LLM path, not
   instead of it.
4. **Supabase Storage for file bytes instead of `bytea`.** Rejected for v1 — object deletes are a
   second system from the database (no single-transaction GDPR guarantee without an
   outbox/sweep), needs a new service-role secret or RLS policies, and isn't hermetically testable
   under PGlite. Revisit once the `bytea` size/scale triggers above fire.

## Consequences

- A second, deliberately duplicated audit/envelope/reconstruction shape exists alongside the CBS
  one — duplicated in *shape*, not code, which is the price of never touching the pinned CBS
  envelope (ADR 033 D4) or the benchmark's CBS-only scoring.
- The model can mis-*select* a column or filter (visible, correctable next turn) but structurally
  cannot mis-*value* a plotted number — the same asymmetry [ADR 004](004-llm-usage.md) already
  accepts for CBS intent parsing, now extended to a second domain.
- v1 refuses several natural asks ("totaal per jaar", PDF upload, Excel upload, combining with CBS
  data) rather than build them unsafely on day one — each has a stated path to close later.
- The Postgres `bytea` choice grows the database; bounded by per-user quotas with a stated
  upgrade trigger.

## Revisit triggers

- Total stored file bytes exceed ~100MB, a second real user account needs this feature, or a
  single file needs to exceed 4MB → implement `SupabaseStorageFileStore` behind the existing
  `FileStore` interface, with browser-direct signed uploads and a delete outbox.
- The owner wants user data ever combined with CBS data in one chart → its own brainstorm + ADR,
  not an extension of this one (the "never mixed" rule here is deliberate, not a placeholder).
- v1's calibrated 0.8 instruction-confidence threshold, or a model-tier escalation for
  `DATASET_INSTRUCT_MODEL`, needs recalibration once real usage data exists (the #172 lesson:
  threshold and model tier must be co-calibrated, never changed independently).
- A future paid ingest kind (PDF/HTML) needs the ledger's `dataset_ingest` price row actually
  charging — the mechanism (source-kind gate, not a $0 price row) is already designed for this in
  the session-brief D12.
