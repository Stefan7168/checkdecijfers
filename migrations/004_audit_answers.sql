-- 004 — audit_answers: one row per produced response (R8; docs/05 audit-trail
-- design; ADR 016). Written by the WP10 wrap layer (src/answer/audit/) BEFORE
-- any response is shown (ADR 004: answers are non-streaming precisely so this
-- write can precede display). These records live forever: they are the
-- benchmark scorer's input now, and the seam for shareable answer pages, the
-- user-facing audit trail and drill-down buttons later (docs/04).
--
-- Design (ADR 016): the FULL ComposedResponse envelope is stored verbatim in
-- `response` — it already carries the parse outcome, validated result (result
-- IDs, values, derivations), composed answer and chart spec, all
-- schema-versioned. Scalar columns are PROMOTED copies for querying/reporting
-- only; the envelope is the authoritative snapshot, and the reconstruction
-- check (R8 test) asserts the promoted copies match it.
create table audit_answers (
  id bigint generated always as identity primary key,
  -- version of THIS record layout (the envelope inside carries its own
  -- schema_version field, as do the answer and chart spec — ADR 007)
  schema_version integer not null,
  created_at timestamptz not null default now(),
  -- identity seam (ADR 006): null = anonymous / Phase 0 benchmark runs.
  -- No FK until an auth provider exists (Phase 1).
  user_id text,

  -- what the user asked. Question text is stored HERE and only here
  -- (docs/04 GDPR seam: one enforcement point for retention).
  kind text not null check (kind in ('answer', 'clarification', 'refusal')),
  question text not null,
  -- the injected reference date the parse ran against (never the wall clock)
  reference_date date not null,

  -- clarification-reply round (ADR 015 wrap-site obligations): the user's
  -- free-text reply and the PendingClarification it answered. Both null on
  -- first-turn rows, both set on reply-turn rows.
  reply_text text,
  pending_clarification jsonb,
  constraint reply_round_complete check ((reply_text is null) = (pending_clarification is null)),

  -- the authoritative snapshot: the ComposedResponse envelope, verbatim
  response jsonb not null,
  -- the exact rendered text the user saw (= response.text, promoted; the R8
  -- reconstruction test asserts equality)
  final_text text not null,

  -- promoted query-plan / traceability fields. The stored intent IS the query
  -- plan: the query layer is deterministic, so plan = f(intent, registry@
  -- table_version) — re-entering the pipeline at the query step with this
  -- intent reproduces the same cells (the drill-down seam, docs/04).
  intent jsonb,
  -- sha256 (32 hex chars) over the canonicalized intent — the repeat-question
  -- measurement source for the caching/spend triggers (docs/06-roadmap.md)
  intent_hash text,
  refusal_reason text,
  result_ids text[] not null default '{}',
  table_ids text[] not null default '{}',
  -- [{tableId, tableVersion, syncedAt}] per docs/05 "table IDs + versions +
  -- sync dates"
  tables jsonb not null default '[]',
  -- 'llm' | 'llm_retry' | 'template' for answers (docs/02 reports the
  -- template-fallback count); null for non-answers
  answer_source text check (answer_source in ('llm', 'llm_retry', 'template')),
  chart_emitted boolean not null default false,

  -- docs/05: "model IDs and prompt versions used". prompt_versions records
  -- the three exported constants in force ({intent, clarify, compose});
  -- llm_calls records what actually ran: [{role, model, inputTokens,
  -- outputTokens}] — one entry per LLM call, empty for pure template paths.
  prompt_versions jsonb not null,
  llm_calls jsonb not null default '[]',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  latency_ms integer not null
);

-- The caching/spend measurement path (docs/06): how often the same resolved
-- intent recurs.
create index audit_answers_by_intent_hash
  on audit_answers (intent_hash) where intent_hash is not null;

-- Reporting/retention path: records over time.
create index audit_answers_by_created_at on audit_answers (created_at);
