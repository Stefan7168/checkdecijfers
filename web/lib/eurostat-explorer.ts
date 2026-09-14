// WP30c/E1 Task 7 (ADR 048): the internal, EUROSTAT_EXPLORER_ENABLED-gated
// explorer's server-side glue. Zero new query/chart code (D5): every number
// this module ever shows comes from the REAL runQuery -> composeAnswer ->
// buildChartSpec pipeline (respondToIntent, src/answer/respond/respond.ts —
// the exact function the live chat path itself calls once an LLM has already
// produced a StructuredIntent). This module differs only in HOW the intent
// gets built: a picked table + a plain year range from the explorer's own
// form, never a parsed question — so there is nothing here for an LLM to do
// (D5c: zero LLM calls anywhere in this route). `templateOnly: true` proves
// that structurally: composeAnswer only ever reads `options.client` when
// templateOnly is NOT set (src/answer/compose/compose.ts:236), so the
// `answerClient` below is a throwing stub that this module expects to NEVER
// be invoked — if it ever were, that is a real bug this module wants to fail
// loudly on, not spend real LLM money silently.
//
// Imports target LEAF modules, never a barrel (the WP13 lesson: importing
// from a barrel index pulls its whole module graph into Turbopack's
// resolution — see web/lib/citation.ts's own header for the precedent).
import type { LlmClient, LlmResponse } from '../backend/answer/llm/client.ts';
import { RAW_PARSE_VERSION } from '../backend/answer/intent/types.ts';
import type { ParseOutcome } from '../backend/answer/intent/types.ts';
import { respondToIntent } from '../backend/answer/respond/respond.ts';
import type { ComposedResponse } from '../backend/answer/respond/types.ts';
import type { StructuredIntent } from '../backend/query/types.ts';
import type { Db } from '../backend/db/types.ts';
import { EUROSTAT_SOURCE_KEY } from '../backend/sources/registry.ts';

/** D5c: never actually called (see module header) — throws loudly rather
 * than silently spending real money if composeAnswer's LLM rungs were ever
 * reached from this route. */
class NeverCallAnswerClient implements LlmClient {
  complete(): Promise<LlmResponse> {
    throw new Error(
      'eurostat-explorer: composeAnswer tried to call an LLM client — templateOnly should have made this unreachable (D5c: zero LLM calls in this route)',
    );
  }
}

export interface RegisteredEurostatTable {
  id: string;
  title: string;
}

/** Every REGISTERED (cbs_tables) Eurostat table — [] today, since E1
 * registers zero real Eurostat tables (Constraint 0, the brief's own scoping
 * decision) — which is exactly the honest empty state the route shows.
 * Scoped by the migration-016 `source` column, the SAME fact Task 5's
 * catalog-prune isolation already relies on — never a `table_id LIKE` guess. */
export async function listRegisteredEurostatTables(db: Db): Promise<RegisteredEurostatTable[]> {
  const { rows } = await db.query(`select id, title from cbs_tables where source = $1 order by id`, [
    EUROSTAT_SOURCE_KEY,
  ]);
  return rows.map((r) => ({ id: r.id as string, title: r.title as string }));
}

export interface EurostatMeasure {
  code: string;
  title: string;
}

/** The measures a registered table's own first-sync metadata recorded
 * (cbs_tables.units — the exact column src/query/resolve.ts's fetchTable
 * reads) — never guessed or re-derived from raw observations. */
export async function listMeasuresForTable(db: Db, tableId: string): Promise<EurostatMeasure[]> {
  const { rows } = await db.query(`select units from cbs_tables where id = $1`, [tableId]);
  const raw = rows[0]?.units as unknown;
  const parsed: Record<string, { title?: string }> =
    typeof raw === 'string' ? JSON.parse(raw) : ((raw as Record<string, { title?: string }> | null) ?? {});
  return Object.entries(parsed)
    .map(([code, meta]) => ({ code, title: meta?.title ?? code }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export interface ExplorerFilter {
  tableId: string;
  measure: string;
  /** Plain 4-digit years — the whole "filter" this route offers (cheapest
   * mechanism first: a picked table + a year range beats a free-text query
   * for an internal tool with a handful of registered tables). Mapped to
   * annual CBS-shaped period codes (`<year>JJ00`) below. A full
   * grain/dimension picker is out of E1's scope. */
  fromYear: string;
  toYear: string;
}

/** The picked-table + year-range filter is ALL the explicit-target
 * StructuredIntent this route ever builds by hand (D5: zero new query/chart
 * code) — everything downstream of it is the real pipeline. Dims are
 * deliberately left empty: a table whose expected_dimensions declares an
 * unpinned plain Dimension simply resolves to a clarification, which the
 * route renders plainly (see page.tsx) rather than crashing on — a full
 * dimension picker is a named, explicit residual, not silently missing. */
function buildIntent(filter: ExplorerFilter): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'explicit', tableId: filter.tableId, measure: filter.measure },
    period: { kind: 'range', from: `${filter.fromYear}JJ00`, to: `${filter.toYear}JJ00` },
    derivation: 'none',
  };
}

/** A minimal 'intent' ParseOutcome — respondToIntent only reads
 * .intent/.impliedRecency/.question off it for the branches this route can
 * reach (the exact minimal-stub contract
 * tests/answer/respond-staleness.test.ts's stubIntentOutcome documents and
 * this module's own test pins independently); the rest is audit-trail
 * plumbing a picked-from-a-form filter never had an LLM parse to honestly
 * fill in, so it stays at a safe, clearly-labeled empty default. */
function buildParseOutcome(question: string, intent: StructuredIntent): Extract<ParseOutcome, { kind: 'intent' }> {
  return {
    kind: 'intent',
    question,
    raw: {
      version: RAW_PARSE_VERSION,
      kind: 'data_query',
      candidates: [],
      unmatchedMeasureTerm: null,
      nearestCanonicalKeys: [],
      note: 'eurostat-explorer: built from a picked table + year range, not a parsed question (D5c: no LLM parse ever runs on this route).',
    },
    model: 'none (eurostat-explorer: D5c, no LLM call)',
    usage: { inputTokens: 0, outputTokens: 0 },
    intent,
    confidence: 1,
    impliedRecency: false,
    ranked: [],
  };
}

/** THE real pipeline call (D5): runQuery -> composeAnswer(templateOnly) ->
 * buildChartSpec -> follow-up chips, all performed inside respondToIntent —
 * this module writes none of that logic itself, only the StructuredIntent +
 * ParseOutcome shims above it. */
export async function runExplorerQuery(db: Db, filter: ExplorerFilter): Promise<ComposedResponse> {
  const intent = buildIntent(filter);
  const question = `[eurostat-explorer] ${filter.tableId} / ${filter.measure} / ${filter.fromYear}-${filter.toYear}`;
  const parse = buildParseOutcome(question, intent);
  return respondToIntent(db, question, parse, {
    answerClient: new NeverCallAnswerClient(),
    referenceDate: new Date().toISOString().slice(0, 10),
    templateOnly: true,
  });
}
