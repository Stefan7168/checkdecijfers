// WP218 phase 4 (#219), Task 4 (design §4, docs/superpowers/specs/
// 2026-09-09-language-switch-design.md): CBS's own words for an English
// chart — NEVER machine translation (principles a/c). Every converter below
// is a hand-written, exact-match table (or a narrowly-scoped regex over the
// SPECIFIC shapes CBS's own data, or our own compose builder, actually
// produces — cited on each converter) and every one returns the INPUT
// UNCHANGED when nothing matches: an unrecognised string stays Dutch rather
// than being guessed at. A digit-invariance test (cbs-words.test.ts) pins
// that none of these ever touches a numeric token — R6's "every numeric
// token is a spec string" survives translation by construction.

// --- units -------------------------------------------------------------------
// Real CBS `Unit` values, read from tests/fixtures/cbs/*/measure-codes.json
// before writing this table (e.g. 85773NED: 'aantal', 'euro'; 85224NED:
// 'x 1 000'; 83693NED: 'gemiddelde saldo van de deelvragen', the actual unit
// of the curated Consumentenvertrouwen chart). Units already neutral in
// English ('%', 'x 1 000', an index base like '2025=100') need no entry —
// they pass through the "no match" default unchanged, matching the design's
// own "'x 1 000' stays, '%' stays" examples.
const UNIT_TABLE: Record<string, string> = {
  aantal: 'number',
  euro: 'euros',
  'mln euro': 'million euros',
  personen: 'persons',
  // Space-grouped, not 'per 1,000 inhabitants': a comma would MERGE the two
  // digit tokens '1'/'000' into one '1,000' token under the digit-invariance
  // regex (\d[\d.,]*) — found by that very test. Keeping the Dutch grouping
  // convention (already internationally legible) keeps every digit token
  // byte-identical, never introducing a formatting choice CBS didn't make.
  'per 1 000 inwoners': 'per 1 000 inhabitants',
  procentpunt: 'percentage point',
  promille: 'per mille',
  'gemiddelde saldo van de deelvragen': 'average balance of the sub-questions',
};

export function translateUnit(unit: string): string {
  return UNIT_TABLE[unit] ?? unit;
}

// --- regions -------------------------------------------------------------------
// 'Nederland' plus the three of the twelve provinces with an established
// English exonym (design §4). The other nine (Drenthe, Flevoland, Friesland,
// Gelderland, Groningen, Limburg, Overijssel, Utrecht, Zeeland) already read
// identically in English — no entry needed, the "no match" default covers
// them and every municipality automatically (municipalities never change).
const REGION_TABLE: Record<string, string> = {
  Nederland: 'the Netherlands',
  'Noord-Brabant': 'North Brabant',
  'Noord-Holland': 'North Holland',
  'Zuid-Holland': 'South Holland',
};

export function translateRegion(label: string): string {
  return REGION_TABLE[label] ?? label;
}

// --- measure titles ------------------------------------------------------------
// Seeded from the Ontdek curated set (src/chart/curated.ts's ONTDEK_CHARTS —
// each canonicalKey's `measureTitle`, src/registry/defaults.ts): the five
// titles a reader sees on the homepage today, i.e. `ChartSpec.title`
// (src/chart/build.ts: `title: firstCell.measureTitle`) for those five
// tables. An unseeded title (any measure outside this curated set) stays
// Dutch — expand this table as usage surfaces more, never guess a title.
const MEASURE_TITLE_TABLE: Record<string, string> = {
  Consumentenvertrouwen: 'Consumer confidence',
  'Bruto binnenlands product': 'Gross domestic product',
  'Jaarmutatie CPI': 'Annual change in CPI',
  'Gemiddelde verkoopprijs': 'Average sale price',
  Werkloosheidspercentage: 'Unemployment rate',
};

export function translateMeasureTitle(title: string): string {
  return MEASURE_TITLE_TABLE[title] ?? title;
}

// --- period labels ---------------------------------------------------------
// The exact shapes CBS's own Perioden dimension titles take — verified
// against tests/fixtures/cbs/85615NED/codes-Perioden.json ('2012 1e
// kwartaal': year first, then '{n}e kwartaal' — a bare year needs no rule
// since '2012' already reads the same in English) and
// tests/fixtures/cbs/83693NED/codes-Perioden.json ('1987 januari': year
// first, then the Dutch month name — flipped to English date order,
// 'January 1987', on translation). Anything else (an unrecognised shape, a
// provisional suffix like '2024*', two labels already joined into a range)
// is returned verbatim.
const MONTHS_NL_TO_EN: Record<string, string> = {
  januari: 'January',
  februari: 'February',
  maart: 'March',
  april: 'April',
  mei: 'May',
  juni: 'June',
  juli: 'July',
  augustus: 'August',
  september: 'September',
  oktober: 'October',
  november: 'November',
  december: 'December',
};

const QUARTER_LABEL_RE = /^(\d{4}) (\d)e kwartaal$/;
const MONTH_LABEL_RE = new RegExp(`^(\\d{4}) (${Object.keys(MONTHS_NL_TO_EN).join('|')})$`);
// A cumulative partial year ('2026 januari-april' — table 85429NED's current
// year, src/registry/defaults.ts): the year first, then a month RANGE. Kept
// as '2026 January-April' (year first, the range reads the same in English).
const MONTH_RANGE_LABEL_RE = new RegExp(
  `^(\\d{4}) (${Object.keys(MONTHS_NL_TO_EN).join('|')})-(${Object.keys(MONTHS_NL_TO_EN).join('|')})$`,
);

export function translatePeriodLabel(label: string): string {
  const quarter = QUARTER_LABEL_RE.exec(label);
  if (quarter) return `${quarter[1]} Q${quarter[2]}`;
  const month = MONTH_LABEL_RE.exec(label);
  if (month) return `${MONTHS_NL_TO_EN[month[2]!]} ${month[1]}`;
  const range = MONTH_RANGE_LABEL_RE.exec(label);
  if (range) return `${range[1]} ${MONTHS_NL_TO_EN[range[2]!]}-${MONTHS_NL_TO_EN[range[3]!]}`;
  return label;
}

// --- attribution line --------------------------------------------------------
// The ONE template `buildAttributionLine` produces (src/answer/compose/
// format.ts — read before writing this regex, per the task brief). Its real
// shape is:
//   `Bron: ${label}, tabel ${tableId} — ${tableTitle}. Gegevens
//    gesynchroniseerd op ${date}. Periode: ${period}. Licentie: ${license}.`
// — note this differs from an earlier draft of the design doc, which assumed
// a "versie {n}" field; there is no version in this line (that phrase
// belongs to a DIFFERENT template, answerProof.tableCaption in messages.ts,
// out of this task's scope). This function rewrites only the fixed skeleton
// words ('Bron:'->'Source:', 'tabel'->'table', 'Gegevens gesynchroniseerd
// op'->'Data synced on', 'Periode:'->'Period:', 'Licentie:'->'License:');
// every variable part (source label, table id, table title, synced date,
// period text, licence) is left byte-identical — the table title and period
// text embedded in this ONE sentence are not re-translated here (the
// chart's own title/period labels are translated separately, straight from
// the spec — see ChartView). A line that doesn't match this exact template
// (a future builder change, or already-translated text) is returned
// unchanged, never guessed.
const ATTRIBUTION_LINE_RE =
  /^Bron: (.+?), tabel (\S+) — (.+?)\. Gegevens gesynchroniseerd op (\d{4}-\d{2}-\d{2})\. Periode: (.+?)\. Licentie: (.+)\.$/;

/** `format.ts`'s own `${from} t/m ${to}` join (line 316) — the ONLY multi-
 * period shape this template's `period` field ever takes, so this is a
 * plain literal split, not a general Dutch-range parser. */
const PERIOD_RANGE_SEP = ' t/m ';

/** Final-review fix: an English chart's attribution line used to keep the
 * Dutch period text verbatim ('Periode: 2021 1e kwartaal.') while the axis
 * beside it (`ChartView`'s `displaySpec`) showed the translated form — the
 * one place the mixed languages collided on the same card. Runs the
 * captured period through the SAME `translatePeriodLabel` the axis already
 * uses, splitting a `t/m` range on each side first; a single period (no
 * `t/m`) is translated as one label. Digit-invariance holds by construction
 * — `translatePeriodLabel` itself never touches a digit token, and neither
 * does this split. */
function translateAttributionPeriod(period: string): string {
  const sepIndex = period.indexOf(PERIOD_RANGE_SEP);
  if (sepIndex === -1) return translatePeriodLabel(period);
  const from = period.slice(0, sepIndex);
  const to = period.slice(sepIndex + PERIOD_RANGE_SEP.length);
  return `${translatePeriodLabel(from)} to ${translatePeriodLabel(to)}`;
}

export function translateAttributionLine(line: string): string {
  const match = ATTRIBUTION_LINE_RE.exec(line);
  if (!match) return line;
  const [, label, tableId, tableTitle, date, period, license] = match;
  return `Source: ${label}, table ${tableId} — ${tableTitle}. Data synced on ${date}. Period: ${translateAttributionPeriod(period)}. License: ${license}.`;
}
