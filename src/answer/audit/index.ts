// WP10 audit records (R8) — public surface. The audited entry points are what
// the outside world calls from here on: the chat-UI session and the benchmark
// runner both go through answerQuestionAudited / answerClarificationReplyAudited,
// never the bare WP9 functions (which stay exported for tests and internals).
export { AUDIT_SCHEMA_VERSION } from './types.ts';
export type { AuditRecord, LlmCallRecord, PromptVersions, TableRef } from './types.ts';
export {
  buildAuditRow,
  insertAuditRecord,
  intentHash,
  resolvedIntent,
  currentPromptVersions,
} from './write.ts';
export type { AuditContext, AuditRow } from './write.ts';
export { loadAuditRecord, loadAllAuditRecords } from './read.ts';
export { reconstructionReport } from './reconstruct.ts';
export type { ReconstructionReport } from './reconstruct.ts';
export { answerQuestionAudited, answerClarificationReplyAudited } from './respond-audited.ts';
export type { AuditedRespondOptions, AuditedResponse } from './respond-audited.ts';
export { LlmCallTracker } from './track.ts';
export {
  REDACTED_QUESTION_TEXT,
  deleteUserQuestionHistory,
  purgeExpiredQuestionHistory,
  twoYearsBefore,
} from './retention.ts';
export type { RedactedRow } from './retention.ts';
