// ADR 061 — the measure allow-list on a registered slice (CbsSlice.measures).
// One helper module so registration and every sync derive "which codes does
// this table serve" identically.
import type { CbsSlice } from '../cbs-adapter/types.ts';

/** The allow-listed codes, or null when the slice has no (or an empty) list —
 * null means "every measure", today's behaviour, byte-identical. */
export function allowListedMeasures(slice: CbsSlice | null | undefined): Set<string> | null {
  const codes = slice?.measures ?? [];
  return codes.length > 0 ? new Set(codes) : null;
}

/** Listed codes that CBS's current MeasureCodes no longer carries, in list
 * order. Principle (c): a listed code vanishing is a schema change on a
 * figure we serve — it must fail loudly, never be skipped. */
export function missingAllowListedCodes(slice: CbsSlice | null | undefined, measureCodes: string[]): string[] {
  const allow = allowListedMeasures(slice);
  if (allow === null) return [];
  const present = new Set(measureCodes);
  return [...allow].filter((code) => !present.has(code));
}
