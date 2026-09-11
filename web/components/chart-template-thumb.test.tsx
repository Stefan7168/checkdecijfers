import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CHART_TEMPLATES, templateById } from '../lib/chart-templates.ts';
import { DEFAULT_PALETTE, RECHARTS_PALETTE } from '../lib/chart-presentation.ts';
import { TemplateThumb } from './chart-template-thumb.tsx';

describe('TemplateThumb — a digit-free thumbnail derived from the template', () => {
  it('renders one aria-hidden svg per template with no text nodes at all', () => {
    for (const t of CHART_TEMPLATES) {
      const { container } = render(<TemplateThumb template={t} />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.querySelector('text')).toBeNull();
      expect((container.textContent ?? '').trim()).toBe('');
    }
  });
  it('derives its look: classic draws a vertical grid and every point in the classic colour; minimal draws no grid, no axis, no points; social has a gradient backdrop with an inset card', () => {
    const classic = render(<TemplateThumb template={templateById('classic')} />).container;
    expect(classic.querySelectorAll('[data-thumb="grid-v"]').length).toBeGreaterThan(0);
    expect(classic.querySelectorAll('[data-thumb="point"]').length).toBe(5);
    expect(classic.querySelector('[data-thumb="line"]')?.getAttribute('stroke')).toBe(RECHARTS_PALETTE[0]);
    const minimal = render(<TemplateThumb template={templateById('minimal')} />).container;
    expect(minimal.querySelector('[data-thumb="grid-h"]')).toBeNull();
    expect(minimal.querySelector('[data-thumb="axis"]')).toBeNull();
    expect(minimal.querySelectorAll('[data-thumb="point"]').length).toBe(0);
    expect(minimal.querySelector('[data-thumb="line"]')?.getAttribute('stroke')).toBe(DEFAULT_PALETTE[0]);
    const standard = render(<TemplateThumb template={templateById('standard')} />).container;
    expect(standard.querySelectorAll('[data-thumb="point"]').length).toBe(2);
    expect(standard.querySelector('[data-thumb="grid-h"]')).not.toBeNull();
    expect(standard.querySelector('[data-thumb="grid-v"]')).toBeNull();
    // Stock = axis lines hidden + a horizontal grid, so standard draws the
    // baseline stand-in, never the axis lines; classic (axisLines: shown)
    // draws the axis instead. ADR 043: standard now carries the stock look
    // explicitly, so this pins that the thumb reflects it.
    expect(standard.querySelector('[data-thumb="baseline"]')).not.toBeNull();
    expect(standard.querySelector('[data-thumb="axis"]')).toBeNull();
    expect(classic.querySelector('[data-thumb="axis"]')).not.toBeNull();
    expect(classic.querySelector('[data-thumb="baseline"]')).toBeNull();
    const social = render(<TemplateThumb template={templateById('social')} />).container;
    expect(social.querySelector('linearGradient')).not.toBeNull();
    expect(social.querySelector('[data-thumb="card"]')).not.toBeNull();
  });
});
