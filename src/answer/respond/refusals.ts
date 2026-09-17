// WP9 refusal & clarification builders: every non-answer outcome becomes a
// user-facing Dutch RefusalResponse or ClarificationResponse, per the
// taxonomy in respond/types.ts and docs/05-data-rules.md's failure-behaviour
// table. Deterministic templates only (ADR 015) — no LLM anywhere in this
// file. Structural guarantee (principle c): these builders take ParseOutcome
// and QueryRefusal, neither of which carries a cell value, so a fabricated
// number is structurally impossible here, not just avoided by convention.
import { CANONICAL_MEASURES } from '../../registry/defaults.ts';
import { resolveSource } from '../../sources/registry.ts';
import {
  freshestForCanonical,
  REGION_SERIES_MAX_REGIONS,
  type FreshnessInfo,
  type QueryRefusal,
  type StructuredIntent,
} from '../../query/index.ts';
import type { Db } from '../../db/types.ts';
import type { ClarifyAxis, ClickOption, ParseOutcome } from '../intent/types.ts';
import type { ConversationContext } from '../context/types.ts';
import { matchMetaTemplate } from './meta.ts';
import { periodCodeToNl } from './period-nl.ts';
import type {
  ClarificationResponse,
  OnboardingEnvelope,
  PendingClarification,
  RefusalReason,
  RefusalResponse,
} from './types.ts';
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
  /** WP16 sub-part 2 (ADR 026): set only by buildOnboardingRefusal for the
   * 'onboarding_pending' reason; every other builder leaves it undefined, and
   * toRefusalResponse defaults it to null (the envelope field is present-only
   * on that one reason). */
  onboarding?: OnboardingEnvelope | null;
  /** #134(c) (ADR 029): the forecast/causal refusal's own "I can look up X for
   * period Y" offer (see `offer` above), restated as a takeable-chip
   * CANDIDATE — set only by buildForecastRefusal/buildCausalRefusal, and only
   * when they found a definitionLabel AND a freshest period to name (no
   * candidate ⇒ no chip, same as no offer). This is a CANDIDATE, never a proof
   * of servability: respond.ts's parse-refusal call site dry-runs it through
   * the same #134 servability gate every other refusal-side chip shares
   * before it may ever reach the chip carrier. Every other builder leaves
   * this undefined; toRefusalResponse never reads it directly (the call site
   * does, ahead of the envelope assembly).
   *
   * Session 110 (row 13/row 15): the two query-refusal builders below
   * (`buildRegionScopeOnNationalMeasureRefusal`,
   * `buildMultiRegionMultiPeriodRefusal`) widen this to a full-intent
   * candidate instead of the canonical-key + one-period shape — see
   * `rescue.ts`'s `OfferChipIntentCandidate`. */
  offerChip?:
    | { canonicalKey: string; periodCode: string; label: string }
    | { intent: StructuredIntent; label: string }
    | null;
}

const definitionLabelByKey = new Map(CANONICAL_MEASURES.map((m) => [m.key, m.definitionLabel]));

/** Row 9 (session 110 UX audit pass 4): a small Dutch cardinal-number-word
 * table, so a refusal can NAME a compile-time cap (e.g.
 * `REGION_SERIES_MAX_REGIONS`) without ever putting a digit in refusal
 * prose — refusal text carries no digits at all (#37, pinned by test). The
 * range is deliberately narrow: every cap this module names today is small
 * and fixed at build time (never user input), so an unmapped value THROWS
 * rather than silently falling back to the digit or guessing a word — a
 * loud build-time failure the moment a cap constant changes beats a
 * refusal that quietly starts lying about the limit. */
const SMALL_CARDINAL_NL: Readonly<Record<number, string>> = {
  1: 'één',
  2: 'twee',
  3: 'drie',
  4: 'vier',
  5: 'vijf',
  6: 'zes',
  7: 'zeven',
  8: 'acht',
  9: 'negen',
  10: 'tien',
  11: 'elf',
  12: 'twaalf',
};

function cardinalNl(n: number): string {
  const word = SMALL_CARDINAL_NL[n];
  if (word === undefined) {
    throw new Error(`internal: cardinalNl has no Dutch word mapped for ${n} — extend SMALL_CARDINAL_NL`);
  }
  return word;
}

/** R11: state the source's status inline whenever a freshest-available
 * period is offered — the wording comes from the SOURCE REGISTRY (WP30a:
 * this was the third independent copy of the two-tier suffix; D3's whole
 * point is one authority), nothing for statuses outside the map
 * (Definitief). Exported: respond.ts's staleness recency-refusal offers a
 * period the same way and must mark it the same way (adversarial-review
 * finding, 2026-07-03: that offer omitted the marker). */
export function statusSuffixNl(status: string): string {
  return resolveSource(undefined).provisionalDisplay[status] ?? '';
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

/** "Wat was de <subject> in <period>?" (period omitted when none is known) —
 * the short natural-language question form shared by exampleQuestionNl below
 * (quoted, as an embedded suggestion inside refusal prose) and, since #134(c),
 * the forecast/causal refusal's own offer chip label (unquoted, a real
 * clickable chip — see buildForecastRefusal/buildCausalRefusal). */
function wasSubjectInPeriodNl(subject: string, periodCode: string | null): string {
  const periodPhrase = periodCode ? ` in ${periodCodeToNl(periodCode)}` : '';
  return `Wat was de ${subject}${periodPhrase}?`;
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
  const subject = preferred ? preferred.everydayTerms[0] : measure.definitionLabel;
  return `"${wasSubjectInPeriodNl(subject, freshest?.periodCode ?? null)}"`;
}

/** #134(c) (ADR 029): the offerChip candidate both buildForecastRefusal and
 * buildCausalRefusal mint from the SAME nearestKey/freshest pair their prose
 * offer already names — the measure's own everyday term as subject (falling
 * back to its definitionLabel, mirroring exampleQuestionNl's own fallback),
 * the freshest available period, no regions (default coordinates: exactly
 * what the prose offers, nothing more). Never touches the query layer —
 * respond.ts's call site dry-runs this candidate before it may become a chip. */
function forecastCausalOfferChip(
  nearestKey: string,
  definitionLabel: string,
  freshest: { periodCode: string },
): { canonicalKey: string; periodCode: string; label: string } {
  const measure = CANONICAL_MEASURES.find((m) => m.key === nearestKey);
  const subject = measure?.everydayTerms[0] ?? definitionLabel;
  return {
    canonicalKey: nearestKey,
    periodCode: freshest.periodCode,
    label: wasSubjectInPeriodNl(subject, freshest.periodCode),
  };
}

async function buildForecastRefusal(db: Db, raw: { nearestCanonicalKeys: string[] }): Promise<BuiltRefusal> {
  const nearestKey = raw.nearestCanonicalKeys[0];
  const definitionLabel = nearestKey ? definitionLabelByKey.get(nearestKey) : undefined;
  let offer: string | null = null;
  let offerChip: BuiltRefusal['offerChip'] = null;
  if (definitionLabel) {
    const freshest = await freshestForCanonical(db, nearestKey!);
    offer = freshest
      ? `Ik kan wel het gerealiseerde cijfer over ${definitionLabel} voor ${periodWithStatusNl(freshest)} voor je opzoeken.`
      : `Ik kan wel het meest recente gerealiseerde cijfer over ${definitionLabel} voor je opzoeken.`;
    if (freshest) offerChip = forecastCausalOfferChip(nearestKey!, definitionLabel, freshest);
  }
  const body = 'CBS publiceert gerealiseerde cijfers, geen voorspellingen — ik kan geen toekomstig cijfer geven.';
  return {
    reason: 'forecast',
    text: assertNotAQuestion(joinParts([body, offer])),
    offer,
    guidance: null,
    freshness: null,
    internalNote: null,
    offerChip,
  };
}

async function buildCausalRefusal(db: Db, raw: { nearestCanonicalKeys: string[] }): Promise<BuiltRefusal> {
  const nearestKey = raw.nearestCanonicalKeys[0];
  const definitionLabel = nearestKey ? definitionLabelByKey.get(nearestKey) : undefined;
  const body =
    'Ik kan geen oorzakelijk verband beoordelen — CBS-cijfers beschrijven wát er is gemeten, niet waardóór het komt.';
  let offer: string | null = null;
  let offerChip: BuiltRefusal['offerChip'] = null;
  if (definitionLabel) {
    const freshest = await freshestForCanonical(db, nearestKey!);
    offer = freshest
      ? `Ik kan wel de onderliggende cijfers over ${definitionLabel} laten zien, voor ${periodWithStatusNl(freshest)} of een andere periode.`
      : `Ik kan wel de onderliggende cijfers over ${definitionLabel} laten zien.`;
    if (freshest) offerChip = forecastCausalOfferChip(nearestKey!, definitionLabel, freshest);
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
    offerChip,
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

// ---------------------------------------------------------------------------
// Onboarding acknowledgments (WP16 sub-part 2, ADR 026) — the finder found a
// confident CBS table for an unloaded topic; we've triggered the on-demand
// fetch job. These ride the refusal envelope (like 'meta') but ANSWER: they
// acknowledge that the fetch is underway and invite the user to keep going.
// Nothing is refused and no data value exists yet, so principle (c) is not at
// stake — and the two strings deliberately carry NO digits, keeping the
// no-unbacked-numbers belt trivially satisfied.
// ---------------------------------------------------------------------------

/** Owner-approved VERBATIM Dutch copy (design 2026-07-06-wp16-sub2 §2). This
 * one deliberately ENDS IN '?' and so is NOT passed through assertNotAQuestion:
 * that guard exists because a data refusal must not create false pending
 * clarification state, and this acknowledgment creates none — it opens no
 * clarification round (no PendingClarification is ever built for it). It is a
 * conversational info message, not a refusal-with-guidance. Keep byte-exact:
 * the reconstruct round-trip and the answer tests pin it. */
export const ONBOARDING_PENDING_TEXT =
  'Dat onderwerp staat nog niet in onze database. We vragen de cijfers nu automatisch op bij het CBS en controleren ze — meestal een kwestie van minuten. Je krijgt een e-mail zodra je vraag beantwoord kan worden. Heb je ondertussen nog een andere vraag?';

/** Owner-approved VERBATIM Dutch copy (design §2): the SAME (user, table) is
 * already being fetched — no new debit, no second queue entry. Does not end in
 * '?', but skips assertNotAQuestion for symmetry with its sibling above. */
export const ONBOARDING_ALREADY_PENDING_TEXT =
  'Deze cijfers worden al voor je opgehaald bij het CBS. Je krijgt een e-mail zodra je vraag beantwoord kan worden.';

/** ADR 026 addendum (session 101, 2026-09-13) — #109's confirm-first
 * reversal, owner decision 4. Shown INSTEAD of `ONBOARDING_PENDING_TEXT` on
 * the first confident finder verdict; the fetch itself, and the text above,
 * now happen only after an explicit click (web/app/actions.ts's
 * confirmOnboardingFetch). Consumed by the web layer, not wired into
 * buildOnboardingRefusal below (that function still builds the SAME
 * envelope it always has — the answer module stays unaware of tokens,
 * billing, or which turn actually gets shown; see the ADR addendum for why).
 * No digit here BY THE SAME DESIGN as its sibling above — the price renders
 * separately via the existing `chat.costCredits` caption mechanism, never
 * baked into this pipeline-owned string. */
export const ONBOARDING_OFFER_TEXT =
  'Dat onderwerp staat nog niet in onze database. We kunnen de cijfers voor je ophalen bij het CBS en controleren — dat duurt meestal een paar minuten. Wil je dat we dit opzoeken?';

/** ADR 026 addendum: the fail-closed degrade when `ONBOARDING_OFFER_SECRET`
 * is not configured — same posture as `createEmbedCode`'s "unavailable"
 * (RUNBOOK: "fail closed, no error pages"). Nothing is charged and nothing
 * is queued; the reader is told plainly rather than shown a broken button. */
export const ONBOARDING_OFFER_UNAVAILABLE_TEXT =
  'Dat onderwerp staat nog niet in onze database, en het automatisch ophalen is op dit moment niet beschikbaar. Probeer het later nog eens, of stel een andere vraag.';

/** The onboarding acknowledgment builder (design §2). `already` picks between
 * the two verbatim copies; only the first-ask ('onboarding_pending') carries
 * the structured `onboarding` envelope the web action triggers on. */
export function buildOnboardingRefusal(
  onboarding: OnboardingEnvelope,
  already: boolean,
): BuiltRefusal {
  if (already) {
    return {
      reason: 'onboarding_already_pending',
      text: ONBOARDING_ALREADY_PENDING_TEXT,
      offer: null,
      guidance: null,
      freshness: null,
      internalNote: null,
      onboarding: null,
    };
  }
  return {
    reason: 'onboarding_pending',
    text: ONBOARDING_PENDING_TEXT,
    offer: null,
    guidance: null,
    freshness: null,
    internalNote: null,
    onboarding,
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
      // OQ-193 (measured 2026-08-07): CBS revised 1,103 figures already
      // marked Definitief, so that status does not mean immutable. Soften
      // the copy — owner-confirmed option (b) — so it reads as CBS's
      // current publication status, not "final". The freshestDefinitief
      // preference itself stays correct and unchanged.
      offer += ` (De laatste periode met CBS-status 'definitief' is ${periodCodeToNl(definitief!.periodCode)} — ook die cijfers kan CBS later nog bijstellen.)`;
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

/** #253 question 3: a region-CLASS ask ("per provincie", "welke gemeente …")
 * on a measure CBS publishes only nationally.
 *
 * Routed by the query refusal's structural `subReason`, never by matching its
 * English message, and deliberately NOT the generic internal wording: the
 * intent is invalid, but the underlying fact is an ordinary, honest scope
 * limit the user can act on — and an 'internal' refusal pages the owner
 * (src/answer/audit/alerts.ts). It also must not read like the intent layer's
 * max_needs_regions template ("noem twee gemeenten"), which asks for something
 * that does not exist on a table with no regional dimension at all.
 *
 * The offer is real: the same measure without a region axis IS servable, and
 * that is the national figure. What never happens is serving that number here,
 * relabelled "per provincie" (principle c). */
/** Row 15 (session 110, ADR 054 addendum + ADR 029 #134(c) note): the region-
 * scope refusal's own "Ik kan je wel het landelijke cijfer geven" offer,
 * turned into ONE takeable-chip CANDIDATE — the SAME intent with the region
 * axis dropped entirely (no `regions`, no `regionSet`) and the derivation
 * reset to `'none'` (a ranking derivation cannot survive losing every region
 * it would have ranked over; a plain national lookup is exactly what the
 * prose offers). Canonical target + exactly one period code only — mirrors
 * `definitionLabelForRefusal`'s own canonical-only gate; by construction this
 * refusal always carries a single period code (a multi-period ask with a
 * region axis hits the sibling `multi_region_multi_period` refusal first, in
 * resolve.ts, before this one is ever reached). No match ⇒ null ⇒ no chip,
 * never a guess. */
function regionScopeOnNationalMeasureOfferChip(
  refusal: QueryRefusal,
): { intent: StructuredIntent; label: string } | null {
  const intent = refusal.intent;
  const target = intent.target;
  if (target.kind !== 'canonical') return null;
  if (intent.period.kind !== 'codes' || intent.period.codes.length !== 1) return null;
  const periodCode = intent.period.codes[0]!;
  const definitionLabel = definitionLabelByKey.get(target.key);
  if (definitionLabel === undefined) return null;
  const measure = CANONICAL_MEASURES.find((m) => m.key === target.key);
  const subject = measure?.everydayTerms[0] ?? definitionLabel;
  return {
    intent: {
      schemaVersion: intent.schemaVersion,
      target,
      period: intent.period,
      derivation: 'none',
    },
    label: wasSubjectInPeriodNl(subject, periodCode),
  };
}

function buildRegionScopeOnNationalMeasureRefusal(refusal: QueryRefusal): BuiltRefusal {
  const definitionLabel = definitionLabelForRefusal(refusal);
  const body = definitionLabel
    ? `De cijfers over ${definitionLabel} publiceert het CBS alleen landelijk, voor heel Nederland: in deze tabel zit geen uitsplitsing naar gemeente, provincie of landsdeel.`
    : 'Deze cijfers publiceert het CBS alleen landelijk, voor heel Nederland: in deze tabel zit geen uitsplitsing naar gemeente, provincie of landsdeel.';
  const offer = 'Ik kan je wel het landelijke cijfer geven.';
  const guidance =
    "Voor een vergelijking tussen regio's is een onderwerp nodig dat het CBS wél per regio publiceert.";
  return {
    reason: 'region_scope_on_national_measure',
    text: assertNotAQuestion(joinParts([body, offer, guidance])),
    offer,
    guidance,
    freshness: null,
    internalNote: null,
    offerChip: regionScopeOnNationalMeasureOfferChip(refusal),
  };
}

/** Row 13 (session 110, ADR 054 addendum): "several regions AND several
 * periods in one question" (ADR 011's one-varying-axis rule). Distinguished
 * from the generic `invalid_intent` wording (which would page the owner,
 * src/answer/audit/alerts.ts) exactly like D6's
 * region_scope_on_national_measure — routed by the query refusal's
 * structural `subReason`, never by matching its English message.
 *
 * **Re-worded by ADR 055 (task 4), because the old wording became FALSE.**
 * It said "Ik kan meerdere regio's over meerdere periodes nog niet in één
 * antwoord combineren" — and a handful of NAMED regions over a range is
 * exactly what the `region_series` shape now answers. What is still refused
 * is everything OUTSIDE that shape, and the wording now says which: a whole
 * GROUP of regions (a region class — ADR 054's axis, a different chart), or
 * more named regions / more cells than one answer may carry
 * (REGION_SERIES_MAX_REGIONS, REGION_SERIES_MAX_CELLS). The disjunction is
 * honest for every case that reaches here: exactly one of the two holds, and
 * this template layer cannot tell which without the resolver's own detail
 * (which stays internal — a refusal carries no digits, #37).
 *
 * The offer is unchanged in kind: name a few regions over the period, or ask
 * the whole group for one period — and the chip below still takes the first
 * named region over the full range.
 *
 * Row 9 (session 110 UX audit pass 4): the old wording never stated the CAP
 * itself — a journalist asking for seven regions was never told six is the
 * limit. Named below via `cardinalNl(REGION_SERIES_MAX_REGIONS)`, a Dutch
 * WORD rather than the digit: refusal text carries no digits at all (#37,
 * pinned by test — `outcome.refusal.text).not.toMatch(/\d/)`), so the cap
 * must be spelled out, and spelled out FROM the constant so the two can
 * never silently drift apart (a bare `'zes'` literal beside the `6` would be
 * exactly that drift risk). */
function buildMultiRegionMultiPeriodRefusal(refusal: QueryRefusal): BuiltRefusal {
  const cap = cardinalNl(REGION_SERIES_MAX_REGIONS);
  const body =
    `Een ontwikkeling over meerdere periodes kan ik voor maximaal ${cap} met name genoemde regio's samen laten zien, ` +
    "maar deze vraag gaat over een hele groep regio's, of over meer regio's dan in één antwoord passen.";
  const offer = `Vraag tot ${cap} regio's met naam over die periode, of de hele groep voor één periode.`;
  return {
    reason: 'multi_region_multi_period',
    text: assertNotAQuestion(joinParts([body, offer])),
    offer,
    guidance: null,
    freshness: null,
    internalNote: null,
    offerChip: multiRegionMultiPeriodOfferChip(refusal),
  };
}

/** Row 15's chip candidate, above, but for row 13: the FIRST explicitly named
 * region (a region CLASS ask names no single region to fall back to, so that
 * shape gets no chip — `regions` empty ⇒ null), the full asked period RANGE
 * unchanged, derivation forced to `'series'` because the label PROMISES a
 * trend ("Hoe ontwikkelde … zich"), mirroring suggestions.ts's own `trend()`
 * chip generator (which does the same override for the same reason).
 *
 * Only a `period.kind === 'range'` ask is handled — an explicit multi-`codes`
 * ask is not sorted on the stored intent (resolve.ts sorts a LOCAL copy for
 * validation only), so picking a "from"/"to" pair from it without re-parsing
 * every code would risk a wrong-order label; that shape gets no chip rather
 * than a guess (**Assumption**, mirrored in docs/open-questions.md).
 *
 * **Assumption** (mirrored in docs/open-questions.md): the region is named by
 * its bare CBS code, not a registry label — this module is a pure,
 * DB-free template layer for the invalid_intent builders (unlike
 * suggestions.ts's `buildRefusalSuggestions`, which has an injected
 * registry-label lookup), and ADR 054 D6 already accepts a bare code as a
 * display name for this exact region-set feature area. A labelled follow-up
 * is a later enhancement, not required for this fix. */
/** Row 5 (session 110 UX audit pass 4, #269): the one sentence template for
 * this chip, parameterised over the region's DISPLAY text — shared by the
 * bare-code fallback below and by `relabelMultiRegionMultiPeriodOfferChip`
 * (respond.ts's DB-aware re-labelling step), so the two can never say the
 * sentence two different ways. */
function multiRegionMultiPeriodOfferLabel(
  definitionLabel: string,
  regionDisplay: string,
  period: { from: string; to: string },
): string {
  return (
    `Hoe ontwikkelde ${definitionLabel} in ${regionDisplay} zich van ` +
    `${periodCodeToNl(period.from)} tot en met ${periodCodeToNl(period.to)}?`
  );
}

function multiRegionMultiPeriodOfferChip(
  refusal: QueryRefusal,
): { intent: StructuredIntent; label: string } | null {
  const intent = refusal.intent;
  const target = intent.target;
  if (target.kind !== 'canonical') return null;
  if (intent.period.kind !== 'range') return null;
  const regions = intent.regions ?? [];
  if (regions.length === 0) return null;
  const firstRegion = regions[0]!;
  const definitionLabel = definitionLabelByKey.get(target.key);
  if (definitionLabel === undefined) return null;
  return {
    intent: {
      schemaVersion: intent.schemaVersion,
      target,
      regions: [firstRegion],
      period: intent.period,
      derivation: 'series',
    },
    // Bare-code fallback (#269, mirrored in open-questions.md): this module
    // is a pure, DB-free template layer (see the file header) and cannot
    // resolve a registry label itself. respond.ts — the DB-aware call site,
    // which already injects the same honest code→label source into
    // `buildRefusalSuggestions` (#138) — overwrites this label with
    // `relabelMultiRegionMultiPeriodOfferChip` whenever it can resolve one;
    // this bare-code sentence only ever reaches the user when that lookup
    // itself fails closed (unlabelable code / no geo dimension).
    label: multiRegionMultiPeriodOfferLabel(definitionLabel, firstRegion, intent.period),
  };
}

/** Row 5 (session 110 UX audit pass 4, #269): respond.ts's re-labelling step
 * for the chip above, called once it has resolved the region's registry
 * LABEL (via `regionTermsFor`, context/build.ts — the same honest
 * code→label source #138 already injects into `buildRefusalSuggestions`).
 * Goes through the SAME template as the fallback above
 * (`multiRegionMultiPeriodOfferLabel`), so relabelling can only ever change
 * which region name appears, never the sentence shape. Returns the
 * candidate UNCHANGED whenever the intent no longer has the shape this chip
 * requires — defensive only; respond.ts calls this with the exact candidate
 * `multiRegionMultiPeriodOfferChip` just returned, so the guards should
 * never trigger in practice (fail-closed: keep the bare-code label rather
 * than throw). */
export function relabelMultiRegionMultiPeriodOfferChip(
  candidate: { intent: StructuredIntent; label: string },
  regionLabel: string,
): { intent: StructuredIntent; label: string } {
  const { intent } = candidate;
  if (intent.target.kind !== 'canonical' || intent.period.kind !== 'range') return candidate;
  const definitionLabel = definitionLabelByKey.get(intent.target.key);
  if (definitionLabel === undefined) return candidate;
  return { intent, label: multiRegionMultiPeriodOfferLabel(definitionLabel, regionLabel, intent.period) };
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

/** #196 (session 73): the table was evicted (the on-demand TTL) between
 * resolving this query and finishing it. Its own reason — never 'internal' —
 * so the owner alert stays silent for a designed race and the user hears what
 * happened: the figures left OUR store after a long time without use; asking
 * again goes through the on-demand fetch (its own messaging and price). */
function buildEvictedRefusal(refusal: QueryRefusal): BuiltRefusal {
  const body =
    'Deze cijfers stonden in onze database, maar zijn zojuist opgeruimd omdat er lange tijd niet naar gevraagd was. Ze zijn niet weg bij het CBS: stel je vraag opnieuw, dan proberen we ze opnieuw op te halen.';
  return {
    reason: 'evicted',
    text: assertNotAQuestion(body),
    offer: null,
    guidance: null,
    freshness: null,
    internalNote: refusal.refusal.message,
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
    case 'table_evicted':
      return { kind: 'refusal', refusal: buildEvictedRefusal(refusal) };
    case 'invalid_intent':
      // #253: one structurally-marked invalid_intent is NOT an internal fault
      // — a region class on a national-only measure. Every other one (over the
      // cap, both axes given, a malformed period) keeps the generic wording.
      if (refusal.refusal.subReason === 'region_scope_on_national_measure') {
        return { kind: 'refusal', refusal: buildRegionScopeOnNationalMeasureRefusal(refusal) };
      }
      // Row 13 (session 110): the second honest sub-reason, same treatment —
      // several regions AND several periods is a structural scope limit, not
      // an internal fault.
      if (refusal.refusal.subReason === 'multi_region_multi_period') {
        return { kind: 'refusal', refusal: buildMultiRegionMultiPeriodRefusal(refusal) };
      }
      return { kind: 'refusal', refusal: buildInternalRefusal(refusal) };
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
// Source-selection pre-parse refusals (WP129+130, #129/#130, ADR 032) — the
// deterministic server belt behind the #129 source-tags chips. Neither takes a
// data value (principle c stays structural), both are digit-free, and neither
// ends in '?'. Emitted at the TOP of respondToQuestion / respondToClarification
// Reply, before any parse/LLM, so a deselected-sources turn costs no LLM call.
// ---------------------------------------------------------------------------

/** ALL sources deselected (client also disables send; this is the server
 * belt). Owner-decided copy (ADR 032 pricing table row "All sources
 * deselected"). In the ⟨W3⟩ skip-list ⇒ no web attempt ⇒ full refund ⇒ net 0. */
export function buildNoSourcesRefusal(): BuiltRefusal {
  const body = 'Geen bronnen geselecteerd — selecteer minstens één bron om een antwoord te krijgen.';
  return {
    reason: 'no_sources',
    text: assertNotAQuestion(body),
    offer: null,
    guidance: null,
    freshness: null,
    internalNote: null,
  };
}

/** CBS deselected but the "Internet" chip kept — the web-only mode (ADR 032
 * decision 3/Q4). The refusal names the honest consequence (no verified answer)
 * and points below to the unverified-web section attachWebAugmentation renders.
 * NOT in the skip-list: this reason is exactly where the web section belongs. */
export function buildWebOnlyRefusal(): BuiltRefusal {
  const body =
    'Je hebt CBS-data uitgeschakeld voor deze vraag, dus ik geef geen geverifieerd antwoord. Hieronder staan alleen onbevestigde resultaten van het web.';
  return {
    reason: 'web_only',
    text: assertNotAQuestion(body),
    offer: null,
    guidance: null,
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
  /** #134(a) (ADR 029, refusal-side variant): servability-gated retry chips —
   * set ONLY by respondToIntent's query-refusal site (freshness /
   * outside_loaded_slice / too-old not_published, #134(b)). Every other call
   * site omits it → [] (the answer pipeline's refusal chips exist only where a
   * boundary period is computed). */
  suggestions?: string[];
  /** WP26c (ADR 024): the rescue-chip state, set ONLY by respond.ts's misfire
   * site. Present-only on the envelope. */
  pending?: PendingClarification;
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
    // WP16 sub-part 2 (ADR 026): present-only on the 'onboarding_pending'
    // reason; null everywhere else (?? handles every non-onboarding builder,
    // which leaves the field undefined).
    onboarding: input.built.onboarding ?? null,
    // #134(a): additive structural field; [] on every refusal but the two
    // period-coverage kinds the caller gates on. Never touches `text` (R8).
    suggestions: input.suggestions ?? [],
    // WP26c: present-only, so every refusal without a rescue keeps the exact
    // pre-WP26 field set.
    ...(input.pending ? { pending: input.pending } : {}),
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
  /** WP26 mechanism A (ADR 024): the dry-run-verified takeable options, when
   * the producing layer built any. Absent/empty → pending and envelope keep
   * the exact pre-WP26 field set. */
  clickOptions?: ClickOption[];
}

export function toClarificationResponse(input: ClarificationEnvelopeInput): ClarificationResponse {
  // WP26 mechanism A: present-only, like conversationContext below — an empty
  // list must serialize NO key so a flag-off turn stays byte-identical.
  const clickOptions = input.clickOptions ?? [];
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
    ...(clickOptions.length > 0 ? { clickOptions } : {}),
  };
  return {
    schemaVersion: RESPONSE_SCHEMA_VERSION,
    question: input.question,
    text: input.questionNl,
    kind: 'clarification',
    axes: input.axes,
    options: input.options,
    // Labels only on the envelope — the intents ride `pending`, which is what
    // the server reads the taken reading from.
    ...(clickOptions.length > 0 ? { suggestions: clickOptions.map((o) => o.label) } : {}),
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
    onboarding: null,
    suggestions: [],
  };
}
