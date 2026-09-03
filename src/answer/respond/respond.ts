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
import {
  echoServability,
  freshestForCanonical,
  runQuery,
  type QueryOutcome,
  type ValidatedResult,
} from '../../query/index.ts';
import { buildChartSpec } from '../../chart/index.ts';
import { composeAnswer, type ComposeOptions } from '../compose/index.ts';
import { parseQuestion, type ParseQuestionOptions } from '../intent/parse.ts';
import { parseClarificationReply, type ClarifyReplyOptions } from '../intent/clarify.ts';
import { parseFollowUpQuestion } from '../intent/followup.ts';
import type { ConversationContext } from '../context/types.ts';
import { regionTermsFor } from '../context/build.ts';
import type { ClickOption, ParseOutcome } from '../intent/types.ts';
import type { FreshIntentParseOptions } from '../intent/options.ts';
import { MAX_CLICK_OPTIONS, RawParseValidationError, RAW_PARSE_VERSION } from '../intent/types.ts';
import type { LlmClient } from '../llm/client.ts';
import {
  buildNoSourcesRefusal,
  buildOnboardingRefusal,
  buildParseRefusal,
  buildQueryRefusal,
  buildStillAmbiguousRefusal,
  buildWebOnlyRefusal,
  statusSuffixNl,
  toClarificationResponse,
  toInternalRefusal,
  toRefusalResponse,
} from './refusals.ts';
import { CBS_SOURCE_KEY } from '../../sources/registry.ts';
import type { SourceSelection } from '../../websearch/types.ts';
import { buildRescueOffer } from './rescue.ts';
import { checkStaleness } from './staleness.ts';
import { buildAnswerChips, buildRefusalSuggestions } from './suggestions.ts';
import type {
  AnswerResponse,
  ClarificationResponse,
  ComposedResponse,
  PendingClarification,
  RefusalResponse,
} from './types.ts';
import { RESPONSE_SCHEMA_VERSION } from './types.ts';

/** The respond entry points' options bag.
 *
 * The intent-parse subset — referenceDate, tableFinder, extraCanonicalMeasures,
 * clickOptionsEnabled, answerFirstEnabled — is INHERITED from
 * FreshIntentParseOptions (intent/options.ts, the single source of truth for
 * that shape; PR #93 review finding). This interface used to hand-duplicate it
 * under the same field names, which is the exact drift class that produced
 * #176/#191 on the intent side: a WP16/WP26 field added to one bag and not the
 * others compiles cleanly and silently drops a seam on one call path. Now a
 * field added to the intent bags appears here by construction, and the
 * `ThreadedInto` guards below turn a not-yet-threaded field into a compile
 * error instead of a silent drop. See the intent/options.ts field comments for
 * each inherited seam's contract; respond-path wiring notes:
 *  - tableFinder is wired ONLY by web/app/actions.ts's askQuestion dependency
 *    construction (absent: benchmark, tests, CLI, replyToClarification → the
 *    unmatched exit stays the byte-identical B15 clarification); a confident
 *    finder pick routes an unloaded topic to the on-demand fetch
 *    acknowledgment ('onboarding_pending' / 'onboarding_already_pending');
 *  - extraCanonicalMeasures is passed by the onboarding job's delivery re-run
 *    (src/ingestion/onboarding.ts) and — #112 — by web/app/actions.ts's live
 *    chat turns (loadOnboardedVocabulary) so an ALREADY-onboarded topic
 *    answers at the normal question price instead of re-triggering the
 *    100-credit onboarding;
 *  - clickOptionsEnabled (CLARIFY_CLICK_ENABLED) additionally gates the
 *    deterministic take-rung in respondToClarificationReply below.
 *
 * `client`/`config` are aliased to the respond layer's own names
 * (intentClient/parserConfig — this bag also carries answerClient, so a bare
 * `client` would be ambiguous); `model`/`maxTokens` are deliberately NOT
 * exposed — each client harness owns its model (INTENT_MODEL /
 * PHRASING_MODEL), and no respond caller ever overrode them per call. */
export interface RespondOptions
  extends Omit<FreshIntentParseOptions, 'client' | 'config' | 'model' | 'maxTokens'> {
  /** Shared LLM client for BOTH intent parsing and clarify-reply parsing
   * (same seam, ADR 012/013). */
  intentClient: FreshIntentParseOptions['client'];
  parserConfig?: FreshIntentParseOptions['config'];
  /** LLM client for answer phrasing (ADR 013's harness — same interface,
   * different model/fixtures). */
  answerClient: LlmClient;
  /** #144 (ADR 034): OPTIONAL additive reject-only semantic checker over
   * residual-prone LLM bodies. Wired ONLY when the env flag is on
   * (web/app/actions.ts); absent everywhere else (benchmark, tests, CLI) →
   * byte-identical pre-#144 behavior, zero extra LLM calls. */
  semanticCheck?: ComposeOptions['semanticCheck'];
  /** WP15 (ADR 021): the previous turn's resolved intent as a merge candidate
   * for follow-up questions. MUST already be validated (context/validate.ts)
   * — the caller owns the trust boundary; this layer treats it as vocabulary.
   * Absent/null = a standalone first-turn parse, exactly the pre-WP15 path. */
  conversationContext?: ConversationContext | null;
  /** WP129+130 (#129/#130, ADR 032): the #129 source-tags selection, a
   * STRUCTURAL input (never prompt text). Present only when the web action
   * wires it (flag on). When CBS is not selected it drives the deterministic
   * pre-parse refusal below (web_only / no_sources); otherwise it is inert to
   * the parse and rides through to the audit envelope via attachWebAugmentation.
   * Absent everywhere else (benchmark, tests, CLI) → byte-identical pre-WP path.
   */
  sourceSelection?: SourceSelection;
  /** #162 (ADR-DRAFT slot-filling, hermetic half): the `SLOT_PHRASING_ENABLED`
   * experiment flag, wired ONLY by web/app/actions.ts. Off/absent (benchmark,
   * tests, CLI, and production — the default) ⇒ composeAnswer runs the
   * see-and-echo ladder byte-identically; true ⇒ the slot rung replaces the
   * two LLM rungs (template floor unchanged). */
  slotPhrasing?: boolean;
}

/** The target bag, with EVERY key (the optional ones included) required to be
 * named: the construction sites below build `ThreadedInto<...>` objects, so a
 * field newly added to IntentCallOptions/FreshIntentParseOptions fails
 * compilation RIGHT AT the bag that forgot to thread it — the #176/#191
 * silent-drop class caught by tsc instead of by a production misfire. An
 * optional field the site deliberately does not thread is written as an
 * explicit `undefined` with a comment saying why — runtime-identical to the
 * absent key for every consumer (no exactOptionalPropertyTypes in this repo;
 * consumers read `options.model ?? INTENT_MODEL` style). */
type ThreadedInto<T> = T & Record<keyof T, unknown>;

/** WP26 mechanism A: the model field of a take that ran NO model. Recorded on
 * the audit row so R8 shows at a glance that this answer's reading came from
 * the user's own click, not from a parse. */
export const CLICK_TAKE_MODEL = 'deterministic/wp26-click-option' as const;

/** Byte-exact (whitespace-trimmed) match of a reply against the labels offered
 * with the pending clarification. Trimmed, not fuzzy: the chip fills the input
 * with the label verbatim, and a TYPED reply that happens to equal an offered
 * option is exactly the dead-end class this rescues — but anything else must
 * fall through to the normal LLM merge, never to a guessed "closest" option
 * (principle c). Defensive on shape: `pending` is client-held, so entries that
 * are not well-formed are skipped rather than trusted. */
function matchClickOption(pending: PendingClarification, reply: string): ClickOption | null {
  const wanted = reply.trim();
  if (wanted === '') return null;
  // A chip's label is ALWAYS one of the plain-text options we offered: all
  // three offer sites build the two lists from the same strings (the two
  // policy.ts clarification rules map over `options`, and the rescue chip sets
  // `options: [chipLabel]`). The pending is client-held, so that invariant is
  // re-derived here instead of assumed — otherwise a forged pending could
  // attach any intent to any label, and the user's own echoed message would
  // describe something other than what was served.
  const offered = new Set(
    (Array.isArray(pending.options) ? pending.options : [])
      .filter((label): label is string => typeof label === 'string')
      .map((label) => label.trim()),
  );
  if (!offered.has(wanted)) return null;
  for (const option of pending.clickOptions ?? []) {
    if (
      option !== null &&
      typeof option === 'object' &&
      typeof option.label === 'string' &&
      option.label.trim() === wanted &&
      option.intent !== null &&
      typeof option.intent === 'object'
    ) {
      return option;
    }
  }
  return null;
}

/** #178: `impliedRecency` is carried on the option, never re-derived
 * (ClickOption's own doc comment) — but that only covers the WARN-vs-REFUSE
 * staleness rule (`checkStaleness` measures TABLE sync age). It says nothing
 * about whether the option's own STORED period is still the freshest: a chip
 * minted for "nu" bakes in whatever was freshest at OFFER time, and a table
 * that syncs a newer period afterwards is never "stale" by that check even
 * though the chip's period has fallen behind. This re-derives the CURRENT
 * freshest period for the option's canonical key — at the SAME grain the
 * stored code carries (mixing grains is not a valid freshness comparison:
 * `freshestForCanonical`'s own doc) and for EVERY region the option names
 * (a national default when it names none) — and reports whether the stored
 * code still matches everywhere it applies. Anything that doesn't imply
 * recency skips the check entirely (nothing to re-derive, no extra query on
 * the common path); an inconclusive lookup (the canonical key vanished, a
 * region has no data at all, the table was quarantined since offer time)
 * fails closed — false, not a guess.
 *
 * Known accepted gap, not silently missed (open-questions #178): a `relative`
 * period ("3 maanden geleden") is ALSO marked `impliedRecency: true` — not
 * because it tracks "the freshest", but because a stale TABLE might not have
 * published that calendar point yet (the existing warn/refuse rule this
 * shares with every other recency-implying shape). Its resolved code is pure
 * calendar arithmetic, not `latestPeriod`-derived, so it will essentially
 * never equal the current freshest and this check always sends it through
 * the LLM-merge fallback — safe (the fallback is the ordinary, already-
 * trusted parse path; no wrong number can result) but a needless loss of the
 * zero-LLM-call guarantee for that one PeriodSpec shape. `ClickOption` does
 * not carry which PeriodSpec produced its resolution, so this check cannot
 * distinguish "wants the latest" from "computed relative to today" without a
 * schema change — left as a follow-up, not solved here. */
async function clickOptionStillCurrent(db: Db, option: ClickOption): Promise<boolean> {
  if (option.impliedRecency !== true) return true;
  const { target, period, regions } = option.intent;
  if (target.kind !== 'canonical') return false;
  const referenceCode = period.kind === 'range' ? period.to : period.codes[period.codes.length - 1];
  const grain = referenceCode.slice(4, 6) as 'JJ' | 'KW' | 'MM';
  const checkRegions = regions && regions.length > 0 ? regions : [undefined];
  const freshestPerRegion = await Promise.all(
    checkRegions.map((regionCode) => freshestForCanonical(db, target.key, { regionCode, grain })),
  );
  return freshestPerRegion.every((freshest) => freshest !== null && freshest.periodCode === referenceCode);
}

/** A CHIP-CARRIER pending: WP26c's single rescue chip on a misfired refusal
 * and, since #197 step 3, the chips under an answer — the comparison chips
 * first, and since #73 v2 every takeable follow-up chip (at most
 * MAX_SUGGESTIONS = 3 of them, inside the 1..MAX_CLICK_OPTIONS = 4 bound
 * below; pinned in tests/answer/wp29-click-take.test.ts). Both mint the
 * same shape — `rescueOnly`, one to MAX_CLICK_OPTIONS chips, `options` the
 * chips' labels in the same order (byte-equal, index for index), at least one
 * declared axis. The reply turn treats such a pending as a CLOSED round (the
 * branch below): a matching reply is taken, anything else is a fresh question.
 * That is a real behavioural fork — so it is granted on the SHAPE, never on
 * the client's bare word.
 *
 * Why the shape and not the feature flag. Checking `clickOptionsEnabled` would
 * read as the tighter rule, but it is the wrong one in the case that actually
 * matters: after the owner rolls `CLARIFY_CLICK_ENABLED` back off, a carrier
 * pending legitimately minted minutes earlier is still sitting in someone's
 * open tab, and it must keep routing correctly rather than being merged into
 * the answer or refusal it was attached to. The shape check keeps that
 * rollback graceful AND closes the forgery: a bare `{rescueOnly: true}` never
 * reaches this branch, so with both flags off nothing here is reachable that
 * was not reachable before WP26. (Before #197 the shape was pinned to exactly
 * one chip on one `measure` axis; widened to N chips with pairwise-bound
 * labels — the label binding, not the axis literal, is what closes forgery.
 * A `rescueOnly` with NO options at all is the STRIPPED-carrier shape and is
 * routed fresh by `isStrippedCarrier` below — see there for why that byte
 * grants a client nothing.) */
export function isRescuePending(pending: PendingClarification): boolean {
  if (pending.rescueOnly !== true) return false;
  const { clickOptions, options, axes } = pending;
  return (
    Array.isArray(clickOptions) &&
    clickOptions.length >= 1 &&
    clickOptions.length <= MAX_CLICK_OPTIONS &&
    Array.isArray(options) &&
    options.length === clickOptions.length &&
    Array.isArray(axes) &&
    axes.length >= 1 &&
    axes.every((axis) => typeof axis === 'string') &&
    clickOptions.every(
      (option, index) =>
        option !== null &&
        typeof option === 'object' &&
        typeof option.label === 'string' &&
        option.label === options[index],
    )
  );
}

/** #73 v2 review (PR #122, 2026-09-03): a STRIPPED carrier — `rescueOnly`
 * whose every option the trust boundary dropped. withValidatedClickOptions
 * re-aligns a carrier's `options` to the surviving chips, so the stripped
 * shape is exactly `rescueOnly` + empty options + no clickOptions. Nothing is
 * left to take, and a carrier was never an open round, so every reply is a
 * FRESH question — the documented fallback for a chip whose take-path is gone
 * (a rollback, a stale or malformed option). A client can post this shape
 * unprompted too, and gains nothing by it: the branch IS the ordinary
 * question path it could call directly (no finder, no context — the reply
 * bag), so the session-57 property holds in substance — no new capability,
 * no money difference, no wrong number. What guards the shape on the DEPLOYED
 * path (review round 2): the trust boundary — `withValidatedClickOptions`,
 * applied in web/app/actions.ts before this module is reached — re-aligns a
 * carrier's `options` to its surviving chips, so a carrier arriving here is
 * either well-formed or stripped. A `rescueOnly` WITH options but without
 * chips reaches the merge only when this function is called DIRECTLY — the
 * bare-forgery pin in tests/answer/rescue-chip.test.ts documents that
 * direct-call property; tests/answer/wp26-trust-boundary.test.ts pins the
 * deployed one (a bare forgery becomes the stripped carrier, a mis-paired one
 * is repaired to its chips' labels). */
export function isStrippedCarrier(pending: PendingClarification): boolean {
  return (
    pending.rescueOnly === true &&
    Array.isArray(pending.options) &&
    pending.options.length === 0 &&
    (pending.clickOptions === undefined ||
      (Array.isArray(pending.clickOptions) && pending.clickOptions.length === 0))
  );
}

/** #197 step 3: the `questionNl` of an answer's chip-carrier pending. Required
 * by the pending's shape; never rendered — the chat input shows no placeholder
 * for a `rescueOnly` pending because nothing was asked (chat.tsx). Worded
 * neutrally since #73 v2, when the carrier stopped being comparison-only
 * (rows minted before that carry the old 'Vergelijk dit cijfer met:'). */
export const CHIP_CARRIER_QUESTION_NL = 'Vervolg op dit antwoord:';

/** The taken option, shaped as the 'intent' ParseOutcome the shared downstream
 * half already knows how to serve — so a clicked answer runs the SAME query,
 * validators, staleness rule, gate and audit write as a typed one. Zero token
 * usage is recorded because zero tokens were spent. */
function clickTakeOutcome(
  pending: PendingClarification,
  option: ClickOption,
): Extract<ParseOutcome, { kind: 'intent' }> {
  const reading = {
    intent: option.intent,
    confidence: 1,
    reading: option.label,
    impliedRecency: option.impliedRecency === true,
  };
  return {
    kind: 'intent',
    question: pending.question,
    raw: {
      version: RAW_PARSE_VERSION,
      kind: 'data_query',
      candidates: [],
      unmatchedMeasureTerm: null,
      nearestCanonicalKeys: [],
      note: `WP26 A2: clarification option "${option.id}" taken deterministically (no LLM parse)`,
    },
    model: CLICK_TAKE_MODEL,
    usage: { inputTokens: 0, outputTokens: 0 },
    intent: option.intent,
    // Not a model score: the user themselves picked this reading from options
    // that were proven servable before they were offered.
    confidence: 1,
    impliedRecency: reading.impliedRecency,
    ranked: [reading],
  };
}

/** WP129+130 (#129/#130, ADR 032): the source-selection pre-parse belt. When
 * CBS is not among the selected sources, no verified answer is possible: the
 * web-only mode ('web_only', with the web section rendered below by
 * attachWebAugmentation) if the Internet chip is on, else the empty-selection
 * refusal ('no_sources'). Emitted BEFORE any parse/LLM (zero prompt bytes, zero
 * cost). Absent selection (the benchmark/tests/CLI default) ⇒ null, byte-
 * identical to the pre-WP path. */
function sourceSelectionRefusal(
  question: string,
  selection: SourceSelection | undefined,
): RefusalResponse | null {
  if (selection === undefined) return null;
  if (selection.sources.includes(CBS_SOURCE_KEY)) return null;
  const built = selection.web ? buildWebOnlyRefusal() : buildNoSourcesRefusal();
  return toRefusalResponse({ question, built, parse: null, queryRefusal: null });
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
    /** #144 (ADR 034): threaded through to composeAnswer; absent = off. */
    semanticCheck?: ComposeOptions['semanticCheck'];
    /** WP26 mechanism A: compose from the deterministic template, no LLM call
     * (ADR 024). Set only by the clicked-option take-path. */
    templateOnly?: boolean;
    /** WP26 mechanism B (ADR 024): the answer-first defaults, threaded into the
     * query layer AND into every dry-run below so the chips are gated by the
     * same rules the answer itself ran under. */
    answerFirstEnabled?: boolean;
    /** #197 step 3: WP26 mechanism A's flag (CLARIFY_CLICK_ENABLED). True ⇒
     * the answer may carry its chips on a chip-carrier pending, taken
     * deterministically on the reply turn — the comparison chips, and since
     * #73 v2 every takeable follow-up chip; absent/false ⇒ the pre-#197 chip
     * list and NO `pending` key (byte-identical envelope). Both public entry
     * points pass it through their options spread. */
    clickOptionsEnabled?: boolean;
    /** #162: rides through to composeAnswer; absent = the legacy ladder. */
    slotPhrasing?: boolean;
  },
): Promise<ComposedResponse> {
  const queryOptions = { answerFirstEnabled: options.answerFirstEnabled === true };
  const outcome: QueryOutcome = await runQuery(db, parse.intent, queryOptions);

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
    // #134(a) (ADR 029, refusal-side variant): a period-coverage refusal
    // (freshness / outside_loaded_slice / #134(b) too-old not_published) may
    // carry ONE servability-gated retry chip pointing at the boundary period we
    // CAN serve. Gated inside buildRefusalSuggestions (those kinds, period axis,
    // canonical + region-less), dry-run through the SAME primitive the answer
    // path uses.
    // FAIL-OPEN belt (mirrors the answer path): a chip hiccup must never turn
    // an honest refusal into an internal error.
    let suggestions: string[] = [];
    try {
      suggestions = await buildRefusalSuggestions(
        outcome,
        (candidate) => echoServability(db, candidate, queryOptions),
        // #138: the honest code→label source for a regional retry chip —
        // registry/dimension_labels via regionTermsFor (context/build.ts),
        // injected so suggestions.ts keeps its never-sees-db confinement.
        (canonicalKey, codes) => regionTermsFor(db, canonicalKey, codes),
      );
    } catch {
      suggestions = [];
    }
    return toRefusalResponse({ question, built: built.refusal, parse, queryRefusal: outcome, suggestions });
  }

  // WP26 mechanism B-period (ADR 024): the period axis is resolved by the
  // ANSWER layer (before the query runs), so the query layer cannot know the
  // window was defaulted — it is stamped onto the validated result here, the
  // one place that holds both halves. Present-only, like regionDefaulted, so a
  // turn that defaulted nothing keeps the pre-WP26 envelope bytes.
  const result: ValidatedResult =
    parse.periodDefaulted === true ? { ...outcome, periodDefaulted: true } : outcome;
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

  const answer = await composeAnswer(result, {
    client: options.answerClient,
    ...(options.semanticCheck ? { semanticCheck: options.semanticCheck } : {}),
    ...(options.templateOnly ? { templateOnly: true } : {}),
    // #162: absent unless the SLOT_PHRASING_ENABLED wire is on (flag-off
    // compose options stay byte-identical to today).
    ...(options.slotPhrasing === true ? { slotPhrasing: true } : {}),
  } satisfies ComposeOptions);
  const chart = buildChartSpec(result);
  const text = staleness.stale ? `${answer.text}\n\n${staleness.warning}` : answer.text;

  // WP29 (#73, ADR 029): follow-up chips, servability-gated through the same
  // dry-run primitive policy.ts uses (a closure over db, mirroring parse.ts's
  // construction). FAIL-OPEN belt on top of buildAnswerChips' own: a
  // suggestions hiccup may never cost the user the paid answer — the same
  // rule web/app/actions.ts applies to outcomeContext. Assembled
  // post-compose: `text` above is already final and stays byte-untouched.
  //
  // #197 step 3: with CLARIFY_CLICK_ENABLED on, the takeable chips among them
  // ride a chip-carrier pending (the WP26c rescue shape, `rescueOnly`) so the
  // reply turn takes a clicked one from its stored, dry-run-proven intent —
  // no LLM, a new validated result, a real audit row. First the comparison
  // chips only; since #73 v2 every chip whose intent passes the click-time
  // schema (a question-shaped chip that does not is still offered as a plain
  // label — see buildAnswerChips). PRESENT-ONLY: no takeable survivor (or
  // flag off) ⇒ no `pending` key, envelope bytes unchanged.
  let suggestions: string[] = [];
  let carrier: PendingClarification | null = null;
  try {
    const chips = await buildAnswerChips(
      parse.intent,
      result,
      (candidate) => echoServability(db, candidate, queryOptions),
      { clickOptions: options.clickOptionsEnabled === true },
    );
    suggestions = chips.suggestions;
    if (chips.clickOptions.length > 0) {
      carrier = {
        version: RESPONSE_SCHEMA_VERSION,
        question,
        referenceDate: options.referenceDate,
        axes: chips.axes,
        questionNl: CHIP_CARRIER_QUESTION_NL,
        options: chips.clickOptions.map((option) => option.label),
        clickOptions: chips.clickOptions,
        rescueOnly: true,
      };
    }
  } catch {
    suggestions = [];
    carrier = null;
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
    ...(carrier ? { pending: carrier } : {}),
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
    /** #144 (ADR 034): rides through to respondToIntent → composeAnswer. */
    semanticCheck?: ComposeOptions['semanticCheck'];
    /** WP26 (ADR 024): the two rollout flags — the rescue chip below is part of
     * mechanism A's machinery, so it rides A's flag. */
    clickOptionsEnabled?: boolean;
    answerFirstEnabled?: boolean;
    /** #162: rides through to respondToIntent → composeAnswer. */
    slotPhrasing?: boolean;
  },
): Promise<ComposedResponse> {
  if (parse.kind === 'refusal') {
    const built = await buildParseRefusal(db, parse);
    // WP26c (ADR 024 §6): the two MEASURED misfire classes — a past-tense
    // question read as a forecast, a bare data question read as a meta one —
    // may carry ONE deterministic rescue chip. The refusal text is untouched
    // and still honest; the chip is only offered when code can PROVE the asked
    // figure is loaded and servable. FAIL-OPEN: a hiccup here must never turn
    // an honest refusal into an internal error.
    let rescue: Awaited<ReturnType<typeof buildRescueOffer>> = null;
    if (options.clickOptionsEnabled === true) {
      try {
        rescue = await buildRescueOffer(parse, {
          servability: (intent) =>
            echoServability(db, intent, { answerFirstEnabled: options.answerFirstEnabled === true }),
          freshest: (key) => freshestForCanonical(db, key),
        });
      } catch {
        rescue = null;
      }
    }
    return toRefusalResponse({
      question,
      built,
      parse,
      queryRefusal: null,
      ...(rescue
        ? {
            suggestions: [rescue.label],
            pending: {
              version: RESPONSE_SCHEMA_VERSION,
              question,
              referenceDate: options.referenceDate,
              axes: ['measure'],
              questionNl: built.text,
              options: [rescue.label],
              clickOptions: [rescue.option],
              rescueOnly: true,
            },
          }
        : {}),
    });
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
      // WP26 mechanism A: the dry-run-verified takeable options policy.ts
      // built (absent when the flag is off → pending unchanged).
      ...(parse.clickOptions ? { clickOptions: parse.clickOptions } : {}),
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
    // WP129+130 (#129/#130): the source-selection belt runs FIRST — a
    // deselected-CBS turn refuses deterministically without any LLM call.
    const preParse = sourceSelectionRefusal(question, options.sourceSelection);
    if (preParse !== null) return preParse;
    // ThreadedInto: every ParseQuestionOptions key must be named here — a new
    // intent-side field can't be silently dropped on this path (#176/#191).
    const parseOptions: ThreadedInto<ParseQuestionOptions> = {
      client: options.intentClient,
      referenceDate: options.referenceDate,
      config: options.parserConfig,
      // No per-call override seam on RespondOptions (its doc comment): the
      // parse always runs the intent harness's own model.
      model: undefined,
      maxTokens: undefined,
      // WP16 sub-part 2 (ADR 026): threaded into BOTH the standalone and
      // follow-up parse (parseFollowUpQuestion accepts the same field) so an
      // unmatched topic on either turn can route to onboarding when a finder
      // is injected. Undefined when absent → B15 unchanged.
      tableFinder: options.tableFinder,
      // WP16 sub-part 2 delivery vocabulary (design §3.6): undefined/empty →
      // byte-identical Phase-0 prompt. The delivery re-run passes the
      // just-onboarded measure(s) so the parser can actually emit their
      // canonical key and the answer flows through the full validator chain
      // — without this the re-run would re-hit the unmatched exit and
      // dead-end in a refund, because the parser prompt is built from code
      // and a DB-only canonical row is otherwise invisible to it.
      extraCanonicalMeasures: options.extraCanonicalMeasures,
      // WP26 mechanism A: threaded into BOTH the standalone and the follow-up
      // parse — a clarification can arise on either turn.
      clickOptionsEnabled: options.clickOptionsEnabled,
      answerFirstEnabled: options.answerFirstEnabled,
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
    // WP129+130 (#129/#130): the same belt on the reply turn (the chips persist
    // across turns); the refusal carries the ORIGINAL question, like every
    // reply-turn refusal here.
    const preParse = sourceSelectionRefusal(pending.question, options.sourceSelection);
    if (preParse !== null) return preParse;

    // WP26 mechanism A (ADR 024, take-path A2): the deterministic rung, BEFORE
    // any LLM call. A reply that is byte-exactly one of the options we offered
    // needs no re-parse — we already resolved that reading and proved it
    // servable when we offered it. Taking it here is what makes a click
    // structurally unable to dead-end, and — when the fast path below is
    // actually taken (#178 can still route a stale recency click to the
    // normal merge instead) — it costs zero tokens.
    //
    // The data may have MOVED between offer and click (a sync in between), so
    // this is not a replay of a stored answer: respondToIntent re-runs the real
    // query. If it now refuses, the user gets the honest refusal and the normal
    // gate refunds — rare, and better than serving a stale promise.
    if (options.clickOptionsEnabled === true) {
      const clicked = matchClickOption(pending, reply);
      // #178: that re-run query proves the CELL still exists — it does not
      // prove a "nu" option's stored period is still what "nu" means today. A
      // clicked-but-now-outdated recency option falls through to the normal
      // merge below instead, exactly like a non-matching reply.
      if (clicked !== null && (await clickOptionStillCurrent(db, clicked))) {
        return await respondToIntent(db, pending.question, clickTakeOutcome(pending, clicked), {
          ...options,
          finalRound: true,
          templateOnly: true,
        });
      }
    }

    // WP26c: a rescue pending is NOT an open clarification round — it exists
    // only to carry the chip. Anything the user types instead is their NEXT
    // question and must be answered as one; merging it with the refused
    // question would be a silent, confusing regression (and would consume the
    // one clarification round nobody opened).
    if (isRescuePending(pending)) {
      return await respondToQuestion(db, reply, options);
    }
    // #73 v2 review: a STRIPPED carrier (every chip dropped at the trust
    // boundary — see isStrippedCarrier) is likewise not an open round: nothing
    // to take, so every reply is the user's next question.
    if (isStrippedCarrier(pending)) {
      return await respondToQuestion(db, reply, options);
    }

    // ThreadedInto: same compile-time threading guard as parseOptions above —
    // #191 WAS this exact bag missing a field that compiled cleanly.
    const clarifyOptions: ThreadedInto<ClarifyReplyOptions> = {
      client: options.intentClient,
      config: options.parserConfig,
      // No per-call override seam on RespondOptions (its doc comment).
      model: undefined,
      maxTokens: undefined,
      // Deliberately NOT threaded (see the FreshIntentParseOptions comment and
      // the 'onboarding' branch below): a reply-turn unmatched exit stays the
      // byte-identical B15 clarification — a reply-turn onboarding trigger is
      // a separate, unmade decision.
      tableFinder: undefined,
      // #191: the reply turn runs under the SAME rollout flag as the answer
      // turn. It was declared on ClarifyReplyOptions and threaded onward by
      // clarify.ts (lines 194, 210) but never SET here, and the result was not
      // "pre-WP26 on replies" — it was HALF of mechanism B, a state nobody
      // chose. B has two axes and they live in different layers: B-REGION is
      // in the query layer (query/resolve.ts) and already reached reply turns
      // through the `{ ...options }` spread into respondToIntent below, while
      // B-PERIOD is in the intent layer (intent/resolve.ts:731) and is fed by
      // exactly this bag. So with ANSWER_FIRST_ENABLED=1 a reply turn silently
      // defaulted the region the user never mentioned, and then refused over
      // the period it was allowed to default.
      //
      // R7's third branch (05-data-rules.md) authorizes filling in a
      // structurally-determined axis and draws NO first-turn/reply-turn
      // distinction — the safelist is code, not configuration — so applying it
      // to one axis and not the other was an invariant conformance gap, not a
      // deliberate conservatism. And a reply is the LAST round by rule (R7: a
      // reply never asks again), which makes it the turn where refusing costs
      // the most: the user answered the question we asked and would be refused
      // on an axis nobody asked about, after paying the clarification price —
      // the exact paid dead-end ADR 024 exists to remove.
      answerFirstEnabled: options.answerFirstEnabled === true,
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
