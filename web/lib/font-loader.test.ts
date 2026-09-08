import { afterEach, describe, expect, it } from 'vitest';
import { ensureFontLoaded, GOOGLE_FONTS_ORIGIN } from './font-loader.ts';

afterEach(() => {
  document.head.querySelectorAll('link[data-font-family]').forEach((n) => n.remove());
});

describe('ensureFontLoaded', () => {
  it('injects one Google Fonts stylesheet per family, once', () => {
    const option = { family: 'Open Sans', source: 'google' as const, stack: '' };
    ensureFontLoaded(option);
    ensureFontLoaded(option);
    const links = document.head.querySelectorAll('link[data-font-family="Open Sans"]');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(`${GOOGLE_FONTS_ORIGIN}/css2?family=Open+Sans:wght@400;600&display=swap`);
    expect(links[0].getAttribute('rel')).toBe('stylesheet');
  });
  it('does nothing for a system font', () => {
    ensureFontLoaded({ family: 'Georgia', source: 'system', stack: '' });
    expect(document.head.querySelector('link[data-font-family]')).toBeNull();
  });
});
