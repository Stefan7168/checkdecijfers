// Owner-signed 2026-10-04 (session 154, #357 sweep item 12): the system map
// names Eurostat as a second source next to CBS StatLine, in both languages.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SystemMapDiagram } from './system-map-diagram.tsx';

afterEach(cleanup);

describe('SystemMapDiagram — both sources', () => {
  it.each(['en', 'nl'] as const)('draws a Eurostat box next to CBS StatLine and names both in the aria label (%s)', (lang) => {
    const { container } = render(<SystemMapDiagram lang={lang} />);
    const svg = container.querySelector('svg')!;
    const text = svg.textContent ?? '';
    expect(text).toContain('CBS StatLine');
    expect(text).toContain('Eurostat');
    const label = svg.getAttribute('aria-label') ?? '';
    expect(label).toContain('CBS StatLine');
    expect(label).toContain('Eurostat');
    // Two dashed "separate process" arrows into the database: one per source.
    expect(svg.querySelectorAll('line[stroke-dasharray]').length).toBe(2);
  });
});
