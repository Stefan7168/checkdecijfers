// "Eigen data" attachments tier — the Server Action wire for chat-with-your-
// data (ADR 037, WP202a D8/D5/D13). A sibling of web/app/actions.ts, reusing
// its shape (auth-in-the-action, guard-then-gate, log-then-rethrow on an
// unexpected failure) but never sharing its private guard functions —
// actions.ts's guardLength/guardRequestId aren't exported, and duplicating
// three lines here is cheaper than widening an already-shipped, heavily-
// tested file's surface for a still-dormant feature (ATTACHMENTS_ENABLED
// does not exist yet; nothing in web/ calls this file yet either).
'use server';

import { createHash } from 'node:crypto';

import { chargeAndRunDataset } from '../backend/billing/dataset-gate.ts';
import type { GatedDatasetResponse } from '../backend/billing/types.ts';
import { AnthropicLlmClient } from '../backend/answer/llm/client.ts';
import { CsvTooLargeError, parseCsv } from '../backend/attachments/ingest/csv.ts';
import { buildDatasetProfile, resolveAmbiguousFormats } from '../backend/attachments/ingest/profile.ts';
import { MAX_DATASETS_PER_USER, MAX_FILE_BYTES, MAX_TOTAL_BYTES_PER_USER } from '../backend/attachments/limits.ts';
import { deleteOneDataset } from '../backend/attachments/retention.ts';
import { respondToDatasetQuestion } from '../backend/attachments/respond.ts';
import type { RawDatasetState } from '../backend/attachments/respond.ts';
import { activeDatasetUsage, getDataset, insertDataset, resolveDatasetDecision } from '../backend/attachments/store.ts';
import {
  ingestFileTooLargeText,
  ingestQuotaExceededText,
  ingestUnsupportedFileTypeText,
} from '../backend/attachments/templates.ts';
import type { ColumnId, DatasetProfile, DatasetStatus, NumberFormat, SourceKind } from '../backend/attachments/types.ts';
import { createDatasetThread, validateDatasetThreadOwnership } from '../backend/threads/index.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { reportError } from '../lib/error-report.ts';
import { isUuid } from '../lib/trial.ts';

// Same belt as actions.ts's own guardLength — a Server Action argument's
// declared TS type is erased at runtime, so a string field still needs its
// own length check regardless of what the client is supposed to send.
const MAX_QUESTION_LENGTH = 2000;

function guardQuestion(question: string): void {
  if (typeof question !== 'string' || question.length > MAX_QUESTION_LENGTH) {
    throw new Error(`input rejected: not a string within ${MAX_QUESTION_LENGTH} chars`);
  }
}

const MAX_REQUEST_ID_LENGTH = 100;

function guardRequestId(requestId: string): void {
  if (
    typeof requestId !== 'string' ||
    requestId.length === 0 ||
    requestId.length > MAX_REQUEST_ID_LENGTH ||
    !isUuid(requestId)
  ) {
    throw new Error('input rejected: malformed requestId');
  }
}

function guardPositiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`input rejected: ${name} must be a positive integer`);
  }
  return value;
}

/** A CSV/TSV-only sniff by extension for v1 — XLSX/HTML/PDF ingest (WP202b/c)
 * have no parser in src/attachments/ingest/ yet, so this is deliberately not
 * a MIME check: browsers report wildly inconsistent `File.type` values for
 * CSV (often empty, or `application/vnd.ms-excel`), while the extension is
 * exactly what the deterministic parser downstream (`parseCsv`) commits to. */
function sniffSourceKind(fileName: string): SourceKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return 'file_csv';
  if (lower.endsWith('.tsv')) return 'file_tsv';
  return null;
}

/** Untrusted, client-echoed displayName cap — this module's own
 * MAX_HEADER_CHARS-style discipline (limits.ts), applied to the one
 * ingest-time string that ISN'T bounded by a database column constraint
 * (`user_datasets.display_name` is a plain `text`). */
const MAX_DISPLAY_NAME_CHARS = 200;

export type IngestOutcome =
  | { kind: 'unauthenticated' }
  | { kind: 'refused'; message: string }
  | {
      kind: 'ok';
      datasetId: number;
      threadId: number;
      status: DatasetStatus;
      profile: DatasetProfile;
      ambiguousColumnIds: ColumnId[];
    };

/**
 * ADR 037 D5 (ingest) + D10 (the eager dataset thread). CSV/TSV only in v1 —
 * the only ingest pipeline actually built (ingest/csv.ts). Free: no billing
 * gate call at all (D12 — "free" for CSV/TSV means skip the reserve call,
 * not a priced-at-zero row; migration 026's `request_id` stays null on this
 * path). Every cap here is a returned `refused` outcome, never a thrown
 * error — these ARE real, reachable user outcomes (a too-big file, a full
 * quota), unlike the guard functions above, which reject shapes the real UI
 * can never actually produce.
 */
export async function ingestFile(formData: FormData): Promise<IngestOutcome> {
  const userId = await currentUserId();
  if (userId === null) {
    return { kind: 'unauthenticated' };
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    throw new Error('ingestFile: no file received');
  }

  if (file.size > MAX_FILE_BYTES) {
    return { kind: 'refused', message: ingestFileTooLargeText() };
  }
  const sourceKind = sniffSourceKind(file.name);
  if (sourceKind === null) {
    return { kind: 'refused', message: ingestUnsupportedFileTypeText() };
  }

  const db = getDb();
  const usage = await activeDatasetUsage(db, userId);
  if (usage.count + 1 > MAX_DATASETS_PER_USER) {
    return { kind: 'refused', message: ingestQuotaExceededText('count') };
  }
  if (usage.totalBytes + file.size > MAX_TOTAL_BYTES_PER_USER) {
    return { kind: 'refused', message: ingestQuotaExceededText('bytes') };
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder('utf-8').decode(bytes);
    let cells: string[][];
    try {
      ({ cells } = parseCsv(text));
    } catch (error) {
      if (error instanceof CsvTooLargeError) {
        return { kind: 'refused', message: ingestFileTooLargeText() };
      }
      throw error;
    }

    const profile = buildDatasetProfile(cells);
    const ambiguousColumnIds = profile.columns
      .filter((c) => c.numberFormat === 'ambiguous')
      .map((c) => c.id);
    const status: DatasetStatus = ambiguousColumnIds.length > 0 ? 'needs_decision' : 'ready';
    const contentSha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
    const displayName = file.name.trim().slice(0, MAX_DISPLAY_NAME_CHARS) || 'bestand';

    const dataset = await insertDataset(db, {
      userId,
      sourceKind,
      displayName,
      sourceUrl: null,
      mimeSniffed: file.type || (sourceKind === 'file_tsv' ? 'text/tab-separated-values' : 'text/csv'),
      byteSize: bytes.length,
      contentSha256,
      requestId: null,
      fileBytes: bytes,
      cells,
      profile,
      status,
    });
    const threadId = await createDatasetThread(db, userId, dataset.id);

    return { kind: 'ok', datasetId: dataset.id, threadId, status, profile, ambiguousColumnIds };
  } catch (error) {
    console.error('ingestFile failed:', error);
    await reportError('ingestFile', error, { userId });
    throw error;
  }
}

export type DecideDatasetFormatOutcome =
  | { kind: 'unauthenticated' }
  | { kind: 'nothing_to_decide' }
  | { kind: 'ok'; profile: DatasetProfile };

/**
 * ADR 037 D5's profile-card two-chip disambiguation. `decisions` must cover
 * every column the CURRENT profile still lists as `numberFormat: 'ambiguous'`
 * — `resolveAmbiguousFormats` (profile.ts) throws otherwise, which propagates
 * (a shape the real UI, driven by the current profile, can never produce).
 */
export async function decideDatasetFormat(
  datasetId: number,
  decisions: Record<string, unknown>,
): Promise<DecideDatasetFormatOutcome> {
  guardPositiveInteger(datasetId, 'datasetId');
  if (typeof decisions !== 'object' || decisions === null) {
    throw new Error('decideDatasetFormat: decisions must be an object');
  }
  const validated: Record<ColumnId, Exclude<NumberFormat, 'ambiguous'>> = {};
  for (const [columnId, value] of Object.entries(decisions)) {
    if (value !== 'nl' && value !== 'en') {
      throw new Error(`decideDatasetFormat: invalid decision for column '${columnId}'`);
    }
    validated[columnId] = value;
  }

  const userId = await currentUserId();
  if (userId === null) {
    return { kind: 'unauthenticated' };
  }

  const db = getDb();
  const dataset = await getDataset(db, userId, datasetId);
  if (dataset === null || dataset.status !== 'needs_decision') {
    return { kind: 'nothing_to_decide' };
  }

  const resolvedProfile = resolveAmbiguousFormats(dataset.cells, dataset.profile, validated);
  const resolved = await resolveDatasetDecision(db, userId, datasetId, dataset.cells, resolvedProfile);
  if (!resolved) {
    // U12's own race: the dataset stopped being 'needs_decision' between the
    // read above and this write (a concurrent decide/delete). No partial
    // state either way — resolveDatasetDecision's WHERE matched nothing.
    return { kind: 'nothing_to_decide' };
  }
  return { kind: 'ok', profile: resolvedProfile };
}

export type AskDatasetOutcome =
  | GatedDatasetResponse
  | { kind: 'not_found' }
  | { kind: 'needs_decision'; profile: DatasetProfile };

function coerceRawDatasetState(raw: unknown): RawDatasetState | null {
  // respond.ts's own revalidatePrevious already re-validates every field of
  // this against the CURRENT profile (through the closed-vocabulary
  // allowlist) inside a try/catch that drops anything malformed to a
  // standalone parse — this is only a shape gate so the value satisfies the
  // TS parameter type, not a trust boundary of its own.
  return raw !== null && typeof raw === 'object' ? (raw as RawDatasetState) : null;
}

/**
 * ADR 037 D8 — the dataset-chat turn. Ownership is bound TWICE over: the
 * dataset and the thread must both belong to the caller, AND the thread must
 * be THIS dataset's own thread (`validateDatasetThreadOwnership`) — nothing
 * in the schema otherwise stops a caller's valid `datasetId` from being
 * paired with a different one of their own threads (even a CBS one).
 */
export async function askDataset(
  datasetId: number,
  rawThreadId: unknown,
  question: string,
  requestId: string,
  rawState: unknown,
): Promise<AskDatasetOutcome> {
  guardPositiveInteger(datasetId, 'datasetId');
  guardQuestion(question);
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

  try {
    return await chargeAndRunDataset(db, userId, requestId, () =>
      respondToDatasetQuestion(db, {
        dataset,
        threadId,
        question,
        requestId,
        rawState: coerceRawDatasetState(rawState),
        llmOptions: { client: new AnthropicLlmClient() },
      }),
    );
  } catch (error) {
    console.error('askDataset failed:', error);
    await reportError('askDataset', error, { requestId, userId });
    throw error;
  }
}

/** ADR 037 D13 — self-service per-file delete ("Verwijder dit bestand").
 * Throws on unauth, matching deleteMyQuestionHistory's (actions.ts)
 * deliberate-user-action convention, not submitAnswerFeedback's fail-soft
 * one. `deleteOneDataset` (retention.ts) is itself the ownership check —
 * bound by `userId` as a parameter, `false` for "doesn't exist" AND
 * "belongs to someone else", indistinguishable on purpose. */
export async function deleteMyDataset(datasetId: number): Promise<{ deleted: boolean }> {
  guardPositiveInteger(datasetId, 'datasetId');
  const userId = await currentUserId();
  if (userId === null) {
    throw new Error('not authenticated');
  }
  const deleted = await deleteOneDataset(getDb(), userId, datasetId);
  return { deleted };
}
