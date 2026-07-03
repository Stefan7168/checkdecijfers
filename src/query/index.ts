// Public surface of the query module (ADR 001 boundary). Downstream modules
// (answer composition WP7, chart spec WP8, audit WP10) consume runQuery and
// the output types; the WP6 intent parser targets StructuredIntent.
export { runQuery, buildResultId, freshestForCanonical } from './run.ts';
export { resolveIntent, enumeratePeriods, periodKey } from './resolve.ts';
export type { ResolvedQuery, ResolveOutcome } from './resolve.ts';
export * from './types.ts';
