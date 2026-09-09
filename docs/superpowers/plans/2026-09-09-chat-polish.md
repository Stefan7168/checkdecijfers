# Chat polish batch Implementation Plan (owner asks, session 92)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Eight small owner-requested changes to the chat answer card and composer, verbatim from the owner's message of 2026-09-09.

**Architecture:** Pure UI edits in `web/components/chat.tsx`, `web/components/feedback-buttons.tsx`, `web/lib/i18n/messages.ts` (+ tests). No backend, no schema, no new dependency. Every visible string gets an `nl` and an `en` entry; the Dutch entry is the default; no digits in message values.

**Tech Stack:** Next.js 15 / React 19, shadcn `Card`/`Button`, lucide icons, vitest + Testing Library.

## Global Constraints
- The R4 attribution sentence stays fully visible and unshortened in the card footer.
- Digit-honesty tests in `chat.test.tsx` keep passing (the new hint and labels are digit-free).
- Existing Dutch test pins are updated to the new labels, never weakened.
- Commands: `cd web && npx vitest run components/chat.test.tsx components/feedback-buttons.test.tsx components/chat-workspace.test.tsx lib/i18n/messages.test.ts`; typecheck `npx tsc --noEmit -p web` from the root. Commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Labels and strings
**Files:** `web/lib/i18n/messages.ts`, `web/components/feedback-buttons.tsx` (+ `feedback-buttons.test.tsx`), `web/components/chat.tsx` (+ `chat.test.tsx`)

- [ ] `feedback-buttons.tsx`: the thumbs buttons keep their `aria-label` (`feedback.helpful` / `feedback.notHelpful`) but render NO visible text — icon only (remove the `{t('feedback.helpful')}` / `{t('feedback.notHelpful')}` children; keep `size="xs"`, add `aria-label` as the only name). Update tests that query by visible text to `getByRole('button', { name: … })` (the aria-label keeps the same names).
- [ ] `messages.ts`: `chat.copyCitation` → nl `'Kopieer'`, en `'Copy'`; `chat.downloadCsv` → nl `'CSV'`, en `'CSV'`; `chat.connectDatabase` → nl `'Data koppelen'`, en `'Connect data'`; `chat.linkWithSheet` → nl `'Sheet koppelen'`, en `'Link sheet'`. New key `chat.suggestionsHint` → nl `'Suggesties voor een vervolgvraag:'`, en `'Suggested follow-up questions:'`. Keep every other key.
- [ ] `chat.tsx`: render `<p className="mt-2 text-xs text-muted-foreground">{t('chat.suggestionsHint')}</p>` directly ABOVE the suggestions chip row (inside the `message.suggestions.length > 0` block, before the `<div className="mt-2 flex flex-wrap gap-2">`; change that div's `mt-2` to `mt-1`).
- [ ] Tests: update every pin of the old labels ("Kopieer als citaat", "Download als CSV", "Database koppelen", "Koppel een spreadsheet", "Nuttig antwoord" as visible text) across `web/components/*.test.tsx` and `web/app/*.test.tsx` (grep first); add a test that an answer with suggestions shows the hint above the chips and an answer without suggestions shows no hint.
- [ ] Run the tests + typecheck; commit `feat(chat): icon-only thumbs, Copy/CSV labels, Connect data / Link sheet, follow-up hint (owner asks)`.

### Task 2: "Copy" copies the whole answer, with the source link
**Files:** `web/components/chat.tsx` (`CopyCitationButton` → `CopyAnswerButton`), `web/lib/copy-answer.ts` (new, pure), `web/lib/copy-answer.test.ts` (new), `web/lib/chat-message.ts` only if a field is missing.

- [ ] New pure module `web/lib/copy-answer.ts`: `buildAnswerCopy(view: AnswerView, sourceUrl: string | null): { text: string; html: string }`. `text` = the lines, in order, joined by blank lines: `body`, `assumptionLine`, `stalenessWarning`, `definitionLine`, `alternatesLine`, `markingLine` (each only when non-null), then `attribution`, then the URL on its own line when present. `html` = the same lines as `<p>` elements (HTML-escaped), the last one `<p><a href="URL">attribution</a></p>` when a URL exists, else the plain attribution. Tests: null lines skipped, order pinned, escaping (`<` in a body), with/without URL.
- [ ] `sourceUrl` comes from `sourceTableUrl(sourceKeyForTableId(tableId) /* or the message's source */, tableId)` (`web/lib/statline.ts`, `../backend/sources/registry.ts` — mirror exactly what `SourceBadge` does at `source-badge.tsx:41-50`).
- [ ] `CopyAnswerButton({ view, sourceUrl })`: on click, try `navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])`; if `ClipboardItem` is undefined or `write` throws, fall back to `navigator.clipboard.writeText(text)`; on success show `chat.copyCitationCopied` for 2 s as today. Keep the `citation` string (`message.citation`, the R4 flags) appended after the attribution in `text`/`html` as its own line — it carries the provisional/derived flags a quote must keep. The footer renders the button whenever `message.answerView` exists (not only when `citation` is non-null).
- [ ] Tests (`chat.test.tsx`): mock `navigator.clipboard.write` and assert the html contains `<a href="…">` with the attribution and the text contains the body, the definition line and the URL; a second test with `ClipboardItem` undefined asserts `writeText` was called with the text.
- [ ] Commit `feat(chat): Copy copies the whole answer with the source link (owner ask)`.

### Task 3: Card layout and spacing
**Files:** `web/components/chat.tsx` (+ `chat.test.tsx`, `chat-workspace.test.tsx` if a class is pinned)

- [ ] The docked-visual reference button ("Grafiek in het paneel →" / "Chart in panel →", `chat.tsx` ≈ line 960) moves INTO the answer `Card`, top-right, with the text wrapping around it: render it as the FIRST child of `CardContent` with `className="float-right ml-3 mb-1 …"` (keep its pill classes and `aria-pressed`), and give the body `<div>` no float clearing (so text flows beside/under the pill); add `clear-both` on the footer. Only the answer card gets this; refusal/clarification bubbles keep the pill where it is today. Test: in dock mode an answer's pill is inside `[data-slot=card-content]` (or the Card element) before the body text; a long body renders without the pill being `position: absolute` (assert the class list contains `float-right`).
- [ ] Composer/chat width: the two `px-4` wrappers at `chat.tsx:777` (messages) and `:1050` (composer) become `px-3`; the `max-w-2xl` stays.
- [ ] Bottom margin: the pre-send pricing line (the element rendering `chat.pricingDefault` / `pricingBoth` / `pricingWebOnly`, ≈ line 764 usage) gets `mb-2` (one step more space under it); the composer wrapper's `py-3` becomes `pt-3 pb-4`.
- [ ] Tests: pin `px-3` on both wrappers and `pb-4` on the composer wrapper (class assertions on the elements found via an existing testid/role; add `data-testid="chat-composer"` if none exists).
- [ ] Run the four test files + typecheck; commit `feat(chat): chart pill inside the answer card (text wraps), tighter side padding, more room under the price line (owner asks)`.
