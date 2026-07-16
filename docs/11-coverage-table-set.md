# Coverage-sprint table set — validated against the live catalog

**Companion to [07-phase0-table-set.md](07-phase0-table-set.md)** (that doc is the closed Phase-0 set of 8; this doc
is the authority for every table added by the coverage sprint, owner strategy [#163](open-questions.md)(3), executed
per the brief in [session-briefs/2026-07-17-coverage-sprint-brief.md](session-briefs/2026-07-17-coverage-sprint-brief.md)).
`src/ingestion/registry-seed.ts`'s `COVERAGE_TABLES` is the configuration mirror of this doc — the doc is the
authority, the file must follow it. Same method as docs/07: every load-bearing claim below is **measured** against
the live CBS catalogs (v3: opendata.cbs.nl; v4: datasets.cbs.nl), never inferred from descriptions; a later session
should expect newer periods, not different history.

## The set (grows per sprint table; build order in the sprint brief)

| # | Topic | Table | Title | Platform | Status | Size | Serves |
|---|---|---|---|---|---|---|---|
| 1 | Consumer confidence | `83693NED` | Consumentenvertrouwen, economisch klimaat en koopbereidheid; gecorrigeerd | both | Regulier | v4: 3,864 obs — full ingest | CC1–CC4 ([benchmark/coverage-key.json](../benchmark/coverage-key.json)) |

## Verification-task convention (docs/05 table-onboarding rule)

Every coverage table ships with 2–3 frozen-key benchmark-style verification tasks, ids `CC*`, frozen in
[benchmark/coverage-key.json](../benchmark/coverage-key.json) and scored hermetically by
`tests/query/coverage-key.test.ts` on the CI gate. The Phase-0 benchmark (B1–B20, its 14/14 + 6/6 + 0-fabricated
gate counts) stays untouched — CC tasks are additive, in their own key file, under the same honesty rule (values
independently re-queried from BOTH live CBS platforms before freezing; keys never edited to green).

## Measured facts per table

### `83693NED` — consumer confidence, seasonally adjusted (sprint #1; measured 2026-07-17)

- **Shape:** exactly one dimension (`Perioden`, TimeDimension) — **no geo dimension** (national-only, same shape as
  `82235NED`/`82610NED`); 8 measures × 483 monthly periods `1986MM04`–`2026MM06` = **3,864 observations exactly**
  (v4 `ObservationCount` 3864; v3 483 rows × 8 topic columns). Monthly grain ONLY — no KW/JJ keys exist, so a
  year-figure ask must refuse (`not_published`), pinned by CC4.
- **Measures (v4 codes — NOT the v3 `_1`-suffixed column names the sprint brief quoted):** headline
  `M001093` Consumentenvertrouwen, `D001095` Economisch klimaat, `M001128` Koopbereidheid (unit
  "gemiddelde saldo van de deelvragen", 0 decimals) + 5 sub-question measures `M001099`/`M001098`/`D001113`/
  `D001115`/`D001122` (unit "saldo positieve en negatieve antwoorden", 0 decimals). All values integers; no
  null cells, no string values observed (full scan at capture).
- **Statuses:** all 483 periods `Definitief` on both platforms — CBS treats this indicator as final on publication;
  the catalog prose notes small revisions land each February for the two prior years (the sync correction-diff log
  is the defense, R11 has nothing provisional to mark today).
- **Cadence:** published ~the 22nd of the **measured month itself** (June figure appeared 2026-06-22 06:30);
  **next release 23 July 2026 06:30** (v3 catalog free-text, the sprint deadline) — a sync on/after that morning
  picks up `2026MM07`.
- **Canonical measures (registry):** `consumer_confidence_seasonally_adjusted` (M001093),
  `economic_climate_seasonally_adjusted` (D001095), `willingness_to_buy_seasonally_adjusted` (M001128) — all three
  are separate persbericht figures. **Canonical-default choice (werkloosheid precedent, docs/05):** the everyday
  term "consumentenvertrouwen" maps to THIS seasonally-adjusted table, not the uncorrected sibling **`83694NED`**
  (WP16-onboarded in prod, session 28; different shape: 2017+, mixed grains, extra breakdowns). The live-prod vocab
  overlap with that sibling's `onboarded:83694NED:*` rows is resolved in the go-live step — see
  [open-questions #165](open-questions.md).
- **Reference values (frozen into CC1–CC3; v3+v4 cross-checked 2026-07-17):** 2026MM06 consumentenvertrouwen
  **−39**, economisch klimaat −64, koopbereidheid **−22**; 2013MM02 consumentenvertrouwen **−41** (pre-2022 record
  low); series start 1986MM04 = +2.

## Catalog quirks encountered (adds to docs/07's list)

1. **The sprint brief's measure identifiers were v3 column names** (`Consumentenvertrouwen_1`); the v4 codes the
   pipeline actually stores are `M001093`-style. Always re-validate identifiers against v4 `MeasureCodes` before
   writing registry rows — the kickoff's "hervalideer live vóór registry-rijen" rule caught this.
2. **`odata4.cbs.nl` is NOT the v4 host this repo uses** (`datasets.cbs.nl/odata/v1/CBS`, `src/cbs-adapter/odata-v4.ts:22`)
   — and it drops connections from some networks while `datasets.cbs.nl` works. Validate against the host the
   adapter really calls.
3. The known local IPv6 black-hole applies to fixture capture too — prefix with
   `node --import ./scripts/force-ipv4.mjs` (RUNBOOK standing rule).
