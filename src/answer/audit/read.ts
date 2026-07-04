// Reading audit records back (R8 verification, benchmark scoring, and the
// future answer-pages/audit-trail seams — docs/04). Rows are read through
// to_jsonb so pg and PGlite return byte-identical plain JSON: no
// driver-specific array/timestamp decoding can skew what the scorer or the
// reconstruction check sees.
import type { Db } from '../../db/types.ts';
import type { ComposedResponse, PendingClarification } from '../respond/types.ts';
import type { ConversationContext } from '../context/types.ts';
import type { AuditRecord } from './types.ts';

interface RawRow {
  id: number;
  schema_version: number;
  created_at: string;
  user_id: string | null;
  source_tag: AuditRecord['sourceTag'];
  kind: AuditRecord['kind'];
  question: string;
  reference_date: string;
  reply_text: string | null;
  pending_clarification: PendingClarification | null;
  /** Nullable column added by migration 009 (WP15) — to_jsonb serializes it
   * as null on all rows once the migration ran. */
  conversation_context: ConversationContext | null;
  response: ComposedResponse;
  final_text: string;
  intent: unknown | null;
  intent_hash: string | null;
  refusal_reason: AuditRecord['refusalReason'];
  result_ids: string[];
  table_ids: string[];
  tables: AuditRecord['tables'];
  answer_source: AuditRecord['answerSource'];
  chart_emitted: boolean;
  prompt_versions: AuditRecord['promptVersions'];
  llm_calls: AuditRecord['llmCalls'];
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
}

function toRecord(raw: RawRow): AuditRecord {
  return {
    id: raw.id,
    schemaVersion: raw.schema_version as AuditRecord['schemaVersion'],
    createdAt: raw.created_at,
    userId: raw.user_id,
    sourceTag: raw.source_tag,
    kind: raw.kind,
    question: raw.question,
    referenceDate: raw.reference_date,
    replyText: raw.reply_text,
    pendingClarification: raw.pending_clarification,
    conversationContext: raw.conversation_context ?? null,
    response: raw.response,
    finalText: raw.final_text,
    intent: raw.intent,
    intentHash: raw.intent_hash,
    refusalReason: raw.refusal_reason,
    resultIds: raw.result_ids,
    tableIds: raw.table_ids,
    tables: raw.tables,
    answerSource: raw.answer_source,
    chartEmitted: raw.chart_emitted,
    promptVersions: raw.prompt_versions,
    llmCalls: raw.llm_calls,
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    latencyMs: raw.latency_ms,
  };
}

export async function loadAuditRecord(db: Db, id: number): Promise<AuditRecord | null> {
  const { rows } = await db.query(
    'select to_jsonb(a) as record from audit_answers a where id = $1',
    [id],
  );
  const raw = rows[0]?.record as RawRow | undefined;
  return raw === undefined ? null : toRecord(raw);
}

/** All records, oldest first — the benchmark runner/scorer path. */
export async function loadAllAuditRecords(db: Db): Promise<AuditRecord[]> {
  const { rows } = await db.query(
    'select to_jsonb(a) as record from audit_answers a order by a.id',
  );
  return rows.map((row) => toRecord(row.record as RawRow));
}
