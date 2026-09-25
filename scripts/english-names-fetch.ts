// ADR 058 (English answers, Task 3): fetches CBS's own English (ENG) sibling
// tables for every registered CBS table and reports, per table, which table
// title / measure titles / dimension-value labels the product actually shows
// (docs/05-data-rules.md principle c — never guess) can be read straight off
// CBS's own English words, versus which have no CBS-published English form
// and must be hand-curated by a session (reading the Dutch definition text)
// into src/registry/english-names.data.ts.
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
// Pairing rules (task-3-brief.md rules 1-4), implemented literally:
//  - table title: TableInfos' own `Title` field, NED -> ENG, paired directly.
//  - measures: DataProperties rows of Type 'Topic' (CBS v3's leaf measure
//    type across every registered table) are paired by `Position`, and ONLY
//    kept when Type, Decimals AND Unit also agree on both sides. Unit is
//    compared after normalising case/hyphenation/plural-s (CBS's own English
//    units are not always byte-identical in spelling to a literal
//    translation — e.g. 'average balance of the subquestions' vs the hand-
//    written 'average balance of the sub-questions', or 'euro' vs 'euros' —
//    the normaliser exists so a real, position-verified pairing isn't
//    thrown away over wording noise; two GENUINELY different units still
//    fail this check because their normalised forms differ).
//  - dimensions: matched by Position too (NED/ENG use different Keys for the
//    same dimension, e.g. TypeGefailleerde/TypeOfBankruptcy), then their code
//    lists are paired by `Key` (rule 2: codes are language-neutral) — but
//    only for the SPECIFIC codes the registry actually uses (a table's
//    defaultCoordinates, a canonical measure's own `dims`, and its
//    `alternates[].dims`), never a table's full code list, per rule 4 ("only
//    labels the product can show are needed").
//  - conflict: the same Dutch string pairing to two different English
//    strings across tables is reported, never silently resolved either way
//    (rule 3).
//
// This script only REPORTS (it never writes english-names.data.ts) — turning
// a "paired"/"no sibling" report into hand-curated entries, reviewing a
// wording surprise (CBS's own English can read as a non-literal translation
// — that's still correct, never a guess), and running the digit-invariance
// test are a session's own job (task-3-brief.md step 4), the same way rule 5
// ("write the English by hand ... reading the Dutch table's own definition
// text first") is inherently a human step.
//
//   npm run english-names:fetch
import { CANONICAL_MEASURES, TABLE_REGISTRY_DEFAULTS } from '../src/registry/defaults.ts';
import { translateUnit } from '../src/registry/english-names.ts';

const CBS_BASE = 'https://opendata.cbs.nl/ODataApi/odata';
const TIMEOUT_MS = 25_000;

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

interface TableSpec {
  num: string;
  nedId: string;
  defaultCoordinates: Record<string, string>;
  /** dim name -> set of codes actually used by this table's default
   * coordinates plus every canonical measure (and its alternates) on it —
   * the "only labels the product can show" scope from rule 4. */
  codesOfInterest: Map<string, Set<string>>;
  /** `measureTitle` (normalised) of every canonical measure registered on
   * this table — the only measures rule 4 needs a pairing for. A table like
   * 85880NED carries 200+ unrelated Topics (every national-accounts line
   * item); reporting those would bury the ones the product actually shows,
   * and would raise false "conflicts" for generic words (Totaal, Saldo) that
   * legitimately mean different things at different positions in the SAME
   * table — never a real cross-table conflict. */
  registeredMeasureTitles: Set<string>;
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
      registeredMeasureTitles: new Set(),
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
    spec.registeredMeasureTitles.add(normalizeLabel(m.measureTitle));
  }
  return [...specs.values()];
}

/** A registered composite measureTitle (e.g. "Waarde / Ontwikkeling t.o.v.
 * jaar eerder / Ongecorrigeerd") is a session-assembled breadcrumb over a
 * multi-level CBS TopicGroup hierarchy, not literally any one Title field —
 * so it never matches a DataProperties row by equality. Match instead on the
 * LEAF segment (after the last '/'), trimmed: that leaf IS a real CBS Title
 * for a Topic at some position, and is what this function uses to flag the
 * position as "registered" so the report doesn't drown it in noise. The
 * composite string itself still needs a session to hand-assemble its English
 * form (rule 5) — this only stops the report from hiding the one row that
 * makes that assembly possible. */
function leafOf(measureTitle: string): string {
  const parts = measureTitle.split('/');
  return normalizeLabel(parts[parts.length - 1]!);
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
    return { spec, hasSibling: false as const };
  }
  if (!nedTitle.ok) {
    report.push(`  NED TableInfos failed unexpectedly (${nedTitle.reason}) — skipping.`);
    console.log(report.join('\n'));
    return { spec, hasSibling: false as const };
  }

  const titlePair: PairedLabel = { nl: nedTitle.title, en: engTitle.title, via: 'table title' };
  report.push(`  table title: "${titlePair.nl}" -> "${titlePair.en}"`);

  const nedProps = await fetchDataProperties(spec.nedId);
  const engProps = await fetchDataProperties(engId);
  if (!nedProps.ok || !engProps.ok) {
    report.push(`  DataProperties fetch failed (NED: ${nedProps.ok ? 'ok' : nedProps.reason}, ENG: ${engProps.ok ? 'ok' : engProps.reason}) — skipping measures/dims.`);
    console.log(report.join('\n'));
    return { spec, hasSibling: true as const, titlePair, measurePairs: [], unpaired: [], dimPairs: [] };
  }

  const engByPosition = new Map<number, DataPropRow>();
  for (const row of engProps.rows) if (row.Position !== null) engByPosition.set(row.Position, row);

  const leaves = new Set([...spec.registeredMeasureTitles].map(leafOf));
  const measurePairs: PairedLabel[] = [];
  const unpaired: string[] = [];
  for (const row of nedProps.rows) {
    if (row.Type !== 'Topic' || row.Position === null) continue;
    const nlRaw = normalizeLabel(row.Title);
    if (!spec.registeredMeasureTitles.has(nlRaw) && !leaves.has(nlRaw)) continue;
    const eng = engByPosition.get(row.Position);
    const nl = nlRaw;
    if (!eng || eng.Type !== row.Type || eng.Decimals !== row.Decimals) {
      unpaired.push(`${nl} (position ${row.Position}: no structurally matching ENG entry)`);
      continue;
    }
    const nedUnit = row.Unit ?? '';
    const engUnit = eng.Unit ?? '';
    const nedUnitTranslated = translateUnitLoose(nedUnit);
    if (unitKey(nedUnitTranslated) !== unitKey(engUnit) && unitKey(nedUnit) !== unitKey(engUnit)) {
      unpaired.push(`${nl} (position ${row.Position}: unit mismatch "${nedUnit}" vs "${engUnit}")`);
      continue;
    }
    measurePairs.push({ nl, en: normalizeLabel(eng.Title), via: `position ${row.Position}` });
  }
  report.push(`  measures: ${measurePairs.length} paired, ${unpaired.length} unpaired`);
  for (const p of measurePairs) report.push(`    PAIRED  "${p.nl}" -> "${p.en}" (${p.via})`);
  for (const u of unpaired) report.push(`    UNPAIRED ${u}`);

  // Dimension code pairing, scoped to the codes the registry actually uses.
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
      if (nlDigits !== enDigits) {
        report.push(`    dim "${nedDim.Key}" code "${code}": DIGIT MISMATCH "${nl}" -> "${en}" — CBS's own EN/NL wording disagree on the number here; do not use, flag for the owner.`);
        continue;
      }
      dimPairs.push({ nl, en, via: `${nedDim.Key}=${code}` });
      report.push(`    PAIRED dim "${nedDim.Key}" code ${code}: "${nl}" -> "${en}"`);
    }
  }

  console.log(report.join('\n'));
  return { spec, hasSibling: true as const, titlePair, measurePairs, unpaired, dimPairs };
}

async function main() {
  const specs = buildTableSpecs();
  const results = [];
  for (const spec of specs) {
    results.push(await processTable(spec));
  }

  // Cross-table conflict detection (rule 3): the same Dutch string pairing to
  // two different English strings anywhere in this run.
  const seen = new Map<string, { en: string; table: string }>();
  const conflicts: string[] = [];
  for (const r of results) {
    if (!r.hasSibling) continue;
    const pairs = [r.titlePair, ...r.measurePairs, ...r.dimPairs].filter(Boolean) as PairedLabel[];
    for (const p of pairs) {
      const prior = seen.get(p.nl);
      if (prior && prior.en !== p.en) {
        conflicts.push(`"${p.nl}": "${prior.en}" (${prior.table}) vs "${p.en}" (${r.spec.nedId})`);
      } else {
        seen.set(p.nl, { en: p.en, table: r.spec.nedId });
      }
    }
  }

  console.log('\n=== SUMMARY ===');
  const noSibling = results.filter((r) => !r.hasSibling).map((r) => r.spec.nedId);
  const paired = results.filter((r) => r.hasSibling).map((r) => r.spec.nedId);
  console.log(`Tables with a CBS English sibling (${paired.length}): ${paired.join(', ')}`);
  console.log(`Tables with NO CBS English sibling (${noSibling.length}): ${noSibling.join(', ')}`);
  if (conflicts.length > 0) {
    console.log(`\nCONFLICTS (${conflicts.length}) — emit neither side, curate by hand instead:`);
    for (const c of conflicts) console.log(`  ${c}`);
  } else {
    console.log('\nNo cross-table conflicts.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
