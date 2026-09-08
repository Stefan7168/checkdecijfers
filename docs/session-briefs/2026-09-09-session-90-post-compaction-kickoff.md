# Session 90 → continuation kickoff — paste this after `/compact` (or as the first message of session 91)

Written at the session-90 documentation pass, 2026-09-09, with the owner present. Every fact below was
verified against `git log`, `gh run view`, `curl` of production and `git status` at the time of writing —
not recalled. Read in this order before doing anything: `CLAUDE.md` → `docs/STATUS.md` (top block is the
truth) → this file → `docs/status-archive.md` (session-90 entry, top, 8 items) → `docs/lessons-learned.md`
(session-90 entries, top) → `docs/open-questions.md` rows #218 / #219 / #220 → `docs/08-build-plan.md`
§ WP218.

## What is true right now (verified 2026-09-09)

- `main` HEAD is `4ab390d` (the session-90 docs commit) on top of three session-90 code/docs commits
  `6e2a66b` (composer layout + "Link with sheet" chip), `2880b57` (sidebar ⋯ delete + plus icon +
  `scripts/dev-web.mjs`), `e6a7ede` (#218 panel docs), all on `813a0f4`. Working tree clean, single
  worktree. CI: run `34261331269` gate green (deploy skipped by design because main had moved on),
  run `34262171903` gate green + deploy green. Production `/api/health` `{"ok":true}` (7 checks).
- Verification that DID run before the push: typecheck ×2, web 784/784, backend 2093/2093, hermetic
  benchmark 14/14 + 6/6 + 0 fabricated, real `next build`, `/code-review` LOW with 0 findings.
- The shipped UI was verified on production in the owner's logged-in Chrome, light and dark (chip row
  above the input, pricing line under it, "Link with sheet" chip, plus icon, ⋯ → "Delete chat" menu).
  A logged-in LOCAL check is impossible as configured — RUNBOOK § "Running the web app locally WITH the
  real database" explains why and the two owner-side ways to fix it.

## The single next priority — owner-chosen

**WP218, the chart styling programme** (`docs/08-build-plan.md` § WP218; source: the session-90
architecture panel synthesis, artifact https://claude.ai/code/artifact/5a971401-ce68-40d5-ad28-1a74f2246c39
and `docs/session-briefs/2026-09-09-session-90-chart-config-tool-synthesis.md`, plus the owner's answers
A–H on `docs/open-questions.md` #218). **Two things are still OPEN and must come from the owner before
any code:** (1) his explicit "go"; (2) the phase order — cheapest-first is proposed (1 panel → 2 account
save → 3 Brandfetch → 4 EN/NL switch → 5 chart types → 6 counter), he was asked whether the language
switch should come before phases 2–3 and had not answered. Ask both in **plain English** (standing rule
since this session — see `feedback_plain_english_no_jargon` in memory: full sentences, no invariant
codes, no file names, no shorthand; the ask module with a recommended first option works well for 2–4
decisions).

Once he says go: phase 0/1 via `superpowers:writing-plans` → `subagent-driven-development`, an ADR 039,
a final whole-branch review, the full verification block, owner-present direct push. Invariants that
hold in every phase are listed at the top of the WP218 section. B (colour picker + Brandfetch) and C
(database persistence) knowingly override the owner's own 2026-09-08 cheapest-first rule — already named
to him and accepted; don't re-litigate, just keep the free phases first.

## Also pending (not this session's focus)

- WP202a go-live steps 2–6 (RUNBOOK § WP202) — still the most valuable ready-but-idle thing; owner-supervised.
- #216 (B20 benchmark recalibration), #217 (model-independence / slot phrasing), #172, #214 (mobile
  header), #215 (PDF / transparent PNG export) — tracked, untouched.
- The small-multiples R11 gap the panel found (`chart-small-multiples.tsx` draws `dot={false}`, so a
  provisional point has no hollow marker there) — fix inside WP218 phase 0, or as a standalone small.

## Reminders

- Git workflow (#118): owner present → direct push to `main` after the full verification block; autonomous
  → branch + PR. Live DDL, outside-service keys (Brandfetch), env flags and real spend stay owner-supervised.
- The backend suite takes ~34 minutes on this machine when anything else runs; stop the dev server, run it
  solo, expect it to be backgrounded past 600 s.
- Every model constant is Haiku; a tier change is a real decision (see the session-89 lessons), not a config edit.
