-- 010 — request_id on audit_answers (user dashboard: question history +
-- per-answer cost). The billing gate's idempotency key
-- (credit_transactions.request_id, uuid) is already known to the wrap site
-- when it calls answerQuestionAudited/answerClarificationReplyAudited but was
-- never stored on the audit row -- so a past question's net cost (its debit
-- minus any refund) could not be reconstructed. credit_transactions.audit_answer_id
-- is deliberately set only on compensation rows (migration 005 comment: the
-- debit necessarily precedes the audit row's existence), so the link has to
-- come from this side instead. Null on all pre-existing rows and on any row
-- whose wrap site doesn't pass one (there is none today, but nothing requires it).
alter table audit_answers
  add column request_id uuid;

-- The history query's real access pattern (a user's own rows, most recent
-- first, id as the tie-breaker on an equal timestamp) -- the existing
-- audit_answers_by_created_at index isn't user-scoped.
create index audit_answers_by_user_created
  on audit_answers (user_id, created_at desc, id desc);
