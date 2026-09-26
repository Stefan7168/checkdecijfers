// ADR 058 (English answers, Task 3; Fix round 1): fetches CBS's own English
// (ENG) sibling tables for every registered CBS table and WRITES the
// CBS-sourced pairs into src/registry/english-names.cbs.generated.ts — the
// table title / measure title / dimension-value label / region name pairs
// the product actually shows (docs/05-data-rules.md principle c — never
// guess) read straight off CBS's own English words. Anything CBS publishes
// no English form for, or where CBS's own words genuinely disagree with each
// other for the same Dutch string, is a session's job to hand-curate in
// src/registry/english-names.data.ts instead (rule 5's "reading the Dutch
// table's own definition text first" is inherently a human step; rule 3's
// "emit neither, list the conflict" is a judgment call, not something to
// paper over here).
//
// Public CBS v3 API only — no database, no model, no secrets, no .env:
//   TableInfos      https://opendata.cbs.nl/ODataApi/odata/<id>/TableInfos
//   DataProperties  https://opendata.cbs.nl/ODataApi/odata/<id>/DataProperties
//   <DimensionKey>  https://opendata.cbs.nl/ODataApi/odata/<id>/<DimensionKey>
// <id> is `${number}NED` for the Dutch table and `${number}ENG` for its
// English sibling (some tables don't have one — reported as "no CBS English
// sibling"). Every request carries its own 25s timeout so a slow/dead
// endpoint can never hang this script.
//
// Fix round 1 (task review) corrected a real bug in how "which measure
// titles matter" was computed: v1 of this script scoped pairing to each
// canonical measure's registry `measureTitle` field — but a ResultCell's
// `measureTitle` at runtime is `normalizeLabel(measureMeta.title)`
// (src/query/resolve.ts), the RAW CBS measure-codes Title
// (src/ingestion/pipeline.ts / src/cbs-adapter/parse-v4.ts) — never a
// session-assembled "TopicGroup / Topic" breadcrumb like a `measureTitle`
// field can be. This script now reads the SAME ground truth the product (and
// tests/registry/english-names-data.test.ts) actually use —
// tests/fixtures/cbs/<table>/measure-codes.json — for every REACHABLE
// measure code per canonical measure: its own `measure`, plus every
// alternate that carries its own `measure` code (an alternate that only
// varies `dims` keeps the primary's code, already covered). Matching a v1
// fixture's Identifier to a position in the live v3 DataProperties response
// (the two APIs use different code schemes) is done by Title+Unit+Decimals
// equality — unique in every table this registry has, verified by requiring
// EXACTLY one candidate position.
//
// Pairing rules (task-3-brief.md rules 1-4), implemented literally:
//  - table title: TableInfos' own `Title` field, NED -> ENG, paired directly.
//  - measures: matched by v3 Position (found via the Title+Unit+Decimals
//    lookup above), and ONLY kept when Type, Decimals AND Unit also agree on
//    both sides. Unit is compared after normalising case/hyphenation/
//    plural-s (CBS's own English units are not always byte-identical in
//    spelling to a literal translation — e.g. 'average balance of the
//    subquestions' vs the hand-written 'average balance of the
//    sub-questions', or 'euro' vs 'euros' — the normaliser exists so a real,
//    position-verified pairing isn't thrown away over wording noise; two
//    GENUINELY different units still fail this check because their
//    normalised forms differ).
//  - dimensions: matched by Position too (NED/ENG use different Keys for the
//    same dimension, e.g. TypeGefailleerde/TypeOfBankruptcy), then their code
//    lists are paired by `Key` (rule 2: codes are language-neutral) — but
//    only for the SPECIFIC codes the registry actually uses (a table's
//    defaultCoordinates, a canonical measure's own `dims`, and its
//    `alternates[].dims`), never a table's full code list, per rule 4 ("only
//    labels the product can show are needed").
//  - regions: the one real GeoDimension table in the registry (83625NED) —
//    its FULL code list (skip GM/municipality codes, which read the same in
//    English by design — rule 4), paired by Key.
//  - conflict (rule 3, widened in Fix round 1 to cover every REACHABLE
//    measure code, not just each table's own primaries): the same Dutch
//    string pairing to two different English strings anywhere in this run —
//    across tables (e.g. 'Prijsindex verkoopprijzen', reachable both as
//    house_price_index_regional's own primary on 85792NED and as
//    average_existing_home_sale_price's alternate M001505_2 on 85773NED,
//    with two different CBS English forms) is EXCLUDED from the generated
//    file entirely, never silently resolved either way.
//
// This script WRITES src/registry/english-names.cbs.generated.ts — a
// generated, CBS-sourced-only sibling of the hand-written
// english-names.data.ts (which composes `{ ...CBS_X, ...HAND_X }` for each
// map). It does NOT read or know about the hand-written maps: a hand
// override that deliberately differs from what this script would derive
// (e.g. stripping a table-specific noun CBS's own wording bakes in) is
// tracked in data.ts's own `OVERRIDDEN_BY_HAND` set, checked by
// tests/registry/english-names-data.test.ts, not by this script.
//
//   npm run english-names:fetch
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CANONICAL_MEASURES, TABLE_REGISTRY_DEFAULTS } from '../src/registry/defaults.ts';
import type { CanonicalMeasure } from '../src/registry/types.ts';
import { translateUnit } from '../src/registry/english-names.ts';

const CBS_BASE = 'https://opendata.cbs.nl/ODataApi/odata';
const TIMEOUT_MS = 25_000;
const FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/cbs', import.meta.url));
const OUTPUT_FILE = fileURLToPath(new URL('../src/registry/english-names.cbs.generated.ts', import.meta.url));

function normalizeLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim();
}

/** CBS's own English unit text is not always byte-identical to a literal
 * translation of the Dutch unit (hyphenation, singular/plural — see this
 * file's header). Case-fold, drop whitespace/hyphens, and drop a trailing
 * plural 's' before comparing; a genuinely different unit still differs
 * after this. */
function unitKey(unit: string): string {
  return unit.toLowerCase().replace(/[-\s]+/g, '').replace(/s$/, '');
}

// Fix round 2 (owner-driven, task review): 80590NED's Leeftijd age-band
// labels are NOT a CBS wording error — Dutch "tot" is EXCLUSIVE ('15 tot 75
// jaar' means ages 15 through 74), so CBS's own English states the same band
// inclusively ('15 to 74 years'). The two numbers this exception allows to
// differ are the SAME range, just each language's own idiomatic convention —
// confirmed by checking all four of 80590NED's Leeftijd bands never overlap
// (52052 '15 tot 75'/'15 to 74', 53050 '15 tot 25'/'15 to 24', 53310
// '25 tot 45'/'25 to 44', 53825 '45 tot 75'/'45 to 74'). Deliberately narrow
// (exact-anchored regexes, exact arithmetic relation) so it can never mask a
// genuine CBS wording disagreement on a DIFFERENT shape of label — mirrored
// in tests/registry/english-names-data.test.ts's own copy, kept in sync by
// comment, with its own passing/failing-pair test.
const AGE_RANGE_NL_RE = /^(\d+) tot (\d+) jaar$/;
const AGE_RANGE_EN_RE = /^(\d+) to (\d+) years$/;

function isDutchExclusiveAgeRangePair(nl: string, en: string): boolean {
  const nlMatch = AGE_RANGE_NL_RE.exec(nl);
  const enMatch = AGE_RANGE_EN_RE.exec(en);
  if (!nlMatch || !enMatch) return false;
  const [, nlFrom, nlTo] = nlMatch;
  const [, enFrom, enTo] = enMatch;
  return nlFrom === enFrom && Number(enTo) === Number(nlTo) - 1;
}

/** UNITS (english-names.data.ts) is keyed by CBS's usual lowercase spelling
 * ('aantal'), but some tables capitalise it ('Aantal', 82242NED's own
 * DataProperties) — translateUnit does an exact-string lookup, so this tries
 * the literal Dutch unit first and falls back to its lowercased form before
 * giving up (never guesses a NEW mapping, only tolerates casing). */
function translateUnitLoose(unit: string): string {
  const direct = translateUnit(unit);
  if (direct !== unit) return direct;
  return translateUnit(unit.toLowerCase());
}

type FetchResult = { ok: true; data: any } | { ok: false; reason: string };

async function fetchJson(url: string): Promise<FetchResult> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    return { ok: false, reason: isTimeout ? 'timeout' : String(err) };
  }
}

interface DataPropRow {
  Position: number | null;
  Type: string;
  Key: string;
  Title: string;
  Unit?: string;
  Decimals?: number;
}

async function fetchTableInfo(id: string): Promise<{ ok: true; title: string } | { ok: false; reason: string }> {
  const r = await fetchJson(`${CBS_BASE}/${id}/TableInfos?$format=json`);
  if (!r.ok) return { ok: false, reason: r.reason };
  const row = r.data.value?.[0];
  if (!row?.Title) return { ok: false, reason: 'no Title in TableInfos' };
  return { ok: true, title: normalizeLabel(row.Title) };
}

async function fetchDataProperties(id: string): Promise<{ ok: true; rows: DataPropRow[] } | { ok: false; reason: string }> {
  const r = await fetchJson(`${CBS_BASE}/${id}/DataProperties?$format=json`);
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, rows: r.data.value as DataPropRow[] };
}

async function fetchCodes(tableId: string, dimKey: string): Promise<Map<string, string> | null> {
  const r = await fetchJson(`${CBS_BASE}/${tableId}/${dimKey}?$format=json`);
  if (!r.ok) return null;
  const map = new Map<string, string>();
  for (const row of r.data.value as Array<{ Key: string; Title: string }>) {
    map.set(row.Key.trim(), normalizeLabel(row.Title));
  }
  return map;
}

interface FixtureMeasureRow {
  Identifier: string;
  Title: string;
  Unit?: string;
  Decimals?: number;
}

/** The Dutch fixture measure-codes.json — the SAME ground truth
 * tests/registry/english-names-data.test.ts reads, and the ONLY source for
 * "what does this measure code's Title actually say" (the v3 API used for
 * everything else here has no equivalent to a v1-style flat Identifier). */
function readFixtureMeasures(tableId: string): FixtureMeasureRow[] {
  const raw = JSON.parse(readFileSync(`${FIXTURES_DIR}/${tableId}/measure-codes.json`, 'utf8'));
  return raw.value as FixtureMeasureRow[];
}

/** Every measure code a canonical measure can put in a ResultCell: its own
 * `measure`, plus every alternate that carries its own `measure` code (an
 * alternate that only varies `dims` keeps the primary's measure code,
 * already covered). Mirrors tests/registry/english-names-data.test.ts's own
 * reachable-set logic — keep both in sync. */
function reachableMeasureCodes(m: CanonicalMeasure): string[] {
  const codes = [m.measure];
  for (const alt of m.alternates ?? []) if (alt.measure) codes.push(alt.measure);
  return codes;
}

interface TableSpec {
  num: string;
  nedId: string;
  defaultCoordinates: Record<string, string>;
  /** dim name -> set of codes actually used by this table's default
   * coordinates plus every canonical measure (and its alternates) on it —
   * the "only labels the product can show" scope from rule 4. */
  codesOfInterest: Map<string, Set<string>>;
  /** Every measure code reachable from this table's registered canonical
   * measures (Fix round 1 — see header). */
  measureCodes: Set<string>;
}

function buildTableSpecs(): TableSpec[] {
  const specs = new Map<string, TableSpec>();
  for (const t of TABLE_REGISTRY_DEFAULTS) {
    const num = t.tableId.slice(0, -3);
    specs.set(num, {
      num,
      nedId: t.tableId,
      defaultCoordinates: t.defaultCoordinates,
      codesOfInterest: new Map(),
      measureCodes: new Set(),
    });
  }
  const addCode = (spec: TableSpec, dim: string, code: string) => {
    if (!spec.codesOfInterest.has(dim)) spec.codesOfInterest.set(dim, new Set());
    spec.codesOfInterest.get(dim)!.add(code);
  };
  for (const spec of specs.values()) {
    for (const [dim, code] of Object.entries(spec.defaultCoordinates)) addCode(spec, dim, code);
  }
  for (const m of CANONICAL_MEASURES) {
    const num = m.tableId.slice(0, -3);
    const spec = specs.get(num);
    if (!spec) continue;
    for (const [dim, code] of Object.entries(m.dims)) addCode(spec, dim, code);
    for (const alt of m.alternates ?? []) {
      for (const [dim, code] of Object.entries(alt.dims ?? {})) addCode(spec, dim, code);
    }
    for (const code of reachableMeasureCodes(m)) spec.measureCodes.add(code);
  }
  // Fix round 2 (owner-driven): 80590ned's Leeftijd default (52052) is the
  // only code that comes out of the derivation above, but a user can ask
  // this table's own monthly-unemployment question for any of its FOUR
  // non-overlapping age bands via an explicit dim (not just the registry's
  // pinned default) — the controller ruling was to fetch and pair all four
  // rather than only the one formally "reachable" today, per "include all
  // four if unsure".
  const leeftijd80590 = specs.get('80590');
  if (leeftijd80590) {
    for (const code of ['52052', '53050', '53310', '53825']) addCode(leeftijd80590, 'Leeftijd', code);
  }
  return [...specs.values()];
}

interface PairedLabel {
  nl: string;
  en: string;
  via: string;
}

async function processTable(spec: TableSpec) {
  const engId = `${spec.num}ENG`;
  const report: string[] = [];
  report.push(`\n=== ${spec.nedId} (${engId}) ===`);

  const nedTitle = await fetchTableInfo(spec.nedId);
  const engTitle = await fetchTableInfo(engId);
  if (!engTitle.ok) {
    report.push(`  NO CBS ENGLISH SIBLING (${engTitle.reason}) — curate by hand.`);
    console.log(report.join('\n'));
    return { spec, hasSibling: false as const, titlePair: undefined, measurePairs: [], dimPairs: [], regionPairs: [] };
  }
  if (!nedTitle.ok) {
    report.push(`  NED TableInfos failed unexpectedly (${nedTitle.reason}) — skipping.`);
    console.log(report.join('\n'));
    return { spec, hasSibling: false as const, titlePair: undefined, measurePairs: [], dimPairs: [], regionPairs: [] };
  }

  const titlePair: PairedLabel = { nl: nedTitle.title, en: engTitle.title, via: 'table title' };
  report.push(`  table title: "${titlePair.nl}" -> "${titlePair.en}"`);

  const nedProps = await fetchDataProperties(spec.nedId);
  const engProps = await fetchDataProperties(engId);
  if (!nedProps.ok || !engProps.ok) {
    report.push(`  DataProperties fetch failed (NED: ${nedProps.ok ? 'ok' : nedProps.reason}, ENG: ${engProps.ok ? 'ok' : engProps.reason}) — skipping measures/dims.`);
    console.log(report.join('\n'));
    return { spec, hasSibling: true as const, titlePair, measurePairs: [], dimPairs: [], regionPairs: [] };
  }

  const engByPosition = new Map<number, DataPropRow>();
  for (const row of engProps.rows) if (row.Position !== null) engByPosition.set(row.Position, row);

  // --- measures: reachable measure codes, matched via the Dutch FIXTURE's
  // own Title+Unit+Decimals against the live v3 NED DataProperties (the two
  // APIs use different code schemes — see this file's header). ---
  const measurePairs: PairedLabel[] = [];
  if (spec.measureCodes.size > 0) {
    const fixtureRows = readFixtureMeasures(spec.nedId);
    for (const code of spec.measureCodes) {
      const fixtureRow = fixtureRows.find((r) => r.Identifier === code);
      if (!fixtureRow) {
        report.push(`    measure ${code}: not found in tests/fixtures/cbs/${spec.nedId}/measure-codes.json — curate by hand.`);
        continue;
      }
      const nl = normalizeLabel(fixtureRow.Title);
      const fixtureDecimals = fixtureRow.Decimals ?? null;
      const fixtureUnit = fixtureRow.Unit ?? '';
      const candidates = nedProps.rows.filter(
        (r) =>
          r.Type === 'Topic' &&
          r.Position !== null &&
          normalizeLabel(r.Title) === nl &&
          (r.Decimals ?? null) === fixtureDecimals &&
          unitKey(r.Unit ?? '') === unitKey(fixtureUnit),
      );
      if (candidates.length === 0) {
        report.push(`    UNPAIRED measure ${code} "${nl}": no v3 position candidate — curate by hand.`);
        continue;
      }
      // A generic leaf title ('Ongecorrigeerd', 'Bruto binnenlands product', …)
      // legitimately repeats at several positions within the SAME table
      // (different TopicGroup branches) — Title+Unit+Decimals alone doesn't
      // always pick a unique position. That's fine as long as every matching
      // position's ENG counterpart structurally validates AND agrees on the
      // same English text; only a genuine DISAGREEMENT across candidates (or
      // zero valid ones) is treated as unresolved.
      const engTitlesFound = new Set<string>();
      const structFailures: string[] = [];
      for (const cand of candidates) {
        const eng = engByPosition.get(cand.Position!);
        if (!eng || eng.Type !== 'Topic' || (eng.Decimals ?? null) !== fixtureDecimals) {
          structFailures.push(`position ${cand.Position}: no structurally matching ENG entry`);
          continue;
        }
        const engUnit = eng.Unit ?? '';
        const nedUnitTranslated = translateUnitLoose(fixtureUnit);
        if (unitKey(nedUnitTranslated) !== unitKey(engUnit) && unitKey(fixtureUnit) !== unitKey(engUnit)) {
          structFailures.push(`position ${cand.Position}: unit mismatch "${fixtureUnit}" vs "${engUnit}"`);
          continue;
        }
        engTitlesFound.add(normalizeLabel(eng.Title));
      }
      if (engTitlesFound.size !== 1) {
        const reason =
          engTitlesFound.size === 0
            ? `no valid candidate (${structFailures.join('; ')})`
            : `${engTitlesFound.size} disagreeing ENG titles across ${candidates.length} candidate positions: ${[...engTitlesFound].join(' / ')}`;
        report.push(`    UNPAIRED measure ${code} "${nl}": ${reason} — curate by hand.`);
        continue;
      }
      const en = [...engTitlesFound][0]!;
      measurePairs.push({ nl, en, via: `measure ${code} (${candidates.length} position(s) agree)` });
      report.push(`    PAIRED measure ${code} "${nl}" -> "${en}" (${candidates.length} position(s) agree)`);
    }
  }

  // --- dimension code pairing, scoped to the codes the registry actually
  // uses (plain Dimension/GeoDimension only — TimeDimension is out of scope,
  // translatePeriodLabel handles periods separately). ---
  const nedDims = nedProps.rows.filter((r) => (r.Type === 'Dimension' || r.Type === 'GeoDimension') && r.Position !== null);
  const dimPairs: PairedLabel[] = [];
  for (const nedDim of nedDims) {
    const codes = spec.codesOfInterest.get(nedDim.Key);
    if (!codes || codes.size === 0) continue;
    const engDim = engByPosition.get(nedDim.Position!);
    if (!engDim || engDim.Type !== nedDim.Type) {
      report.push(`    dim "${nedDim.Key}": no structurally matching ENG dimension at position ${nedDim.Position} — curate its codes by hand.`);
      continue;
    }
    const nedCodes = await fetchCodes(spec.nedId, nedDim.Key);
    const engCodes = await fetchCodes(engId, engDim.Key);
    if (!nedCodes || !engCodes) {
      report.push(`    dim "${nedDim.Key}" -> "${engDim.Key}": code list fetch failed — curate its codes by hand.`);
      continue;
    }
    for (const code of codes) {
      const nl = nedCodes.get(code);
      const en = engCodes.get(code);
      if (nl === undefined || en === undefined) {
        report.push(`    dim "${nedDim.Key}" code "${code}": missing on one side — curate by hand.`);
        continue;
      }
      const nlDigits = (nl.match(/\d+/g) ?? []).join();
      const enDigits = (en.match(/\d+/g) ?? []).join();
      if (nlDigits !== enDigits && !isDutchExclusiveAgeRangePair(nl, en)) {
        report.push(`    dim "${nedDim.Key}" code "${code}": DIGIT MISMATCH "${nl}" -> "${en}" — CBS's own EN/NL wording disagree on the number here; do not use, flag for the owner.`);
        continue;
      }
      dimPairs.push({ nl, en, via: `${nedDim.Key}=${code}` });
      report.push(`    PAIRED dim "${nedDim.Key}" code ${code}: "${nl}" -> "${en}"`);
    }
  }

  // --- regions: the one real GeoDimension in the registry — its FULL code
  // list (skip municipalities, GM*, which read the same in English by
  // rule 4), paired by Key. ---
  const regionPairs: PairedLabel[] = [];
  const geoDim = nedProps.rows.find((r) => r.Type === 'GeoDimension' && r.Position !== null);
  if (geoDim) {
    const engGeoDim = engByPosition.get(geoDim.Position!);
    if (engGeoDim && engGeoDim.Type === 'GeoDimension') {
      const nedCodes = await fetchCodes(spec.nedId, geoDim.Key);
      const engCodes = await fetchCodes(engId, engGeoDim.Key);
      if (nedCodes && engCodes) {
        for (const [code, nl] of nedCodes) {
          if (code.startsWith('GM')) continue;
          const en = engCodes.get(code);
          if (en === undefined || en === nl) continue;
          regionPairs.push({ nl, en, via: `${geoDim.Key}=${code}` });
          report.push(`    PAIRED region ${code}: "${nl}" -> "${en}"`);
        }
      }
    }
  }

  report.push(`  measures: ${measurePairs.length} paired`);
  console.log(report.join('\n'));
  return { spec, hasSibling: true as const, titlePair, measurePairs, dimPairs, regionPairs };
}

/** A bare, generic Dutch dimension-value word that this registry reuses,
 * across DIFFERENT dimensions on DIFFERENT tables, to mean something
 * context-specific each time — never safe as a flat Dutch-string map entry,
 * even when exactly one of its occurrences happens to have a CBS English
 * sibling to derive a value from. 'Totaal' is the one confirmed case: CBS's
 * own English for 80590ned's Geslacht default (T001038) is 'Total sex' —
 * correct THERE, but 'Totaal' is also 03759ned's Leeftijd default (10000)
 * and 83932NED's Inkomensklassen default (T001226), on tables with no ENG
 * sibling to check against, where 'Total sex' would be flatly wrong. Add a
 * new entry here only after confirming (not assuming) the SAME risk — a
 * bare word this registry uses in more than one dimension. */
const AMBIGUOUS_BARE_WORDS: ReadonlySet<string> = new Set(['Totaal']);

/** Rule 3, widened in Fix round 1 to scan every reachable measure code (not
 * just each table's own registered primaries): collapse a list of pairs into
 * a Dutch -> English map, EXCLUDING any Dutch key that maps to more than one
 * distinct English value anywhere in this run. Returns the clean map plus
 * the excluded conflicts (reported, never silently resolved). */
function dedupeWithConflictCheck(pairs: PairedLabel[]): { map: Record<string, string>; conflicts: string[]; excludedAmbiguous: string[] } {
  const byNl = new Map<string, Set<string>>();
  for (const p of pairs) {
    if (!byNl.has(p.nl)) byNl.set(p.nl, new Set());
    byNl.get(p.nl)!.add(p.en);
  }
  const map: Record<string, string> = {};
  const conflicts: string[] = [];
  const excludedAmbiguous: string[] = [];
  for (const [nl, ens] of byNl) {
    if (AMBIGUOUS_BARE_WORDS.has(nl)) {
      excludedAmbiguous.push(`"${nl}": ${[...ens].map((e) => `"${e}"`).join(', ')}`);
      continue;
    }
    if (ens.size === 1) {
      map[nl] = [...ens][0]!;
    } else {
      conflicts.push(`"${nl}": ${[...ens].map((e) => `"${e}"`).join(' vs ')}`);
    }
  }
  return { map, conflicts, excludedAmbiguous };
}

function sortedObjectLiteral(map: Record<string, string>, indent = '  '): string {
  const keys = Object.keys(map).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return keys.map((k) => `${indent}${JSON.stringify(k)}: ${JSON.stringify(map[k])},`).join('\n');
}

function writeGeneratedFile(measureTitles: Record<string, string>, tableTitles: Record<string, string>, dimLabels: Record<string, string>, regions: Record<string, string>) {
  const content = `// GENERATED by \`npm run english-names:fetch\` (scripts/english-names-fetch.ts) —
// DO NOT HAND-EDIT. Every entry here was read directly off CBS's own public
// English (ENG) sibling tables (ADR 058, Task 3 Fix round 1) — a Dutch
// string that CBS itself never gave a matching English form for, or that
// CBS's own words genuinely disagree on across two reachable contexts (rule
// 3 — a conflict), is never written here; it is hand-curated instead in the
// sibling src/registry/english-names.data.ts, which composes its exported
// maps as \`{ ...CBS_X, ...HAND_X }\`. Re-run the fetch script to regenerate
// this file after a registry change (a new canonical measure, a new
// alternate, a new default coordinate) — hand edits here are silently
// overwritten on the next run and never reviewed as "the CBS source of
// truth" again.
//
// Pure data, no functions, no imports — same "table module" contract as
// english-names.data.ts (see that file's header): importable from anywhere,
// including the web client bundle, without pulling in any logic.

export const CBS_MEASURE_TITLES: Record<string, string> = {
${sortedObjectLiteral(measureTitles)}
};

export const CBS_TABLE_TITLES: Record<string, string> = {
${sortedObjectLiteral(tableTitles)}
};

export const CBS_DIM_LABELS: Record<string, string> = {
${sortedObjectLiteral(dimLabels)}
};

export const CBS_REGIONS: Record<string, string> = {
${sortedObjectLiteral(regions)}
};
`;
  writeFileSync(OUTPUT_FILE, content, 'utf8');
}

async function main() {
  const specs = buildTableSpecs();
  const results = [];
  for (const spec of specs) {
    results.push(await processTable(spec));
  }

  const allMeasurePairs = results.flatMap((r) => r.measurePairs);
  const allTitlePairs = results.map((r) => r.titlePair).filter((p): p is PairedLabel => p !== undefined);
  const allDimPairs = results.flatMap((r) => r.dimPairs);
  const allRegionPairs = results.flatMap((r) => r.regionPairs);

  const measures = dedupeWithConflictCheck(allMeasurePairs);
  const titles = dedupeWithConflictCheck(allTitlePairs);
  const dims = dedupeWithConflictCheck(allDimPairs);
  const regions = dedupeWithConflictCheck(allRegionPairs);

  writeGeneratedFile(measures.map, titles.map, dims.map, regions.map);

  console.log('\n=== SUMMARY ===');
  const noSibling = results.filter((r) => !r.hasSibling).map((r) => r.spec.nedId);
  const paired = results.filter((r) => r.hasSibling).map((r) => r.spec.nedId);
  console.log(`Tables with a CBS English sibling (${paired.length}): ${paired.join(', ')}`);
  console.log(`Tables with NO CBS English sibling (${noSibling.length}): ${noSibling.join(', ')}`);
  console.log(`Generated: ${Object.keys(measures.map).length} measure titles, ${Object.keys(titles.map).length} table titles, ${Object.keys(dims.map).length} dim labels, ${Object.keys(regions.map).length} regions.`);
  console.log(`Written to ${OUTPUT_FILE}`);

  const allConflicts = [
    ...measures.conflicts.map((c) => `measure title ${c}`),
    ...titles.conflicts.map((c) => `table title ${c}`),
    ...dims.conflicts.map((c) => `dim label ${c}`),
    ...regions.conflicts.map((c) => `region ${c}`),
  ];
  if (allConflicts.length > 0) {
    console.log(`\nCONFLICTS (${allConflicts.length}) — excluded from the generated file, hand-curate instead:`);
    for (const c of allConflicts) console.log(`  ${c}`);
  } else {
    console.log('\nNo conflicts.');
  }

  const allAmbiguous = [
    ...measures.excludedAmbiguous.map((c) => `measure title ${c}`),
    ...titles.excludedAmbiguous.map((c) => `table title ${c}`),
    ...dims.excludedAmbiguous.map((c) => `dim label ${c}`),
    ...regions.excludedAmbiguous.map((c) => `region ${c}`),
  ];
  if (allAmbiguous.length > 0) {
    console.log(`\nEXCLUDED AS AMBIGUOUS BARE WORDS (${allAmbiguous.length}) — a real CBS value exists but this exact Dutch word is reused with a different meaning elsewhere in the registry, so it is never safe as a flat map entry:`);
    for (const c of allAmbiguous) console.log(`  ${c}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
