// Session 153 (#357 step 5): Dutch reader-facing labels for a Eurostat table read through its STRUCTURE (the
// table lane's general route). Eurostat's code lists are English; a Dutch reader saw "Welke Energy balance bedoel
// je?" and "1.893 Number". Cheapest mechanism first (CLAUDE.md): a reviewed list, applied by code, no AI, no
// schema change.
//
// Every entry is keyed by Eurostat's CODE and applies ONLY when Eurostat's own English label is exactly the one
// listed here — a code reused with another meaning keeps its English label rather than a wrong Dutch one. Anything
// not listed stays English (never guessed). The download path (the four curated datasets, jsonstat.ts) is not
// touched: their registrations and audit rows keep their labels.
//
// A unit keeps its meaning: '%' only for a plain percentage (the qualification moves to the measure title), a
// factor stays a factor ("Thousand persons" → "x 1 000 personen"), a rate keeps its base. R10 compares against
// the registered unit, which is this Dutch label from registration on.
//
// **Assumption:** the Dutch wording below is the session's draft, not yet owner-reviewed — mirrored in
// docs/open-questions.md (#357). Editing a label later changes the layout of tables registered after the edit
// only; a stored answer keeps the label it was given.

interface UnitLabel {
  /** Eurostat's own English unit label — the entry applies only to exactly this. */
  en: string;
  /** The registered unit shown next to every value. */
  unit: string;
  /** The unit as it reads in the measure title ("<dataset> — <title>"). */
  title: string;
}

const UNIT_LABELS: Record<string, UnitLabel> = {
  NR: { en: 'Number', unit: 'aantal', title: 'aantal' },
  PER: { en: 'Person', unit: 'personen', title: 'aantal personen' },
  THS_PER: { en: 'Thousand persons', unit: 'x 1 000 personen', title: 'x 1 000 personen' },
  PC: { en: 'Percentage', unit: '%', title: 'percentage' },
  PC_ACT: { en: 'Percentage of population in the labour force', unit: '%', title: '% van de beroepsbevolking' },
  PC_POP: { en: 'Percentage of total population', unit: '%', title: '% van de totale bevolking' },
  KG_HAB: { en: 'Kilograms per capita', unit: 'kg per inwoner', title: 'kg per inwoner' },
  THS_T: { en: 'Thousand tonnes', unit: 'x 1 000 ton', title: 'x 1 000 ton' },
  P_HTHAB: { en: 'Per hundred thousand inhabitants', unit: 'per 100 000 inwoners', title: 'per 100 000 inwoners' },
  P_MHAB: { en: 'Per million inhabitants', unit: 'per miljoen inwoners', title: 'per miljoen inwoners' },
};

/** Dimension titles by Eurostat's concept id, only for the common breakdowns. */
const DIMENSION_TITLES: Record<string, { en: string; nl: string }> = {
  sex: { en: 'Sex', nl: 'Geslacht' },
  age: { en: 'Age class', nl: 'Leeftijd' },
  citizen: { en: 'Country of citizenship', nl: 'Nationaliteit' },
  s_adj: { en: 'Seasonal adjustment', nl: 'Seizoencorrectie' },
};

/** Member titles that mean the same in every dimension. 'TOTAL'/'T' keep the code the total rule reads. */
const GENERIC_MEMBERS: Record<string, { en: string; nl: string }> = {
  TOTAL: { en: 'Total', nl: 'Totaal' },
  UNK: { en: 'Unknown', nl: 'Onbekend' },
};

const DIMENSION_MEMBERS: Record<string, Record<string, { en: string; nl: string }>> = {
  sex: {
    T: { en: 'Total', nl: 'Totaal' },
    M: { en: 'Males', nl: 'Mannen' },
    F: { en: 'Females', nl: 'Vrouwen' },
  },
  s_adj: {
    NSA: { en: 'Unadjusted data (i.e. neither seasonally adjusted nor calendar adjusted data)', nl: 'Niet gecorrigeerd' },
    SA: { en: 'Seasonally adjusted data, not calendar adjusted data', nl: 'Seizoengecorrigeerd' },
    CA: { en: 'Calendar adjusted data, not seasonally adjusted data', nl: 'Kalendergecorrigeerd' },
    SCA: { en: 'Seasonally and calendar adjusted data', nl: 'Seizoen- en kalendergecorrigeerd' },
    TC: { en: 'Trend cycle data', nl: 'Trend' },
  },
};

/** Eurostat's age codes, each only with its own English pattern: Y15-24 "From 15 to 24 years" (both ends
 * included), Y_LT15 "Less than 15 years", Y_GE65 "65 years or over". */
function ageMember(code: string, en: string): string | null {
  let m = /^Y(\d+)-(\d+)$/.exec(code);
  if (m && en === `From ${m[1]} to ${m[2]} years`) return `${m[1]} tot en met ${m[2]} jaar`;
  m = /^Y_LT(\d+)$/.exec(code);
  if (m && en === `Less than ${m[1]} years`) return `jonger dan ${m[1]} jaar`;
  m = /^Y_GE(\d+)$/.exec(code);
  if (m && en === `${m[1]} years or over`) return `${m[1]} jaar of ouder`;
  return null;
}

export function dutchUnitLabel(code: string, en: string): { unit: string; title: string } {
  const entry = UNIT_LABELS[code];
  return entry !== undefined && entry.en === en ? { unit: entry.unit, title: entry.title } : { unit: en, title: en };
}

export function dutchDimensionTitle(dimension: string, en: string): string {
  const entry = DIMENSION_TITLES[dimension];
  return entry !== undefined && entry.en === en ? entry.nl : en;
}

export function dutchMemberTitle(dimension: string, code: string, en: string): string {
  const specific = DIMENSION_MEMBERS[dimension]?.[code];
  if (specific !== undefined) return specific.en === en ? specific.nl : en;
  const generic = GENERIC_MEMBERS[code];
  if (generic !== undefined && generic.en === en) return generic.nl;
  if (dimension === 'age') return ageMember(code, en) ?? en;
  return en;
}
