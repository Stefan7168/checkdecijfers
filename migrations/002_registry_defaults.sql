-- 002 — registry work package: canonical measures (the alias list).
-- cbs_tables.default_coordinates and .period_semantics already exist (migration
-- 001); this migration only adds the alias-list table. Both are populated by
-- src/registry/apply.ts, not by this file (data lives in code, per CLAUDE.md's
-- "express tiers/config in code, not hardcoded in SQL" spirit and to keep one
-- reviewable diff when a default changes).

-- Everyday-term -> canonical CBS reading. Distinct from cbs_tables.default_coordinates:
-- that column pins *incidental* "totaal" dimensions every question shares regardless
-- of intent (e.g. population's Geslacht/Leeftijd totaal). This table pins the
-- dimension choice that *is* the semantic content of an everyday term (e.g.
-- "werkloosheid" -> seasonally-adjusted; "faillissementen" -> businesses-only) —
-- invariant R7's "registry-internal variant choice", stated transparently via
-- definition_label, never a hidden guess (docs/05-data-rules.md, canonical defaults).
create table canonical_measures (
  -- stable concept key the (future) intent parser's schema-validated output
  -- selects from — not a raw Dutch string match; everyday_terms below is
  -- documentation/intent-parser-prompt input, not a lookup key
  key text primary key,
  table_id text not null references cbs_tables(id),
  measure text not null,
  measure_title text not null,
  -- semantic (non-totaal) dimension coordinates that define this concept,
  -- e.g. {"SeizoenEnWerkdagcorrectie": "A050903"}; {} when the table has none
  dims jsonb not null default '{}',
  -- Dutch phrase always shown when this default is used, so the choice is
  -- transparent per the canonical-default policy, never a silent guess
  definition_label text not null,
  -- Dutch words/phrases a question might use; reference for prompt-engineering
  -- the intent parser (a later work package), not string-matched by this table
  everyday_terms text[] not null,
  -- other CBS readings of the same everyday term, kept visible rather than
  -- discarded — mirrors benchmark/answer-key.json's assumption/alternates shape
  alternates jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
