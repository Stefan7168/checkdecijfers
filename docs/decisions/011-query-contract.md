# ADR 011 — The structured-intent and ValidatedResult contract (query layer)

**Status:** accepted, 2026-07-03 (WP5)

## Context

WP5 builds the deterministic query layer before the LLM intent parser
([08-build-plan.md](../08-build-plan.md), sequencing note), which means WP5
*fixes* the contract the WP6 parser must target. Three load-bearing choices had
to be made: the shape of the intent object, the identity scheme for result
traceability (R1), and the refusal taxonomy (principle c). All live in
[src/query/types.ts](../../src/query/types.ts).

## Decision

1. **StructuredIntent** = target (`canonical` key from the ADR 010 alias list,
   or `explicit` table + measure + dims) + region codes + periods (explicit
   code list or inclusive same-grain range) + a derivation kind from the
   registered vocabulary (`none | difference | max | series`). Canonical
   targets take **no dim overrides** — choosing another reading of a term *is*
   choosing an alternate, which must be explicit. One varying axis per
   question: several periods at one place, or several regions at one period,
   never both (**Assumption**, [open-questions #38](../open-questions.md)).
2. **Result ids are deterministic coordinate ids**
   (`table:measure:region:period:dims`), not database row ids. Version pinning
   comes from `batchId` on each cell + `tableVersion` in attribution.
3. **Typed refusal taxonomy** mirroring the docs/05 failure table:
   `needs_clarification` (naming **all** unresolved user-facing axes together
   in one refusal, since the single clarification round must cover them all
   at once), `outside_loaded_slice`
   vs `not_published` (explicitly distinguished, per docs/05), `freshness`
   (offers the freshest available period + status, **never a value**),
   `table_quarantined`, `table_not_registered`, `invalid_intent`, `no_data`
   (loud gap), `derivation_failed`, `internal_inconsistency`.
4. **Pre-registered derivations**: every series result automatically carries
   `direction` + `first_last`, every multi-region comparison a non-explicit
   `max` — computed by the same registered functions (R5), flagged
   `explicit: false`, so R9's binding targets exist without the LLM asking.
   Pre-registrations that cannot be honest (null cells, tied max) are omitted;
   explicit derivation failures refuse.

## Alternatives considered

1. **Row-id-based result ids.** Simpler to emit, but unstable across
   re-ingests and meaningless in an audit record read a year later.
   Coordinate ids are self-describing and reproducible; rejected row ids.
2. **A single `periods: string[]` without ranges.** Forces WP6 to enumerate
   long series (and get enumeration subtly wrong); a range with grain-checked
   endpoints keeps enumeration in one tested place. Kept both forms.
3. **Serving partial series** (skip missing years, annotate). Rejected: a
   silently partial trend answer is a guess about what the user would accept —
   all-or-nothing with a typed refusal naming the first missing period
   (S2's "all six years present" criterion generalized).
4. **Free-form derivation expressions** in the intent (e.g. a formula string).
   Rejected outright by R5 — the vocabulary stays enumerated; new derivation
   kinds are code changes with tests, never runtime expressions.

## Consequences

- WP6 gets a frozen, schema-validatable target; any parse failure is
  unambiguously the parser's.
- WP7/WP10 consume `ValidatedResult` as-is: attribution and provisional flags
  are non-optional fields, so no rendering path can drop them (R4/R11).
- Human-readable titles/labels are whitespace-normalized at the query seam
  (CBS wire metadata carries stray double/trailing spaces); codes stay
  verbatim.

## Revisit triggers

- A benchmark-shaped question needs several regions *and* several periods
  (e.g. "compare the G4's growth 2019-2024") → extend the contract with an
  explicit cross-product shape and its own derivations, bump
  `INTENT_SCHEMA_VERSION`.
- WP6 calibration shows the parser needs richer period expressions
  ("meest recente") → add a typed relative-period form; never free text.
- A second table with a non-`Perioden` time dimension or multiple geo
  dimensions enters scope → the resolve step's single-geo/single-time
  assumption needs revisiting.
