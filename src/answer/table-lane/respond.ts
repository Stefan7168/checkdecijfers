// Breadth step 5, Task 3 — respondTableLane: a TableLanePlan (plan.ts) becomes
// ONE audited ComposedResponse, carrying the present-only `tableLane` envelope
// key (types.ts TableLaneEnvelope):
//   fetch  → an answer (or the query layer's own honest refusal) through the
//            EXISTING respondToIntent — the same runQuery, validators,
//            staleness rule, composition, chart and chips as a curated turn —
//            fed a minimal 'intent' ParseOutcome built from the validated
//            table-scoped parse (the eurostat-explorer precedent);
//   ask    → a clarification with the first 12 members as options and a
//            STRIPPED rescue carrier as `pending` (see buildClarification);
//   refuse / refusalOverride → a typed refusal from templates.ts.
// Every outcome goes through respondPreparsedAudited (src/answer/audit/
// respond-audited.ts): one audit_answers row, written before the response is
// returned, the same web/English attach and fail-closed rules as every
// audited entry point; the table parse lands in llm_calls as 'table_parse'.
//
// Principle (a): no number is produced here — the answer's cells come from
// runQuery over stored, validated cells; the selection note, titles and
// counts are metadata. Principle (b): no CBS contact, only our DB (the job
// did the fetch). Principle (c): every non-answer is a question or a typed
// refusal, never a default.
import { createHash } from 'node:crypto';
import type { Db } from '../../db/types.ts';
import type { StructuredIntent } from '../../query/types.ts';
import type { TableLaneRow } from '../../ingestion/table-lane-store.ts';
import {
  respondPreparsedAudited,
  type AuditedRespondOptions,
  type AuditedResponse,
} from '../audit/respond-audited.ts';
import type { LlmCallRecord } from '../audit/types.ts';
import type { ClarifyAxis, ParseOutcome, RawParse } from '../intent/types.ts';
import { RAW_PARSE_VERSION } from '../intent/types.ts';
import { respondToIntent } from '../respond/respond.ts';
import { toClarificationResponse, toInternalRefusal, toRefusalResponse } from '../respond/refusals.ts';
import type { ClarificationResponse, ComposedResponse } from '../respond/types.ts';
import type { TableParseSchema } from '../table-parse/input.ts';
import { serializeTableParseInput, type TableParseAudit } from '../table-parse/parse.ts';
import { selectionNote, type TableLanePlan } from './plan.ts';
import { buildTableLaneRefusal, tableLaneQuestionText } from './templates.ts';
import type { TableLaneEnvelope } from './types.ts';

export type { TableLaneEnvelope } from './types.ts';

/** The audit note on the minimal ParseOutcome the answer path hands to
 * respondToIntent (it names where the intent came from). */
export const TABLE_LANE_PARSE_NOTE = 'table-lane: intent built from a validated table-scoped parse (breadth step 5)';

export interface RespondTableLaneInput {
  row: TableLaneRow;
  plan: TableLanePlan;
  /** The stored slice the fetch plan ran against (the job's ensureSlice, or a
   * < 24 h cached slice — settled choice 1). null off the fetch path. */
  fetch: { ok: true; filterKey: string; fromCache: boolean } | null;
  /** The job's own refusals over any plan (CBS unreachable, gave up). */
  refusalOverride?: { reason: 'cbs_unreachable' | 'table_lane_failed'; detail: string };
  referenceDate: string;
  /** Compose client, semantic check, lang/translate — built by the job. */
  respondOptions: AuditedRespondOptions;
  /** CBS's own table title for the refusal templates; absent ⇒ the table id
   * names the table (the job knows the title once it read the schema). */
  tableTitle?: string | null;
}

/** sha256 (hex) of the offered menu — serializeTableParseInput's output
 * without its first line (the question), so the same table metadata always
 * hashes the same, whatever was asked. */
export function offeredMenuHash(offered: TableParseSchema): string {
  const serialized = serializeTableParseInput('', offered);
  const menu = serialized.slice(serialized.indexOf('\n') + 1);
  return createHash('sha256').update(menu).digest('hex');
}

function rawParse(): RawParse {
  return {
    version: RAW_PARSE_VERSION,
    kind: 'data_query',
    candidates: [],
    unmatchedMeasureTerm: null,
    nearestCanonicalKeys: [],
    note: TABLE_LANE_PARSE_NOTE,
  };
}

/** A minimal 'intent' ParseOutcome — copied from web/lib/eurostat-explorer.ts
 * buildParseOutcome (src/ must not import web/): respondToIntent only reads
 * .intent/.impliedRecency/.question off it; model/usage are the table parse's
 * own (it is the call that produced this intent), confidence the parse's own.
 * impliedRecency stays false like the precedent: the lane resolves "latest"
 * itself from the table's codes and states it in the selection note. */
function buildParseOutcome(
  question: string,
  intent: StructuredIntent,
  audit: TableParseAudit,
  confidence: number,
): Extract<ParseOutcome, { kind: 'intent' }> {
  return {
    kind: 'intent',
    question,
    raw: rawParse(),
    model: audit.model,
    usage: audit.usage,
    intent,
    confidence,
    impliedRecency: false,
    ranked: [],
  };
}

function envelope(input: RespondTableLaneInput, lang: 'nl' | 'en'): TableLaneEnvelope {
  const { row, plan, fetch } = input;
  const onFetchPath = plan.kind === 'fetch' && input.refusalOverride === undefined && fetch !== null;
  return {
    version: 1,
    rowId: row.id,
    tableId: row.tableId,
    finderConfidence: row.finderConfidence,
    parse: plan.parse,
    parseAudit: plan.parseAudit,
    offeredMenuHash: plan.kind === 'refuse' ? null : offeredMenuHash(plan.offered),
    selectionNote: onFetchPath && plan.kind === 'fetch' ? selectionNote(plan.selection, lang) : null,
    sliceFilterKey: onFetchPath && fetch !== null ? fetch.filterKey : null,
    question: plan.kind === 'ask' && input.refusalOverride === undefined ? plan.question : null,
    fromCachedSlice: onFetchPath && fetch !== null ? fetch.fromCache : false,
  };
}

/** The ask outcome: "Welke <dim> bedoelt u?" with the first 12 member titles
 * as options and chips. `pending` is a STRIPPED rescue carrier (rescueOnly,
 * no options, no clickOptions — isStrippedCarrier in respond.ts): a stale
 * client that posts a typed reply through the curated reply path gets it
 * answered as a FRESH question, never merged into this table-lane question
 * by the curated LLM merge. The lane's own reply path (Task 5) reads
 * `tableLane.question`, not this pending. */
function buildClarification(
  plan: Extract<TableLanePlan, { kind: 'ask' }>,
  row: TableLaneRow,
  referenceDate: string,
  lang: 'nl' | 'en' | undefined,
): ClarificationResponse {
  const question = plan.question;
  const text = tableLaneQuestionText(question);
  const titles = question.options.map((o) => o.title);
  // A breakdown dimension is offered to the parser; anything else the plan
  // asks about is a region dimension (regions.ts).
  const axis: ClarifyAxis = plan.offered.breakdowns.some((b) => b.name === question.dimension) ? 'measure' : 'region';
  const parse: ParseOutcome = {
    kind: 'clarification',
    question: row.question,
    raw: rawParse(),
    model: plan.parseAudit.model,
    usage: plan.parseAudit.usage,
    axes: [axis],
    question_nl: text.nl,
    options: titles,
    reason: `table-lane: which ${question.dimension} (${question.totalOptions} members)`,
  };
  const built = toClarificationResponse({
    question: row.question,
    referenceDate,
    axes: [axis],
    questionNl: text.nl,
    options: titles,
    parse,
    english: { question: text.en, options: titles, untranslated: [question.dimensionTitle] },
    englishChips: titles.map((title) => ({ label: title, submit: title })),
    lang,
  });
  return {
    ...built,
    suggestions: titles,
    pending: { ...built.pending, options: [], rescueOnly: true },
  };
}

export async function respondTableLane(db: Db, input: RespondTableLaneInput): Promise<AuditedResponse> {
  const { row, plan } = input;
  // The audit row carries the lane row's identity (Global Constraints, R8).
  const options: AuditedRespondOptions = {
    ...input.respondOptions,
    referenceDate: input.referenceDate,
    userId: row.userId,
    requestId: row.requestId,
    sourceTag: input.respondOptions.sourceTag ?? 'user',
  };
  const lang = options.lang;
  // The selection note follows the SAME language switch as every other text
  // on this response (respondOptions.lang, as the job builds it from the
  // row's lang) — so a flag-off English interface never mixes a Dutch answer
  // with an English note.
  const lane = envelope(input, lang ?? 'nl');
  const priorLlmCalls: LlmCallRecord[] =
    plan.parseAudit === null
      ? []
      : [
          {
            role: 'table_parse',
            model: plan.parseAudit.model,
            inputTokens: plan.parseAudit.usage.inputTokens,
            outputTokens: plan.parseAudit.usage.outputTokens,
          },
        ];
  const withLane = (response: ComposedResponse): ComposedResponse => ({ ...response, tableLane: lane });
  const templateContext = { tableId: row.tableId, tableTitle: input.tableTitle ?? null };

  return respondPreparsedAudited(
    db,
    {
      question: row.question,
      priorLlmCalls,
      produce: async (clients) => {
        if (input.refusalOverride !== undefined) {
          const built = buildTableLaneRefusal(input.refusalOverride.reason, {
            ...templateContext,
            detail: input.refusalOverride.detail,
          });
          return withLane(toRefusalResponse({ question: row.question, built, parse: null, queryRefusal: null, lang }));
        }
        if (plan.kind === 'refuse') {
          const built = buildTableLaneRefusal(plan.reason, {
            ...templateContext,
            detail: plan.detail,
            ...(plan.latestPeriodCode !== undefined ? { latestPeriodCode: plan.latestPeriodCode } : {}),
          });
          return withLane(toRefusalResponse({ question: row.question, built, parse: null, queryRefusal: null, lang }));
        }
        if (plan.kind === 'ask') {
          return withLane(buildClarification(plan, row, input.referenceDate, lang));
        }
        if (input.fetch === null) {
          // A fetch plan needs its stored slice; the job always passes one or
          // a refusalOverride. Fail closed rather than query unconfirmed cells.
          return withLane(toInternalRefusal(row.question, 'table-lane: fetch plan without a stored slice', lang));
        }
        // THE answer path: the same downstream half every audited curated
        // turn runs (respondToQuestion → respondToParseOutcome →
        // respondToIntent), with the options bag spread exactly like there.
        // finalRound: a query-level needs_clarification can never open a
        // curated reply round on a lane turn — it becomes still_ambiguous.
        const parse = buildParseOutcome(row.question, plan.intent, plan.parseAudit, plan.parse.confidence);
        const intentOptions = {
          ...options,
          answerClient: clients.answerClient,
          semanticCheck: clients.semanticCheck,
          conversationContext: null,
          finalRound: true,
        };
        try {
          return withLane(await respondToIntent(db, row.question, parse, intentOptions));
        } catch (error) {
          const note = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          return withLane(toInternalRefusal(row.question, `table-lane answer failed: ${note}`, lang));
        }
      },
    },
    options,
  );
}
