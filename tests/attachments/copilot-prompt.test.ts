// The co-pilot prompt (session 113, co-pilot phase 2). What the model is
// shown is the chart's LABELS and the capabilities of this chart right
// now — never a plotted value it could quote, and never a capability the
// client did not offer.
import { describe, expect, it } from 'vitest';
import {
  buildCopilotSystemPrompt,
  COPILOT_PROMPT_VERSION,
  serializeCopilotRequest,
} from '../../src/attachments/copilot/prompt.ts';
import type { CopilotCapabilities } from '../../src/attachments/copilot/types.ts';
import { buildDatasetProfile } from '../../src/attachments/ingest/profile.ts';
import { CURRENT_FIXTURE } from './copilot-fixtures.ts';

const PROFILE = buildDatasetProfile([
  ['Year', 'City', 'Revenue'],
  ['2020', 'Amsterdam', '120,5'],
  ['2021', 'Rotterdam', '150,0'],
]);

const CAPABILITIES: CopilotCapabilities = {
  forms: ['line', 'bar', 'table'],
  presentationKeys: ['lineWidth', 'grid'],
  templates: ['standard', 'newsroom'],
  lang: 'nl',
};

const CHART = { seriesLabels: ['Amsterdam', 'Rotterdam'], xLabels: ['2020', '2021'] };

describe('buildCopilotSystemPrompt', () => {
  const prompt = buildCopilotSystemPrompt();

  it('starts with the agreed role sentence', () => {
    expect(prompt.startsWith('You are the chart co-pilot for a chart drawn from the user\'s OWN uploaded data.')).toBe(
      true,
    );
  });

  it('forbids computing a number', () => {
    expect(prompt).toContain('You never compute or invent a number');
    expect(prompt).toContain('only contain numbers that are visible on the chart');
  });

  it('names every view command kind the schema allows', () => {
    for (const kind of [
      'setForm',
      'setSeriesView',
      'setPresentation',
      'applyTemplate',
      'resetPresentation',
      'setTitle',
      'setCaption',
      'addNote',
    ]) {
      expect(prompt, `${kind} is not described in the system prompt`).toContain(kind);
    }
  });

  it('carries the instruction rules over from the dataset-instruct prompt', () => {
    expect(prompt).toContain('copied LITERALLY from the profile');
    expect(prompt).toContain('aggregate');
    expect(prompt).toContain('derived');
  });

  it('is version 1', () => {
    expect(COPILOT_PROMPT_VERSION).toBe(1);
  });
});

describe('serializeCopilotRequest', () => {
  const payload = serializeCopilotRequest(PROFILE, CURRENT_FIXTURE, CHART, CAPABILITIES, 'maak de lijn dikker');

  it('shows the dataset profile columns', () => {
    expect(payload).toContain('id=c0');
    expect(payload).toContain('header="Revenue"');
  });

  it('shows the current instruction as JSON', () => {
    expect(payload).toContain(JSON.stringify(CURRENT_FIXTURE));
  });

  it('shows the chart series and x labels as their own rendered lines', () => {
    expect(payload).toContain('- series labels: [Amsterdam | Rotterdam]');
    expect(payload).toContain('- x labels: [2020 | 2021]');
  });

  it('shows the capabilities of this chart', () => {
    expect(payload).toContain('lineWidth');
    expect(payload).toContain('newsroom');
    expect(payload).toContain('lang=nl');
  });

  it('shows the user message', () => {
    expect(payload).toContain('maak de lijn dikker');
  });
});
