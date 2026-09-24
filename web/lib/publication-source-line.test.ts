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
