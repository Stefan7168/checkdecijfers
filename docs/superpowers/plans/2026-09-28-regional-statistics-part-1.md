# Regional statistics, Part 1 (data only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest the 12 owner-picked regional figures from CBS table `70072ned` into our database, safely, with zero AI spend and nothing reader-visible yet.

**Architecture:** A new optional measure allow-list on the registered slice (`CbsSlice.measures`) narrows the CBS fetch server-side and scopes registration units, the served measure set and the schema fingerprint to the listed codes, so CBS revising the other 236 codes in this table no longer quarantines it while a change to one of ours still fails loudly. `70072ned` joins the seed set with that slice and gets a hermetic fixture; the live load is a normal owner-present sync.

**Tech Stack:** TypeScript (Node, `--experimental-strip-types` style `.ts` imports), vitest, PGlite test DB, CBS OData v4.

**Spec:** [docs/superpowers/specs/2026-09-28-regional-statistics-design.md](../specs/2026-09-28-regional-statistics-design.md)

## Global Constraints

- The 12 codes, exactly: `M000100`, `M003039`, `1014800`, `2018790`, `A018943_2`, `X092783`, `M000101_3`, `M000114`, `1050015_2`, `M000200_2`, `X033647`, `D000025`.
- Live slice for `70072ned`: those 12 codes, `RegioS` prefixes `['NL', 'PV', 'GM']`, `periodFloor: '2015JJ00'` (measured 106,683 cells; cap 500,000).
- Table id casing is `70072ned` (lowercase, catalog quirk #1) — never `70072NED`.
- Tables without `slice.measures` must behave **byte-identically** to today: same `$filter` string, same fingerprint, same units. No existing table gets rebaselined.
- No DB migration, no new `FailureStage` value, no LLM call, no change to any LLM prompt (no `CANONICAL_MEASURES`/`REGIONAL_KEYS` change in Part 1 — that is Part 2).
- 8 GB machine: run ONE vitest process at a time, in the foreground; never background a test command.
- Code/comments/commits in English. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do NOT push, open PRs, run `ingest`/`registry:apply` against the live DB, or touch `.env` — the controller does those.

---

### Task 1: `CbsSlice.measures` in the adapter layer

**Files:**
- Modify: `src/cbs-adapter/types.ts:52-59` (`CbsSlice`)
- Modify: `src/cbs-adapter/odata-v4.ts:32-54` (`sliceToFilter` + its doc comment)
- Modify: `src/cbs-adapter/fixture-source.ts:108-139` (`matchesSlice`)
- Modify: `src/eurostat-adapter/statistics-api.ts:157` (`buildRequestUrl` refuses `measures`)
- Test: `tests/ingestion/adapter.test.ts`, `tests/eurostat-adapter/statistics-api.test.ts`

**Interfaces:**
- Produces: `CbsSlice.measures?: string[]` — exact CBS measure codes to keep; absent/empty = all measures. `sliceToFilter` appends the measure clause LAST (after `periodFloor`) so every existing slice's filter string is unchanged.

- [ ] **Step 1: Write the failing tests** (append to the `describe` that holds the existing `sliceToFilter` test in `tests/ingestion/adapter.test.ts`)

```ts
  it('sliceToFilter: measures allow-list is appended last — single code without parentheses, several ORed in parentheses', async () => {
    const { sliceToFilter } = await import('../../src/cbs-adapter/odata-v4.ts');
    expect(sliceToFilter({ measures: ['M000100'] })).toBe("Measure eq 'M000100'");
    expect(
      sliceToFilter({ dimensionPrefixes: { RegioS: ['NL', 'PV'] }, periodFloor: '2015JJ00', measures: ['A', 'B'] }),
    ).toBe("(startswith(RegioS,'NL') or startswith(RegioS,'PV')) and Perioden ge '2015JJ00' and (Measure eq 'A' or Measure eq 'B')");
    // empty list = no measure clause at all (never "match nothing")
    expect(sliceToFilter({ periodFloor: '2015JJ00', measures: [] })).toBe("Perioden ge '2015JJ00'");
  });

  it('FixtureSource: a measures slice keeps only the listed measure codes', async () => {
    const docs = await loadFixtureDocs(fixturePath('82235NED'));
    const source = new FixtureSource(docs);
    const keep = 'M003003';
    const rows: CbsObservationRow[] = [];
    for await (const page of source.fetchObservations('82235NED', { measures: [keep] })) rows.push(...page);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.measure === keep)).toBe(true);
  });
```

(`fetchObservations(tableId, slice)` is the two-argument form the neighbouring tests use. Import `CbsObservationRow` from `../../src/cbs-adapter/types.ts` if not already imported.)

In `tests/eurostat-adapter/statistics-api.test.ts` (import `buildRequestUrl` from `../../src/eurostat-adapter/statistics-api.ts` if not already imported):

```ts
  it('buildRequestUrl refuses a measures allow-list (CBS-only slice field) instead of silently ignoring it', () => {
    expect(() => buildRequestUrl('une_rt_m', { measures: ['X'] })).toThrow(/measures/);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/ingestion/adapter.test.ts`, then `npx vitest run tests/eurostat-adapter/statistics-api.test.ts`.
Expected: FAIL (type error or wrong filter string / no throw).

- [ ] **Step 3: Implement**

`src/cbs-adapter/types.ts` — add to `CbsSlice`:

```ts
  /** Measure allow-list (exact CBS measure codes). Absent or empty = every
   * measure. When set, ingestion scopes registration units, the served
   * measure set and the schema fingerprint to these codes (ADR 061), so a CBS
   * revision of an UNLISTED code in a wide table (70072ned: 248 codes) no
   * longer quarantines it, while a change to a listed code still fails loudly.
   * CBS-only: the Eurostat adapter refuses it. */
  measures?: string[];
```

`src/cbs-adapter/odata-v4.ts` — in `sliceToFilter`, after the `periodFloor` line, and add a `- measures:` bullet to the doc comment ("`Measure eq 'code'`, ORed, parenthesised when more than one, appended LAST so slices without it keep their exact filter string"):

```ts
  const measures = slice.measures ?? [];
  if (measures.length > 0) {
    const ors = measures.map((m) => `Measure eq '${m}'`).join(' or ');
    parts.push(measures.length > 1 ? `(${ors})` : ors);
  }
```

`src/cbs-adapter/fixture-source.ts` — add and wire:

```ts
function matchesMeasures(measure: string, measures?: string[]): boolean {
  if (!measures || measures.length === 0) return true;
  return measures.includes(measure);
}
```

and in `matchesSlice` add `&& matchesMeasures(row.measure, slice.measures)`.

`src/eurostat-adapter/statistics-api.ts` — in `buildRequestUrl`, next to the existing `geo` refusal:

```ts
  if (slice.measures && slice.measures.length > 0) {
    throw new Error(
      'Eurostat adapter: CbsSlice.measures is a CBS-only allow-list and is not supported for Eurostat datasets.',
    );
  }
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/ingestion/adapter.test.ts`, then `npx vitest run tests/eurostat-adapter/statistics-api.test.ts`, then `npx tsc --noEmit`.
Expected: all PASS; the existing 03759ned `sliceToFilter` test still passes (unchanged string).

- [ ] **Step 5: Commit**

```bash
git add src/cbs-adapter/types.ts src/cbs-adapter/odata-v4.ts src/cbs-adapter/fixture-source.ts src/eurostat-adapter/statistics-api.ts tests/ingestion/adapter.test.ts tests/eurostat-adapter/statistics-api.test.ts
git commit -m "feat(ingestion): CbsSlice.measures allow-list in the CBS filter and fixture source (ADR 061)"
```

---

### Task 2: Scope registration, served measures and the fingerprint to the allow-list

**Files:**
- Create: `src/ingestion/measure-allow-list.ts`
- Modify: `src/ingestion/pipeline.ts` — `registerTables` (~line 106-111, units) and `syncTable` (~lines 432-480: exclusion block, `fingerprint`, `checkSchemaFingerprint` args)
- Modify: `src/ingestion/validate.ts:136-142` (duplicate-cell summary wording only)
- Test: `tests/ingestion/ingestion.test.ts` (new `describe` block at the end)

**Interfaces:**
- Consumes: `CbsSlice.measures` (Task 1).
- Produces: `allowListedMeasures(slice: CbsSlice | null | undefined): Set<string> | null` and `missingAllowListedCodes(slice, measureCodes: string[]): string[]` in `src/ingestion/measure-allow-list.ts`.

Background the implementer needs: `registerTables` stores `units` for every measure CBS lists (minus `excludeMeasures`); `syncTable`'s `row_plausibility` check then fails if any unit-registered measure has zero rows. With a sliced fetch of 12 of 248 codes that check would fail every sync — so the allow-list MUST reach registration. The schema fingerprint baseline is first written by the first successful sync (registration stores `null`), and `checkSchemaFingerprint` recomputes it from whatever code list it is given — so passing it the allow-listed codes scopes it with no change to `validate.ts`'s logic.

- [ ] **Step 1: Write the failing tests** (append to `tests/ingestion/ingestion.test.ts`; uses the file's existing `db`, `loadDocs`, `clone`, `table` helpers and the 9-measure `82235NED` fixture)

```ts
describe('ADR 061 — measure allow-list slice (CbsSlice.measures)', () => {
  const KEEP = ['M003003', 'D002936'];
  function allowListed(): Phase0Table {
    return { ...table('82235NED'), slice: { measures: KEEP } };
  }

  it('registers units for ONLY the listed codes and syncs rows for only those', async () => {
    const source = new FixtureSource(await loadDocs('82235NED'));
    await registerTables(db, source, [allowListed()]);
    const sync = await syncTable(db, source, '82235NED');
    expect(sync.outcome).toBe('succeeded');

    const row = (await db.query('select units, status from cbs_tables where id = $1', ['82235NED'])).rows[0]!;
    const units = (typeof row.units === 'string' ? JSON.parse(row.units) : row.units) as Record<string, unknown>;
    expect(Object.keys(units).sort()).toEqual([...KEEP].sort());
    const measures = await db.query(
      'select distinct measure from observations where table_id = $1 order by measure',
      ['82235NED'],
    );
    expect(measures.rows.map((r) => r.measure)).toEqual([...KEEP].sort());
  });

  it('a CBS change to an UNLISTED measure code does not trip the fingerprint', async () => {
    const docs = await loadDocs('82235NED');
    await registerTables(db, new FixtureSource(docs), [allowListed()]);
    expect((await syncTable(db, new FixtureSource(docs), '82235NED')).outcome).toBe('succeeded');

    const changed = clone(docs);
    const measureDocs = (changed.measureCodes as { value: Record<string, unknown>[] }).value;
    const extra = structuredClone(measureDocs.find((m) => !KEEP.includes(String(m.Identifier)))!);
    extra.Identifier = 'M999999';
    measureDocs.push(extra);
    const resync = await syncTable(db, new FixtureSource(changed), '82235NED');
    expect(resync.outcome).toBe('succeeded');
  });

  it('a LISTED code disappearing from CBS fails schema_fingerprint loudly, naming the code', async () => {
    const docs = await loadDocs('82235NED');
    await registerTables(db, new FixtureSource(docs), [allowListed()]);
    expect((await syncTable(db, new FixtureSource(docs), '82235NED')).outcome).toBe('succeeded');

    const changed = clone(docs);
    const measureDocs = changed.measureCodes as { value: Record<string, unknown>[] };
    measureDocs.value = measureDocs.value.filter((m) => m.Identifier !== 'M003003');
    const resync = await syncTable(db, new FixtureSource(changed), '82235NED');
    expect(resync.outcome).toBe('failed');
    expect(resync.failureStage).toBe('schema_fingerprint');
    expect(resync.failureSummary).toContain('M003003');
    const row = (await db.query('select status from cbs_tables where id = $1', ['82235NED'])).rows[0]!;
    expect(row.status).toBe('needs_review');
  });

  it('registration refuses an allow-list naming a code CBS does not list', async () => {
    const source = new FixtureSource(await loadDocs('82235NED'));
    const bad: Phase0Table = { ...table('82235NED'), slice: { measures: ['M003003', 'NOPE123'] } };
    await expect(registerTables(db, source, [bad])).rejects.toThrow(/NOPE123/);
    const n = await db.query('select count(*)::int as n from cbs_tables where id = $1', ['82235NED']);
    expect(n.rows[0]!.n).toBe(0);
  });

  it('a table WITHOUT an allow-list keeps its all-codes fingerprint (byte-identical to computeFingerprint over every code)', async () => {
    const docs = await loadDocs('82235NED');
    const source = new FixtureSource(docs);
    await registerTables(db, source, [table('82235NED')]);
    expect((await syncTable(db, source, '82235NED')).outcome).toBe('succeeded');
    const schema = await source.fetchTableSchema('82235NED');
    const stored = (await db.query('select schema_fingerprint from cbs_tables where id = $1', ['82235NED'])).rows[0]!;
    expect(stored.schema_fingerprint).toBe(
      computeFingerprint(schema.dimensions, schema.measures.map((m) => m.code)),
    );
  });
});
```

Add imports if missing: `type Phase0Table` from `../../src/ingestion/registry-seed.ts`, `computeFingerprint` from `../../src/ingestion/fingerprint.ts`. Also extend the existing duplicate-cell test (`'duplicate fetched cell …'`, ~line 815) with:

```ts
      expect(result.failureSummary).toContain('same measure code');
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/ingestion/ingestion.test.ts`
Expected: the new block FAILS (units contain all 9 codes / row_plausibility "No rows at all were fetched for measure code(s)" / no throw), duplicate test fails on the new wording.

- [ ] **Step 3: Implement**

Create `src/ingestion/measure-allow-list.ts`:

```ts
// ADR 061 — the measure allow-list on a registered slice (CbsSlice.measures).
// One helper module so registration and every sync derive "which codes does
// this table serve" identically.
import type { CbsSlice } from '../cbs-adapter/types.ts';

/** The allow-listed codes, or null when the slice has no (or an empty) list —
 * null means "every measure", today's behaviour, byte-identical. */
export function allowListedMeasures(slice: CbsSlice | null | undefined): Set<string> | null {
  const codes = slice?.measures ?? [];
  return codes.length > 0 ? new Set(codes) : null;
}

/** Listed codes that CBS's current MeasureCodes no longer carries, in list
 * order. Principle (c): a listed code vanishing is a schema change on a
 * figure we serve — it must fail loudly, never be skipped. */
export function missingAllowListedCodes(slice: CbsSlice | null | undefined, measureCodes: string[]): string[] {
  const allow = allowListedMeasures(slice);
  if (allow === null) return [];
  const present = new Set(measureCodes);
  return [...allow].filter((code) => !present.has(code));
}
```

`src/ingestion/pipeline.ts`, `registerTables` — right after `const schema = await source.fetchTableSchema(...)` / code lists, before computing units:

```ts
    // ADR 061: a measure allow-list scopes what this table serves. A listed
    // code CBS does not list is a curation error — refuse before any write.
    const missingListed = missingAllowListedCodes(table.slice, schema.measures.map((m) => m.code));
    if (missingListed.length > 0) {
      throw new Error(
        `Cannot register ${table.id}: its measure allow-list names code(s) CBS does not list: ` +
          `${missingListed.join(', ')}.`,
      );
    }
    const allow = allowListedMeasures(table.slice);
```

and change the units line to:

```ts
    const units = unitsFromMeasures(
      schema.measures.filter((m) => !excluded.has(m.code) && (allow === null || allow.has(m.code))),
    );
```

`src/ingestion/pipeline.ts`, `syncTable` — replace the exclusion block's `servedMeasures` computation and the row filter, and scope the fingerprint (the registry's stored `registry.slice` is the source of truth at sync time, as for the fetch):

```ts
  const excludedMeasures = new Set(SEED_TABLES.find((t) => t.id === tableId)?.excludeMeasures ?? []);
  // ADR 061: the measure allow-list (registry.slice.measures) scopes the
  // served set, the rows and — below — the schema fingerprint.
  const allowList = allowListedMeasures(registry.slice);
  const isServed = (code: string) => !excludedMeasures.has(code) && (allowList === null || allowList.has(code));
  const servedMeasures =
    excludedMeasures.size === 0 && allowList === null ? schema.measures : schema.measures.filter((m) => isServed(m.code));
  if (excludedMeasures.size > 0 || allowList !== null) {
    observationRows = observationRows.filter((row) => isServed(row.measure));
  }
  // The fingerprint covers every code CBS lists (so phantom-set drift still
  // fails loudly, #167) — EXCEPT on an allow-listed table, where it covers
  // exactly the listed codes: CBS revising one of the other codes of a wide
  // table is not a change to anything we serve.
  const fingerprintMeasureCodes = (
    allowList === null ? schema.measures : schema.measures.filter((m) => allowList.has(m.code))
  ).map((m) => m.code);
```

Then use `fingerprintMeasureCodes` in both `computeFingerprint(schema.dimensions, fingerprintMeasureCodes)` and the `checkSchemaFingerprint(schema.dimensions, fingerprintMeasureCodes, …)` call. Immediately BEFORE `const stage1 = …`, add the missing-code check (after `fingerprint` is computed, so `failBatch` gets it):

```ts
  const missingListed = missingAllowListedCodes(registry.slice, schema.measures.map((m) => m.code));
  if (missingListed.length > 0) {
    const summary =
      `CBS no longer lists measure code(s) ${missingListed.join(', ')}, which this table's allow-list serves. ` +
      `This is a schema change on a figure we publish; the table is quarantined until it is re-curated.`;
    await failBatch(db, batchId, tableId, 'schema_fingerprint', summary, observationRows.length, fingerprint, true);
    return {
      tableId,
      batchId,
      outcome: 'failed',
      failureStage: 'schema_fingerprint',
      failureSummary: summary,
      rowCount: observationRows.length,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsMissing: 0,
      corrections: [],
      rebaselined,
    };
  }
```

`registry.slice` is already a parsed object (`parseRegistryRow`, pipeline.ts ~line 214: `slice: parseJsonb(row.slice, null)`), so pass it straight in. Verify the rebaseline branch's `registryUnits = unitsFromMeasures(servedMeasures)` now receives the allow-listed set (it does — it reads `servedMeasures`).

`src/ingestion/validate.ts` duplicate summary — replace the summary string with:

```ts
        `${duplicates.length} cell(s) were fetched more than once (identical measure and ` +
        `coordinates) — either a corrupted or overlapping fetch, or CBS publishing several values ` +
        `under the same measure code (seen in 70072ned's v4 feed, ADR 061). Refusing rather than picking one. ` +
        `Examples: ${duplicates.slice(0, 3).join('; ')}.`,
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/ingestion/ingestion.test.ts`, then `npx vitest run tests/ingestion` (whole folder), then `npx tsc --noEmit`.
Expected: all PASS, including the untouched #167 tests and the fingerprint/quarantine tests.

- [ ] **Step 5: Commit**

```bash
git add src/ingestion/measure-allow-list.ts src/ingestion/pipeline.ts src/ingestion/validate.ts tests/ingestion/ingestion.test.ts
git commit -m "feat(ingestion): measure allow-list scopes units, served rows and the schema fingerprint (ADR 061)"
```

---

### Task 3: `70072ned` in the seed set, registry defaults and a hermetic fixture

**Files:**
- Modify: `src/ingestion/registry-seed.ts` (append to `COVERAGE_TABLES`, before its closing `];` near line 270)
- Modify: `src/registry/defaults.ts` (append to `TABLE_REGISTRY_DEFAULTS`, after the `83625NED` entry near line 194)
- Modify: `scripts/capture-cbs-fixtures.ts:22-48` (`CAPTURE_SLICES`)
- Create: `tests/fixtures/cbs/70072ned/*` (captured, network)
- Modify: `docs/07-phase0-table-set.md` (row 69 + a short slice section — this doc is the authority `registry-seed.ts` mirrors)
- Test: `tests/ingestion/ingestion.test.ts` (new `it` in the Task 2 describe)

**Interfaces:**
- Consumes: `CbsSlice.measures` (Task 1), allow-list pipeline (Task 2).
- Produces: `SEED_TABLES` entry `id: '70072ned'`; `TABLE_REGISTRY_DEFAULTS` entry `tableId: '70072ned'`. Part 2 adds the 12 canonical measures on top of these.

- [ ] **Step 1: Seed entry** — append to `COVERAGE_TABLES`:

```ts
  {
    // Regional statistics (session 138, 2026-09-28, ADR 061): "Regionale
    // kerncijfers Nederland" — 6.8M cells, 248 measure codes, RegioS
    // (GeoDimension) + Perioden only. Sliced to the 12 owner-picked figures,
    // NL/PV/GM, 2015+ (106,683 cells, measured). The measure allow-list also
    // scopes the fingerprint: phase 0 rejected this table because CBS revises
    // its topics constantly. Every listed code was measured single-valued per
    // (region, year) over the whole slice — the v4 feed REUSES 34 other codes
    // for several figures (e.g. 1050010_6, household income), which is why
    // income is not in the list.
    id: '70072ned',
    slice: {
      measures: [
        'M000100', // Bevolkingsdichtheid
        'M003039', // Gemiddelde WOZ-waarde van woningen
        '1014800', // Koopwoningen (%)
        '2018790', // Hoogstbehaald onderwijsniveau: hbo, wo (%)
        'A018943_2', // Personenauto's per 1 000 inwoners
        'X092783', // Afstand tot treinstation
        'M000101_3', // Bevolkingsgroei, relatief
        'M000114', // Gemiddelde huishoudensgrootte
        '1050015_2', // Eenpersoonshuishoudens (%)
        'M000200_2', // Bedrijfsvestigingen totaal (1 januari, afgerond op 5)
        'X033647', // Uitkeringsontvangers totaal (incl. AOW)
        'D000025', // Afstand tot grote supermarkt
      ],
      dimensionPrefixes: { RegioS: ['NL', 'PV', 'GM'] },
      periodFloor: '2015JJ00',
    },
    updateCadence: 'irregular, per topic (CBS: "Onregelmatig"); most figures yearly',
    servesTasks: [],
  },
```

- [ ] **Step 2: Registry defaults** — append to `TABLE_REGISTRY_DEFAULTS`:

```ts
  {
    tableId: '70072ned',
    defaultCoordinates: {},
    periodSemantics: {
      JJ: 'Cijfer voor het genoemde jaar; het peilmoment verschilt per cijfer (1 januari, jaargemiddelde of laatste dag van het jaar — zie de definitie van het cijfer). Recente jaren kunnen voorlopig zijn; status altijd meegeven. Opgeheven gemeenten houden rijen met lege waarde en CBS-reden "Impossible" voor jaren na hun opheffing.',
    },
  },
```

- [ ] **Step 3: Capture-only floor** — add to `CAPTURE_SLICES` (keeps the fixture small; `createIngestedDb` re-ingests every fixture in many suites):

```ts
  // 70072ned (ADR 061): live ingest keeps 2015+; the FIXTURE keeps 2024+
  // (2024, 2025, 2026 — the latest year of every listed figure).
  '70072ned': { periodFloor: '2024JJ00' },
```

- [ ] **Step 4: Capture the fixture (network)**

Run: `node --import ./scripts/force-ipv4.mjs scripts/capture-cbs-fixtures.ts 70072ned`
Expected: `70072ned: <N> observation rows, <k> page(s) [sliced] [capture-slice]` with N roughly 25,000–30,000 and no "still a nextLink" error. Then check: `python3 -c "import json;print(json.load(open('tests/fixtures/cbs/70072ned/index.json'))['sliceFilter'])"` shows the registered slice AND `Perioden ge '2024JJ00'`. Record N.

- [ ] **Step 5: Write the failing hermetic test** (add to the Task 2 describe block)

```ts
  it('70072ned fixture: registers + syncs with exactly the 12 allow-listed figures; Amsterdam 2025 cells match CBS', async () => {
    const seed = SEED_TABLES.find((t) => t.id === '70072ned');
    if (!seed?.slice?.measures) throw new Error('70072ned seed with a measure allow-list expected');
    expect(seed.slice.measures).toHaveLength(12);
    const source = new FixtureSource(await loadDocs('70072ned'));
    await registerTables(db, source, [seed]);
    const sync = await syncTable(db, source, '70072ned');
    expect(sync.outcome).toBe('succeeded');

    const row = (await db.query('select units, status from cbs_tables where id = $1', ['70072ned'])).rows[0]!;
    expect(row.status).toBe('active');
    const units = (typeof row.units === 'string' ? JSON.parse(row.units) : row.units) as Record<string, unknown>;
    expect(Object.keys(units).sort()).toEqual([...seed.slice.measures].sort());

    // Values measured live on 2026-09-28 (v4 API), Amsterdam GM0363, 2025.
    const cell = async (measure: string) =>
      (
        await db.query(
          `select value from observations where table_id = '70072ned' and measure = $1
             and region_code = 'GM0363' and period_code = '2025JJ00'`,
          [measure],
        )
      ).rows[0]?.value;
    expect(Number(await cell('M000100'))).toBe(4968);
    expect(Number(await cell('M003039'))).toBe(518);
    expect(Number(await cell('A018943_2'))).toBe(287);
    expect(Number(await cell('X092783'))).toBe(2.8);
  });
```

(If the captured fixture shows CBS revised one of these four values since 2026-09-28, use the fixture's value AND note the revision in the commit message — never loosen to a range.)

- [ ] **Step 6: Run it**

Run: `npx vitest run tests/ingestion/ingestion.test.ts -t "70072ned"`
Expected: PASS (Tasks 1–2 already landed). If `row_plausibility` fails on "null value with no CBS reason", STOP and report the example rows — do not add an exclusion.

- [ ] **Step 7: Geo-group conformance + full ingestion/registry suites**

Run: `npx vitest run tests/ingestion`, then `npx vitest run tests/registry`, then `npx tsc --noEmit`.
Expected: PASS — including `tests/ingestion/region-set-groups.test.ts` (the `GMPV##` roster convention; 70072ned groups were measured as `GMPV20`…`GMPV31`, `PV`, `LD`, `NL`). If a registry test counts tables and fails only because the count grew by one, update that expected count with a comment citing ADR 061.

- [ ] **Step 8: docs/07** — replace the `70072NED` row's verdict cell (line ~69) with: `**Selected 2026-09-28 (session 138, ADR 061) with a 12-code measure allow-list** — the allow-list scopes the fingerprint, removing the phase-0 churn objection; the v4 feed reuses 34 other codes for several figures (income excluded).` and add the slice (codes, prefixes, floor, 106,683 cells) under the doc's table-set list in the same format as the `03759ned` slice.

- [ ] **Step 9: Commit**

```bash
git add src/ingestion/registry-seed.ts src/registry/defaults.ts scripts/capture-cbs-fixtures.ts tests/fixtures/cbs/70072ned tests/ingestion/ingestion.test.ts docs/07-phase0-table-set.md
git commit -m "feat(ingestion): 70072ned regional statistics seed — 12-figure allow-list slice + fixture (ADR 061)"
```

---

### Task 4: Verification, live load, spot-check, docs (controller, owner present)

**Files:**
- Create: `docs/decisions/061-regional-statistics-70072ned.md`
- Modify: `docs/STATUS.md`, `docs/08-build-plan.md`, `docs/open-questions.md`, `docs/04-architecture.md`, `docs/RUNBOOK.md` (allow-list gotcha), `docs/superpowers/specs/2026-09-28-regional-statistics-design.md` (D3 correction)

- [ ] **Step 1: Full verification block** — `scripts/verify-block.sh` (detached, per RUNBOOK), all green: typechecks, all suites, benchmark 14/14 + 6/6 + 0 fabricated, real build. Then `/code-review` LOW over the diff; fix or consciously dispatch every confirmed finding.
- [ ] **Step 2: Push to `main`** (owner present, #118) and wait for CI green incl. deploy.
- [ ] **Step 3: Live load** — `node --import ./scripts/force-ipv4.mjs --env-file=.env src/ingestion/cli.ts sync 70072ned` (auto-registers). Expected: succeeded, ~106,683 rows. Then `npm run registry:apply` (table defaults only — no canonical rows in Part 1).
- [ ] **Step 4: Spot-check live DB vs CBS** — for 5 random (measure, region, 2024/2025) cells, compare the DB value + status with a fresh v4 `Observations` fetch; all equal. Confirm `select count(*) from canonical_measures where table_id = '70072ned'` = 0 (reader-invisible until Part 2).
- [ ] **Step 5: Docs** — ADR 061 (context, D1–D7, alternatives, as-built Part 1, revisit triggers); spec D3 corrected (the duplicate-cell check pre-existed; Part 1 only sharpened its message); STATUS top block; build-plan section; open-questions row (income per gemeente excluded, #333(6) partner map); 04-architecture ingestion row; RUNBOOK: "a table with `slice.measures` fingerprints only its listed codes; adding a code to the list = `sync <id> --rebaseline`".
