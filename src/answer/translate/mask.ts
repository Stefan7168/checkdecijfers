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

export function hasDigitOutsidePlaceholders(text: string): boolean {
  return /\p{Nd}/u.test(text.replace(PLACEHOLDER_RE, ''));
}

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
      const tokens = findNumericTokens(text);
      const replacements = tokens.map((t) => ({ t, ph: '' }));
      // Assign ids left to right for readable output, splice right to left.
      for (const r of replacements) r.ph = next('number', r.t.token, toEnglishNumberToken(r.t.token));
      for (let i = replacements.length - 1; i >= 0; i--) {
        const { t, ph } = replacements[i]!;
        text = text.slice(0, t.index) + ph + text.slice(t.index + t.token.length);
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
