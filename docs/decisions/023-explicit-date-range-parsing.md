# ADR 023 — Explicit date-range parsing (#77 fix, session 21)

**Status:** accepted, 2026-07-05 (owner-approved as the pre-WP21 fix; owner present)

## Context

[Open-questions #77](../open-questions.md) — live-reproduced in session 18: "Maak een grafiek van de inflatie van 1 januari 2022 tot en met 31 december 2022" got a period clarification whose own example suggested bare years, and replying with the same explicit dates dead-ended in `still_ambiguous` (net 10 credits for nothing). Root cause (verified by code reading, not assumed): a pure prompt+schema gap. The prompt's period rules covered bare-year ranges only, and **no `PeriodSpec` shape could hold a day-month-year boundary at all** — the model, correctly following its own no-period-signal fallback, emitted `{"kind":"none"}`, and the clarify reply (which inherits the same base prompt) hit the same wall on the second turn. Resolution, query, chart, and billing were all already correct; the phrase simply could not be *said* in the contract — the same failure class ADR [019](019-open-ended-period-ranges.md) fixed for open-ended ranges.

## Decisions

### 1. One new raw-parse period kind: `date_range`; the query contract does NOT change

`PeriodSpec` gains `{kind:'date_range', from:{year,month,day|null}, to:{year,month,day|null}, toInclusive:boolean}`. `RAW_PARSE_VERSION` bumps 2→3, `PROMPT_VERSION` 4→5 (both per the WP14 precedent for adding period kinds). `StructuredIntent` and `INTENT_SCHEMA_VERSION` are untouched: a date_range resolves to the existing `range`/`codes` shapes the query layer already executes and completeness-checks.

### 2. The model copies dates verbatim; ALL calendar arithmetic lives in code

The division of labor is the sharpest version of principle (a) yet: the LLM emits the boundaries **exactly as written** (day null when no day is named) plus one linguistic judgment — `toInclusive`, true for "tot en met"/"t/m", false for bare "tot". It is explicitly forbidden from converting dates, simplifying to year_range, or deciding granularity. Deterministic code (`dateRangeToMonths` in resolve.ts) owns the calendar: leap-year validation (a claimed 29 februari 2023 is `period_invalid`), the exclusive-end rule ("tot 1 januari 2023" = through december 2022; a month-only bare "tot" drops the named month — the strict reading, visible in the answer's covered-period line per R4), and whole-month alignment.

### 3. Boundaries that cut a month clarify; they are never silently widened

CBS data is monthly at finest. "van 15 januari tot 20 maart" exits as `period_invalid` → an honest period clarification — answering with jan–mrt would be a silently widened window (principle c). Known v1 limitation: that clarification offers no suggested month-aligned option (options must be provably servable; building that check for a rare phrasing wasn't worth the surface). **Revisit trigger:** misaligned-days clarifications appearing in real traffic.

### 4. Grain choice: FINEST published grain that expresses the range exactly

Spelling out "1 januari … 31 december" signals intra-year interest — the opposite default from bare years. A date_range picks the finest available grain that fits the boundaries **exactly**: MM always fits; KW only on quarter edges; JJ only on whole calendar years. So the #77 question yields inflation's 12 monthly 2022 cells (a 12-point line chart via the existing series machinery), unemployment (KW-only) serves "1 januari 2024 t/m 30 juni 2025" as 2024KW01–2025KW02, and a yearly-only measure still serves whole calendar years honestly as a JJ range. Boundaries no available grain can express exactly exit as `grain_unavailable` with the published grains as options (the ADR 019 pattern). This extends ADR 019's deliberate asymmetry table: windows coarsest, comparisons finest, **explicit date boundaries finest-exact**. Bare-year phrasings ("van 2020 tot en met 2024") stay `year_range` at JJ — pinned by a labelled no-regression case.

### 5. Derivation: multi-month date ranges are series by construction

`normalizeDerivation` forces `series` for a date_range spanning more than one whole month (sharing `dateRangeToMonths` with the resolver so the two can never disagree), exactly as it does for year_range/since/last_n. A single-whole-month date_range keeps its hint (it is one period — a lookup, not a series); under a `series` hint it exits through the existing degenerate-range guard.

### 6. Calibration results and the one label decision (procedure per ADR 012)

Labelled set 54 → 62 cases (category `date_range`: the #77 phrasing verbatim, month-only boundaries, exclusive "tot 1 januari", JJ-only whole years, KW-only quarter edges, misaligned days → clarification, single month, bare-years no-regression). **Measured (2026-07-05, claude-haiku-4-5, prompt v5): first probe 61/62 with zero regressions on all 54 pre-existing cases; record run 62/62 at `--repeat=3`, zero outcome flips; correct-parse confidence min 0.92 / median 0.95 — the calibrated 0.9/0.35 thresholds hold unchanged.** Clarify 7/7 and follow-up 22/22 re-recorded green on the first attempt. The one probe failure became a **label correction, not a prompt change** (WP14 precedent): "van 1 t/m 31 januari 2022" parses correctly at confidence 0.85 — the mild-doubt band — and the R7 rule-3 echo clarification ("Bedoel je …?") is the calibrated policy working as designed on a phrasing no human uses for one month; reasoning recorded in the case's own note. Committed artifacts: [intent-calibration-report.json](../../benchmark/intent-calibration-report.json), [clarify-](../../benchmark/clarify-calibration-report.json)/[followup-calibration-report.json](../../benchmark/followup-calibration-report.json).

**Blast radius honestly stated:** the prompt/schema bytes feed every fixture hash, so all 62 intent + 7 clarify + 22 follow-up fixtures were re-recorded (orphans deleted; the hermetic gate proves the new set complete). Answer-phrasing fixtures were untouched (their requests embed validated results, not the intent prompt). Measured window spend: **1,847,847 input / 31,947 output Haiku tokens ≈ €1.75** — materially above the session's informal "well under €1" guess; the lesson (any base-prompt change is a full-re-record event, price it that way) is recorded in [lessons-learned.md](../lessons-learned.md).

## Alternatives considered

1. **Extend `year_range` with nullable month/day fields.** Rejected — it would overload one shape with two meanings (bare years vs explicit dates) whose correct grain defaults differ (decision 4), and every existing year_range fixture/example would need re-reading under the new semantics.
2. **A deterministic pre-LLM regex for date phrases.** Rejected — it splits period parsing across two engines (regex first, LLM for the rest), creating a second source of truth for "what did the user say" exactly where ADR 012 put a single one; Dutch date phrasings ("van begin maart t/m eind juni") would grow the regex forever.
3. **Let the model emit month-rounded boundaries directly (`month_range`).** Rejected — rounding "15 januari" to januari is interpretation, the model's forbidden zone; day-level verbatim copying keeps the LLM purely linguistic and puts the rounding decision (here: refuse) in reviewable code.
4. **Treat bare "tot" as inclusive at month granularity.** Rejected for v1 — colloquially defensible but a guess (principle c); the strict reading is transparent because every answer states its covered periods (R4). **Revisit trigger:** real users bouncing off "tot juni" answers that end in May.

## Revisit triggers

- Misaligned-days clarifications in real traffic → build the servability-checked month-aligned suggestion (decision 3).
- Users disputing the strict bare-"tot" reading → alternative 4.
- Quarter-named ranges ("van Q1 2020 tot Q3 2021") appearing → a `quarter` refinement on DateBoundary, same division of labor.
- Monthly maintenance session: `npm run intent:eval` re-run per ADR 012 (now 62 cases).
