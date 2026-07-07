# WP29 — execute brief: follow-up suggestion chips under an answer (#73)

**Frozen design: ADR [029](../decisions/029-follow-up-suggestion-chips.md). Written for a smaller
executor — every judgment call is made; follow literally.** Per #118 an autonomous build goes
**branch + PR + owner review**. Hermetic throughout (no DDL, no live spend, zero prompt bytes).

## Invariants at stake (name in every subagent brief)

- **R7-options rule / the #73 blocker:** a chip may ONLY be shown if its `StructuredIntent` passed
  the `echoServability` dry-run in THIS request — never render an ungated suggestion.
- **R8:** `AnswerResponse.text` is byte-untouched; `suggestions` is a separate structural field
  (like `chart`). The audit string, reconstruct, and every fixture stay byte-identical.
- **Principle (a):** chip copy is a templated QUESTION over registry labels — never a number, never
  a claim. **Zero LLM involvement** in generating, gating or rendering chips.
- **Money:** no new charged entry point. v1 chips FILL the input (the #75 convention — never
  auto-send); the existing pre-send cost line (#82) stays the cost surface.

## What you build

### 1. `src/answer/respond/suggestions.ts` (new, pure + one dry-run dependency)

`buildSuggestions(intent: StructuredIntent, result: ValidatedResult, check: ServabilityCheck):
Promise<string[]>` — generate candidates in this fixed priority, dry-run each via `check`
(the `echoServability` callback pattern `policy.ts` already uses), keep the first **3** that pass:

1. **Adjacent period**: the answered period shifted to the nearest loaded neighbor (next if the
   answer isn't the latest loaded period, else previous). Copy: `"En in {periodLabel}?"` —
   context-dependent phrasing is fine because WP15 conversation memory carries the referent; but
   generate the FULL explicit question anyway (v1 fills the input for a fresh parse):
   `"Wat was {definitionLabel} in {periodLabel}?"` style, mirroring how `template.ts` builds
   subjects.
2. **Trend**: when ≥3 periods of the measure's grain are loaded:
   `"Hoe ontwikkelde {definitionLabel} zich van {firstLabel} tot {lastLabel}?"` (a series intent).
3. **Region variant** (only when the measure is regional AND the answer named a region):
   `"Hoe verhoudt dat zich tot heel Nederland?"` as the explicit form
   `"{definitionLabel} in Nederland in {periodLabel}?"` — or, when the answer WAS national, a G4
   comparison. One region chip max.
4. **Same topic**: another canonical measure with the same `table_id` in the registry (first by
   key order, skipping the answered one): `"Hoeveel {everydayTerm} waren er in {periodLabel}?"`
   built from ITS labels.

Every generated intent must be complete (measure key, explicit period codes, explicit regions) so
the dry-run is meaningful and the filled text parses confidently. Drop, never guess, when a
component is missing.

### 2. Thread it (three small touches)

- `src/answer/respond/types.ts`: `AnswerResponse.suggestions: string[]` (default `[]`).
- `src/answer/respond/respond.ts`: after composing an ANSWER (both the first-turn and the
  clarification-reply answer sites), call `buildSuggestions` with the already-available servability
  callback; fail-open to `[]` on any throw (a suggestions hiccup may never cost the user the paid
  answer — same rule as `outcomeContext` in `web/app/actions.ts`).
- `web/components/chat.tsx`: under an answer bubble, render `suggestions` as chips styled exactly
  like the #75 example-question chips; clicking FILLS the input (reuse the #75 handler — verbatim
  behavior: never send). No chips → render nothing.

### 3. What you must NOT touch

`src/answer/intent/prompt.ts`, `schema.ts`, any compose/validate file, `gate.ts`, anything in
`billing/`, the audit `text`/`finalText`, the dashboard (`question-history.tsx`). If you think you
need to: STOP and report.

## Tests

- `tests/answer/suggestions.test.ts` (new): each generator produces its expected explicit Dutch
  question against the seeded registry; an unservable candidate (stub check returning not-servable)
  is DROPPED (the R7 pin — assert a chip that would dead-end never surfaces); cap 3; fail-open on a
  throwing check → `[]`; a non-regional measure yields no region chip.
- Envelope: an answer's `suggestions` ride the response while `text` is byte-identical (pin against
  a golden `text` from an existing envelope test).
- Web: chips render under an answer; click fills the input and does NOT submit (mirror the #75
  test); empty `suggestions` renders nothing.
- Benchmark + all fixtures: must replay byte-identically (zero prompt bytes — the gate proves it).

## Done-definition

Full gate green (backend + benchmark 14/14 + 6/6 + 0 fabricated + web + both typechecks), the new
pins green, zero prompt-byte diffs (prove: fixtures untouched in the PR diff), PR with
plain-language description. Docs in the same PR: ADR 029 as-built note, STATUS, open-questions #73
(→ built, v1 fill-don't-send; v2 = the WP26 Mechanism-A handler swap), 04-architecture capability
row.
