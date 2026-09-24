// Own-data publish (ADR 057, session 127, Task 3 fix round 1) — TDD for the
// pure normalizeSourceLine helper, pulled out of own-chart-publish-actions.ts
// (a 'use server' file, which Next's server-boundary check refuses to export
// a non-async function from). No mocking: this module has no I/O boundary.
import { describe, expect, it } from 'vitest';
import { PUBLICATION_SOURCE_LINE_MAX } from '../backend/attachments/publications.ts';
import { normalizeSourceLine, PUBLICATION_SOURCE_LINE_MAX_CLIENT } from './publication-source-line.ts';

describe('PUBLICATION_SOURCE_LINE_MAX_CLIENT', () => {
  it('stays in sync with the real backend/attachments/publications.ts constant', () => {
    expect(PUBLICATION_SOURCE_LINE_MAX_CLIENT).toBe(PUBLICATION_SOURCE_LINE_MAX);
  });
});

describe('normalizeSourceLine', () => {
  it.each([
    ['  Bron  ', { ok: true, value: 'Bron' }],
    ['', { ok: true, value: null }],
    ['   ', { ok: true, value: null }],
    [null, { ok: true, value: null }],
    [undefined, { ok: true, value: null }],
    ['a\u0000b\u0007c', { ok: true, value: 'abc' }],
    ['a'.repeat(120), { ok: true, value: 'a'.repeat(120) }],
    ['a'.repeat(121), { ok: false }],
    [42, { ok: false }],
  ] as const)('%j -> %j', (input, expected) => {
    expect(normalizeSourceLine(input)).toEqual(expected);
  });
});

// B5: bidi override/embedding (U+202A–U+202E) and isolate (U+2066–U+2069)
// controls are stripped too — they can visually reorder the public source
// line ("Bron: …") so it reads as something other than what was typed.
describe('normalizeSourceLine — bidi controls (B5)', () => {
  it.each(['\u202A', '\u202B', '\u202C', '\u202D', '\u202E', '\u2066', '\u2067', '\u2068', '\u2069'])('strips %j', (ch) => {
    expect(normalizeSourceLine(`eigen${ch} administratie`)).toEqual({ ok: true, value: 'eigen administratie' });
  });
  it('a value that is only bidi controls and spaces becomes null', () => {
    expect(normalizeSourceLine(' \u202E\u2066 ')).toEqual({ ok: true, value: null });
  });
  it('leaves ordinary non-ASCII text alone (e.g. é, –, the LRM-free Dutch/English copy)', () => {
    expect(normalizeSourceLine('Jaarverslag – café')).toEqual({ ok: true, value: 'Jaarverslag – café' });
  });
});
