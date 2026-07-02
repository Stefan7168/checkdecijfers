# ADR 012 — Intent parsing: LLM harness, hermetic CI via record/replay, and R7 threshold calibration

**Status:** accepted, 2026-07-03 (WP6)

## Context

WP6 puts the first LLM call into the pipeline: Dutch question → ranked candidate intents targeting the frozen WP5 contract (`StructuredIntent`, ADR [011](011-query-contract.md)), confined to the schema-validated parsing role from ADR [004](004-llm-usage.md). Two questions were explicitly left to this work package: **how to test an LLM call in hermetic CI** (CI runs with no secrets and no network, ADR [009](009-hermetic-test-database.md)), and **the R7 confidence-threshold values and their calibration procedure** ([open-questions #19](../open-questions.md)).

## Decisions

### 1. The LLM emits vocabulary, never coordinates

The model's output contract (`RawParse`, zod schema in `src/answer/intent/schema.ts`, enforced by the API's structured-output mode AND validated again at the call site) contains only: a question classification, canonical measure **keys** (a closed enum from the registry's alias list, ADR [010](010-registry-canonical-measures.md)), region **names as the user wrote them**, a structured **period description** (named year/quarter/month, range, change-over-year, relative offset, "latest", or "none"), a derivation hint, and a self-reported confidence per reading. Deterministic code (`resolve.ts`) turns names into CBS codes against `dimension_labels`, applies period arithmetic against an **injected reference date** (never the wall clock, never a date in the prompt), and assembles the intent. A hallucinated region code or period code is structurally impossible — the model has no field to put one in.

Consequences worth naming:
- **"Groeide X in 2024" cell selection is code, not model.** Which two cells define a year's change depends on the measure's period semantics (stand per 1 januari: 2024+2025; flow: 2023+2024). That mapping is a curated set (`STAND_START_OF_YEAR_KEYS`) cross-checked by a test against the registry's `period_semantics` prose.
- **Region-name ambiguity is detected by code.** "Utrecht" matches the gemeente and the provincie in the loaded labels; the resolver reports both (slice-filtered, so options always resolve in loaded data) and the policy layer clarifies. The model only supplies a kind qualifier when the user said one ("de gemeente Utrecht").
- The system prompt is **generated from the registry constants**, so vocabulary drift between prompt and registry is impossible, and any registry change loudly invalidates the recorded fixtures (below).

### 2. Hermetic CI: record/replay behind a client seam, live eval off-gate

One interface (`IntentLlmClient`) with three implementations: the real Anthropic client, a **replay client** that serves committed fixtures keyed by a SHA-256 hash of the **entire request** (model, temperature, system prompt, output schema, question), and a recording wrapper. CI uses replay: no key, no network, and a changed prompt/schema/model/registry produces a hash miss that **fails loudly** with the re-record instruction — a fixture can never be silently replayed against a changed prompt. The live half is `npm run intent:eval` / `intent:record` (spends tokens, runs locally, writes `benchmark/intent-calibration-report.json`) and is deliberately **not** on the CI gate.

What replay does and does not prove: CI proves the deterministic 90% of the parser (resolution, thresholds, clarification building) against **real recorded model behavior**; it pins yesterday's model outputs, so model drift is caught by the live eval (and ultimately the benchmark), not by CI. That is the honest split — CI can only make hermetic claims.

### 3. R7 thresholds: calibrated values + procedure (resolves open-questions #19)

**Values (2026-07-03, claude-haiku-4-5, prompt v3):** `answerThreshold = 0.9`, `runnerUpThreshold = 0.35` (`DEFAULT_PARSER_CONFIG`).

**Procedure** (repeatable via `npm run intent:eval`): a 45-case labelled set (`benchmark/intent-labelled-set.json` + the benchmark phrasings from `tests/helpers/benchmark-intents.ts`) with four expectation classes — exact intent, canonical-default-without-clarification, clarification-with-axes, refusal classification. Labels are product-policy judgments; changing one is a reviewed decision, never a way to green a run. The eval reports per-category accuracy and the confidence distributions the thresholds must separate.

**Measured basis:** the committed artifact ([benchmark/intent-calibration-report.json](../../benchmark/intent-calibration-report.json)) shows correct parses clustering at **0.92–0.98** (min 0.92, median 0.95, n=26) — the verifiable anchor: **0.9 sits strictly below every observed correct parse**, so the threshold cannot block a reading the model is actually sure of. Corroborating (but *not* preserved as an artifact — see limitation below): in calibration run 1, before prompt rules caught them, the model's shaky readings (vague periods guessed as "latest", a dropped "mijn gemeente") were observed at 0.75–0.85, i.e. below 0.9. The failure direction is asymmetric by design: a borderline-confident *correct* reading degrades to a clarifying question (annoying, safe); a shaky reading can never be answered (principle c). Final state: **45/45**, and at `--repeat=3` zero outcome flips across runs (temperature 0). Defense in depth: prompt rules are the primary control, thresholds the backstop, and the deterministic resolver the hard floor.

**Provenance limitation (found by this WP's adversarial review, fixed forward):** the eval script originally overwrote its report on every run, so runs 1–3 of this session left no committed artifact — their numbers (the 0.75–0.85 band, the 40/45 → 43/45 → 45/45 progression) are in-session observations, not auditable data. The script now appends every run's summary to a `history` array in the report; anyone re-deriving or moving these thresholds should rely on committed history entries, and re-measure rather than trust the run-1 band.

### 4. Supporting choices

- **Model:** `claude-haiku-4-5` — ADR 004's small/fast parsing role. Escalation ladder unchanged (richer aliases → embeddings → bigger model). Temperature 0.
- **Period policy:** "latest" only on an explicit present/recency signal ("nu", "is", "meest recente") and it resolves to the freshest **published** period (code only, no values), with the period always stated in the answer — the transparent-default pattern, flagged `impliedRecency` for docs/05's staleness rule. Past tense without a named period, and change questions without a baseline, clarify. Owner-revisable: [open-questions #40](../open-questions.md).
- **Scope boundary:** a data-shaped topic that matches nothing loaded → **clarification** naming the term and offering nearest loaded topics (B15 shape); a clearly-far topic → **out_of_scope refusal** (B17 shape); causal takes precedence over out-of-scope (B19). Near-boundary topics may land on either side — both are honest (no number, topic flagged); the labelled set pins the canonical cases and one boundary case (`r-autos` → clarification, by decision).

## Alternatives considered

1. **Live LLM calls on CI.** Breaks the hermetic gate (secrets in CI, network flake, nondeterminism, per-push cost); a red push must mean broken code, not a slow API. Rejected.
2. **A hand-written fake client** (canned outputs invented by the developer). Hermetic, but tests the developer's imagination instead of the model — the WP6 failure mode is precisely a mismatch between imagined and real model behavior (calibration run 1 proved it: three real gaps no fake would have contained). Rejected.
3. **Self-consistency sampling** (N parses per question, vote). Multiplies cost and latency ×N; at 45/45 with stable repeats, single-call + thresholds is sufficient. Deferred — revisit if live accuracy degrades.
4. **Letting the LLM emit CBS codes directly.** Simpler contract, but reintroduces the hallucination surface principle (a) exists to eliminate. Rejected outright.

## Revisit triggers

- Benchmark intent accuracy drops below the Phase 0 gate → ADR 004's ladder (aliases first, embeddings second, bigger model last), re-calibrate.
- Anthropic deprecates `claude-haiku-4-5` → swap ID, re-record, re-calibrate (one command each).
- Fixture re-record churn becomes a friction point (frequent registry/prompt changes) → consider splitting the prompt's stable vs registry-derived halves.
- WP9's clarification round (merge free-text reply with pending partial intent) may need a `RawParse` extension — extend the schema version, don't overload v1.
- The monthly maintenance session should re-run `npm run intent:eval` when anything provider-side changes (model updates land silently).
