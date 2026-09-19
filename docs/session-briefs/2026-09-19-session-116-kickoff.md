# Session 116 kickoff — checkdecijfers.nl / graphmaker.studio

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it).
Verify everything below against `git log` / `gh run list` before trusting it.

## The short version

Session 115 (2026-09-19, owner delegated: "spawn multiple agents and get work done autonomously,"
present in chat throughout) built **chart co-pilot phase 4 — storytelling primitives** end to end:
brainstorming → design spec addendum (§9) → implementation plan (8 tasks) → subagent-driven build in
three waves → a final whole-branch review on the most capable model that found and the session fixed
1 Critical security hole + 10 Important cross-task findings → one fix wave → one scoped re-review →
docs, then a 5-round CI fix loop against real Playwright failures (see below). Pushed to `main`
`edbf6d30..4902737c` (50 commits). CI run `35440310164` green including deploy.

## What shipped

Six new chart-editing primitives, **CBS/Eurostat card only** (own-data + chat-doorway both
deliberately deferred, not silently dropped — [#289](../open-questions.md)):

1. **Goal line** — reader types a target value + label; the value draws as a native Recharts
   `<ReferenceLine>` with no `label` prop (so the typed text never enters a PNG/SVG export), the label
   stays in the existing outside-image list, same trust tier as chart notes.
2. **Era shading** — reader marks a period range + typed label; same export-safety split as the goal
   line, via `<ReferenceArea>`.
3. **Dim instead of hide** — a third `shown | dimmed | hidden` series state, built for BOTH the
   CBS/Eurostat and own-data cards (the one primitive that got both this session).
4. **Reader-chosen headline number** — click any point to feature it as the card's big number; falls
   back to the default figure (never blanks the card) when a zoom/reading change removes the override.
5. **Difference arrow** and **6. average line** — computed server-side, on demand, via
   `requestChartDerivation` re-running a registered R5 derivation (`deriveDifference`, new `deriveMean`)
   over an already-audited chart's own cells. No new CBS/Eurostat fetch, no new `audit_answers` row,
   never computed in the browser — owner's explicit "Option A" decision (calculate on request, not
   upfront) from this session's plain-English brainstorming pass.

Full mechanism, every deviation from the original plan, and the provenance reasoning: ADR
[056](../decisions/056-chart-copilot.md) "As built — phase 4".

## Two things worth reading before you touch this code

1. **A real, live authorization hole was found and fixed same session.** `requestChartDerivation` read
   any user's audited answer by a fully-guessable client-supplied id with no ownership/GDPR-redaction
   check — unlike its sibling `createEmbedCode`, which has exactly that check. This was caught only by
   the FINAL whole-branch review (no individual task's own scoped review could see it, since the
   vulnerable code and the correct sibling pattern live in different tasks' diffs). Fixed to match; 8/8
   tests pass. **Lesson for you:** never skip the final whole-branch review step once every task is
   individually green — it's not a formality, it's where cross-task security defects live.
2. **A subagent operated against the main repo checkout instead of its assigned `git worktree`**
   mid-fix-round, producing a genuinely unreviewed commit on `main`'s HEAD at one point. Found and
   remediated same session (local `git reset --hard`, nothing pushed, fully recoverable via reflog) —
   `main`'s actual history is clean; you don't need to do anything about this, it's here so you
   recognize the pattern if it happens again. Full account: `docs/lessons-learned.md` session 115,
   first entry.

## Owner steps pending (unchanged from sessions 110/111/114, plus phase-4's own)

- `npm run registry:apply`, `npm run backfill:eurostat-doi -- --apply`, region-set Task 9
  ([#267](../open-questions.md)), audit row 22 — all still pending, untouched this session.
- `npm run attachments:record`, `npm run chart-copilot:record`, and `npm run benchmark:run:live` —
  still blocked by the Anthropic workspace usage cap (resets 2026-10-01, [#288](../open-questions.md)),
  since all three make real API calls. **The Playwright e2e suite is NOT in this category** — it runs
  hermetically against an LLM stub, no real Anthropic calls, and it DID run this session, via CI (all
  18 e2e tests green as of the final push). Its first-ever real execution against phase 4's new cases
  found 5 real bugs (3 test-selector issues, 2 real product bugs — see ADR 056's Verification bullet
  for the full list) across a 5-round CI fix loop after the initial push. **Lesson for you:** this
  session's own local verification block ran typecheck + jsdom tests + `next build` but never the
  actual Playwright run (no real browser available in the CLI environment) — that gap is real, and CI
  is where it surfaces. Push earlier in your own session rather than batching a huge diff and finding
  out only at the very end whether the e2e suite you wrote actually passes.

## Your job: phase 5 — chart-fit scorer + new honest forms

Per the spec's phase ordering (§5.5) and `docs/08-build-plan.md`'s chart co-pilot section: a rule-based
(no LLM) scorer that decides which chart forms are honest for a given result shape, gating new forms —
stacked, 100% stacked, dumbbell, slope, heatmap, scatter, pie/donut. Then the six house styles +
homepage themes row ([#275](../open-questions.md)), which the owner has separately asked for.

Design via `superpowers:brainstorming` → `writing-plans` first — this phase hasn't had its own
brainstorming pass yet the way phase 4 did; don't assume the spec's phase-5 sketch is final. Cheapest
mechanism first: the scorer is explicitly "rule-based, no LLM" in the spec's own framing — don't
reach for a model call here without first checking whether deterministic rules over the spec's shape
(series count, kind, whether it's comparison-shaped, etc.) already cover it.

## Binding constraints and owner steers (carried forward, still true)

- Cheapest mechanism first; plain full-sentence Dutch or English for the owner; no shorthand
  ([lessons/feedback: Plain English, no jargon]).
- Git: owner-present → push to `main` after the full verification block (typechecks, root + web
  suites run SOLO on this 8 GB machine, benchmark 14/14 + 6/6 + 0 fabricated when the API cap allows
  it, the relevant Playwright proofs, `next build`, a final whole-branch review or `/code-review` LOW);
  autonomous → branch + PR ([#118](../open-questions.md)). Migrations file-only; live DDL, real LLM
  spend, env flags stay owner-supervised. The repo is public: "Competitor G" only, never the real name.
- Tier rule: the session model thinks; implementers on a cheaper tier; the whole-branch final review
  on the most capable tier — budget a fix wave for it, it found real things twice running now (session
  114's 8 minor findings, session 115's 1 Critical + 10 Important).
- Worktree mechanics that worked this session: `git worktree add -b <task> ../cdc-wt-<task> main`
  (LOCAL main), symlink `node_modules` and `web/node_modules`, never `git add -A`. **New from session
  115: verify a subagent's claimed commit actually exists in ITS OWN worktree's `git log` — if it
  doesn't, check whether it landed on the MAIN checkout instead of assuming a stalled background
  command.** After a parallel wave, merge worktree branches into `main` ONE AT A TIME, resolving the
  expected small conflicts (usually e2e test insertion points, i18n key blocks) by hand.
- After widening any shared union/enum type (this session's `DerivationRecord` + `'mean'` is the
  concrete example), grep the WHOLE repo for every existing narrowing site over that type before
  calling the change done — a file with zero diff can still have a compile error from a dependency's
  type change. Run the FULL typecheck (not a scoped `cd web && tsc --noEmit`), and run `next build`
  too — it caught an error this session's scoped typecheck had already called clean.
- Recharts-specific: `<ReferenceLine>`/`<ReferenceArea>` must be direct JSX children of the chart, never
  wrapped in a custom component (Recharts silently renders nothing if you do) — use a plain function
  returning an array of elements instead.

## Tracked, not the focus

[#285](../open-questions.md)–[#294](../open-questions.md) (phase 3 + phase 4 residuals — pricing,
copy accuracy, small UX gaps, all deliberately deferred); [#275](../open-questions.md) (homepage
themes row, ties into phase 5's house styles); rebrand to graphmaker.studio ([#7](../open-questions.md)).
