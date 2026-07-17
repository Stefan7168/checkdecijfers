# ADR-DRAFT — Number-free phrasing via typed slots (#162): make fabrication structurally impossible

**Status: DRAFT — not accepted.** Written by the Fable overnight design marathon (2026-07-18→19, phase 2). A later
session promotes this to `docs/decisions/` (next free number) **only after** (a) owner read-back and (b) the A/B in §6
measures a win. Owner signal on record: *"klinkt echt uitstekend"* (session 48, [open-questions #162](../open-questions.md));
explicitly a candidate experiment, NOT scheduled, additive-first — this draft honors that framing.

## Context

Today the phrasing LLM **sees the real values** — `buildPhrasingPayload` (`src/answer/compose/prompt.ts:80-87`) passes
each cell's value as a pre-formatted Dutch string (`formatValueNl`) and rule 1 of the compose prompt orders a verbatim
copy. Safety is post-hoc: R3's blocking validator re-parses every numeric token in the output and checks it against
cells/derivations/metadata, fail-closed down the ADR-013 ladder (llm → llm_retry → template). This works — measured
14/14 with 0 fabricated — but has two known, bounded residuals at the deterministic ceiling (ADR 013 §6): the #140
descriptor-echo and the #141 temporal-marker shape, both patched by the #144 semantic checker (ADR 034), a
*detection* layer. #162's insight (spar session, 2026-07-17): invert the risk model — **the LLM writes the body with
typed placeholders and zero digits; deterministic code fills the slots after phrasing.** A fabricated digit then isn't
caught, it's *unrepresentable*. The owner's design question is already answered in the #162 row: the model doesn't
need the digits — charts are LLM-free (ADR 007), conclusions are registered derivations (R5/R9), correlations are
refused; what phrasing needs is semantic metadata ABOUT values, not the values.

## Decision (proposed)

### 1. The typed-placeholder contract

The slot payload replaces every digit-bearing field of today's `PhrasingPayload` with a **slot id + digit-free
metadata**; the slot menu is closed and enumerated in the payload itself:

```jsonc
{
  "shape": "series",
  "cells": [
    { "slot": "waarde1", "periodSlot": "periode1", "regionLabel": "Amsterdam",
      "unitKind": "aantal", "plural": true, "provisional": false }
  ],
  "derivations": [ { "kind": "direction", "slot": "verschil1", "trendWord": "daalde", "explicit": false } ],
  "slots": ["waarde1", "periode1", "verschil1"]          // the closed menu, nothing else is legal
}
```

- **Value slots** (`waarde*`, `verschil*`) fill via the existing proven formatters: `formatValueNl` +
  `displayValueUnit` (`template.ts:34-56`) — so **R10 unit adjacency becomes filler-owned and structural** (the `%`
  vs `procentpunt`, factor-unit and index-base rules ride the same code the template rung already proves).
- **Period slots** (`periode*`) fill with the verbatim ingested `periodLabel` (the same never-re-derived discipline
  compose uses today). Period labels contain digits ("juni 2025"), so they MUST be slots under the zero-digit rule.
- **Region labels stay free text** (no digits in Dutch place names); definition/attribution/marking/assumption lines
  stay structural fields outside the body (unchanged).
- **Provisional marking becomes filler-owned** (the filler appends the marking to a provisional slot's rendering —
  R11 moves from instructed-and-validated to structural).
- **Validation of the raw (pre-fill) LLM output, all deterministic:** (i) **zero digits** after NFKC normalization
  (`normalizeForScan`) — any digit is an instant reject; (ii) every `{...}` token ∈ the slot menu — unknown or
  malformed placeholder rejects; (iii) required slots present (≥1 value slot; the no-value-shown guard moves
  pre-fill); (iv) the existing Dutch **number/scale word-form rejection stays** (`QUANTITY_WORD_FORMS` — slots stop
  digits, not "zeventien miljoen"); (v) R9 **binding becomes placeholder-level** (the sentence containing `waarde1`
  must contain `periode1`/its region when >1 — a string check on slots, no Dutch parsing needed); (vi) R9
  **direction/comparison clause checks stay as-is** on the filled body (the model still words trends; they still bind
  to derivation records).
- **R1/R8 traceability per slot:** the audit record stores the raw placeholder body + the slot map
  (`slot → resultId/derivationId`); reconstruction **re-fills the stored template and must reproduce the stored body
  byte-identically** — the same re-derivation pattern the attribution line uses today, but now covering every number
  in the body. R1's token scan still runs on the filled body as a belt and must classify every token as
  cell/derivation/period/metadata — by construction it can no longer find `unbacked`.

### 2. What becomes a second line, what stays first-line

| Layer | Today | Under slot-filling |
|---|---|---|
| R3 digit verbatim match | first line (blocking) | **second line** (belt on the filled body; cannot fire by construction) |
| R10 unit adjacency | validated post-hoc | **structural** (filler-owned) |
| R11 provisional marking | instructed + validated | **structural** (filler-owned) |
| #144 semantic checker (#140/#141 residuals) | detection layer on soft tokens | **unnecessary on this path** — both residual shapes need a digit the model cannot emit; stays flag-wired for the legacy pipeline while it exists |
| Word-form rejection (R3's other half) | first line | **stays first line** (digits are blocked, words are not) |
| R9 direction/comparison words | first line | **stays first line** (unchanged) |
| R2 payload whitelist | no raw rows | **stronger: no values at all** |
| Template rung (ADR 013 floor) | floor | **unchanged floor** (also WP26's zero-LLM click path — untouched) |

### 3. Ladder interaction (ADR 013) and WP26

The slot pipeline slots in as a **new first rung**: slot-phrase → (reject: digits/unknown-slot/missing-slot/word-form/
R9) → one strict retry → **the existing template rung, unchanged**, as the floor. Null-cell results keep skipping the
LLM entirely. WP26 interacts only positively: the `assumptionLine` is structural (outside the body, both designs);
WP26's clicked resolutions already use the template rung; B-period trend answers are `series`-shaped and phrase like
any series. Sequencing: WP26 first (owner priority stack), #162 after — no shared code surface beyond compose, no
shared fixtures (§5).

## Alternatives considered

1. **Status quo: see-and-echo + R3 + #144 (detect, not prevent).** Proven, calibrated, 0 fabricated measured. But the
   two residuals are patched by an LLM judge (a detection layer with its own failure modes + admin-alert plumbing),
   and every future validator hole is a new patch. Keep as the A/B baseline and the rollback target; reject as the
   end state *if* the A/B shows slot prose is equal-or-better.
2. **Full cut-over rewrite to slots.** Rejected outright — the owner's row says additive experiment; the current
   pipeline is live, tested, and revenue-bearing. Rollback must be a flag flip, not a revert.
3. **Structured-output phrasing** (the model emits JSON sentence segments around server-inserted values). Strongest
   structural guarantee, but kills prose fluency (the known cost of schema-forced prose), needs a new harness shape,
   and buys nothing over slots+zero-digit-check. Rejected.
4. **Post-hoc numeric alignment** (model writes numbers as today; code re-substitutes each matched token with the
   canonical value). Rejected: alignment is ambiguous when cells share values (two regions both "12.438"), and it
   silently *repairs* fabrications instead of preventing them — the wrong honesty posture for this product.

## Trade-offs accepted

- **Dutch grammar risk is the real cost** (the owner row names it): number-noun agreement ("1 inwoner"/"…inwoners"),
  "één op de acht"-style idiom loss, sentence-initial slots, de/het around inserted labels. Mitigations: `plural`
  metadata per slot; the filler never starts a sentence with a bare digit (reorder guard); the A/B's blind
  grammar-judge + owner read (§6) is the gate. CBS aggregates are virtually never 1, so agreement edge-cases are
  rare — but the judge measures, we don't assume.
- Slot prose may read slightly stiffer than see-and-echo prose (the model can't ride the number's shape). The A/B
  bar is explicitly *equal-or-better*; a measured loss kills the experiment (that is a fine outcome — the current
  pipeline stays).
- Two pipelines coexist during the experiment (flag-selected) — bounded complexity, carried only until the decision.

## §5 Fixture/replay consequences (measured — corrects the marathon brief's assumption)

A compose-prompt change does **NOT** trigger #164: the ~93 intent/followup/clarify/delivery fixtures hash on the
intent-side system prompt (registry vocabulary) and are untouched by compose changes. The affected set is the
**separate answer-fixture domain**: 15 files in `tests/fixtures/llm/answer/` (B1–B14 + B13's recorded retry pair),
`answer:record`/`answer:eval`, `COMPOSE_PROMPT_VERSION` (now 3 → bump). Because fixtures key on the request hash, the
old and new pipelines' fixtures **coexist in the same directory** — record the slot set alongside, keep the legacy set
committed, and CI replays whichever pipeline the flag selects; rollback keeps green CI with zero re-recording. The
#144 semantic-check fixture domain is untouched (the slot path never calls it). Re-record batch cost: ~1.6K input /
~80 output tokens per compose call — B1–B14 ×3 repeats ≈ cents, not euros.

## §6 The A/B — meetopzet (what decides, how many questions, which gate)

- **Corpus:** leg 1 = B1–B14 through the slot pipeline, `--repeat=3` (validator-verdict stability, the house
  standard); leg 2 = a 20-question phrasing-diversity set drawn from the s23 audit's 40 answered questions (real
  phrasings, all shapes: single/series/comparison/derived), ×2. ≈ 82 slot compose calls ≈ €0.50 (Sonnet); baseline
  bodies replay from committed fixtures, €0.
- **Hard gates (any failure kills the run):** 14/14 + 6/6 + 0 fabricated unchanged; **zero template falls** on B1–B14
  (today's measured baseline is 14/0/0 — the slot path may not be worse); zero unrecovered digit-leak rejects
  (retry may fire; the retry rate is reported); every filled body passes the legacy validator (the §2 belt).
- **The deciding metric — Dutch phrasing quality, pairwise and blind:** for each of the 34 questions, judge
  slot-body vs baseline-body with a cheap-tier LLM judge (rubric: grammatica, natuurlijkheid, geen betekenisverschil;
  A/B order randomized; ties allowed), ×3 votes each. **Gate: slot wins or ties in ≥ 60% of questions AND loses on
  grammar-error grounds in 0** (a measured grammar error in a filled body = the known hard part materializing → fix
  or kill). Judge spend: Haiku, cents.
- **The owner is the final judge (he reads Dutch, the judge is advisory):** the read-back pack = the 5 lowest-judged
  pairs + 5 random pairs, side by side, unlabeled. Owner approves aloud or the experiment stops — same read-back
  discipline as the WP26 safelist.
- **Decision recording:** win → promote this draft to `docs/decisions/` with the measured numbers filled in, R-row
  amendments per §2's table (05-data-rules edited in the same change as the code), flag default flips after a
  supervised go-live; loss → the draft moves to rejected-with-numbers in the #162 row (a measured no is a good
  outcome), flag stays off, slot fixtures deleted.
- **Rollback at any point:** `SLOT_PHRASING_ENABLED` unset → legacy pipeline byte-identical (its fixtures never left
  the repo; the flag-off neutrality test proves it, #53/#144 pattern).

## Revisit triggers

- The A/B loses on phrasing but the structural win still tempts → revisit alternative 3 (structured output) with
  fresh eyes, or re-run after a model-family upgrade of the phrasing tier (the grammar cost is model-dependent).
- WP16 delivery-path answers or the #158 Studio suggestions adopt the pattern ("code computes a menu of true facts →
  the AI selects/words → code fills and verifies") → the slot contract in §1 is the shared contract; extend, don't fork.
- A third deterministic-ceiling residual is found in the legacy validator while this draft is unbuilt → weight moves
  from "experiment" to "scheduled" (each new patch layer is evidence for prevention over detection).
- The #101/#164-style constraint landscape changes (e.g. a compose-prompt change becomes needed for another WP
  anyway) → batch the slot experiment's record into that window.

## Open points for the owner read-back (before any build)

1. Bless the experiment window + the ~€1–2 A/B spend and the §6 gates (esp. the 60% pairwise bar).
2. Confirm the sequencing: after WP26, not before (both touch compose-adjacent surfaces; WP26 carries the trial
   stake).
3. Confirm that a measured LOSS is recorded as a rejection with numbers in #162 and the experiment is not retried
   until a revisit trigger fires (no quiet re-runs).
