// Builds the ConversationContext a chat turn hands the NEXT turn (WP15,
// ADR 021 decision 1): the resolved intent — exactly ADR 016's "stored query
// plan" (the same resolvedIntent() the audit layer promotes) — mapped back
// into the parser's registry vocabulary. Deterministic code only; runs
// server-side after the audited response is produced; the envelope itself is
// deliberately untouched (ADR 021 decision 3).
//
// Fail-closed shape policy: any part of the intent that cannot round-trip
// honestly into the raw-parse vocabulary nulls the WHOLE context (explicit
// targets, unlabelable region codes) or that axis (multi-code periods,
// quarter/month ranges) per the ADR's recorded limitations — a follow-up then
// simply degrades to a standalone parse / an honest clarification. Never a
// guessed or partial referent.
import type { Db } from '../../db/types.ts';
import type { ComposedResponse } from '../respond/types.ts';
import type { IntentPeriod, StructuredIntent } from '../../query/index.ts';
import { resolvedIntent } from '../audit/write.ts';
import { baseLabel, regionKindForCode } from '../intent/resolve.ts';
import type { RegionTerm } from '../intent/types.ts';
import type { ContextPeriod, ConversationContext } from './types.ts';
import { CONTEXT_VERSION } from './types.ts';

// Region-code prefix → kind lives in ONE place since #138: regionKindForCode
// (intent/resolve.ts) — this module's local copy was its near-duplicate.

/** Resolved period → concrete PeriodSpec shape. Null when the shape cannot
 * round-trip (ADR 021 limitation 2) — never an approximation. */
export function contextPeriodFor(period: IntentPeriod): ContextPeriod | null {
  const parse = (code: string): ContextPeriod | null => {
    const match = /^(\d{4})(JJ|KW|MM)(\d{2})$/.exec(code);
    if (!match) return null;
    const year = Number(match[1]);
    if (match[2] === 'JJ') return { kind: 'year', year };
    const index = Number(match[3]);
    if (match[2] === 'KW') return index >= 1 && index <= 4 ? { kind: 'quarter', year, quarter: index } : null;
    return index >= 1 && index <= 12 ? { kind: 'month', year, month: index } : null;
  };
  if (period.kind === 'codes') {
    return period.codes.length === 1 ? parse(period.codes[0]!) : null;
  }
  const from = /^(\d{4})JJ00$/.exec(period.from);
  const to = /^(\d{4})JJ00$/.exec(period.to);
  if (!from || !to) return null;
  return { kind: 'year_range', fromYear: Number(from[1]), toYear: Number(to[1]) };
}

/** Region codes → registry-labelled RegionTerms, via the canonical measure's
 * table geo dimension. Null (whole-context bail-out) when any code cannot be
 * labelled — a partial region list would be a WRONG referent, not a degraded
 * one. Exported since #138: the refusal retry chip injects this as its
 * honest code→label source (registry/dimension_labels, never a cell). */
export async function regionTermsFor(
  db: Db,
  canonicalKey: string,
  codes: string[],
): Promise<RegionTerm[] | null> {
  const geo = await db.query(
    `select t.id as table_id, t.expected_dimensions
     from canonical_measures c join cbs_tables t on t.id = c.table_id
     where c.key = $1`,
    [canonicalKey],
  );
  const row = geo.rows[0];
  if (!row) return null;
  const dimensions = (
    typeof row.expected_dimensions === 'string'
      ? JSON.parse(row.expected_dimensions)
      : (row.expected_dimensions ?? [])
  ) as { name: string; kind: string }[];
  const geoDimension = dimensions.find((d) => d.kind === 'GeoDimension')?.name;
  if (!geoDimension) return null;

  const labels = await db.query(
    'select code, label from dimension_labels where table_id = $1 and dimension = $2 and code = any($3::text[])',
    [row.table_id, geoDimension, codes],
  );
  const labelByCode = new Map(
    labels.rows.map((r) => [(r.code as string).trim(), (r.label as string).replace(/\s+/g, ' ').trim()]),
  );

  const terms: RegionTerm[] = [];
  for (const code of codes) {
    const label = labelByCode.get(code);
    const kind = regionKindForCode(code);
    if (!label || !kind) return null;
    terms.push({ name: baseLabel(label), kind });
  }
  return terms;
}

/** The context this response hands the next turn, or null when the response
 * leaves no honest referent (clarifications, parse-level refusals, explicit
 * targets). The intent source is resolvedIntent() — answers and
 * query-refusals alike (a freshness refusal's plan is a real referent:
 * "en in mei?" after one is the everyday follow-up). */
export async function buildConversationContext(
  db: Db,
  response: ComposedResponse,
): Promise<ConversationContext | null> {
  const intent: StructuredIntent | null = resolvedIntent(response);
  if (intent === null) return null;
  if (intent.target.kind !== 'canonical') return null;

  const codes = intent.regions ?? [];
  const regions = codes.length === 0 ? null : await regionTermsFor(db, intent.target.key, codes);
  if (codes.length > 0 && regions === null) return null;

  return {
    version: CONTEXT_VERSION,
    topicKey: intent.target.key,
    regions,
    period: contextPeriodFor(intent.period),
    derivation: intent.derivation,
  };
}
