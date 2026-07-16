# Coverage sprint — publication-calendar table set (validated 2026-07-17)

**Context.** Owner-approved strategy [#163](../open-questions.md)(3): ingest the tables behind the most newsworthy monthly
CBS releases, prioritized by the public publication calendar, so the persberichtdag-service ([#160](../open-questions.md)a)
and the chat product cover what journalists actually write about. Candidates were validated by 8 cheap-tier catalog agents
(one per release; every claim measured live against the v3/v4 CBS catalogs on 2026-07-17, method mirrors the ADR-003
checklist used for [07-phase0-table-set.md](../07-phase0-table-set.md)); synthesis and judgment by the session model.

**Already covered by the loaded set (no work needed):** 22/7 huizenprijzen (85773NED — the 22 July generale runs on data we
already have), 31/7 + 11/8 inflatie (86141NED), 30/7 kwartaalbericht arbeidsmarkt (85224NED), 12/8 faillissementen (82242NED).

## The 8 validated gap tables, in calendar-driven build order

| # | Release (2026) | Table | Title (short) | Platform | Conf. | Slice / notes |
|---|---|---|---|---|---|---|
| 1 | Consumentenvertrouwen — 23 jul | `83693NED` | Consumentenvertrouwen; gecorrigeerd | both | 5 | **✅ DONE END-TO-END session 49 (2026-07-17): live in prod, batch 15; record in [11-coverage-table-set.md](../11-coverage-table-set.md).** Tiny (3,864 obs), full ingest, 8 measures. ⚠ session-49 correction: `Consumentenvertrouwen_1` was the v3 COLUMN name — the v4 measure codes the pipeline stores are `M001093`/`D001095`/`M001128`; re-validate every identifier in this table against v4 `MeasureCodes` before writing registry rows (same likely applies to the headline identifiers quoted for tables #2-#8 below). Do NOT conflate with uncorrected sibling 83694NED (vocab overlap resolved, [#165](../open-questions.md)) |
| 2 | BBP flash — 30 jul | `85880NED` | Bbp, productie en bestedingen; kwartalen, mutaties | both | 5 | Slice: top-level aggregates only (skip ~110 detail topics), SoortMutaties A045299 (YoY volume, the headline) + A045300 (QoQ); headline `BrutoBinnenlandsProduct_2` |
| 3 | Producentenprijzen — 30 jul | `85770NED` | PPI; afzet-/invoer-/verbruiksprijzen, 2021=100 | both | 5 | Slice: Afzetgebieden A044074 (totaal) [+ A044077 invoer]; headline `JaarmutatiePPI_3`. ⚠ total-ProdCom code NOT yet verified — confirm before ingestion config |
| 4 | Omzet detailhandel — 3 aug | `85828NED` | Handel en diensten; omzet/productie, 2021=100 | both | 5 | Merged 9-in-1 table — MUST slice: branch 371600 ("47 Detailhandel") + direct subgroups, MONTHLY period keys only; headline `Ongecorrigeerd_4` (omzet YoY) |
| 5 | Consumptie huishoudens — 6 aug | `85937NED` | Consumptieve bestedingen huishoudens; NR, 2021=100 | v3 (v4 unverified) | 4 | Brand-new post-revision table (supersedes 82608NED). Slice: totals + goods/services split, monthly keys only; headline `VolumemutatiesKoopdaggecorrigeerd_3` on A047812 |
| 6 | Internationale handel — 11 aug | `85429NED` | Internationale goederenhandel; grensoverschrijding | both | 5 | Slice: Landen T001047 × SITC T001082 (totaal×totaal, = CBS's own default); headline in-/uitvoerwaarde + jaarmutaties. Methodology break 2020/2021; suppressed cells at fine granularity (not in our slice) |
| 7 | Huizenprijzen regio — 11 aug | `85792NED` | Bestaande koopwoningen; prijsindex 2020=100, regio | v3 (v4 unverified) | 4 | ⚠ SEE CAVEAT below: only NL + 12 provincies + 4 grote gemeenten — no full-gemeente price index exists anywhere |
| 8 | Werkloosheid maand — 20 aug | `80590ned` | Arbeidsdeelname en werkloosheid per maand | **both — ⚠ v4 ONLY under the LOWERCASE id `80590ned` (uppercase 404s; docs/07 quirk #1). The earlier "v3-ONLY" verdict was the casing trap — REFUTED by the 2026-07-17 overnight validation, see [coverage-tables-2-9-measured-specs.md](2026-07-17-coverage-tables-2-9-measured-specs.md)** | 4 | Slice: Geslacht totaal × Leeftijd 15–75, MONTHLY keys only (mixed-grain Perioden trap); headline `Seizoengecorrigeerd_8` (werkloosheidspercentage, = CBS's own default slice) |

## Two load-bearing findings

1. **No full-gemeente house-price index exists in any CBS table** (measured; 85792NED carries only the 4 largest cities +
   provinces; the COROP variant 85819NED has no gemeente level either). The 11 Aug calendar line "Prijzen bestaande
   koopwoningen per gemeente" must be checked against the actual release when it drops — and the lokale hoek
   ([#160](../open-questions.md)b) for house prices likely runs on **`83625NED`** (gemiddelde verkoopprijzen per regio/gemeente,
   yearly, Regulier) instead of a price index — add as candidate #9 after its own metadata validation. Population (03759ned,
   loaded) already has gemeente granularity for lokale-hoek cards today.
2. ~~**80590NED is v3-only**~~ **REFUTED (2026-07-17 overnight validation): v4 serves it under the LOWERCASE id `80590ned`** — the original scout hit docs/07 catalog quirk #1 (uppercase lookups 404/return empty for old lowercase tables). ADR-003's v3 path stays un-needed. Original claim kept for the record: it was said to break [07-phase0-table-set.md](../07-phase0-table-set.md)'s "OData v4 alone suffices"
   conclusion for the first time. ADR [003](../decisions/003-cbs-access-layer.md) budgeted a v3 fallback path that was never
   needed; building table #8 requires it (an adapter work item, not a redesign).

## Route & invariants

- **Curated onboarding per [how-to-add-a-source.md](../how-to-add-a-source.md)** (registry rows, reviewed slices, aliases,
  fixtures) — NOT the WP16 on-demand fit-gate; a deliberate sprint deserves deterministic, reviewed slices.
- **Session-49 finding ([#164](../open-questions.md)): every vocabulary (aliases) addition invalidates ALL ~93 intent/followup/clarify/delivery
  LLM replay fixtures at once** (prompt-hash design, ADR 012) → each build session groups its tables into ONE vocab change + ONE re-record
  (`intent:record`/`followup:record`/`clarify:record`/`onboarding-delivery:record`, Haiku-tier, sub-euro) + eval-verify (table-#1 template: 63/63 ×3 stable).
- Mixed-grain `Perioden` dimensions (80590NED, 85828NED, 85937NED, 85880NED) must be filtered by key pattern at ingestion —
  never ingest month+quarter+year rows into one undifferentiated column.
- Base-year/methodology breaks (2021=100 rebases on PPI/detailhandel/consumptie; intl-trade break 2020/2021) must land in
  registry notes so refusal/trend-break handling stays honest (R11; relates to [#26](../open-questions.md)).
- Open verification points before build: (a) PPI total-ProdCom code; (b) v4 availability of 85937NED/85792NED; (c) 84106NED
  supersession cross-check (85880NED's own prose was the only source); (d) 83625NED metadata validation (candidate #9).

**First build target: table #1 (`83693NED`) — smallest, both-platform, and its next release is 23 July: done before that
date, the second persberichtdag has product-backed data on day one.**
