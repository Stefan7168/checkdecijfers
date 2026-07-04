// WP9 refusal & clarification builders: every non-answer outcome becomes a
// user-facing Dutch RefusalResponse or ClarificationResponse, per the
// taxonomy in respond/types.ts and docs/05-data-rules.md's failure-behaviour
// table. Deterministic templates only (ADR 015) — no LLM anywhere in this
// file. Structural guarantee (principle c): these builders take ParseOutcome
// and QueryRefusal, neither of which carries a cell value, so a fabricated
// number is structurally impossible here, not just avoided by convention.
import { CANONICAL_MEASURES } from '../../registry/defaults.ts';
import { freshestForCanonical, type FreshnessInfo, type QueryRefusal } from '../../query/index.ts';
import type { Db } from '../../db/types.ts';
import type { ClarifyAxis, ParseOutcome } from '../intent/types.ts';
import type { ConversationContext } from '../context/types.ts';
import { matchMetaTemplate } from './meta.ts';
import { periodCodeToNl } from './period-nl.ts';
import type { ClarificationResponse, PendingClarification, RefusalReason, RefusalResponse } from './types.ts';
import { RESPONSE_SCHEMA_VERSION } from './types.ts';

/** What refusals/clarifications need beyond the reason/text — the structured
 * fields ComposedResponse carries per respond/types.ts's comments. */
export interface BuiltRefusal {
  reason: RefusalReason;
  text: string;
  offer: string | null;
  guidance: string | null;
  freshness: FreshnessInfo | null;
  internalNote: string | null;
}

const definitionLabelByKey = new Map(CANONICAL_MEASURES.map((m) => [m.key, m.definitionLabel]));

/** R11: state the CBS status inline whenever a freshest-available period is
 * offered — 'voorlopig cijfer' / 'nader voorlopig cijfer' / nothing for
 * Definitief. Exported: respond.ts's staleness recency-refusal offers a
 * period the same way and must mark it the same way (adversarial-review
 * finding, 2026-07-03: that offer omitted the marker). */
export function statusSuffixNl(status: string): string {
  if (status === 'Voorlopig') return ' (voorlopig cijfer)';
  if (status === 'NaderVoorlopig') return ' (nader voorlopig cijfer)';
  return '';
}

function periodWithStatusNl(period: { periodCode: string; status: string }): string {
  return `${periodCodeToNl(period.periodCode)}${statusSuffixNl(period.status)}`;
}

/** Refusal text never ends in '?' (docs/05: refusals never create pending
 * state; an embedded quoted example question is fine — that '?' belongs to
 * the quote, not the refusal itself). Defensive normalization in case a
 * composed body ends up with trailing punctuation from a template branch. */
function assertNotAQuestion(text: string): string {
  const trimmed = text.trimEnd();
  if (trimmed.endsWith('?')) {
    throw new Error(`internal: refusal text must not end in '?': ${JSON.stringify(trimmed)}`);
  }
  return text;
}

function joinParts(parts: (string | null)[]): string {
  return parts.filter((p): p is string => p !== null && p.length > 0).join(' ');
}

// ---------------------------------------------------------------------------
// Parse refusals (ParseOutcome kind 'refusal')
// ---------------------------------------------------------------------------

/** First everyday term of every loaded canonical measure — the compact scope
 * list for out_of_scope refusals (B17) and the smalltalk explanation. */
function loadedTopicsCompact(): string {
  return CANONICAL_MEASURES.map((m) => m.everydayTerms[0]).join(', ');
}

/** A genuinely answerable, grammatical example question over a loaded topic —
 * the out_of_scope/smalltalk offer and the still-ambiguous guidance example.
 * Prefers the inflation measure because "Wat was de inflatie in {periode}?"
 * reads naturally with its everyday term; the generic definitionLabel frame is
 * the fallback if the registry ever drops that key. The period is the
 * measure's own freshest available period, so the example is answerable and
 * every digit in it is whitelistable (periodCodeNumbers of a genuinely loaded
 * code). */
async function exampleQuestionNl(db: Db): Promise<string> {
  const preferred = CANONICAL_MEASURES.find((m) => m.key === 'cpi_yearly_inflation');
  const measure = preferred ?? CANONICAL_MEASURES[0]!;
  const freshest = await freshestForCanonical(db, measure.key);
  const periodPhrase = freshest ? ` in ${periodCodeToNl(freshest.periodCode)}` : '';
  const subject = preferred ? preferred.everydayTerms[0] : measure.definitionLabel;
  return `"Wat was de ${subject}${periodPhrase}?"`;
}

async function buildForecastRefusal(db: Db, raw: { nearestCanonicalKeys: string[] }): Promise<BuiltRefusal> {
  const nearestKey = raw.nearestCanonicalKeys[0];
  const definitionLabel = nearestKey ? definitionLabelByKey.get(nearestKey) : undefined;
  let offer: string | null = null;
  if (definitionLabel) {
    const freshest = await freshestForCanonical(db, nearestKey!);
    offer = freshest
      ? `Ik kan wel het gerealiseerde cijfer over ${definitionLabel} voor ${periodWithStatusNl(freshest)} voor je opzoeken.`
      : `Ik kan wel het meest recente gerealiseerde cijfer over ${definitionLabel} voor je opzoeken.`;
  }
  const body = 'CBS publiceert gerealiseerde cijfers, geen voorspellingen — ik kan geen toekomstig cijfer geven.';
  return {
    reason: 'forecast',
    text: assertNotAQuestion(joinParts([body, offer])),
    offer,
    guidance: null,
    freshness: null,
    internalNote: null,
  };
}

async function buildCausalRefusal(db: Db, raw: { nearestCanonicalKeys: string[] }): Promise<BuiltRefusal> {
  const nearestKey = raw.nearestCanonicalKeys[0];
  const definitionLabel = nearestKey ? definitionLabelByKey.get(nearestKey) : undefined;
  const body =
    'Ik kan geen oorzakelijk verband beoordelen — CBS-cijfers beschrijven wát er is gemeten, niet waardóór het komt.';
  let offer: string | null = null;
  if (definitionLabel) {
    const freshest = await freshestForCanonical(db, nearestKey!);
    offer = freshest
      ? `Ik kan wel de onderliggende cijfers over ${definitionLabel} laten zien, voor ${periodWithStatusNl(freshest)} of een andere periode.`
      : `Ik kan wel de onderliggende cijfers over ${definitionLabel} laten zien.`;
  } else {
    offer = `Ik heb hierover geen cijfers geladen — mijn bronnen dekken momenteel: ${loadedTopicsCompact()}.`;
  }
  return {
    reason: 'causal',
    text: assertNotAQuestion(joinParts([body, offer])),
    offer,
    guidance: null,
    freshness: null,
    internalNote: null,
  };
}

async function buildOutOfScopeRefusal(db: Db): Promise<BuiltRefusal> {
  const body =
    `Daarover heb ik geen CBS-cijfers geladen — mijn bronnen dekken momenteel officiële CBS-cijfers over: ${loadedTopicsCompact()}.`;
  const offer = `Vraag bijvoorbeeld: ${await exampleQuestionNl(db)}`;
  return {
    reason: 'scope',
    text: assertNotAQuestion(joinParts([body, offer])),
    offer,
    guidance: null,
    freshness: null,
    internalNote: null,
  };
}

/** Honest split (docs/02): one question at a time, explicitly not a
 * clarification (no pending) — we cannot yet name "ask X" without multi-ask
 * decomposition (Phase 1-2 roadmap item), so this phrases the split without
 * pretending to identify the sub-questions. */
function buildCompoundRefusal(): BuiltRefusal {
  const body = 'Dat zijn twee (of meer) vragen tegelijk — ik beantwoord er één per keer.';
  const guidance = 'Stel de vragen na elkaar, dan pak ik ze één voor één op.';
  return {
    reason: 'compound',
    text: assertNotAQuestion(joinParts([body, guidance])),
    offer: null,
    guidance,
    freshness: null,
    internalNote: null,
  };
}

/** WP18 (F3): the smalltalk bucket is where the LLM classifies BOTH greetings
 * and genuinely meta questions about the product ("welke bronnen gebruik
 * je?"). A deterministic post-classification router (meta.ts, ADR 022) gives
 * the meta questions a truthful product-behaviour answer — reason 'meta' —
 * while everything unmatched keeps the generic template below. Both paths
 * share the example-question offer, so every digit in either text stays
 * whitelistable from the same structured sources (labels + freshest period). */
async function buildSmalltalkRefusal(db: Db, question: string): Promise<BuiltRefusal> {
  const offer = `Vraag bijvoorbeeld: ${await exampleQuestionNl(db)}`;
  const template = matchMetaTemplate(question);
  if (template) {
    const body = template.buildBody({ topicsCompact: loadedTopicsCompact() });
    return {
      reason: 'meta',
      text: assertNotAQuestion(joinParts([body, offer])),
      offer,
      guidance: null,
      freshness: null,
      internalNote: null,
    };
  }
  const body =
    'Ik beantwoord vragen over officiële CBS-cijfers en geef elk antwoord met bron en peildatum.';
  return {
    reason: 'smalltalk',
    text: assertNotAQuestion(joinParts([body, offer])),
    offer,
    guidance: null,
    freshness: null,
    internalNote: null,
  };
}

/** Every parse-side refusal kind, per ParseOutcome's refusalKind union — the
 * `never` fallback below makes a new union member a compile error, matching
 * the brief's exhaustiveness requirement.
 *
 * `metaMatchText` (WP18): the text the meta router matches against. Defaults
 * to outcome.question — correct for fresh and follow-up questions. On a
 * clarify REPLY the outcome's question field deliberately echoes the ORIGINAL
 * question (clarify.ts), while the smalltalk classification belongs to the
 * reply — the reply call site passes the reply text explicitly. */
export async function buildParseRefusal(
  db: Db,
  outcome: Extract<ParseOutcome, { kind: 'refusal' }>,
  metaMatchText?: string,
): Promise<BuiltRefusal> {
  switch (outcome.refusalKind) {
    case 'forecast':
      return buildForecastRefusal(db, outcome.raw);
    case 'causal':
      return buildCausalRefusal(db, outcome.raw);
    case 'out_of_scope':
      return buildOutOfScopeRefusal(db);
    case 'compound':
      return buildCompoundRefusal();
    case 'smalltalk':
      return buildSmalltalkRefusal(db, metaMatchText ?? outcome.question);
    default: {
      const _exhaustive: never = outcome.refusalKind;
      throw new Error(`internal: unhandled parse refusalKind ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Query refusals (QueryRefusal)
// ---------------------------------------------------------------------------

function definitionLabelForRefusal(refusal: QueryRefusal): string | null {
  return refusal.intent.target.kind === 'canonical'
    ? (definitionLabelByKey.get(refusal.intent.target.key) ?? null)
    : null;
}

function buildFreshnessRefusal(refusal: QueryRefusal): BuiltRefusal {
  const freshness = refusal.refusal.freshness ?? null;
  const definitionLabel = definitionLabelForRefusal(refusal);

  const available = freshness?.freshestAvailable ?? null;
  const definitief = freshness?.freshestDefinitief ?? null;
  const differs = available !== null && definitief !== null && available.periodCode !== definitief.periodCode;

  let body: string;
  let offer: string | null;
  if (available) {
    body = definitionLabel
      ? `Zo recent heb ik de cijfers over ${definitionLabel} nog niet — de meest recente periode waarvoor ik een cijfer heb is ${periodWithStatusNl(available)}.`
      : `Zo recente cijfers heb ik nog niet — de meest recente periode waarvoor ik een cijfer heb is ${periodWithStatusNl(available)}.`;
    // A statement, never a bare question (refusals never end in '?'): the
    // offer states what we CAN serve; the user asking again for that period
    // is how they take us up on it.
    offer = `Ik kan het cijfer voor ${periodWithStatusNl(available)} direct geven, vraag daar gerust naar.`;
    if (differs) {
      offer += ` (Het laatste definitieve cijfer is er voor ${periodCodeToNl(definitief!.periodCode)}.)`;
    }
  } else {
    body = definitionLabel
      ? `Ik heb nog geen cijfers over ${definitionLabel}.`
      : 'Daar heb ik nog geen cijfers over.';
    offer = null;
  }
  return {
    reason: 'freshness',
    text: assertNotAQuestion(joinParts([body, offer])),
    offer,
    guidance: null,
    freshness,
    internalNote: null,
  };
}

/** not_published (CBS never published it) vs outside_loaded_slice (CBS DOES
 * publish it, our ingested slice doesn't reach it) — deliberately different
 * wording per docs/05. */
function buildNotPublishedRefusal(refusal: QueryRefusal): BuiltRefusal {
  const definitionLabel = definitionLabelForRefusal(refusal);
  const body = definitionLabel
    ? `CBS heeft voor ${definitionLabel} (nog) geen cijfer over deze periode gepubliceerd.`
    : 'CBS heeft (nog) geen cijfer over deze periode gepubliceerd.';
  return {
    reason: 'not_published',
    text: assertNotAQuestion(body),
    offer: null,
    guidance: null,
    freshness: refusal.refusal.freshness ?? null,
    internalNote: null,
  };
}

function buildOutsideSliceRefusal(refusal: QueryRefusal): BuiltRefusal {
  const definitionLabel = definitionLabelForRefusal(refusal);
  const nearest = refusal.refusal.nearestAlternative;
  const body = definitionLabel
    ? `CBS publiceert de cijfers over ${definitionLabel} wel, maar het gevraagde deel ligt buiten wat wij hebben ingeladen.`
    : 'CBS publiceert deze cijfers wel, maar het gevraagde deel ligt buiten wat wij hebben ingeladen.';
  const offer = nearest
    ? `Ik kan wel cijfers laten zien vanaf ${periodCodeToNl(nearest)}.`
    : null;
  return {
    reason: 'outside_loaded_slice',
    text: assertNotAQuestion(joinParts([body, offer])),
    offer,
    guidance: null,
    freshness: null,
    internalNote: null,
  };
}

function buildQuarantinedRefusal(): BuiltRefusal {
  const body =
    'Deze tabel is tijdelijk niet beschikbaar omdat we de gegevens opnieuw aan het controleren zijn (kwaliteitscheck na een mogelijke wijziging bij CBS).';
  return {
    reason: 'quarantined',
    text: assertNotAQuestion(body),
    offer: null,
    guidance: null,
    freshness: null,
    internalNote: null,
  };
}

const AXIS_NL: Record<ClarifyAxis, string> = {
  measure: 'welk onderwerp/definitie je bedoelt',
  region: 'voor welke regio',
  period: 'voor welke periode',
  derivation: 'welke berekening je wilt',
};

function axesNl(axes: ClarifyAxis[]): string {
  const phrases = axes.map((a) => AXIS_NL[a]);
  // Merge consecutive "voor welke X"-phrases so two axes read "voor welke
  // regio en periode", not "voor welke regio en voor welke periode"
  // (adversarial-review copy finding, 2026-07-03).
  const merged: string[] = [];
  for (const phrase of phrases) {
    const last = merged[merged.length - 1];
    if (last?.startsWith('voor welke ') && phrase.startsWith('voor welke ')) {
      merged[merged.length - 1] = `${last} en ${phrase.slice('voor welke '.length)}`;
    } else {
      merged.push(phrase);
    }
  }
  return merged.join(' en ');
}

/** needs_clarification becomes a ClarificationResponse on the FIRST turn (the
 * query layer is deliberately the single source of the missing-region check —
 * src/answer/intent/resolve.ts's pass-through policy — so e.g. a question
 * naming no place on a regional measure legitimately clarifies here). On the
 * region axis the options are concrete and resolvable (docs/05: options that
 * actually resolve in the loaded data — "heel Nederland" resolves; the
 * gemeente/provincie preset mirrors docs/02 S3's own combined-preset example);
 * other axes keep free-form options empty. On a reply turn respond.ts never
 * reaches this builder (final-round rule, adversarial-review finding
 * 2026-07-03). */
function buildNeedsClarificationAsClarification(refusal: QueryRefusal): {
  axes: ClarifyAxis[];
  questionNl: string;
  options: string[];
} {
  const rawAxes = (refusal.refusal.axes ?? (refusal.refusal.axis ? [refusal.refusal.axis] : [])) as ClarifyAxis[];
  const axes = rawAxes.length > 0 ? rawAxes : (['measure'] as ClarifyAxis[]);
  const questionNl = `Kun je aangeven ${axesNl(axes)}?`;
  const options = axes.includes('region')
    ? ['heel Nederland (landelijk cijfer)', 'een specifieke gemeente of provincie — noem de naam']
    : [];
  return { axes, questionNl, options };
}

function buildInternalRefusal(refusal: QueryRefusal): BuiltRefusal {
  const kindWording: Record<
    'invalid_intent' | 'table_not_registered' | 'no_data' | 'derivation_failed' | 'internal_inconsistency',
    string
  > = {
    invalid_intent: 'Ik kon deze vraag niet omzetten in een geldige zoekopdracht op onze data.',
    table_not_registered: 'Deze data is niet bij ons geregistreerd.',
    no_data: 'Ik kon voor deze combinatie geen cijfer vinden in onze data, terwijl dat wel verwacht werd — dit vraagt een controle aan onze kant.',
    derivation_failed: 'Ik kon de gevraagde berekening niet betrouwbaar uitvoeren op deze cijfers.',
    internal_inconsistency: 'Ik zag een inconsistentie in onze data die eerst gecontroleerd moet worden.',
  };
  const kind = refusal.refusal.kind as keyof typeof kindWording;
  const body = `${kindWording[kind]} Ik geef liever geen antwoord dan een onbetrouwbaar antwoord.`;
  return {
    reason: 'internal',
    text: assertNotAQuestion(body),
    offer: null,
    guidance: null,
    freshness: null,
    internalNote: refusal.refusal.message,
  };
}

export type QueryRefusalOutcome =
  | { kind: 'refusal'; refusal: BuiltRefusal }
  | { kind: 'clarification'; axes: ClarifyAxis[]; questionNl: string; options: string[] };

/** Every QueryRefusal kind, per docs/05 wording rules — exhaustive switch. */
export function buildQueryRefusal(refusal: QueryRefusal): QueryRefusalOutcome {
  switch (refusal.refusal.kind) {
    case 'freshness':
      return { kind: 'refusal', refusal: buildFreshnessRefusal(refusal) };
    case 'not_published':
      return { kind: 'refusal', refusal: buildNotPublishedRefusal(refusal) };
    case 'outside_loaded_slice':
      return { kind: 'refusal', refusal: buildOutsideSliceRefusal(refusal) };
    case 'table_quarantined':
      return { kind: 'refusal', refusal: buildQuarantinedRefusal() };
    case 'needs_clarification':
      return { kind: 'clarification', ...buildNeedsClarificationAsClarification(refusal) };
    case 'invalid_intent':
    case 'table_not_registered':
    case 'no_data':
    case 'derivation_failed':
    case 'internal_inconsistency':
      return { kind: 'refusal', refusal: buildInternalRefusal(refusal) };
    default: {
      const _exhaustive: never = refusal.refusal.kind;
      throw new Error(`internal: unhandled QueryRefusal kind ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Still-ambiguous-after-round (final round: refusal-with-guidance, never a
// second question — docs/05 failure table, R7)
// ---------------------------------------------------------------------------

/** Deterministic example question built from a loaded measure's definition
 * label/everyday term. When it needs a period, uses the freshest available
 * period of that measure so every digit in the example is whitelistable
 * (periodCodeNumbers of a period code that is genuinely ours). */
export async function buildStillAmbiguousRefusal(
  db: Db,
  axes: ClarifyAxis[],
): Promise<BuiltRefusal> {
  const body = `Ook met je toelichting is me nog niet duidelijk ${axesNl(axes.length > 0 ? axes : ['measure'])}.`;
  const guidance = `Stel je vraag het beste opnieuw in één zin, met onderwerp, regio en periode — bijvoorbeeld ${await exampleQuestionNl(db)}`;
  return {
    reason: 'still_ambiguous',
    text: assertNotAQuestion(joinParts([body, guidance])),
    offer: null,
    guidance,
    freshness: null,
    internalNote: null,
  };
}

// ---------------------------------------------------------------------------
// Envelope assembly helpers (respond.ts calls these to build the final
// ComposedResponse variants; kept here so refusal wording and envelope
// shape stay next to each other)
// ---------------------------------------------------------------------------

export interface RefusalEnvelopeInput {
  question: string;
  built: BuiltRefusal;
  parse: ParseOutcome | null;
  queryRefusal: QueryRefusal | null;
}

export function toRefusalResponse(input: RefusalEnvelopeInput): RefusalResponse {
  return {
    schemaVersion: RESPONSE_SCHEMA_VERSION,
    question: input.question,
    text: input.built.text,
    kind: 'refusal',
    reason: input.built.reason,
    offer: input.built.offer,
    guidance: input.built.guidance,
    freshness: input.built.freshness,
    parse: input.parse,
    queryRefusal: input.queryRefusal,
    internalNote: input.built.internalNote,
  };
}

export interface ClarificationEnvelopeInput {
  question: string;
  referenceDate: string;
  axes: ClarifyAxis[];
  questionNl: string;
  options: string[];
  parse: ParseOutcome;
  /** WP15 (ADR 021): set when the clarified question was a FOLLOW-UP — the
   * referent must survive into the pending state or the reply merge loses it
   * (adversarial-review finding, 2026-07-04). */
  conversationContext?: ConversationContext | null;
}

export function toClarificationResponse(input: ClarificationEnvelopeInput): ClarificationResponse {
  const pending: PendingClarification = {
    version: RESPONSE_SCHEMA_VERSION,
    question: input.question,
    referenceDate: input.referenceDate,
    axes: input.axes,
    questionNl: input.questionNl,
    options: input.options,
    // Only materialized when present: a contextless pending keeps the exact
    // pre-WP15 field set (serialized state stays byte-stable for the
    // committed clarify fixtures and stored audit rows).
    ...(input.conversationContext ? { conversationContext: input.conversationContext } : {}),
  };
  return {
    schemaVersion: RESPONSE_SCHEMA_VERSION,
    question: input.question,
    text: input.questionNl,
    kind: 'clarification',
    axes: input.axes,
    options: input.options,
    pending,
    parse: input.parse,
  };
}

export function toInternalRefusal(question: string, internalNote: string): RefusalResponse {
  const text = 'Ik kan deze vraag nu niet betrouwbaar beantwoorden. Ik geef liever geen antwoord dan een onbetrouwbaar antwoord.';
  return {
    schemaVersion: RESPONSE_SCHEMA_VERSION,
    question,
    text: assertNotAQuestion(text),
    kind: 'refusal',
    reason: 'internal',
    offer: null,
    guidance: null,
    freshness: null,
    parse: null,
    queryRefusal: null,
    internalNote,
  };
}
