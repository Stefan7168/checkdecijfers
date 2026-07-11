// WP9 pipeline orchestrator: Dutch question -> ComposedResponse (answer /
// clarification / refusal), and the one-round clarification-reply follow-up.
// No LLM call lives in this file directly (it delegates to parseQuestion /
// parseClarificationReply / composeAnswer, each already confined to its own
// ADR-scoped role) and no refusal/clarification TEXT is ever produced by an
// LLM (ADR 015 — refusals.ts is templates only).
//
// Fail-closed: ANY thrown error anywhere in this pipeline (schema-invalid LLM
// output, API/db errors, an unexpected exception in a downstream step) is
// caught here and turned into an 'internal' refusal — this function never
// rethrows to the caller and never serves a partial/guessed answer
// (principle c).
import type { Db } from '../../db/types.ts';
import { echoServability, runQuery, type QueryOutcome, type ValidatedResult } from '../../query/index.ts';
import { buildChartSpec } from '../../chart/index.ts';
import { composeAnswer, type ComposeOptions } from '../compose/index.ts';
import { parseQuestion, type ParseQuestionOptions } from '../intent/parse.ts';
import { parseClarificationReply, type ClarifyReplyOptions } from '../intent/clarify.ts';
import { parseFollowUpQuestion } from '../intent/followup.ts';
import type { ConversationContext } from '../context/types.ts';
import type { ParseOutcome, ParserConfig } from '../intent/types.ts';
import { RawParseValidationError } from '../intent/types.ts';
import type { IntentLlmClient } from '../intent/client.ts';
import type { LlmClient } from '../llm/client.ts';
import {
  buildOnboardingRefusal,
  buildParseRefusal,
  buildQueryRefusal,
  buildStillAmbiguousRefusal,
  statusSuffixNl,
  toClarificationResponse,
  toInternalRefusal,
  toRefusalResponse,
} from './refusals.ts';
import type { TableFinder } from '../intent/policy.ts';
import type { OnboardedMeasure } from '../intent/prompt.ts';
import { checkStaleness } from './staleness.ts';
import { buildSuggestions } from './suggestions.ts';
import type { AnswerResponse, ClarificationResponse, ComposedResponse, PendingClarification } from './types.ts';
import { RESPONSE_SCHEMA_VERSION } from './types.ts';

export interface RespondOptions {
  /** Shared LLM client for BOTH intent parsing and clarify-reply parsing
   * (same seam, ADR 012/013). */
  intentClient: IntentLlmClient;
  /** LLM client for answer phrasing (ADR 013's harness — same interface,
   * different model/fixtures). */
  answerClient: LlmClient;
  /** YYYY-MM-DD "today" — injected, never the wall clock (docs/05 staleness,
   * ADR 012 period policy). */
  referenceDate: string;
  parserConfig?: ParserConfig;
  /** WP15 (ADR 021): the previous turn's resolved intent as a merge candidate
   * for follow-up questions. MUST already be validated (context/validate.ts)
   * — the caller owns the trust boundary; this layer treats it as vocabulary.
   * Absent/null = a standalone first-turn parse, exactly the pre-WP15 path. */
  conversationContext?: ConversationContext | null;
  /** WP16 sub-part 2 (ADR 026): OPTIONAL table-finder. Wired ONLY by
   * web/app/actions.ts's askQuestion dependency construction; absent
   * everywhere else (benchmark, tests, CLI, replyToClarification) → the
   * unmatched exit stays the byte-identical B15 clarification. When present,
   * a confident finder pick routes an unloaded topic to the on-demand fetch
   * acknowledgment ('onboarding_pending' / 'onboarding_already_pending'). */
  tableFinder?: TableFinder;
  /** WP16 sub-part 2 (ADR 026, design §3.6): OPTIONAL on-demand-onboarded
   * measures appended to the parser vocabulary. Passed by the onboarding
   * job's delivery re-run (src/ingestion/onboarding.ts) so the just-onboarded
   * measure is parseable, and — #112 — by web/app/actions.ts's live chat
   * turns (loadOnboardedVocabulary) so an ALREADY-onboarded topic answers at
   * the normal question price instead of re-triggering the 100-credit
   * onboarding. Absent/empty everywhere else (benchmark, tests, CLI) →
   * byte-identical Phase-0 prompt (fixtures + benchmark unaffected). */
  extraCanonicalMeasures?: OnboardedMeasure[];
}

/** Shared downstream half once we have an 'intent' ParseOutcome: query ->
 * staleness -> compose+chart, OR the appropriate refusal. Used by both
 * respondToQuestion and respondToClarificationReply so the two entry points
 * can never diverge in how a resolved intent is turned into a response.
 * Exported for direct unit testing of the staleness/query-refusal branches
 * with a hand-built ParseOutcome (tests/answer/respond-staleness.test.ts) —
 * it is not merely a private helper, both public entry points already share
 * it as their downstream implementation. */
export async function respondToIntent(
  db: Db,
  question: string,
  parse: Extract<ParseOutcome, { kind: 'intent' }>,
  options: {
    answerClient: LlmClient;
    referenceDate: string;
    finalRound?: boolean;
    /** WP15: the follow-up referent, threaded into a query-level
     * needs_clarification's pending state so the reply merge keeps it. */
    conversationContext?: ConversationContext | null;
  },
): Promise<ComposedResponse> {
  const outcome: QueryOutcome = await runQuery(db, parse.intent);

  if (!outcome.ok) {
    const built = buildQueryRefusal(outcome);
    if (built.kind === 'clarification') {
      // The one-round rule must hold on BOTH clarification shapes: the
      // parser-level one (caught in respondToClarificationReply) and this
      // query-level needs_clarification (the missing-region check lives in
      // the query layer by design — resolve.ts's pass-through policy). On a
      // reply turn it becomes the still-ambiguous refusal, never a second
      // question (R7 / ADR 015; adversarial-review finding, 2026-07-03).
      if (options.finalRound) {
        const stillAmbiguous = await buildStillAmbiguousRefusal(db, built.axes);
        return toRefusalResponse({ question, built: stillAmbiguous, parse, queryRefusal: outcome });
      }
      return toClarificationResponse({
        question,
        referenceDate: options.referenceDate,
        axes: built.axes,
        questionNl: built.questionNl,
        options: built.options,
        parse,
        conversationContext: options.conversationContext ?? null,
      });
    }
    return toRefusalResponse({ question, built: built.refusal, parse, queryRefusal: outcome });
  }

  const result: ValidatedResult = outcome;
  const staleness = await checkStaleness(db, result, options.referenceDate);

  // docs/05 staleness row, recency-implying branch: refuse rather than warn
  // when the question implied "now"/"latest" (impliedRecency) AND the table
  // is stale. Covered historical periods (impliedRecency === false) always
  // warn-and-serve instead (the other branch, below).
  if (staleness.stale && parse.impliedRecency) {
    // R11 also applies to a period OFFER: when the period we point at carries
    // a non-definitive CBS status, say so — same marker the freshness refusal
    // uses (adversarial-review finding, 2026-07-03).
    const lastCell = result.cells[result.cells.length - 1];
    const freshestPeriodLabel = lastCell
      ? `${lastCell.periodLabel}${statusSuffixNl(lastCell.status)}`
      : '';
    const body =
      `Deze cijfers zijn ouder dan verwacht voor een vraag naar het meest recente cijfer — ` +
      `onze laatste synchronisatie was op ${result.attribution.syncedAt.slice(0, 10)}, ` +
      `en ik wil geen verouderd cijfer als "actueel" laten doorgaan.`;
    const guidance = `Vraag gerust naar het cijfer voor een specifieke, al gedekte periode (bijvoorbeeld ${freshestPeriodLabel}) — dat kan ik direct geven.`;
    return toRefusalResponse({
      question,
      built: {
        reason: 'staleness',
        text: `${body} ${guidance}`,
        offer: null,
        guidance,
        freshness: null,
        internalNote: null,
      },
      parse,
      queryRefusal: null,
    });
  }

  const answer = await composeAnswer(result, { client: options.answerClient } satisfies ComposeOptions);
  const chart = buildChartSpec(result);
  const text = staleness.stale ? `${answer.text}\n\n${staleness.warning}` : answer.text;

  // WP29 (#73, ADR 029): follow-up chips, servability-gated through the same
  // dry-run primitive policy.ts uses (a closure over db, mirroring parse.ts's
  // construction). FAIL-OPEN belt on top of buildSuggestions' own: a
  // suggestions hiccup may never cost the user the paid answer — the same
  // rule web/app/actions.ts applies to outcomeContext. Assembled
  // post-compose: `text` above is already final and stays byte-untouched.
  let suggestions: string[] = [];
  try {
    suggestions = await buildSuggestions(parse.intent, result, (candidate) =>
      echoServability(db, candidate),
    );
  } catch {
    suggestions = [];
  }

  const response: AnswerResponse = {
    schemaVersion: RESPONSE_SCHEMA_VERSION,
    question,
    text,
    kind: 'answer',
    answer,
    chart,
    stalenessWarning: staleness.stale ? staleness.warning : null,
    parse,
    result,
    suggestions,
  };
  return response;
}

async function respondToParseOutcome(
  db: Db,
  question: string,
  parse: ParseOutcome,
  options: {
    answerClient: LlmClient;
    referenceDate: string;
    conversationContext?: ConversationContext | null;
  },
): Promise<ComposedResponse> {
  if (parse.kind === 'refusal') {
    const built = await buildParseRefusal(db, parse);
    return toRefusalResponse({ question, built, parse, queryRefusal: null });
  }
  if (parse.kind === 'onboarding') {
    // WP16 sub-part 2 (ADR 026): the finder confidently picked a CBS table for
    // an unloaded topic. Ride the refusal envelope with the acknowledgment
    // copy; the structured `onboarding` field travels out so the web action
    // can trigger the fetch + 100-credit debit (that money lives OUTSIDE this
    // module). alreadyPending → the no-new-fetch copy + no envelope field.
    const built = buildOnboardingRefusal(
      {
        tableId: parse.tableId,
        topicTerm: parse.topicTerm,
        confidence: parse.confidence,
        candidateIds: parse.candidateIds,
      },
      parse.alreadyPending,
    );
    return toRefusalResponse({ question, built, parse, queryRefusal: null });
  }
  if (parse.kind === 'clarification') {
    // WP15 (review finding 2026-07-04): a clarification of a FOLLOW-UP
    // question must carry the referent into the pending state — the reply
    // merge otherwise sees only the bare elliptical text ("En in
    // Nederland?") and the round dead-ends in still_ambiguous.
    return toClarificationResponse({
      question,
      referenceDate: options.referenceDate,
      axes: parse.axes,
      questionNl: parse.question_nl,
      options: parse.options,
      parse,
      conversationContext: options.conversationContext ?? null,
    });
  }
  return respondToIntent(db, question, parse, options);
}

export async function respondToQuestion(
  db: Db,
  question: string,
  options: RespondOptions,
): Promise<ComposedResponse> {
  try {
    const parseOptions: ParseQuestionOptions = {
      client: options.intentClient,
      referenceDate: options.referenceDate,
      config: options.parserConfig,
      // WP16 sub-part 2 (ADR 026): threaded into BOTH the standalone and
      // follow-up parse (parseFollowUpQuestion accepts the same field) so an
      // unmatched topic on either turn can route to onboarding when a finder
      // is injected. Undefined when absent → B15 unchanged.
      tableFinder: options.tableFinder,
      // WP16 sub-part 2 delivery vocabulary (design §3.6): undefined/empty →
      // byte-identical Phase-0 prompt.
      extraCanonicalMeasures: options.extraCanonicalMeasures,
    };
    // WP15 (ADR 021): with a validated context, the parse runs in follow-up
    // mode — same downstream machinery, same thresholds, same one round of
    // clarification per question (finalRound stays a reply-turn concept).
    const context = options.conversationContext ?? null;
    const parse =
      context === null
        ? await parseQuestion(db, question, parseOptions)
        : await parseFollowUpQuestion(db, context, question, parseOptions);
    return await respondToParseOutcome(db, question, parse, options);
  } catch (error) {
    return toInternalRefusal(question, internalNoteFor(error));
  }
}

/** The user's reply to the one open clarification round, merged with the
 * pending partial intent (never treated as a fresh question). A 'clarification'
 * outcome here means the round is OVER: still-ambiguous -> refusal-with-
 * guidance, never a second question (docs/05, R7). */
export async function respondToClarificationReply(
  db: Db,
  pending: PendingClarification,
  reply: string,
  options: RespondOptions,
): Promise<ComposedResponse> {
  try {
    const clarifyOptions: ClarifyReplyOptions = {
      client: options.intentClient,
      config: options.parserConfig,
      // #112: the reply merge must accept the same onboarded keys the first
      // turn's parse could have put in the pending's candidates — without
      // this, an 'onboarded:' key fails the reply-turn schema validation and
      // the round dead-ends in an internal refusal. Empty/absent → clarify
      // prompt + schema bytes unchanged (fixtures stay valid).
      extraCanonicalMeasures: options.extraCanonicalMeasures,
    };
    const parse = await parseClarificationReply(db, pending, reply, clarifyOptions);

    if (parse.kind === 'refusal') {
      // WP18: parse.question echoes the ORIGINAL question here (clarify.ts);
      // a smalltalk classification belongs to the REPLY (the abandon rule),
      // so the meta router must match the reply text, not the original.
      const built = await buildParseRefusal(db, parse, reply);
      return toRefusalResponse({ question: pending.question, built, parse, queryRefusal: null });
    }
    if (parse.kind === 'onboarding') {
      // WP16 sub-part 2 (ADR 026): unreachable in production — clarifyOptions
      // above deliberately injects NO tableFinder, so a reply-turn unmatched
      // exit stays the byte-identical B15 clarification (a reply-turn
      // onboarding trigger is a separate, unmade decision). Handled here for
      // type exhaustiveness and to stay correct-by-construction if the finder
      // is ever wired into this path: same acknowledgment as a fresh turn.
      const built = buildOnboardingRefusal(
        {
          tableId: parse.tableId,
          topicTerm: parse.topicTerm,
          confidence: parse.confidence,
          candidateIds: parse.candidateIds,
        },
        parse.alreadyPending,
      );
      return toRefusalResponse({ question: pending.question, built, parse, queryRefusal: null });
    }
    if (parse.kind === 'clarification') {
      // Final round rule: never ask again. Convert to refusal-with-guidance.
      const built = await buildStillAmbiguousRefusal(db, parse.axes);
      return toRefusalResponse({ question: pending.question, built, parse, queryRefusal: null });
    }
    // finalRound: a query-level needs_clarification after a reply must also
    // become the still-ambiguous refusal, never a second question (R7).
    return await respondToIntent(db, pending.question, parse, { ...options, finalRound: true });
  } catch (error) {
    return toInternalRefusal(pending.question, internalNoteFor(error));
  }
}

function internalNoteFor(error: unknown): string {
  if (error instanceof RawParseValidationError) {
    return `RawParseValidationError: ${error.message} (raw output: ${error.outputText.slice(0, 500)})`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
