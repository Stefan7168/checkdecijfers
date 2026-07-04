// statCardData (WP20, open-questions #80): the card exists ONLY for a
// single-cell, non-null result, and its number comes from the shared
// formatValueNl — pinned here against concrete Dutch formatting so a second
// ad-hoc formatter can never sneak in.
import { describe, expect, it } from 'vitest';
import { fakeAnswerResponse, fakeCell } from '../test/fake-answer.ts';
import { statCardData } from './stat-card-data.ts';

describe('statCardData', () => {
  it('extracts a single-cell result with shared Dutch formatting', () => {
    const response = fakeAnswerResponse({ shape: 'single', cells: [fakeCell()] });
    expect(statCardData(response)).toEqual({
      value: '3,3',
      unitSuffix: '%',
      measureTitle: 'Inflatie (CPI)',
      context: '2024',
      provisional: false,
      tableId: '86141NED',
      syncedDate: '2026-07-03',
    });
  });

  // WP20 adversarial-review HIGH finding: the card must follow the SHARED
  // body-text unit conventions (displayValueUnit), pinned here per branch.
  it("renders a bare 'aantal' count with NO unit word (body convention)", () => {
    const response = fakeAnswerResponse({
      shape: 'single',
      cells: [fakeCell({ value: 18044027, decimals: 0, unit: 'aantal', measureTitle: 'Bevolking' })],
    });
    expect(statCardData(response)).toMatchObject({ value: '18.044.027', unitSuffix: '' });
  });

  it('parenthesizes digit-bearing factor units (the R10 ×1.000 misreading guard)', () => {
    const response = fakeAnswerResponse({
      shape: 'single',
      cells: [fakeCell({ value: 8204, decimals: 0, unit: 'x 1 000' })],
    });
    expect(statCardData(response)).toMatchObject({ value: '8.204', unitSuffix: ' (x 1 000)' });
  });

  it('prefixes × on a bare factor unit, exactly like the body text', () => {
    const response = fakeAnswerResponse({
      shape: 'single',
      cells: [fakeCell({ value: 443, decimals: 0, unit: '1 000 euro' })],
    });
    expect(statCardData(response)).toMatchObject({ value: '443', unitSuffix: ' (× 1 000 euro)' });
  });

  it('formats grouped thousands the Dutch way and joins region into the context', () => {
    const response = fakeAnswerResponse({
      shape: 'single',
      cells: [fakeCell({ value: 42100, decimals: 0, unit: 'personen', measureTitle: 'Werklozen', regionLabel: 'Rotterdam', periodLabel: '2023' })],
    });
    expect(statCardData(response)).toMatchObject({
      value: '42.100',
      unitSuffix: ' personen',
      context: 'Rotterdam · 2023',
    });
  });

  it('carries the provisional flag', () => {
    const response = fakeAnswerResponse({ shape: 'single', cells: [fakeCell({ provisional: true })] });
    expect(statCardData(response)).toMatchObject({ provisional: true });
  });

  it('returns null for a series shape (no card on multi-value answers)', () => {
    expect(statCardData(fakeAnswerResponse({ shape: 'series', cells: [fakeCell(), fakeCell()] }))).toBeNull();
  });

  it('returns null when the single shape somehow carries more than one cell', () => {
    expect(statCardData(fakeAnswerResponse({ shape: 'single', cells: [fakeCell(), fakeCell()] }))).toBeNull();
  });

  it('returns null for a null value (a CBS-suppressed cell can never become a card)', () => {
    expect(statCardData(fakeAnswerResponse({ shape: 'single', cells: [fakeCell({ value: null })] }))).toBeNull();
  });
});
