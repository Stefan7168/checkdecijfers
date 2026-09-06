// "Eigen data" attachments tier — the R8 analog for this tier (D9): does a
// stored dataset_turns row RECONSTRUCT the response it claims to record?
// Mirrors src/answer/audit/reconstruct.ts's shape and purpose, adapted to
// this tier's own structural difference: a UserChartSpec's plotted points
// are a projection of `user_datasets.cells`, a SEPARATE row from the turn
// itself (unlike ValidatedResult, which embeds its own source cells inline
// in the SAME audit_answers row) — so reconstruction here takes the
// CURRENT dataset row as an explicit second argument instead of being
// self-contained from the turn record alone. U12 (immutable once ready)
// is what makes that "current" row a valid stand-in for "the row as it was
// when this turn was written", for every non-redacted turn.
import { buildUserChartSpec } from './chart.ts';
import {
  refusalText,
  lowConfidenceClarificationText,
  suggestionOptions,
  validationClarificationText,
  zeroRowsClarificationText,
} from './templates.ts';
import { redactedDatasetEnvelope, REDACTED_DATASET_TEXT, toClientInstruction } from './types.ts';
import type { DatasetTurnRecord, UserDataset } from './types.ts';

/** JSON.stringify with recursively sorted object keys — the same shape as
 * src/answer/llm/client.ts's stableStringify, duplicated here rather than
 * imported: a generic JSON canonicalizer is cheap to keep as a pure leaf in
 * this module (ADR 001's boundary), not worth crossing into src/answer/ for.
 *
 * Date special-case (found live, writing this module's own tests): despite
 * `UserDataset.createdAt` being typed `string`, the pg/PGlite driver
 * actually hands back a live `Date` instance for a `timestamptz` column on
 * every plain `select` (no type-parser override exists in src/db/) — only
 * `JSON.stringify`'s own `Date.prototype.toJSON` call (already baked into
 * every stored envelope at write time) turns it into an ISO string. Without
 * this branch, a freshly-fetched dataset's `createdAt` recurses into
 * `Object.entries(date)` (no own enumerable properties) and serializes as
 * `{}`, silently comparing unequal against the stored ISO-string copy on
 * EVERY chart turn — not a corruption, a false positive in the reconstructor
 * itself. Delegating to `JSON.stringify` for a Date matches exactly how the
 * envelope was serialized in the first place. */
function stableStringify(value: unknown): string {
  if (value instanceof Date) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface ReconstructionReport {
  ok: boolean;
  problems: string[];
}

function checkEnvelopeIntegrity(record: DatasetTurnRecord, problems: string[]): void {
  const envelope = record.envelope;
  if (record.finalText !== envelope.text) {
    problems.push('final_text differs from envelope.text');
  }
  if (record.kind !== envelope.kind) {
    problems.push(`kind '${record.kind}' differs from envelope.kind '${envelope.kind}'`);
  }
  if (record.question !== envelope.question) {
    problems.push('question differs from envelope.question');
  }
  const expectedChartEmitted = envelope.kind === 'chart';
  if (record.chartEmitted !== expectedChartEmitted) {
    problems.push('chart_emitted differs from envelope.kind');
  }
}

function checkChartReconstruction(record: DatasetTurnRecord, dataset: UserDataset, problems: string[]): void {
  const envelope = record.envelope as Extract<DatasetTurnRecord['envelope'], { kind: 'chart' }>;

  if (stableStringify(record.instruction) !== stableStringify(envelope.instruction)) {
    problems.push('stored instruction column differs from envelope.instruction');
  }
  if (envelope.state.datasetId !== dataset.id) {
    problems.push('envelope.state.datasetId differs from the referenced dataset');
  }
  const expectedClient = toClientInstruction(envelope.instruction);
  if (stableStringify(envelope.state.lastInstruction) !== stableStringify(expectedClient)) {
    problems.push("envelope.state.lastInstruction does not re-derive from envelope.instruction via toClientInstruction");
  }

  // The one genuinely deterministic re-derivation this tier owns: the SAME
  // builder (buildUserChartSpec) replayed against the CURRENT dataset row
  // (U12: unchanged since this turn was written) must reproduce the exact
  // stored chart, byte for byte — H1/H2's whole point made mechanical.
  try {
    const rebuilt = buildUserChartSpec(dataset, envelope.instruction);
    if (stableStringify(rebuilt) !== stableStringify(envelope.chart)) {
      problems.push('chart spec does not re-derive from the current dataset + stored instruction');
    }
  } catch (error) {
    problems.push(
      `rebuilding the chart from the current dataset + stored instruction threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function checkClarificationReconstruction(record: DatasetTurnRecord, dataset: UserDataset, problems: string[]): void {
  const envelope = record.envelope as Extract<DatasetTurnRecord['envelope'], { kind: 'clarification' }>;

  if (stableStringify(record.instruction) !== stableStringify(envelope.instruction)) {
    problems.push('stored instruction column differs from envelope.instruction');
  }

  switch (envelope.reason) {
    case 'low_confidence':
      if (envelope.text !== lowConfidenceClarificationText()) {
        problems.push('clarification text does not re-derive from lowConfidenceClarificationText()');
      }
      if (stableStringify(envelope.options) !== stableStringify(suggestionOptions(dataset.profile))) {
        problems.push('clarification options do not re-derive from suggestionOptions(dataset.profile)');
      }
      break;
    case 'validation':
      if (envelope.text !== validationClarificationText()) {
        problems.push('clarification text does not re-derive from validationClarificationText()');
      }
      if (stableStringify(envelope.options) !== stableStringify(suggestionOptions(dataset.profile))) {
        problems.push('clarification options do not re-derive from suggestionOptions(dataset.profile)');
      }
      break;
    case 'zero_rows':
      if (envelope.text !== zeroRowsClarificationText()) {
        problems.push('clarification text does not re-derive from zeroRowsClarificationText()');
      }
      if (envelope.options.length !== 0) {
        problems.push("zero_rows clarification must carry no options (respond.ts always passes [])");
      }
      break;
    case 'ambiguous_format':
      // Not yet produced by respondToDatasetQuestion (D5's disambiguation
      // lives in the ingest/decide-format Server Action, not this tier's
      // per-question turn flow) — no template call to re-derive against
      // here. Structural-only: nothing further to check.
      break;
    default: {
      const exhaustive: never = envelope.reason;
      problems.push(`unknown clarification reason '${String(exhaustive)}'`);
    }
  }
}

function checkRefusalReconstruction(record: DatasetTurnRecord, problems: string[]): void {
  const envelope = record.envelope as Extract<DatasetTurnRecord['envelope'], { kind: 'refusal' }>;
  // Every refusal reason (including 'internal', not yet produced by
  // respondToDatasetQuestion but already a fixed REFUSAL_TEXT entry) maps to
  // exactly one static sentence — no per-reason branching needed.
  if (envelope.text !== refusalText(envelope.reason)) {
    problems.push(`refusal text does not re-derive from refusalText('${envelope.reason}')`);
  }
}

function isRedacted(envelope: DatasetTurnRecord['envelope']): envelope is Extract<DatasetTurnRecord['envelope'], { redacted: true }> {
  return 'redacted' in envelope && envelope.redacted === true;
}

/**
 * Verifies that a NON-redacted record reconstructs its response, from the
 * stored row plus the current dataset row alone (R8 for this tier). Callers
 * must route redacted rows to `redactedTurnIntegrityReport` instead — this
 * function does not itself branch on `isRedacted` (mirroring
 * src/answer/audit/reconstruct.ts's own division of labour with
 * redactionIntegrityReport at the call site, scripts/verify-audit-rows.ts).
 */
export function reconstructDatasetTurn(record: DatasetTurnRecord, dataset: UserDataset): ReconstructionReport {
  const problems: string[] = [];
  checkEnvelopeIntegrity(record, problems);
  const envelope = record.envelope;
  if (envelope.kind === 'chart') {
    checkChartReconstruction(record, dataset, problems);
  } else if (envelope.kind === 'clarification') {
    checkClarificationReconstruction(record, dataset, problems);
  } else {
    checkRefusalReconstruction(record, problems);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * The redacted-row counterpart (mirrors src/answer/audit/retention.ts's
 * `redactionIntegrityReport`): verifies a redacted dataset_turns row matches
 * EXACTLY the shape `redactTurnsForDatasets` (retention.ts) writes — no
 * database read needed, since a redacted row's whole point is that nothing
 * beyond the sentinel survives to check against.
 */
export function redactedTurnIntegrityReport(record: DatasetTurnRecord): ReconstructionReport {
  const problems: string[] = [];
  if (!isRedacted(record.envelope)) {
    problems.push('envelope is not a redacted sentinel');
    return { ok: false, problems };
  }
  if (record.question !== REDACTED_DATASET_TEXT) {
    problems.push('question is not the redaction sentinel');
  }
  if (record.finalText !== REDACTED_DATASET_TEXT) {
    problems.push('final_text is not the redaction sentinel');
  }
  if (record.instruction !== null) {
    problems.push('instruction is not null on a redacted row');
  }
  const expected = redactedDatasetEnvelope(record.kind);
  if (stableStringify(record.envelope) !== stableStringify(expected)) {
    problems.push('envelope does not match redactedDatasetEnvelope(kind) exactly');
  }
  return { ok: problems.length === 0, problems };
}
