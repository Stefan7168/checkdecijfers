// "Eigen data" attachments tier — reading dataset_turns rows back, for
// reconstruction (reconstruct.ts) and the verify script. Mirrors
// src/answer/audit/read.ts's shape: to_jsonb so pg and PGlite return
// byte-identical plain JSON, and an UNSCOPED read by id (no user_id filter)
// — this is an ops/verify-script reader, not the ownership-checked path a
// Server Action would use (that's store.ts's getDataset pattern instead).
import type { Db } from '../db/types.ts';
import type { DatasetTurnEnvelope, DatasetTurnRecord, RedactedDatasetEnvelope } from './types.ts';

interface RawRow {
  id: number;
  user_id: string;
  dataset_id: number;
  thread_id: number;
  request_id: string;
  kind: DatasetTurnRecord['kind'];
  question: string;
  envelope: DatasetTurnEnvelope | RedactedDatasetEnvelope;
  final_text: string;
  instruction: DatasetTurnRecord['instruction'];
  chart_emitted: boolean;
  prompt_versions: DatasetTurnRecord['promptVersions'];
  llm_calls: DatasetTurnRecord['llmCalls'];
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  created_at: string;
}

function toRecord(raw: RawRow): DatasetTurnRecord {
  return {
    id: raw.id,
    userId: raw.user_id,
    datasetId: raw.dataset_id,
    threadId: raw.thread_id,
    requestId: raw.request_id,
    kind: raw.kind,
    question: raw.question,
    envelope: raw.envelope,
    finalText: raw.final_text,
    instruction: raw.instruction,
    chartEmitted: raw.chart_emitted,
    promptVersions: raw.prompt_versions,
    llmCalls: raw.llm_calls,
    inputTokens: raw.input_tokens,
    outputTokens: raw.output_tokens,
    latencyMs: raw.latency_ms,
    createdAt: raw.created_at,
  };
}

export async function getDatasetTurnById(db: Db, id: number): Promise<DatasetTurnRecord | null> {
  const { rows } = await db.query(
    'select to_jsonb(t) as record from dataset_turns t where id = $1',
    [id],
  );
  const raw = rows[0]?.record as RawRow | undefined;
  return raw === undefined ? null : toRecord(raw);
}

/** ADR 037 D10: a dataset thread's turns for replay/resume — the
 * ownership-checked counterpart to `getDatasetTurnById`'s unscoped ops
 * reader. Scoped by BOTH `user_id` and `thread_id`, in stored order
 * (created_at asc, id asc — same convention as `src/threads/index.ts`'s
 * `getThreadRows`), so a caller (`web/app/actions.ts`'s `loadMyThread`) can
 * hand the result straight to `replayDatasetTurns`. */
export async function getDatasetTurnsByThread(db: Db, userId: string, threadId: number): Promise<DatasetTurnRecord[]> {
  const { rows } = await db.query(
    `select to_jsonb(t) as record
     from dataset_turns t
     where t.thread_id = $1 and t.user_id = $2
     order by t.created_at asc, t.id asc`,
    [threadId, userId],
  );
  return rows.map((row) => toRecord(row.record as RawRow));
}
