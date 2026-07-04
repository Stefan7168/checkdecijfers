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
      unit: '%',
      measureTitle: 'Inflatie (CPI)',
      context: '2024',
      provisional: false,
      tableId: '86141NED',
      syncedDate: '2026-07-03',
    });
  });

  it('formats grouped thousands the Dutch way and joins region into the context', () => {
    const response = fakeAnswerResponse({
      shape: 'single',
      cells: [fakeCell({ value: 42100, decimals: 0, unit: 'personen', measureTitle: 'Werklozen', regionLabel: 'Rotterdam', periodLabel: '2023' })],
    });
    expect(statCardData(response)).toMatchObject({
      value: '42.100',
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
