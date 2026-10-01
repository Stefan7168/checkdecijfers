// The front door's meaning step (session 153, #362, ADR 062 "As built — the
// front door"). The catalogue search is word-based: a reader's everyday word
// ("getrouwd", "te zwaar", "huisvuil") often shares no word with the formal
// noun in a CBS table title ("huwelijkssluitingen", "overgewicht",
// "huishoudelijk afval"). Measured: 9 of the 10 front-door misses were this.
// This step asks the cheap model for a few CBS-style search words; the finder
// searches them exactly like a question (recall 'any' mode), and the rerank
// still judges against the reader's own question.
//
// Principle (a): the model proposes SEARCH WORDS only — never a table, a
// code or a number. Every table still comes from our catalogue mirror and is
// re-judged by the rerank and the table lane's own checks. Called by the
// question finder only, and only when the whole-question search found no
// confident table (src/ingestion/onboarding-finder.ts).
import type { LlmClient, LlmRequest } from '../answer/llm/client.ts';

/** Cheap tier: a short list of nouns from one sentence. */
export const SEARCH_TERMS_MODEL = 'claude-haiku-4-5';

/** At most this many terms are used, each at most this long (a guard, not a goal). */
export const SEARCH_TERMS_MAX = 6;
const TERM_MAX_LENGTH = 40;

const SYSTEM_PROMPT = `Je helpt een zoekfunctie over de titels van CBS-tabellen (Nederlandse officiële statistiek). Je krijgt één vraag van een gebruiker. Geef 2 tot ${SEARCH_TERMS_MAX} Nederlandse zoektermen zoals ze in titels en beschrijvingen van CBS-tabellen staan: zelfstandige naamwoorden in de formele vorm die het CBS gebruikt, in plaats van de woorden van de gebruiker. Bijvoorbeeld "verhuisd" → "verhuizingen", "gestopt met werken" → "pensionering", "hoeveel mensen wonen alleen" → "eenpersoonshuishoudens".
- Alleen het onderwerp: geen jaartallen, geen plaatsnamen, geen vraagwoorden, geen getallen.
- Verzin geen tabelnamen of codes.
- Is de vraag geen vraag naar statistiek, geef dan een lege lijst.
Antwoord uitsluitend met JSON volgens het opgegeven schema.`;

export function buildSearchTermsRequest(question: string, model: string = SEARCH_TERMS_MODEL): LlmRequest {
  return {
    model,
    maxTokens: 256,
    temperature: 0,
    system: SYSTEM_PROMPT,
    question,
    jsonSchema: {
      type: 'object',
      properties: { terms: { type: 'array', items: { type: 'string' } } },
      required: ['terms'],
      additionalProperties: false,
    },
  };
}

/** The validated terms: letters (incl. accents), spaces, hyphens and
 * apostrophes only, trimmed, non-empty, deduplicated, capped. Anything else
 * is dropped, never repaired. Malformed output → []. */
export function validateSearchTerms(outputText: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    return [];
  }
  const terms = (parsed as { terms?: unknown })?.terms;
  if (!Array.isArray(terms)) return [];
  const out = new Set<string>();
  for (const t of terms) {
    if (typeof t !== 'string') continue;
    const term = t.trim().toLowerCase();
    if (term.length === 0 || term.length > TERM_MAX_LENGTH) continue;
    if (!/^[a-zà-ÿ' -]+$/.test(term)) continue;
    out.add(term);
    if (out.size >= SEARCH_TERMS_MAX) break;
  }
  return [...out];
}

/** The search words for one question; [] on any failure (the caller then
 * keeps its no-pick outcome — a failed meaning step is never a pick). */
export async function suggestSearchTerms(question: string, client: LlmClient): Promise<string[]> {
  try {
    const response = await client.complete(buildSearchTermsRequest(question));
    return validateSearchTerms(response.outputText);
  } catch {
    return [];
  }
}

/** Session 153 (#357 step 3, the Dutch → English bridge): Eurostat's
 * catalogue is English, so a Dutch question shares no word with it (measured:
 * 0/12 Dutch Eurostat questions in the shortlist, 10/12 for the same
 * questions asked in English). This English variant proposes the words a
 * Eurostat dataset title would use. A SEPARATE prompt — the Dutch one above
 * stays byte-identical. Used only where Eurostat rows can be found
 * (EUROSTAT_FINDER_ENABLED, dark); proposes search words only, never a dataset. */
const SYSTEM_PROMPT_EN = `You help a search over the titles of Eurostat datasets (official European statistics). You receive one user question, often in Dutch. Give 2 to ${SEARCH_TERMS_MAX} English search terms as they appear in Eurostat dataset titles: the formal statistical nouns Eurostat uses, not the user's words. For example "zzp'ers" → "self-employed persons", "fijnstof" → "particulate matter", "uitgaven aan onderwijs" → "education expenditure".
- Topic only: no years, no country or place names, no question words, no numbers.
- Never invent dataset names or codes.
- If the question is not a statistics question, give an empty list.
Answer only with JSON following the given schema.`;

export function buildEnglishSearchTermsRequest(question: string, model: string = SEARCH_TERMS_MODEL): LlmRequest {
  return { ...buildSearchTermsRequest(question, model), system: SYSTEM_PROMPT_EN };
}

/** English search words for one question; [] on any failure (never a pick). */
export async function suggestEnglishSearchTerms(question: string, client: LlmClient): Promise<string[]> {
  try {
    const response = await client.complete(buildEnglishSearchTermsRequest(question));
    return validateSearchTerms(response.outputText);
  } catch {
    return [];
  }
}

