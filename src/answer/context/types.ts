// WP15 conversation memory (ADR 021, open-questions #57): the STRUCTURED
// context carried between chat turns — the previous turn's resolved intent
// (the stored query plan, ADR 016) mapped back into the parser's registry
// vocabulary, so it can be offered as a merge candidate for follow-up
// questions ("En in Rotterdam?").
//
// The load-bearing constraint (owner-approved, non-negotiable): this is the
// ONLY conversational state that ever reaches a prompt, and it is registry
// vocabulary end-to-end — canonical keys, region names as the registry labels
// them, concrete period shapes. Never raw chat history, never previous
// question/reply text, never model-phrased readings (all three ARE chat
// history; reopening that surface is exactly what ADR 021 forbids — R2/#41).
import type { DerivationHint, RegionTerm } from '../intent/types.ts';

export const CONTEXT_VERSION = 1 as const;

/** Concrete period shapes only — the subset of the raw-parse PeriodSpec that
 * a RESOLVED period can round-trip into. Relative shapes ('latest', 'since',
 * 'last_n', …) are deliberately absent: the context carries what was actually
 * served (the query plan's codes), never a spec that would re-resolve to
 * something else on a later day. */
export type ContextPeriod =
  | { kind: 'year'; year: number }
  | { kind: 'quarter'; year: number; quarter: number }
  | { kind: 'month'; year: number; month: number }
  | { kind: 'year_range'; fromYear: number; toYear: number };

/** Serializable, client-held between turns (the PendingClarification
 * pattern). Built ONLY by buildConversationContext (deterministic code over a
 * ComposedResponse); validated by validateConversationContext before ANY
 * server-side use — a client-forged context can therefore never inject free
 * text into a prompt (every field is registry-checked or an enum). */
export interface ConversationContext {
  version: typeof CONTEXT_VERSION;
  /** A canonical_measures key (validated against the live registry). */
  topicKey: string;
  /** Region names + kinds as the registry labels them (validated against
   * dimension_labels), or null when the intent carried no regions. */
  regions: RegionTerm[] | null;
  /** Null when the resolved period cannot round-trip (multi-code selections,
   * quarter/month ranges — ADR 021 limitation 2): the follow-up then treats
   * the period as unstated, which degrades to an honest period clarification. */
  period: ContextPeriod | null;
  derivation: DerivationHint;
}
