# Eurostat in chat, first slice (E2a): country-level answers — design proposal

**Status: APPROVED by the owner 2026-09-23 (session 125): D1, D2, D4, D5, D6 as recommended; D3 approved
with a wording change (see §4.4 — the chip states the source instead of saying "CBS has no figure").
Build steps 1–4 dark on a branch + PR (D6); steps 0/5/6 wait for live spend after the API cap lifts
2026-10-01.** Drafted session 124
(2026-09-23), autonomously, on the owner's "continue working autonomously" steer. This is the design
round ADR [048](../../decisions/048-eurostat-data-source.md) requires before any E2 code ("Not scheduled,
no work-package number, no code"; D2's "own design round"). It is ADR 048's phase E2, cut into a first
slice. Nothing here changes a decision already in ADR 048. Where this document narrows or sequences
something, it says so.

Grounded in two read-only code surveys run this session (every claim below was checked against the files
it cites). Where something could not be verified without live access it is marked **Assumption** and
mirrored in [open-questions #313](../../open-questions.md).

---

## 1. In plain English (for the owner)

**What a reader would get.** Today the chat can only answer about the Netherlands, from CBS. After this
slice, a reader could ask *"Hoe hoog is de werkloosheid in Duitsland?"* or *"Vergelijk de inflatie in
Nederland, België en Frankrijk"* and get a real answer from Eurostat, with the same proof panel, source
line and "every number traceable to a cell" guarantee as a CBS answer.

**How it works, in one paragraph.** We don't build a new pipeline. The reader's question goes through the
same steps as today. Only one thing is new. When the question names a country that CBS doesn't cover (like
Duitsland), the app checks whether we've registered a matching Eurostat figure for the same topic, and
whether that Eurostat table actually contains every place the reader named. If it does, the app **asks**:
*"Voor dit antwoord gebruiken we Eurostat: geharmoniseerde werkloosheid. … [Toon de Eurostat-cijfers]"*
(copy revised by the owner, §4.4),
with a button. It never switches source silently, because ADR 048 already forbids that. Clicking the
button answers from Eurostat. A question only about the Netherlands keeps getting the CBS answer, exactly
as today.

**Why a "slice" and not all of E2 at once.** Full E2 is a multi-session project: the region-taxonomy
redesign for sub-national regions (Bavaria, Flanders, …), English catalog search, a translation layer, the
public-claim rewrite, re-recording AI fixtures. This first slice delivers the differentiator the product
vision names, **cross-country comparison**, while touching as little as possible:
- **Countries only**, no sub-national regions. The Eurostat adapter already keeps only country-level rows
  today, so this is not a new limit.
- **Only for topics we've paired by hand** (unemployment, inflation, …), not an open-ended search of
  Eurostat's 10,000 datasets.
- **Very likely no change to the AI prompts at all.** The AI already writes place names down exactly as
  the reader typed them ("Duitsland"), and plain code does everything after that. That matters for cost:
  a prompt change means paying to re-record every recorded AI answer. **Assumption**, to be measured before
  building on it (§6, step 0).

**What stays owner-controlled.** The moment this becomes visible to real readers is one owner-signed switch,
the same rule ADR 048 set: the public wording changes from "official CBS cell" to "official sources" in the
same change, never before. Everything before that switch can be built "dark", with no reader able to reach
it, and needs no live spending or database changes on production.

**Six decisions only you can make** are in §7, each with my recommendation. The short version: approve the
slice, approve the confirm-button wording, and pick which 3–5 topics to pair first.

---

## 2. Where the product stands today (verified)

- **The adapter exists and is live, but unreachable from chat.** `src/eurostat-adapter/` (E1) is merged;
  migrations 032/033 are applied to production; one real table (`eurostat:tipsbd30`, 532 rows) is registered
  and synced (ADR 048 second as-built addendum). Chat cannot reach it for three independent reasons:
  `chatSelectable: false` (`src/sources/registry.ts:192`), a hard deny filter on `eurostat:` candidates in
  the finder (`src/catalog/recall.ts:107-121`), and the fact that no canonical measure key points at a
  Eurostat table.
- **Eurostat keeps its own region codes, verbatim.** `jsonstat.ts` stores `geo` codes as-is (`DE`, `BE`,
  `EU27_2020`, …) and drops every row not in `EU_EFTA_STAND_IN_GEO_CODES` (`jsonstat.ts:66-77`, `:467-468`):
  27 EU countries + IS/LI/NO/CH + the EU/euro-area aggregates. **So every sub-national (NUTS 1/2/3) row is
  already dropped today; the adapter is country-level only.** This is why a country-only slice needs no
  change to the adapter.
- **Region names resolve against each table's own labels.** `src/answer/intent/resolve.ts:187-203` reads
  `dimension_labels` for the chosen table and matches the reader's words against those labels. For a
  Eurostat table those labels are **English** ("Germany"), so a Dutch "Duitsland" would not match without a
  Dutch name list (§4.2).
- **The query layer is already source-neutral about region codes.** `src/query/resolve.ts:693-699` accepts
  any code present in the table's own `dimension_labels`. There's no prefix check, which is why the internal
  explorer already works against Eurostat tables.
- **Every canonical measure key points at exactly one table** (`src/registry/types.ts`, `CanonicalMeasure`).
  The intent parser picks a KEY from the registry's vocabulary; "werkloosheid" resolves to the CBS key
  `unemployment_rate_seasonally_adjusted`.
- **What happens today** when a reader asks "werkloosheid in Duitsland": the parser picks the CBS key, the
  resolver can't find "Duitsland" in the CBS table's labels, and the reader gets the `region_unknown`
  clarification (*"Welke gemeente of provincie bedoel je precies, of wil je het cijfer voor heel
  Nederland?"*, `src/answer/intent/policy.ts:52-53`). So Duitsland is already handled honestly today, just
  unhelpfully.

---

## 3. The design in one picture

```
question ──► intent parse (UNCHANGED: LLM writes "Duitsland" as written)
          ──► resolve regions against the CBS table's labels
                 all found ──────────────────────────────► CBS answer (UNCHANGED)
                 some not found
                   └─► is there a reviewed Eurostat SIBLING for this measure key,
                       and does ITS table resolve EVERY named place (Dutch names → codes)?
                         no  ──► today's region_unknown clarification (UNCHANGED)
                         yes ──► NEW clarification: "Voor dit antwoord gebruiken we
                                  Eurostat: <definition>. …"  [Toon de Eurostat-cijfers]
                                  (the chip is dry-run verified, like every clarification chip, ADR 024)
                                    click ──► same question, measure pinned to the Eurostat sibling
                                              ──► Eurostat answer, Eurostat attribution + proof
```

One answer, one table, one source. A question naming Nederland **and** Duitsland is answered **entirely**
from Eurostat once the reader confirms (Eurostat has both). It never mixes CBS's Nederland with Eurostat's
Duitsland in one chart, because their definitions differ (CBS's national unemployment rate is not
Eurostat's harmonised one). Mixing sources in one answer is ADR 048's phase E3 ("here are both
readings"), explicitly not this slice.

---

## 4. The pieces

### 4.1 Sibling pairs — a reviewed, code-level list (no database change)

A new code-level map, e.g. `src/sources/eurostat-siblings.ts`:

```ts
/** A CBS canonical measure key → the Eurostat canonical measure key that measures the same concept
 * for other countries. Reviewed by a person per pair (same discipline as PERIOD_CHANGE_ELIGIBLE_KEYS):
 * the Eurostat definition is SHOWN to the reader on the confirm chip, never assumed identical to CBS's. */
export const EUROSTAT_SIBLINGS: Readonly<Record<string, string>> = {
  unemployment_rate_seasonally_adjusted: 'eu_unemployment_rate_harmonised',
  cpi_yearly_inflation: 'eu_hicp_annual_rate',
  // …only pairs a person has reviewed
};
```

**As-built naming (step 5, session 125 continuation):** the reviewed, static content lives in
`EUROSTAT_SIBLINGS_REVIEWED`/`EUROSTAT_SIBLING_MEASURES_REVIEWED`; the RUNTIME-active map every caller
actually falls back to is `activeEurostatSiblings()`, `{}` unless `EUROSTAT_SIBLINGS_ENABLED='1'` — see the
as-built note under §6 step 5 for the full account.

The Eurostat side is a `CanonicalMeasure` (`tableId: 'eurostat:…'`) kept in a **sibling-only list**,
`EUROSTAT_SIBLING_MEASURES_REVIEWED` in `src/sources/eurostat-siblings.ts` — **never** in `src/registry/defaults.ts`
(**corrected session 125**, after the final whole-branch review: a sibling in `CANONICAL_MEASURES` would enter
the intent parser's vocabulary and schema enum, so the parser could answer "werkloosheid in Duitsland" — or
even "…in Nederland" — from Eurostat WITHOUT the reader's click, breaking principle (c), and it would change
the prompt bytes and force a re-record of every fixture). The click trust boundary
(`src/answer/respond/validate-pending.ts`) accepts CBS canonical keys plus sibling keys, validating a
sibling's region codes against the Eurostat country list. The list is applied with `registry:apply` (an owner
step, like every registry change). **Cheapest mechanism first:** a code map instead of a new `canonical_measures` column
means no migration and no live DDL. Promote it to a column only if pairs ever need to be edited without a
deploy.

**The sibling's Eurostat table must be registered with a narrow slice** (countries only, the recent years
readers ask about), because the full datasets are huge (ADR 048: `namq_10_gdp` is 8.2M cells, far above the
500k synchronous cap). **Assumption RESOLVED** (branch `eurostat-server-filter`, merged to `main` before step
5): the adapter's registration DOES request a filtered slice server-side (`src/eurostat-adapter/
statistics-api.ts`'s `buildRequestUrl`, threaded through `registerTables`/`syncTable`) — see #313 for the
two-round fix account.

### 4.2 Dutch country names — a maintained word list, not translation

`src/sources/eurostat-geo-names.ts`: every code in `EU_EFTA_STAND_IN_GEO_CODES` → its Dutch name plus the
common spelling variants readers type (`DE`: Duitsland; `BE`: België, Belgie; `EL`: Griekenland (Eurostat
uses `EL`, not ISO's `GR`); `EU27_2020`: de EU, Europese Unie, EU-27; `EA20`: de eurozone, eurogebied; …).
The ADR 040 word-list precedent: a closed, reviewed list, never machine translation. It is used in two
places:
- **Resolution:** the resolver matches the reader's words against these Dutch names for `eurostat:` tables,
  in addition to the table's own English labels.
- **Display:** the answer and chart say "Duitsland", not "Germany". The same list, so a name that resolves
  always has a Dutch display name.

The list is ~40 entries and is pinned by a test: every code the adapter can emit has a Dutch name.

### 4.3 Resolver changes (deterministic, unit-testable with stubbed parses)

In `src/answer/intent/resolve.ts`:
- **Kind filter becomes source-aware.** Today `kind: 'land'` filters codes by the `NL` prefix
  (`KIND_CODE_PREFIX`, `resolve.ts:40-57`). On a `eurostat:` table, `land` must mean "a country or EU
  aggregate code" instead. Otherwise a model that writes `{ name: "Duitsland", kind: "land" }` would be
  wrongly filtered out. `onbekend` (no filter) already works. The prefix table stays CBS-only; Eurostat gets
  its own predicate keyed on `sourceKeyForTableId`.
- **Sibling check on `region_unknown`.** When a CBS table can't resolve one or more named places, the
  resolver dry-resolves ALL named places against the sibling's table (if any). Only if every place resolves
  does it return the new clarification reason, `other_source_available`, carrying the sibling key and the
  resolved codes. Otherwise it returns today's `region_unknown`, unchanged.
- **Region-set scopes are CBS-only** (`all_provincies`, `all_gemeenten`, …, `src/query/region-set.ts`, keyed
  on CBS `dimension_group` names). They stay CBS-only in this slice. A future "alle EU-landen" scope is a
  separate item.

### 4.4 The confirm chip — reuses the existing clarification machinery

`other_source_available` becomes a clarification with **one** option chip, built with the existing WP26 /
ADR 024 click-to-resolve mechanism and **dry-run verified before it is shown**, like every clarification
chip. That machinery already fits: a click option carries a **fully resolved `StructuredIntent` that was
proven servable by the real query layer at offer time** (`src/answer/intent/types.ts`, the click-option
type), so the chip simply carries the Eurostat-table version of the reader's question. Copy (owner
sign-off, §7 D3):

> Voor dit antwoord gebruiken we Eurostat: *{sibling definitionLabel}*. Eurostat hanteert één definitie
> voor alle landen; die kan afwijken van de CBS-definitie.
> [ Toon de Eurostat-cijfers ]

English interface:

> For this answer we use Eurostat: *{sibling definitionLabel}*. Eurostat uses one definition for every
> country, which can differ from CBS's definition.
> [ Show the Eurostat figures ]

**Owner wording steer (2026-09-23, session 125):** the product is a tool that draws on several sources, so
the chip must not be framed as "CBS doesn't have this figure" (as if the reader had asked CBS). It names
the source the answer will use and keeps the one caveat that matters (definitions can differ). The first
draft ("CBS heeft geen cijfer voor **Duitsland**. Eurostat wel: …") is superseded.

The copy is deterministic template text, not an AI prompt. Changing it costs nothing to re-record.

### 4.5 Answer path — already mostly source-neutral

- **Attribution / proof / citation:** `format.ts:538,550`, `chart/build.ts:194`, `web/lib/citation.ts:32`,
  `statline.ts:21,26`, `stat-card-data.ts:52` already call `resolveSource(<real source>)`. The Eurostat
  source line and DOI (D7) exist.
- **Wiring point 3 (must fix):** `src/answer/compose/template.ts:20,30` and
  `src/answer/respond/refusals.ts:109` call `resolveSource(undefined)`, i.e. they always assume CBS. They
  must thread the result's real source, or a Eurostat cell flagged `p` would get CBS's provisional wording
  (or none).
- **CBS-shaped constants on the answer path** (each needs a source-aware guard, all found by the survey):
  `NATIONAL_REGION_CODE = 'NL01'` (`src/query/resolve.ts:30`, the answer-first default region, which must
  not apply to a Eurostat table); `isNationalCode = code.startsWith('NL')`
  (`src/answer/respond/suggestions.ts:185`); `NATIONAL_TOTAL_GROUP = 'NL'`
  (`src/query/whole-verification.ts:28`, pie/stacked verification, stays CBS-only);
  `NATIONAL_REGION_PREFIX = 'NL'` (`src/ingestion/onboarding-slice.ts:28`, the on-demand onboarding slice,
  not on this slice's path since siblings are pre-registered, but a landmine for later: on a NUTS geo it would
  match every Dutch NUTS level).
- **The `b`-flag precondition (ADR 048 D5b):** a trend (`direction`/`first_last`) across a Eurostat `b`
  (break in series) flag must refuse. **Required in this slice**, because the moment a Eurostat trend can be
  answered, this refusal must already exist.

### 4.6 Explicitly NOT in this slice

Sub-national NUTS regions and the taxonomy widening (ADR 048 D2; its own design round, likely an ADR 011
amendment); English catalog recall and lifting the finder's deny gate (D4, wiring point 2); on-demand
onboarding of Eurostat tables via the cron (wiring point 4); the cross-source verification gate (D8); mixing
sources in one answer (E3); the pattern-discovery track (D10). The finder deny gate **stays in place**. This
slice never goes through the finder; siblings are pre-registered.

---

## 5. Invariants at stake

- **Principle (c) / Amendment 5:** the source switch is always a reader-clicked chip, never automatic.
  Pinned by a test: an unknown-in-CBS, known-in-Eurostat question produces a clarification, never an answer.
- **R7:** the chip is dry-run verified. A chip whose re-run would fail is never shown (existing ADR 024 rule).
- **R10 (one unit per answer):** each sibling table's slice pins `unit` (ADR 048 D6 synthesises one measure
  per unit code).
- **One source per answer:** a region list is resolved against ONE table. A partially-resolvable list never
  answers the resolvable half from one source and the rest from another.
- **Benchmark:** 14/14 + 6/6 + 0 fabricated unchanged, PLUS ≥5 new Eurostat tasks including ≥2 refusals
  (ADR 048 D9), e.g. a country not in the list ("werkloosheid in Japan": refusal, not a guess) and a
  question about a `b`-flagged break.

---

## 6. Build plan (proposed order; each step lands "dark")

0. **Measure before building (no code, small live spend, after the API cap lifts 2026-10-01; owner-
   supervised):** record the intent parse for ~10 real country questions under the **unchanged** prompt
   ("werkloosheid in Duitsland", "inflatie België vs Frankrijk", "EU-gemiddelde", "de eurozone", …).
   Confirms or refutes the "no prompt change" assumption: are names written as typed, which `kind`, and does
   the parser still pick the CBS key? Also verify the adapter can register a filtered slice. **This step
   decides whether the rest of the plan holds.** If the parse is unreliable, the plan grows a prompt change
   and an owner-signed fixture re-record.
1. Dutch geo-name list + resolver source-aware kind predicate + display names (pure code, stub-tested).
2. Sibling map + the `other_source_available` clarification + chip (stub-tested; hermetic fixtures for the
   new benchmark tasks recorded in step 0's session).
3. Wiring point 3 (`resolveSource(undefined)` → real source) + the CBS-constant guards in §4.5.
4. `b`-flag refusal precondition in `src/query/derivations.ts`.
5. Register the first sibling tables (owner step, now mechanical: `npm run eurostat:siblings -- --apply` to
   register + sync the three tables `EUROSTAT_SIBLINGS_REVIEWED`/`EUROSTAT_SIBLING_MEASURES_REVIEWED` already
   hold — not `defaults.ts`, see §4.1 — then `registry:apply`, like E1's `tipsbd30`; docs/RUNBOOK.md "E2a step
   5" has the exact commands).

**As built, session 125 (2026-09-23), merged to `main` as PR #44:** step 5 is now a MECHANICAL
owner step, still fully dark. `src/sources/eurostat-siblings.ts` gained `EUROSTAT_SIBLINGS_REVIEWED` (the
three §7 D4 pairs) and `EUROSTAT_SIBLING_MEASURES_REVIEWED` (their `CanonicalMeasure` entries, from the
sibling-datasets research doc's §4 drafts) — reviewed in the sense that a person picked the dataset/filter/
grain match per pair; the Dutch `definitionLabel` wording is carried over verbatim from the research draft,
**not yet owner-signed** (mirrored in #313 and marked `**Assumption**` inline). The RUNTIME-active map every
caller falls back to (`activeEurostatSiblings()`, one function, consulted by the resolver default, the
offer-side gate and the click trust boundary alike) stays `{}` — empty — unless env `EUROSTAT_SIBLINGS_ENABLED`
is exactly `'1'`; that flip is step 6, unchanged, owner-signed. `src/registry/apply.ts` no longer aborts the
CBS write when a sibling measure's table isn't registered yet — it upserts a sibling measure only once its
table exists, otherwise skips it and reports it in the new `siblingMeasuresSkipped` result field, so the
owner's regular `registry:apply` keeps working exactly as before regardless of how many of the three sibling
tables are registered. A new committed script, `scripts/register-eurostat-siblings.ts` (`npm run
eurostat:siblings`), registers + syncs the three tables through the same `registerTables`/`syncTable` +
`adapterFor('eurostat')` pipeline E1's `tipsbd30` used — dry run by default (prints each table's real request
URL, from the adapter's own `buildRequestUrl`), `--apply` to write. See docs/RUNBOOK.md, "E2a step 5 — register
the Eurostat sibling tables (owner step)" for the exact commands.

**As built, session 125 (2026-09-23), merged to `main` (main CI 35820809111 green incl. deploy):** steps 1–4 done dark (both maps ship empty),
built via subagent-driven development with a review per task and a final whole-branch review. The final
review and its fix wave also: made the chip clickable end to end (it was silently rejected by the click trust
boundary's CBS-shaped code check), made the R11 provisional-marking check source-aware ("(schatting)" etc. for
Eurostat flags), widened the break-in-series refusal to difference and period-change series and to the whole
compared window (a `b` on a year between the two compared years also refuses; combined flags such as `bp`
count), fell back to the original CBS clarification when no chip can be offered (no dead "Voor dit antwoord
gebruiken we Eurostat" text), and fixed answer attribution that always said CBS. It also closed a live latent
gap: on a national-only CBS measure, a foreign place the parser tagged `land` got the Dutch national figure
silently; it now clarifies. The English chip copy in §4.4 is recorded but not built: backend reader text is
Dutch-only by the project convention. One deliberate CBS-side change: with click options enabled, a CBS
chip that the click trust boundary would reject (e.g. for an on-demand-added table) is no longer OFFERED —
before, it was offered and then silently stripped on click, ending in the same reply. Safe direction, same
outcome for the reader, but the stored clarification differs.
6. **The flip (owner-signed, one change):** the public wording sweep ("official sources", `/llms.txt`, the
   coverage disclosure, `/systeemoverzicht`, CLAUDE.md's public-claim line), plus a live owner-supervised smoke
   test, plus the benchmark with the new tasks — and setting env `EUROSTAT_SIBLINGS_ENABLED='1'` in Vercel
   (docs/RUNBOOK.md), which is what actually makes the three reviewed pairs runtime-reachable. Until this step
   no reader can reach any of it: even once step 5 has registered a sibling table and `registry:apply` has
   upserted its measure into `canonical_measures`, `activeEurostatSiblings()` still returns `{}` and no code
   path outside that one function ever consults the row. **Steps 1–5 are buildable now, autonomously, with
   zero spend and zero production change** (step 5's own registration script/`registry:apply` run touch the
   database, but leave the flag unset — an owner-supervised action, not autonomous).

---

## 7. Decisions for the owner (with recommendations)

- **D1: Approve cutting E2 into slices, with this country-level slice first?** *Recommend yes.* It ships the
  cross-country comparison the vision names, and defers the expensive taxonomy redesign until sub-national
  data is actually asked for.
- **D2: Approve "one source per answer"?** When a reader compares Nederland with Duitsland, the whole answer
  comes from Eurostat (after the click), including Nederland's number, even though CBS has its own
  Nederland figure. *Recommend yes.* The alternative (CBS for NL, Eurostat for DE in one chart) compares
  two different definitions without saying so, which is exactly the "guess" principle (c) forbids.
  "Here are both readings" is E3.
- **D3: The confirm-chip wording (§4.4).** **Owner, 2026-09-23: approved with a change — state the source, not "CBS has no figure"; §4.4 now holds the revised copy.** *Original recommendation: as drafted.* It names both sources and warns that the
  definitions may differ. Dutch and English copy are needed, and you sign both off.
- **D4: Which topics to pair first?** *Recommend 3:* unemployment (harmonised rate), inflation (HICP annual
  rate), and GDP growth. They're the most-asked cross-country comparisons, and each has an obvious Eurostat
  counterpart. Population can follow. Each pair is reviewed by a person before it's added (same rule as
  period-change eligibility).
- **D5: Countries in scope.** *Recommend the adapter's existing list:* EU-27 + IS/LI/NO/CH + EU and
  euro-area aggregates. Anything else ("Japan", "de VS") gets an honest refusal (ADR 048 already notes the
  licence exceptions for non-EU country data).
- **D6: Build steps 1–4 dark now, before your sign-off on the flip?** *Recommend yes*, on a branch with a
  PR for your review (autonomous-session rule #118(b)). It's pure code, zero spend and zero production
  change, and it's invisible until the step-5/6 owner steps.

---

## 8. Risks and how the plan handles them

- **The parser might not write foreign place names reliably under today's prompt.** Step 0 measures this
  before any build. If it fails, the fallback is a prompt change inside the owner-signed sweep, which ADR
  048 already planned for.
- **The reader may be surprised that "Nederland" gets a different number than yesterday's CBS answer.** The
  chip copy warns that the definitions differ, the answer's own source line says Eurostat, and D2 is
  asked explicitly.
- **Dataset size.** The sibling tables must be registered as narrow slices (§4.1). Verified in step 0.
- **Eurostat publishes past-data revisions without versioning** (ADR 048 context). The existing
  sync/rebaseline playbook applies. Nothing new in this slice.
