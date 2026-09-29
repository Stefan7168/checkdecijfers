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
import {
  CsvTooLargeError,
  isLegacyExcel,
  parsePastedTable,
  parseUpload,
  sniffUploadKind,
  UnreadableFileError,
} from '../backend/attachments/ingest/formats.ts';
import { fetchGoogleSheet, GSheetFetchError, parseGoogleSheetUrl } from '../backend/attachments/ingest/gsheet.ts';
import { parseCsv } from '../backend/attachments/ingest/csv.ts';
import { buildDatasetProfile, resolveAmbiguousFormats } from '../backend/attachments/ingest/profile.ts';
import { MAX_DATASETS_PER_USER, MAX_FILE_BYTES, MAX_TOTAL_BYTES_PER_USER } from '../backend/attachments/limits.ts';
import { deleteOneDataset } from '../backend/attachments/retention.ts';
import { respondToDatasetQuestion } from '../backend/attachments/respond.ts';
import type { RawDatasetState } from '../backend/attachments/respond.ts';
import { renderInstructionForDataset, type RenderInstructionFailure } from '../backend/attachments/render.ts';
import { activeDatasetUsage, getDataset, insertDataset, resolveDatasetDecision } from '../backend/attachments/store.ts';
import {
  ingestFileTooLargeText,
  ingestGoogleSheetText,
  ingestLegacyExcelText,
  ingestNothingToReadText,
  ingestQuotaExceededText,
  ingestUnreadableFileText,
  ingestUnsupportedFileTypeText,
} from '../backend/attachments/templates.ts';
import type { ColumnId, DatasetProfile, DatasetStatus, NumberFormat, SourceKind, UserChartSpec } from '../backend/attachments/types.ts';
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
      /** The ACTUAL stored `display_name` (trimmed + capped, `'bestand'` on
       * empty) — code-review finding: a caller (`Workspace.handleUploadFile`)
       * must never reuse the client's raw `File.name` here instead, since
       * that string can differ from what this action actually persisted
       * (the trim/cap/empty-fallback above). Every displayed string must
       * trace to stored data, the same rule this codebase applies to
       * CBS answers (R6). */
      displayName: string;
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
interface ImportToStore {
  sourceKind: SourceKind;
  displayName: string;
  sourceUrl: string | null;
  mimeSniffed: string;
  bytes: Uint8Array;
  cells: string[][];
}

/** The one place every import route ends: quota check, profile, store, the
 * eager dataset thread. Routes differ only in how they READ their table —
 * everything after `cells` exists is identical, so a new format can add no new
 * trust rule (ADR 037 D5/D10). */
async function storeImport(userId: string, imp: ImportToStore): Promise<IngestOutcome> {
  const db = getDb();
  const usage = await activeDatasetUsage(db, userId);
  if (usage.count + 1 > MAX_DATASETS_PER_USER) {
    return { kind: 'refused', message: ingestQuotaExceededText('count') };
  }
  if (usage.totalBytes + imp.bytes.length > MAX_TOTAL_BYTES_PER_USER) {
    return { kind: 'refused', message: ingestQuotaExceededText('bytes') };
  }

  const profile = buildDatasetProfile(imp.cells);
  const ambiguousColumnIds = profile.columns.filter((c) => c.numberFormat === 'ambiguous').map((c) => c.id);
  const status: DatasetStatus = ambiguousColumnIds.length > 0 ? 'needs_decision' : 'ready';
  const contentSha256 = createHash('sha256').update(Buffer.from(imp.bytes)).digest('hex');
  const displayName = imp.displayName.trim().slice(0, MAX_DISPLAY_NAME_CHARS) || 'bestand';

  const dataset = await insertDataset(db, {
    userId,
    sourceKind: imp.sourceKind,
    displayName,
    sourceUrl: imp.sourceUrl,
    mimeSniffed: imp.mimeSniffed,
    byteSize: imp.bytes.length,
    contentSha256,
    requestId: null,
    fileBytes: imp.bytes,
    cells: imp.cells,
    profile,
    status,
  });
  const threadId = await createDatasetThread(db, userId, dataset.id);

  return { kind: 'ok', datasetId: dataset.id, threadId, displayName: dataset.displayName, status, profile, ambiguousColumnIds };
}

/** A route's read failure → the refusal the reader sees (never a thrown 500). */
function readFailure(error: unknown): IngestOutcome | null {
  if (error instanceof CsvTooLargeError) return { kind: 'refused', message: ingestFileTooLargeText() };
  if (error instanceof UnreadableFileError) return { kind: 'refused', message: ingestUnreadableFileText() };
  return null;
}

const MIME_BY_KIND: Record<string, string> = {
  file_csv: 'text/csv',
  file_tsv: 'text/tab-separated-values',
  file_xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  file_ods: 'application/vnd.oasis.opendocument.spreadsheet',
  file_json: 'application/json',
};

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
  const uploadKind = sniffUploadKind(file.name);
  if (uploadKind === null) {
    return {
      kind: 'refused',
      message: isLegacyExcel(file.name) ? ingestLegacyExcelText() : ingestUnsupportedFileTypeText(),
    };
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let parsed;
    try {
      parsed = parseUpload(uploadKind, bytes);
    } catch (error) {
      const refused = readFailure(error);
      if (refused) return refused;
      throw error;
    }
    // A workbook with several tabs: the first table tab is imported and the
    // tab's name is part of the display name, so nobody mistakes which one.
    const displayName =
      parsed.sheetName !== null && parsed.sheetNames.length > 1 ? `${file.name.trim()} · ${parsed.sheetName}` : file.name;
    return await storeImport(userId, {
      sourceKind: uploadKind,
      displayName,
      sourceUrl: null,
      mimeSniffed: file.type || MIME_BY_KIND[uploadKind]!,
      bytes,
      cells: parsed.cells,
    });
  } catch (error) {
    console.error('ingestFile failed:', error);
    await reportError('ingestFile', error, { userId });
    throw error;
  }
}

/** A table pasted straight into the chat box (tab-separated from Excel/Sheets,
 * or comma/semicolon text). Stored as text exactly like an uploaded CSV. */
export async function ingestPastedTable(text: string): Promise<IngestOutcome> {
  const userId = await currentUserId();
  if (userId === null) return { kind: 'unauthenticated' };
  if (typeof text !== 'string') throw new Error('input rejected: text must be a string');
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_FILE_BYTES) return { kind: 'refused', message: ingestFileTooLargeText() };
  if (text.trim() === '') return { kind: 'refused', message: ingestNothingToReadText() };

  try {
    let cells: string[][];
    try {
      cells = parsePastedTable(text);
    } catch (error) {
      const refused = readFailure(error);
      if (refused) return refused;
      throw error;
    }
    if (cells.length < 2 || cells[0]!.length < 2) return { kind: 'refused', message: ingestNothingToReadText() };
    return await storeImport(userId, {
      sourceKind: 'paste_text',
      displayName: 'Pasted table',
      sourceUrl: null,
      mimeSniffed: 'text/plain',
      bytes,
      cells,
    });
  } catch (error) {
    console.error('ingestPastedTable failed:', error);
    await reportError('ingestPastedTable', error, { userId });
    throw error;
  }
}

/** A Google Sheet shared as "anyone with the link can view": fetched once as a
 * snapshot (no Google login, no OAuth) and stored like an uploaded file. */
export async function ingestGoogleSheet(url: string): Promise<IngestOutcome> {
  const userId = await currentUserId();
  if (userId === null) return { kind: 'unauthenticated' };
  if (typeof url !== 'string' || url.length > 2000) throw new Error('input rejected: url must be a string within 2000 chars');
  const ref = parseGoogleSheetUrl(url);
  if (ref === null) return { kind: 'refused', message: ingestGoogleSheetText('not_a_sheet_link') };

  try {
    let bytes: Uint8Array;
    let format: 'csv' | 'xlsx';
    try {
      ({ bytes, format } = await fetchGoogleSheet(ref));
    } catch (error) {
      if (error instanceof GSheetFetchError) return { kind: 'refused', message: ingestGoogleSheetText(error.reason) };
      const refused = readFailure(error);
      if (refused) return refused;
      throw error;
    }
    let cells: string[][];
    let sheetName: string | null = null;
    try {
      if (format === 'xlsx') {
        const parsed = parseUpload('file_xlsx', bytes);
        cells = parsed.cells;
        sheetName = parsed.sheetNames.length > 1 ? parsed.sheetName : null;
      } else {
        cells = parseCsv(new TextDecoder('utf-8').decode(bytes)).cells;
      }
    } catch (error) {
      const refused = readFailure(error);
      if (refused) return refused;
      throw error;
    }
    return await storeImport(userId, {
      sourceKind: 'url_gsheet',
      displayName: sheetName ? `Google Sheet · ${sheetName}` : 'Google Sheet',
      // Canonical, credential-free URL rebuilt from the validated id.
      sourceUrl: `https://docs.google.com/spreadsheets/d/${ref.id}/`,
      mimeSniffed: format === 'xlsx' ? MIME_BY_KIND.file_xlsx! : 'text/csv',
      bytes,
      cells,
    });
  } catch (error) {
    console.error('ingestGoogleSheet failed:', error);
    await reportError('ingestGoogleSheet', error, { userId });
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

export type RenderDatasetInstructionOutcome =
  | { kind: 'ok'; chart: UserChartSpec }
  | { kind: 'unauthenticated' }
  | { kind: 'not_found' }
  | { kind: 'invalid'; reason: RenderInstructionFailure };

/**
 * Chart co-pilot phase 2 (session 113) — the zero-LLM render of a reader's own
 * data command (the Data panel, Task 6; the chat co-pilot's applied
 * instruction, Task 8). DELIBERATELY not gated: unlike `askDataset` there is
 * no model call and no `chargeAndRunDataset` reserve here, because nothing
 * about re-running the deterministic validate → execute → build pipeline over
 * already-stored cells costs anything (the D12 CSV-ingest precedent).
 *
 * Ownership is `getDataset`'s own userId-bound read — a dataset that is not
 * the caller's, or not `ready`, is indistinguishable from one that does not
 * exist. No thread id is involved at all: this action writes nothing and
 * returns only a chart built from THIS dataset, so there is no turn to bind
 * to a thread.
 */
export async function renderDatasetInstruction(datasetId: number, rawInstruction: unknown): Promise<RenderDatasetInstructionOutcome> {
  guardPositiveInteger(datasetId, 'datasetId');

  const userId = await currentUserId();
  if (userId === null) {
    return { kind: 'unauthenticated' };
  }

  const dataset = await getDataset(getDb(), userId, datasetId);
  if (dataset === null || dataset.status !== 'ready') {
    return { kind: 'not_found' };
  }

  try {
    return renderInstructionForDataset(dataset, rawInstruction);
  } catch (error) {
    console.error('renderDatasetInstruction failed:', error);
    await reportError('renderDatasetInstruction', error, { userId });
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
