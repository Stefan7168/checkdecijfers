# ADR 031 — Registered unit-expansion derivation for pure factor units (#125a, owner decision 2026-07-11)

**Status:** accepted (this session, 2026-07-11) — implements the owner's in-chat display
convention for [open-questions #125](../open-questions.md) part (a): **"uitgerekend erbij"** —
the expanded figure ALONGSIDE CBS's verbatim notation (the "390,2 × 1.000 (= 390.200)" shape).
The "390,2 duizend" rewording was explicitly NOT chosen, so R10's verbatim-unit rule stands
unmodified. Part (b) of #125 (mensen-vs-uitkeringen headline bridging) is OUT of scope here —
WP26 lane.

## Context

The live #111 acceptance answer read *"Het totaal aantal bijstandsuitkeringen kwam in 2023 uit
op 390,2 x 1000"*. CBS publishes table 37789ksz in thousands (unit `x 1000`), and the pipeline
deliberately keeps that factor string verbatim next to the value (R10's ×1.000 misreading
guard) — while writing "390.200" without registration would be a fabricated number (R1/R5).
Honest but clunky. The owner flagged it (2026-07-11) and decided the convention: show the exact
expanded figure alongside the verbatim notation, as a **registered derivation** so every number
stays traceable.

Binding constraints discovered in recon, which shape the whole design:

1. **Zero prompt bytes AND zero fixture bytes.** The phrasing payload (`buildPhrasingPayload`)
   is embedded in every recorded LLM fixture's `question`, and fixtures replay by request hash
   (e.g. B6's `50a6f440…` carries `"derivations": []`). Any payload change re-keys the fixtures
   → re-record → live spend. So the LLM may not see the new record at all.
2. **R8 old-row byte-stability.** `reconstructionReport` re-validates the STORED body against
   the STORED result and re-assembles text from stored parts; the body itself is stored, never
   re-derived. So the display must hang **only off the stored DerivationRecord**: rows written
   before this change carry no record → they re-validate and re-assemble byte-identically.
   (This is the owner-recorded design hint on #125.)
3. **Exactness.** IEEE-754 float multiplication is NOT exact (`390.2 * 1000 =
   390200.00000000006`). "Exact multiplication" (the decided convention) requires integer-scaled
   arithmetic, not `value * factor`.
4. **Rate units must never expand.** `aantal per 1 000 inwoners…` contains a factor-looking
   digit group but is a rate; expanding it would be flatly wrong.

## Decision

**D1 — New registered derivation kind `unit_expansion`** (R5's vocabulary, `src/query/types.ts` +
`src/query/derivations.ts`):

```
{ kind: 'unit_expansion', explicit: false, sourceResultIds: [cell.resultId],
  unit: 'aantal', marking: DERIVED_DATA_MARKING, factor: <positive integer>, value: <expanded> }
```

- **Eligibility (pure numeric factor units only):** the cell's unit, trimmed, must match
  an optional `x`/`×` prefix followed by digits with space/dot grouping and NOTHING else
  (`x 1 000`, `x 1000`, `× 1.000`). Units containing any letter are structurally excluded —
  that keeps `1 000 euro` (B12) out of v1 scope and makes rate units (`per 1 000 inwoners`)
  unexpandable by construction. The factor must parse to a safe integer ≥ 10.
- **Exact arithmetic:** with `d = cell.decimals`, compute `scaled = round(value·10^d)`; refuse
  unless `scaled` reconstructs `value` (guards a value carrying more precision than its declared
  decimals); `expandedScaled = scaled × factor` must be a safe integer AND divisible by `10^d`
  (v1 registers **integer expansions only** — for CBS thousands-factors with ≤3 decimals this is
  always the case); `value = expandedScaled / 10^d`. Any guard failing → no record (fail-open:
  the answer simply renders as today). The function refuses null-valued cells.
- The record's `unit` is `'aantal'`: the expanded figure is a bare count, which is exactly what
  the validator's R10 check expects of it (no unit word demanded next to the expanded token; the
  VERBATIM factor string next to the source value stays enforced, unchanged).

**D2 — Pre-registered in `runQuery`** (like direction/first_last/max): one record per non-null
cell whose unit is eligible, every shape. Registration is automatic and deterministic — never on
demand by the LLM (R5).

**D3 — The LLM never sees the record.** `buildPhrasingPayload` filters `unit_expansion` records
out of the serialized derivations. Payload bytes for every existing question are byte-identical
→ every recorded fixture replays, the prompt template is untouched, `COMPOSE_PROMPT_VERSION`
stays 3. The LLM keeps writing what it writes today; the expansion is display, added
deterministically (D4).

**D4 — Deterministic post-validation display splice** (`applyUnitExpansions(body, result)`,
`src/answer/compose/expand.ts`), applied ONCE in `compose.ts`'s `assemble()` after the body is
settled — so the LLM path and the template path get the identical mechanism and shape:

- Anchoring reuses the validator's own machinery: `scanBody` locates each cell-backed numeric
  token; the unit phrase is found via the same `unitMaskPhrases` variants, starting within the
  same R10 adjacency window after the token. The splice therefore only ever fires where the
  validator has already proven the verbatim factor sits.
- Insertion shape: unit wrapped in parens (the template's `8.204 (x 1 000)`) → insert inside:
  `8.204 (x 1 000 = 8.204.000)`; bare unit (LLM prose `390,2 x 1000`) → append: `390,2 x 1000
  (= 390.200)` — the owner's illustrated shape. Expanded value formatted by `formatValueNl`
  with 0 decimals (integer-only per D1).
- Safety belts, all failing OPEN to today's display (a missed expansion is a missing nicety; a
  wrong insertion would be a display bug — so: don't): skip entirely when
  `normalizeForScan(body) !== body` (index safety); one insertion per anchor occurrence, claimed
  by the nearest preceding token (a window generously shared by two values expands only the
  nearest); after splicing, the body is **re-validated** and any problem discards the splice.
- The spliced body is what gets stored (R8). Reconstruction needs no new logic for it: the body
  is a stored part; re-validation passes because the stored result carries the record.

**D5 — Validator recognizes the record** (`validate.ts`): `derivationNumbers` returns the
expanded value (so the token classifies as `derivation`, never `unbacked` — and the benchmark
scorer, which imports `scanBody`, inherits this); `derivationSourceCells` maps the record to its
source cell (R9 binding: the expanded token must sit in a sentence naming the source cell's
period/region — trivially true, it sits beside the source value). A WRONG expanded figure
(e.g. `390.201`) matches no record and still fails R3.

**D6 — CC BY marking**: no new logic — `derivations.length > 0` already renders
*"— bewerking van CBS-gegevens door checkdecijfers.nl"*, and the expansion IS a bewerking (R5).
Factor-unit answers gain the marking line; that is correct, not a regression.

**D7 — Schema versions unchanged.** Adding a union member is additive: old rows carry no such
record and are read by the same updated reconstructor deployed atomically with the writer.
`RESULT_SCHEMA_VERSION`/`ANSWER_SCHEMA_VERSION` stay 1; no DDL (derivations live inside the
stored response JSON).

## Consequences for the frozen benchmark

B6 (woningvoorraad, `x 1 000`) is the only benchmark task with an eligible unit. Its final text
gains the in-parens expansion and the marking line. The frozen key pins facts (value, unit,
coordinates), not final text; the scorer's fabricated-number scan uses `scanBody`, which backs
the expanded token via the stored record. B12 (`1 000 euro`) is out of v1 scope → byte-stable.
The #124 delivery-replay e2e (37789ksz, unit `x 1000`) asserts by `toContain('390,2')` →
unaffected; its stored text gains the expansion, which the same run's audit re-validation proves.

## Alternatives considered

1. **Let the LLM render the expansion** (add it to the payload + a prompt rule). Rejected:
   changes prompt bytes (version bump v4) and re-keys every LLM fixture (re-record = live
   spend), and hands the display of an arithmetic result to the component R3 exists to
   distrust — the validator would catch a wrong figure, but the deterministic splice never
   produces one to catch. Also risks double-rendering (model writes it AND the splice adds it).
2. **A structural "Uitgerekend:" line** (like `Definitie:`, assembled outside the body).
   Rejected: it leaves the headline sentence — the thing the owner flagged — unhealed, and
   splits one fact over two display sites. It would have been the safer call if body splicing
   were risky, but the splice anchors on positions the validator has already proven and falls
   back to the unspliced body on any doubt.
3. **Display-alias "duizend"** for `x 1 000`. Explicitly rejected by the owner (2026-07-11):
   rewording a unit needs an ADR overriding R10's verbatim rule; not chosen.
4. **Registry flag per measure** (opt-in expansion metadata). Rejected: eligibility is a purely
   syntactic property of the unit string; a registry flag adds DDL + curation burden for no
   discrimination the regex doesn't already provide.

## Trade-offs accepted

- The template's parenthesized form renders `(x 1 000 = 8.204.000)` — an equation inside the
  unit parens. Chosen over `(x 1 000) (= 8.204.000)` (double parens) for readability; the
  verbatim factor string is intact either way (R10).
- Derived values (a difference over factor-unit cells, `10,1 (x 1 000)`) do NOT expand in v1 —
  only cell values do. Recorded as a residual on #125.
- A body the belts skip (abnormal normalization, contested anchor) silently renders as today.
  Fail-open is the right direction here: absence of a nicety, never a wrong number.

## Revisit triggers

- Owner wants `1 000 euro`-family units expanded too (B12's `57 (× 1 000 euro)` → `= 57.000
  euro`): same arithmetic, widen eligibility to numeric-factor + trailing unit word, expansion
  keeps the word. Needs a fresh look at the R10 adjacency of the expanded token (unit `euro`,
  not `aantal`).
- Owner wants difference/max values over factor units expanded: needs a derivation-over-
  derivation source convention (records have no ids; sources would be the same cells).
- A CBS unit appears with a non-integer-yielding factor/decimals combination worth expanding:
  lift the integer-only rule with exact decimal-string rendering.
- Charts: expansions deliberately do not appear in chart specs (R6 verbatim projection); revisit
  if the owner wants expanded axis labels.
