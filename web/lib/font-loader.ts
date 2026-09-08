// WP218: on-demand Google Fonts loading for the chart's Lettertype tab. One
// <link> per family, idempotent, client-only. Not next/font: bundling seven
// families the page never uses by default would grow every page load for a
// panel most readers never open.
import type { FontOption } from './chart-presentation.ts';

export const GOOGLE_FONTS_ORIGIN = 'https://fonts.googleapis.com';

export function googleFontsHref(family: string): string {
  return `${GOOGLE_FONTS_ORIGIN}/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;600&display=swap`;
}

/** family is already regex-validated (letters/digits/spaces only, see
 * FONT_FAMILY_NAME in chart-presentation.ts) before it can reach here, so the
 * simple quote-strip fallback is safe when CSS.escape is unavailable. */
function escapeAttrValue(family: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(family) : family.replace(/"/g, '');
}

export function ensureFontLoaded(option: FontOption): void {
  if (option.source !== 'google' || typeof document === 'undefined') return;
  const existing = document.head.querySelector(`link[data-font-family="${escapeAttrValue(option.family)}"]`);
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = googleFontsHref(option.family);
  link.setAttribute('data-font-family', option.family);
  document.head.appendChild(link);
}
