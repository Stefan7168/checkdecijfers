# Session 117 kickoff — checkdecijfers.nl / graphmaker.studio

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it).
Verify everything below against `git log` / `gh run list` before trusting it.

## The short version

Session 116 (2026-09-19, owner present in chat throughout — "Split" on scope, "Use fable subagents" as
live steers) built **chart co-pilot phase 5 — chart-fit scorer + dumbbell/slope/heatmap**: brainstorming
with a real feasibility check before committing scope → design addendum → implementation plan → 5
sequential subagent-driven tasks (single worktree, Fable-tier implementers — `chart.tsx` too fragile for
parallel edits) → a final whole-branch review on the most capable model that found and the session fixed
2 Important cross-task bugs → one fix wave → one scoped re-review → docs. Pushed to `main`
`dfdaee18..8abd187c` (11 commits) + a docs commit `cb81535c`. CI run `35451048437` green including
deploy.

## What shipped

A rule-based (no LLM) scorer, `web/lib/chart-fit.ts`'s `allowedForms`, that both the on-screen chart tab
switcher and the CBS chat co-pilot's capability list read from — the single place "is this chart shape
honestly offered right now" is answered. Three new shapes, **CBS/Eurostat card only**
([#295](../open-questions.md), own-data untouched):

1. **Slope** — zero new render code. A slope chart IS a line chart with exactly two points per series,
   which is `slopeFormAllowed`'s own condition, so it reuses the existing line-chart render branch
   verbatim.
2. **Dumbbell** — a new `DumbbellOverlay` component, reusing an existing-in-file Recharts hook pattern
   (`EndLabelsOverlay`'s `useXAxisScale`/`useYAxisScale`) rather than an unproven mechanism the original
   plan draft sketched.
3. **Heatmap** — a plain CSS grid over the table form's own rows. Discovered mid-build that the table
   form lives OUTSIDE the main Recharts render tree as a sibling branch with ~17 separate gates for
   surrounding UI (Style panel, legend, notes, download/embed, co-pilot, etc.) — heatmap inherits all of
   them via one derived `isTabularForm` flag, now shared with the public embed route too.

**Deliberately split out of scope, decided by the owner ("Split") before any code was written**
([#296](../open-questions.md)): pie/donut, stacked, 100%-stacked, and scatter need real new capabilities
that don't exist yet — scatter needs a second measure per plotted point (today's chart spec carries
exactly one `value` per point); pie/stacked need a "verified whole" concept (nothing in `src/query`/
`src/registry` can check that a set of cells honestly sums to some other real, published cell).
[ADR 039](../decisions/039-chart-presentation-panel.md)'s existing blanket refusal of all four is
**unchanged** — do not describe this as reopened or decided differently without a fresh owner steer.

Full mechanism, every documented deviation from the original plan draft, and the honesty reasoning:
ADR [056](../decisions/056-chart-copilot.md) "As built — phase 5".

## Two things worth reading before you touch this code

1. **A chart-shape "is this honestly offered" guard must check the spec ACTUALLY DRAWN, not just the
   easiest one to read.** The final review found the three new forms' guards read the `spec` PROP, but
   the real rendered canvas comes from `displaySpec`/`viewSpec` — reachable through an alternate-reading
   `<select>` and a zoom window, neither of which resets the selected chart form. A disqualifying
   alternate reading while on the heatmap tab made the render code throw (no error boundary in `web/`);
   dumbbell's twin rendered a blank, unexplained canvas. Fixed with one composite `guardSpec` object
   feeding every phase-5 guard — the five pre-existing forms' own guards are unaffected by construction
   (they're typed so they physically cannot read anything but `spec.kind`). **Lesson for you:** any new
   "is this X allowed for the current chart" check needs to ask what's actually on screen at render time,
   not just what's convenient to read where the check is written.
2. **`web/components/chart.tsx`'s table form is not inside the main Recharts render tree.** It's a
   sibling `canvasNode` branch, and ~17 separate `state.form !== 'table'` (now `!isTabularForm(...)`)
   checks scattered through the file gate the surrounding chrome specifically for it. Any future chart
   shape modelled on "the table's own rows, presented differently" needs the same sibling-branch +
   gate-inheritance treatment, not a new arm in the main chart ternary — read `isTabularForm`'s call
   sites (`chart.tsx`) before assuming where a new render branch belongs. Full account, plus the
   `EndLabelsOverlay` reusable-hook-overlay pattern worth knowing for any future custom chart marks:
   `docs/lessons-learned.md` session 116, first two entries.

## Owner steps pending (unchanged from sessions 110/111/114/115/116)

- `npm run registry:apply`, `npm run backfill:eurostat-doi -- --apply`, region-set Task 9
  ([#267](../open-questions.md)), audit row 22 — all still pending, untouched this session.
- `npm run attachments:record`, `npm run chart-copilot:record`, and `npm run benchmark:run:live` —
  still blocked by the Anthropic workspace usage cap (resets 2026-10-01, [#288](../open-questions.md)).
  The Playwright e2e suite is NOT in this category — hermetic (LLM stub), ran green this session
  (21/21, real Chromium).

## Your job: no single mandated next task — pick from the plan's own stated priorities

Per `docs/08-build-plan.md`'s chart co-pilot section: the spec's own phase list (§5) is now **fully
built** through phase 5. Two live candidates, neither owner-mandated yet — use judgment or ask:

1. **The six house styles + homepage themes row** ([#275](../open-questions.md)) — the owner's own
   standing wish since session 111, not yet scheduled. Needs its own brainstorming pass (new
   presentation keys: paper colour, display/body font pairing, panel rules, tick length, corner radius,
   legend style, colour-keyed headline words) — spec pointer in #275's own row.
2. **Phase 5b — the two missing capabilities pie/stacked/scatter need**, if the owner wants to revisit
   them: a "verified whole"/parent-sum concept in the query or registry layer, and a two-measure-per-point
   chart-spec shape. Not started, not currently prioritized — only pick this up on an explicit owner
   steer, since #296 records that the split was a deliberate, owner-made scope decision, not just "not
   done yet."

Do NOT assume either is "the" next priority without checking with the owner first — unlike prior
sessions' kickoffs, this one has no single mandated next build.

## Binding constraints and owner steers (carried forward, still true)

- Cheapest mechanism first; plain full-sentence Dutch or English for the owner; no shorthand.
- Git: owner-present → push to `main` after the full verification block (typechecks, root + web suites
  run SOLO on this 8 GB machine, benchmark 14/14 + 6/6 + 0 fabricated when the API cap allows it, the
  relevant Playwright proofs, `next build`, a final whole-branch review or `/code-review` LOW);
  autonomous → branch + PR ([#118](../open-questions.md)). Migrations file-only; live DDL, real LLM
  spend, env flags stay owner-supervised. The repo is public: "Competitor G" only, never the real name.
- Tier rule: the session model thinks; implementers on a cheaper tier (session 116 used Fable per an
  explicit owner steer — check whether that steer still stands for a new session, since it was given
  in-chat, not written as a standing CLAUDE.md rule); the whole-branch final review on the most capable
  tier — it found real things every session it's run this phase (session 114: 8 minor; session 115: 1
  Critical + 10 Important; session 116: 2 Important, both real cross-task bugs no task review could see).
- Worktree mechanics: `git worktree add -b <task> ../<name> main` (LOCAL main); a worktree's symlinked
  `node_modules` breaks Turbopack's own build (`Symlink [project]/node_modules is invalid, it points out
  of the filesystem root`) — replace with a real local `npm ci` install (both root and `web/`) before
  trusting a `next build` result from inside a worktree, not a webpack substitute. When removing a
  worktree at session end, if `git worktree remove` is refused for untracked content, SHOW the owner
  what's at stake before using `--force` — session 116 skipped that check (safely, but wrongly) and
  disclosed it; don't repeat the skip.
- After widening any shared union/enum type, grep the WHOLE repo for every existing narrowing site over
  that type before calling the change done, AND run the FULL (non-scoped) typecheck plus `next build` —
  session 116's own Task 1 found 3 unanticipated narrowing sites this way (`chart.tsx`'s `formTabRef`,
  `chart-history-menu.tsx`'s `formLabel`, a hand-written test literal) that a plain grep for the old
  literal values would have found faster than waiting for `tsc` to fail.
- Recharts-specific: `<ReferenceLine>`/`<ReferenceArea>` must be direct JSX children of the chart, never
  wrapped in a custom component. For any custom-positioned mark (a dot, a label, a line NOT natively
  supported by a Recharts component), prefer the `EndLabelsOverlay`/`DumbbellOverlay` pattern
  (`useXAxisScale`/`useYAxisScale`/`usePlotArea` hooks reading Recharts' own settled scales) over
  inventing a new mechanism — verify any Recharts internals claim against the actual installed source in
  `node_modules/recharts/es6` before relying on it, the way session 116's Task 3 and its reviewer both
  did.

## Tracked, not the focus

[#289](../open-questions.md)–[#298](../open-questions.md) (phase 4 + phase 5 residuals — own-data
support for six primitives and three new forms, small UX/testing gaps, a disclosed harmless
chat-capability residual, a suggested drift-guard test — all deliberately deferred, not silently
dropped); [#275](../open-questions.md) (homepage themes row, see "Your job" above); rebrand to
graphmaker.studio ([#7](../open-questions.md)).
