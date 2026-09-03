<!-- Written by session 72 (2026-09-03, autonomous) by a Fable-tier design agent; reviewed by the session. Status: DEFAULTS TAKEN per the owner's 2026-07-25 'document, don't escalate' steer — veto by exception. The build lands as a PR for owner review (#118 rule b). -->

# Design brief — the source drill-through cluster (#70 + #79 + #89 + #90-deep)

*One surface, three depths.* Build-ready; every path and field below was verified by reading the code on 2026-09-03 (`da6dfab`). Defaults taken per the owner's "document, don't escalate" steer — veto by exception (§7).

## 1. Decisions taken as defaults

| # | Decision | Default | Why |
|---|---|---|---|
| D1 | Inline vs side panel | **Inline disclosure under the answer, collapsed by default** | ADR 033 D4 docks *visuals* only and has no dock below `lg`; a side panel needs a second mobile design plus dock-tab state on replay. 10-ux-design-brief §5: per-message affordances stay in the bubble. |
| D2 | Internal ids | **Human labels; ids/codes behind one `Technische details` toggle** (the brief's recommendation) | A journalist reads "Amsterdam, 2024"; `86141NED:CPI000000:NL01:2024JJ00` is for the CSV/audit reader, one click away. |
| D3 | Copy tone | **Impersonal, verb-first labels** ("Gelezen:", "Verschil berekend:"), no "ik"/"wij" | Refusals speak as "ik", onboarding as "we"; the panel is a ledger, not a speaker. Reuses existing vocabulary verbatim (CSV headers, `Periodebetekenis:`, ` (voorlopig cijfer)`, the null-reason labels). |
| D4 | One control or three | **ONE button opens ONE panel with depths 1→2→3 stacked**; the only nested control is the technical toggle | Three accordions = "three ways to say show me the proof" (build plan). Two clicks reach everything. |
| D5 | Placement | First item in the existing `Kopieer als citaat` / `Download als CSV` row (`chat.tsx`, the `mt-0.5 flex flex-wrap items-center gap-3` div, same `text-xs text-ink-muted underline` style); panel directly under that row, **before** chart / `in het paneel` chip / suggestion chips / web section | Web section stays LAST (ADR 032). Attribution chip, feedback row and cost line untouched. |
| D6 | Mobile | Same panel; the cell table scrolls inside `overflow-x-auto` (the `chart.tsx` table-view pattern) | No drawer, no second layout. |
| D7 | Keyboard / SR | Native `<button aria-expanded aria-controls={panelId}>`; panel `<div id role="region" aria-label="Onderbouwing van dit antwoord">`; toggle `<button aria-pressed>`; ids via `useId()` (`chart-download.tsx` `menuId`); chevron `aria-hidden`; label constant | Native buttons give Enter/Space for free. |
| D8 | Surfaces | **Chat answers only — live turn AND thread resume.** Not the dashboard history, trial, or dock | `src/billing/history.ts` (lines 173–177) extracts `answerParts` by SQL JSON path — body/definition/marking/attribution/staleness, no cells — so history needs a backend read-model change: out, follow-up row. `trial-chat.tsx` renders `message.text` in its own list (lines 97–102), not `Chat`: out. |
| D9 | Derivations shown | difference, max, direction, unit_expansion; **`first_last` skipped** (no value — a binding aid) | Everything a reader can follow. |
| D10 | Existing `alternatesLine` | **Kept, not moved or duplicated** | It is a line of the R8 `text`; `chat.test.tsx`'s zero-loss pin walks every line of `text`. #89's "upgrade" = the affordance now exists beside it. |

## 2. The surface

**`web/lib/answer-proof.ts`** (pure leaf, no React) — `buildAnswerProof(response: AnswerResponse): AnswerProof | null`, built ONCE at receive time and at replay time: the `buildCitation` / `buildAnswerCsv` / `statCardData` pattern (ADR 033 ⟨A3⟩ — same builder over the same envelope ⇒ parity by construction). Returns `null` when `response.result?.cells` is not an array; never throws.

```ts
export interface ProofCell {      // one per response.result.cells[i]
  resultId; measure; measureTitle; regionLabel; regionCode; periodLabel; periodCode;
  dims; dimLabels; valueText; status; provisional; batchId;
}
export interface AnswerProof {
  tableId; tableTitle; tableVersion; syncedAt; license; source?;
  reading: string;                      // definitionLabel ?? cells[0].measureTitle
  periodSemantics: string | null;
  alternates: { label: string; technical: string | null }[];
  cells: ProofCell[];
  steps: { text: string; technical: string | null }[];
  nullNotice: string | null;
  marked: boolean;                      // a step prints a derivation value → DERIVED_DATA_MARKING
}
```

Sources (all `src/query/types.ts`, reached as `response.result`):

- **Depth 1 (#89):** `attribution.definitionLabel`, `attribution.periodSemantics`, `attribution.alternates?[]` = `{ measure?, dims?, label }` (present-only, `?? []`). Label through `displayAlternateLabel` (`src/answer/compose/format.ts`, exported — it already builds the plain line). Technical: `meetcode {measure}` / `{dim}={code}`. **Absent `alternates` ⇒ say nothing**: absence also means "row predates #39", so "no other reading exists" would be a guess (principle c).
- **Depth 2 (#70):** per `ResultCell`: `measureTitle`, `measure`, `regionLabel`/`regionCode`, `periodLabel`/`periodCode`, `dimLabels`/`dims`, `valueText = displayValueUnit(value, decimals, unit) + provisionalSuffix(cell)`; null cell ⇒ `'geen waarde — ' + nullReasonText(valueAttribute)` (all from `src/answer/compose/template.ts` — `stat-card-data.ts` already imports it client-side); `status` verbatim; `batchId`. Table-level: `attribution.tableId`, `tableTitle`, `tableVersion`, `syncedAt` (via `syncDateLabel`, `source-badge.tsx`), `license`, `source` (→ `resolveSource`).
- **Depth 3 (#79):** `result.derivations[]` verbatim — `difference` (`value`, `minuendResultId`, `subtrahendResultId`), `max` (`value`, `winnerResultId`, `rankingResultIds`), `direction` (`direction`, `monotonic`, `netChange`, `firstResultId`, `lastResultId`), `unit_expansion` (`factor`, `value`, `sourceResultIds[0]`). Cells resolved by `resultId` through a `Map` (the `template.ts` `byId` idiom); differences via `displayDifferenceUnit` (procentpunt for `%`, R10). Null notice from `cells.filter(c => c.value === null).length`.

**`web/lib/chat-message.ts`** — add `proof: AnswerProof | null` to `ChatMessage` (null on user, non-answer, redacted). Required, so TypeScript forces every literal: `chat.tsx` (lines 386, 461, 493-block), `replay-assemble.ts` (`redactedMessage`, `userMessage`, `assistantMessage`), and test literals.

**`web/components/chat.tsx`** — `proof: response.kind === 'answer' ? buildAnswerProof(response) : null` beside `citation`/`card`/`csv`; render `{message.proof ? <AnswerProof proof={message.proof} /> : null}` per D5.

**`web/lib/replay-assemble.ts`** — `proof: answer !== null ? buildAnswerProof(answer) : null`. `part.response` is the verbatim stored envelope (`ReplayAssistantPart.response`, `src/threads/replay.ts`) and already feeds `buildAnswerCsv`, which reads `result.cells` and `result.derivations` — proven present on replay.

**`web/components/answer-proof.tsx`** (`'use client'`) — `AnswerProof({ proof })`: state `open` and `technical` (both false); trigger; three labelled blocks; `<table>` with `th scope="col"`; steps as `<ol>`. Self-contained like `FeedbackButtons`.

**Threading verdict:** everything reaches the client today as `gated.response` (live) and `part.response` (replay). Only `chat-message.ts`, `replay-assemble.ts`, `chat.tsx` change. **No backend/pipeline change** — the one surface that would need it (history) is excluded by D8.

## 3. Invariants

- **R1** — every digit is `formatValueNl` over `cell.value`, `derivation.value`, `netChange`, `factor`, or a verbatim metadata string. No arithmetic in `answer-proof.ts`: "B − A" prints the STORED `derivation.value`. Pinned by a token-scan test (§5).
- **R3/R10** — one formatter: `displayValueUnit` / `displayDifferenceUnit` / `formatValueNl`, the template rung's and stat card's own code.
- **R4** — chip + `SourceBadge` untouched; the panel is an expansion. The link stays the table view (#86: cell deep-links unreliable); coordinates shown alongside, as #86 foresaw.
- **R5** — when a step prints a derivation value, the panel ends with `DERIVED_DATA_MARKING` (`web/backend/query/types.ts`, as `csv.ts` imports it); `markingLine` stays.
- **R8** — a client view model; `reconstruct.ts` never reads it; `tests/audit/envelope-key-manifest.test.ts` parses only `respond/types.ts` + `compose/types.ts`, untouched. Replay is identical because the same builder runs over the same stored envelope.
- **R11** — `provisionalSuffix` + verbatim `status`; null cells state `nullReasonText`. The #71 pill unchanged.
- **#14 redaction** — `src/threads/replay.ts` `replayParts` emits `role: 'redacted'` before any assistant part exists, so `assembleMessages` yields `redactedMessage()` with `proof: null`; the live path cannot be redacted mid-session; history is out. Belt: the builder returns `null` without `result` (the redacted envelope is `{schemaVersion, kind, question, text, redacted: true}`, `retention.ts` line 147).
- **ADR 006** — no hardcoded numbers or prices; the only numerals in copy are counts from `cells.length`.
- **Zero prompt bytes, zero DDL, zero server actions, zero spend.**
- **No flag** — purely additive display of data the client already holds and already hands the user via `Download als CSV` (cells, statuses, `cel-id`, derivations). Rollback = revert one PR, no state to unwind; a flag would add a `NEXT_PUBLIC_*` read and a dormant path for nothing.

## 4. Copy (deterministic templates)

- Trigger `Bewijs dit cijfer` (1 cell) / `Bewijs deze cijfers` (>1); toggle `Technische details`; region `Onderbouwing van dit antwoord`.
- **`Waarom dit antwoord`:** `Gebruikte lezing: {reading}.` · `Periodebetekenis: {periodSemantics}` (the CSV preamble's form) · per alternate `Niet gekozen: {label}` + technical ` — meetcode {measure}` / ` — {dim}={code}`.
- **`De gebruikte cellen`:** caption `Tabel {tableId} — {tableTitle} · versie {tableVersion} · gesynchroniseerd {YYYY-MM-DD} · licentie {license}`. Columns (CSV header words): `Onderwerp | Regio | Periode | {dim labels} | Waarde | Status`; technical adds `Cel-id | Meetcode | Regiocode | Periodecode | Batch`.
- **`Stap voor stap`** (`<ol>`):
  - `Gelezen: 1 cel uit tabel {tableId}: {measureTitle}, {regionLabel, }{periodLabel} → {valueText}.` / `Gelezen: {n} cellen uit tabel {tableId} (de tabel hierboven).`
  - difference: `Verschil berekend: {later.periodLabel} ({B}) min {earlier.periodLabel} ({A}) = {displayDifferenceUnit(value)}.`
  - max: `Hoogste waarde bepaald: {winner regionLabel ?? periodLabel} ({value}). Volgorde: {label (value)}; …` in `rankingResultIds` order.
  - direction: `Richting van de reeks: {gestegen|gedaald|gelijk gebleven} van {first.periodLabel} tot en met {last.periodLabel}; netto {displayDifferenceUnit(netChange)}.` + when `!monotonic`: ` De reeks ging niet in elke stap dezelfde kant op.`
  - unit_expansion: `Uitgerekend: {displayValueUnit(source)} = {formatValueNl(value, 0)}.`
  - none: `Geen bewerking toegepast: het antwoord is de waarde uit de cel.`
  - null notice: `{k} van de {n} cellen heeft geen waarde; de reden van CBS staat per cel in de tabel.`
  - closing when `marked`: `bewerking van CBS-gegevens door checkdecijfers.nl`; technical suffix per step ` [cel-id …]`.

## 5. Test plan (vitest + jsdom, `@testing-library/react`, `web/test/fake-answer.ts` fixtures)

`web/lib/answer-proof.test.ts`: (1) single cell, no derivations → `Gelezen: 1 cel …` + `Geen bewerking toegepast…`, `marked` false; (2) difference with a real `DerivationRecord` → signed text, `procentpunt` for `%`, `marked` true; (3) comparison + `max` (3 cells) → winner, `Volgorde` in `rankingResultIds` order; (4) series + `direction` → word matches `direction`, non-monotonic sentence only when `monotonic:false`, `first_last` renders nothing; (5) `unit_expansion` → line from `value`, never multiplication; (6) null cell (`valueAttribute:'Confidential'`) → `geen waarde — door CBS niet gepubliceerd (vertrouwelijk)` + notice; (7) provisional → ` (voorlopig cijfer)`, `status` verbatim; (8) alternates → `eigen key: …` stripped, code in technical; absent → no entry, no "geen andere lezing" claim; (9) `definitionLabel:null` → `reading` = `measureTitle`; (10) envelope without `result` → `null`; (11) **R1 scan:** `findNumericTokens` over every string after `maskPhrases(unitMaskPhrases(unit))` — each token equals a formatted cell/derivation value or a verbatim metadata field.

`web/components/answer-proof.test.tsx`: closed by default (no region, `aria-expanded="false"`); click → region present, `aria-controls` equals its id (`chart-download.test.tsx` precedent); technical off → no `resultId` text, on → `aria-pressed="true"` + `cel-id`/`batchId` visible; native `<button>` roles pin keyboard reachability.

`chat.test.tsx`: answer shows `Bewijs dit cijfer` in the citation/CSV row; refusal/clarification/info none; plural at 2 cells; the WP23 zero-loss pin passes unchanged; add the button to `envelopeSignature()` in `chat-workspace.test.tsx` (dock/inline/today identity).

`replay-assemble.test.ts`: `assistantMsg.proof` `toEqual(buildAnswerProof(response))` (the `citation`/`csv` parity idiom); refusal → `null`; redacted row → `null`.

## 6. Build order and size

**One PR, four commits, S–M (one focused session incl. the full verification block):** (1) `answer-proof.ts` + tests; (2) `chat-message.ts` field + `replay-assemble.ts` + parity test; (3) `answer-proof.tsx` + tests; (4) `chat.tsx` wiring + chat/workspace test additions. Same PR: open-questions #70/#79/#89/#90 → built; the build-plan brief (lines 245–258) → as-built; `04-architecture.md` row 76 note; STATUS/archive/lessons per the wrap ritual. Mechanical steps on a cheaper tier, review on the session model. #118: core-product — owner-present ⇒ push to `main`; autonomous ⇒ branch + PR.

**OUT:** Phase-2 public audit-trail / shareable pages; dashboard history (`history.ts`, follow-up row); the trial; the dock; chart footers; any envelope field, server action or DDL; cell-level StatLine links; `first_last`; restating the WP26 `assumptionLine` (already at body weight).

## 7. Risks / what the owner may veto

- **`Bewijs dit cijfer`** is a bold claim in the owner's own words (#79); `Onderbouwing` is the calm alternative. The plural switch is taste.
- **Inline over side panel** — the owner may want proof in the dock on wide screens.
- **Ids behind a toggle** — a `cel-id`-first reader pays one extra click.
- **`direction.netChange` shown** — R1-legal, but a number the body may not have stated.
- **Always a table**, even for one cell — consistent, slightly heavy on phones.
- **History excluded** — needs its own small `history.ts` WP.
- **No flag** — "hide it now" is a revert, not an env flip.
- **Collapsed by default** — one click away; the opposite shouts against huisstijl rule 7.
