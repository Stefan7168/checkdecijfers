# ADR 019 — Open-ended period ranges in the intent contract (WP14)

**Status:** accepted, 2026-07-04 (WP14, supervised session; owner approvals in-session)

## Context

The 38-question validation pass ([validation-results-2026-07-05.md](../validation-results-2026-07-05.md), F1/E2; [open-questions #55](../open-questions.md)) proved that common journalist phrasings — "sinds 2015" (V01/V28), "de afgelopen vijf jaar", "nu vergeleken met vijf jaar geleden" (V02) — could not be *said* in the WP6 raw-parse contract: `PeriodSpec` had no open end and no two-disjoint-periods shape, and the prompt is deliberately date-free (ADR [012](012-intent-parsing-llm-harness.md)), so the model *could not* emit a correct end year. The 2026-07-05 interim guard turned the resulting degenerate shape into a period clarification; the owner approved the real fix as WP14: these questions should **answer**.

## Decisions

### 1. Three new raw-parse period kinds; the query contract does NOT change

`PeriodSpec` (the LLM-facing vocabulary) gains `since` (start year, optionally refined by quarter OR month), `last_n` (unit + n) and `now_vs_ago` (unit + amount). `RAW_PARSE_VERSION` bumps 1→2 (the schema literal the model must emit), `PROMPT_VERSION` 3→4. **`StructuredIntent` and `INTENT_SCHEMA_VERSION` are untouched**: all three kinds resolve deterministically to the existing `range` / two-`codes` shapes, which the query layer already executes, completeness-checks and refuses honestly. *(The WP14 brief in docs/08 said "one INTENT_SCHEMA_VERSION bump"; firmed up against the code, the version that carries the change is the raw-parse contract — the WP6 division of labor (the LLM says shape, code picks codes) means the frozen WP5 contract never needed to move.)*

### 2. Open ends are resolved by code, anchored at the freshest published period

The model states only the *start* (since) or the *width* (last_n, now_vs_ago); deterministic code resolves the open end to the freshest **published** period at the chosen grain — never a model-guessed year, keeping the prompt date-free and the fixtures/cache stable. All three kinds set `impliedRecency`, so the docs/05 staleness rule engages exactly as it does for `latest`.

### 3. Grain choice: coarsest-that-fits for windows, finest-that-fits for comparisons

- `since`/`last_n` pick the **coarsest** grain that expresses the phrasing (a year-anchored window reads naturally as a yearly series), falling back to finer grains when the canonical coordinate has no series at the natural one (see 4). A sub-year `since` start (named month/quarter) pins its grain outright.
- `now_vs_ago` picks the **finest** published grain that can express the unit exactly (a year = 12 months / 4 quarters / 1 year), because a comparison is anchored at "nu" — the freshest month beats last year's average as "now". V02 resolves to e.g. `[2021MM06, 2026MM06]` for inflation, `[2021KW01, 2026KW01]` for unemployment.

The asymmetry is deliberate and recorded here so later sessions don't "harmonize" it away.

### 4. Every period lookup filters on the canonical coordinate (real bug found and fixed)

Implementing V01 surfaced a pre-existing honesty gap: the intent resolver's grain/latest lookups queried observations by table+measure only. **CBS publishes no seasonally-adjusted *yearly* unemployment** — that table's yearly cells are exclusively the *uncorrected* series, a different coordinate than the canonical definition pins. Consequences of the fix (lookups now filter on `default_coordinates ⊕ canonical dims`, the same merge the query layer and `freshestForCanonical` use):

- "Werkloosheid sinds 2015" answers with the **quarterly** headline series (2015KW01–2026KW01) — the series CBS actually publishes under our stated definition — with the granularity visible in the answer (R4 covered-period line).
- A *yearly* unemployment request ("werkloosheid in 2024", degenerate year ranges) now exits as `grain_unavailable` with the honest option "per kwartaal" — previously it passed the grain gate and dead-ended in a `no_data` refusal claiming an internal data gap.
- The interim guard's range offer (`openEndedRangeOptions`) was computed unfiltered too: for the exact V01/V28 questions it was built for, it offered "2013 tot en met 2025" — a range that **could not be served** and would have refused after the user confirmed it. Now coordinate-filtered (offer suppressed where unservable); the never-offer-the-unservable rule is test-pinned.
- The prompt's `AVAILABLE_GRAINS` claim for unemployment corrected to `['KW']`; the eval script's grain cross-check is coordinate-aware to match.

### 5. No clamping: partially-servable ranges pass through to the query layer's refusals

A `since` start before loaded/published coverage is **not** clamped to what we have — silently serving 2019–2026 for "sinds 2015" would be a guess about what the user accepts (principle c). The resolver emits the honest full range and the query layer's existing typed refusals stay the single source of that behavior: "inwoners sinds 2015" → `outside_loaded_slice` naming the 2019 slice floor; V28 "werkloosheid sinds 2010" → `not_published` (CBS starts the series in 2013). **Owner decision (Stefan, 2026-07-04, in-session): the honest refusal is the wanted behavior for V28-type questions** — the docs/05 failure-table letter (outside loaded scope → refusal naming the limit + nearest alternative), not a second clarification round. Rejected alternative: clarify-with-clamped-option for partial coverage (friendlier but adds a second source of slice policy and asks about something the user already said clearly).

### 6. Defense in depth for the singular window; derivation normalization

`last_n` with `n = 1` ("het afgelopen jaar") resolves to the single freshest published period at the unit's grain — the same transparent-default pattern as `latest`. The prompt asks for a relative offset on singular phrasings, but the first record run showed the model legitimately encoding `last_n(1)` (confidence 0.92); both encodings must converge on the same honest intent (prompt rules primary, deterministic resolver the hard floor — ADR 012). Derivation normalization: `since` and `last_n` (n ≥ 2) force `series` (a difference over >2 cells could never execute; the pre-registered direction derivation carries the honest net change); `now_vs_ago` keeps its hint (`none` and `difference` are both meaningful over exactly two periods).

### 7. Calibration results and label decisions (procedure per ADR 012)

Labelled set extended 45 → 54 cases (category `open_range`: the validation pass's V01/V02/V28 phrasings verbatim, sub-year since, windows, the delta comparison, singular boundary; V06's regional probe under `ambiguous`). **Measured (2026-07-04, claude-haiku-4-5, prompt v4): 54/54 on the record run, 54/54 at `--repeat=3` with zero outcome flips; correct-parse confidence min 0.92 / median 0.95 (n=34; the report computes no maximum) — the calibrated 0.9/0.35 thresholds hold unchanged (R7 re-checked, no re-tuning needed).** Committed artifact: [benchmark/intent-calibration-report.json](../../benchmark/intent-calibration-report.json) (full run history incl. the two intermediate runs). **Clarify-reply set: 7/7** — measured hermetically via `node scripts/clarify-eval.ts --replay` (zero spend, reproducible) *after* the reviewed label correction below; the committed [clarify report](../../benchmark/clarify-calibration-report.json)'s final entry is the live **record** run, which scored **6/7 against the pre-correction label** — that 6/7 is what triggered the label review, not a contradiction of the 7/7 (replay mode deliberately writes no report).

Two mid-calibration findings, both resolved by rule/review rather than threshold moves:

- **First stability run caught the WP6 dropped-region failure mode on a new shape**: "werkloosheid in Noord-Brabant … sinds 2015" was sometimes read as national at confidence 0.75 (the R7 threshold correctly blocked any answer; only the clarification's *axis* wobbled). Fixed with a strengthened never-drop-a-named-place prompt rule + full re-record; stable ×3 after.
- **One reviewed label correction**: `c-b15-option-only`'s axis pin dropped (reasoning recorded in [benchmark/clarification-cases.json](../../benchmark/clarification-cases.json)'s note — the old pin encoded pre-v4 model detail; the policy pin, clarification → final-round refusal-with-guidance, is unchanged).

## Alternatives considered

1. **Clamp open ranges to loaded coverage.** Rejected — silent partial serving is a guess (principle c); see decision 5.
2. **Bump `INTENT_SCHEMA_VERSION`.** Rejected — nothing in the query contract changed; a version bump there would force needless churn in the frozen WP5 layer and its tests.
3. **A general `two_periods` pair of nested anchor specs** (would also cover "2024 vergeleken met 2019"). Deferred — more expressive but a bigger schema/calibration surface than the validated need (V02's "nu vs N geleden"); absolute-pair comparisons still land on `derivation_failed` refusals today. **Revisit trigger:** absolute-pair phrasings appearing in real user questions.
4. **Registry alternate for uncorrected yearly unemployment** (answer "werkloosheid in 2024" with the uncorrected annual figure, labelled as such). Not taken — serving a different definition than the canonical one stated is exactly what ADR 010/011 forbid without an explicit target; the honest `grain_unavailable` + "per kwartaal" option stands. **Revisit trigger:** users demonstrably asking for yearly unemployment figures and bouncing off the clarification.

## Revisit triggers

- Absolute two-period comparisons ("2024 vs 2019") in real traffic → alternative 3.
- Any new measure whose canonical coordinate diverges per grain (the unemployment pattern) → the coordinate-aware lookups handle it, but `AVAILABLE_GRAINS` is curated: the eval script's coordinate-aware cross-check must stay green.
- Monthly maintenance session: `npm run intent:eval` re-run per ADR 012 (now 54 cases).
