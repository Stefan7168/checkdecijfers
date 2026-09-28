# Regional statistics: twelve figures per municipality and province from `70072ned`

**Status:** design APPROVED by the owner, session 138 (2026-09-28): picked the 12-figure set ("12 figures
(Recommended)"), then "Go, build step 1 now" on the plain-English summary. Part 2 waits for 2026-10-01 + the owner. **Row:** build-plan "Regional statistics → region questions"; touches
[#333](../../open-questions.md)(6). **ADR:** 061 (written with the build).

## 1. What the reader gets

Today only 2 of our 26 figures can be answered per region (population on 1 January, average home sale price per
gemeente). This adds 12 regional figures from one CBS table, **Regionale kerncijfers Nederland** (`70072ned`), for the
Netherlands, the 12 provinces and every gemeente, 2015 onwards:

| # | CBS code | Figure (CBS title) | Unit | Latest year with all 342 gemeenten |
|---|---|---|---|---|
| 1 | `M000100` | Bevolkingsdichtheid | inwoners per km² land | 2025 |
| 2 | `M003039` | Gemiddelde WOZ-waarde van woningen | × 1 000 euro | 2025 |
| 3 | `1014800` | Koopwoningen | % | 2024 |
| 4 | `2018790` | Hoogstbehaald onderwijsniveau: hbo, wo | % | 2024 (341 of 342: one withheld) |
| 5 | `A018943_2` | Personenauto's, relatief | per 1 000 inwoners | 2025 |
| 6 | `X092783` | Afstand tot treinstation | km (average over the road, all residents) | 2025 |
| 7 | `M000101_3` | Bevolkingsgroei, relatief | per 1 000 inwoners | 2024 |
| 8 | `M000114` | Gemiddelde huishoudensgrootte | personen per huishouden | 2025 |
| 9 | `1050015_2` | Eenpersoonshuishoudens | % of private households | 2025 |
| 10 | `M000200_2` | Bedrijfsvestigingen totaal | count on 1 January, rounded to 5 | 2026 |
| 11 | `X033647` | Uitkeringsontvangers, totaal | count (**includes AOW state pension**) | 2025 |
| 12 | `D000025` | Afstand tot grote supermarkt | km (average over the road, all residents) | 2025 |

Questions like "welke gemeente heeft de meeste auto's per 1 000 inwoners", "koopwoningen per provincie in 2024",
"afstand tot treinstation in Utrecht" then get audited answers through the existing machinery: single region, region
series, ADR 054 region-set answers (ranking only when the class is complete, RS1), and the ADR 060 "Zet af tegen …"
scatter, which now has real partners.

Not in this slice: household income (see D2), sub-municipal grain, COROP/landsdeel levels, a pair *menu* on the
scatter chip (see D6), typed "X tegen Y" questions (#333(2)).

## 2. What was measured (2026-09-28, live v4 API)

- The table: 6,802,920 cells, 248 measure codes, dimensions `RegioS` (GeoDimension) + `Perioden` only, 32 yearly
  periods 1995–2026, 785 region codes (1 NL, 4 LD, 12 PV, 40 CR, 728 GM incl. abolished gemeenten).
- Region groups follow the convention region-set.ts relies on: `PV`, `LD`, `NL`, `GMPV20`…`GMPV31`, `CRPV##`;
  no `OVERIG` group. Abolished gemeenten carry `ValueAttribute: 'Impossible'` in later years (= not applicable,
  which ADR 054 already treats as not breaking completeness).
- **The v4 feed reuses measure codes.** For Amsterdam 2024 alone, 34 measure codes carry 2–4 different values for the
  same (region, year) — e.g. `1050010_6` (household income) has 60.8 / 45.6 / 17.9, which v3 keeps apart as
  `…_101/_111/_121` under different parent groups. v4 `MeasureCodes` lists each code once, so nothing in the metadata
  warns. Our upsert would hit Postgres's "ON CONFLICT cannot affect row a second time" and fail the sync — closed,
  but by accident, not by a check.
- **The chosen 12 are clean**: fetched in full (NL/PV/GM, 2015+), **0 duplicate (region, year) keys** for every one;
  NL + 12 PV + 342 GM present in the latest year (#4: 341). Slice size **106,683 cells** (cap: 500,000).

## 3. Decisions

- **D1 — One table, a measure allow-list slice.** New optional `CbsSlice.measures?: string[]` (next to
  `dimensionEquals`/`dimensionPrefixes`/`periodFloor`). `sliceToFilter` adds `(Measure eq 'a' or Measure eq 'b' …)`
  server-side; the fixture source applies the same filter client-side; the slice is stored in `cbs_tables.slice` as
  today (JSON — no schema change). Slice for `70072ned`: the 12 codes, `RegioS` prefixes `NL/PV/GM`, period floor
  `2015JJ00`. Alternatives rejected: v3 API for this table only (a second adapter path to maintain, v3 is the older
  platform); several topic tables (Kerncijfers wijken en buurten is one table *per year* — re-onboarding yearly).
- **D2 — Only provably single-valued codes; household income excluded.** A code enters the allow-list only after a
  measured full-slice check of 0 duplicate keys (done for these 12, §2). Income is the most-wanted regional figure
  but its v4 code is ambiguous; it stays out until CBS fixes the feed or we find an unambiguous code — recorded as an
  open question, never approximated.
- **D3 — A duplicate-cell check for every sync (fail closed, on purpose).** *(As built: this check already existed in `row_plausibility` — `src/ingestion/validate.ts`; Part 1 only rewrote its message to name CBS code reuse. The "our upsert would hit ON CONFLICT" line in §2 was wrong.)* New check in the existing
  `row_plausibility` validation stage: two fetched rows with the same (measure, region, period, other dims) fail the
  batch and quarantine per today's rules, with a summary naming the first duplicate. Applies to all tables (none
  has duplicates today — proven by the fixture suite staying green). No new `FailureStage` value, so no DDL.
- **D4 — Schema fingerprint scoped to the allow-list.** Phase 0 rejected `70072ned` because CBS revises its topics
  constantly and the fingerprint covers *all* measure codes, so any unrelated revision would quarantine the table.
  With `slice.measures` set, the fingerprint is computed over the dimensions + **only the allow-listed codes**, and
  a sync first checks every allow-listed code is still present in `MeasureCodes` — a missing one fails the
  `schema_fingerprint` stage loudly. Unit drift on the 12 stays caught by the existing unit-consistency check.
  Tables without `slice.measures` keep today's all-codes fingerprint byte-for-byte (no rebaseline anywhere).
- **D5 — Two parts, split at the paid step.** Adding a canonical figure changes the intent parser's vocabulary and
  JSON-schema enum, which invalidates every recorded intent/clarify/followup fixture (#164). The spend roof is nearly
  used until 2026-10-01, so:
  - **Part 1 (now, zero AI spend):** D1/D3/D4 hardening, `70072ned` in the seed set + hermetic fixture (captured with
    a narrower period floor to keep the repo small), `TABLE_REGISTRY_DEFAULTS` entry, then the owner-supervised live
    load (`ingest register`, `ingest sync 70072ned` — data only, no DDL) and a value spot-check against CBS.
    Nothing reader-visible changes; the data sits ready. *(Changed after the final review: loading prod would already
    list the table on `/llms.txt` and the coverage box, so the prod load moves to Part 2 — same session as the canonical
    figures. Part 1 instead proved the load with a full live-data sync into a throwaway local database: 106,683 cells, all
    checks passed.)*
  - **Part 2 (code built now on a branch; merged in the owner-supervised recording session after 2026-10-01):**
    the 12 `CANONICAL_MEASURES` entries, `REGIONAL_KEYS`, English labels (both maps — CI-enforced), the scatter
    partner map (D6), new labelled intent-eval cases, re-record intent + clarify + followup fixtures (cheap tier),
    intent eval, then the live benchmark (which also confirms #330).
  Rejected: a temporary "hidden from the parser" flag on canonical figures — it would need a second canonical-key
  enum (click validation must accept keys the parser must not emit), a new way to get it wrong, for three days of
  value that only chip-driven scatter answers could reach.
- **D6 — Scatter partner: a curated per-figure partner, not a menu (yet).** With 14 regional figures the chip's
  "first servable in registry order" would be arbitrary. Cheapest mechanism first: a small code map picks each
  figure's natural partner — counts (population, businesses, benefit recipients) pair with population, rates /
  averages / distances pair with population density, density pairs with average WOZ value; the chip still falls
  back to the next servable partner if the first is not servable for that year. A pick-your-partner menu stays
  #333(6), built only on measured demand.
- **D7 — Definitions carry the meaning traps.** `definitionLabel`s state each figure's reference moment and scope
  from CBS's own description: benefit recipients **include AOW**, distances are **average road distance over all
  residents**, WOZ is the **assessed** value (distinct from `average_home_sale_price_by_gemeente`, the sale price),
  "hoogopgeleid" is the share with hbo/wo as highest level. Parser `everydayTerms` keep WOZ vs sale price and
  businesses (`bedrijfsvestigingen`) vs `bankruptcies_businesses` apart; the new eval cases include those confusions.

## 4. Invariants at stake

- **Principle (a)/R5:** every value is a stored CBS cell; nothing is computed. Scatter pairs are two stored legs.
- **Principle (c):** ambiguous CBS cells refuse the whole sync (D3); a missing allow-listed code fails loudly (D4);
  an incomplete class never ranks (RS1, unchanged).
- **R8/R9/R11:** audit rows and completeness unchanged. *(Corrected during the build: `70072ned` does NOT carry a
  machine-readable status — every period has `Status: null`; statuses are read from CBS's period notes, fail-closed.
  See ADR 061 decision 4 and plan Task 3a.)*
- **Principle (b):** bulk-ingested; no request-path CBS call.

## 5. Testing

- Part 1: unit tests for `sliceToFilter`/fixture filtering with `measures`; duplicate-cell check (fires on a crafted
  duplicate, silent on every existing fixture); scoped fingerprint (unrelated code added → unchanged; allow-listed
  code removed → `schema_fingerprint` failure; tables without `measures` → identical fingerprint to today);
  `70072ned` fixture registers + syncs hermetically; roster conformance (`GMPV##`) passes on it.
- Part 2: registry/coverage/English-label completeness tests; suggestions picks the mapped partner and falls back;
  hermetic answer tests for a region-set + scatter over a new figure; intent eval (existing 45 + new regional cases,
  zero flips over repeats); benchmark 14/14 + 6/6 + 0 fabricated; `audit:verify` unchanged.

## 6. Open points (marked, mirrored in open-questions)

- ~~Assumption: reference moment of `Bedrijfsvestigingen totaal`~~ — **verified 2026-09-28** from CBS's measure-group
  note: counted **on 1 January**, gemeente borders as of 1 January of that year, **rounded to multiples of 5** (the
  label says so). Also noted there: from 2024 many financial-services businesses were reclassified — affects the
  sector split we do not ingest, not the total.
- **Assumption:** the 12 codes stay single-valued over time — D3 makes a regression fail closed, not silent.
- Household income per gemeente: excluded (D2); revisit if CBS disambiguates the v4 codes.
