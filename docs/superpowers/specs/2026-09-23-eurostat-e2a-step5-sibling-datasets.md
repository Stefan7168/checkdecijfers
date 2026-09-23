> **Research note, session 125 (2026-09-23).** Produced by a research agent (mid tier) against the live public Eurostat Statistics API (no AI spend), checked by the session. Evidence for E2a step 5 (spec §6) and for the adapter's server-side filtering fix. Draft registry entries are UNREVIEWED; their Dutch wording needs owner sign-off in step 5.

# Eurostat E2a siblings research — making step 5 mechanical

Read-only research task. Repo docs read: `docs/superpowers/specs/2026-09-23-eurostat-e2a-country-answers-design.md`
(§4.1, §6, §7 D4), `docs/decisions/048-eurostat-data-source.md` (D5/D6 + all as-built addenda),
`src/eurostat-adapter/{statistics-api.ts,jsonstat.ts,types.ts}`, `src/registry/defaults.ts`,
`src/registry/types.ts`, `src/sources/eurostat-siblings.ts` (currently ships empty, as designed).

All API calls below were made live against the public, free, read-only Eurostat Statistics API
(`https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/...`) on 2026-09-23. No LLM/AI
calls were made. No database writes. No npm/vitest commands were run (another agent is testing on this
machine). Raw response files are in `/tmp/*.json` on this machine (ephemeral — not part of the repo);
every number below was read directly out of those real responses with a small inline Python script, shown
next to each finding so it can be re-run.

---

## 0. Headline answer (see §7 summary reply for the ≤15-line version)

**The adapter as built CANNOT register any of the three sibling slices as a genuinely filtered
registration.** `src/eurostat-adapter/statistics-api.ts`'s `fetchAndParse` (lines 106–119) builds the
request URL as:

```ts
const url = `${STATISTICS_BASE}/${nativeCode}?format=JSON&lang=EN`;
```

— no dimension filter, no `geo=`, no `sinceTimePeriod=`, nothing beyond `format`/`lang`. The function's own
comment (lines 108–115) says this explicitly: *"E1 does not attempt server-side dimensionEquals/
dimensionPrefixes filtering in the URL — parseJsonStatDataset applies the FULL slice ... client-side."*
The `SYNC_CELL_THRESHOLD` check (`jsonstat.ts:420-421`, `total = ds.size.reduce(...)`) runs on the **full,
unfiltered** declared cell count returned by that unfiltered request — i.e. the check happens BEFORE the
client-side slice/geo restriction is ever applied. So the threshold check is checking the wrong number for
any dataset where the wanted slice is small but the full dataset is not.

This is not a hypothetical: I verified live that **all three** candidate datasets exceed
`SYNC_CELL_THRESHOLD` (500,000) when fetched the way the adapter fetches them today (no filter params):

| Dataset | Fully unfiltered cell count (as the adapter would request it today) | Over cap? |
| --- | --- | --- |
| `une_rt_q` (unemployment, quarterly) | **675,108** (measured live) | **Yes** — over 500k |
| `prc_hicp_manr` (HICP, monthly annual rate of change) | **Unverified exact figure** — download reached 36 MB / 180s timeout without finishing (see §3.2); by extrapolation against `tec00115`'s 17 KB for 1,056 cells, this is on the order of several million cells | **Almost certainly yes** |
| `namq_10_gdp` (GDP, quarterly) | **8,191,372** (already verified live by this repo, ADR 048 second as-built addendum, session 107 — not re-verified by me, cited as existing evidence) | **Yes** — 16x over cap |

**But every one of the three fits comfortably under the cap once genuinely filtered.** I verified live that
Eurostat's Statistics API *does* support server-side filtering via repeated query parameters (`geo=NL&geo=DE&…`,
`unit=…`, `s_adj=…`, `sinceTimePeriod=…`) and that the returned `size` (and hence the cell-count check, if it
ran on the filtered response) shrinks accordingly:

| Dataset | Filtered slice (EU_EFTA_STAND_IN_GEO_CODES + measure dims, ~16 years) | Cells | Under cap? |
| --- | --- | --- | --- |
| `une_rt_q` | s_adj=SA, age=Y15-74, sex=T, unit=PC_ACT, geo=(34-code list), since 2010 | **2,112** | Yes, by 236x margin |
| `prc_hicp_manr` | coicop=CP00, geo=(34-code list), since 2015 | **4,488** | Yes, by 111x margin |
| `namq_10_gdp` | na_item=B1GQ, unit=CLV_PCH_SM, s_adj=SCA, geo=(34-code list), since 2010 | **2,244** | Yes, by 223x margin |

**Conclusion: the minimal change needed is to make `fetchAndParse` (and its caller, `loadDataset`) build the
request URL from the `CbsSlice` that registration passes in** — turning `dimensionEquals` entries into single
`key=value` query params, `dimensionPrefixes` entries (used today for `geo`) into repeated `key=value1&key=value2&…`
params, and `periodFloor` into Eurostat's own `sinceTimePeriod=` param (or `sinceTimePeriod`/`untilTimePeriod`
pair). This is a genuinely new code path — not a drop-in — because today `loadDataset`/`fetchAndParse` only
uses `slice` for the *cache key* and for jsonstat.ts's *client-side* re-filter; the network request itself
ignores it completely. ADR 048 D6's own text ("Fetch shape: ... server-side filtered per CbsSlice") already
describes the target behaviour; the as-built code does not yet match that text — this is the same class of gap
Amendment 6 already flagged for `request_urls`/`answer-proof.ts` (an interface that doesn't yet do what the ADR
prose says it does). **This gap is not new to E2a; it already existed the moment `tipsbd30` was registered — that
table (532 rows, D6/D7 as-built notes) happened to be small enough unfiltered that the gap never mattered until
now.** None of the three E2a candidates is that lucky.

---

## 1. Unemployment: CBS `unemployment_rate_seasonally_adjusted` ↔ Eurostat `une_rt_q`

### 1.1 CBS side (verified from `src/registry/defaults.ts`)

```ts
key: 'unemployment_rate_seasonally_adjusted',
tableId: '85224NED',
measure: 'M001906',
dims: { SeizoenEnWerkdagcorrectie: 'A050903' },
definitionLabel: 'werkloosheidspercentage, seizoengecorrigeerd',
```
Grain: **quarterly** (JJ+KW; the "canonical default" comment at line 541 says "85224NED, quarterly").

### 1.2 Eurostat dataset choice: `une_rt_q`, not `une_rt_m` or `une_rt_a`

- `une_rt_m` (monthly) is the series most people call "the EU harmonised unemployment rate" (it's what
  feeds Eurostat's own press-release headline), but CBS's own sibling series is **quarterly**, and D6's
  period grammar maps one grain per dataset — matching grain-for-grain (quarterly ↔ quarterly) is the
  closer concept match and avoids inventing a grain CBS's own comparison series doesn't have.
- `une_rt_a` (annual) is coarser than CBS's quarterly headline and would throw away the quarter detail the
  CBS canonical series carries.
- **Chosen: `une_rt_q`** — "Unemployment by sex and age - quarterly data" (label read live, see below).

### 1.3 Filters that pin one series (verified live)

```
s_adj=SA        (Seasonally adjusted data, not calendar adjusted data)
age=Y15-74      (From 15 to 74 years)
sex=T           (Total)
unit=PC_ACT     (Percentage of population in the labour force)
```
Call:
```
curl -s -G "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_q" \
  --data-urlencode format=JSON --data-urlencode lang=EN \
  --data-urlencode s_adj=SA --data-urlencode age=Y15-74 --data-urlencode sex=T --data-urlencode unit=PC_ACT \
  --data-urlencode geo=BE [...33 more geo=] --data-urlencode sinceTimePeriod=2010
```
Response excerpt (label + dims, from `/tmp/une_rt_q.json`):
```json
{"label":"Unemployment by sex and age - quarterly data", "id":["freq","s_adj","age","unit","sex","geo","time"], "size":[1,1,1,1,1,32,66]}
```
Only `age=Y15-74` (the standard EU working-age definition) is verified to exist as a code on this
dataset (confirmed by the 200 response above); I did not additionally probe other age codes since this is
the concept CBS's national rate is being compared against.

**Definitional difference a reader should know:** Eurostat's harmonised rate is defined over ages 15–74 and
uses the EU Labour Force Survey methodology; CBS's own seasonally-adjusted rate uses the Dutch national
definition (15–75 "beroepsbevolking", CBS's own survey design). These are close but not identical — exactly
the caveat the E2a confirm chip (§4.4 of the spec) already commits to showing.

### 1.4 Cell counts vs the 500k cap

- **Fully unfiltered** (as the adapter fetches today, zero filter params): `size = [1,3,7,3,3,38,94]`,
  **total = 675,108 cells** (verified live, `/tmp/une_unfiltered.json`, HTTP 200, 6.86 MB). **This is already
  over `SYNC_CELL_THRESHOLD` (500,000)** — the adapter as built would throw `AsyncApiRequiredError` trying to
  register this table today, even though the wanted slice is tiny.
- **Dimension-pinned only** (s_adj/age/sex/unit fixed, no geo/time filter): `size=[1,1,1,1,1,38,94]`,
  **total = 3,572 cells** (verified live, `/tmp/une_full.json`) — already under cap even before restricting
  geo/time, which tells you the four `dimensionEquals` filters alone would be enough if the adapter applied
  them server-side.
- **Full E2a-shaped slice** (dims fixed + `EU_EFTA_STAND_IN_GEO_CODES`-style 34-code geo list, `≥2010`):
  `size=[1,1,1,1,1,32,66]`, **total = 2,112 cells** (verified live, `/tmp/une_rt_q.json`). 32 of the 34
  requested geo codes actually appear (LI — Liechtenstein — has no data in this dataset at all; the adapter's
  structural geo restriction would simply produce zero LI rows, not an error).

### 1.5 Observation flags actually found (verified live, `/tmp/une_rt_q.json`, 2010-Q1..2026-Q2, all 32 geos)

Flag counts (sparse `status` object, only flagged cells listed): `{'d': 44, 'b': 20, 'u': 3, 'bu': 1}`.
Concrete examples (offset → dimension coordinates decoded with the same unravel-offset arithmetic
`jsonstat.ts:213-222` uses):

- `p` (provisional): **none found in this slice** for une_rt_q (no `p`-only cells at all — this dataset's
  flag vocabulary here is d/b/u/bu, not p; that's a real, useful finding since `p` is often assumed present
  everywhere).
- `e`: none found in this slice.
- `b` (break in series) — **the flag ADR 048 D5(b)'s refusal precondition exists for**:
  - **BE, 2017-Q1, flag `b`, value 7.9** ✅ (BE example, as requested)
  - **DE, 2010-Q1, flag `b`, value 7.1** ✅ (DE example, as requested)
  - **DE, 2011-Q1, flag `b`, value 5.9**
  - **DE, 2020-Q1, flag `bu` (combined break + low-reliability), value 3.3** — a real example of the
    "combined flags such as `bp`" case the E2a build-plan text (ADR 048 as-built section) already
    anticipated, except here it's `bu` not `bp`.
  - Full list of every `b`/`bu` cell in the slice (32 geos, 2010–2026): BE 2017-Q1; BG 2010-Q1, 2011-Q1,
    2019-Q1, 2024-Q3; CH 2010-Q1; CZ 2011-Q1; DE 2010-Q1, 2011-Q1, 2020-Q1(`bu`); DK 2016-Q1, 2017-Q1,
    2023-Q4; HU 2018-Q1; IE 2021-Q1; IS 2020-Q4; IT 2018-Q1; LU 2015-Q1; PL 2010-Q1, 2019-Q1; SK 2011-Q1.
  - **NL: zero `b`-flagged cells found anywhere in 2010-Q1..2026-Q2.** (Checked directly — no NL entry in
    the flag list at all for this slice, i.e. NL has zero flagged cells of ANY kind in this window.)
- `d` (definition differs): example **ES, 2021-Q1, flag `d`, value 15.6** (verified live).
- `u` (low reliability): example **DE, 2020-Q2, flag `u`, value 3.6** (verified live).
- `c`, `n`, `z`, `:` (confidential / not significant / not applicable / not available): **none found** in
  this slice.

---

## 2. Inflation: CBS `cpi_yearly_inflation` ↔ Eurostat `prc_hicp_manr`

### 2.1 CBS side (verified from `src/registry/defaults.ts`)

```ts
key: 'cpi_yearly_inflation',
tableId: '86141NED',
measure: 'M000238',
measureTitle: 'Jaarmutatie CPI',
definitionLabel: 'inflatie (jaarmutatie CPI, alle bestedingen)',
```
Grain: JJ+MM (yearly + monthly; `src/registry/defaults.ts:16`). "Jaarmutatie" = year-on-year change,
reported monthly by CBS (the headline monthly inflation figure).

### 2.2 Eurostat dataset choice: `prc_hicp_manr`, not `prc_hicp_aind`

- `prc_hicp_aind` publishes the HICP **index level** (annual average = 100 in some base year), not a rate of
  change — wrong concept entirely for an "inflation" comparison (CBS's own alternate for the index reading,
  M000215, is explicitly marked as "not a mutation percentage" in `defaults.ts`, same distinction).
- `prc_hicp_manr` ("HICP - monthly data (annual rate of change)") publishes exactly a monthly year-on-year
  %-change series, matching CBS's own "Jaarmutatie CPI" concept and its monthly cadence. **Chosen.**

### 2.3 Filters that pin one series (verified live)

```
coicop=CP00     (All-items HICP)
unit=RCH_A      (Annual rate of change) — the ONLY unit code present on this dataset (verified: size=[1,1,...] for unit even with no unit filter applied, see below)
```
Call:
```
curl -s -G ".../data/prc_hicp_manr" --data-urlencode format=JSON --data-urlencode lang=EN \
  --data-urlencode coicop=CP00 --data-urlencode geo=BE [...33 more] --data-urlencode sinceTimePeriod=2015
```
Response excerpt (`/tmp/hicp_manr.json`):
```json
{"label":"HICP - monthly data (annual rate of change) (1997-2025)",
 "id":["freq","unit","coicop","geo","time"], "size":[1,1,1,34,132]}
```
`unit` dimension: `{'RCH_A': 'Annual rate of change'}` — verified this dataset carries only one `unit` code,
so `unit=RCH_A` is a documentation-clarity filter more than a disambiguation necessity, but it's included per
D6's "pin the unit dimension" discipline anyway.

**Definitional difference a reader should know:** HICP (Harmonised Index of Consumer Prices) uses a
COICOP-based basket and Eurostat-harmonised methodology across all EU/EFTA states, deliberately built for
cross-country comparability; CBS's own "Jaarmutatie CPI" uses the Dutch national CPI basket (which the Dutch
CBS itself also reconciles against HICP, but the two Dutch series are not always numerically identical in a
given month due to weighting/methodology differences).

### 2.4 Cell counts vs the 500k cap

- **Dimension-pinned only** (`coicop=CP00`, no geo/time filter): `size=[1,1,1,45,348]`, **total = 15,660
  cells** (verified live, `/tmp/hicp_full.json`) — the full 45-geo, 348-month (1997–2025) grid for just the
  all-items HICP rate of change. Already comfortably under cap.
- **Fully unfiltered** (as the adapter fetches today — zero filter params, matching what a real registration
  call would send): I could **not** get a complete response — the download reached **36,079,872 bytes (36 MB)
  and was still incomplete when curl's own 180-second timeout killed it** (`/tmp/hicp_unfiltered2.json`,
  `Unterminated string` at EOF — genuinely truncated mid-stream, not a parsing bug on my end). **Marked
  Unverified for the exact cell count**, but the byte count alone is strong evidence it is far over the 500k
  cap: `tec00115`'s 1,056-cell response is 17 KB; scaling that ratio, 36 MB (and still growing) implies well
  over a million cells before even multiplying in every non-`CP00` COICOP subcategory and every language
  variant. **Practical conclusion, safe either way: this dataset needs the same filtered-registration fix as
  the other two — I did not need the exact number to reach that conclusion, and did not want to burn more of
  this session's time re-running a multi-minute download against a live public API for a number whose exact
  value doesn't change the recommendation.**
- **Full E2a-shaped slice** (`coicop=CP00` + 34-code geo list + `sinceTimePeriod=2015`): `size=[1,1,1,34,132]`,
  **total = 4,488 cells** (verified live, `/tmp/hicp_manr.json`).

### 2.5 Observation flags actually found (verified live, `/tmp/hicp_manr.json`, 2015-01..2025-12, 34 geos)

**The response has no `status` key at all** (`'status' in d` → `False`, verified directly). Per the JSON-stat
2.0 spec (and this adapter's own `normalizeStatus`, `jsonstat.ts:230-251`), an absent `status` field means
**zero flagged cells in the entire slice** — every one of the 4,488 cells in this window, for every one of
the 34 EU/EFTA geographies including NL/DE/BE, is unflagged (would render as Eurostat's definitive
`'Published'` status per the #251 as-built per-cell mechanism). **No `p`, `e`, `b`, or any other flag found
— including no `b` for NL, DE, or BE.** This is a genuine, verified absence, not a gap in my search: I
checked `d.get('status')` directly rather than assuming.

Dataset's own `updated` timestamp: `2026-02-06T23:00:00+0100` (this is the vintage Eurostat served live on
2026-09-23 for this specific filtered request — Eurostat's stated refresh cadence is twice daily, so this
is presumably a caching/publication-cycle artifact worth noting but not something I chased further, since it
doesn't change the filter/dimension/flag findings above).

---

## 3. GDP growth: CBS `gdp_growth_yoy_volume` ↔ Eurostat `namq_10_gdp`

### 3.1 CBS side (verified from `src/registry/defaults.ts`)

```ts
key: 'gdp_growth_yoy_volume',
tableId: '85880NED',
measure: 'M002782_1',
dims: { SoortMutaties: 'A045299' },
definitionLabel: 'economische groei: bbp-volumegroei t.o.v. een jaar eerder',
```
`A045299` = "t.o.v. een jaar eerder" (compared to the same period a year earlier) — i.e. **year-on-year volume
growth**, and per the same defaults.ts entry's own comment, this is a **quarterly flash-estimate** table
("Flash estimate ~30 dagen na kwartaaleinde").

### 3.2 Eurostat dataset choice: `namq_10_gdp`, not `nama_10_gdp` or `tec00115`

- `nama_10_gdp` is Eurostat's **annual** national-accounts GDP table — wrong grain (CBS's sibling concept is
  quarterly, not annual).
- `tec00115` ("Real GDP growth rate - volume") is a pre-built, small headline-indicator table — I fetched it
  live and confirmed it is **annual only** (`freq` has exactly one code, `'A'`) with just 12 years (2014–2025)
  and two `unit` codes (`CLV_PCH_PRE`, `CLV_PCH_PRE_HAB` — both "vs previous period", i.e. year-on-year since
  the grain is annual). It would be the easiest to register (only 1,056 cells even fully unfiltered — no
  filtering-gap problem at all) but it does not have quarters, so it cannot match CBS's quarterly headline
  concept.
- `namq_10_gdp` ("Gross domestic product (GDP) and main components (output, expenditure and income) -
  quarterly data") carries the `s_adj` dimension CBS's own quarterly flash table conceptually needs
  (seasonally/calendar-adjusted vs raw) and quarters going back decades. **Chosen**, matching CBS's grain.

**Note for whoever builds step 5:** `tec00115` is a legitimate, much-lower-risk fallback if `namq_10_gdp`'s
filtering fix turns out to be more work than wanted for the first slice — it is annual not quarterly, so the
grain wouldn't match CBS's canonical `gdp_growth_yoy_volume` key exactly, but it is trivially small
(1,056 cells, no filtering-gap problem, already verified live above) and still "GDP growth, year-on-year, by
country." That's a product/scope call, not something this research resolves.

### 3.3 Filters that pin one series (verified live)

```
na_item=B1GQ      (Gross domestic product at market prices)
unit=CLV_PCH_SM   (Chain linked volumes, percentage change compared to same period in previous year — i.e. YoY, matching CBS's A045299)
s_adj=SCA         (Seasonally and calendar adjusted data)
```
(`CLV_PCH_PRE` — percentage change vs the *previous* period, i.e. QoQ — would be the match for CBS's
alternate `gdp_growth_qoq_volume` key, not the one requested here; confirmed both unit codes exist on this
dataset from the dimension label list read during the filtered call.)

Call:
```
curl -s -G ".../data/namq_10_gdp" --data-urlencode format=JSON --data-urlencode lang=EN \
  --data-urlencode na_item=B1GQ --data-urlencode unit=CLV_PCH_SM --data-urlencode s_adj=SCA \
  --data-urlencode geo=BE [...33 more] --data-urlencode sinceTimePeriod=2010
```
Response excerpt (`/tmp/namq_full_slice3.json`):
```json
{"label":"Gross domestic product (GDP) and main components (output, expenditure and income) - quarterly data",
 "updated":"2026-09-21T23:00:00+0200",
 "id":["freq","unit","s_adj","na_item","geo","time"], "size":[1,1,1,1,34,66]}
```

**Definitional difference a reader should know:** Eurostat's quarterly national accounts use ESA 2010
methodology harmonised across member states; CBS's own flash estimate is itself an early, frequently-revised
figure (the CBS table's own notes field already says "recente kwartalen Voorlopig en worden bij de tweede
raming bijgesteld") — so BOTH sides of this pair are provisional-leaning by nature, which the confirm chip's
generic "definitions can differ" caveat covers without needing extra wording.

### 3.4 Cell counts vs the 500k cap

- **Fully unfiltered** (as the adapter fetches today): **8,191,372 cells** — **not independently re-verified
  by me this session** (a full unfiltered fetch of this dataset is exactly the multi-million-cell, multi-tens-
  of-MB download the earlier HICP attempt showed is impractical within a normal request timeout); I am citing
  ADR 048's own second as-built addendum (session 107, 2026-09-16), which already made this exact live
  measurement and recorded it as the reason the original `namq_10_gdp` demo fixture was replaced with smaller
  specimens. Treat this one figure as **ADR-verified, not newly verified by this report** — flagged per the
  task's instruction to mark what I could not personally verify with a fresh call.
- **Dimension-pinned only** (na_item/unit/s_adj fixed, no geo/time filter): not separately measured (would
  require another large-ish download); not needed for the conclusion since the fully-filtered number below
  already proves the point.
- **Full E2a-shaped slice** (na_item/unit/s_adj fixed + 34-code geo list + `sinceTimePeriod=2010`):
  `size=[1,1,1,1,34,66]`, **total = 2,244 cells** (verified live, `/tmp/namq_full_slice3.json`). Only 34 of 35
  requested codes have data (`LI` — Liechtenstein — again absent; same structural non-error as §1.4).

### 3.5 Observation flags actually found (verified live, `/tmp/namq_full_slice3.json`, 2010-Q1..2026-Q2, 34 geos)

Flag counts (sparse `status` object): `{'p': 109}` — **only the `p` (provisional) flag appears in this slice,
109 cells out of 2,244, and no `b` (break), `e`, `u`, or any other flag at all.** I checked specifically for
NL/DE/BE break flags and found **none** — this dataset+slice combination has zero break-in-series flags for
any of the 34 geographies in the 2010–2026 window, not just for NL/DE/BE. (A `b` flag could plausibly exist
further back in GDP history — e.g. German reunification-era data — but that is outside the ~10–15-year window
this research and the E2a design both scope to, so I did not chase it.)

---

## 4. Draft `CanonicalMeasure` entries (per `src/registry/types.ts`'s exact shape)

These are **drafts for a person to review**, per the spec's own rule (§4.1: "Reviewed by a PERSON per pair")
— I am not the reviewer the process calls for, only supplying the researched material. Per the spec and the
sibling-only-list correction (session 125 fix wave), these go in
`EUROSTAT_SIBLING_MEASURES` in `src/sources/eurostat-siblings.ts`, **never** in `CANONICAL_MEASURES`
(`src/registry/defaults.ts`).

```ts
export const EUROSTAT_SIBLING_MEASURES: readonly CanonicalMeasure[] = [
  {
    key: 'eu_unemployment_rate_harmonised',
    tableId: 'eurostat:une_rt_q',
    measure: 'une_rt_q|PC_ACT',
    measureTitle: 'Unemployment by sex and age - quarterly data',
    dims: { s_adj: 'SA', age: 'Y15-74', sex: 'T' },
    definitionLabel: 'geharmoniseerd werkloosheidspercentage (Eurostat, seizoengecorrigeerd, 15-74 jaar)',
    everydayTerms: [], // sibling-only: never enters the parser vocabulary (§4.1)
    notes:
      'Sibling of CBS unemployment_rate_seasonally_adjusted (85224NED). Grain match: quarterly-quarterly ' +
      '(CBS canonical default is quarterly, not une_rt_m\'s monthly). Definitional difference for the ' +
      'confirm chip: EU harmonised LFS methodology, ages 15-74, vs. CBS\'s own national beroepsbevolking ' +
      'survey, ages 15-75. Verified live 2026-09-23: filtered slice (s_adj=SA, age=Y15-74, sex=T, ' +
      'unit=PC_ACT, EU/EFTA geo list, since 2010) = 2,112 cells; fully unfiltered (today\'s adapter request ' +
      'shape) = 675,108 cells, OVER the 500k sync cap — registration needs the adapter\'s filtering fix ' +
      'described in §0 of the research doc before this table can be onboarded.',
  },
  {
    key: 'eu_hicp_annual_rate',
    tableId: 'eurostat:prc_hicp_manr',
    measure: 'prc_hicp_manr|RCH_A',
    measureTitle: 'HICP - monthly data (annual rate of change)',
    dims: { coicop: 'CP00' },
    definitionLabel: 'geharmoniseerde inflatie (Eurostat HICP, jaarmutatie, alle bestedingen)',
    everydayTerms: [],
    notes:
      'Sibling of CBS cpi_yearly_inflation (86141NED). Grain match: monthly-monthly. Definitional ' +
      'difference for the confirm chip: EU-harmonised COICOP basket vs. CBS\'s own national CPI basket. ' +
      'Verified live 2026-09-23: filtered slice (coicop=CP00, EU/EFTA geo list, since 2015) = 4,488 cells, ' +
      'zero flagged cells found (no status field in the response at all). Fully unfiltered size ' +
      'UNVERIFIED (download exceeded a 180s timeout at 36MB, incomplete) but near-certainly far over the ' +
      '500k cap by extrapolation from tec00115\'s baseline (17KB / 1,056 cells) — same adapter fix needed.',
  },
  {
    key: 'eu_gdp_growth_yoy_volume',
    tableId: 'eurostat:namq_10_gdp',
    measure: 'namq_10_gdp|CLV_PCH_SM',
    measureTitle: 'Gross domestic product (GDP) and main components (output, expenditure and income) - quarterly data',
    dims: { na_item: 'B1GQ', s_adj: 'SCA' },
    definitionLabel: 'bbp-volumegroei t.o.v. een jaar eerder (Eurostat, kwartaalcijfers)',
    everydayTerms: [],
    notes:
      'Sibling of CBS gdp_growth_yoy_volume (85880NED). Grain match: quarterly-quarterly. unit=CLV_PCH_SM ' +
      'chosen (not CLV_PCH_PRE) to match CBS\'s A045299 "t.o.v. een jaar eerder" (YoY, not QoQ). Verified ' +
      'live 2026-09-23: filtered slice (na_item=B1GQ, unit=CLV_PCH_SM, s_adj=SCA, EU/EFTA geo list, since ' +
      '2010) = 2,244 cells, only \'p\' (provisional) flags found (109 cells), zero \'b\' break flags for ' +
      'any of the 34 geos including NL/DE/BE. Fully unfiltered = 8,191,372 cells (ADR 048 second as-built ' +
      'addendum, session 107 measurement — cited, not independently re-verified this session) — 16x over ' +
      'the 500k cap; the adapter filtering fix is a hard prerequisite for this one, not optional. ' +
      'tec00115 ("Real GDP growth rate - volume") is a smaller, annual-only fallback if a quarterly grain ' +
      'match is not required — verified live at 1,056 cells fully unfiltered, no filtering-gap problem at ' +
      'all, but grain would not match the CBS key\'s quarterly cadence.',
  },
];

export const EUROSTAT_SIBLINGS: Readonly<Record<string, string>> = {
  unemployment_rate_seasonally_adjusted: 'eu_unemployment_rate_harmonised',
  cpi_yearly_inflation: 'eu_hicp_annual_rate',
  gdp_growth_yoy_volume: 'eu_gdp_growth_yoy_volume',
};
```

Notes on the draft's own gaps (per the task's "mark every claim you could not verify" instruction):

- **`definitionLabel` Dutch wording above is my own draft, not owner-signed.** ADR 048 Amendment 11 / the
  D6 text requires Dutch attribution/suffix wording to be an owner sign-off before any registry entry ships —
  this applies here too, and I have not sought that sign-off (out of scope for a read-only research task).
- **I did not verify `measureTitle`/`unit` label rendering through the actual adapter code** (i.e. I did not
  run `parseJsonStatDataset` against these captured responses) — the `dims`/`measure`/`tableId` shapes above
  are my own construction from reading `jsonstat.ts`'s synthesis rule (`measure: `${nativeCode}|${unitCode}``,
  `jsonstat.ts:513,527`) applied to the real API responses, not a program-verified round-trip. No
  npm/vitest commands were run this session (constraint given for this task), so this is **Unverified**
  against the actual code path, only against my own reading of it.
- **The exact `EU_EFTA_STAND_IN_GEO_CODES` codes I used as my geo filter list were copied from
  `jsonstat.ts:76-84`** (BE BG CZ DK DE EE IE EL ES FR HR IT CY LV LT LU HU MT NL AT PL PT RO SI SK FI SE IS
  LI NO CH EU27_2020 EA EA19 EA20 EFTA) — I did not additionally test the `EA`/`EFTA` aggregate codes'
  presence on each dataset individually beyond confirming they appear in the returned geo dimension for
  `namq_10_gdp` (`EA`, `EA19`, `EA20` present) and `une_rt_q`/`prc_hicp_manr` (`EA20` present; plain `EA` was
  present in `prc_hicp_manr` but I did not check `une_rt_q` for it specifically — worth a follow-up check
  before registration, not a blocker for this research's conclusions).
