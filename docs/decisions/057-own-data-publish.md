# ADR 057 — Publishing an own-data chart: a saved, revocable, pruned snapshot

**Status:** accepted 2026-09-24 (session 127, owner present, decided in chat). Design:
[superpowers/specs/2026-09-24-own-data-publish-design.md](../superpowers/specs/2026-09-24-own-data-publish-design.md).
**BUILT (session 127, 2026-09-24), dark behind `OWN_DATA_PUBLISH_ENABLED` — see the as-built note below.
Owner steps (migration 036, the flag, a live check) are still pending; see
[RUNBOOK.md](../RUNBOOK.md)'s "Own-data publishing (ADR 057) — switching it on".**

## Context

Own-data parity ([#318](../open-questions.md)) left one large gap: a CBS chart can be published as a public
link/embed (ADR [041](041-public-embed-pages.md)), a chart made from an uploaded file cannot. The owner decided
(2026-09-24) that users may publish own-data charts, opt-in per chart, and that own data and CBS data still never
share one chart (ADR [037](037-user-data-attachments.md) stands; B2 waits for evidence).

Own data differs from CBS data in the ways that matter here: it is personal (GDPR, #189), the author may have
hidden some of it on screen, the on-screen chart can differ from the first-made chart (data commands re-render
it, ADR [056](056-chart-copilot.md)), and file names can be revealing.

## Decision

1. **A saved publish record** (`published_user_charts`, migration 036) holds the frozen chart command log, the
   author's optional source line (≤120 chars) and a random 22-character `public_id`. One live publication per
   chart per author; updating keeps the link; unpublish hard-deletes the row (the link dies at once).
2. **What is published is exactly what the author sees.** The publish action replays the log server-side and
   refuses if any command would be dropped.
3. **Pruning before serialization (new invariant P1):** hidden series (blanked in place, with the notes and
   calculations tied to them), the file name, the source URL host, the content hash, the raw cells and the profile never reach a visitor's
   browser.
4. **Re-derived on every request** from the immutable stored cells (U12) through the same builders the card
   uses (`renderInstructionForDataset`, `deriveChartOverlay`) — no new code computes a
   number, so U1/U5/U6 hold by reuse.
5. **Rendered by the own-data card in a read-only `publicMode`**, never by `ChartView` (ADR 037 D11).
6. **Deletion:** the shared `redactTurnsForDatasets` leg hard-deletes publications in the same transaction, so
   file deletion, account deletion and the 2-year retention purge all kill the link; the page also checks the
   dataset's status on every request.
7. Free, no AI, noindex, max 50 live publications per author, behind `OWN_DATA_PUBLISH_ENABLED` (fails closed).
   Route `/embed/own/[publicId]` reuses the `/embed/` proxy prefix, framing headers and layout signal.

## Alternatives considered

- **ADR 041's stateless signed token over the dataset turn id** (no migration — the cheapest mechanism, and the
  first one considered per the cheapest-first rule). Rejected by the owner: it can only publish the chart as
  first made (ignoring later data commands and hidden series, so it could expose data the author hid), and the
  only takedown is deleting the whole file. Fine for public CBS data; not for personal data.
- **Signed token carrying the view state in the URL.** Avoids a table, but URLs become huge and still can't be
  revoked per chart. Rejected.
- **Show the file name as the source.** Most transparent, but leaks names like `klanten_vertrouwelijk.xlsx`.
  Rejected in favour of an author-typed line with a neutral default.
- **A public gallery of user charts.** Needs moderation; out of scope until there is demand.

## Consequences

- A live-DDL step (migration 036) and an env flag flip, both owner-supervised.
- A second public surface that hosts author-written text (titles, notes, source line) on our domain — noindex,
  plain text only, no rendered links; abuse is a revisit trigger.
- The own-data card gains a read-only mode that later features (e.g. a stage/story mode) can reuse.

## As built (session 127, 2026-09-24)

Built via `superpowers:subagent-driven-development`, 6 tasks (migration + store, server-side replay + pruning,
server actions, read-only card mode, the public route, the publish dialog + flag plumbing) plus a final
whole-branch review and two fix waves, all on branch `own-data-publish` (worktree
`/Users/amity/Documents/cdc-own-data-publish`), base `598d0f10`:

```
550d817a feat: migration 036 + publications store + retention leg
4be0cfc0 feat: server-side replay + P1 pruning
61a5cbd9 fix: fix round 1 for Task 2 — C1/C2/I3/M6
4ebebb38 fix: fix round 2 for Task 2 — C1, by label not position
60913593 feat: publish/unpublish server actions
2fb2b0f5 fix: move normalizeSourceLine out of the 'use server' file
1eeb9736 feat: read-only publicView mode on the own-data card
84582e8c fix: fix round 1 for Task 4 — I1/R7/R8
a194e101 feat: public route /embed/own/[publicId]
45b75bfd feat: publish dialog + flag plumbing
3b7d9c21 fix: final-review privacy/fidelity fixes A1-A7
4606c5d2 test: end-to-end P1 test with the real card (final review D)
99eceb7b fix: final-review robustness/copy fixes B2-B5, C2
302c38f3 fix: re-review follow-ups m1-m3
```

**Files:** migration `migrations/036_published_user_charts.sql`; store `src/attachments/publications.ts`;
server-side replay + pruning `web/lib/own-chart-publication.ts`; the sealed/verified publish log
`web/lib/own-chart-publish-log.ts`; the source-line normalizer (pulled out of the server-action file so a
`'use server'` file never exports a plain sync function) `web/lib/publication-source-line.ts`; server actions
`web/app/own-chart-publish-actions.ts`; the public route `web/app/embed/own/[publicId]/page.tsx`; the publish
dialog `web/components/own-chart-publish-dialog.tsx`; the card's read-only mode and public-mode form-fallback
logic, in the existing `web/components/user-chart.tsx`; i18n strings in `web/lib/i18n/messages.ts`.

**Measured web test suite (final commit `302c38f3`):** 158 test files, 2,951 tests, all passing, one
foreground `npx vitest run` from `web/`. `npm run web:typecheck` and `npm run typecheck` both clean. The
backend suite count is measured at merge time — see [STATUS.md](../STATUS.md), not restated here to avoid a
stale number.

**A privacy-critical review chain, not a straight build.** The final whole-branch review (base `598d0f10`,
tip `45b75bfd`) found one Critical and two Important gaps a more surface-level pass would have missed, because
each one only shows up when the pruning is checked against the REAL pipeline rather than against hand-built
fixtures: a hidden series' own category name could still leak through a blanked slot's kept `xKey`/`xLabel`
(closed by ruling R11 — see the spec's §3.5 as-built note); the public page still rendered a chart when the
stored log no longer fully replayed against today's code (closed by ruling R12, fail closed); and the 200-entry
undo-history cap could silently trim what got published, and the unsealed transient part of an edit was never
sent at all (closed together by rulings R13/R14, a client-side replay-and-compare check before the server is
ever called — see the spec's §3.2 as-built note). The fix wave that closed these also introduced two new
fallback-to-table gaps in the pie and heatmap forms (a hidden slice at its own category, and a heatmap with only
one of two series visible), caught by a re-review and closed in one small follow-up (ruling R17, commit
`302c38f3`).

**Known v1 differences from "an exact frozen snapshot," each a deliberate, documented trade — not bugs:**
- **The public page renders with the author's CURRENT account style, not the style at publish time.**
  `web/app/embed/own/[publicId]/page.tsx` looks up the author's saved chart style (`getUserChartStyle`) fresh on
  every request; if the author changes their default look after publishing, every one of their public pages
  picks it up immediately. This includes the **presentation language**: a language set in the author's account
  style overrides the page's own `?lang=` URL parameter for the chart itself (the URL parameter still controls
  the page's own chrome — the "no longer available" message and the footer link text). Revisit if this
  surprises an author in practice.
- **The small-multiples toggle is not saved,** so a public page always shows one chart, never the small-multiples
  grid, even if the author had it turned on while editing (same as the CBS-tier embed: it is view-only local
  state, not a stored chart command).
- **Verified-whole is not shown publicly in v1** (§3.5): a published pie/stacked/100%-stacked chart always shows
  the honest "not checked" note, never the reader-designated-total verdict the author may see on their own
  screen.
- **The code-drift guard (`firstRenderMatchesEnvelope`) covers only the chart AS FIRST MADE**, not every later
  data command replayed on top of it. A data command added after the first render is validated against
  TODAY'S code when the log is replayed (and the whole page fails closed if any command is dropped, ruling R12),
  but is not independently re-checked for the kind of series-identity drift the first-render guard catches.
- **One extra deterministic render per public page view.** The drift guard re-renders the turn's first
  instruction purely to compare series labels against the stored envelope; this doubles the render work for the
  first chart on every visitor request. Not measured to matter at today's traffic; a revisit trigger if it ever
  does.

## Revisit triggers

Demand for the "parts add up to the total" verdict on public pages (v1 shows the honest "not checked" note) →
a publication-scoped check restricted to published points. 
Abuse reports or evidence of spam/phishing via published text → report link + takedown script. Demand for a user
gallery → its own design. Evidence users want own data next to CBS data → ADR 037's B2 revisit.
