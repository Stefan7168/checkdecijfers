import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AnswerSkeleton, ChartSkeleton } from './loading-skeletons.tsx';

afterEach(cleanup);

describe('AnswerSkeleton', () => {
  it('renders a few pulsing placeholder lines, hidden from assistive tech', () => {
    const { container } = render(<AnswerSkeleton />);
    const root = container.firstElementChild!;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(3);
  });
});

describe('ChartSkeleton', () => {
  it('renders a pulsing chart-shaped placeholder, hidden from assistive tech', () => {
    const { container } = render(<ChartSkeleton />);
    const root = container.firstElementChild!;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(2);
  });
});
