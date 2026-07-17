# Architecture sketches for the 2026-07-18 sparring harvest (#170 smalls + #171 parked ideas)

Written same-day by the sparring session at the owner's request ("werk het architectuurplan uit voor onze ideeën").
**Status: design sketches, NOT decisions.** No ADRs are created here — per the conventions, the session that picks up a
work package writes/updates the ADR then, using this as its starting brief. Grounded in the current code where stated
(verified 2026-07-18 on `main` @ `203a371`); everything else is marked **Assumption:**. Companion analysis:
[2026-07-18-sparring-competitive-analysis.md](2026-07-18-sparring-competitive-analysis.md).

Shared architectural stance for ALL items: they are presentation or distribution layers over the EXISTING deterministic
pipeline. None of them add an LLM surface (principle (a) untouched); none of them query CBS live (principle (b)
untouched); refusal behavior is reused, never softened (principle (c) untouched).

## #170 smalls (owner-approved candidates)

### 1. Source badges on answers/charts

- **Reuses (verified):** `src/answer/compose/format.ts` already builds an attribution line whose label resolves from the
  WP30a source registry (`resolveSource`, A1 fallback to `cbs`), and every answer rides an audit record (R8). The badge
  is a UI re-presentation of data the envelope already carries — not new data.
- **New:** a small badge component in the web layer (table code + "wekelijks bijgewerkt"-style cadence + deep link to
  the StatLine table). If the envelope exposes only the prose attribution line today, add STRUCTURED fields
  (`tableCode`, `lastSyncAt`, `sourceUrl`) to the answer payload — populated from registry/audit data, never from LLM
  text. **Assumption:** sync timestamps are queryable per table from ingestion state (they drive the RUNBOOK sync
  procedures, so they exist in the DB; exact column to be confirmed by the build session).
- **Invariants at stake:** R2/R10 (attribution) — the badge must render from envelope/registry data only. Zero prompt
  bytes. Cadence wording must be measured (actual last sync), never aspirational ("LIVE" only if we define it).
- **Open choices:** badge on chat answers only, or also on Ontdek charts (recommend: both, same component); whether the
  deep link targets the StatLine table page or our own future table page.
- **Effort:** small. **Sequencing:** anytime after the current stack; no dependencies.

### 2. Honest `llms.txt`

- **Shape:** static file served from the web app. Content: what checkdecijfers is, the three product principles, the
  public claim (exact CLAUDE.md wording — the file must never over-claim), current table coverage, how traceability
  works, where the API/MCP would live if/when #171(a) ships.
- **New:** a small generator script that renders the coverage list FROM the registry (like the conformance harness
  reads it) so the file cannot drift from reality; regenerate on deploy or via the sync procedure. Hand-written prose
  header, generated coverage body.
- **Invariants at stake:** the public-claim rule (no "0% hallucination" phrasing); doc-freshness (a stale llms.txt is
  the same bug as a stale doc — hence generation, not hand maintenance).
- **Effort:** tiny. **Sequencing:** anytime; a natural piggyback on any web deploy.

### 3. Chart download-as-image with baked-in attribution

- **Reuses:** the chart pipeline is already spec-based (`src/chart/schema.ts` zod spec → `render.ts`), and ADR 007 +
  the Phase-2 roadmap already commit to a deterministic server-side renderer for OpenGraph/share images with
  watermark/"Gegenereerd via checkdecijfers.nl".
- **Recommendation:** the download button is the SAME renderer surface as the Phase-2 OG work — one server-side
  "chart spec → PNG (+ attribution footer: name, CBS table code, peildatum)" endpoint serving both OG images and user
  downloads. Do NOT build a client-side screenshot path (NiB's approach) — a second rendering path can drift from the
  validated spec and bypasses the attribution guarantee.
- **Invariants at stake:** R2/R10 baked into pixels; renderer input is the stored chart spec (audit-reproducible),
  never live recomputation.
- **Effort:** medium-small, but **Sequencing:** bundle WITH the Phase-2 shareable-pages/OG work package rather than
  standalone — same renderer, one WP. (AidScope side-lesson recorded: pre-baked static assets are cheap and robust for
  share/embed surfaces; the renderer output can be cached statically per audit id.)

### 4. Event annotations + definition toggles in Ontdek charts

- **Annotations — new:** a curated `chart_annotations` dataset (owner-approved list: date/period, short factual label,
  which canonical keys it applies to) + an optional `annotations` array in the chart spec schema (verified: not present
  today) + a reference-line layer in the renderer. Deterministic and curated — never LLM-generated, never auto-derived
  from news. **Neutrality guardrail:** labels name events ("corona-lockdowns", "start Oekraïne-oorlog"), they do not
  interpret ("crisis door beleid X") — the label list is product copy (Dutch) and goes past the owner.
- **Toggles — reuses:** the roadmap's chart-toggle mechanism (#46) planned for the saved-charts work; a definition
  toggle is that mechanism binding two existing curated series variants (e.g. seizoensgecorrigeerd ↔ ongecorrigeerd),
  which the registry already models as distinct keys. **Assumption:** #46 mechanism is not yet built — if the smalls
  land first, scope the toggle to a minimal two-spec switcher and let #46 generalize it later.
- **Invariants at stake:** toggles switch between two VALIDATED specs (each independently R-checked); no client-side
  recomputation of series.
- **Effort:** small-medium. **Sequencing:** after current stack; annotations and toggles are separable halves.

## #171 parked ideas

### (a) Public API + MCP endpoint

- **Core stance:** a second front door to the SAME engine — the chat UI and the API become sibling consumers of one
  pipeline (intent parse → deterministic query → validate → envelope). The API must enter through the identical
  compose/validate ladder; a bypass would be the NiB `/v1/ask` failure mode with our logo on it.
- **Surface (v1 sketch):** `POST /v1/ask` {question} → either an ANSWER {answer_text, key_figures[]: {value, unit,
  table_code, cell_ref, peildatum}, definition_line, audit_id} or a machine-readable CLARIFICATION {options[],
  continuation_token} or REFUSAL {reason_code, what_is_missing} — refusals/clarifications are first-class API results,
  not errors. The continuation token rides the WP15 structured-context merge (multi-turn seam already built for chat).
  Optionally `GET /v1/coverage` rendered from the registry (same generator as llms.txt).
- **MCP:** a thin adapter exposing the same operation as an MCP tool (`ask_checkdecijfers`), so agent frameworks get
  the guarantee without custom integration. **Assumption:** hosting as a route in the existing Vercel app is
  sufficient at first; no separate service until load proves otherwise (ADR 001 split seams unaffected).
- **Billing/auth:** API keys tied to existing accounts; per-call debits on the SAME append-only ledger at the same
  credit prices (clarification = flat clarification price, refusal = 0 — identical to chat, [09-pricing](../09-pricing.md)).
  Rate limiting = the Phase-2 seam. No new billing concepts.
- **WP16 synergy (record this):** API questions about uncovered tables feed the same finder → demand-driven onboarding
  path, #166 guard included — API traffic makes coverage growth smarter, not just revenue.
- **Invariants at stake:** all of R1–R10 apply unchanged; plus a NEW public-contract concern: response schema
  versioning (v1 frozen, additive-only) — that choice deserves the ADR when built.
- **Effort:** medium (key mgmt + docs page are half the work). **Sequencing:** after current stack; no hard dependency
  on a second source, value compounds with coverage. The most strategic item if the #169 LLM-test confirms the moat.

### (b) Transparency explainers in answers

- **Definitional-trap notes — smallest first step:** registry rows gain an optional curated `caveat` (per measure or
  per table): short factual Dutch product copy ("Verdachten zijn geen veroordeelden."; "Begroot is niet uitgegeven." for
  a future rijksfinancien source). The compose template rung appends them VERBATIM (zero LLM involvement — same
  discipline as the existing "Definitie:" line, which is already the single-source-of-truth pattern to copy, verified
  in `format.ts`). Related open row: [#121](../open-questions.md) (template-rung validator enforcement) should be
  settled before caveats multiply template shapes.
- **Reconciliation notes — second step:** deterministic component-vs-total checks inside the query layer for tables
  where parts don't sum (suppressed cells, rounding, "overige"): when a question touches a known trap, the template
  explains it from a curated explanation. Start CURATED per known trap; a generic sum-check engine is explicitly out of
  scope until curation proves insufficient.
- **Datablinde-vlekken page — third step:** a browse-layer page from two inputs: a curated list of known-nonexistent
  data (e.g. 3e-generatie registration, with the CBS reason) + aggregated refusal CATEGORIES from audit records (never
  raw user questions — GDPR: question text is user data; categories/counts only).
- **Invariants at stake:** (c) — notes explain, they never soften a refusal into an answer; product copy in Dutch past
  the owner; R3 (validated text) applies to caveats like any template text.
- **Effort:** step 1 small, steps 2–3 medium. **Sequencing:** step 1 is the natural WP26-adjacent candidate when
  answer-quality work resumes.

### (c) Correlation verification (verify-not-discover)

- **Shape:** a new deterministic derivation type ("relationship check") in the query layer, conceptually an extension
  of the Phase-1 claim-verification design (registered claim-vs-actual derivations): given a CLAIMED relationship
  (parsed by intent like any claim), compute Pearson r + n + an outlier-sensitivity re-run (drop top-|residual| point)
  over two series — hard-constrained to same source, same period grid, same regional grain, same unit family.
- **Output:** template-only phrasing with a MANDATORY caveat block (correlation ≠ causation; named plausible
  confounders from a curated per-domain list; n; sensitivity result) + a scatter chart (schema extension: scatter type
  with r/n annotation — Recharts supports it, our spec doesn't yet, verified).
- **Refusal rules (the product):** refuse below minimum n; refuse cross-source/cross-definition pairs (until a
  same-grid second source exists); refuse causal phrasings in the question by reframing ("kan samenhang tonen, geen
  oorzaak"). NiB's correlaties page is the recorded counter-example; AidScope's published-rules approach is the
  transparency bar: every threshold in this feature is published on the methodology page.
- **Invariants at stake:** R1/R3/R5 extended to a computed statistic — the validator must check r/n against the stored
  computation like any other number; audit record stores both series' cell provenance.
- **Effort:** large (new derivation + validator + chart type + methodology page). **Sequencing:** last of the three —
  genuinely valuable once politie-per-gemeente (or another same-grid source) exists; before that, thin material.

## Suggested pickup order (when the stack clears — advisory, owner decides)

1. Badges + llms.txt (one small combined WP: "make the guarantee visible");
2. Transparency step 1 (caveats via registry, WP26-adjacent) — settle [#121](../open-questions.md) alongside;
3. Annotations + minimal toggles (Ontdek polish);
4. Chart-download — bundled into the Phase-2 OG/share WP;
5. API + MCP (after the #169 test, ideally with its result as the pitch);
6. Correlation verification (after a second same-grid source).
