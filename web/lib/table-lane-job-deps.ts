// The production dependencies of the table-lane job (breadth step 5, Task 4),
// shared by its own route (/api/table-lane-job, fired by the kick) and the
// daily backstop sweep in /api/onboarding-cron — one builder, so the two
// callers can never wire the job differently. Server-only (constructs the live
// CBS source and Anthropic clients); never imported by a client component.
//
// The respond options mirror a live chat turn's: the compose client, the
// reject-only semantic checker and referenceDate() from the SAME shared helper
// askQuestion uses (web/lib/turn-options.ts), and the English-answers options
// for an English reader (englishAnswerOptions — a no-op unless its flag is on).
import type { AuditedRespondOptions } from '../backend/answer/audit/respond-audited.ts';
import { AnthropicLlmClient } from '../backend/answer/llm/client.ts';
import { ODataV4Source } from '../backend/cbs-adapter/odata-v4.ts';
import { StatisticsApiSource } from '../backend/eurostat-adapter/statistics-api.ts';
import { eurostatFinderEnabled } from '../backend/catalog/recall.ts';
import { EUROSTAT_SOURCE_KEY, sourceKeyForTableId } from '../backend/sources/registry.ts';
import type { Db } from '../backend/db/types.ts';
import type { TableLaneJobDeps } from '../backend/ingestion/table-lane-job.ts';
import { englishAnswerOptions } from './english-answers.ts';
import { referenceDate, semanticCheckOptions } from './turn-options.ts';

export function tableLaneJobDeps(db: Db): TableLaneJobDeps {
  const today = referenceDate();
  const cbs = new ODataV4Source();
  let eurostatSource: StatisticsApiSource | null = null;
  const eurostat = () => (eurostatSource ??= new StatisticsApiSource(fetch, { structureLayout: { decimals: 'observed' } }));
  return {
    db,
    source: cbs,
    // Session 153 (Eurostat study step 4, DARK): a `eurostat:` table is read from
    // Eurostat — its structure, decimals from a small read of real values — but
    // ONLY while the Eurostat finder is switched on; otherwise every row keeps
    // the CBS source exactly as before (a stray eurostat id then fails closed).
    sourceFor: (tableId: string) =>
      sourceKeyForTableId(tableId) === EUROSTAT_SOURCE_KEY && eurostatFinderEnabled() ? eurostat() : cbs,
    // The parser's own model constant lives inside tableParse.
    parseClient: new AnthropicLlmClient(),
    referenceDate: today,
    respondOptions: (lang: 'nl' | 'en'): AuditedRespondOptions => ({
      referenceDate: today,
      intentClient: new AnthropicLlmClient(),
      answerClient: new AnthropicLlmClient(),
      ...semanticCheckOptions(),
      ...englishAnswerOptions(lang),
    }),
  };
}
