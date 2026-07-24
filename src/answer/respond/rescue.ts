// WP26c (ADR 024, execute-brief §6) — the rescue chip on a MISFIRED refusal.
//
// The problem it fixes is measured, not hypothetical. Both casual phrasings on
// the s52 anonymous-trial smoke drew honest-but-WRONG refusals:
//   "Wat was de inflatie in juni 2026?"   → forecast_request  (a PAST-tense
//        question about a month CBS had already published — the forecast guard
//        is purely parse-side and knows neither today's date nor what we hold)
//   "Wat is het consumentenvertrouwen?"   → meta template     (a bare data
//        question read as a question about the product)
// A trial visitor gets two free questions; today both can land on a refusal.
//
// What this does NOT do, deliberately:
//  - it does not change the classification (you cannot pin an unstable parse —
//    the s54 bistability lesson) and it does not change the refusal TEXT. The
//    refusal stays exactly as honest as it was;
//  - it adds no prompt bytes and makes no LLM call. Every step here is a regex,
//    a registry lookup, or the real query layer.
//
// It adds ONE escape hatch: when deterministic code can prove that the very
// thing the user asked for IS loaded and servable, the refusal carries a single
// chip that resolves it — through mechanism A's take-path, so taking it never
// re-enters the parse that misfired in the first place.
import { CANONICAL_MEASURES } from '../../registry/defaults.ts';
import { INTENT_SCHEMA_VERSION } from '../../query/index.ts';
import type { EchoServability, StructuredIntent } from '../../query/index.ts';
import type { ClickOption, ParseOutcome } from '../intent/types.ts';
import { periodCodeToNl } from './period-nl.ts';

const definitionLabelByKey = new Map(CANONICAL_MEASURES.map((m) => [m.key, m.definitionLabel]));

const MONTHS_NL: Record<string, number> = {
  januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6,
  juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12,
};

const pad2 = (n: number): string => String(n).padStart(2, '0');
const isSaneYear = (year: number): boolean => year >= 1900 && year <= 2100;

/** The ONE absolute period a question names, as a CBS code — or null when it
 * names none, or more than one distinct period (ambiguous: rescuing the wrong
 * one would be a guess, and this whole file exists to avoid guessing).
 *
 * Deliberately narrow: month+year and bare year only. Quarters and ranges are
 * NOT handled — they would each need their own honest mapping, and a missing
 * rescue is a cosmetic loss while a wrong one is a product bug. Whether the
 * period is actually PUBLISHED is not judged here at all: the dry-run below is
 * the single source of that truth. */
export function absolutePeriodInText(text: string): string | null {
  const found = new Set<string>();
  const lower = text.toLowerCase();
  for (const [name, month] of Object.entries(MONTHS_NL)) {
    // The year may precede or follow the month name in Dutch usage.
    const pattern = new RegExp(`(?:(\\d{4})\\s+)?${name}(?:\\s+(\\d{4}))?`, 'g');
    for (const match of lower.matchAll(pattern)) {
      const year = Number(match[1] ?? match[2]);
      if (!Number.isFinite(year) || !isSaneYear(year)) continue;
      found.add(`${year}MM${pad2(month)}`);
    }
  }
  if (found.size === 0) {
    for (const match of lower.matchAll(/\b(\d{4})\b/g)) {
      const year = Number(match[1]);
      if (isSaneYear(year)) found.add(`${year}JJ00`);
    }
  }
  return found.size === 1 ? [...found][0]! : null;
}

export interface RescueOffer {
  /** The chip label — also the byte-exact string the take-path matches. */
  label: string;
  option: ClickOption;
}

export interface RescueDeps {
  servability: (intent: StructuredIntent) => Promise<EchoServability>;
  /** Freshest published period at the canonical coordinate — the target of a
   * meta/smalltalk rescue ("show me the latest figure for X"). */
  freshest: (canonicalKey: string) => Promise<{ periodCode: string } | null>;
}

function intentFor(key: string, periodCode: string): StructuredIntent {
  return {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: { kind: 'canonical', key },
    period: { kind: 'codes', codes: [periodCode] },
    derivation: 'none',
  };
}

/** Builds the single rescue offer for a misfired refusal, or null.
 *
 * The gates, all deterministic and all required:
 *  1. the refusal is one of the two measured misfire kinds;
 *  2. the parse named EXACTLY ONE nearest canonical key — one strong registry
 *     match, never a pick among several;
 *  3. a target period exists (the absolute one the question names, for a
 *     forecast misfire; the freshest published one, for a meta misfire);
 *  4. the composed intent DRY-RUNS as servable through the real query layer.
 *
 * Gate 4 subsumes the brief's separate "is the period ≤ freshest" check: an
 * unpublished period simply fails the dry-run, which is the same source of
 * truth every other chip in the product is gated on. One check, not two that
 * could drift. */
export async function buildRescueOffer(
  parse: Extract<ParseOutcome, { kind: 'refusal' }>,
  deps: RescueDeps,
): Promise<RescueOffer | null> {
  if (parse.refusalKind !== 'forecast' && parse.refusalKind !== 'smalltalk') return null;
  const keys = parse.raw.nearestCanonicalKeys;
  if (keys.length !== 1) return null;
  const key = keys[0]!;
  const label = definitionLabelByKey.get(key);
  if (label === undefined) return null;

  const periodCode =
    parse.refusalKind === 'forecast'
      ? absolutePeriodInText(parse.question)
      : ((await deps.freshest(key))?.periodCode ?? null);
  if (periodCode === null) return null;

  const intent = intentFor(key, periodCode);
  const verdict = await deps.servability(intent);
  if (!verdict.servable) return null;

  const periodNl = periodCodeToNl(periodCode);
  const chipLabel =
    parse.refusalKind === 'forecast'
      ? `${periodNl} is al gepubliceerd — toon het cijfer voor ${label}.`
      : `Toon het cijfer voor ${label} (${periodNl}).`;
  return {
    label: chipLabel,
    option: {
      id: 'rescue-1',
      label: chipLabel,
      intent,
      // A rescue names an explicit, already-published period — it makes no
      // "what is it now" claim, so the staleness rule must not treat it as one.
      impliedRecency: false,
    },
  };
}
