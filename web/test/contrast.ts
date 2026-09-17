// Session 110 a11y audit, row 1 (#Fix-now 1): a tiny, dependency-free
// contrast checker for this product's grayscale (`oklch(L 0 0)`) design
// tokens. No npm dependency — CLAUDE.md "cheapest mechanism first". Only
// handles the achromatic case (chroma 0, hue irrelevant) that every token in
// `app/globals.css`'s light/dark palettes actually uses; a chromatic token
// would need the full OKLab -> LMS -> linear-sRGB matrix, which this file
// deliberately does not implement because nothing here needs it yet.
//
// Math: for oklch(L 0 0), OKLab's a=b=0, so the LMS' intermediate values are
// all L (the cube root form), the LMS cone responses are all L^3, and the
// OKLab -> linear-sRGB matrix's three rows each sum to exactly 1 — so linear
// r=g=b=L^3. WCAG 2.x relative luminance is 0.2126*r+0.7152*g+0.0722*b on
// LINEAR channel values (which is where the sRGB relative-luminance formula's
// own gamma decode would normally happen) — with r=g=b those weights sum to
// 1, so relative luminance Y = L^3 exactly. Verified against the audit's own
// measured 4.34:1 for oklch(0.556 0 0) on oklch(0.97 0 0) below.

/** Parses a CSS `oklch(L C H)` (or `oklch(L C H / A)`) string with C given as
 * a bare number (this file only ever meets grayscale tokens, C = 0). Throws
 * on anything else, including a `%`-form L or a nonzero C, since this
 * checker has no formula for chroma and no caller needs one. */
export function parseOklchGray(value: string): number {
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value.trim());
  if (!match) throw new Error(`parseOklchGray: cannot parse "${value}"`);
  const [, lStr, cStr] = match;
  const l = Number(lStr);
  const c = Number(cStr);
  if (c !== 0) throw new Error(`parseOklchGray: only chroma 0 is supported, got "${value}"`);
  return l;
}

/** WCAG relative luminance (0-1) of a grayscale `oklch(L 0 0)` color, given
 * its lightness `L` (0-1). See the file header for the derivation. */
export function relativeLuminanceOfOklchGray(l: number): number {
  return l ** 3;
}

/** WCAG 2.x contrast ratio between two relative luminances (order-independent). */
export function contrastRatio(y1: number, y2: number): number {
  const lighter = Math.max(y1, y2);
  const darker = Math.min(y1, y2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Convenience: contrast ratio directly between two `oklch(L 0 0)` strings. */
export function contrastRatioOfOklchGrays(a: string, b: string): number {
  return contrastRatio(
    relativeLuminanceOfOklchGray(parseOklchGray(a)),
    relativeLuminanceOfOklchGray(parseOklchGray(b)),
  );
}
