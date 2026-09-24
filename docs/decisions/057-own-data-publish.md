# ADR 057 — Publishing an own-data chart: a saved, revocable, pruned snapshot

**Status:** accepted 2026-09-24 (session 127, owner present, decided in chat). Design:
[superpowers/specs/2026-09-24-own-data-publish-design.md](../superpowers/specs/2026-09-24-own-data-publish-design.md).
Not yet built — an as-built note is added here when it lands.

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

## Revisit triggers

Demand for the "parts add up to the total" verdict on public pages (v1 shows the honest "not checked" note) →
a publication-scoped check restricted to published points. 
Abuse reports or evidence of spam/phishing via published text → report link + takedown script. Demand for a user
gallery → its own design. Evidence users want own data next to CBS data → ADR 037's B2 revisit.
