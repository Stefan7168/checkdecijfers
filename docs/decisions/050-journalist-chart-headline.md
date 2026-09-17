# ADR 050 — Journalist chart headline: AI-drafted, trusted-once-edited, persisted

**Status:** accepted, built end-to-end via subagent-driven development (session 105, 2026-09-16,
branch `worktree-chart-journalist-headline`) — 8 tasks + a final-review fix wave, all task-scoped
reviews and the whole-branch review clean. **MERGED to `main` (`7bf76ff`) and deployed the same
session, CI green (`gate` + `deploy` both succeeded).** Migration 031 was then applied live with
the owner's explicit go-ahead and verified directly against production (RLS on, zero `anon`/
`authenticated` grants). **The feature is fully live.**

## Context

Session 105's mandate (owner, in-chat): "focus the project back on the standard graphs instead of
storytelling." [Open-questions #253](../open-questions.md) (a map/geo chart library comparison) was
checked against the real code and confirmed still blocked — `src/query/` has no way to ask for
"every region," only a fixed, explicitly-named list, so there is no real region-set data to map yet.
(**Update, session 110, 2026-09-17:** this changed — see ADR [054](054-region-set-query.md) and
[#253](../open-questions.md); the query/chart/answer layers now support region-class queries, though
the map itself and the parser exposure needed to reach it in chat remain future work. Accurate as of
session 105, when this ADR was written.)
[#254](../open-questions.md)'s own research named two directly-actionable "standard graphs" gaps
with no such precondition; the owner picked the first: **a journalist-authored headline for a
chart** — today the chart title is always the CBS table's own name, never editable prose the reader
writes. #254 itself flagged the design tension: "the LLM must not narrate a takeaway the
deterministic pipeline hasn't validated" (principle a) — this ADR is the honesty-safe mechanism
#254 said the gap would need.

Three decisions were made in chat before design work started (recorded here as the owner's calls,
not the session's default recommendation):

1. **Headline source: AI-drafted, journalist can edit** (not a freeform box, not AI-only/locked).
2. **Edit trust: fully trusted once edited** — no re-validation of the edited text against the
   data. A deliberate, scoped exception to the product's "every number traceable" claim, for this
   one field only — the same shape as [ADR 038](038-chart-view-state-editing.md)'s click-to-annotate
   exception, not a silent weakening of R1/R3 elsewhere.
3. **Persistence: in the database** — the session's own initial recommendation was session-only
   client state + a query-param on the embed URL (matching how annotations and view-state already
   work, zero migration). The owner explicitly chose DB persistence instead, so a headline survives
   reload and is editable later from any device. Recorded as the owner's call against the cheaper
   default, per CLAUDE.md's "document, don't escalate" convention.

Full design reasoning: [docs/superpowers/specs/2026-09-16-chart-journalist-headline-design.md](../superpowers/specs/2026-09-16-chart-journalist-headline-design.md).
Implementation plan (with the as-built deviations below folded in during execution):
[docs/superpowers/plans/2026-09-16-chart-journalist-headline.md](../superpowers/plans/2026-09-16-chart-journalist-headline.md).

## Decision

**D1 — Drafting reuses the existing Insights honesty mechanism, not a new LLM prompt.**
`src/chart/headline-phrase.ts`'s `draftHeadline(spec, options)` is a thin wrapper: it calls the
chart's `topFinding(spec)` (D2 below) and phrases just that one finding through the SAME
`composeInsights` digit-free slot-filling mechanism [ADR 041](041-chart-insights.md) already proved
— zero new prompt, zero new Zod schema, zero new fixture bytes. A fabricated number stays
structurally impossible in the *draft*; only the human's subsequent *edit* carries the scoped trust
exception (decision 2).

**D2 — `src/chart/insights.ts` gained a new export, `topFinding(spec): ScoredFinding | null` (as-built
correction, found during Task 3's own TDD, not anticipated by the original plan).** The plan
originally assumed `scoreFindings(spec)[0]` was the single most-notable finding; it is not —
`scoreFindings`'s existing `rankAndCap` re-sorts its capped, score-ranked output back into
*chronological* order for the Insights panel's own (unrelated) display purpose, stripping the score
field before returning. `scoreFindings(spec)[0]` is therefore the chronologically-earliest of the
capped findings, not the most notable one — for a headline, that's a real correctness bug (it would
describe the least interesting point on the chart). Fixed via a behavior-preserving refactor
(`buildCandidates` + `rankByScore` extracted from the existing pipeline; `scoreFindings`'s own
output is unchanged, byte-for-byte, verified by hand-tracing all four branches and independently
re-running both of `scoreFindings`'s pre-existing consumer suites). `topFinding` is the actual
score-winner, pre-chronological-resort.

**D3 — Persistence: `chart_headlines` table (migration 031), one row per `audit_answers` row.**
```sql
create table chart_headlines (
  audit_answer_id bigint primary key references audit_answers(id),
  headline text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```
FILE-ONLY until an owner-supervised apply (migrations 016/017/019/026/028/030 precedent) — every
reader/writer (`src/chart/headline-store.ts`) degrades gracefully via a `to_regclass` existence
check, never a try/catch masking a real error. Joins the GDPR retention job in the same change
(`src/answer/audit/retention.ts`'s `redactMatchingRows` gained a `headlineDelete` leg, guarded the
same way `feedbackDelete` already is, wired into all three call sites: self-service, per-thread,
time-based purge).

**D4 — Write ownership guard lives in SQL, mirrors `upsertAnswerFeedback` exactly (as-built
correction from the Task 2 review).** The first-drafted guard omitted `source_tag = 'user'`, which
`upsertAnswerFeedback`'s guard it claimed to mirror already has — without it, an
`onboarding_delivery` row (a background-cron-generated chart, never thread-attached, but which CAN
carry a real `user_id` + `kind='answer'` + `chart_emitted=true`) would have been headline-able even
though it's never a chart a user organically sees in the chat UI. Fixed; the final guard:
```sql
insert into chart_headlines (audit_answer_id, headline)
select a.id, $2::text
  from audit_answers a
 where a.id = $1
   and a.user_id = $3
   and a.kind = 'answer'
   and a.source_tag = 'user'
   and a.chart_emitted
on conflict (audit_answer_id) do update
  set headline = excluded.headline, updated_at = now()
returning audit_answer_id
```
A mismatch (someone else's row, a refusal/clarification, a chartless answer, a non-`user`-sourced
row, a nonexistent id, or an anonymous `user_id is null` row) returns zero rows → soft `false`,
never throws. Reads split into `getOwnChartHeadline` (authenticated, ownership-checked — the chat
UI's own fetch) and `getChartHeadlinePublic` (no ownership check by design — the public
`/embed/[token]` route's own signed token already proves access before this ever runs).

**D5 — 140-character cap, truncated at a word boundary, never mid-token (as-built correction from
the final whole-branch review — the single most serious finding of the whole build).** A raw
`slice(0, 140)` can cut a filled-in NUMBER in half (e.g. "…naar 1,5% in 2023." → "…naar 1,") — a
wrong number presented as fact, the worst possible failure mode for this product. `normalizeHeadlineText`
(`src/chart/headline-store.ts`) now cuts at the last whitespace boundary at or before the cap, so a
partial token (word or number) is dropped whole; a pathological single-token-longer-than-the-cap
case falls back to the hard cut rather than returning empty. `web/components/chart.tsx` imports the
same function for its own optimistic client-side update rather than re-implementing truncation, so
client and server can never disagree about what got saved.

**D6 — Shown wherever a chart renders from a stored audit row** (chat card via
`ChartView`'s `embed?.auditId`-gated lazy fetch; `/embed/[token]` via a server-resolved
`headlineText` prop, always `string | null`, never `undefined`) **and drawn into PNG/SVG exports**
(`chart-download.tsx`'s existing footer-drawing technique, extended with its own font-size-scaled
wrap width and line height — as-built correction from the final review: the first cut reused the
footer's 11px-tuned `wrapAttributionText`/`FOOTER_LINE_HEIGHT` constants for the headline's own
15px/600 text, which would have clipped or overlapped a long, wrapped headline in the actual
exported image).

## Alternatives considered

- **Session-only / query-param persistence, no DB** (the session's own initial recommendation,
  matching how click-to-annotate/view-state and `?form=`/`?theme=` embed params already work with
  zero schema change). Rejected by explicit owner choice (decision 3) — cross-device, survives-reload
  editing was wanted, which a client-only mechanism cannot give.
- **Freeform text box, no AI** and **AI-drafted, locked (not editable)** — both rejected in the
  first clarifying round; the owner wanted an AI first draft with real editorial control, matching
  #254's "headlines that state the takeaway" framing.
- **Re-validate the edited text against the data** (extend the digit-scan to the edited headline
  too) — rejected by explicit owner choice (decision 2); accepted as a scoped, documented exception,
  not a silent weakening of R1/R3 elsewhere.
- **A second, bespoke LLM prompt/schema for headline drafting** — rejected once Task 3 confirmed
  `composeInsights` (on the chart's own `topFinding`) already produces exactly the right shape of
  content; a second mechanism would mean maintaining two digit-free validators for no real benefit.

## Consequences

- The feature is safe to deploy before the owner applies migration 031 (every path degrades
  gracefully), but deploying the CODE without the migration leaves a confusing half-working window:
  the trigger renders and the AI draft succeeds (and is billed) before the save fails with a
  generic error. **As-built: the final review's recommendation was followed — migration 031 was
  applied in the same session as the deploy, confirmed live (RLS on, zero `anon`/`authenticated`
  grants) before this ADR was closed out, so that window never actually opened in production.**
- `src/chart/insights.ts` now has two selection entry points (`scoreFindings` for the ≤5-finding
  panel, `topFinding` for the single-winner case) sharing one scoring/dedup core — a real, if small,
  widening of a previously single-purpose module's public surface. `topFinding` has no dedicated
  direct unit test of its own (matches `scoreFindings`'s own pre-existing convention — neither had
  one before this ADR, only through `web/lib/chart-insights.ts`'s wrapper tests), but it is now the
  sole input to a public-facing feature — worth a direct test if `insights.ts` changes again.
- A published headline can be *edited* but not *retracted* short of deleting the whole chat — an
  empty save is rejected, not treated as "remove the headline." Not specified by the design; a real
  plan gap, not an implementation defect — flagged for the owner, not decided here.
- Session 105 also caught and fixed one already-merged, build-breaking bug entirely unrelated to
  this feature's own design: Task 5's i18n-string commit used curly quotes (‘ ’) as actual string
  *delimiters* in `web/lib/i18n/messages.ts`'s `en` table (not just content) — invalid TypeScript
  syntax that would have broken `next build` and failed the whole `chart.test.tsx` suite at import
  time. Both that task's own implementer (falsely claimed a clean typecheck) and its reviewer
  (explicitly declined to independently verify the typecheck claim) missed it; found and fixed
  during Task 6, independently re-verified by Task 6's reviewer and again by the final whole-branch
  review. Process lesson, not a design consequence of this ADR — recorded in
  [lessons-learned.md](../lessons-learned.md).

## Revisit triggers

- A request to let a headline be explicitly removed/retracted, not just edited.
- Real usage data suggesting the 140-character cap is too tight or too loose for the actual
  headlines journalists write.
- The latent, unguarded race between the chat UI's mount-time `fetchChartHeadline` effect and a
  user-initiated save (two independent async writers to the same client state, no sequencing guard)
  — practically unreachable today (the fetch resolves in milliseconds; a save needs a click plus an
  LLM round-trip) but worth a real guard if this area is touched again.
- Test coverage gaps deferred at review time (not load-bearing today): `saveChartHeadline`'s
  `{ok:false}` path in edit mode, `cancelHeadlineDraft`, re-opening edit mode on an already-saved
  headline, the lazy-fetch effect populating a non-null value, and an export-level test proving the
  content-shift genuinely prevents visual overlap (today only total-height growth is asserted).
