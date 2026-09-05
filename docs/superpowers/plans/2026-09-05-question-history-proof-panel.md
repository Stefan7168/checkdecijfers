# Question-History Proof Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the existing "Bewijs dit cijfer" proof panel on the question-history dashboard, not just live chat and thread resume.

**Architecture:** Widen `getQuestionHistory`'s SQL to also read the full `response` column (mirroring `getThreadRows`, which already does this for chat-thread resume) and decode it into a new `answerEnvelope: AnswerResponse | null` field on `QuestionHistoryEntry`. `buildAnswerProof` itself is NOT called in `history.ts` — it lives in `web/lib/answer-proof.ts` (frontend), and `src/billing/history.ts` is backend code that must not import from `web/` (ADR 001 module boundaries). Instead, `question-history.tsx` (already a web-layer file) calls `buildAnswerProof(item.answerEnvelope)` at render time, exactly where `chat.tsx` already does the same thing for a live answer.

**Tech Stack:** TypeScript, Next.js App Router (Server Component), Postgres/pglite, Vitest, `@testing-library/react`.

## Global Constraints

- R1/R8 (docs/05-data-rules.md): every digit `buildAnswerProof` shows must trace to a stored cell/derivation — this plan adds no new number formatting, it only wires already-audited logic to a new call site.
- ADR 001 module boundaries: `src/` (backend) must never import from `web/` (frontend). `web/` may import `src/` only via the `web/backend` symlink.
- #14 GDPR redaction: a redacted row's stored `response` already has no `result` key (`redactedResponse()`, `src/answer/audit/retention.ts`) — `buildAnswerProof`'s own `result?.cells` guard already returns `null` for it. No new redaction-specific code in this plan.
- Design source: [docs/session-briefs/2026-09-05-question-history-proof-panel-design.md](../../session-briefs/2026-09-05-question-history-proof-panel-design.md). One refinement from that doc, decided during planning: `buildAnswerProof` is called in `question-history.tsx`, not inside `getQuestionHistory` — the design doc's §2 said the latter, which would have crossed the `src/`→`web/` boundary above. The approach (mirror `getThreadRows`) is unchanged; only which file calls `buildAnswerProof` moved.

---

### Task 1: `getQuestionHistory` exposes the decoded answer envelope

**Files:**
- Modify: `src/billing/history.ts:106-113` (`QuestionHistoryEntry` interface), `:115-129` (`HistoryRow` interface), `:160-234` (the SQL query + `fetched` row-mapping), `:319-361` (clarification-pairing + main entry construction), `:387-402` (onboarding entry construction)
- Test: `tests/billing/history.test.ts`

**Interfaces:**
- Consumes: `ComposedResponse`, `AnswerResponse` (`src/answer/respond/types.ts`, already exported — `export type ComposedResponse = AnswerResponse | ClarificationResponse | RefusalResponse;`, `export interface AnswerResponse extends ResponseBase { kind: 'answer'; ... }`).
- Produces: `QuestionHistoryEntry.answerEnvelope: AnswerResponse | null` — consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Add to `tests/billing/history.test.ts`, right after the existing `describe('getQuestionHistory — structured answer parts (#115)', ...)` block (after its closing `});`, so it sits next to the sibling feature it parallels):

```typescript
// #199: the decoded answer envelope for the dashboard's proof panel.
// question-history.tsx builds the actual AnswerProof from this (a
// backend module must not import web/lib/answer-proof.ts — ADR 001).
describe('getQuestionHistory — answer envelope for the proof panel (#199)', () => {
  const PROOF_ENVELOPE = {
    kind: 'answer',
    answer: { body: 'Nederland telde in 2024 18.044.027 inwoners.' },
    result: {
      shape: 'single',
      cells: [
        {
          resultId: '03759ned:M000352:NL01:2024JJ00:D',
          tableId: '03759ned',
          measure: 'M000352',
          measureTitle: 'Bevolking op 1 januari',
          regionCode: 'NL01',
          regionLabel: 'Nederland',
          periodCode: '2024JJ00',
          periodLabel: '2024',
          dims: {},
          dimLabels: {},
          value: 18044027,
          decimals: 0,
          unit: 'aantal',
          status: 'Definitief',
          provisional: false,
          valueAttribute: 'None',
        },
      ],
      derivations: [],
      attribution: {
        tableId: '03759ned',
        tableTitle: 'Bevolking; geslacht, leeftijd',
        tableVersion: 1,
        syncedAt: '2026-01-01T00:00:00.000Z',
        coveredPeriods: { from: '2024JJ00', to: '2024JJ00' },
        license: 'CC BY 4.0',
        definitionLabel: null,
      },
    },
  };

  it('exposes the decoded answer envelope on an answer entry', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await insertAuditRow(db, userId, {
        kind: 'answer',
        question: 'Hoeveel inwoners heeft Nederland?',
        finalText: 'blob',
        requestId: null,
        envelope: PROOF_ENVELOPE,
      });
      const [entry] = await getQuestionHistory(db, userId);
      expect(entry!.answerEnvelope).toEqual(PROOF_ENVELOPE);
    });
  });

  it('null answerEnvelope on refusals, clarifications, and redacted answer rows', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      await insertAuditRow(db, userId, {
        kind: 'refusal',
        question: 'r',
        finalText: 'weigering',
        requestId: null,
        envelope: { kind: 'refusal', question: 'r', text: 'weigering' },
      });
      const redactedId = await insertAuditRow(db, userId, {
        kind: 'answer',
        question: 'zal verwijderd worden',
        finalText: 'x',
        requestId: null,
        envelope: PROOF_ENVELOPE,
      });
      // Mirrors retention.ts's redactedResponse('answer') shape exactly —
      // no `result` key, `kind` preserved.
      await db.query('update audit_answers set response = $2::jsonb where id = $1', [
        redactedId,
        JSON.stringify({ schemaVersion: 1, kind: 'answer', question: 'Deze vraag is verwijderd.', text: 'Deze vraag is verwijderd.', redacted: true }),
      ]);
      const history = await getQuestionHistory(db, userId);
      expect(history).toHaveLength(2);
      for (const entry of history) expect(entry.answerEnvelope).toBeNull();
    });
  });

  it("a collapsed clarification round carries the REPLY row's answerEnvelope", async () => {
    // Exact structure of the existing #115 test with the same name/shape
    // (search this file for "carries the REPLY row's answerParts") — no
    // chargeAndRun needed, pairing works off question + repliedQuestionNl
    // matching offeredQuestionNl alone.
    await withDb(async (db) => {
      const userId = randomUUID();
      const questionNl = 'Welke gemeente bedoel je?';
      await insertAuditRow(db, userId, {
        kind: 'clarification',
        question: 'Hoeveel inwoners heeft de gemeente?',
        finalText: questionNl,
        requestId: null,
        offeredQuestionNl: questionNl,
      });
      await insertAuditRow(db, userId, {
        kind: 'answer',
        question: 'Hoeveel inwoners heeft de gemeente?',
        finalText: 'Amsterdam telt 931.298 inwoners.',
        requestId: null,
        replyText: 'Amsterdam',
        repliedQuestionNl: questionNl,
        envelope: PROOF_ENVELOPE,
      });
      const history = await getQuestionHistory(db, userId);
      expect(history).toHaveLength(1);
      expect(history[0]!.clarification).not.toBeNull();
      expect(history[0]!.answerEnvelope).toEqual(PROOF_ENVELOPE);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/billing/history.test.ts -t "#199"`
Expected: FAIL — `answerEnvelope` does not exist on the returned entries (TypeScript error or `undefined` in the assertion).

- [ ] **Step 3: Add the `AnswerResponse`/`ComposedResponse` import and the local decode helper**

In `src/billing/history.ts`, add to the top imports (after the existing `import type { Db } from '../db/types.ts';` line):

```typescript
import type { AnswerResponse, ComposedResponse } from '../answer/respond/types.ts';
```

Add this function near the top of the file, after the imports, before `export interface QuestionHistoryEntry`:

```typescript
// Mirrors src/threads/index.ts's own (unexported) decodeResponse — the pg
// driver may return a JSONB column already parsed or still as a string
// depending on configuration; duplicated here rather than importing across
// the threads/billing module boundary for a two-line helper.
function decodeResponse(raw: unknown): ComposedResponse {
  return typeof raw === 'string' ? (JSON.parse(raw) as ComposedResponse) : (raw as ComposedResponse);
}
```

- [ ] **Step 4: Add `answerEnvelope` to `QuestionHistoryEntry` and `HistoryRow`**

In `src/billing/history.ts`, immediately after the existing `answerParts` field (the closing `} | null;` at line 112, before the interface's closing `}` at line 113):

```typescript
  /** #199: the decoded answer envelope, for the dashboard's "Bewijs dit
   * cijfer" proof panel — question-history.tsx builds the actual
   * AnswerProof from this via buildAnswerProof (web/lib/answer-proof.ts).
   * Set only when this row IS an answer whose stored envelope decodes with
   * kind 'answer' — null for refusals, clarifications, and redacted rows
   * (retention.ts's redactedResponse still sets kind, but strips `result`
   * entirely, so buildAnswerProof's own guard returns null for those safely
   * — no redaction check needed here, matching chat.tsx/replay-assemble.ts's
   * own unconditional `response.kind === 'answer' ? buildAnswerProof(...) :
   * null` pattern). */
  answerEnvelope: AnswerResponse | null;
```

In the `HistoryRow` interface, immediately after its own `answerParts: QuestionHistoryEntry['answerParts'];` line:

```typescript
  answerEnvelope: QuestionHistoryEntry['answerEnvelope'];
```

- [ ] **Step 5: Add `a.response` to the SQL select list**

In `src/billing/history.ts`, in the `select` list inside `getQuestionHistory`, add `a.response,` immediately after the existing `a.reply_text,` line (mirroring `getThreadRows`, `src/threads/index.ts:204`, which selects the same column the same way):

```typescript
       a.reply_text,
       a.response,
```

- [ ] **Step 6: Compute `answerEnvelope` in the row-mapping block**

In the `fetched: HistoryRow[] = rows.map((row) => ({ ... }))` block, add this field (placement: right after the existing `answerParts: ...` computation, so the two envelope-derived fields sit together):

```typescript
    answerEnvelope: (() => {
      const decoded = decodeResponse(row.response);
      return decoded.kind === 'answer' ? decoded : null;
    })(),
```

- [ ] **Step 7: Carry `answerEnvelope` through clarification-pairing and both entry-construction sites**

In the clarification-pairing block, immediately after the existing `match.entry.answerParts = row.answerParts;` line:

```typescript
        match.entry.answerEnvelope = row.answerEnvelope;
```

In the main (non-paired) entry construction object, immediately after `answerParts: row.answerParts,`:

```typescript
        answerEnvelope: row.answerEnvelope,
```

In the onboarding entry construction object, immediately after `answerParts: null,`:

```typescript
        answerEnvelope: null,
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/billing/history.test.ts`
Expected: PASS — all tests in the file, including the new `#199` describe block (the full file, not just `-t "#199"`, since Steps 3-7 changed a shared interface every other test in this file also constructs against).

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: PASS. If it fails on `web/components/question-history.test.tsx`'s `entry()` helper (a function returning a full, non-Partial `QuestionHistoryEntry` without the new required field), that fixture needs `answerEnvelope: null` added to its default object — fix it now even though Task 2 owns that file, since a broken build blocks Task 1's own commit.

- [ ] **Step 10: Commit**

```bash
git add src/billing/history.ts tests/billing/history.test.ts web/components/question-history.test.tsx
git commit -m "feat(#199): getQuestionHistory exposes the decoded answer envelope"
```

---

### Task 2: Render the proof panel in `QuestionHistory`

**Files:**
- Modify: `web/components/question-history.tsx`
- Test: `web/components/question-history.test.tsx`

**Interfaces:**
- Consumes: `QuestionHistoryEntry.answerEnvelope` (Task 1); `buildAnswerProof(response: AnswerResponse): AnswerProof | null` and `AnswerProof` (`web/lib/answer-proof.ts`, already exported, unmodified); `AnswerProof` the React component (`web/components/answer-proof.tsx`, already exported, unmodified, `'use client'`, manages its own expand/collapse state).
- Produces: nothing new for later tasks — this is the last task in this plan.

- [ ] **Step 1: Write the failing test**

Add to `web/components/question-history.test.tsx`, after the existing `onboardedAnswerEntry()` helper function:

```typescript
import { fakeAnswerResponse, fakeCell } from '../test/fake-answer.ts';

function entryWithProof(): QuestionHistoryEntry {
  return entry({
    question: 'Hoeveel inwoners heeft Nederland?',
    // fakeAnswerResponse's own default `cells` is [] (empty) — buildAnswerProof
    // doesn't reject that (Array.isArray([]) is true) but AnswerProof's trigger
    // label depends on the count (answer-proof.tsx:88), so pass exactly one
    // cell explicitly to get the singular 'Bewijs dit cijfer' the test below
    // asserts on, rather than relying on an unstated default.
    answerEnvelope: fakeAnswerResponse({
      body: 'Nederland telde in 2024 18.044.027 inwoners.',
      shape: 'single',
      cells: [fakeCell({ regionCode: 'NL01', regionLabel: 'Nederland', value: 18044027, decimals: 0, unit: 'aantal' })],
    }),
  });
}
```

(Add the `import { fakeAnswerResponse, fakeCell } from '../test/fake-answer.ts';` line up with the file's other imports at the top, not inline where shown above — shown here next to its first use for clarity.)

Then add a new test, near the existing `#115` structured-answer-parts tests:

```typescript
describe('proof panel (#199)', () => {
  it('renders the proof panel when the entry has an answerEnvelope', () => {
    render(<QuestionHistory items={[entryWithProof()]} />);
    // AnswerProof's own trigger button text (answer-proof.tsx:88) — 'Bewijs
    // dit cijfer' singular because fakeAnswerResponse's default is one cell
    // (fakeCell()); confirms the panel mounted without depending on its
    // internal markup.
    expect(screen.getByText('Bewijs dit cijfer')).toBeInTheDocument();
  });

  it('renders no proof panel when answerEnvelope is null', () => {
    render(<QuestionHistory items={[entry()]} />);
    expect(screen.queryByText('Bewijs dit cijfer')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run web/components/question-history.test.tsx -t "proof panel"`
Expected: FAIL — the trigger text is not in the document (no proof panel rendered yet).

- [ ] **Step 3: Import `AnswerProof` and `buildAnswerProof`**

In `web/components/question-history.tsx`, add to the imports (near the existing `import { splitDefinitionForDisplay } from '../lib/definition-display.ts';` line):

```typescript
import { buildAnswerProof } from '../lib/answer-proof.ts';
import { AnswerProof } from './answer-proof.tsx';
```

- [ ] **Step 4: Render the panel**

In the `.map((item) => { ... })` render body, immediately after the existing block:

```tsx
                {item.answerParts !== null ? (
                  <AnswerBody parts={item.answerParts} />
                ) : (
                  <div className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{item.finalText}</div>
                )}
```

add:

```tsx
                {item.answerEnvelope !== null ? (() => {
                  const proof = buildAnswerProof(item.answerEnvelope);
                  return proof !== null ? <AnswerProof proof={proof} /> : null;
                })() : null}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run web/components/question-history.test.tsx`
Expected: PASS — the full file, not just the new tests (confirm nothing else in this file broke).

- [ ] **Step 6: Typecheck**

Run: `npm run web:typecheck`
Expected: PASS.

- [ ] **Step 7: Full verification block**

Run (per CLAUDE.md's definition of done — this touches `src/billing/` and `web/components/`, not the answer/validate pipeline, so `audit:verify` is not required, but the full suites are):

```bash
npm run typecheck && npm run web:typecheck && npm test && npm run benchmark:run && npm run benchmark:score && npm run web:test && npm run web:build
```

Expected: every step passes; benchmark GATE VERDICT: PASS.

- [ ] **Step 8: `/code-review` low effort on the diff**

Per CLAUDE.md's session-49 addition: run `/code-review` at LOW effort over the combined diff from both tasks before pushing. Fix any confirmed finding.

- [ ] **Step 9: Commit**

```bash
git add web/components/question-history.tsx web/components/question-history.test.tsx
git commit -m "feat(#199): render the proof panel on the question-history page"
```

- [ ] **Step 10: Update docs**

- `docs/open-questions.md` row #199: change from "DESIGNED... not yet built" to "BUILT + verified", with the final commit SHAs and measured test counts.
- `docs/STATUS.md`: add to the current session's block.
- Push directly to `main` (owner-present session, #118 standing authorization) once CI gate is green.
