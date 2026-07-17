# WP30c dossier — the first second source: rijksfinancien.nl vs data.politie.nl vs wait (owner-beslismemo)

**Written by the Fable overnight design marathon (2026-07-18→19), phase 5.** Everything in §1–§2 was measured with
live, read-only calls this night (the docs/07/11 discipline: no claim without a call; UNVERIFIED items are marked).
**This memo makes NO decision** — WP30c is and stays the owner's choice ("eerst doorgaan met CBS", 2026-07-08,
unchanged). Its job is to make the choice small: per option the measured facts, the adapter delta against the ADR
[030](../decisions/030-multi-source-architecture.md) seams, the first-table candidates, the benchmark-extension form,
and the effort/spend shape.

---

## 1. Measured: rijksfinancien.nl (MinFin — owner-proposed, sparring 18-07)

**Access (verified live):** three layers. (a) A real OpenAPI 3.1 REST service (`/swagger.json` 200):
`/open-data/api/json/budgettaire_tabellen?year=&phase=&chapter=…` (+ `/csv/`) and
`/open-data/api/json/v2/financiele_instrumenten` (the "Wie ontvingen" subsidy recipients). (b) Static per-year
per-phase bulk files (`Budgettaire_Tabellen_{year}_{OWB|O1|O2|JV|SBS}_{incl|excl}.{csv|json|ods|xlsx}` — verified
200, 2.75 MB for 2023 JV). (c) data.overheid.nl is only a discovery layer over the same files. **License: CC0**
(verified on `/copyright` + the API docs page). No auth, no rate limits observed, CORS `*`.

**The product-defining fact, verified with real numbers:** the phase dimension IS the begroot≠uitgegeven story.
Defensie (hoofdstuk X), uitgaven, 2023: **OWB (Prinsjesdag) 8.140.313 vs JV (realisatie) 9.637.811** (× €1.000) —
an 18% gap in one measured pair. The static JV file even carries the three-way story per row: `StandVB` (bijgestelde
begroting) 1.472.925 vs `Realisatie` 1.142.595 vs `Verschil` −330.330 for one Defensie-artikel — overspend against
the ORIGINAL plan and underspend against the ADJUSTED ceiling, simultaneously. Exactly the definitional trap the
sparring called "onze kracht", present in the source's own schema (`StandOWB/StandO1/StandVB/Realisatie/Verschil`).

**Cadence (verified from site text + live data):** OWB = Prinsjesdag (3e dinsdag sept), vastgestelde begroting < 31
dec, 1e suppletoire < 1 juni, 2e suppletoire < 1 dec, JV = Verantwoordingsdag (~mei). `year=2026&phase=OWB` and
`year=2025&phase=JV` both already populated. Effectively **annual-with-moments** — a few news-peak days per year.

**Measured gotchas (each one is design input, not a dealbreaker):**
1. **Live-API phase-filter bug:** `phase=O1`/`O2` silently returns the UNION of OWB+JV rows (verified across three
   years by record-count equality); genuine suppletoire figures exist only in the static files. → ingest from the
   static files, not the query API.
2. **The live API is slow and truncation-prone:** unfiltered year queries measured 43–57s; a 30s-timeout curl
   truncated mid-JSON twice. Also: empty result sets return HTTP **404**, not `200 []`.
3. **Identifiers are NOT year-stable below chapter level:** article renumbering is real and self-documented — the
   downloaded `Conversietabellen_compleet.xlsx` maps was→wordt per year (measured example: artikel 6.37 "Migratie"
   ends 2024, 20.37 "Asiel en Migratie" begins 2025). Lowest-level `regeling_detailniveau_nummer` looks like a
   per-load database key (same regeling: 440230 in 2022, 538885 in 2023) — never join across years on it.
4. **Units differ per dataset family:** `budgettaire_tabellen.bedrag` is ×€1.000; `financiele_instrumenten.amount`
   is whole euros. A naive cross-join is off by 1000×.
5. **`_incl` vs `_excl` file variants are not documented and not a clean super/subset** (measured: 202 rows only in
   incl, 24 only in excl) — must be resolved with MinFin docs or a conservative pick before ingest.
6. One linked multi-year bulk file (`Begrotingsstaten_2013-2025.*`) is currently **404 on all four formats**;
   per-year files are the reliable surface. HGIS: no dedicated open dataset found (not confirmed absent).
7. Recipient data is partly pre-anonymized ("Geanonimiseerde ontvanger(s)…") — fine for us (aggregates), noted for
   expectations.

## 2. Measured: data.politie.nl (the standing session-30 recommendation, sparring-reinforced)

**The infrastructure hypothesis is CONFIRMED:** politie data is served from CBS's own "StatLine voor derden"
platform — `dataderden.cbs.nl`, a separate IIS app running the **same OData v3 engine** as classic StatLine; the
police's own FAQ says CBS built the portal. It does NOT exist on the v4 host (verified: `datasets.cbs.nl/odata/v1/`
has exactly one catalog, CBS). **License: CC0** (verified in the FAQ) — note: NOT CC-BY like CBS itself.

**Catalog (verified live):** `ODataCatalog/Tables?$filter=Catalog eq 'Politie'` → exactly **12 tables**: misdrijven
per gemeente/maand (`47013NED`, 4,16M rows), per plaats (27,8M), per wijk/buurt maand (`47022NED`, **189,9M rows**)
en jaar (15,3M), overlast per gemeente (634K) en wijk/buurt (31,3M), reactietijden Prio-1 (64K), HRM/landelijke
indicatoren (tiny), 2 discontinued predecessors. Monthly tables update ~the 15th (verified: `Modified: 2026-07-15`,
"cijfers over juni 2026 toegevoegd… 15 augustus juli").

**Compatibility, measured against our adapter:** period codes are **byte-identical CBS grammar** (`2012MM01` …
`2026MM06`, `JJ00` aggregates — conformance family F2 passes by construction); `RegioS` is a real `GeoDimension`
with `NL/LD/PV/GM` codes **plus `RE` (10 politie-eenheden)**; the same trailing-space padding quirk as CBS
`03759ned`; all statuses `Definitief`. The measured delta list vs `odata-v4.ts`: v3 resource names
(`TableInfos`/`DataProperties`/`TypedDataSet`), `$format=json` required, the **ODataApi/ODataFeed split** (`$skip`
only works on ODataFeed — verified at offset 500.000), the classic **10.000-row cap** per request, a new dimension
kind **`GeoDetail`** on the wijk/buurt tables (not in our allowlist), and catalog metadata whose self-referential
URLs point at an unresolvable internal host (`dataderden.prod.cbsp.nl` — hardcode the public host). IPv6: same CBS
CNAME family → the existing `force-ipv4.mjs` preload covers it. No rate limits observed.

## 3. The ADR-030 seam map — what each option must build, what the harness already enforces

The waist is live and proven (WP30a/b, PRs #26/#27): source registry (`src/sources/registry.ts`), prefixed table
ids + migration 016, `adapterFor` routing at the fetch seams, the conformance harness F0–F5
(`src/sources/conformance.ts`), and `docs/how-to-add-a-source.md` with the verified WP30c wiring points (catalog
prune scope, finder language filter, compose `resolveSource`, cron-route adapter, region-taxonomy family, A4 prompt
sweep). Both candidates ship with the owner-signed public-claim wording change (CLAUDE.md + meta template + UI
sweep) per ADR 030 — and both being **CC0** needs one wording nuance: attribution is not legally required, we show
source+date anyway (the claim is ours, not the license's).

| Seam | politie (`politie:` prefix) | rijksfinancien (`minfin:` prefix) |
|---|---|---|
| Adapter shape | **v3 sibling of the existing adapter** (the ADR 003 v3-fallback contingency, finally applied): TypedDataSet paging via ODataFeed, `$format=json`, fixed-width padding handling — protocol work, but the same fetch-schema/codes/observations contract | **File-ingest adapter** (a new shape): fetch static per-year-per-phase JSON files, parse wide rows into observations — simpler transport, more mapping logic |
| Period grammar (F2) | **zero pain** — byte-identical codes | year-shaped (`JJ` only) — trivial mapping; the *phase* is NOT a period |
| New modeling decision | `GeoDetail` kind + `RE` region family: v1 proposal = exclude wijk/buurt tables and refuse `RE`-level asks (out-of-scope refusal), revisit later | **the phase/vuo dimensions**: OWB/O1/O2/JV and V/U/O become ordinary `dims` — crucially, phases are DIFFERENT FACTS, not revisions: never let a JV value "correct" an OWB value; the clarify layer must ask which phase when a question is ambiguous ("hoeveel gaf X uit" → JV; "hoeveel was begroot" → OWB) |
| Statuses (F3) | all `Definitief` observed — trivial map | no CBS-style lifecycle; propose `Definitief` for all phases (each phase-fact is final once published) |
| Table identity (D4) | native ids stable (`47013NED`), succession via new ids — CBS-identical | **the real design work**: no native table ids; propose one logical id per dataset family (`minfin:budgettaire_tabellen`) with year+phase as dims, plus the Conversietabellen was→wordt map as registry data so cross-year article questions either translate or honestly refuse |
| First pain (the brief's question) | protocol-level v3 work; everything semantic is home turf | identity + phase semantics + no code lists (labels are the vocabulary) + the §1 gotchas |
| Size/slices | slice-and-register from day one (the 03759ned playbook); start far from the 190M-row tables | small files (MBs); no slicing needed |
| Strategic reuse | the v3 adapter unlocks the whole dataderden platform (812 catalog entries across organizations) for LATER sources on the same code | the file-ingest shape generalizes to other file-publishing ministries |

## 4. First-table candidates + benchmark-extension form (per option)

**Benchmark form (both options, the CC-pattern):** a per-source sibling of `benchmark/coverage-key.json` —
`benchmark/politie-key.json` ("PC1…") / `benchmark/minfin-key.json` ("RF1…") — scored by an analogous hermetic test,
2–4 frozen keys per table, "never edited to green", every value cross-verified via **two independent reads** before
freezing (politie: ODataApi + ODataFeed; minfin: live query API + static file — both pairs verified usable tonight),
plus one refusal pin per source (politie: an `RE`/wijk-grain ask; minfin: a phase-ambiguous ask that must clarify).

- **Politie first tables:** `47013NED` (misdrijven soort/gemeente/maand, 4,16M — slice to totalen + gemeente grain),
  `47021NED` (overlast gemeente/maand, 634K), optionally `47008NED` (reactietijd Prio-1, 64K, a distinctive stat).
  Vocabulary: inbraak/diefstal/geweld/overlast-classes → the s23 audit's out-of-coverage refusals (A070 criminaliteit,
  A079 inbraken) become answerable. RF-keys example shape: "geregistreerde misdrijven Amsterdam juni 2026" = one
  cell, v3-cross-verified.
- **Rijksfinancien first tables:** `minfin:budgettaire_tabellen` from the static JV + OWB files, 2–3 recent years,
  hoofdstuk+artikel level, uitgaven/verplichtingen/ontvangsten (`vuo`) + fase dims; the verified Defensie pair is
  the natural first frozen key. `financiele_instrumenten` (Wie ontvingen) as a SECOND step (different unit — whole
  euros — and different shape; keep it out of v1 to avoid the 1000×-trap in one WP).
- **Cheap complement worth one check regardless of choice (UNVERIFIED):** data.overheid lists a CBS-hosted
  "Rijksfinanciën; 1900-2018" historical series — if that is an ordinary StatLine table, a slice of the begroting
  TOPIC could ship through the EXISTING CBS pipeline without WP30c. Verify its table id before the owner call.

## 5. Effort, spend, and the constraint that binds either choice

- **Politie:** ~2–3 sessions (v3 adapter + conformance manifest + 2 tables end-to-end + vocab + PC-keys + claim
  sweep). LLM spend: vocab additions trigger the **#164 one-batch re-record** (~€2/ronde, budget ~€4–6) + finder
  fixture impact (`--catalog-add` lesson s53 — schedule the finder re-record in the same owner window).
- **Rijksfinancien:** ~3–4 sessions (identity/phase design + file adapter + conformance + vocab + RF-keys + claim
  sweep + the incl/excl resolution). Same #164 constraint; extra: the clarify-policy work for phase-ambiguity is
  answer-pipeline-adjacent (small WP26 kinship).
- **Wait:** €0; the seams are proven open (that was the owner's requirement — "niet dichtgemetseld"); the cost is
  strategic only (public claim stays CBS-only; the sparring's competitive angles — veiligheid traffic, follow-the-
  money — stay unexploited).

## 6. The decision, framed small (owner picks; no recommendation is a decision here)

1. **Politie now** — smallest measured delta, home-turf semantics, monthly news rhythm, regional grain our pipeline
   already loves, veiligheid = the measured NiB traffic magnet; buys the whole dataderden platform for later.
2. **Rijksfinancien now** — unique content no one else makes checkable (the verified 18% Defensie gap is a
   ready-made launch demo), Prinsjesdag/Verantwoordingsdag peaks, CC0; costs the identity/phase design and touches
   clarify policy; annual cadence means low maintenance between moments.
3. **Wait** — CBS-first stands; revisit at a natural moment (e.g. post-WP26, or before Prinsjesdag 2026-09-15 if
   option 2 tempts — that date is the content deadline for a rijksfinancien launch with fresh OWB data).
4. **Sequenced both** — politie first (protocol work, fastest win), rijksfinancien second (content work), reusing
   the per-source key pattern; the sparring's cross-source demo ("uitgaven per leerling", #103) needs rijksfinancien
   PLUS existing CBS — it activates whenever option 2 lands, in either order.

Open questions mirrored: the `_incl`/`_excl` semantics (§1.5, UNVERIFIED), HGIS availability (§1.6, not found), the
CBS-hosted historical series id (§4, UNVERIFIED), the `RE`-region refusal wording (politie v1), and the phase-clarify
copy (minfin v1) — all owner-visible at the WP30c kickoff, none blocking this memo.
