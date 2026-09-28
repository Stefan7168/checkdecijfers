// Breadth step 3, Task 2 — fetches REAL CBS breakdown-dimension member lists
// for the measured total-rule test cases (constraints.md) and writes
// tests/fixtures/cbs-breakdowns/sample.json. A tiny, committed, one-off
// research script (not part of the app) — Task 2's tests read only the
// written fixture, never the network.
//
// Each case truncates the member list to the first 30 (CBS order preserved)
// and separately records the TRUE total member count, so the fixture stays
// small while `findGrandTotal`/`classifyDimension` can still be exercised
// against the real first-30 CBS order.
//
// Usage (network required, not CI):
//   node --import ./scripts/force-ipv4.mjs scripts/research/extract-breakdown-samples.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://datasets.cbs.nl/odata/v1/CBS';
const OUT = fileURLToPath(new URL('../../tests/fixtures/cbs-breakdowns/sample.json', import.meta.url));
const MAX_MEMBERS = 30;

interface Case {
  /** Stable id for the test file to key its assertions on — describes the
   * measured trap/case from constraints.md, not the raw table/dim pair. */
  id: string;
  table: string;
  dimension: string;
  /** One-line note on what this case is measuring — carried into the fixture
   * so a future reader doesn't have to cross-reference the brief. */
  note: string;
}

const CASES: Case[] = [
  { id: 'geslacht_single_first_t00', table: '03759ned', dimension: 'Geslacht', note: 'single total candidate, first member, T00 code' },
  { id: 'klimaatsectoren_several_first_only_t00', table: '85669NED', dimension: 'Klimaatsectoren', note: 'several "; totaal"-suffixed candidates, but the first member is the ONLY one with a T00 code' },
  { id: 'kenmerken_paar_trap', table: '83842NED', dimension: 'KenmerkenVanHuishoudens', note: '"Type: Paar, totaal" is a sub-total, not first — first member is not a candidate at all' },
  { id: 'watergebruikers_t00_not_first', table: '82883NED', dimension: 'Watergebruikers', note: 'a T00-coded member exists (T001081) but is not first; first member is not a candidate' },
  { id: 'leeftijd_two_totals', table: '84521NED', dimension: 'Leeftijd', note: '"Totaal leeftijd" (first) + "Totaal, gestandaardiseerd" (T00 code, not first) — two different statistics' },
  { id: 'nationaliteit_subgroup_totaal', table: '83191NED', dimension: 'Nationaliteit', note: '"Nederlands (totaal)" is a subgroup label, not a candidate (no comma/semicolon before "totaal")' },
  { id: 'bedrijfsgrootte_no_total', table: '86116NED', dimension: 'Bedrijfsgrootte', note: 'no member matches the candidate rule at all' },
  { id: 'voertuigtype_several_first_not_t00', table: '85245NED', dimension: 'VoertuigType', note: 'first member IS a "Totaal"-titled candidate, but a second "Totaal"-titled candidate also exists and neither has a T00 code — ask' },
  // Marges convention: measured 2026-09-28 to hold in 83052NED (MW00000 'Waarde').
  { id: 'marges', table: '83052NED', dimension: 'Marges', note: 'margins dimension — resolves to the member titled exactly "Waarde" (MW00000)' },
  // Geo-like: verified live that 71476ned/Waterkwaliteitsbeheerders does NOT
  // qualify (only 1/30 = 3.3% of its codes match the ^(NL|PV|GM|LD|CR|WK|BU)\d
  // regex — its codes are mostly 'WS..', a prefix outside the measured rule).
  // 86211NED/AlleRegioIndelingen genuinely is geo-like (18,235 members, 100%
  // match in the first 30) and a non-GeoDimension `Dimension` kind, so it is
  // used instead — per the brief's "pick another from the same class" clause.
  { id: 'geo_like_alle_regio_indelingen', table: '86211NED', dimension: 'AlleRegioIndelingen', note: 'geo-like: kind Dimension (not GeoDimension), codes ~100% match the region-prefix regex — handled by the region resolver, never the total rule' },
];

async function fetchJson(url: string): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

async function fetchDimensionMeta(table: string, dimension: string): Promise<{ kind: string; title: string }> {
  const doc = await fetchJson(`${BASE}/${table}/Dimensions`);
  const row = (doc.value as any[]).find((r) => r.Identifier === dimension);
  if (!row) {
    throw new Error(`${table}/Dimensions has no row for '${dimension}' — the live catalog no longer matches the expected case, STOP`);
  }
  return { kind: String(row.Kind), title: String(row.Title ?? '') };
}

async function fetchMembers(table: string, dimension: string): Promise<{ code: string; title: string }[]> {
  const doc = await fetchJson(`${BASE}/${table}/${dimension}Codes`);
  const rows = doc.value as any[];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${table}/${dimension}Codes returned no members — the live catalog no longer matches the expected case, STOP`);
  }
  return rows.map((r) => ({ code: String(r.Identifier), title: String(r.Title) }));
}

async function main() {
  const results: unknown[] = [];
  for (const c of CASES) {
    console.log(`fetching ${c.table}/${c.dimension} (${c.id})...`);
    const [meta, members] = await Promise.all([
      fetchDimensionMeta(c.table, c.dimension),
      fetchMembers(c.table, c.dimension),
    ]);
    results.push({
      id: c.id,
      table: c.table,
      dimension: c.dimension,
      note: c.note,
      kind: meta.kind,
      title: meta.title,
      totalMemberCount: members.length,
      members: members.slice(0, MAX_MEMBERS),
    });
    console.log(`  ${c.table}/${c.dimension}: ${members.length} members (kind ${meta.kind}, title "${meta.title}")`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), cases: results }, null, 1) + '\n');
  console.log(`\nWrote ${results.length} case(s) -> ${OUT}`);
}

await main();
