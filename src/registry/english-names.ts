// WP218 phase 4 (#219), Task 4 (design §4, docs/superpowers/specs/
// 2026-09-09-language-switch-design.md): CBS's own words for an English
// chart — NEVER machine translation (principles a/c). Every converter below
// is a hand-written, exact-match table (or a narrowly-scoped regex over the
// SPECIFIC shapes CBS's own data, or our own compose builder, actually
// produces — cited on each converter) and every one returns the INPUT
// UNCHANGED when nothing matches: an unrecognised string stays Dutch rather
// than being guessed at. A digit-invariance test (web/lib/i18n/cbs-words.test.ts)
// pins that none of these ever touches a numeric token — R6's "every numeric
// token is a spec string" survives translation by construction.
//
// ADR 058 (English answers, Task 2): moved here from web/lib/i18n/cbs-words.ts
// so the chart (web) and the English-answer translator (src/answer/translate)
// share ONE list instead of two that could drift apart. The literal tables
// (MEASURE_TITLES, REGIONS, UNITS, TABLE_TITLES, DIM_LABELS) now live in the
// sibling data file, english-names.data.ts. This file itself stays a PURE
// table module — no import from src/answer/ or anywhere else that would pull
// backend-only code into the web's client-side chart bundle (web/lib/i18n/
// cbs-words.ts imports this file's functions via the web/backend symlink).
// web/lib/i18n/cbs-words.ts is now a thin re-export of the functions below.
import { DIM_LABELS, MEASURE_TITLES, REGIONS, TABLE_TITLES, UNITS } from './english-names.data.ts';

export function translateUnit(unit: string): string {
  return UNITS[unit] ?? unit;
}

export function translateRegion(label: string): string {
  return REGIONS[label] ?? label;
}

export function translateMeasureTitle(title: string): string {
  return MEASURE_TITLES[title] ?? title;
}

/** ADR 058 (English answers, Task 2; filled by Task 3): CBS's own table
 * title (`ValidatedResult.attribution.tableTitle`), same never-guess
 * contract as every other converter here — an unseeded title (a future
 * registered table not yet run through scripts/english-names-fetch.ts) stays
 * Dutch. */
export function translateTableTitle(title: string): string {
  return TABLE_TITLES[title] ?? title;
}

/** ADR 058 (English answers, Task 2; filled by Task 3): a CBS non-region
 * dimension value label (`ResultCell.dimLabels`'s values), same never-guess
 * contract — an unseeded label stays Dutch. */
export function translateDimLabel(label: string): string {
  return DIM_LABELS[label] ?? label;
}

/** ADR 058 (English answers, Task 2): whether `dutch` has a real entry in the
 * named list — used to compute a `GlossaryEntry`'s `translated` flag without
 * duplicating each converter's own `?? title` fallback logic. `'region'`
 * checks the base (qualifier-stripped) label, matching how `translateRegion`
 * itself is always called (see glossaryForResult in
 * src/answer/translate/glossary.ts). */
export function hasEnglishName(kind: 'measure' | 'region' | 'table' | 'dim', dutch: string): boolean {
  switch (kind) {
    case 'measure':
      return Object.hasOwn(MEASURE_TITLES, dutch);
    case 'region':
      return Object.hasOwn(REGIONS, dutch);
    case 'table':
      return Object.hasOwn(TABLE_TITLES, dutch);
    case 'dim':
      return Object.hasOwn(DIM_LABELS, dutch);
  }
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
