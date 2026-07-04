-- 007 — audit_answers.source_tag (WP13, open-questions #44): distinguishes
-- scripted benchmark runs, the owner's manual validation passes, and real
-- end-user traffic once accounts exist (WP13) -- without this, nothing in
-- reporting/retention tooling can tell them apart once real users arrive.
alter table audit_answers
  add column source_tag text not null default 'user'
    check (source_tag in ('benchmark', 'validation', 'user'));

-- Backfill rows 1-76, grounded in a live, read-only listing of the table
-- (id/created_at/kind/question), cross-referenced against docs/STATUS.md's
-- own measured claims -- not guessed from prose alone:
--   1-24   the WP11 scripted benchmark run (2026-07-03 21:12-21:14 Indochina
--          time) -- matches STATUS.md's "wrote 24 real audit_answers rows
--          (ids 1-24)" exactly.
--   25-35  WP12's manual smoke-testing against the live deployment
--          (2026-07-04 02:16-05:13) -- repeated near-identical golden-path /
--          chart / clarify / refusal questions, matching STATUS.md's WP12
--          entry ("measured live, against the production deployment", plus
--          its same-day honesty correction re-measuring clarification and
--          refusal against the deployment). Not the formal validation pass
--          and not real user traffic (no accounts existed yet) -- closer in
--          kind to 'validation' (a human exercising the live app to check
--          behavior against expectations), so tagged as such rather than
--          invented as a fourth bucket.
--   36-73  the 38-question owner validation pass -- timestamps read
--          2026-07-04 06:48-06:50 despite the memo labelling it 2026-07-05
--          (the +1-day slip recorded in lessons-learned); 73-36+1 = 38 rows,
--          exactly matching "38 questions".
--   74-76  WP14's live spot-check, explicitly "validation-flavored" per the
--          WP13 brief (docs/08-build-plan.md).
-- No existing row is real end-user traffic: Phase 1 accounts don't exist
-- until this WP ships, so 'user' correctly applies to nothing retroactively.
update audit_answers set source_tag = 'benchmark' where id between 1 and 24;
update audit_answers set source_tag = 'validation' where id between 25 and 76;
