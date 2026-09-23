// #294 (session 124): `KNOWN_DERIVATION_REFUSAL_KEYS` (chart.tsx) translates
// the server's English refusal reasons into NL/EN UI text by EXACT string
// match. A rewording on the server side would silently degrade the message
// to the generic fallback with nothing failing — so every key is pinned
// here against the literal it must match in its source file.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWN_DERIVATION_REFUSAL_KEYS } from './chart.tsx';

const SOURCES = [
  resolve(__dirname, '..', 'app', 'chart-derivation-actions.ts'),
  resolve(__dirname, '..', '..', 'src', 'query', 'derivations.ts'),
].map((path) => readFileSync(path, 'utf8'));

describe('KNOWN_DERIVATION_REFUSAL_KEYS (#294)', () => {
  it('every key is a refusal string literally present in the server action or the derivation layer', () => {
    const missing = Object.keys(KNOWN_DERIVATION_REFUSAL_KEYS).filter((reason) => !SOURCES.some((src) => src.includes(`'${reason}'`)));
    expect(missing).toEqual([]);
  });
});
