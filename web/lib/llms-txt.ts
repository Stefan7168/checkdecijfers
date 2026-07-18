// #170(2): the honest llms.txt — hand-written prose header (Dutch product
// copy, public-claim wording exactly; never "0% hallucinatie") + a coverage
// body GENERATED from the live registry via buildCoverageReport, so the
// published list cannot drift from what the product actually serves.
//
// Serving posture mirrors web/lib/ontdek.ts (#53: the public surface never
// breaks): a small in-process TTL cache, stale-over-nothing on DB failure,
// and only when there has never been a successful build does the route
// answer 503 — an honest "try again later", never a silently empty coverage
// list (which a crawler would cache as "this product covers nothing").
import { buildCoverageReport } from '../backend/registry/coverage.ts';
import type { CoverageReport } from '../backend/registry/coverage.ts';
import { getDb } from './db.ts';

const TTL_MS = 30 * 60 * 1000;

let cache: { at: number; body: string } | null = null;
let inflight: Promise<string | null> | null = null;

/** Test seam: reset the module-scope cache between cases. */
export function resetLlmsTxtCache(): void {
  cache = null;
  inflight = null;
}

function dateOnly(iso: string | null): string | null {
  if (iso === null) return null;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(iso);
  return match ? match[0] : null;
}

/** Pure renderer — exported for tests. `generatedAt` is injected so renders
 * are deterministic under test. */
export function renderLlmsTxt(report: CoverageReport, generatedAt: string): string {
  const served = report.tables.filter((t) => t.status === 'active');
  const inReview = report.tables.length - served.length;

  const lines: string[] = [
    '# Check de Cijfers',
    '',
    '> Chat-antwoorden over officiële CBS-statistieken. Deterministische code berekent elk cijfer;',
    '> het taalmodel parseert alleen de vraag en verwoordt gevalideerde resultaten. Elk getal is',
    '> herleidbaar naar een officiële CBS-cel, met bron en datum getoond.',
    '',
    `Gegenereerd op ${dateOnly(generatedAt) ?? generatedAt} — dit bestand wordt live opgebouwd uit ons`,
    'tabellenregister, zodat de dekking hieronder niet kan achterlopen op wat het product werkelijk kan.',
    '',
    '## Hoe het werkt',
    '',
    '- Alle cijfers komen uit CBS-tabellen die vooraf in onze eigen database zijn geladen en',
    '  gevalideerd (bulk-ingest). Op het antwoordpad wordt nooit live bij CBS opgevraagd.',
    '- Het taalmodel berekent of interpreteert nooit zelf ruwe tabellen. Deterministische code zoekt',
    '  de cellen op, valideert het resultaat en controleert de uiteindelijke zin tegen de brongegevens',
    '  voordat die wordt getoond.',
    '- Bij ontbrekende, dubbelzinnige of verouderde data weigert het product of vraagt het door — het',
    '  gokt nooit ("geen antwoord = geen gok").',
    '- Elk antwoord toont het CBS-tabel-ID, de tabeltitel, onze laatste synchronisatiedatum en de',
    '  gedekte periode. Voorlopige CBS-cijfers zijn expliciet gemarkeerd als "voorlopig".',
    '- Ontbreekt een tabel? Ingelogde gebruikers kunnen die on demand laten toevoegen: het systeem',
    '  haalt de tabel op, verifieert en slaat op — pas daarna wordt geantwoord.',
    '',
    '## Wat we niet beloven',
    '',
    '- Geen absolute claims zoals "0% hallucinatie". Onze claim is herleidbaarheid: elk getal is te',
    '  herleiden naar een officiële CBS-cel, met bron en datum getoond.',
    '- Onze kopie kan achterlopen op een verse CBS-release; de synchronisatiedatum per tabel hieronder',
    '  is de gemeten stand, geen belofte.',
    '- Er is nog geen publieke API en geen MCP-endpoint.',
    '',
    '## Dekking (gegenereerd uit het register)',
    '',
  ];

  for (const table of served) {
    const synced = dateOnly(table.lastSyncAt);
    const suffix = synced === null ? '' : ` (gesynchroniseerd ${synced})`;
    lines.push(`- CBS ${table.id} — ${table.title}${suffix}`);
    if (table.measures.length > 0) {
      lines.push(`  - begrippen: ${table.measures.map((m) => m.label).join('; ')}`);
    }
  }
  if (inReview > 0) {
    lines.push(
      '',
      `NB: ${inReview} tabel(len) staan tijdelijk in revisie en worden niet geserveerd totdat een`,
      'mens ze heeft beoordeeld.',
    );
  }

  lines.push(
    '',
    '## Bron en licentie',
    '',
    '- Alle data: CBS (Centraal Bureau voor de Statistiek), via StatLine — https://opendata.cbs.nl.',
    '  Licentie: CC BY 4.0.',
    '- Antwoorden zijn bewerkingen van CBS-gegevens door checkdecijfers.nl.',
    '',
  );
  return lines.join('\n');
}

/** The cached llms.txt body, or null when no build has ever succeeded. */
export async function loadLlmsTxtBody(): Promise<string | null> {
  if (cache !== null && Date.now() - cache.at < TTL_MS) return cache.body;
  if (inflight === null) {
    inflight = (async () => {
      try {
        const report = await buildCoverageReport(getDb());
        const body = renderLlmsTxt(report, new Date().toISOString());
        cache = { at: Date.now(), body };
        return body;
      } catch (err) {
        console.warn('[llms.txt] coverage unavailable, serving previous version if any:', err);
        // Stale-over-nothing; cache untouched so the next request retries.
        return cache?.body ?? null;
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}
