# Own-data parity — what a CBS chart can do that an own-data chart cannot (session 126)

**Status:** gap survey done; phase A BUILT (session 126, 2026-09-23). Phases B and C need owner decisions.
Tracked in [open-questions #318](../../open-questions.md). This is #306's candidate (d), picked by the owner at the
start of session 126 ("Own-data parity").

## 1. Why

#306 (session 121) named four architectural candidates. With Eurostat (c) now waiting on owner steps and the
1 October API cap, and two-measure charts (b) held per #296, (d) is the one that can move without AI spend.

## 2. The verified gap table

Survey: a cheap-tier read-only agent, every row checked against code on `main` @ `41662ad`. "Parity already"
rows are listed so nobody re-surveys them.

| Capability | CBS card | Own-data card before session 126 | Needs AI? | Needs owner decision? | Phase |
|---|---|---|---|---|---|
| Small multiples (one mini chart per series) | `web/components/chart.tsx` (`ChartSmallMultiples`) | Absent (`user-chart.tsx` header listed it as "deliberately NOT here") | no | no | **A — built** |
| CSV download of the plotted values | `web/components/chat.tsx` `DownloadCsvButton` + `web/lib/csv.ts` | Absent: ADR 037 D11 said a CSV of user data first needs a formula-injection defense | no | no | **A — built** |
| Public embed page (`/embed/[token]`) and gallery | `web/app/embed-actions.ts` mints a token from an `audit_answers` row | Structurally impossible: own-data has no `audit_answers` row, and publishing a user's uploaded data publicly is a privacy call | no | **yes** (privacy, retention, delete) | B1 |
| Combine own data with CBS data in one chart | n/a | Refused: ADR 037 owner decision "never combined in one chart for v1" | no | **yes** (reverses a locked decision) | B2 |
| Period-range zoom | `chart.tsx` zoom window | Absent; `setPeriodRange` is never valid on an own-data card. Partly covered by the instruction's row filters (Data panel and chat) | no | no | not planned (low value; filters exist) |
| Follow-up suggestion chips after an answer | `src/answer/respond/suggestions.ts` (registry-driven) | Absent; the co-pilot's example chips cover part of it | no | no | not planned (co-pilot chips overlap) |
| Journalist headline figure (drafted) | `chart.tsx` + `chart-headline.ts` | Absent; the reader-chosen headline *command* exists, the big-number block does not | drafting: yes | no | C (escalate on evidence) |
| Insights / story stage | `chart.tsx` `generateInsights`, `ChartStoryStage` | Absent | yes | no | C (escalate on evidence) |
| Alternate reading toggle | registry alternates (ADR 051) | n/a by construction: no registry for an arbitrary file | — | — | not a gap |

**Parity already (not gaps):** all 11 chart forms incl. dumbbell/slope/heatmap and pie/stacked with a reader-designated
total (#312); goal line, era shading, derived overlay, dim-not-hide, headline-override command (ADR 056); PNG/SVG/PDF
image export; style panel, templates; clarification chips; multi-turn follow-ups across resumed threads; own
audit/reconstruction (R8 analog); aggregate/derived arithmetic; incomplete-group disclosure (#314).
**One reverse gap:** own-data chart edits have a per-turn record with 👍/👎; CBS chart edits do not (#286).

## 3. Phase A — built session 126 (no AI call, no schema change, no owner decision)

- **A1 small multiples.** `ChartSmallMultiples` now takes the minimal `PlottableSpec` (a type-only widening; a real
  `ChartSpec` still satisfies it), so the own-data card hands it its existing `toPlottableSpec` adapter. Same gate
  as CBS: Lijn form, more than one series. View-only local state (not a stored command). The image download is
  hidden while it is on (several small `<svg>`s are not one exportable chart), exactly as on the CBS card.
- **A2 CSV download.** `web/lib/user-csv.ts` `buildUserChartCsv(spec, lang)`: the same Dutch-Excel dialect as the
  CBS CSV (`;`, decimal comma, BOM, CRLF). Preamble = the disclaimer line verbatim, the source file and upload date,
  and a "made by" line. One row per plotted point: x, series, exact value (never rounded), the shown value, the cell
  reference (`rowRef` — the traceability handle), and a note (missing-value reason, or the #314 incomplete-group
  note). **The D11 defense** (content-level, as the 2026-09-06 brief's D11 fix specifies,
  [OWASP CSV injection](https://owasp.org/www-community/attacks/CSV_Injection)): every field whose text comes from
  the user's file (headers, series labels, x labels, file name) is left alone when it is a plain number (`-5,2`);
  otherwise leading whitespace/control characters are looked through, and a field whose text then starts with `=`,
  `+`, `-` or `@` (or that opens with TAB/CR) gets a leading `'`. The numbers we serialize ourselves are never
  prefixed, so a negative number stays a number.
- **Follow-up (same session, owner "fix all"):** the own-data card's image download menu is now offered only where
  there is one chart `<svg>` to export (not in Tabel, Warmtekaart or small multiples, same as the CBS card), and it
  now gets the chart's language and frame, as chart.tsx's call does.

## 4. Phase B — needs the owner

> **Decided 2026-09-24 (session 127):** B1 yes (design: [2026-09-24-own-data-publish-design.md](2026-09-24-own-data-publish-design.md),
> ADR 057 — a saved publish record, not a signed link); B2 wait for evidence.

- **B1 publish an own-data chart (embed link / gallery).** The biggest remaining parity gap and the one that matters
  for the "graphmaker" positioning. Open questions for the owner: may a user make their uploaded data public at all?
  If yes: opt-in per chart, a visible "unverified, from the user's own file" frame on the public page, and the
  public page must die when the user deletes the file or the 2-year retention purge runs (GDPR, #189). Needs a
  turn-keyed embed token (likely a migration). Recommendation: yes, opt-in per chart, snapshot the plotted points
  only (never the raw file), link dies on delete.
- **B2 own data + CBS in one chart.** Reverses ADR 037's locked "never combined for v1". Needs its own brainstorm and
  ADR (ADR 037's own revisit trigger). Recommendation: wait for usage evidence.

## 5. Phase C — AI features, escalate only on evidence

Drafted headline figure and Insights/story for own data both need an LLM call per chart. Per the cheapest-mechanism
rule (CLAUDE.md), build only once logged usage shows people want them.
