// Stage-2 rerank prompt (WP16 sub-part 1). Static + date-free (the reference
// clock never enters an LLM prompt — ADR 012 hash-stability). The system prompt
// is the model's role; serializeShortlist builds the user-turn payload (the
// topic + the numbered candidate list). Bumping RERANK_PROMPT_VERSION forces a
// fixture re-record (the prompt bytes are hashed).
import type { CatalogCandidate, FindTableQuery } from './types.ts';

/** v2 (WP27 stage A, ADR 027 D3a): the prompt became question-aware — the full
 *  user question rides along with the topic, and the rules weigh the QUESTION's
 *  shape (stock vs flow, level vs change) over topic-word overlap. This
 *  constant is documentation; the fixture re-record is forced by the prompt
 *  BYTES being hashed, not by this number. */
export const RERANK_PROMPT_VERSION = 2;

/** Per-candidate blurb budget in the prompt — caps tokens over a ~20-table
 *  shortlist while leaving enough text to disambiguate. */
const SUMMARY_MAX = 240;

// NOTE the "version is altijd 1" rule below refers to the OUTPUT schema's
// version literal (RERANK_SCHEMA_VERSION, validated by z.literal) — NOT to
// RERANK_PROMPT_VERSION above. Changing either side alone breaks every rerank.
const SYSTEM_PROMPT = `Je bent een classificatie-hulp voor checkdecijfers.nl, een dienst die vragen beantwoordt met officiële CBS-cijfers. Je krijgt de VOLLEDIGE VRAAG van een gebruiker (Nederlands), het ONDERWERP dat daaruit is gehaald, en een genummerde lijst KANDIDAAT-TABELLEN uit de CBS-catalogus. Kies de tabel die deze vraag het best kan beantwoorden.

Regels:
- Kies precies één table_id, LETTERLIJK overgenomen uit de lijst (inclusief hoofd-/kleine letters). Verzin nooit een id dat niet in de lijst staat.
- Beoordeel op de VOLLEDIGE VRAAG, niet alleen op woordoverlap met het onderwerp. Let op wat voor soort cijfer de vraag nodig heeft: een stand of totaal aantal op een moment ("hoeveel mensen zitten er in ..."), een in- of uitstroom of verandering ("hoeveel kwamen erbij"), een prijs, een index, een percentage. Een tabel waarvan de titel goed bij het onderwerp past maar die het verkeerde soort cijfer meet (bijvoorbeeld instroom en uitstroom terwijl de vraag om het totale aantal vraagt), is een slechte keuze.
- confidence is een getal tussen 0 en 1 en moet eerlijk zijn. Past geen enkele kandidaat duidelijk bij de vraag, kies dan de dichtstbijzijnde maar geef een LAGE confidence (onder 0,5). Alleen bij een duidelijke, ondubbelzinnige match geef je een hoge confidence.
- Geef de voorkeur aan tabellen met status "Regulier" (actueel bijgehouden) boven "Gediscontinueerd" of "Vervallen", TENZIJ de vraag expliciet om oude/historische cijfers vraagt.
- Geef de voorkeur aan de meest directe, landelijke tabel met totaalcijfers (bijvoorbeeld een kerncijfers-tabel) boven een niche- of deelonderwerp of een tabel die alleen uitsplitsingen naar persoons- of regiokenmerken biedt.
- alternativeIds: tot 3 andere table_ids UIT DE LIJST die de vraag ook zouden kunnen beantwoorden (als reserve, in volgorde van geschiktheid). Laat leeg als geen enkele andere kandidaat in de buurt komt.
- reading: één korte Nederlandse zin die je keuze uitlegt.
- version is altijd 1.

Antwoord uitsluitend met JSON volgens het opgegeven schema.`;

export function buildRerankSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

/** Collapses CBS's multi-line descriptions to a single trimmed, budgeted line. */
function condense(summary: string): string {
  const flat = summary.replace(/\s+/g, ' ').trim();
  return flat.length > SUMMARY_MAX ? `${flat.slice(0, SUMMARY_MAX)}…` : flat;
}

/** The user-turn payload: the full question + the topic + the numbered
 *  candidate list. The question leads — it carries the shape signal (stock vs
 *  flow) the topic term alone discards (ADR 027 D3a). */
export function serializeShortlist(query: FindTableQuery, shortlist: CatalogCandidate[]): string {
  const lines = shortlist.map((c, i) => {
    const blurb = condense(c.summary);
    return (
      `${i + 1}. id=${c.tableId} | status=${c.status ?? 'onbekend'} | type=${c.datasetType ?? 'onbekend'}\n` +
      `   titel: ${c.title}` +
      (blurb ? `\n   omschrijving: ${blurb}` : '')
    );
  });
  return (
    `Volledige vraag van de gebruiker: "${query.question}"\n` +
    `Onderwerp van de gebruiker: "${query.topic}"\n\nKandidaat-tabellen:\n${lines.join('\n')}`
  );
}
