-- 009 — conversation_context on audit_answers (WP15, ADR 021, open-questions
-- #57): the validated ConversationContext OFFERED to a follow-up turn's parse
-- — an input capture, exactly like reply_text/pending_clarification capture
-- the clarify-reply round's inputs (ADR 015/016 wrap-site obligations). Null
-- on standalone turns and on all pre-WP15 rows.
alter table audit_answers
  add column conversation_context jsonb;

-- A context is offered only on QUESTION turns: a clarification reply merges
-- with the pending intent and never also takes a context (one merge candidate
-- per parse — ADR 021 decision 1). Mirrored in the reconstruction check.
alter table audit_answers
  add constraint context_never_on_reply_rows
  check (conversation_context is null or reply_text is null);
