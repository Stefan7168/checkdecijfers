# Session 124 kickoff — checkdecijfers.nl / graphmaker.studio

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it,
including this file). Verify everything below against `git log`/the branch/the ledger before trusting it
— this file is a snapshot written 2026-09-23, session 123, not a live source.

## The short version

`main` is **unchanged** at `c14aaf61` (session 122's own close, plus this session's own docs commit on
top). Session 123 built a real, substantial feature on a separate branch,
`worktree-own-data-chart-parity` @ `d925a911`, **not pushed to `origin`** (local-only, unlike prior
sessions' branches). The final whole-branch review said **"ready to merge, with fixes"** — four Important
findings, all on the presentation side of an already-correct computation, all with concrete fixes the
reviewer already wrote out. This session's mandated first step is applying them, not starting something
new — same shape as session 121→122's own handoff.

## Why this session exists mid-branch

The owner asked session 123 to pick up genuine architectural work from three candidates surveyed in
[open-questions #306](../open-questions.md) — the owner chose own-data phase 5/5b parity. The design for
the harder half (verified-whole pie/stacked charts, since own-data has no registry to check a "whole"
against) was sent back TWICE by the owner before approval ("I'm sure you can do better than that", then "I
want you to be proud of your decision") — the approved design lets the reader click a point to designate
their own total, running real arithmetic verification instead of either declining the feature or building
a fake-looking unconditional version. All 5 build tasks completed and passed their own task review (Task 4
needed one fix round for 3 real adversarial-execution findings, closed clean). The FINAL whole-branch
review — the first pass that looked at the whole feature's lifecycle end to end, not one task's diff —
found four more issues. The owner's wrap-up signal arrived right as that review landed, so the session
stopped there deliberately rather than rush a fix-and-merge cycle in the closing minutes — see
[[project_session123_state]] and `docs/lessons-learned.md` session 123 for the full account.

## Resume mechanics — read the ledger, don't re-derive the plan

1. Confirm the worktree still exists: `git worktree list` from the main checkout. If it's there, `cd` into
   it (or use `EnterWorktree` with `path:` pointing at it) — do NOT create a fresh worktree.
2. If the worktree is gone, the branch is **local-only** (never pushed to `origin` this session) — check
   `git branch -a` for `worktree-own-data-chart-parity` locally; if it's genuinely gone, treat this as a
   real incident (lost, unpushed work), not a routine recreate — stop and tell the owner before doing
   anything else.
3. Read the branch's own SDD ledger FIRST, before anything else:
   `.claude/worktrees/own-data-chart-parity/.superpowers/sdd/2026-09-22-own-data-chart-fit-verified-whole-parity/progress.md`
   (git-ignored, on-disk only — it has every task dispatch, every review, every ruling, every fix round
   made this session, in far more detail than this brief carries). The plan it executed is at
   `docs/superpowers/plans/2026-09-22-own-data-chart-fit-verified-whole-parity.md` (committed, on the
   branch, amended twice mid-build — read the CURRENT text, not an earlier version from memory).
4. The final review's full text is in the ledger too — but the fix wave itself is short enough to restate
   here in full, since it's the actual next action:

## The fix wave (final reviewer's own recommendations)

1. **I1 — a re-designation can paint a stale "Checked" claim for one frame.** `wholeVerification` state is
   cleared only inside a `useEffect`, not derived at render from what produced it. Fix (the reviewer's own
   suggestion, verify against the real code before applying verbatim): store the outcome keyed to what
   produced it — `{ rowRef: string; partsKey: string; outcome: VerifyOutcome } | null` — and gate at
   render: treat it as `null` unless `wholeVerification.rowRef === state.wholeReferenceRowRef` AND
   `partsKey` matches the current parts list. The effect's existing clear-then-fetch becomes belt-and-
   braces rather than the only guard. Add a regression test for the A→B re-designation transition
   specifically (no existing test covers it — every existing one designates once or re-clicks the SAME
   slice, the clear-to-null path, which is structurally safe already).
2. **I2 — the designated cell is still drawn as one of the parts of its own claimed total, with no visual
   or ARIA marker.** Reviewer's recommendation (their preferred option, also closes I3 and half of the
   parked Task-4 M2 finding): mark the designated slice/segment distinctly — a stroke plus
   `aria-pressed={resultId === wholeReferenceRowRef}` and an updated accessible name (e.g. "X, designated as
   the total") once designated. Two other options exist (drop the designated row from the drawn parts
   while designated; or extend the note copy to say the designated row is still drawn) — the reviewer's
   marker option is the cheapest and highest-value, but this is the owner's call if there's time to ask;
   otherwise proceed with the marker.
3. **I3 — the note's `{label}` degrades to an ambiguous shared string on a derived/aggregate own-data
   chart** (every series shares one label whenever `derived`/`aggregate` is set alongside `seriesBy` — a
   pre-existing, chart-wide property, not introduced this session). The I2 marker resolves this without
   touching the label pipeline — do NOT attempt the deeper fix (keeping the per-series name alongside the
   derived label) in this fix wave; that ripples into fixtures and is separate work. If the I2 marker is
   built, this finding needs no separate code change — just confirm the marker genuinely disambiguates it
   for the branch's own e2e fixture (Amsterdam/Rotterdam both labelled "Omzet − Kosten").
4. **I4 — the designation click stays clickable-but-dead when there's no edit context.** Fix: pass
   `onPointClick` to `UserPieSlice`/`UserStackSegment` only when `datasetId !== undefined && state.instruction
   !== null` — mirrors the exact gate this same file already applies to the difference/average controls for
   the identical reason (cites `#310` in its own comment). The shapes already handle `onPointClick`
   being `undefined` (every interactivity prop is conditional on it).

**After applying:** re-run the full `web` vitest suite plus `web/e2e/own-data-copilot.spec.ts` (the
reviewer's own note: none of these fixes touch prompt bytes, so **no fixture regen needed** — do not run
`attachments:fixtures` or any `:record` step for this fix wave). Then the full project verification block
(root+web typecheck, root vitest solo, benchmark 14/14+6/6+0 fabricated, real `next build`) before pushing
— owner-present session, so direct to `main` once green, no PR needed, per the project's standing
git-workflow rule (confirm the owner is actually present in THIS session before relying on that).

## What NOT to do

- Don't re-litigate the core design (the reader-designated-total mechanism, the honesty-note copy, the
  unconditional-availability decision) — it went through two rounds of owner rejection and one approval
  already this build; the final review found it structurally sound (no Critical finding anywhere in the
  "verified vs. unconditional" guarantee itself). Only the four presentation-layer findings above are open.
- Don't skip the A→B re-designation regression test for I1 — that's the one behavior no existing test
  proves, and it's exactly the scenario the bug lives in.
- Don't regenerate fixtures or spend live model calls for this fix wave — the reviewer explicitly confirmed
  none of the four fixes touch prompt bytes.
- Don't merge with any of I1-I4 still open.

## After the fix wave merges

Most of the "merged and live" doc pass is unusually light this time, because session 123 already wrote the
full as-built account (STATUS.md, status-archive.md, ADR 056, 08-build-plan.md, open-questions #312,
04-architecture.md) at "built on a branch, ready with fixes" state. Session 124 mainly needs to: flip each
of those from "NOT merged"/"branch, not live" to "LIVE on `main`" with the real merge SHA and a confirmed
CI run; close [open-questions #312](../open-questions.md)'s pending fixes as done; and correct
[open-questions #311](../open-questions.md)'s own note that pointed here. No new narrative is owed unless
the fix wave itself surfaces something worth recording.

## Two things flagged, not fixed, by session 123 — not urgent, but don't lose them

1. **A stale, already-merged worktree** (`chart-copilot-phase6` @ `58db5097`) is still present in `git
   worktree list` — confirmed fully contained in `main` already (`git merge-base --is-ancestor` true), safe
   to remove, but session 123 left it for the owner to decide rather than deleting another session's
   worktree unilaterally.
2. **`docs/STATUS.md` has an inline "superseded, kept as history" chain from session 122** that should have
   been trimmed to `status-archive.md` at that session's own wrap-up and wasn't — session 123 flagged this
   in the file itself rather than risk an unverified deletion. A future session with time to spare could
   verify `status-archive.md`'s session-122 entry covers it fully and then do the trim.

## Binding constraints and owner steers (carried forward)

- Cheapest mechanism first; plain full-sentence English for the owner; no shorthand.
- Git: owner-present → push to `main` directly after the full verification block; autonomous → branch + PR
  (`#118`). The repo is public: "Competitor G" only, never the real name (not relevant to this feature, but
  standing).
- Tier rule: session model thinks; implementers on a cheaper tier. This build used Fable for mechanical
  ports, Sonnet stepped up for integration-heavy/risk-sensitive tasks, Opus for the one adversarial-
  execution task review and the final whole-branch review — confirm this still stands if no visible steer
  this session; it's role-based, not a hardcoded default.
- Before widening any allowlist/enum reaching a co-pilot's LLM prompt, read
  [[feedback_llm_prompt_embedded_lists_hash_risk]] first.
- No number is ever drawn that isn't a real fetched/uploaded cell's own value, pure arithmetic over
  already-verified reals, or (for own-data's new reader-designated-total feature specifically) a cell the
  reader themselves pointed at, resolved via the same pipeline every other own-data computation already
  trusts.
- Before invoking a creative/design task, `superpowers:brainstorming` is a hard gate — present a short
  design and get an explicit yes before writing code. This session's own experience is a strong example of
  why: two rejected designs before the right one, and the owner's feedback both times was about
  conviction/quality, not a specific technical objection — read it as a signal to bring a stronger,
  considered answer rather than to keep presenting incremental variants of the same idea.
- Before proposing a fix for ANY bug, run `superpowers:systematic-debugging` — reproduce first (the fix
  wave above already has reproductions from the final review; use them, don't re-derive).
- [[feedback_architecture_over_polish]] — when proposing "what's next" after this fix wave, weigh real
  capability gains over refinement.

## Tracked, not the focus

The usual owner-steps backlog (registry:apply, DOI backfill, live benchmark, the `:record` scripts) remains
blocked on the Anthropic usage cap until 2026-10-01, per every session since 110. [Open-questions
#306](../open-questions.md)'s other two candidates (two-measure charts, Eurostat-in-chat) remain open,
unscheduled, for whenever this feature's own fix wave is done and the owner wants to pick a next
architectural piece.
