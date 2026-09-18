// Co-pilot phase 2 (session 113, Task 8) — the chat doorway's Server Action
// wire. A SEPARATE file from dataset-actions.ts (the chart-edits-actions.ts
// precedent): only the own-data CARD imports this, and keeping the co-pilot's
// import graph out of the question flow's module means a chart edit can never
// drag the ingest/CSV/retention half of that file into its bundle.
//
// `adjustDatasetChart` is `askDataset`'s shape, one for one: the same guards,
// the same ownership DOUBLE-binding (the dataset AND the thread must be the
// caller's, and the thread must be THIS dataset's own), the same
// needs_decision/ready gates, and the same `chargeAndRunDataset` reserve
// around exactly one model call. Everything the browser sent about the chart
// — the held instruction, the claimed capabilities — is passed through
// UNTRUSTED and revalidated inside `respondToChartEdit`.
'use server';

import { chargeAndRunDataset } from '../backend/billing/dataset-gate.ts';
import type { GatedDatasetResponse } from '../backend/billing/types.ts';
import { AnthropicLlmClient } from '../backend/answer/llm/client.ts';
import { respondToChartEdit } from '../backend/attachments/copilot/respond.ts';
import { sanitizeCapabilities } from '../backend/attachments/copilot/types.ts';
import { isOwnChartTurn } from '../backend/attachments/read.ts';
import { getDataset, setDatasetTurnCopilotFeedback } from '../backend/attachments/store.ts';
import type { DatasetProfile } from '../backend/attachments/types.ts';
import { validateDatasetThreadOwnership } from '../backend/threads/index.ts';
import { summarizeInstruction } from '../lib/chart-data-instruction.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { reportError } from '../lib/error-report.ts';
import { isUuid } from '../lib/trial.ts';

// The same belt dataset-actions.ts wears, for the same reason: a Server
// Action argument's declared TS type is erased at runtime, so every string
// and id still needs its own check. The cap is the composer's own maxLength
// (chart-copilot-input.tsx) — a chart edit is a short instruction, not a
// question, so it is a quarter of askDataset's.
const MAX_MESSAGE_LENGTH = 500;

function guardMessage(message: string): void {
  if (typeof message !== 'string' || message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`input rejected: not a string within ${MAX_MESSAGE_LENGTH} chars`);
  }
}

const MAX_REQUEST_ID_LENGTH = 100;

function guardRequestId(requestId: string): void {
  if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > MAX_REQUEST_ID_LENGTH || !isUuid(requestId)) {
    throw new Error('input rejected: malformed requestId');
  }
}

function guardPositiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`input rejected: ${name} must be a positive integer`);
  }
  return value;
}

export type AdjustDatasetChartOutcome =
  | GatedDatasetResponse
  | { kind: 'not_found' }
  | { kind: 'needs_decision'; profile: DatasetProfile };

/**
 * One credited chart edit (ADR 056, co-pilot phase 2). Returns the gate's own
 * result: a `chart` envelope carrying `copilot.commands` the CLIENT then
 * re-validates against the new chart before dispatching any of them
 * (chart-copilot-reply.ts) — this action never decides what is applied.
 */
export async function adjustDatasetChart(
  datasetId: number,
  rawThreadId: unknown,
  rawTargetTurnId: unknown,
  message: string,
  requestId: string,
  rawCurrent: unknown,
  rawCapabilities: unknown,
): Promise<AdjustDatasetChartOutcome> {
  guardPositiveInteger(datasetId, 'datasetId');
  const targetTurnId = guardPositiveInteger(rawTargetTurnId, 'targetTurnId');
  guardMessage(message);
  guardRequestId(requestId);

  const userId = await currentUserId();
  if (userId === null) {
    return { kind: 'unauthenticated' };
  }

  const db = getDb();
  const threadId = await validateDatasetThreadOwnership(db, userId, rawThreadId, datasetId);
  if (threadId === null) {
    return { kind: 'not_found' };
  }
  // Final review (session 113): the turn id the browser sent is stored in
  // the new turn's envelope and reused as the chart-edits key, so it is
  // bound to the caller AND this thread here — not trusted because the
  // thread check above passed.
  if (!(await isOwnChartTurn(db, userId, threadId, targetTurnId))) {
    return { kind: 'not_found' };
  }
  const dataset = await getDataset(db, userId, datasetId);
  if (dataset === null) {
    return { kind: 'not_found' };
  }
  if (dataset.status === 'needs_decision') {
    return { kind: 'needs_decision', profile: dataset.profile };
  }
  if (dataset.status !== 'ready') {
    return { kind: 'not_found' };
  }

  // The ONE thing read off the claimed capabilities here: which language the
  // data chip's summary is written in. Taken from the SANITISED copy (an
  // unknown value falls back to 'nl'), never from the raw client object.
  const lang = sanitizeCapabilities(rawCapabilities).lang;

  try {
    return await chargeAndRunDataset(db, userId, requestId, () =>
      respondToChartEdit(db, {
        dataset,
        threadId,
        targetTurnId,
        message,
        requestId,
        current: rawCurrent,
        capabilities: rawCapabilities,
        llmOptions: { client: new AnthropicLlmClient() },
        // The SAME function the Data panel labels its own commands with, so
        // the two doorways can never describe one instruction differently.
        summarize: (instruction) => summarizeInstruction(instruction, dataset.profile, lang),
      }),
    );
  } catch (error) {
    console.error('adjustDatasetChart failed:', error);
    await reportError('adjustDatasetChart', error, { requestId, userId });
    throw error;
  }
}

/**
 * The 👍/👎 on one co-pilot reply. Fail-soft (`{ ok: false }`, never a throw)
 * for a missing session or a turn that is not the caller's — a vote is a
 * courtesy, and the store's own `user_id`-bound update is the ownership
 * check: absent and foreign are indistinguishable on purpose.
 */
export async function submitCopilotFeedback(rawTurnId: unknown, vote: 'up' | 'down'): Promise<{ ok: boolean }> {
  const turnId = guardPositiveInteger(rawTurnId, 'turnId');
  if (vote !== 'up' && vote !== 'down') {
    throw new Error('input rejected: vote must be up or down');
  }

  const userId = await currentUserId();
  if (userId === null) {
    return { ok: false };
  }
  return { ok: await setDatasetTurnCopilotFeedback(getDb(), userId, turnId, vote) };
}
