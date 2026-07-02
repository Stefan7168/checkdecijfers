# ADR 004 — LLM usage: two narrow roles, strict schemas, validated data only

**Status:** accepted, 2026-07-02

## Context

Confirmed principle (a): the LLM never calculates or interprets raw CBS tables. The notes converge on Claude with tool/function calling and later prompt caching; they also cite outdated model names and prices — model IDs are an implementation-time choice, not doc law.

## Decision

The LLM appears in **exactly two places** in the pipeline, both behind strict, validated schemas:

1. **Intent parsing** — free-text Dutch question → structured intent object (measure, a **dimension-filter map** — region and period plus any other dimensions the table carries, each defaulting to the registry's pinned "totaal" coordinate — comparison type, confidence). The model has *no* data access here; it maps language to the registry's vocabulary. Low confidence or multiple plausible readings → the pipeline exits to clarification, not to a guess — except **registry-internal measure variants**, which resolve to the canonical default with the chosen definition stated in the answer (canonical-default policy, [05-data-rules.md](../05-data-rules.md)).
2. **Answer phrasing** — validated result objects + attribution metadata → short Dutch prose. The prompt contains **only** validated results and metadata, never raw table rows (invariant R2 in [05-data-rules.md](../05-data-rules.md)). A post-generation validator checks every number in the output verbatim against the result objects; mismatch → regenerate once, then fail closed to a template-rendered answer (invariant R3).

Supporting choices:

- **Provider: Claude API** (Anthropic) — strong structured-output/tool support and the notes' consistent choice. The adapter around LLM calls is thin enough that provider choice is swappable; this is a default, not a lock-in.
- **Model per task:** a small/fast model for intent parsing, a mid-tier model for phrasing; concrete model IDs chosen at implementation time (the notes' "Claude 3.5/4.6 Sonnet" references are stale).
- **Prompt caching: deferred.** It cuts input-token cost up to ~90% on repeated context, but Phase 0 prompts are tiny (no raw tables — by design!). Trigger: sustained traffic where monthly LLM spend exceeds roughly €50/mo.
- **GDPR seam:** user questions flow to the LLM provider. Phase 0 has no accounts, so no linkage to identity; from Phase 1 onward this requires a DPA with the provider and a retention decision — reserved in [04-architecture.md](../04-architecture.md).

## Alternatives considered

1. **One large model doing everything (question → answer over raw data).** The naive approach the notes bury repeatedly ("faalt binnen een week"; "doodszonde in de journalistiek"). Violates principle (a). Rejected.
2. **No LLM at all — form-based query builder.** Maximally safe, but abandons the accessibility promise that *is* the product ("chatten in plaats van handmatig filteren"). Rejected.
3. **Self-hosted open-weights model.** Removes the external-provider privacy question but adds serious ops for one non-developer, at lower Dutch-language quality. Rejected; revisit only if provider privacy terms become untenable.

## Consequences

- Hallucination is contained structurally: the model can only mis-*parse* or mis-*phrase*, and both failure modes are caught by schema validation and the verbatim-number check — mis-parses surface as wrong-but-traceable table selections, which the benchmark measures.
- Two narrow prompts are cheap (well under €0.02/question at current mid-tier pricing) and easy to regression-test.
- Answer text is **deliberately non-streaming**: R3/R9 validate the full text and R8 writes the audit record before anything is shown. Do not "optimize" by streaming pre-validation LLM output — that silently breaks the invariants. Perceived latency is mitigated by streaming deterministic pipeline *stage-status* updates instead ("tabel gevonden… berekening gecontroleerd…").

## Revisit triggers

- LLM spend > ~€50/mo → enable prompt caching, re-evaluate model tiers.
- Intent-parsing accuracy on the benchmark < the Phase 0 gate → consider richer registry aliases first, embeddings second (ADR [002](002-postgres-system-of-record.md)), bigger model last.
- Accounts launch (Phase 1) → execute the GDPR seam (DPA, retention, anonymization of logged questions).
