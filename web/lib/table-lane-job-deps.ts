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
import type { Db } from '../backend/db/types.ts';
import type { TableLaneJobDeps } from '../backend/ingestion/table-lane-job.ts';
import { englishAnswerOptions } from './english-answers.ts';
import { referenceDate, semanticCheckOptions } from './turn-options.ts';

export function tableLaneJobDeps(db: Db): TableLaneJobDeps {
  const today = referenceDate();
  return {
    db,
    source: new ODataV4Source(),
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
