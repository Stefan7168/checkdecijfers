// R8's teeth: does a stored audit record RECONSTRUCT the response it claims
// to record? Everything here re-derives from the STORED record alone — no
// database, no live pipeline objects — because that is the record's whole
// purpose: benchmark scoring now, answer pages and the user-facing audit
// trail later (docs/04) must be able to trust the row without the process
// that wrote it.
//
// What "reconstructs" means (docs/05 R8, made mechanical):
//  1. Envelope integrity — the promoted columns match the stored envelope
//     (a divergent copy means the row lies about itself).
//  2. Answers — the stored body re-passes the full R3/R9/R10/R11 validator
//     against the stored result (every numeric token maps to stored result
//     IDs / derivations — R1's scan, run from the record); the attribution
//     line re-derives byte-identically from the stored attribution fields
//     (R4 positional, not pattern-based); the structural lines and the final
//     text re-assemble byte-identically; the chart spec re-derives from the
//     stored result via the same deterministic builder (R6 + R8: the chart
//     the user saw is exactly what the stored result produces).
//  3. Refusals/clarifications — envelope-consistency checks; their
//     no-unbacked-numbers guarantee is structural + belt-checked by the WP9
//     suites at produce time, and the benchmark scorer re-scans refusal texts
//     against run-time whitelists.
import { DERIVED_DATA_MARKING } from '../../query/index.ts';
import type { ValidatedResult } from '../../query/index.ts';
import { buildChartSpec, chartSpecSchema } from '../../chart/index.ts';
import { buildAttributionLine } from '../compose/format.ts';
import { validateAnswerBody } from '../compose/validate.ts';
import { stableStringify } from '../llm/client.ts';
import { ANSWER_SCHEMA_VERSION } from '../compose/types.ts';
import { RESPONSE_SCHEMA_VERSION } from '../respond/types.ts';
import type { AnswerResponse } from '../respond/types.ts';
import type { AuditRecord } from './types.ts';
import { AUDIT_SCHEMA_VERSION } from './types.ts';
import { intentHash, resolvedIntent } from './write.ts';

export interface ReconstructionReport {
  ok: boolean;
  problems: string[];
}

function checkEnvelopeIntegrity(record: AuditRecord, problems: string[]): void {
  const response = record.response;
  // Version pinning: this reconstructor is built for exactly these schema
  // versions; records live forever and readers dispatch on the tag (ADR 007/
  // 016), so a mismatched tag must be a loud failure, never a silent
  // misinterpretation (adversarial-review finding, 2026-07-03).
  if (record.schemaVersion !== AUDIT_SCHEMA_VERSION) {
    problems.push(
      `record schema_version ${record.schemaVersion} is not the v${AUDIT_SCHEMA_VERSION} this reconstructor handles`,
    );
  }
  if (response.schemaVersion !== RESPONSE_SCHEMA_VERSION) {
    problems.push(
      `envelope schemaVersion ${response.schemaVersion} is not the v${RESPONSE_SCHEMA_VERSION} this reconstructor handles`,
    );
  }
  if (response.kind === 'answer' && response.answer.schemaVersion !== ANSWER_SCHEMA_VERSION) {
    problems.push(
      `answer schemaVersion ${response.answer.schemaVersion} is not the v${ANSWER_SCHEMA_VERSION} this reconstructor handles`,
    );
  }
  if (record.finalText !== response.text) {
    problems.push('final_text differs from response.text');
  }
  if (record.kind !== response.kind) {
    problems.push(`kind '${record.kind}' differs from response.kind '${response.kind}'`);
  }
  if (record.question !== response.question) {
    problems.push('question differs from response.question');
  }
  const intent = resolvedIntent(response);
  if (stableStringify(record.intent) !== stableStringify(intent)) {
    problems.push('stored intent differs from the envelope-resolved intent');
  }
  const expectedHash = intent === null ? null : intentHash(intent);
  if (record.intentHash !== expectedHash) {
    problems.push('intent_hash does not recompute from the stored intent');
  }
  const expectedReason = response.kind === 'refusal' ? response.reason : null;
  if (record.refusalReason !== expectedReason) {
    problems.push('refusal_reason differs from the envelope');
  }
  // WP16 sub-part 2 (ADR 026): the onboarding envelope field is present-only
  // on the 'onboarding_pending' reason — it carries the CBS table the fetch
  // was triggered for. A row whose reason says a fetch started but whose
  // envelope has no target (or vice versa) is internally inconsistent and
  // must not reconstruct. No FK / no data value, so this is a shape check
  // (like the reply_text/pending pairing above), not a numeric one. Only
  // refusal envelopes carry the field at all (the type system forbids it
  // elsewhere), so answers/clarifications need no check here.
  if (response.kind === 'refusal') {
    const shouldHaveOnboarding = response.reason === 'onboarding_pending';
    if (shouldHaveOnboarding !== (response.onboarding !== null)) {
      problems.push(
        `onboarding envelope field ${response.onboarding !== null ? 'present' : 'absent'} does not match reason '${response.reason}'`,
      );
    }
  }
  const expectedResultIds =
    response.kind === 'answer' ? response.result.cells.map((c) => c.resultId) : [];
  if (stableStringify(record.resultIds) !== stableStringify(expectedResultIds)) {
    problems.push('result_ids differ from the stored result cells');
  }
  const expectedSource = response.kind === 'answer' ? response.answer.source : null;
  if (record.answerSource !== expectedSource) {
    problems.push('answer_source differs from the envelope');
  }
  const expectedChart = response.kind === 'answer' && response.chart !== null;
  if (record.chartEmitted !== expectedChart) {
    problems.push('chart_emitted differs from the envelope');
  }
  if (response.kind === 'answer') {
    const a = response.result.attribution;
    const expectedTables = [{ tableId: a.tableId, tableVersion: a.tableVersion, syncedAt: a.syncedAt }];
    if (stableStringify(record.tables) !== stableStringify(expectedTables)) {
      problems.push('tables differ from the stored attribution');
    }
    if (stableStringify(record.tableIds) !== stableStringify([a.tableId])) {
      problems.push('table_ids differ from the stored attribution');
    }
  } else if (record.tables.length > 0 || record.tableIds.length > 0) {
    problems.push('non-answer row carries table references');
  }
  if ((record.replyText === null) !== (record.pendingClarification === null)) {
    problems.push('reply_text and pending_clarification must be set together');
  }
  // WP15 (ADR 021): a context is offered only on question turns — a reply
  // merge never also takes one (one merge candidate per parse).
  if (record.conversationContext !== null && record.replyText !== null) {
    problems.push('conversation_context must be null on clarification-reply rows');
  }
}

function checkAnswerReconstruction(record: AuditRecord, problems: string[]): void {
  const response = record.response as AnswerResponse;
  const result = response.result as ValidatedResult;
  const answer = response.answer;

  // R1/R3/R9/R10/R11 from the record: the stored body against the stored
  // result. The validator is deterministic, so a body that passed at compose
  // time passes again — unless the stored result no longer backs it.
  const validation = validateAnswerBody(answer.body, result);
  if (!validation.ok) {
    problems.push(
      ...validation.problems.map((p) => `stored body fails re-validation against stored result: ${p}`),
    );
  }

  // R4, positional: the attribution line must re-derive byte-identically from
  // the stored attribution fields.
  const attribution = buildAttributionLine(result);
  if (answer.attributionLine !== attribution) {
    problems.push('attribution line does not re-derive from the stored attribution');
  }

  // Structural lines re-derive from stored fields (same rules as compose.ts).
  const definitionLine =
    result.attribution.definitionLabel === null
      ? null
      : `Definitie: ${result.attribution.definitionLabel}.`;
  if (answer.definitionLine !== definitionLine) {
    problems.push('definition line does not re-derive from the stored attribution');
  }
  const markingLine = result.derivations.length > 0 ? `— ${DERIVED_DATA_MARKING}` : null;
  if (answer.markingLine !== markingLine) {
    problems.push('derived-data marking line does not re-derive from the stored derivations');
  }

  // The rendered text re-assembles byte-identically from its stored parts.
  const text = [
    answer.body,
    '',
    ...(definitionLine ? [definitionLine] : []),
    ...(markingLine ? [markingLine] : []),
    attribution,
  ].join('\n');
  if (answer.text !== text) {
    problems.push('answer text does not re-assemble from its stored parts');
  }
  const finalText =
    response.stalenessWarning === null ? answer.text : `${answer.text}\n\n${response.stalenessWarning}`;
  if (response.text !== finalText) {
    problems.push('response text does not re-assemble from answer text + staleness warning');
  }

  // R6+R8: the chart the user saw is exactly what the stored result produces
  // through the same deterministic builder — and it still validates.
  const rederived = buildChartSpec(result);
  if (stableStringify(response.chart) !== stableStringify(rederived)) {
    problems.push('chart spec does not re-derive from the stored result');
  }
  if (response.chart !== null) {
    const parsed = chartSpecSchema.safeParse(response.chart);
    if (!parsed.success) {
      problems.push(`stored chart spec fails schema validation: ${parsed.error.message}`);
    }
  }
}

/** Verifies that the record reconstructs its response, from the stored row
 * alone. Empty problems = R8 holds for this record. */
export function reconstructionReport(record: AuditRecord): ReconstructionReport {
  const problems: string[] = [];
  checkEnvelopeIntegrity(record, problems);
  if (record.response.kind === 'answer') {
    checkAnswerReconstruction(record, problems);
  }
  return { ok: problems.length === 0, problems };
}
