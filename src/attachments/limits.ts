// "Eigen data" attachments tier — all caps as named constants (ADR 037 §8
// Q9, accepted as starting values; owner-tunable, no schema change needed
// to adjust any of these).

/** Bytes. Chosen against the Next 16 Server Action body-size ceiling and
 * Vercel's function request cap — verify both against the installed docs
 * at build time (ADR 037 §8 assumption, per web/CLAUDE.md's "don't code
 * from memory" rule). */
export const MAX_FILE_BYTES = 4 * 1024 * 1024;

export const MAX_ROWS = 10_000;
export const MAX_COLUMNS = 50;
export const MAX_CELL_CHARS = 200;
export const MAX_HEADER_CHARS = 40;

/** A column's `distinct` list (ColumnProfile.distinct) is capped here and
 * marked `distinctTruncated` beyond it — text cells are length-capped
 * separately via MAX_CELL_CHARS before they ever reach a distinct list. */
export const MAX_DISTINCT_VALUES = 50;

/** `seriesBy` cardinality (D6) — exceeding this throws a validation error
 * (a clarification), never a silently-truncated legend (the "never silent
 * omission" rule extended from the points cap to this one, fixed in
 * review). */
export const MAX_SERIES = 8;

/** Points on one chart (D7) — exceeding this is an honest refusal
 * ("te veel punten — filter eerst"), never silent omission. */
export const MAX_CHART_POINTS = 500;

/** ChartInstruction.y length (1..4) and .limit (1..50, when set). */
export const MAX_Y_COLUMNS = 4;
export const MAX_LIMIT = 50;

/** Per-user storage quota (ADR 037 §8 Q9). */
export const MAX_DATASETS_PER_USER = 25;
export const MAX_TOTAL_BYTES_PER_USER = 50 * 1024 * 1024;

/** Raw file bytes are purged after this window even though the extracted
 * `cells`/`profile`/turns follow the longer #14 two-year account window
 * (ADR 037 §8 Q2, D13) — bytes serve re-extraction/download only, not the
 * chart record itself. */
export const FILE_BYTES_RETENTION_DAYS = 90;
