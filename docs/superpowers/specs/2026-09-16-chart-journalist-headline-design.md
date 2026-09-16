# Design — journalist-authored chart headline

**Date:** 2026-09-16 (session 105, owner present). **Status:** approved design, not yet built.

## Context

Owner priority pivot this session: "focus the project back on the standard graphs instead of
storytelling" ([open-questions #253](../../open-questions.md)/[#254](../../open-questions.md)).
#253 (map/geo chart library comparison) was checked against the real code and confirmed still
blocked — `src/query/` has no way to ask for "every municipality," only a fixed, explicitly-named
region list (`src/query/resolve.ts:270-296`), so there is no real region-set data to map yet.
#254's own research surfaced two gaps with no such precondition; the owner picked the first:

> a journalist-authored headline/title (today's title is always the CBS table's own title, never
> editable prose the reader writes) — tension with principle (a): the LLM must not narrate a
> takeaway the deterministic pipeline hasn't validated, so this would need its own honesty-safe
> mechanism, not a plain text box.

Two decisions were made in chat before this doc was written:

1. **Headline source: AI-drafted, journalist can edit** (not a freeform box, not AI-only/locked).
2. **Edit trust: fully trusted once edited** — no re-validation of the edited text against the
   data. This is a deliberate, scoped exception to the product's "every number traceable" claim,
   for this one field only, the same way click-to-annotate notes (ADR 038) are already an
   explicitly-scoped, session-only exception.
3. **Persistence: in the database** (owner's explicit choice, against the session's initial
   cheapest-mechanism-first recommendation of session-only/query-param — recorded here as owner
   judgment, not silently overridden).

## Decision

### Data model — migration 031, `chart_headlines`

```sql
create table chart_headlines (
  audit_answer_id bigint primary key references audit_answers(id),
  headline text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

One headline per chart (not per user) — an audit row belongs to exactly one asking user's own
thread, mirroring `answer_feedback`'s per-answer keying (migration 017) but without that table's
per-user uniqueness, since there is only ever one legitimate editor per chart (see ownership guard
below). `headline` is capped at 140 characters (constant `CHART_HEADLINE_MAX_LENGTH`, enforced in
the server action before it ever reaches SQL) — a UI/layout bound, not a honesty check, chosen to
keep the headline card-sized rather than paragraph-length.

**FILE-ONLY until the owner-supervised apply** (migrations 016/017/019/026/028/030 precedent):
every reader/writer degrades gracefully (`to_regclass` check → null/no-op) while the table doesn't
exist yet, so the build can ship ahead of the supervised migration window without breaking prod.

**GDPR / retention — joins the job in the same change** (migration 028's rule: a table holding
user-authored text about a specific person's chat is personal data from the moment it exists).
Mirrors `answer_feedback`'s three integration points in `src/answer/audit/retention.ts` exactly:

- **Redaction transaction** (`redactMatchingRows`): a `HeadlineDelete` parameter alongside the
  existing `FeedbackDelete`, guarded by the same `to_regclass('public.chart_headlines')` check,
  deleted in the same transaction *before* the audit row is redacted (same F3 ordering rule as
  feedback — a crash between the two steps must never leave headline text behind a redacted row).
- **Self-service delete** and **account-level wipe** — both existing call sites gain the paired
  `delete from chart_headlines where audit_answer_id in (...)`, same shape as the existing
  `answer_feedback` deletes at `retention.ts:324` / `:372` / `:433`.
- **Time-based audit purge** — same cascade.

### Writing it — ownership guard lives in the SQL, not application code

Mirrors `upsertAnswerFeedback` (`src/answer/audit/feedback.ts`) exactly: the insert only succeeds
when it can select the target row as the caller's own real answer *with a chart to headline*:

```sql
insert into chart_headlines (audit_answer_id, headline)
select a.id, $2::text
  from audit_answers a
 where a.id = $1
   and a.user_id = $3
   and a.kind = 'answer'
   and a.response->'chart' is not null
on conflict (audit_answer_id) do update
  set headline = excluded.headline, updated_at = now()
returning audit_answer_id
```

A mismatch (someone else's row, a refusal/clarification, a chartless answer, a nonexistent id, or
an anonymous row with `user_id is null`) returns zero rows → the function returns `false`, never
throws — same soft-fail contract as feedback. This structurally means only an authenticated user
editing their own chart can ever set a headline; anonymous/benchmark rows can't, by construction.

### Drafting it — reuses the Insights AI-phrasing mechanism, not a new honesty design

A new server action, `web/app/chart-headline-actions.ts`, mirrors `generateInsights`
(`web/app/chart-insights-actions.ts`) exactly in shape: authenticated-only (`currentUserId()`),
takes the `ChartSpec` the client already has rendered (never re-fetched, never trusted from a
separate client-sent string — same R2 "keep user-typed text out of the prompt" discipline), and
calls a new `draftHeadline(spec, findings)` in `src/chart/insights-phrase.ts` (or a small sibling
module) using the **same digit-free slot-filling mechanism** already proven there: the model
writes a headline sentence with zero digits, deterministic code fills the one or two real numbers
from the chart's own already-validated findings afterward. A fabricated number stays structurally
unrepresentable, exactly like every other AI-phrased surface in this product — this is what
resolves #254's "tension with principle (a)": the *draft* is honesty-safe by the same mechanism as
Insights; only the *human's subsequent edit* is the deliberately-scoped trust exception (decision
2 above), not the AI generation step.

Same v1 scope calls as Insights: no server-side rate limit (authenticated, click-triggered,
`PHRASING_MODEL` tier, short response), Dutch phrasing regardless of display language (ADR 041
point 6's known limitation, inherited as-is).

### Showing it

Anywhere a chart renders from a stored audit row — the chat card and `/embed/[token]`
(`web/app/embed/[token]/page.tsx`) — the render does one extra lookup by `auditId` into
`chart_headlines` and shows the headline above the chart if one exists, falling back to today's
CBS-table title otherwise. The embed's existing frozen-by-default / Pro-live-refresh split (ADR
041) is unchanged by this: a persisted headline is shown as-is on both the frozen and the
live-refreshed render — it's the journalist's own editorial line, not a claim about which exact
data render is on screen, consistent with decision 2 (fully trusted once written).

### Exports

`chart-download.tsx` already draws wrapped text onto the PNG/SVG canvas for the attribution
footer (`wrapAttributionText`, `FOOTER_LINE_HEIGHT`). The same wrapping helper draws the headline
as a title line above the chart in the exported image — no new export mechanism, no risk of the
export drifting from what's on screen (the existing "serialize what's actually rendered" guarantee
this component was built around is unchanged; the headline is fetched the same way the rest of the
card's content is, before export happens).

## Alternatives considered

- **Session-only / query-param, no DB** (the session's initial recommendation, matching how
  click-to-annotate and chart view-state already work, and how `?form=`/`?theme=` already ride
  embed URLs with no schema change). Rejected by explicit owner choice: the owner wants a headline
  to survive a reload and be editable later from any device, which a client-only or URL-param
  mechanism cannot do.
- **Freeform text box, no AI.** Rejected in the first clarifying round — the owner wants an AI
  first draft, matching #254's "headlines that state the takeaway" framing rather than starting
  from a blank field every time.
- **AI-drafted, locked (not editable).** Rejected — gives no editorial voice, which was the actual
  gap #254 identified.
- **Re-validate edited text against the data (extend the digit-scan to the edited headline too).**
  Rejected by explicit owner choice (decision 2) — accepted as a scoped, documented exception, the
  same shape as ADR 038's annotation exception, not a silent weakening of R1/R3 elsewhere.

## Open questions carried forward (mirror into open-questions.md)

- Exact 140-character cap is this session's judgment call, not an owner-specified number — flag
  as an assumption.
- Whether the headline should visually signal "written by the journalist, not a validated system
  figure" (e.g. a small byline-style label) in the UI and in exports — not decided here; worth a
  design pass during implementation rather than blocking this spec.
- No new ADR number assigned yet — the implementing session writes the ADR from this spec, per
  CLAUDE.md's "every load-bearing technical choice gets an ADR."
