# Regional statistics, Part 2 (the 12 figures become answerable) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 12 `70072ned` figures (loaded by Part 1's code) answerable: canonical figures + regional flag + English labels + a curated scatter partner per figure + question-reader test cases — built on a branch now at zero AI cost; the paid re-recording, merge and prod load happen with the owner after 2026-10-01.

**Architecture:** Registry-only additions (`CANONICAL_MEASURES`, `AVAILABLE_GRAINS`, `REGIONAL_KEYS`) plus their CI-enforced English siblings; a small curated partner map in `suggestions.ts` replaces "first servable in registry order" for the scatter chip; new labelled intent cases. Adding canonical figures changes the intent prompt's bytes and JSON-schema enum, so every recorded intent/clarify/followup fixture misses its hash until re-recorded — that is why this branch is NOT merged before the recording session.

**Tech Stack:** TypeScript, vitest, PGlite, Anthropic API (recording step only, cheap tier).

**Spec:** [docs/superpowers/specs/2026-09-28-regional-statistics-design.md](../specs/2026-09-28-regional-statistics-design.md) (D5–D7) and ADR [061](../../decisions/061-regional-statistics-70072ned.md).

## Global Constraints

- Branch `regional-stats-part2` from `main`. Never merged, pushed to `main`, or recorded against the live API by an implementer — Task 5 is the controller's, owner present, after 2026-10-01.
- **Known-red until Task 5:** every test that REPLAYS recorded intent/clarify/followup LLM fixtures (they are keyed on a hash of the whole prompt + schema). Implementers run only the suites named in their task; they never delete, edit or regenerate files under `tests/fixtures/llm/`.
- The 12 keys, table, CBS codes — verbatim:

| key | CBS code | measureTitle (CBS, verbatim) |
|---|---|---|
| `population_density` | `M000100` | `Bevolkingsdichtheid` |
| `average_woz_value` | `M003039` | `Gemiddelde WOZ-waarde van woningen` |
| `owner_occupied_homes_share` | `1014800` | `Koopwoningen` |
| `highly_educated_share` | `2018790` | `Hbo, wo` |
| `passenger_cars_per_1000_residents` | `A018943_2` | `Personenauto's, relatief` |
| `distance_to_train_station` | `X092783` | `Afstand tot treinstation` |
| `population_growth_per_1000` | `M000101_3` | `Bevolkingsgroei, relatief` |
| `average_household_size` | `M000114` | `Gemiddelde huishoudensgrootte` |
| `single_person_households_share` | `1050015_2` | `Eenpersoonshuishoudens` |
| `business_establishments` | `M000200_2` | `Bedrijfsvestigingen totaal` |
| `benefit_recipients_total` | `X033647` | `Uitkeringsontvangers, totaal` |
| `distance_to_large_supermarket` | `D000025` | `Afstand tot grote supermarkt` |

  (Before using a measureTitle, confirm it equals the `Title` of that code in `tests/fixtures/cbs/70072ned/measure-codes.json`; if CBS's title differs, use CBS's exactly and note it.)
- All 12: `tableId: '70072ned'`, `dims: {}`, grains `['JJ']`, regional.
- Meaning traps the labels must carry (spec D7): benefit recipients INCLUDE AOW; distances are the average ROAD distance over ALL residents; WOZ is the municipal tax VALUATION, not a sale price; businesses are counted on 1 January, rounded to multiples of five; "hoogopgeleid" = hbo or wo as highest completed level.
- English entries are hand-written meaning-for-meaning (never machine translation); a digit appears in English ONLY where the Dutch label has one.
- 8 GB machine: one foreground vitest at a time. No `.env`, no live DB, no LLM calls.

---

### Task 1: Registry entries, regional flag, English siblings

**Files:**
- Modify: `src/registry/defaults.ts` (append 12 entries to `CANONICAL_MEASURES`, after `average_home_sale_price_by_gemeente`)
- Modify: `src/answer/intent/prompt.ts` (`AVAILABLE_GRAINS` ~line 71-114: 12 × `['JJ']`; `REGIONAL_KEYS` line ~120: add the 12 keys)
- Modify: `src/answer/respond/english-measure-labels.ts` (both maps)
- Modify: `src/registry/english-names.data.ts` (`HAND_MEASURE_TITLES` / `UNITS` only if the tests below demand it)
- Test: `tests/registry/`, `tests/answer/english-helpers.test.ts`, `tests/registry/english-names-data.test.ts`, new `tests/registry/regional-figures.test.ts`

**Interfaces:** Produces the 12 canonical keys (Global Constraints table) — Tasks 2–4 use them verbatim.

- [ ] **Step 1: Failing test** — `tests/registry/regional-figures.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';
import { REGIONAL_KEYS } from '../../src/answer/intent/prompt.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';

const EXPECTED: Record<string, string> = {
  population_density: 'M000100',
  average_woz_value: 'M003039',
  owner_occupied_homes_share: '1014800',
  highly_educated_share: '2018790',
  passenger_cars_per_1000_residents: 'A018943_2',
  distance_to_train_station: 'X092783',
  population_growth_per_1000: 'M000101_3',
  average_household_size: 'M000114',
  single_person_households_share: '1050015_2',
  business_establishments: 'M000200_2',
  benefit_recipients_total: 'X033647',
  distance_to_large_supermarket: 'D000025',
};

describe('ADR 061 Part 2 — the 12 regional figures', () => {
  it('each key maps to its 70072ned code, has no dims, and is regional', () => {
    for (const [key, code] of Object.entries(EXPECTED)) {
      const m = CANONICAL_MEASURES.find((c) => c.key === key);
      expect(m, key).toBeDefined();
      expect(m!.tableId).toBe('70072ned');
      expect(m!.measure).toBe(code);
      expect(m!.dims).toEqual({});
      expect(REGIONAL_KEYS.has(key), key).toBe(true);
    }
  });

  it('serves exactly the seed allow-list — no figure the period-note map was not reviewed for', () => {
    const seed = SEED_TABLES.find((t) => t.id === '70072ned');
    expect([...Object.values(EXPECTED)].sort()).toEqual([...(seed?.slice?.measures ?? [])].sort());
  });

  it('carries the meaning traps in the Dutch definition labels', () => {
    const label = (k: string) => CANONICAL_MEASURES.find((c) => c.key === k)!.definitionLabel;
    expect(label('benefit_recipients_total')).toMatch(/AOW/);
    expect(label('average_woz_value')).toMatch(/niet de verkoopprijs/);
    expect(label('distance_to_train_station')).toMatch(/over de weg/);
    expect(label('business_establishments')).toMatch(/1 januari/);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/registry/regional-figures.test.ts` → FAIL.
- [ ] **Step 3: Implement** — append to `CANONICAL_MEASURES` (shape of the `average_home_sale_price_by_gemeente` entry; `measureTitle` per Global Constraints):

| key | definitionLabel (Dutch, verbatim) | everydayTerms | notes |
|---|---|---|---|
| population_density | `bevolkingsdichtheid: inwoners op 1 januari per km² land, per gemeente/provincie (jaarcijfer)` | `['bevolkingsdichtheid', 'inwoners per km2', 'hoe dichtbevolkt']` | `Regionale kerncijfers (70072ned). Niet hetzelfde als het aantal inwoners (population_on_1_january).` |
| average_woz_value | `gemiddelde WOZ-waarde van woningen: de door de gemeente vastgestelde waarde voor de belastingen, niet de verkoopprijs; per gemeente/provincie (jaarcijfer)` | `['WOZ-waarde', 'gemiddelde WOZ-waarde', 'WOZ']` | `De verkoopprijs per gemeente is average_home_sale_price_by_gemeente (83625NED); kies deze key alleen bij WOZ.` |
| owner_occupied_homes_share | `aandeel koopwoningen in de woningvoorraad (%), per gemeente/provincie (jaarcijfer)` | `['koopwoningen', 'percentage koopwoningen', 'aandeel koopwoningen']` | — |
| highly_educated_share | `aandeel inwoners met hbo of wo als hoogst behaalde opleiding (%), per gemeente/provincie (jaarcijfer)` | `['hoogopgeleid', 'hoger opgeleiden', 'hbo of wo']` | — |
| passenger_cars_per_1000_residents | `personenauto's per 1 000 inwoners, per gemeente/provincie (jaarcijfer)` | `['autobezit', "auto's per inwoner", "personenauto's per inwoner"]` | — |
| distance_to_train_station | `gemiddelde afstand over de weg van alle inwoners tot het dichtstbijzijnde treinstation (km), per gemeente/provincie (jaarcijfer)` | `['afstand tot treinstation', 'afstand tot het station']` | — |
| population_growth_per_1000 | `bevolkingsgroei per 1 000 inwoners (per duizend van de beginbevolking op 1 januari), per gemeente/provincie (jaarcijfer)` | `['bevolkingsgroei', 'groei van de bevolking']` | — |
| average_household_size | `gemiddelde huishoudensgrootte: personen per particulier huishouden, per gemeente/provincie (jaarcijfer)` | `['huishoudensgrootte', 'gemiddeld aantal personen per huishouden']` | — |
| single_person_households_share | `aandeel eenpersoonshuishoudens in alle particuliere huishoudens (%), per gemeente/provincie (jaarcijfer)` | `['eenpersoonshuishoudens', 'aandeel eenpersoonshuishoudens']` | — |
| business_establishments | `aantal bedrijfsvestigingen op 1 januari (afgerond op vijftallen), per gemeente/provincie` | `['bedrijfsvestigingen', 'aantal bedrijven', 'vestigingen van bedrijven']` | `Niet het aantal faillissementen (bankruptcies_businesses).` |
| benefit_recipients_total | `aantal personen met een uitkering (WW, bijstand, arbeidsongeschiktheid én AOW), per gemeente/provincie (jaarcijfer)` | `['uitkeringsontvangers', 'mensen met een uitkering']` | `Inclusief AOW: grotendeels gepensioneerden, geen maat voor werkloosheid.` |
| distance_to_large_supermarket | `gemiddelde afstand over de weg van alle inwoners tot de dichtstbijzijnde grote supermarkt (km), per gemeente/provincie (jaarcijfer)` | `['afstand tot supermarkt', 'afstand tot de supermarkt']` | `Niet de omzet van supermarkten (supermarket_turnover_yoy).` |

  Rows marked "—" have no `notes`. Add the 12 keys to `AVAILABLE_GRAINS` (`['JJ']`) and to `REGIONAL_KEYS`. English maps:

| key | ENGLISH_MEASURE_LABELS | ENGLISH_TOPIC_TERMS |
|---|---|---|
| population_density | `population density: residents on 1 January per km² of land` | `population density` |
| average_woz_value | `the average WOZ value of homes (the municipal valuation for tax purposes, not the sale price)` | `WOZ home values` |
| owner_occupied_homes_share | `the share of owner-occupied homes in the housing stock` | `owner-occupied homes` |
| highly_educated_share | `the share of people whose highest completed education is higher professional or university level (hbo/wo)` | `highly educated residents` |
| passenger_cars_per_1000_residents | `passenger cars per 1 000 residents` | `car ownership` |
| distance_to_train_station | `the average road distance from all residents to the nearest train station` | `distance to a train station` |
| population_growth_per_1000 | `population growth per 1 000 residents` | `population growth` |
| average_household_size | `the average household size (persons per private household)` | `household size` |
| single_person_households_share | `the share of single-person households among private households` | `single-person households` |
| business_establishments | `the number of business establishments on 1 January (rounded to multiples of five)` | `business establishments` |
| benefit_recipients_total | `the number of people receiving a benefit (unemployment, social assistance, disability and state pension)` | `benefit recipients` |
| distance_to_large_supermarket | `the average road distance from all residents to the nearest large supermarket` | `distance to a supermarket` |

  (Digit rule: "1 000" appears in English only where the Dutch label has it; "1 January" likewise; check the file's own convention for the thousands separator in labels and follow it.)
- [ ] **Step 4:** run `npx vitest run tests/registry`, then `npx vitest run tests/answer/english-helpers.test.ts`. If `tests/registry/english-names-data.test.ts` reports missing English measure titles or units for these codes, add hand-written entries to `HAND_MEASURE_TITLES` / `UNITS` following that file's rules (and `CURATED` if its test demands it) — the English title mirrors the CBS Dutch title (e.g. `Bevolkingsdichtheid` → `Population density`, `Hbo, wo` → `Higher professional or university education (hbo, wo)`); for units CBS writes like `aantal inwoners per km²`, `per 1 000 inwoners`, `km`, `personen per 1 huishouden`, `aantal`, `%`, `1 000 euro` (already present) follow the file's existing unit entries. Then `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(registry): the 12 regional figures from 70072ned — canonical keys, regional flag, English siblings (ADR 061 part 2)`.

---

### Task 2: Deterministic rendering of each figure (verification-first)

**Files:** Test: new `tests/answer/regional-figures-render.test.ts`. Modify only if a test exposes a real gap: the answer formatter / unit handling (e.g. `src/answer/compose/format.ts`) — report any such gap before "fixing" it in a way that changes existing outputs.

- [ ] **Step 1:** Using `createIngestedDb()` (the shared fixture DB, which already contains `70072ned` 2024+), for EACH of the 12 keys: build the ADR 054 region-set intent `{ schemaVersion: 1, target: { kind: 'canonical', key }, regionSet: { kind: 'all_provincies' }, period: { kind: 'codes', codes: ['2024JJ00'] }, derivation: 'none' }` (use `2026JJ00` for `business_establishments` only if 2024 is absent in the fixture — check), run it through the same query + template path the existing region-set tests use (find them: `grep -rln "all_provincies" tests/answer tests/query`), and assert: the answer is not a refusal; 12 provinces are listed; each value in the body matches the DB cell formatted the way existing region-set tests assert; provisional cells carry the provisional marking (R11) — e.g. `average_woz_value` 2024 is `NaderVoorlopig`, `population_density` 2024 is `Definitief`; the definition line contains the key's `definitionLabel` text.
- [ ] **Step 2:** One single-region case per key through the TEMPLATE compose path (`templateOnly: true`, as existing template tests do) for Amsterdam (`GM0363`) 2025 where present, asserting value + unit rendering. Pinned values (fixture, measured 2026-09-28): `population_density` 4968, `average_woz_value` 518 (unit 1 000 euro), `passenger_cars_per_1000_residents` 287, `distance_to_train_station` 2.8.
- [ ] **Step 3:** Run `npx vitest run tests/answer/regional-figures-render.test.ts`; any failure that is a formatter/unit gap → fix minimally with a test, report it clearly; any failure that looks like a data problem → STOP and report.
- [ ] **Step 4:** Commit `test(answer): the 12 regional figures render deterministically with units and R11 marking (ADR 061 part 2)`.

---

### Task 3: Curated scatter partner per figure (spec D6)

**Files:** Modify `src/answer/respond/suggestions.ts` (`plotAgainst`, ~line 569-599); Test: `tests/answer/suggestions.test.ts` (or the file holding the existing plotAgainst tests — `grep -rln plotAgainst tests`).

**Interfaces:** Produces `SCATTER_PARTNERS: Readonly<Record<string, readonly string[]>>` (exported for tests) in `suggestions.ts`.

- [ ] **Step 1:** Add, above `plotAgainst`:

```ts
/** ADR 061 part 2 (spec D6): each regional figure's natural "Zet af tegen"
 * partner(s), in preference order — counts pair with population, rates /
 * averages / distances with population density, density with the average
 * WOZ value. plotAgainst tries these first, then falls back to every other
 * REGIONAL_KEYS member in registry order, so a partner not servable for the
 * answered year never leaves the chip out when another pair works. */
export const SCATTER_PARTNERS: Readonly<Record<string, readonly string[]>> = {
  population_on_1_january: ['population_density'],
  business_establishments: ['population_on_1_january'],
  benefit_recipients_total: ['population_on_1_january'],
  population_density: ['average_woz_value'],
  average_woz_value: ['population_density'],
  average_home_sale_price_by_gemeente: ['population_density'],
  owner_occupied_homes_share: ['population_density'],
  highly_educated_share: ['population_density'],
  passenger_cars_per_1000_residents: ['population_density'],
  distance_to_train_station: ['population_density'],
  population_growth_per_1000: ['population_density'],
  average_household_size: ['population_density'],
  single_person_households_share: ['population_density'],
  distance_to_large_supermarket: ['population_density'],
};
```

  and change `plotAgainst`'s loop to iterate candidates in this order: `SCATTER_PARTNERS[resolved.target.key] ?? []` first, then the rest of `ctx.registry` (registry order), skipping duplicates, the target itself and non-`REGIONAL_KEYS` members; keep every existing check (`pairIntentProblem`, `servableAndTakeable`) per candidate. Update the doc comment above `plotAgainst` ("today exactly one…" is now stale).
- [ ] **Step 2: Tests** — (a) every key in `SCATTER_PARTNERS` and every listed partner is a `REGIONAL_KEYS` member and differs from its key; every `REGIONAL_KEYS` member has an entry; (b) on the fixture DB, a `population_density` all_provincies 2024 answer offers "Zet af tegen gemiddelde WOZ-waarde van woningen" (label = lowercased measureTitle, per the existing label rule); (c) fallback: stub/choose a target whose preferred partner is not servable for the year (e.g. a year the partner lacks in the fixture) and assert the chip names the next servable member instead of disappearing. Keep the existing plotAgainst tests passing (the population ↔ home-price test will now expect `population_density` first — update it and say so in the report).
- [ ] **Step 3:** `npx vitest run <that test file>`, then `npx vitest run tests/answer/suggestions.test.ts tests/answer/comparison-chips.test.ts tests/answer/wp29-click-take.test.ts`, `npx tsc --noEmit`. Commit `feat(chips): curated scatter partner per regional figure (ADR 061 part 2, spec D6)`.

---

### Task 4: Question-reader labelled cases (recorded in Task 5)

**Files:** Modify `benchmark/intent-labelled-set.json` (append to `cases`).

- [ ] **Step 1:** Append these cases (same shape as existing `variant` / `region_set` cases; `expect.intent` with `schemaVersion: 1`, `derivation: 'none'`; single-region cases name the region the way existing gemeente cases do — copy their `regions` shape exactly):
  1. `rf-dichtheid-amsterdam-2025` variant — "Wat was de bevolkingsdichtheid van Amsterdam in 2025?" → `population_density`, Amsterdam, `2025JJ00`.
  2. `rf-woz-utrecht-2024` variant — "Wat was de gemiddelde WOZ-waarde in Utrecht (gemeente) in 2024?" → `average_woz_value`, gemeente Utrecht, `2024JJ00`.
  3. `rf-woz-vs-verkoopprijs` variant — "Wat was de gemiddelde verkoopprijs van een woning in Utrecht (gemeente) in 2024?" → `average_home_sale_price_by_gemeente` (guard: sale price must NOT become WOZ).
  4. `rf-koopwoningen-per-provincie-2024` region_set — "Welk percentage koopwoningen had elke provincie in 2024?" → `owner_occupied_homes_share`, `all_provincies`, `2024JJ00`.
  5. `rf-autos-meeste-gemeente-2025` region_set — "Welke gemeente had in 2025 de meeste personenauto's per 1000 inwoners?" → `passenger_cars_per_1000_residents`, `all_gemeenten`, `2025JJ00`.
  6. `rf-afstand-station-groningen-2025` region_set — "Wat was de gemiddelde afstand tot een treinstation per gemeente in Groningen in 2025?" → `distance_to_train_station`, gemeenten in province Groningen (copy the `rs-groningen-per-gemeente-2016` regionSet shape), `2025JJ00`.
  7. `rf-bedrijfsvestigingen-vs-faillissementen` variant — "Hoeveel bedrijfsvestigingen had Rotterdam in 2025?" → `business_establishments`, Rotterdam, `2025JJ00` (guard vs `bankruptcies_businesses`).
  8. `rf-uitkeringen-eindhoven-2024` variant — "Hoeveel mensen hadden een uitkering in Eindhoven in 2024?" → `benefit_recipients_total`, Eindhoven, `2024JJ00`.
  9. `rf-hoogopgeleid-per-provincie-2024` region_set — "Hoeveel procent hoogopgeleiden had elke provincie in 2024?" → `highly_educated_share`, `all_provincies`, `2024JJ00`.
  10. `rf-supermarkt-afstand-vs-omzet` variant — "Wat was de gemiddelde afstand tot een grote supermarkt in Den Haag in 2025?" → `distance_to_large_supermarket`, 's-Gravenhage, `2025JJ00` (guard vs `supermarket_turnover_yoy`; copy how existing cases name Den Haag).
  For any case whose exact `expect` field for a named region is not obvious from existing cases, use the `checks` form the `rs-g4-…` case uses instead of a full intent.
- [ ] **Step 2:** Validate JSON parses and the case loader accepts it: `node -e "JSON.parse(require('fs').readFileSync('benchmark/intent-labelled-set.json','utf8'))"` and run the non-replay test that loads the set (`grep -rln intent-labelled-set tests` — run only tests that do not replay LLM fixtures; if all loaders replay, just the JSON check).
- [ ] **Step 3:** Commit `test(intent): labelled cases for the 12 regional figures incl. WOZ/sale-price, businesses/bankruptcies, supermarket guards (ADR 061 part 2)`.

---

### Task 5: Recording, merge, prod load (controller; owner present; on/after 2026-10-01)

- [ ] Rebase the branch on `main`. Owner GO for spend (cheap tier). `npm run intent:record`, `npm run clarify:record`, `npm run followup:record`; then `npm run intent:eval` ×3 — all cases pass, zero flips; the 10 new cases pass (a failing new case = fix `everydayTerms`/`notes`, re-record, never loosen the expectation).
- [ ] Full `scripts/verify-block.sh` + `/code-review` LOW + opus final whole-branch review; merge to `main`, push, CI green incl. deploy.
- [ ] Prod (RUNBOOK "Regional statistics table `70072ned`"): pre-flight query empty → `sync 70072ned` (expect ~106,683 rows) → `npm run registry:apply` → spot-check 3–5 cells (value + status) vs a fresh CBS fetch → one real question per surface (single region, region set, scatter chip) in the browser.
- [ ] Live benchmark (confirms #330); STATUS, ADR 061 "As built — Part 2", build plan, #333(6), #334.
