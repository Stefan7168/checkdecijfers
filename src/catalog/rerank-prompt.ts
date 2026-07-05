// Stage-2 rerank prompt (WP16 sub-part 1). Static + date-free (the reference
// clock never enters an LLM prompt — ADR 012 hash-stability). The system prompt
// is the model's role; serializeShortlist builds the user-turn payload (the
// topic + the numbered candidate list). Bumping RERANK_PROMPT_VERSION forces a
// fixture re-record (the prompt bytes are hashed).
import type { CatalogCandidate } from './types.ts';

export const RERANK_PROMPT_VERSION = 1;

/** Per-candidate blurb budget in the prompt — caps tokens over a ~20-table
 *  shortlist while leaving enough text to disambiguate. */
const SUMMARY_MAX = 240;

const SYSTEM_PROMPT = `Je bent een classificatie-hulp voor checkdecijfers.nl, een dienst die vragen beantwoordt met officiële CBS-cijfers. Je krijgt een ONDERWERP van een gebruiker (Nederlands) en een genummerde lijst KANDIDAAT-TABELLEN uit de CBS-catalogus. Kies de tabel die dit onderwerp het best kan beantwoorden.

Regels:
- Kies precies één table_id, LETTERLIJK overgenomen uit de lijst (inclusief hoofd-/kleine letters). Verzin nooit een id dat niet in de lijst staat.
- confidence is een getal tussen 0 en 1 en moet eerlijk zijn. Past geen enkele kandidaat duidelijk bij het onderwerp, kies dan de dichtstbijzijnde maar geef een LAGE confidence (onder 0,5). Alleen bij een duidelijke, ondubbelzinnige match geef je een hoge confidence.
- Geef de voorkeur aan tabellen met status "Regulier" (actueel bijgehouden) boven "Gediscontinueerd" of "Vervallen", TENZIJ het onderwerp expliciet om oude/historische cijfers vraagt.
- Geef de voorkeur aan de meest directe, landelijke tabel over een niche- of deelonderwerp.
- alternativeIds: tot 3 andere table_ids UIT DE LIJST die ook zouden kunnen passen (om eventueel aan de gebruiker voor te leggen). Laat leeg als de keuze duidelijk is.
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

/** The user-turn payload: the topic + the numbered candidate list. */
export function serializeShortlist(topic: string, shortlist: CatalogCandidate[]): string {
  const lines = shortlist.map((c, i) => {
    const blurb = condense(c.summary);
    return (
      `${i + 1}. id=${c.tableId} | status=${c.status ?? 'onbekend'} | type=${c.datasetType ?? 'onbekend'}\n` +
      `   titel: ${c.title}` +
      (blurb ? `\n   omschrijving: ${blurb}` : '')
    );
  });
  return `Onderwerp van de gebruiker: "${topic}"\n\nKandidaat-tabellen:\n${lines.join('\n')}`;
}
