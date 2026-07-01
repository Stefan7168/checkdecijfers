# User scenarios & benchmark

Personas and scenarios match the v1 audience (journalists) and product form (chat → validated answer + source + freshness + simple chart) decided in the interview — see the Decision log in [01-product-vision.md](01-product-vision.md).

## Personas

**Fleur (34) — freelance data journalist.** Writes for regional and national outlets. Paid per article, so every hour of StatLine-clicking is unpaid time. Needs: a verified number with a citable source in minutes, and a chart she can base her own graphics on. Won't spend more than ~€5–7.50 on tooling for a single everyday article; under €10 she doesn't need anyone's approval. Her nightmare: publishing a number that turns out wrong — *"Angst voor fouten/claims"*.

**Daan (51) — editor at a small regional newsroom.** Two-person data desk, no LocalFocus budget. Uses the product to fact-check claims before publication ("wethouder zegt dat de criminaliteit is gehalveerd — klopt dat?"). Needs: the exact official number, its source, and its date — fast enough to make the evening deadline. Trusts nothing without a bronvermelding.

*(Later phases: "hoofdredacteur" enterprise buyer for newsroom licenses — see [06-roadmap.md](06-roadmap.md).)*

## Scenarios (Phase 0 product form)

Every scenario shares these baseline acceptance criteria, derived from the confirmed principles (see [CLAUDE.md](../CLAUDE.md)):

- **Exact number**: equals the CBS StatLine cell value, hand-verifiable.
- **Attribution**: CBS table ID + table title shown with the answer.
- **Freshness**: the date we last synchronized the table, and the period the data covers, shown with the answer.
- **Traceability**: every numeric value in the answer is linked, in the backend audit record, to the query result it came from (backend-verifiable in Phase 0; user-facing audit-trail UI is a later phase).
- **Derived values are marked**: anything we computed (difference, ranking, percentage change) is labeled as a computation over named source cells, using the exact wording defined in [05-data-rules.md](05-data-rules.md) ("bewerking van CBS-gegevens door checkdecijfers.nl"), per the CC BY 4.0 obligation there.

**Failure** in any scenario: a number not present in, nor linked via a registered derivation record to, the audit record's query results (matching invariants R1/R5 in [05-data-rules.md](05-data-rules.md)); missing attribution or freshness; an answer given where refusal/clarification was required; a hedged guess ("waarschijnlijk rond de…").

### S1 — Simple lookup

Fleur asks: *"Hoeveel inwoners had de gemeente Utrecht op 1 januari 2024?"*

1. Intent is parsed to (measure: population; region: gemeente Utrecht; reference date: 2024-01-01).
2. Deterministic code queries the ingested population table; validation confirms region code and period exist.
3. Answer: the exact number, one sentence of plain-Dutch context, table ID + title, sync date, period.

**Accept when**: baseline criteria pass; no chart is forced on a single-value answer (a small table row is fine).

### S2 — Trend with chart

Daan asks: *"Hoe ontwikkelde de gemiddelde verkoopprijs van bestaande koopwoningen zich van 2019 tot en met 2024?"*

1. Intent → (measure: average sale price existing owner-occupied homes; period: 2019–2024; grain: yearly).
2. Code returns the series; validation checks all six years are present and units are consistent.
3. Answer: short text naming first/last values and direction, a line chart rendered from a server-built chart spec, full attribution.

**Accept when**: baseline criteria pass; every plotted point equals its StatLine cell; the chart displays source and sync date; text values match plotted values.

### S3 — Ambiguous question → clarification

Fleur asks: *"Hoeveel mensen zitten in de bijstand?"*

Ambiguous: no period, no region, and "bijstand" maps to multiple measures (persons vs. benefits, incl./excl. AOW-age). The product asks **one compact clarifying question** offering concrete options ("Landelijk of een gemeente? Meest recente kwartaal?") and produces **no number** until resolved.

**Accept when**: no numeric answer is given before clarification; options offered actually exist in the loaded data; after the user picks, the flow completes as S1. A clarifying question costs no credit (business-model rule, later phase).

### S4 — Unanswerable or stale → refusal

Daan asks: *"Hoeveel asielzoekers kwamen er vorige maand binnen?"* (topic outside the Phase 0 table set — or, variant: the relevant table's data doesn't cover last month yet).

The product refuses with: what it *cannot* answer and why (not in loaded scope / data only available through period X), what the nearest answerable question is, and — where applicable — the freshest period it *can* serve. No estimate, no extrapolation.

**Accept when**: zero numeric claims about the unanswerable quantity; the reason is specific (scope vs. freshness); the suggested alternative is genuinely answerable.

## Benchmark (Phase 0 success measure)

~20 tasks, hand-verifiable against CBS StatLine. This benchmark is the measuring stick for the Phase 0 gate in [03-mvp-scope.md](03-mvp-scope.md).

**Assumption:** the benchmark assumes a Phase 0 table set covering: population (national + municipal), consumer prices (CPI), unemployment, housing stock, house prices, bankruptcies, household income, and solar energy (the notes repeatedly use `85552NED` as the solar example). The exact table IDs must be validated against the live CBS catalog during Phase 0 setup — CBS retires and replaces tables, so IDs in the notes may be stale. Mirrored in [open-questions.md](open-questions.md).

### Answerable tasks (must produce a validated, attributed answer)

| # | Task (user phrasing, Dutch) | Expected behavior |
|---|---|---|
| B1 | Hoeveel inwoners had Nederland op 1 januari 2025? | Single value + attribution |
| B2 | Hoeveel inwoners had de gemeente Utrecht op 1 januari 2024? | Single value, municipal dimension |
| B3 | Wat was de inflatie (CPI, jaargemiddelde) in 2024? | Single value |
| B4 | Hoe ontwikkelde de inflatie zich per jaar van 2020 t/m 2024? | Series + line chart |
| B5 | Wat was het werkloosheidspercentage in het vierde kwartaal van 2025? | Single value, quarterly grain |
| B6 | Hoeveel woningen telde Nederland in 2024? | Single value |
| B7 | Wat was de gemiddelde verkoopprijs van bestaande koopwoningen in 2024? | Single value |
| B8 | Hoe ontwikkelde de gemiddelde koopwoningprijs zich van 2019 t/m 2024? | Series + chart |
| B9 | Hoeveel faillissementen werden er in 2025 uitgesproken? | Single value |
| B10 | Vergelijk het aantal inwoners van Amsterdam en Rotterdam op 1 januari 2024. | Two cells + comparison, both attributed |
| B11 | Hoeveel elektriciteit uit zonnestroom werd er in 2024 opgewekt? | Single value (solar table) |
| B12 | Wat was het gemiddelde besteedbaar inkomen van huishoudens in 2023? | Single value |
| B13 | Groeide de bevolking van Nederland in 2024, en met hoeveel? | **Derived** (difference of two cells), marked as computation |
| B14 | Welke van de G4-gemeenten had de meeste inwoners op 1 januari 2025? | **Derived** (max over four cells), marked as computation |

### Refusal / clarification tasks (must NOT produce a guessed number)

| # | Task | Required behavior |
|---|---|---|
| B15 | Hoeveel mensen zitten in de bijstand? | **Clarify** (region, period, measure definition) |
| B16 | Wat is de gemiddelde huizenprijs in mijn buurt? | **Clarify/refuse** — region unspecified; sub-municipal grain not in scope |
| B17 | Hoeveel asielzoekers kwamen er vorige maand binnen? | **Refuse** — outside loaded table scope; say so explicitly |
| B18 | Wat wordt de inflatie in 2027? | **Refuse** — CBS publishes realizations, not forecasts; no speculation |
| B19 | Is de criminaliteit gestegen door immigratie? | **Refuse the causal interpretation**; offer only underlying descriptive statistics if in scope, else refuse fully |
| B20 | Wat was de inflatie van vorige maand? *(asked when the loaded CPI table does not yet cover that month)* | **Freshness refusal** — state the freshest available period and offer it |

### Scoring

- **Frozen answer key.** At Phase 0 setup, each task gets a recorded ground truth: CBS table ID, dimension coordinates, and expected value (or the derivation rule, for B13/B14). Scoring is a mechanical comparison against this key. The key also pins the intended measure where CBS offers several readings (B5: seasonally adjusted or not; B6: stock at which date; B9: which bankruptcy definition; B11: which solar measure), so two scorers cannot legitimately verify against different cells.
- Each **answerable task** passes only if: the number(s) match the key; the **unit** is correct; each value is bound to the **correct region/period/measure** in the prose, and any direction/comparison/ranking statement matches the data; attribution + freshness are shown; chart/derived-marking is correct where specified.
- A clarifying question on an answerable task is allowed (principle 3 may legitimately fire): the task is then scored on the **post-clarification answer**, with at most one clarification round.
- Each **refusal/clarification task** passes only if: **no number appears** for the unanswerable quantity; clarification tasks (B15, B16) ask at most one compact question whose offered options all resolve in the loaded data; refusal tasks (B17–B20) state the correct reason (scope vs. freshness vs. interpretation).
- Targets and the gate decision live in [03-mvp-scope.md](03-mvp-scope.md).
