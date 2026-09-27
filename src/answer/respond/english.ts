// ADR 058 phase 2 (#332), Task 1: pure, DB-free English parameter helpers for
// the refusal/clarification builders (refusals.ts, meta.ts, respond.ts,
// intent/policy.ts). Each function here mirrors an existing Dutch helper
// byte-for-byte in CONTRACT (same inputs, same edge-case behaviour) while
// producing English prose — none of them touches the Dutch functions or
// strings themselves (CLAUDE.md: the Dutch path stays byte-identical).
//
// Purity is load-bearing, not incidental: this module and everything it
// imports must stay free of the database layer (src/db/, src/query/run.ts's
// runtime code, anything that opens a connection) so it can be unit-tested
// with zero DB fixture cost and so a future web-bundle reuse never risks
// pulling Postgres client code in. Every import below is either a pure leaf
// (src/sources/registry.ts declares itself one; src/registry/defaults.ts and
// src/registry/english-names.ts import only from each other/their own data
// files) or a `import type` (erased at compile time — src/answer/intent/
// types.ts's only value import from the query module is itself `import
// type`, so nothing runtime-couples back to query/db).
import { CANONICAL_MEASURES } from '../../registry/defaults.ts';
import { translateMeasureTitle, translateRegion } from '../../registry/english-names.ts';
import { resolveSource } from '../../sources/registry.ts';
import type { ClarifyAxis } from '../intent/types.ts';
import { ENGLISH_MEASURE_LABELS, ENGLISH_TOPIC_TERMS } from './english-measure-labels.ts';

// ---------------------------------------------------------------------------
// Periods — mirrors period-nl.ts's periodCodeToNl
// ---------------------------------------------------------------------------

const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const QUARTER_WORDS_EN = ['first', 'second', 'third', 'fourth'];

/** '2026MM06' -> 'June 2026'; '2025KW04' -> 'the fourth quarter of 2025';
 * '2024JJ00' -> '2024'. Unparseable/unrecognized codes render verbatim, same
 * never-fabricate contract as periodCodeToNl. */
export function periodCodeToEn(code: string): string {
  const match = /^(\d{4})(JJ|KW|MM)(\d{2})$/.exec(code);
  if (!match) return code;
  const [, yearStr, grain, seqStr] = match as unknown as [string, string, string, string];
  const year = Number.parseInt(yearStr, 10);
  const seq = Number.parseInt(seqStr, 10);

  if (grain === 'JJ') return `${year}`;
  if (grain === 'MM') {
    const month = MONTH_NAMES_EN[seq - 1];
    return month ? `${month} ${year}` : code;
  }
  if (grain === 'KW') {
    const word = QUARTER_WORDS_EN[seq - 1];
    return word ? `the ${word} quarter of ${year}` : code;
  }
  return code;
}

// ---------------------------------------------------------------------------
// Status suffix — mirrors refusals.ts's statusSuffixNl
// ---------------------------------------------------------------------------

/** English of every distinct provisionalDisplay VALUE across the registered
 * sources (src/sources/registry.ts SOURCES) — kept in sync BY HAND with
 * src/answer/translate/translate.ts's CAVEAT_TRANSLATIONS (that module is
 * not importable here: it pulls in lines.ts, which value-imports
 * isDerivedResult from the query module, i.e. the DB-coupled query/run.ts
 * graph — exactly what this file's purity contract rules out). The coverage
 * test (tests/answer/english-helpers.test.ts) pins that every CBS status
 * with a Dutch suffix also has an English one here, the same guarantee
 * translate.test.ts holds over CAVEAT_TRANSLATIONS itself. */
const CAVEAT_SUFFIX_EN: Readonly<Record<string, string>> = {
  ' (voorlopig cijfer)': ' (provisional figure)',
  ' (nader voorlopig cijfer)': ' (revised provisional figure)',
  ' (schatting)': ' (estimate)',
  ' (schatting door Eurostat)': ' (estimate by Eurostat)',
  ' (prognose)': ' (forecast)',
  ' (methodebreuk)': ' (break in series)',
  ' (vertrouwelijk)': ' (confidential)',
  ' (afwijkende definitie)': ' (different definition)',
  ' (lage betrouwbaarheid)': ' (low reliability)',
  ' (niet significant)': ' (not significant)',
};

/** English of statusSuffixNl(status, sourceKey): resolves the same source
 * registry entry, reads its Dutch provisionalDisplay suffix for `status`,
 * then looks up that Dutch suffix's fixed English form above. A status with
 * no Dutch suffix at all (the source's provisionalDisplay has no entry for
 * it — the "definitive, no marking" case) returns '' exactly like
 * statusSuffixNl. A Dutch suffix that DOES exist but has no English mapping
 * here is an internal coverage gap, not a value to guess at — it throws
 * (caught by the coverage test, never reachable in a green build). */
export function statusSuffixEn(status: string, sourceKey?: string): string {
  const dutch = resolveSource(sourceKey).provisionalDisplay[status] ?? '';
  if (!dutch) return '';
  const en = CAVEAT_SUFFIX_EN[dutch];
  if (en === undefined) {
    throw new Error(
      `internal: statusSuffixEn has no English mapped for Dutch suffix '${dutch}' (status '${status}') — extend CAVEAT_SUFFIX_EN`,
    );
  }
  return en;
}

// ---------------------------------------------------------------------------
// Measure label
// ---------------------------------------------------------------------------

/** ENGLISH_MEASURE_LABELS[key] when the canonical key is a known, hand-
 * translated entry; otherwise translateMeasureTitle(measureTitle) with its
 * first letter lower-cased (so it reads mid-sentence, matching
 * ENGLISH_MEASURE_LABELS' own lowercase convention) when a registry
 * measureTitle is available; otherwise the generic 'these figures' —
 * never a guess, never Dutch text left stranded in an English sentence. */
export function englishMeasureLabel(canonicalKey: string, measureTitle?: string | null): string {
  const known = ENGLISH_MEASURE_LABELS[canonicalKey];
  if (known) return known;
  if (measureTitle) {
    const translated = translateMeasureTitle(measureTitle);
    if (translated.length === 0) return 'these figures';
    return translated.charAt(0).toLowerCase() + translated.slice(1);
  }
  return 'these figures';
}

// ---------------------------------------------------------------------------
// Joining — English siblings of intent/policy.ts's joinOf
// ---------------------------------------------------------------------------

/** Joins with a connective, comma-separating everything before the last item
 * (no Oxford comma before the connective itself): 'A'; 'A {c} B';
 * 'A, B {c} C'. NOTE: the real Dutch `joinOf` (src/answer/intent/policy.ts)
 * is a plain `items.join(' of ')` — for 3+ items that reads 'A of B of C',
 * not the comma-separated grammar this function (and loadedTopicsCompactEn
 * below) deliberately use for their English prose, per this task's brief. */
function joinWithConnective(items: string[], connective: 'and' | 'or'): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} ${connective} ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} ${connective} ${items[items.length - 1]}`;
}

/** English of joinOf: 'A'; 'A or B'; 'A, B or C'. */
export function joinOfEn(items: string[]): string {
  return joinWithConnective(items, 'or');
}

// ---------------------------------------------------------------------------
// Cardinal numbers — English sibling of refusals.ts's cardinalNl
// ---------------------------------------------------------------------------

/** Same range as refusals.ts's SMALL_CARDINAL_NL (1-12, every cap this
 * module names today is small and fixed at build time). An unmapped value
 * THROWS rather than falling back to a digit — same contract as cardinalNl:
 * refusal/clarification prose never carries a bare cap digit. */
const SMALL_CARDINAL_EN: Readonly<Record<number, string>> = {
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
  11: 'eleven',
  12: 'twelve',
};

export function cardinalEn(n: number): string {
  const word = SMALL_CARDINAL_EN[n];
  if (word === undefined) {
    throw new Error(`internal: cardinalEn has no English word mapped for ${n} — extend SMALL_CARDINAL_EN`);
  }
  return word;
}

// ---------------------------------------------------------------------------
// Clarification axes — English sibling of refusals.ts's AXIS_NL/axesNl
// ---------------------------------------------------------------------------

const AXIS_EN: Record<ClarifyAxis, string> = {
  measure: 'which topic or definition you mean',
  region: 'for which region',
  period: 'for which period',
  derivation: 'which calculation you want',
};

/** English of axesNl: merges consecutive "for which X" phrases into "for
 * which X and Y" (mirrors the Dutch merge of consecutive "voor welke
 * X"-phrases), joining the rest with 'and'. */
export function axesEn(axes: ClarifyAxis[]): string {
  const phrases = axes.map((a) => AXIS_EN[a]);
  const merged: string[] = [];
  for (const phrase of phrases) {
    const last = merged[merged.length - 1];
    if (last?.startsWith('for which ') && phrase.startsWith('for which ')) {
      merged[merged.length - 1] = `${last} and ${phrase.slice('for which '.length)}`;
    } else {
      merged.push(phrase);
    }
  }
  return merged.join(' and ');
}

// ---------------------------------------------------------------------------
// Compact topic list — English sibling of refusals.ts's loadedTopicsCompact
// ---------------------------------------------------------------------------

/** English of loadedTopicsCompact(): the first English topic term of every
 * loaded canonical measure, same registry order, deduplicated (defensive —
 * no two canonical measures share an ENGLISH_TOPIC_TERMS entry today, but a
 * future one might), joined naturally ('a, b and c') rather than the flat
 * comma-only join the Dutch original uses — see joinWithConnective's note. */
export function loadedTopicsCompactEn(): string {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const m of CANONICAL_MEASURES) {
    const term = ENGLISH_TOPIC_TERMS[m.key];
    if (term && !seen.has(term)) {
      seen.add(term);
      terms.push(term);
    }
  }
  return joinWithConnective(terms, 'and');
}

// ---------------------------------------------------------------------------
// Fixed clarification option labels
// ---------------------------------------------------------------------------

/** Every fixed (non-templated) Dutch option string passed as a clarification
 * `options:` literal across src/answer (grepped: intent/resolve.ts,
 * intent/policy.ts, respond/refusals.ts), paired with its English label. The
 * envelope pairs {label: english, submit: dutch} — the Dutch string here is
 * always the exact `submit` value, never re-derived. */
export const FIXED_OPTION_EN: Readonly<Record<string, string>> = {
  'heel Nederland (landelijk cijfer)': 'the Netherlands as a whole (national figure)',
  'een specifieke gemeente of provincie — noem de naam': 'a specific municipality or province — name it',
  'heel Nederland': 'the Netherlands as a whole',
  'Toon de Eurostat-cijfers': 'Show the Eurostat figures',
};

// ---------------------------------------------------------------------------
// Region labels
// ---------------------------------------------------------------------------

/** CBS's disambiguating parenthetical suffix on a region label ("Utrecht
 * (gemeente)", "Utrecht (PV)" — src/sources/region-names.ts's baseLabel),
 * translated when translateRegion itself leaves it untouched (its REGIONS
 * table is keyed by bare region names, never a name+qualifier string, so it
 * never recognises the qualifier). '(LD)' (landsdeel) and '(CR)' (COROP
 * region) are not currently emitted by any real GeoDimension in the registry
 * (grepped: no hit) but are mapped defensively so a future one is not left
 * half-Dutch. */
const REGION_QUALIFIER_EN: Readonly<Record<string, string>> = {
  '(gemeente)': '(municipality)',
  '(PV)': '(province)',
  '(LD)': '(region)',
  '(CR)': '(COROP region)',
};

const REGION_QUALIFIER_RE = /^(.*?)\s*(\([^)]*\))\s*$/;

/** translateRegion(label), plus translating a trailing disambiguating
 * qualifier translateRegion itself leaves in Dutch (see REGION_QUALIFIER_EN
 * above). A label with no such qualifier is passed straight through to
 * translateRegion, unchanged from its own never-guess contract. */
export function regionLabelEn(label: string): string {
  const match = REGION_QUALIFIER_RE.exec(label);
  if (!match) return translateRegion(label);
  const [, base, suffix] = match;
  const baseEn = translateRegion(base ?? '');
  const suffixEn = suffix ? (REGION_QUALIFIER_EN[suffix] ?? suffix) : '';
  return suffix ? `${baseEn} ${suffixEn}` : baseEn;
}
