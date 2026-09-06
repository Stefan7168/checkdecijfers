# Session 85 kickoff — paste this as the first message

Written at the session-84 close-out, 2026-09-06 (~23:2xZ). Durable copy of the handoff; the chat may be gone,
the repo is the source of truth. Every fact below was verified against `git log`, `gh run view --json jobs`,
`git status`, `git worktree list`, and `npm run test:docs` at the time of writing — not recalled from memory.

Read in this order before doing anything: `CLAUDE.md` → `docs/STATUS.md` (the top block is the truth) → this
file → `docs/status-archive.md` (session-84 entry, top — by far the longest entry, covers the whole feature
build) → `docs/lessons-learned.md` (session-84 entry, top, 5 lessons) → `docs/08-build-plan.md`'s WP202a
section (the exact remaining-work list for the feature this session built).

**Verify yourself first:** `date +%Y-%m-%d`, `git log -5 --oneline` (expect `22618d3` at the tip — a
`docs(wrap): session-84 close-out` commit, with `fd3df3b` right below it — the last WP202a build slice), `gh
run list --branch main -L 3 --json databaseId,status,conclusion` (expect `gate` green on every recent commit;
`deploy` shows `failure` — the KNOWN, still-unfixed Route B Vercel-secrets gap, [#132](../open-questions.md),
confirm via `gh run view <id> --json jobs`, never the top-level conclusion), `git worktree list` (expect ONLY
the main checkout), `git status --short` (expect clean). Second-instance check: `ListAgents` /
`mcp__ccd_session_mgmt__list_sessions` — a parallel "Rebrand to 'Your data visualized'" session was active
during session 84 and may or may not still be running.

State after session 84 (2026-09-06, owner present throughout — the longest session to date):

1. **"Chat with your data" (#201/#202) is designed, decided, adversarially reviewed, promoted to an accepted
   ADR, and its entire backend is built — but NOT live.** [docs/decisions/037-user-data-attachments.md](../decisions/037-user-data-attachments.md)
   (ADR 037, ACCEPTED) is the source of truth for the design; [session-briefs/2026-09-06-chat-with-data-design.md](2026-09-06-chat-with-data-design.md)
   is its frozen planning input (now marked superseded/historical at the top, not itself current). The two
   owner hard constraints held throughout every review pass: **H1** (the LLM only ever emits a structured,
   closed-vocabulary-validated `ChartInstruction`; deterministic code alone renders a chart) and **H2** (a
   user-data chart must be structurally impossible to confuse with an official CBS chart — its own trust
   tier, mirroring ADR 032's websearch separation).
2. **The backend (`src/attachments/`, 14 source files + migrations 026/027 + billing ledger additions) was
   built across 5 separately-verified, separately-`/code-review`'d slices, each pushed as its own commit —
   every slice's review found and fixed a genuinely real bug, not a nitpick:**
   - Core engine (`1e090c3`) — types/limits/CSV-ingest/number-format-detection/profiling/the closed-vocabulary
     validator/`execute.ts`+`chart.ts`.
   - DB/audit/GDPR (`01840ee`) — `store.ts`/`file-store.ts` (bytea, PGlite-verified)/`audit.ts` (a
     delete-vs-write race fix)/`retention.ts` (2yr/90d purge, deliberately its OWN transaction, not folded
     into the CBS-side retention.ts — see ADR 037 §8 D9 for why).
   - Billing (`ce5dd5f`) — `debitDataset`/`reserveDatasetDebit`/`chargeAndRunDataset`. 0 review findings (a
     close mirror of the already-proven websearch-cost pattern).
   - LLM harness (`d60edb7`) — `instruct/prompt.ts`+`parse.ts`, Haiku, temp 0, mirrors `catalog/rerank.ts`.
   - Turn orchestration (`fd3df3b`) — `respond.ts` (the full turn flow) + `templates.ts` (every reply string,
     zero LLM prose reaching the client).
3. **Remaining before this can go live** (full detail in `docs/08-build-plan.md`'s WP202a section — read that,
   not this summary, before starting): `reconstructDatasetTurn` for history replay, Server Actions
   (`web/app/dataset-actions.ts`), the `DatasetChat`/`UserChartView` UI components, an `ATTACHMENTS_ENABLED`
   feature flag, then **owner-supervised** migration apply (026/027 are FILE-ONLY today — never run against
   any real database) before any real go-live. This is very likely where session 85 picks up, but confirm
   with the owner rather than assuming — no explicit "start the UI slice next" instruction was given.
4. **✅ #206 — product copy / UI text is now ENGLISH** (owner override, in-chat, "override, we are english
   now"). Applied to `CLAUDE.md`, `docs/03-mvp-scope.md`, `docs/12-huisstijl.md`, and retroactively to ADR
   037's own already-decided Dutch copy. Scope as understood (inferred, not owner-itemized): new
   UI/product-copy surfaces going forward. **Does NOT touch:** the CBS chat/answer pipeline's own Dutch-
   language output (intent parsing, phrasing, validated answer text) or the benchmark's Dutch task phrasing —
   neither was part of this decision. If you're about to write ANY new UI-facing string, it's English; if
   you're about to touch the answer-composition/validator/benchmark pipeline, it's still Dutch. When in
   doubt which bucket a string falls in, ask rather than guess.
5. **A parallel "Rebrand to 'Your data visualized'" session ran concurrently** (different task — positioning/
   branding, not a duplicate build brief). It logged its own decisions (tagline, [#207](../open-questions.md)
   CBS-scoped trust claim) and flagged [#208](../open-questions.md) (an example-graph/storytelling gallery
   the owner built under a different account, not found on production, no URL given) as needing the owner
   directly — unresolved, not something session 85 should try to track down. Check whether that session is
   still running (`list_sessions`) before assuming its state.
6. **A migration near-miss worth knowing before writing any future migration that widens a DB function:**
   migration 027 initially copied a validator function body from the migration that FIRST created it,
   silently dropping a LATER migration's security guard (the #147 over-credit check). Caught by 3 failing
   tests before commit, fixed, and migration 027 itself now carries a warning comment. If you ever
   `CREATE OR REPLACE` a function/trigger this repo already defined elsewhere: `grep -rl` every migration
   touching it and diff against the LATEST version, never the first one you find.

▶ NEXT, in order (per `docs/08-build-plan.md`'s priority stack — confirm with the owner before assuming):

1. **Ask the owner** whether to continue WP202a into its UI slice (Server Actions + `DatasetChat`/
   `UserChartView` + the feature flag) now, or whether something else takes priority — no explicit
   instruction was given for what comes after the backend.
2. If continuing WP202a: `reconstructDatasetTurn` first (history replay needs it before the UI can show past
   turns), then the Server Actions, then the UI components, then the flag — in that order, each with its own
   verification + `/code-review` LOW pass, same discipline as the 5 backend slices.
3. The 3 `gh secret set` commands for Route B (owner's own terminal, blocking only `deploy`) — pending across
   many sessions now, still not done, still low urgency.
4. WP30c + #197's three older follow-ups — owner-menu, no rush, untouched this session.

Binding frames, unchanged: principles (a)/(b)/(c); H1/H2 for the attachments feature specifically; no
prompt-byte changes to the CBS pipeline without owner sign-off; no live DDL without the owner (migrations
026/027 apply is explicitly owner-supervised per point 3 above); no fixture re-recording without explicit
authorization. 8 GB machine: run the verification block solo, read the real exit code, don't trust a log
without a summary line ([[feedback_verify_exit_codes]] in memory — its session-84 addendum also covers a
resource-contention timeout false-alarm, not just the OOM-137 case). `npm run test:docs` before every docs
push; `/code-review` LOW before every code push (docs-only pushes exempt). Owner-present sessions push/merge
directly, no per-change approval needed (#118 revision).

Session-end: the full wrap-up ritual ran in this session per `CLAUDE.md`'s "Session wrap-up" section —
lessons, memory (2 new files + 2 appended existing files + the MEMORY.md index), the full doc set (STATUS,
status-archive, open-questions, 08-build-plan, 04-architecture — RUNBOOK and both READMEs checked and
correctly left untouched, nothing live yet to document there), a stale-doc sweep (found and fixed genuinely
stale "ADR-DRAFT, nothing built" framing in three places), clean-state verification, this kickoff doc, and a
final self-audit. A future session's own wrap-up should still run the complete ritual per CLAUDE.md, not
assume this one covers it.
