// Public surface of the WP15 conversation-context module (ADR 021).
// NOTE (WP13 lesson, lessons-learned 2026-07-04): keep CLI-/ops-only code out
// of this barrel — web/ imports it, and Turbopack statically walks every
// re-export.
export { buildConversationContext, contextPeriodFor } from './build.ts';
export { validateConversationContext } from './validate.ts';
export type { ContextPeriod, ConversationContext } from './types.ts';
export { CONTEXT_VERSION } from './types.ts';
