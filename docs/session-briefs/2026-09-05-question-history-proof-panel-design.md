# Question-history proof panel — design (session 80, 2026-09-05)

Source: [open-questions #199](../open-questions.md) — session 72's source drill-through cluster
(#70/#79/#89, [session-briefs/2026-09-03-source-drill-through-design.md](2026-09-03-source-drill-through-design.md))
shipped on chat answers only; that brief's own §7 named "History excluded — needs its own small
`history.ts` WP" as an accepted, out-of-scope risk. This is that WP. Brainstormed in-chat per
`CLAUDE.md`'s process; every path/line below was verified by reading the code on 2026-09-05, not
assumed from the original brief's framing.

**Decision (owner): full panel, reused as-is — not a lighter/explainer-only variant.** The whole
point of #70/#79/#89 was letting people verify their own numbers; that need doesn't shrink because
they're looking at history instead of live chat. A lighter variant would also be new scope beyond
what #199 was ever asked to be ("needs its own SMALL read-model WP").

## 1. The gap, precisely

`getQuestionHistory` (`src/billing/history.ts:155`) reads `audit_answers` via hand-picked
`response->...->>'...'` JSON-path extractions (`answer_body`, `answer_definition_line`,
`answer_marking_line`, `answer_attribution_line`, `answer_staleness_warning`) — never
`result.cells`/`result.derivations`. `buildAnswerProof` (`web/lib/answer-proof.ts:332`) needs the
whole `AnswerResponse` (specifically its `result: ValidatedResult`), so it cannot run against what
`getQuestionHistory` currently selects.

## 2. Approach — mirror the pattern chat resume already uses, don't invent a new one

Thread resume needs the exact same thing (a historical stored envelope → a proof panel) and already
solves it: `getThreadRows` (`src/threads/index.ts:195`) selects `a.response` — the FULL column, no
narrowing — which flows through `replayParts` → `assembleMessages` (`web/lib/replay-assemble.ts:113`,
`proof: answer !== null ? buildAnswerProof(answer) : null`) → `loadMyThread` (`web/app/actions.ts:911`).
`getQuestionHistory` is simply the one place that predates the proof-panel feature and never picked up
this pattern.

**Change:** add `a.response` to `getQuestionHistory`'s existing `select` list, alongside (not
replacing) its current narrow extractions — those feed other logic (credits, redaction, #115 display
fields) that isn't part of this WP and shouldn't be touched. Then, in the row-mapping code right after
the query, for each row: `proof: row.kind === 'answer' ? buildAnswerProof(row.response) : null`.

**New field on `QuestionHistoryEntry`** (`src/billing/history.ts`, alongside the existing #115
`answerView`-style fields): `proof: AnswerProof | null`.

`buildAnswerProof` is a pure, framework-agnostic function (no React) already proven safe on
malformed/historical envelopes: `if (!Array.isArray(result?.cells)) return null;`, wrapped in
`try/catch`. No new defensive code needed on the history side.

## 3. GDPR redaction — checked, not assumed safe

A redacted row's `response` column is already overwritten by `redactedResponse()`
(`src/answer/audit/retention.ts:147`) with a minimal `{schemaVersion, kind, question, text, redacted}`
object — no `result` key at all, deliberately ("drops everything else... answer bodies, chart specs,
parse/query internals"). `buildAnswerProof`'s own `result?.cells` guard therefore returns `null` for
every redacted row automatically — no new redaction-awareness needed in this WP; the existing #14
design already produces the right outcome for free.

## 4. UI wiring

`QuestionHistory` (`web/components/question-history.tsx`) is a Server Component (no `'use client'` —
native `<details>`/`<summary>` needs no client JS). `AnswerProof` (`web/components/answer-proof.tsx`,
`'use client'`) manages its own expand/collapse state internally, so `QuestionHistory` does not need to
become a client component — it renders `<AnswerProof proof={entry.proof} />` as a plain child, exactly
the one-line conditional `chat.tsx:807` already uses
(`{message.proof !== null ? <AnswerProof proof={message.proof} /> : null}`). Placed next to each
entry's existing answer-text rendering, inside the same collapsed-by-default fold the entry itself
already uses (no new top-level toggle).

## 5. Scope

**In:** `kind === 'answer'` entries only — the only kind with a validated `result` to show proof for.
**Out (proof is `null`, by construction, no special-casing needed):** `clarification` (pending, no
result yet), `refusal` (no result), `onboarding_pending` (`source: 'onboarding'`, a different table
entirely, never has a `response` column to read), any redacted row (§3 above).

## 6. Test plan

- `history.test.ts` (or wherever `getQuestionHistory`'s existing tests live): an answer-kind row with a
  real stored `response` produces a `proof` field deep-equal to calling `buildAnswerProof` on that same
  response directly (parity, not reimplementation); a refusal/clarification/onboarding row has
  `proof: null`; a redacted answer-kind row has `proof: null`.
- `question-history.test.tsx` (render test): an entry with a non-null `proof` renders the
  `AnswerProof` panel (e.g. its depth-1 explainer text is present, collapsed by default); an entry
  with `proof: null` renders no panel and no crash.

## 7. Build order and size

**Small, one focused pass:** (1) widen the SQL + add the `proof` field + its unit test; (2) wire
`<AnswerProof>` into `question-history.tsx` + its render test. No migration, no schema change, no new
component, no flag. #118: core-product, owner-present this session ⇒ push to `main` directly once
verified.

## Open points carried into implementation (not blocking this design)

- Whether to also drop the now-partially-redundant individual `->>'` extractions
  (`answer_body`/`answer_definition_line`/etc.) in favor of deriving them from the fetched
  `response` object in JS — deliberately NOT proposed here: those fields feed other logic this WP
  isn't touching, and the minimal change is additive (one more column), not a refactor of working
  code.
- Exact query cost of adding a full JSONB column to a 20-row page load is unmeasured — but
  `getThreadRows` already does this for potentially-longer threads with no reported issue, so this
  isn't treated as a real risk, just unmeasured.
