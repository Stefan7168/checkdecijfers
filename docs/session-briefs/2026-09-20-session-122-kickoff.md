# Session 122 kickoff — checkdecijfers.nl / graphmaker.studio

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it,
including this file). Verify everything below against `git log`/the branch before trusting it — this
file is a snapshot written 2026-09-20, session 121, not a live source.

## The short version

`main` is **unchanged** at `c5c8dbee` (session 120's own close). Session 121 did NOT touch main — it
built a real, substantial feature on a separate branch, `worktree-chart-copilot-phase6` @ `58db5097`,
pushed to `origin` (not merged). The final whole-branch review said **"ready to merge, with fixes"** —
two small, well-scoped, fully-written fixes stand between this branch and a normal owner-present push to
`main`. This session's mandated first step is applying them, not starting something new.

## Why this session exists mid-branch

Session 121's owner pushed back that recent sessions (118-120) read as polish, not the architectural
progress expected — see [open-questions #306](../open-questions.md). The session surveyed real gaps and
built "wire the chat co-pilot to five features that already existed on the panel but were chat-blind"
end to end via `superpowers:subagent-driven-development`. All 6 build tasks completed and passed their
own task review. The FINAL whole-branch review (the first pass that looked at all five new commands
together) found two real issues. The owner's wrap-up signal arrived right as that review landed, so the
session stopped there deliberately rather than rush a fix-and-merge cycle in the closing minutes — see
[[project_session121_state]] and `docs/lessons-learned.md` session 121 for the full account.

## Resume mechanics — read the ledger, don't re-derive the plan

1. Confirm the worktree still exists: `git worktree list` from the main checkout. If it's there, `cd`
   into it (or use `EnterWorktree` with `path:` pointing at it) — do NOT create a fresh worktree.
2. If the worktree is gone, the branch is safe on `origin` as `worktree-chart-copilot-phase6` — check it
   out into a fresh worktree from there instead of starting over.
3. Read the branch's own SDD ledger FIRST, before anything else:
   `.claude/worktrees/chart-copilot-phase6/.superpowers/sdd/2026-09-20-chart-copilot-phase6-chat-wiring/progress.md`
   (git-ignored, on-disk only — it has every task dispatch, every review, every fix round, every ruling
   made this session, in far more detail than this brief carries). The plan it executed is at
   `docs/superpowers/plans/2026-09-20-chart-copilot-phase6-chat-wiring.md` (committed, on the branch).
4. The final review's full text is in that ledger too — but the fix wave itself is short enough to
   restate here in full, since it's the actual next action:

## The fix wave (final reviewer's own recommendation, verified prompt-byte-free — no fixture regen needed for 5 of 6 items)

1. **`web/lib/chart-copilot-reply.ts`'s `iconFor()`** — add arms for the five new command kinds. At
   minimum: `setDimmed` → `'series'` (matches its sibling `setSeriesView`); `setHeadlineOverride` →
   `'note'` (its own refusal path already uses `control: 'notes'` — the applied-chip destination should
   match, not contradict it); `addGoalLine` → `'note'`; `addEraShading` → `'note'` or `'style'` (the
   reviewer's call, both defensible); `addDerivedOverlay` → `'form'` (verified: its buttons genuinely sit
   in the same `data-slot="chart-controls"` row as the form tabs).
2. **`src/chart/copilot/map.ts`** — the `addGoalLine` and `addEraShading` refusal `control` values should
   be `'notes'`, not `'form'` (their real controls live in the notes-adjacent panel, not near the form
   tabs — verified directly by the reviewer against `chart.tsx`).
3. **`src/chart/copilot/respond.ts:64`** — pass `trimmed` (not raw `message`) to `mapCbsCopilotOutput`.
   Currently behaviorally identical, but the goal-line guard's provenance check should verify against
   exactly what the model was shown, not a value that happens to match today.
4. **The one item that touches the request path — verify carefully:** add an `overlays: boolean` field to
   `CbsCopilotCapabilities` (`src/chart/copilot/types.ts`), computed in `cbsCapabilities`
   (`web/lib/chart-capabilities.ts:92-121`) from the `form` it already receives (true only for
   `line`/`area`, matching the panel's own `activeForm === 'line' || activeForm === 'area'` gate at
   `chart.tsx:5801`), defaulted `false` in `sanitizeCbsCapabilities`, and checked in `map.ts`'s
   `addDerivedOverlay` case (refuse `not_available`/`form` when false). **This is the more important of
   the two Important findings** ([open-questions #310](../open-questions.md)) — without it, asking the
   chat for an overlay on a bar/pie/stacked chart silently stores a command that renders nothing and can't
   be explained or removed. The reviewer confirmed `serializeCbsCopilotRequest` prints capability fields
   individually by name, so an unlisted field changes zero request bytes — no fixture regen needed in
   theory. **Verify this claim before trusting it**: compare `requestHash` before/after adding the field
   on an existing case with a throwaway script, or just run the real Playwright suite and confirm all 27
   still pass with the fixtures untouched.
5. **`src/chart/copilot/types.ts`'s `dataRequest` doc comment** (around the `CbsCopilotOutput` interface)
   still paraphrases the OLD prompt wording from before session 121's own `addDerivedOverlay` fix —
   correct it to match the real, current `SYSTEM_PROMPT` paragraph. TSDoc only, free, no logic change.
6. **`goalLineValueInMessage`'s doc comment** (`src/chart/copilot/text-guard.ts`) — add one sentence
   noting the deliberate, accepted false-accept for a bare year mentioned near a goal-line request (e.g.
   "tussen 2020 en 2024" makes `2024` pass) — the plan's own after-Task-6 instructions asked for this
   decision to be documented, and it wasn't, per the final review.
7. **One assertion in `tests/chart/copilot-fixtures.test.ts`** — every case in `CASES` should map to at
   least one command via `mapCbsCopilotOutput`, or declare its expected refusals. Currently a case whose
   output silently maps to zero commands would still pass. Closes the one gap in this branch's own test
   suite the final review found.

After applying: re-run `npm run typecheck` (root + web), the full root + web vitest suites, and — because
item 4 touches the request-building path — the FULL real Playwright `chart-copilot.spec.ts` suite
locally, not just a subset, to prove the capability field really didn't shift any hash. Then the full
project verification block (benchmark 14/14 + 6/6 + 0 fabricated, `/code-review` LOW effort on the diff,
real `next build`) before pushing — owner-present session, so direct to `main` once green, no PR needed,
per the project's standing git-workflow rule.

## What NOT to do

- Don't start a fresh plan or re-litigate the five command kinds' design — they're built, reviewed, and
  the final review found them sound apart from the two items above. Read the ledger before assuming
  anything needs rework.
- Don't skip the real Playwright re-run after item 4 — that's the one item whose "no fixture regen
  needed" claim is a prediction, not yet proven.
- Don't merge with any of items 1-4 still open — those are the two real Important findings; items 5-7 are
  free/cheap and there's no reason to defer them further either, but 1-4 are the actual gate.

## After the fix wave merges

Docs still need the normal "merged and live" pass this session's wrap-up deliberately deferred (since the
code wasn't merged yet): ADR [056](../decisions/056-chart-copilot.md)'s "As built — phase 6" section,
`docs/04-architecture.md`'s capability rows, and closing out
[open-questions #289](../open-questions.md)/[#301](../open-questions.md)/[#275](../open-questions.md)/[#310](../open-questions.md)
as actually shipped rather than "built on a branch."

## Binding constraints and owner steers (carried forward)

- Cheapest mechanism first; plain full-sentence English for the owner; no shorthand.
- Git: owner-present → push to `main` directly after the full verification block; autonomous → branch +
  PR (`#118`). The repo is public: "Competitor G" only, never the real name.
- Tier rule: session model thinks; implementers on a cheaper tier — Fable was this session's steer for
  implementers, opus for the two safety/final reviews that warranted it (confirm this still stands if no
  visible steer this session; it's role-based, not a hardcoded default).
- Before widening any allowlist/enum in `src/attachments/copilot/` or `src/chart/copilot/`, read
  [[feedback_llm_prompt_embedded_lists_hash_risk]] first — rewritten this session with the corrected fix
  (offline regen, not a revert).
- No number is ever drawn that isn't a real fetched cell's own value, or pure arithmetic over
  already-verified reals, or (new this session, for the one field where it applies) a number the reader
  literally typed themselves, verified digit-for-digit against their own message.
- Before invoking a creative/design task, the `superpowers:brainstorming` skill is a hard gate — present a
  short design and get an explicit yes (or, when the owner has explicitly pre-authorized autonomy, a
  clearly-stated intent posted transparently before proceeding) before writing any code.
- Before proposing a fix for ANY bug, run `superpowers:systematic-debugging` — reproduce first.
- **New this session:** [[feedback_architecture_over_polish]] — when proposing "what's next," actively
  weigh real capability gains over refinement, and say so unprompted if recent sessions trended toward
  polish.

## Tracked, not the focus

`#289`/`#296`/`#301`/`#275` now read "built, not merged" — will need a final status flip once this
session's fix wave lands and the branch merges. `#307`/`#308`/`#309` are new, deliberately-deferred
findings from the final review (mean-ignores-zoom, e2e-covers-1-of-5, setDimmed's silent un-hide) — real,
open, not urgent. The usual owner-steps backlog (registry:apply, DOI backfill, live benchmark, the
`:record` scripts, all blocked on the Anthropic usage cap until 2026-10-01) is unchanged.
