# #144 design brief — the semantic second pass on answer bodies

*Written 2026-07-16 (session 45) as a ready-to-start handoff for a FRESH session with full
context. This is a brief, not an ADR — the build session writes the ADR. Read
[open-questions #144](../open-questions.md), ADR [013](../decisions/013-answer-composition.md)
§6 (both hardening addenda) and the two "deterministic ceiling" lessons in
[lessons-learned.md](../lessons-learned.md) first.*

## Problem — what is left after #140 v3 + #141

The deterministic validator now has exactly TWO known, bounded fabrication residuals, both
proven to sit at the deterministic ceiling (the fabrication is word-for-word identical to a
legit phrasing, and the strict rule that catches it measurably breaks legit stored answers):

1. **#140 residual:** a fabricated number equal to one of the answer's OWN descriptor numbers,
   next to that descriptor's word — "bestaat al 45 jaar" vs the legit echo "mensen van 45 jaar"
   (bracket coordinate "45 tot 65 jaar").
2. **#141 residual:** a fabricated number equal to a covered-period value behind a temporal
   marker and before an UN-listed noun — "na 2024 pogingen" (the quantity-noun veto is a closed
   list; Dutch nouns are not). Plus the harmless-by-construction list-label mimic ("; 2025: geen
   waarde" — no fabricated magnitude possible).

Blast radius is bounded (only numbers already present in the result's own metadata/periods) and
practical probability is low (the phrasing LLM is instructed to copy validated strings), but the
public claim is "every number traceable to an official CBS cell" — worth closing properly.

## Recommended shape — an additive, reject-only LLM checker (option (a))

A second, separate LLM pass AFTER the deterministic validator passes a body:

- **Input:** the SAME validated-numbers context the composer received (formatted value strings,
  labels, units, period labels, metadata anchor phrases) + the final body. No user question
  (injection surface), no raw cells.
- **Output (structured JSON, schema-forced):** the list of numeric tokens in the body that are
  used as a QUANTITY/measurement but are not one of the validated value strings — expected `[]`.
- **Policy:** non-empty list ⇒ same fail-closed ladder as R3 (one regeneration, then template).
  The checker can only ADD rejections on top of the deterministic validator — it can never
  approve something the validator rejected. That keeps principle (a) intact: the LLM still
  never validates a number INTO an answer, it only vetoes.

Why not option (b) (make the composer emit a per-number claim map, verified deterministically):
the claim map carries no more semantics than the text itself — the "45 jaar" fabrication would
claim the same metadata binding a legit echo claims, and the deterministic verification of that
claim hits the exact same ceiling. It also changes the composer prompt (full fixture re-record,
measured at ~€2 per re-record in ADR 023) for no closed residual. Rejected in this brief;
the ADR should record it as the considered alternative.

## Constraints the ADR must settle (the hard parts)

1. **R8 reconstruction.** An LLM verdict cannot be re-derived deterministically from a stored
   row. Store the checker verdict (model, prompt version, verdict JSON, latency) ON the audit
   record like the existing `llmCalls` — `reconstructionReport` verifies the stored verdict's
   presence/shape for rows composed after the feature flag, and NEVER re-runs the LLM. This
   changes the R8 story and needs its own ADR section (mirror how intent-parse LLM calls are
   already recorded-not-rederived).
2. **Fail-open vs fail-closed on checker API errors.** Recommendation: fail-OPEN (serve the
   answer that already passed the full deterministic validator, record `checker: skipped`) —
   the checker is defense-in-depth; an API outage must not degrade every answer to a template.
   This is a genuine safety-vs-availability call on the core promise: OWNER DECISION, present
   it with both options.
3. **Spend + latency scoping.** Only call the checker when the body actually contains a
   residual-PRONE token: expose from `scanBody` which exemptions were "soft" (metadata echoes;
   period tokens grounded via the temporal-before+noun path — NOT label echoes, list labels,
   spans). Most answers then skip the call entirely. Model = cheap tier by role (closed
   comparison task); pin via a named constant like `TABLE_RERANK_MODEL`, never a hardcoded name
   in prose.
4. **Hermetic CI.** Own prompt + own recorded fixture set (record/replay per ADR 012), replayed
   in CI; live recording (real spend, small) happens in an owner-supervised step. Calibrate the
   false-positive rate on the 63-body corpus (see the extraction method in the session-45
   lessons entry) + seeded residual-class fabrications; a measured FP on a legit body is a
   blocker, same standard as validator calibration (ADR 013 §6).
5. **Benchmark gate unchanged:** 14/14 + 6/6 + 0 fabricated stays the gate; the checker adds
   hermetic seeded-fabrication tests of its own.

## Rough size

One ADR + one module (`src/answer/compose/semantic-check.ts` or similar) + harness fixtures +
pipeline wiring behind an env flag (default OFF) + a supervised live step (fixture recording +
flag flip). Comparable to a small WP; do NOT start it at the tail of a long session.
