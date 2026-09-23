// WP26 mechanism A (ADR 024, take-path A2) — the trust boundary for the
// clickable clarification options.
//
// Why this file exists: the take-path A2 decision keeps the enriched pending
// CLIENT-HELD between the two turns (the same place `conversationContext` and
// the rest of the pending already live). That buys the #75 convention and the
// rescue of typed replies, at the price of one extra thing an attacker can
// shape — so the intents come back through a full schema check before any of
// them is taken, exactly the way context/validate.ts guards the follow-up
// referent.
//
// The blast radius even WITHOUT this file is bounded by construction: a forged
// intent can only become a normally-billed, fully-validated query over OTHER
// real CBS data (the same power as typing a different question), and the query
// layer remains the only source of values, so no number can be fabricated
// through here (principle a/c). This validator closes the rest: no free text
// reaches a prompt (click options never enter one), no unknown canonical key
// is accepted, no unbounded array is walked, and a malformed option is DROPPED
// rather than trusted.
//
// Fail-closed means "fall back to today": a rejected option list simply
// disappears, and the reply turn takes the normal LLM merge path — the exact
// pre-WP26 behavior, never an error the user has to see.
import { z } from 'zod';
import { CANONICAL_KEYS } from '../intent/schema.ts';
import { isEurostatCountryOrAggregateCode } from '../../sources/eurostat-geo-names.ts';
import { eurostatSiblingTargetKeys } from '../../sources/eurostat-siblings.ts';
import { INTENT_SCHEMA_VERSION } from '../../query/index.ts';
import { MAX_CLICK_OPTIONS } from '../intent/types.ts';
import type { ClickOption } from '../intent/types.ts';
import type { StructuredIntent } from '../../query/index.ts';
import type { PendingClarification } from './types.ts';

/** CBS period codes are structurally narrow (2024JJ00 / 2024KW02 / 2026MM07);
 * anything else could never resolve, so it never gets to try. */
const periodCode = z.string().regex(/^\d{4}(JJ00|KW0[1-4]|MM(0[1-9]|1[0-2]))$/);

/** Region codes are CBS dimension codes (NL01, PV26, GM0363, …) — an
 * allowlisted SHAPE here; the query layer still checks each one against the
 * table's real dimension labels and refuses an unknown code (resolve.ts). */
const regionCode = z.string().regex(/^[A-Za-z]{2}[0-9A-Za-z]{2,8}$/);

/** The offered intents are always canonical targets: policy.ts builds them
 * from resolved candidates, and resolveCandidate emits no other kind. An
 * 'explicit' target would therefore be a forgery — and the one shape that
 * could name a table/measure the parser would never choose — so it is refused
 * outright rather than validated. */
const clickIntentSchema = z.strictObject({
  schemaVersion: z.literal(INTENT_SCHEMA_VERSION),
  target: z.strictObject({
    kind: z.literal('canonical'),
    key: z.enum(CANONICAL_KEYS),
  }),
  regions: z.array(regionCode).min(1).max(8).optional(),
  period: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('codes'), codes: z.array(periodCode).min(1).max(64) }),
    z.strictObject({ kind: z.literal('range'), from: periodCode, to: periodCode }),
  ]),
  derivation: z.enum(['none', 'difference', 'max', 'series']),
});

/** The option envelope, for a given intent schema — shared by the CBS
 * vocabulary path and the Eurostat-sibling path below, so the two can only
 * ever differ in what an INTENT may carry. */
function optionSchemaFor(intent: z.ZodType) {
  return z.strictObject({
    id: z.string().min(1).max(32),
    label: z.string().min(1).max(500),
    intent,
    impliedRecency: z.boolean(),
    // #73 v2: present-only, literal `true` — a client-supplied `false` (a
    // shape the producer never writes) fails the option like any other
    // malformation. The bit only decides whether the label may replay as a
    // plain chip on a resumed thread; it never widens what a take can do.
    questionShaped: z.literal(true).optional(),
  });
}

const clickOptionSchema = optionSchemaFor(clickIntentSchema);

/** Eurostat E2a (ruling R7, final-review fix wave C1): the ONE other target a
 * chip may name — a Eurostat sibling measure's canonical key, which by design
 * is NOT in CANONICAL_KEYS (that list is the parser vocabulary; a sibling key
 * there would let the parser switch source with no click). Accepted only by
 * membership in the reviewed sibling map's values (default: the production
 * `EUROSTAT_SIBLINGS`, which ships EMPTY — so in production today this path
 * accepts nothing and the boundary is byte-identical to before), minus any
 * key that is also a CBS vocabulary key (those take the CBS path above,
 * unchanged, with CBS region-code validation).
 *
 * Region codes on this path are checked against Eurostat's own geo code set
 * (`isEurostatCountryOrAggregateCode`: DE, NL, EU27_2020, EA20, …) — the CBS
 * ≥4-character shape would reject every one of them. Membership, not a
 * widened regex: nothing outside the ~40 reviewed codes can pass. Regions are
 * REQUIRED here (a sibling chip always names the places that made CBS fail;
 * an Eurostat intent without regions has no national default to fall to). */
function siblingIntentSchema(siblingKeys: ReadonlySet<string>) {
  return z.strictObject({
    schemaVersion: z.literal(INTENT_SCHEMA_VERSION),
    target: z.strictObject({
      kind: z.literal('canonical'),
      key: z.string().refine((key) => siblingKeys.has(key)),
    }),
    regions: z.array(z.string().refine(isEurostatCountryOrAggregateCode)).min(1).max(8),
    period: clickIntentSchema.shape.period,
    derivation: clickIntentSchema.shape.derivation,
  });
}

/** Test seam, same shape as `resolveCandidate`'s `eurostatSiblings` option:
 * the sibling map whose VALUES are the accepted sibling target keys. Absent
 * ⇒ the production `EUROSTAT_SIBLINGS` (ships empty). */
export interface ClickValidationOptions {
  eurostatSiblings?: Readonly<Record<string, string>>;
}

function siblingKeysFor(options: ClickValidationOptions): ReadonlySet<string> {
  const cbsKeys = new Set<string>(CANONICAL_KEYS);
  return new Set([...eurostatSiblingTargetKeys(options.eurostatSiblings)].filter((key) => !cbsKeys.has(key)));
}

/** #197 step 3: whether an intent CAN come back through this boundary intact —
 * the producer-side twin of the schema below, for the chip generators
 * (suggestions.ts). An option the validator would DROP at click time is worse
 * than no option: the pending loses its clickOptions, stops being
 * carrier-shaped, and the label falls into the LLM merge — a paid parse of
 * "Vergelijk met Nederland" against the answered question. So a chip is
 * minted only for an intent this predicate accepts: a CANONICAL_KEYS target
 * (an on-demand-onboarded `onboarded:…` key is deliberately NOT in that list —
 * see the NOTE on validateClickOptions), ≤ 8 regions, well-formed period codes,
 * a known derivation. (Reviewer finding, the parallel session 70, 2026-09-02.)
 * Since #73 v2 the SAME predicate is the mint gate for the four question-shaped
 * WP29 generators — with one difference in what a rejection means: a
 * comparison that is not takeable is not offered at all (its label was never
 * written for a parse), while a question-shaped candidate that is not takeable
 * is still offered as the plain fill-the-input label it always was. */
export function isClickTakeableIntent(intent: StructuredIntent, options: ClickValidationOptions = {}): boolean {
  if (clickIntentSchema.safeParse(intent).success) return true;
  const siblingKeys = siblingKeysFor(options);
  return siblingKeys.size > 0 && siblingIntentSchema(siblingKeys).safeParse(intent).success;
}

/** Validates the client-returned click options of a pending clarification.
 * Returns only the well-formed ones, capped at the same bound the offer side
 * applies; `[]` when there are none or the payload is not an array.
 *
 * NOTE the deliberate ASYMMETRY with the onboarded-vocabulary path: an
 * on-demand-onboarded canonical key ('onboarded:…') is NOT in CANONICAL_KEYS,
 * so an option naming one is dropped here and the reply falls through to the
 * LLM merge that does know about it. Losing a chip is a cosmetic degradation;
 * widening the allowlist to client-supplied keys would not be. */
export function validateClickOptions(raw: unknown, options: ClickValidationOptions = {}): ClickOption[] {
  if (!Array.isArray(raw)) return [];
  const siblingKeys = siblingKeysFor(options);
  const siblingOptionSchema = siblingKeys.size > 0 ? optionSchemaFor(siblingIntentSchema(siblingKeys)) : null;
  const valid: ClickOption[] = [];
  for (const entry of raw.slice(0, MAX_CLICK_OPTIONS)) {
    // The CBS path first, byte-identical to before; the sibling path only
    // for what the CBS path rejects, and only when a sibling pair exists.
    const parsed = clickOptionSchema.safeParse(entry);
    if (parsed.success) {
      valid.push(parsed.data as ClickOption);
      continue;
    }
    const sibling = siblingOptionSchema?.safeParse(entry);
    if (sibling?.success) valid.push(sibling.data as ClickOption);
  }
  return valid;
}

/** The pending as the reply turn may use it: every prompt-bound field
 * untouched (guardLength/guardPending already bound those), the click options
 * replaced by their validated subset, and the key REMOVED when nothing
 * survives — so a stripped pending is byte-identical to a pre-WP26 one.
 *
 * Rebuilt from an ALLOWLIST of the known keys rather than spread from the
 * incoming object. The spread let anything the client invented ride through
 * untouched — and this value is not merely read, it is persisted verbatim into
 * `audit_answers.pending_clarification`. A single junk key sized to the Server
 * Action body limit therefore became a database row, on a turn that can cost
 * the user nothing. Unknown keys are now simply not carried.
 *
 * The optional keys stay PRESENT-ONLY: re-adding `clickOptions: []` or
 * `rescueOnly: false` would change the stored envelope for every flag-off turn,
 * which is exactly the byte-neutrality the dormant rollout rests on.
 *
 * ⚠ AN ALLOWLIST HAS TO BE KEPT COMPLETE, and the first version of this one was
 * not: it omitted `conversationContext` (WP15 / ADR 021), the referent that
 * gives an elliptical follow-up its meaning. Dropping it does not throw — it
 * quietly costs the reply merge its `previous_intent`, so a follow-up
 * clarification round dead-ends far more often. If a field is added to
 * `PendingClarification`, it must be added here too; the test in
 * tests/answer/wp26-trust-boundary.test.ts pins the full key set for exactly
 * that reason. */
export function withValidatedClickOptions(
  pending: PendingClarification,
  validation: ClickValidationOptions = {},
): PendingClarification {
  const clickOptions = validateClickOptions(pending.clickOptions, validation);
  // #73 v2 review (PR #122, 2026-09-03): on a chip CARRIER (`rescueOnly`) the
  // `options` ARE the chips' labels, index for index — the shape
  // isRescuePending grants the fresh-question routing on. Dropping one option
  // here without its label left `options` one longer than `clickOptions`, the
  // carrier stopped being carrier-shaped, and the reply turn MERGED the user's
  // next text with the answered question — the paid LLM parse a carrier exists
  // to avoid (orchestrator review finding). So a carrier's options are
  // re-aligned to the survivors, same order; with none left it becomes a
  // STRIPPED carrier — `rescueOnly`, empty options, no clickOptions — the shape
  // respondToClarificationReply routes as fresh questions (isStrippedCarrier).
  // A real clarification's `options` are ITS labels and a typed reply merges
  // against them by design, so those stay untouched.
  const carrier = pending.rescueOnly === true;
  const options = carrier ? clickOptions.map((option) => option.label) : pending.options;
  return {
    version: pending.version,
    question: pending.question,
    referenceDate: pending.referenceDate,
    axes: pending.axes,
    questionNl: pending.questionNl,
    options,
    ...(clickOptions.length > 0 ? { clickOptions } : {}),
    ...(carrier ? { rescueOnly: true as const } : {}),
    ...(pending.conversationContext !== undefined
      ? { conversationContext: pending.conversationContext }
      : {}),
  };
}
