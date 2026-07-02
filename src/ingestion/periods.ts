// CBS period-code parsing (docs/05-data-rules.md, validation check 3).
// Format: YYYY + 2-letter grain marker + 2-digit index. JJ00 is a whole-year
// period (index null, not a "zeroth" sub-period); KW01..KW04 quarters;
// MM01..MM12 months. Anything else — wrong marker, out-of-range index,
// malformed digits — is not a CBS period code and must not be guessed at.

export interface ParsedPeriod {
  grain: 'JJ' | 'KW' | 'MM';
  year: number;
  index: number | null;
}

const PERIOD_CODE_PATTERN = /^(\d{4})(JJ|KW|MM)(\d{2})$/;

export function parsePeriodCode(code: string): ParsedPeriod | null {
  const match = PERIOD_CODE_PATTERN.exec(code);
  if (!match) return null;
  const [, yearStr, grain, indexStr] = match;
  const year = Number(yearStr);
  const index = Number(indexStr);

  if (grain === 'JJ') {
    return index === 0 ? { grain: 'JJ', year, index: null } : null;
  }
  if (grain === 'KW') {
    return index >= 1 && index <= 4 ? { grain: 'KW', year, index } : null;
  }
  // MM
  return index >= 1 && index <= 12 ? { grain: 'MM', year, index } : null;
}
