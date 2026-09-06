// The dataset-chart instruction prompt (D6) — mirrors
// tests/catalog/rerank.test.ts's shape for the sibling prompt builder.
import { describe, expect, it } from 'vitest';
import {
  buildDatasetInstructSystemPrompt,
  previousInstructionForPrompt,
  serializeDatasetInstructRequest,
} from '../../src/attachments/instruct/prompt.ts';
import type { ChartInstruction, DatasetProfile } from '../../src/attachments/types.ts';

const PROFILE: DatasetProfile = {
  rowCount: 3,
  columns: [
    { id: 'c0', header: 'Year', type: 'year', min: 2020, max: 2022, distinct: ['2020', '2021', '2022'], nulls: 0 },
    { id: 'c1', header: 'City', type: 'text', distinct: ['Amsterdam', 'Rotterdam'], nulls: 0 },
    { id: 'c2', header: 'Revenue', type: 'number', numberFormat: 'nl', min: 80, max: 150, sample: ['120,5'], nulls: 0 },
  ],
};

describe('buildDatasetInstructSystemPrompt', () => {
  it('is a non-empty English prompt naming the closed-vocabulary rules', () => {
    const prompt = buildDatasetInstructSystemPrompt();
    expect(prompt.length).toBeGreaterThan(200);
    expect(prompt).toMatch(/column ids/i);
    expect(prompt).toMatch(/never invent/i);
    expect(prompt).toMatch(/schema/i);
  });

  it('fixed in review — explicitly warns the model off ambiguous-format columns', () => {
    expect(buildDatasetInstructSystemPrompt()).toContain('format not yet resolved');
  });
});

describe('serializeDatasetInstructRequest', () => {
  it('includes every column with its id, header, type, and real values/range', () => {
    const request = serializeDatasetInstructRequest(PROFILE, null, 'show revenue per year');
    expect(request).toContain('id=c0');
    expect(request).toContain('header="Year"');
    expect(request).toContain('id=c2');
    expect(request).toContain('values=[Amsterdam, Rotterdam]');
    expect(request).toContain('range=[80, 150]');
  });

  it('states "None" for a fresh question with no previous instruction', () => {
    const request = serializeDatasetInstructRequest(PROFILE, null, 'q');
    expect(request).toMatch(/None — this is a fresh question\./);
  });

  it('includes the previous instruction verbatim when given', () => {
    const previous = { version: 1 as const, kind: 'line' as const, x: 'c0', y: ['c2'], seriesBy: null, filters: [], sort: null, limit: null, unsupported: null };
    const request = serializeDatasetInstructRequest(PROFILE, previous, 'make it a bar chart');
    expect(request).toContain('"kind":"line"');
  });

  it('carries the user question verbatim', () => {
    const request = serializeDatasetInstructRequest(PROFILE, null, 'toon omzet per jaar');
    expect(request).toContain('toon omzet per jaar');
  });

  it('fixed in review — an ambiguous-format column is spelled out in plain language, not just numberFormat=ambiguous', () => {
    const profileWithAmbiguous: DatasetProfile = {
      rowCount: 1,
      columns: [...PROFILE.columns, { id: 'c3', header: 'Extra', type: 'number', numberFormat: 'ambiguous', nulls: 0 }],
    };
    const request = serializeDatasetInstructRequest(profileWithAmbiguous, null, 'q');
    expect(request).toContain('format not yet resolved');
    expect(request).not.toContain('numberFormat=ambiguous');
  });
});

describe('previousInstructionForPrompt — reuses the ClientChartInstruction split (H1)', () => {
  it('strips reading/confidence/unsupported.detail from a full ChartInstruction', () => {
    const full: ChartInstruction = {
      version: 1,
      kind: 'line',
      x: 'c0',
      y: ['c2'],
      seriesBy: null,
      filters: [],
      sort: null,
      limit: null,
      confidence: 0.95,
      reading: 'a secret internal note',
      unsupported: { reason: 'aggregation', detail: 'a secret internal detail' },
    };
    const projected = previousInstructionForPrompt(full);
    expect(projected).not.toHaveProperty('reading');
    expect(projected).not.toHaveProperty('confidence');
    expect(projected?.unsupported).toEqual({ reason: 'aggregation' });
    expect(JSON.stringify(projected)).not.toContain('secret');
  });

  it('passes through null unchanged', () => {
    expect(previousInstructionForPrompt(null)).toBeNull();
  });
});
