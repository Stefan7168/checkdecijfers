// How many decimals a published number carries — the one rule every path that derives or checks decimals from
// observed values uses (#357 (a)): the Eurostat JSON-stat parse (a unit's decimals = the most it observed),
// the Eurostat decimals read at registration, and the slice-time check that refuses a value carrying more
// decimals than registered (src/ingestion/validate.ts, `checkObservedDecimals`). Moved here unchanged from
// src/eurostat-adapter/jsonstat.ts so the three can never count differently.

/** LOW-effort code-review finding, fixed: `v.toString()` can render a small
 * magnitude in exponential notation (e.g. 1e-7), which has no '.' in the
 * position a plain-decimal count expects — `decimalsOf` expands that case
 * explicitly instead of assuming `toString()` never switches notation. */
export function decimalsOf(v: number): number {
  if (!Number.isFinite(v) || Number.isInteger(v)) return 0;
  const s = v.toString();
  const eIndex = s.search(/[eE]/);
  if (eIndex === -1) {
    const dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
  }
  const mantissa = s.slice(0, eIndex);
  const exponent = Number(s.slice(eIndex + 1));
  const dot = mantissa.indexOf('.');
  const mantissaDecimals = dot === -1 ? 0 : mantissa.length - dot - 1;
  return Math.max(0, mantissaDecimals - exponent);
}
