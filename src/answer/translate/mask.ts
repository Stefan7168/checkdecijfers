// ADR 058 §2: numbers are made UNREPRESENTABLE to the translating model. Every
// period label, provisional marker and numeric token of a validated Dutch text
// becomes a digit-free placeholder before the model call; deterministic code
// puts them back in English notation afterwards. Placeholder ids are letters
// only, so a placeholder can never itself look like a number to the scanner.
import { findNumericTokens, normalizeForScan } from '../compose/format.ts';

export interface MaskEntry {
  placeholder: string;
  kind: 'number' | 'period' | 'caveat';
  dutch: string;
  english: string;
}

export interface Masker {
  mask(text: string): string;
  readonly entries: MaskEntry[];
}

export const PLACEHOLDER_RE = /⟦[NPC][a-z]+⟧/g;

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

export function createMasker(opts: {
  periodLabels: { dutch: string; english: string }[];
  caveats: { dutch: string; english: string }[];
}): Masker {
  const entries: MaskEntry[] = [];
  let counter = 0;
  const next = (kind: MaskEntry['kind'], dutch: string, english: string): string => {
    const placeholder = `⟦${kind === 'number' ? 'N' : kind === 'period' ? 'P' : 'C'}${letters(counter++)}⟧`;
    entries.push({ placeholder, kind, dutch, english });
    return placeholder;
  };
  const byLength = <T extends { dutch: string }>(xs: T[]) =>
    [...xs].filter((x) => x.dutch.length > 0).sort((a, b) => b.dutch.length - a.dutch.length);
  const periods = byLength(opts.periodLabels);
  const caveats = byLength(opts.caveats);
  return {
    entries,
    mask(input: string): string {
      let text = normalizeForScan(input);
      // Caveats first: they are fixed registry strings that may contain no digits
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
