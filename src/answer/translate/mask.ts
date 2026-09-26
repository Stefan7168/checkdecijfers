// ADR 058 §2: numbers are made UNREPRESENTABLE to the translating model. Every
// digit-bearing registry name, period label, provisional marker and numeric
// token of a validated Dutch text becomes a digit-free placeholder before the
// model call; deterministic code puts them back in English notation
// afterwards. Placeholder ids are letters only, so a placeholder can never
// itself look like a number to the scanner.
import { findNumericTokens, normalizeForScan } from '../compose/format.ts';

export interface MaskEntry {
  placeholder: string;
  kind: 'number' | 'period' | 'caveat' | 'name';
  dutch: string;
  english: string;
}

export interface Masker {
  mask(text: string): string;
  readonly entries: MaskEntry[];
}

export const PLACEHOLDER_RE = /⟦[NPCG][a-z]+⟧/g;

/** Dutch notation → English notation by swapping the two separators only:
 * '.' (thousands) ↔ ',' (decimal). The digits never change, so the value is
 * provably the same number (round-trip tested). */
export function toEnglishNumberToken(token: string): string {
  return token.replace(/[.,]/g, (c) => (c === '.' ? ',' : '.'));
}

export function parseEnNumber(token: string): number {
  return Number.parseFloat(token.replaceAll(',', ''));
}

function letters(n: number): string {
  let s = '';
  let k = n;
  do {
    s = String.fromCharCode(97 + (k % 26)) + s;
    k = Math.floor(k / 26) - 1;
  } while (k >= 0);
  return s;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Final-review fix wave (ruling 17c): `\p{N}`, not `\p{Nd}` — a vulgar
 * fraction ('½'), a superscript ('²'), a Roman numeral ('Ⅻ') or a circled
 * number ('①') is a numeral too, and the model must never write one. */
export function hasDigitOutsidePlaceholders(text: string): boolean {
  return /\p{N}/u.test(text.replace(PLACEHOLDER_RE, ''));
}

/** Final-review fix wave (ruling 17a): the fixed unit/scale words that are
 * masked TOGETHER with the number they directly follow, so the model never
 * sees (and so can never swap) a unit: 'procentpunt' → 'percent' or 'mln' →
 * 'billion' is a fabricated number as surely as a changed digit. The English
 * side is fixed, never model-written. `%`/'procent' both render as '%'. */
const FIXED_UNIT_WORDS = ['procentpunten', 'procentpunt', 'procent', 'miljoen', 'miljard', 'mln', 'mld'];

function fixedUnitEnglish(unit: string, number: string): string | null {
  const u = unit.toLowerCase();
  if (u === '%' || u === 'procent') return '%';
  // 'percentage point' singular only when the number is exactly 1 (English
  // uses the plural for every other value, '1.0' and '0.5' included).
  if (u === 'procentpunt' || u === 'procentpunten') return /^-?1$/.test(number) ? ' percentage point' : ' percentage points';
  if (u === 'mln' || u === 'miljoen') return ' million';
  if (u === 'mld' || u === 'miljard') return ' billion';
  return null;
}

/** Units that are never masked with their number even when registered:
 * 'aantal' renders bare (template.ts displayValueUnit), and the fixed words
 * above have their own, fixed English. */
const NOT_A_REGISTERED_UNIT = new Set(['aantal', '%', ...FIXED_UNIT_WORDS]);

const PLACEHOLDER_LETTER: Record<MaskEntry['kind'], string> = {
  number: 'N',
  period: 'P',
  caveat: 'C',
  name: 'G',
};

export function createMasker(opts: {
  /** Ruling 9 (Task 6 fix round 1): CBS/registry NAMES that carry a digit in
   * their Dutch or English form (e.g. 'Bevolking op 1 januari' → 'Population
   * on 1 January', a table title '…vanaf 1921', a dim label '15 tot 75
   * jaar') — masked WHOLE, before anything else, so their digits never reach
   * the model AND the model never has to reproduce the digit-bearing name
   * literally (which would deadlock C5's "use the glossary name exactly"
   * against C2's "never write a digit"). Optional: most texts have none. */
  names?: { dutch: string; english: string }[];
  periodLabels: { dutch: string; english: string }[];
  caveats: { dutch: string; english: string }[];
  /** Final-review fix wave (ruling 17a): the result's registered unit strings
   * that have an English form in the shared name list (translateUnit) — a
   * number directly followed by one is masked together with it and filled
   * with '<English number> <English unit>'. Optional: the fixed unit/scale
   * words (%, procent, procentpunt(en), mln, mld, miljoen, miljard) are
   * always joined, registered or not. */
  units?: { dutch: string; english: string }[];
}): Masker {
  const entries: MaskEntry[] = [];
  let counter = 0;
  const next = (kind: MaskEntry['kind'], dutch: string, english: string): string => {
    const placeholder = `⟦${PLACEHOLDER_LETTER[kind]}${letters(counter++)}⟧`;
    entries.push({ placeholder, kind, dutch, english });
    return placeholder;
  };
  const byLength = <T extends { dutch: string }>(xs: T[]) =>
    [...xs].filter((x) => x.dutch.length > 0).sort((a, b) => b.dutch.length - a.dutch.length);
  const names = byLength(opts.names ?? []);
  const periods = byLength(opts.periodLabels);
  const caveats = byLength(opts.caveats);
  const registeredUnits = byLength(opts.units ?? []).filter((u) => !NOT_A_REGISTERED_UNIT.has(u.dutch.toLowerCase()));
  const registeredEnglish = new Map(registeredUnits.map((u) => [u.dutch.toLowerCase(), u.english]));
  // Longest first so 'mln euro' (registered) wins over the bare 'mln', and
  // 'procentpunten' over 'procentpunt' over 'procent'. A word unit needs
  // whitespace before it and a word end after it; '%' may sit glued or after
  // one space ('3,5%' and '3,8 %' both occur).
  const wordUnits = [...registeredUnits.map((u) => u.dutch), ...FIXED_UNIT_WORDS].sort((a, b) => b.length - a.length);
  const UNIT_AFTER = new RegExp(
    `^(?:[ \\u00a0]?(%)|[ \\u00a0]+(${wordUnits
      .map((u) => u.split(/\s+/).map(escapeRegExp).join('[ \\u00a0]+'))
      .join('|')})(?![\\p{L}\\p{N}]))`,
    'iu',
  );
  const unitFor = (after: string, number: string): { text: string; english: string } | null => {
    const m = UNIT_AFTER.exec(after);
    if (!m) return null;
    const unit = (m[1] ?? m[2])!;
    const fixed = fixedUnitEnglish(unit, number);
    if (fixed !== null) return { text: m[0], english: fixed };
    const registered = registeredEnglish.get(unit.toLowerCase().replace(/[ \u00a0]+/g, ' '));
    return registered === undefined ? null : { text: m[0], english: ` ${registered}` };
  };
  return {
    entries,
    mask(input: string): string {
      let text = normalizeForScan(input);
      // Names first, exact case-sensitive match, longest first: a name is a
      // fixed registry string that may itself CONTAIN what looks like a
      // period label or a number (the day-of-month in 'Bevolking op 1
      // januari') — masking it whole, before caveats/periods/numbers ever
      // scan the text, stops those digits being sliced out from under the
      // name and re-attached as an unrelated placeholder.
      for (const n of names) {
        const re = new RegExp(`(?<![\\p{Nd}\\p{L}])${escapeRegExp(n.dutch)}(?![\\p{Nd}\\p{L}])`, 'gu');
        text = text.replace(re, () => next('name', n.dutch, n.english));
      }
      // Caveats next: they are fixed registry strings that may contain no digits
      // but sit right after a number, and must travel as one unit.
      for (const c of caveats) {
        text = text.replace(new RegExp(escapeRegExp(c.dutch), 'g'), () => next('caveat', c.dutch, c.english));
      }
      // Period labels before numbers: '2023 1e kwartaal' must not become '⟦N⟧ ⟦N⟧e kwartaal'.
      // Word-boundary guarded so '2023' never matches inside '12023'.
      for (const p of periods) {
        const re = new RegExp(`(?<![\\p{Nd}\\p{L}])${escapeRegExp(p.dutch)}(?![\\p{Nd}\\p{L}])`, 'gu');
        text = text.replace(re, () => next('period', p.dutch, p.english));
      }
      // Remaining numeric tokens, right to left so indices stay valid. Tokens
      // inside placeholders cannot exist (placeholders carry no digits).
      // A unit/scale word directly after the token (ruling 17a) is part of
      // the SAME placeholder: the mask table stores the combined Dutch text
      // ('0,5 procentpunt') and its fixed English ('0.5 percentage points').
      const tokens = findNumericTokens(text);
      const replacements = tokens.map((t) => {
        const unit = unitFor(text.slice(t.index + t.token.length), t.token);
        return { t, ph: '', length: t.token.length + (unit?.text.length ?? 0), dutch: t.token + (unit?.text ?? ''), english: toEnglishNumberToken(t.token) + (unit?.english ?? '') };
      });
      // Assign ids left to right for readable output, splice right to left.
      for (const r of replacements) r.ph = next('number', r.dutch, r.english);
      for (let i = replacements.length - 1; i >= 0; i--) {
        const { t, ph, length } = replacements[i]!;
        text = text.slice(0, t.index) + ph + text.slice(t.index + length);
      }
      return text;
    },
  };
}

export function fillPlaceholders(text: string, entries: MaskEntry[]): string {
  const map = new Map(entries.map((e) => [e.placeholder, e.english]));
  return text.replace(PLACEHOLDER_RE, (ph) => {
    const english = map.get(ph);
    if (english === undefined) throw new Error(`unknown placeholder ${ph}`);
    return english;
  });
}
