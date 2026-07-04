// Server-side validation of a CLIENT-SUPPLIED ConversationContext (WP15,
// ADR 021 decision 1, trust boundary): the context is client-held between
// turns (the PendingClarification pattern) and could be forged, so before it
// is allowed anywhere near a prompt every field must check out as registry
// vocabulary — the canonical key against the registry, every region name
// against the topic table's own dimension labels, everything else as enums /
// bounded numbers. Any failure drops the context ENTIRELY (fail closed to a
// standalone parse): no client-controlled free text can enter the follow-up
// prompt through this object.
import { z } from 'zod';
import type { Db } from '../../db/types.ts';
import { CANONICAL_KEYS } from '../intent/schema.ts';
import { baseLabel, normalizeRegionName } from '../intent/resolve.ts';
import type { ConversationContext } from './types.ts';

const saneYear = z.number().int().min(1900).max(2100);

const contextPeriodSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('year'), year: saneYear }),
  z.strictObject({ kind: z.literal('quarter'), year: saneYear, quarter: z.number().int().min(1).max(4) }),
  z.strictObject({ kind: z.literal('month'), year: saneYear, month: z.number().int().min(1).max(12) }),
  z.strictObject({ kind: z.literal('year_range'), fromYear: saneYear, toYear: saneYear }),
]);

// 'onbekend' is deliberately absent: the builder never emits it (kinds come
// from CBS code prefixes), so receiving one can only mean a forged object.
const contextRegionSchema = z.strictObject({
  name: z.string().min(1).max(80),
  kind: z.enum(['land', 'landsdeel', 'provincie', 'gemeente']),
});

const conversationContextSchema = z.strictObject({
  version: z.literal(1),
  topicKey: z.enum(CANONICAL_KEYS),
  regions: z.array(contextRegionSchema).min(1).max(8).nullable(),
  period: contextPeriodSchema.nullable(),
  derivation: z.enum(['none', 'difference', 'max', 'series']),
});

/** Every claimed region name must match a label of the topic table's geo
 * dimension (same normalization the resolver applies) — the allowlist that
 * makes the payload registry-vocabulary-only. Returns the names REWRITTEN to
 * the matched registry label's own bytes, never the client's: normalization
 * treats Unicode whitespace-class characters (U+FEFF and friends) as
 * removable, so a byte-different name can normalize into the allowlist — the
 * matched canonical label is what may enter a prompt, not the client string
 * (adversarial-review finding, 2026-07-04: a BOM-decorated "Amsterdam﻿"
 * survived the membership check verbatim). */
async function regionsFromRegistry<T extends { name: string; kind: string }>(
  db: Db,
  topicKey: string,
  regions: T[],
): Promise<T[] | null> {
  const geo = await db.query(
    `select t.id as table_id, t.expected_dimensions
     from canonical_measures c join cbs_tables t on t.id = c.table_id
     where c.key = $1`,
    [topicKey],
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
    'select label from dimension_labels where table_id = $1 and dimension = $2',
    [row.table_id, geoDimension],
  );
  const canonicalByNormalized = new Map<string, string>();
  for (const r of labels.rows) {
    const canonical = baseLabel((r.label as string).replace(/\s+/g, ' ').trim());
    canonicalByNormalized.set(normalizeRegionName(canonical), canonical);
  }
  const rewritten: T[] = [];
  for (const term of regions) {
    const canonical = canonicalByNormalized.get(normalizeRegionName(term.name));
    if (canonical === undefined) return null;
    rewritten.push({ ...term, name: canonical });
  }
  return rewritten;
}

/** Zod + registry validation of an untrusted context. Returns the validated
 * object, or null — the caller then parses the question standalone, exactly
 * as if no context had been sent. Never throws. */
export async function validateConversationContext(
  db: Db,
  raw: unknown,
): Promise<ConversationContext | null> {
  if (raw === null || raw === undefined) return null;
  const parsed = conversationContextSchema.safeParse(raw);
  if (!parsed.success) return null;
  const context = parsed.data;
  if (context.period?.kind === 'year_range' && context.period.fromYear > context.period.toYear) {
    return null;
  }
  try {
    if (context.regions !== null) {
      const rewritten = await regionsFromRegistry(db, context.topicKey, context.regions);
      if (rewritten === null) return null;
      return { ...context, regions: rewritten } as ConversationContext;
    }
  } catch {
    // A failed registry lookup must never break the question itself.
    return null;
  }
  return context as ConversationContext;
}
