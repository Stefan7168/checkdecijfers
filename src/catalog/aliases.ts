// Hand-maintained alias hints for Stage-1 recall (WP16 sub-part 1). CBS titles
// use official, sometimes renamed vocabulary; users type everyday or older
// terms. When a topic contains a trigger, its expansion terms are OR-ed into
// the full-text query so a table titled with the official term is still
// recalled. Curated in code (the CANONICAL_MEASURES/defaults.ts precedent), not
// a live lookup — provenance noted per entry.
//
// This is a STARTER SEED, deliberately small and honest. Growing it is cheap
// and reversible; the real driver is measured recall misses (open-questions —
// alias-hint seed list). Matching is lowercase substring (Dutch compounds make
// substring the right default: 'bijstand' should also fire inside
// 'bijstandsuitkering'); refine to word-boundary only if a false trigger shows
// up in measurement.

export interface AliasHint {
  /** Lowercase terms; if any appears in the (lowercased) topic, this hint fires. */
  triggers: string[];
  /** Extra query terms OR-ed into the full-text search when the hint fires. */
  expansions: string[];
  /** Why this mapping exists — the rename / colloquialism it bridges. */
  note: string;
}

export const ALIAS_HINTS: AliasHint[] = [
  {
    triggers: ['bijstand'],
    expansions: ['bijstand', 'bijstandsuitkering', 'algemene bijstand', 'participatiewet'],
    note: 'Bijstand is administered under de Participatiewet since 2015; CBS titles vary.',
  },
  {
    triggers: ['migratieachtergrond', 'allochtoon', 'allochtonen', 'autochtoon'],
    expansions: ['migratieachtergrond', 'herkomst', 'herkomstland', 'geboorteland'],
    note: 'CBS replaced allochtoon/autochtoon with herkomst/migratieachtergrond (2016/2022).',
  },
  {
    triggers: ['aow', 'pensioenleeftijd'],
    expansions: ['aow', 'pensioen', 'ouderdomspensioen', 'ouderdom'],
    note: 'AOW is the state old-age pension; titles say pensioen/ouderdom.',
  },
  {
    triggers: ['werkloosheid', 'werkloos', 'werkeloos', 'werkeloosheid'],
    expansions: ['werkloosheid', 'werkloze', 'werkzame beroepsbevolking', 'arbeidsdeelname'],
    note: 'Common misspelling (werkeloos) + the official "beroepsbevolking" framing.',
  },
  {
    triggers: ['huizenprijs', 'huizenprijzen', 'huizenmarkt', 'woningprijs', 'woningprijzen'],
    expansions: ['koopwoningen', 'verkoopprijzen', 'bestaande koopwoningen', 'prijsindex'],
    note: 'The CBS house-price series is titled "Bestaande koopwoningen; verkoopprijzen".',
  },
  {
    triggers: ['criminaliteit', 'misdaad'],
    expansions: ['criminaliteit', 'misdrijven', 'geregistreerde criminaliteit', 'verdachten'],
    note: 'Everyday "criminaliteit/misdaad" ↔ CBS "misdrijven / geregistreerde criminaliteit".',
  },
  {
    triggers: ['corona', 'covid'],
    expansions: ['covid', 'corona', 'sterfte'],
    note: 'Pandemic questions land on covid/sterfte tables.',
  },
  {
    triggers: ['co2', 'uitstoot', 'broeikasgas'],
    expansions: ['broeikasgas', 'emissies', 'uitstoot', 'kooldioxide'],
    note: 'CO2 questions ↔ CBS "broeikasgassen / emissies".',
  },
  {
    triggers: ['zonnepaneel', 'zonnepanelen', 'zonne-energie', 'zonne energie'],
    expansions: ['zonnestroom', 'zonne-energie', 'hernieuwbare elektriciteit'],
    note: 'Colloquial "zonnepanelen" ↔ CBS "zonnestroom" (measured recall gap, session 24).',
  },
  {
    triggers: ['inwoner', 'bevolking', 'hoeveel mensen wonen'],
    expansions: ['bevolking', 'inwoners', 'bevolkingsomvang'],
    note:
      'Everyday "inwoners / hoeveel mensen wonen er" ↔ CBS "Bevolking" tables. Measured ' +
      'recall gap (session 25): "hoeveel inwoners heeft nederland" AND-ed common words to ' +
      'zero recall; the OR-ed "bevolking" term surfaces 03759ned.',
  },
  {
    triggers: ['woningvoorraad', 'aantal woningen', 'hoeveel woningen', 'voorraad woningen'],
    expansions: ['woningvoorraad', 'voorraad woningen', 'woningen'],
    note:
      'Everyday "aantal woningen" ↔ CBS "Voorraad woningen" stock table (82235NED) — distinct ' +
      'from the "koopwoningen; verkoopprijzen" PRICE tables the huizenprijs hint targets. ' +
      'Measured recall gap (session 25): a bare "aantal woningen" recalled only price tables.',
  },
];

/**
 * The full-text query TERMS for a topic: the topic itself plus the expansions
 * of every alias hint it triggers, de-duplicated. The recall query OR-combines
 * a plainto_tsquery over each term.
 */
export function expandTopicTerms(topic: string, hints: AliasHint[] = ALIAS_HINTS): string[] {
  const lower = topic.toLowerCase();
  const terms = new Set<string>([topic]);
  for (const hint of hints) {
    if (hint.triggers.some((t) => lower.includes(t))) {
      for (const e of hint.expansions) terms.add(e);
    }
  }
  return [...terms];
}
