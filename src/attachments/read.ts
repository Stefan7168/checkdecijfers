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

/** Final review (session 113, co-pilot phase 2): whether `turnId` is a chart
 * turn of THIS caller in THIS thread. The co-pilot's Server Action stores
 * `targetTurnId` in the turn envelope and the own-data card later uses it as
 * the chart-edits persistence key, so an id the caller doesn't own must be
 * rejected at the door rather than reaching the envelope. The double binding
 * (user AND thread) mirrors `validateDatasetThreadOwnership`'s own posture;
 * `kind = 'chart'` excludes a clarification/refusal turn, which carries no
 * chart to adjust. */
export async function isOwnChartTurn(db: Db, userId: string, threadId: number, turnId: number): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from dataset_turns where id = $1 and thread_id = $2 and user_id = $3::uuid and kind = 'chart'`,
    [turnId, threadId, userId],
  );
  return rows.length > 0;
}
