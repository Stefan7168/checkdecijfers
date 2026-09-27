# Two-measure scatter ("Plot against…") Implementation Plan — Part 2 of 2 (user-visible)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a reader who gets a CBS region-set answer sees a "Zet af tegen …" chip; one click (no AI) answers with an
audited scatter chart — one dot per region — in the chat, the public embed and the downloads, in Dutch and English.

**Architecture:** Part 1 (on `main`, `89902c11`) built `runPairQuery` (two ordinary region-set legs + `pairRegions`)
and `buildScatterSpec`. Part 2 (a) makes the spec self-sufficient for every surface (left-out regions + region class
inside the spec, pure Dutch text builders), (b) branches `respondToIntent` on `intent.pairWith` into a dedicated,
template-only scatter answer with two new present-only envelope fields (`pairedResult`, `scatter`) and a pair-aware
audit write + reconstruction, (c) offers the chip after a pair dry-run and lets the click boundary accept it, and
(d) renders it with a new `ScatterView` wired into the chat card, replay, embed, CSV and downloads. English text is
derived at render time from the stored Dutch-neutral spec — no model call anywhere.

**Tech Stack:** TypeScript strict, zod v4, vitest (backend: PGlite hermetic DB; web: jsdom + testing-library, real
Recharts), Next.js App Router, Recharts.

**Spec:** [docs/superpowers/specs/2026-09-27-two-measure-scatter-design.md](../specs/2026-09-27-two-measure-scatter-design.md)
**Part 1 plan + carry-overs:** [2026-09-27-two-measure-scatter.md](2026-09-27-two-measure-scatter.md) ("Carry-overs" section).
**Research maps (read the one your task names):** `/private/tmp/claude-502/-Users-amity-Documents-Check-de-Cijfers/baca7227-b759-40eb-a08f-357dbb50714f/scratchpad/map-answer-audit.md`,
`…/map-chips.md`, `…/map-web.md` — file:line maps of every seam, written 2026-09-27 against `main`.

## Global Constraints

- **No LLM call anywhere on the scatter path**: no compose model, no semantic check, no `attachEnglish`/translate call
  for a scatter answer; the chip is taken through the existing zero-LLM click path. No prompt or LLM fixture changes.
- **No DB migration.** New envelope fields are present-only JSONB keys (docs/13): readers use `?? null`/`?? undefined`.
- **Every number traces to a cell** (R1): chart numbers only from `ScatterSpec` points (each with `xResultId`/`yResultId`);
  the Dutch body carries NO data value; counts live in the structural `scatterLine` (outside any value scan), exactly
  like `regionSetLine`.
- **No dot without both values; nothing dropped silently** (principle (c), R11): every left-out region is disclosed with
  each side's CBS reason (`nullReasonText`), or counted as "bestond niet volgens het CBS" when not applicable.
- **R8:** the stored Dutch `answer.body`, `answer.scatterLine`, `answer.text` and `scatter` must re-derive byte-identically
  from the stored `result` + `pairedResult` in `reconstruct.ts`; `npm run audit:verify` must stay clean on existing rows.
- **R9:** no causal or trend wording, no superlative ("hoogste/laagste") in the body; the chart's labelled extremes are
  presentation (spec D7) — the text never names a "winner" (ties exist).
- **Stored spec stays Dutch**; English is derived at render time (web) from the spec + the existing `cbs-words` helpers.
- **Chip:** only on a CBS `region_set` answer; offered only if the pair dry-run serves (`runPairQuery` ≥ 3 pairs);
  pair target ∈ `REGIONAL_KEYS` (`src/answer/intent/prompt.ts:120`) minus the answered key; at most one scatter chip.
  Dutch label: `Zet af tegen ${definitionLabel-or-measureTitle, lowercase first}` — see Task 5 for the exact source.
- **Price:** unchanged — the normal `'simple'` class via `chargeAndRun`, refunded on refusal.
- **UX (owner-approved):** asked-about measure on the vertical axis; an axis opens on log scale per `spec.<axis>.defaultScale`
  with the axis title marked "(log. schaal)" / "(log scale)" and one click back to linear; ≤ 4 labelled extremes; a
  search box that highlights a region by name; "swap axes"; a table view (region | y | x); provisional points marked `*`;
  both attribution lines shown. Log/swap/search are view state only (not saved to `chart_edits`).
- **English UI strings** in `web/lib/i18n/messages.ts` (both `nl` and `en`, compile-time parity).
- One vitest process at a time, foreground only (8 GB machine). Never `git add -A`. No push/PR/merge by implementers.

---

### Task 3: Self-sufficient spec + Dutch scatter texts (pure)

**Files:**
- Modify: `src/chart/scatter.ts` (extend `ScatterSpec`, schema, builder)
- Create: `src/chart/scatter-text.ts`
- Modify: `src/chart/index.ts` (exports)
- Test: `tests/chart/scatter.test.ts` (extend), `tests/chart/scatter-text.test.ts` (new)

**Interfaces:**
- Consumes: Part 1 `pairRegions`, `LeftOutRegion`, `PairSide` (`src/query/index.ts`); `regionSetNoun`
  (`src/answer/compose/format.ts:290`); `nullReasonText` (`src/answer/compose/template.ts:20`); `sourceKeyForTableId`
  (grep its module; it is how template.ts resolves a cell's source).
- Produces:
  - `ScatterSpec` gains `scope: RegionScope` and `leftOut: ScatterLeftOut[]` and `notApplicableCount: number`.
  - `interface ScatterLeftOut { regionCode: string; label: string; y: ScatterSideStatus; x: ScatterSideStatus }`
  - `interface ScatterSideStatus { state: 'value' | 'withheld' | 'not_applicable' | 'missing'; valueAttribute: string | null }`
  - `scatterBodyNl(spec: ScatterSpec): string` and `scatterLineNl(spec: ScatterSpec): string` (in `scatter-text.ts`)

- [ ] **Step 1: Failing tests.** Extend `tests/chart/scatter.test.ts`'s `leg()` fixture so it can mark a region missing
  and not applicable; add cases:
  - `spec.scope` equals the y leg's `regionSet.scope`.
  - a withheld y cell (valueAttribute `'Secret'`) → `leftOut` contains `{regionCode, label: <full regionLabel>, y: {state:'withheld', valueAttribute:'Secret'}, x: {state:'value', valueAttribute:null}}`; a region absent from the x leg → `x: {state:'missing', valueAttribute:null}`, label from the y cell; a region with no cell on either side → `label` = the region code.
  - `notApplicableCount` = `pairRegions(...).notApplicable.length`.
  - schema still strict-validates the extended spec; `leftOut` order = `pairRegions` order.
  Create `tests/chart/scatter-text.test.ts` with a hand-built `ScatterSpec` (y "Gemiddelde verkoopprijs", x "Bevolking op
  1 januari", period label "2024", scope `{kind:'all_provincies'}`, 12 points, no leftOut) asserting EXACTLY:
  - `scatterBodyNl(spec)` ===
    `'Gemiddelde verkoopprijs tegenover bevolking op 1 januari per provincie, 2024. Elke stip is één provincie. De grafiek laat zien hoe de twee cijfers samen voorkomen, niet dat het ene het andere veroorzaakt.'`
  - `scatterLineNl(spec)` === `'Dekking: alle 12 provincies hebben beide cijfers.'`
  - with 2 leftOut (one y withheld `'Secret'`, one x missing) and `notApplicableCount: 3`, scope `gemeenten_in_provincie`
    PV26, 20 points: `scatterLineNl` ===
    `'Dekking: 20 gemeenten hebben beide cijfers. Niet getoond: 2 gemeenten — A (gemiddelde verkoopprijs: <nullReasonText("Secret")>), B (bevolking op 1 januari: niet in onze database). 3 gemeenten bestonden in deze periode niet volgens het CBS.'`
    (compute the expected reason string in the test by calling `nullReasonText('Secret')` — never hard-code it).
  - more than 10 left-out regions: the line names the first 10 in `leftOut` order, then `' en N andere'` before the
    closing full stop.
  - the body contains no digit other than those inside the two measure titles and the period label (assert by removing
    those three substrings and checking `/\d/` fails).

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/chart/scatter.test.ts tests/chart/scatter-text.test.ts`.

- [ ] **Step 3: Implement.** In `scatter.ts`: map `pairing.leftOut` → `ScatterLeftOut` (`label` = `regionLabel ?? regionCode`,
  each side `{state, valueAttribute: side.cell?.value === null ? side.cell.valueAttribute : null}`), set
  `scope = y.regionSet!.scope` (throw a clear Error if the y leg has no `regionSet` — a scatter is only built from
  region-set legs), `notApplicableCount = pairing.notApplicable.length`; extend `scatterSpecSchema` (strict objects;
  `scope` as a discriminated union of the four `RegionScope` variants). In `scatter-text.ts` (pure, no I/O):
  - body: `${y.measureTitle} tegenover ${lowerFirst(x.measureTitle)} per ${noun(1)}, ${y.periodLabel}. Elke stip is één ${noun(1)}. De grafiek laat zien hoe de twee cijfers samen voorkomen, niet dat het ene het andere veroorzaakt.`
    where `noun(n) = regionSetNoun(spec.scope, n)`.
  - line: `Dekking: ` + (`leftOut.length === 0` ? `alle ${points.length} ${noun(points.length)} hebben beide cijfers.`
    : `${points.length} ${noun(points.length)} hebben beide cijfers. Niet getoond: ${k} ${noun(k)} — ${named}${rest}.`)
    + (`notApplicableCount > 0` ? ` ${m} ${noun(m)} ${m === 1 ? 'bestond' : 'bestonden'} in deze periode niet volgens het CBS.` : '').
    Each named region: `${label} (${reasons})` where reasons lists every side that is not `'value'`, as
    `${lowerFirst(axis.measureTitle)}: ${reason}` joined by `'; '`, with reason = `nullReasonText(valueAttribute, sourceKeyForTableId(axis.tableId))`
    for `withheld`, `'niet in onze database'` for `missing`, `'bestond niet volgens het CBS'` for `not_applicable`.
    Named limit 10 (`SCATTER_NAMED_LIMIT`), then ` en ${k - 10} andere`.
  Move `lowerFirst` to `scatter-text.ts` (export it) and import it in `scatter.ts` — one copy.

- [ ] **Step 4: Run, expect PASS**; then `npx vitest run tests/chart`, `npx vitest run tests/query`, `npm run typecheck`.

- [ ] **Step 5: Commit** — `feat(chart): self-sufficient ScatterSpec (left-out, scope) + Dutch scatter texts (#296, part 2 Task 3)`.

---

### Task 4: The scatter answer + audit (backend)

**Files (see `map-answer-audit.md` for every line reference):**
- Modify: `src/answer/respond/respond.ts` (`respondToIntent` ~379–715: branch at the `runQuery` call ~422)
- Create: `src/answer/respond/scatter-answer.ts` (the dedicated assembler — keeps respond.ts's growth to the branch only)
- Modify: `src/answer/respond/types.ts` (`AnswerResponse`: `pairedResult?: ValidatedResult`, `scatter?: ScatterSpec`)
- Modify: `src/answer/compose/types.ts` (`ComposedAnswer`: `scatterLine?: string | null`)
- Modify: `src/answer/audit/respond-audited.ts` (skip `attachEnglish` when `response.kind === 'answer' && response.scatter !== undefined`)
- Modify: `src/answer/audit/write.ts` (`resolvedIntent`: the full pair intent; `buildAuditRow`: a second `TableRef`)
- Modify: `src/answer/audit/reconstruct.ts` (a paired branch BEFORE the `region_set` template re-derivation ~428)
- Modify: `tests/audit/envelope-key-manifest.test.ts` (`pairedResult` shape-checked like `result`; `scatter` rederived like `chart`; `ComposedAnswer.scatterLine` rederived like `regionSetLine`)
- Test: `tests/answer/scatter-answer.test.ts` (new, hermetic), `tests/audit/scatter-reconstruct.test.ts` (new)

**Interfaces:**
- Consumes: `runPairQuery` → `PairedResults { intent, result, pairedResult, pairing }`; `buildScatterSpec`; `scatterBodyNl`,
  `scatterLineNl` (Task 3); `checkStaleness`; `buildAttributionLine`.
- Produces: an `AnswerResponse` with `result` = y leg, `pairedResult` = x leg, `scatter` = spec, `chart: null`,
  `chartAlternates: []`, `suggestions: []`, no `pending`, `answer` = a `ComposedAnswer` with `source: 'template'`,
  `body = scatterBodyNl(spec)`, `scatterLine = scatterLineNl(spec)`, `definitionLine: null`, `markingLine: null`,
  `attributionLine = buildAttributionLine(y)`, `text` = body + `\n\n` + scatterLine + [staleness] + `\n\n` + y attribution
  + `\n` + x attribution (fix the exact join to match how compose.ts `assemble()` joins structural lines, and document it),
  `model: null`, `usage` zeros, `attempts: []`, `validation` = the template report shape compose uses for a template
  answer with no body scan (read compose.ts to build a truthful one: `ok: true`, no violations, a note that the scatter
  body carries no data value).
  `resolvedIntent(response)` returns `{ ...response.result.intent, pairWith: response.pairedResult.intent.target }` for a
  scatter answer (so the intent hash differs from the one-measure answer's).

- [ ] **Step 1: Failing hermetic test** (`tests/answer/scatter-answer.test.ts`, PGlite via `createIngestedDb`): call
  `respondToIntent` (or the narrowest exported entry the respond tests use — see `tests/answer/wp29-click-take.test.ts`)
  with a parse outcome carrying the provinces pair intent (y `average_home_sale_price_by_gemeente`, x
  `population_on_1_january`, `2024JJ00`, `all_provincies`). Assert: `kind === 'answer'`, `chart === null`,
  `scatter.points.length === 12`, `pairedResult.attribution.tableId === '03759ned'`, `answer.body === scatterBodyNl(scatter)`,
  `answer.scatterLine === scatterLineNl(scatter)`, `text` contains both attribution lines, `suggestions` empty, no
  `pending`, and **the injected LLM client was never called** (use the stub/throwing client pattern the respond tests
  use). A second case: a pair whose x leg refuses (period `2026JJ00`) → a refusal response, not an answer.
- [ ] **Step 2: Failing audit tests** (`tests/audit/scatter-reconstruct.test.ts`): run the audited entry
  (`answerClarificationReplyAudited` or `answerQuestionAudited`'s pair-capable path, whichever the test harness can
  drive without an LLM — the click-take path is the natural one), then `reconstructionReport` on the stored row → clean;
  tamper tests: change one `scatter.points[0].y`, change `answer.scatterLine`, drop `pairedResult` → each reconstructs
  with a divergence. Assert the stored `intent` has `pairWith` and `tables` has two entries. Also assert `attachEnglish`
  is not invoked with `lang: 'en'` (pass a translate client that throws).
- [ ] **Step 3: Run, expect FAIL.**
- [ ] **Step 4: Implement** per the Interfaces block. Staleness: run `checkStaleness` for BOTH legs; refuse exactly as the
  single-result path does if either leg triggers its refusal branch; otherwise join both legs' warnings (y first) into
  `stalenessWarning` (null when neither). Refusals from `runPairQuery` go through the existing `!outcome.ok` refusal
  block unchanged. Reconstruction: when `response.scatter !== undefined`, require `pairedResult`, re-run
  `buildScatterSpec(result, pairedResult)` and compare with the stored `scatter` (canonical JSON), re-derive body/line/text
  and compare byte-for-byte, and do NOT run the single-result `region_set` template re-derivation on the y leg.
  A stored `pairedResult` without `scatter` (or vice versa) is a divergence.
- [ ] **Step 5: Run the new tests, then `npx vitest run tests/answer`, `npx vitest run tests/audit`, `npm run typecheck`,
  then the hermetic benchmark `npm run benchmark:run && npm run benchmark:score` (must stay 14/14 + 6/6 + 0 fabricated,
  template fallbacks 0 — the Dutch pipeline is untouched).** Report each command's summary line.
- [ ] **Step 6: Commit** — `feat(answer): template-only scatter answer + pair-aware audit (#296, part 2 Task 4)`.

---

### Task 5: The "Zet af tegen …" chip

**Files (see `map-chips.md`):**
- Modify: `src/query/dry-run.ts` (`echoServability` ~84: `pairWith` → `runPairQuery(db, intent, { ...options, probe: true })`)
- Modify: `src/answer/respond/validate-pending.ts` (`clickIntentSchema` ~49: `regionSet` + `pairWith`; `isClickTakeableIntent` ~176)
- Modify: `src/answer/respond/suggestions.ts` (new generator `plotAgainst`, `GeneratorKind` + `ID_PREFIX` `'pair'`)
- Test: `tests/answer/suggestions.test.ts` (new describe block), `tests/answer/scatter-click-take.test.ts` (new, hermetic end-to-end)

**Interfaces:**
- Consumes: `pairIntentProblem` (`src/query/pair.ts`), `REGIONAL_KEYS` (`src/answer/intent/prompt.ts:120`),
  `CANONICAL_MEASURES` (registry), Task 4's scatter answer.
- Produces: on a CBS `region_set` answer, `suggestions[0]` = the chip label and a `ClickOption`
  `{ id: 'pair-1', label, intent: <pair intent>, impliedRecency: false }`.

- [ ] **Step 1: Failing tests.**
  - `validate-pending`: a pair intent `{schemaVersion:1, target:{canonical average_home_sale_price_by_gemeente}, regionSet:{kind:'all_provincies'}, period:{codes:['2024JJ00']}, derivation:'none', pairWith:{kind:'canonical', key:'population_on_1_january'}}`
    is click-takeable; each of these is NOT: `pairWith` naming a non-regional canonical key; `pairWith` equal to the
    target; `regionSet` with `gemeenten_in_provincie` and a non-PV parent; a `regionSet` WITHOUT `pairWith` (not in
    scope for click-take in this slice — keep today's behaviour: reject); extra unknown keys.
  - `suggestions` (stub `ServabilityCheck` style of that file): a `region_set` answer over
    `average_home_sale_price_by_gemeente` with a check that serves the pair → first suggestion is the chip, its option's
    intent has `regionSet` equal to the answer's resolved `regionSet`, the single answered period code, `derivation:'none'`,
    `pairWith` population; a check that refuses the pair → no chip; a `region_set` answer over `population_on_1_january`
    → chip pairs with `average_home_sale_price_by_gemeente`; a non-`region_set` answer → no chip; a non-CBS source → no chip.
  - Real-db (`realCheck()` of that file): provinces 2024 home price answer → chip offered.
  - `tests/answer/scatter-click-take.test.ts`: hermetic flow — answer the provinces home-price region-set intent, take
    the chip through `respondToClarificationReply` with the answer's own `pending` and the chip label → a scatter answer
    (Task 4 shape), zero LLM calls.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
  - Label: `Zet af tegen ${lowerFirst(title)}` where `title` = the pair target's `CanonicalMeasure.measureTitle` if set,
    else its `definitionLabel` (read the registry entry shape; for `population_on_1_january` this must yield
    "Zet af tegen bevolking op 1 januari" — assert it in the test). The English interface gets its chip text from the
    existing answer translation (`englishVerified.chips`, `{label, submit}`) — verify in `web/components/chat.tsx:1236`
    that `submit` carries the Dutch label so the click still matches; if answer chips are NOT translated today, leave
    it (consistent with every other answer chip) and say so in the report.
  - Generator order: `plotAgainst` FIRST in the click-options generator list; it runs only when
    `ctx.result.shape === 'region_set'`, the answered target is canonical and in `REGIONAL_KEYS`, and the source is CBS
    (mirror `compareRegion`'s source guard); candidates = `REGIONAL_KEYS` minus the answered key in registry order; offer
    the first whose `pairIntentProblem` is null AND `ctx.check(candidate)` serves. Read the answered `regionSet` and
    period from `ctx.result.intent` (the resolved intent), never from `ctx.regions`.
  - `echoServability`: when `intent.pairWith !== undefined`, run `runPairQuery` with `probe: true` and map its outcome
    exactly like the single path (never expose a cell value — keep dry-run.ts's confinement comment true).
  - `clickIntentSchema`: add `regionSet: regionScopeSchema.optional()` (strict discriminated union; `parent` must match
    `/^PV\d{2}$/`) and `pairWith: z.strictObject({kind: z.literal('canonical'), key: z.enum(CANONICAL_KEYS)}).optional()`;
    `isClickTakeableIntent` additionally requires: if `regionSet` is present then `pairWith` is present; if `pairWith` is
    present then `pairIntentProblem(intent) === null` and both keys are in `REGIONAL_KEYS`.
- [ ] **Step 4: Run the new tests, then `npx vitest run tests/answer`, `npx vitest run tests/query`, `npm run typecheck`,
  and the hermetic benchmark (unchanged gate). Note: a new chip on region-set answers may change a benchmark flow's
  informational chip output — report any change; the gate lines must not move.**
- [ ] **Step 5: Commit** — `feat(chips): 'Zet af tegen …' scatter chip on region-set answers (#296, part 2 Task 5)`.

---

### Task 6: `ScatterView` (web component)

**Files (see `map-web.md` §2, §6, §7):**
- Create: `web/components/scatter-view.tsx`, `web/lib/scatter-text-en.ts`
- Modify: `web/lib/i18n/messages.ts` (a `chart.scatter.*` key block in `nl` and `en`)
- Test: `web/components/scatter-view.test.tsx`, `web/lib/scatter-text-en.test.ts`

**Interfaces:**
- Consumes: `ScatterSpec` (via the `web/backend` symlink path the other web files use), `useLang`, `t`, the
  `cbs-words.ts` translate helpers, `ChartDownloadMenu`, `ChartEmbedButton`, `SourceBadge`.
- Produces: `export function ScatterView(props: { spec: ScatterSpec; body?: string; scatterLine?: string; embed?: EmbedButtonProps | null; frameless?: boolean; embedFooter?: ReactNode; }): JSX.Element`
  (match the prop names `ChartView` uses for the same concepts — read chart.tsx's props first and mirror them);
  `scatterBodyEn(spec)` / `scatterLineEn(spec)` in `web/lib/scatter-text-en.ts` — the English mirrors of Task 3's Dutch
  builders, same structure, English measure titles/region nouns via `cbs-words.ts`, reasons via the English null-reason
  labels the English refusal/answer lines already use (grep `nullReasonLabels`/English reason text in `src/answer/translate/lines.ts`).

Behaviour (each one a test):
- One dot per point; y = vertical. Axis titles = measure title + unit (translated in English), plus " (log. schaal)" /
  " (log scale)" when that axis is on log; a toggle button per log-capable axis (`defaultScale === 'log'` or all values > 0)
  switches log ↔ linear; initial state from `defaultScale`.
- Every rendered number is the spec's own formatted string (`yFormatted`/`xFormatted`), never re-formatted; tooltip
  shows `label`, y line, x line, and `*` + the provisional note when `provisional`.
- `labelled` points carry visible text labels.
- Search input: typing a (case-insensitive, accent-insensitive) substring of a label highlights matching dots (larger,
  outlined) and lists up to 5 matches; empty input = no highlight.
- "Swap axes" button swaps x/y data, titles, scales and labels.
- Table view toggle: region | y | x columns with formatted values and `*` for provisional; sorted as in the spec.
- Shows `body` + `scatterLine` (Dutch) or `scatterBodyEn(spec)` + `scatterLineEn(spec)` (English), both attribution
  lines, the provisional note when present, the download menu (PNG/SVG from the rendered SVG) and, when `embed` is
  given, the embed button.
- Dark mode + theming: same CSS tokens chart.tsx uses (no hard-coded colours).
- [ ] Steps: failing tests (render with a fixture spec in both languages, interact via testing-library) → implement →
  `npx vitest run` the two new web test files from `web/` → `npm run web:typecheck` → commit
  `feat(web): ScatterView — scatter chart with search, log scale, swap, table (#296, part 2 Task 6)`.

---

### Task 7: Wire the scatter into every surface

**Files (see `map-web.md` "recommended seams" 2–7, 9, 11–13 and `map-answer-audit.md` §5):**
- `web/lib/chat-message.ts` (`scatter: ScatterSpec | null` on the message + `deriveVisuals` dock branch)
- `web/components/chat.tsx` (~968 `scatter:` from the response; ~975 CSV branch; ~1463/1650 docked-chip ternary;
  ~1605–1626 mount `ScatterView` beside the `ChartView` block; the card body/lines come from `answer.body` /
  `answer.scatterLine` (Dutch) or ScatterView's own English builders)
- `src/threads/replay.ts` + `web/lib/replay-assemble.ts` (carry `scatter` like `chart`; carry `scatterLine` like `regionSetLine`)
- `web/lib/scatter-csv.ts` (new: `buildScatterCsv(spec, lang)` → `{ filename, content }`: preamble with both attribution
  lines + definitions if present, then `regio;<y title (unit)>;<x title (unit)>` rows with the formatted strings and a
  `*` column note for provisional; then a "Niet getoond" block listing `leftOut` with reasons)
- `web/app/embed-actions.ts:35-42` (mint allowed when `chart !== null || scatter !== undefined`)
- `web/app/embed/[token]/page.tsx:201` (render `ScatterView` for a scatter answer; no live re-run, no form overrides)
- `web/lib/answer-proof.ts` / `web/components/answer-proof.tsx` (read first: a scatter answer must list BOTH tables;
  if the panel is single-table, add the paired table's citation)
- Tests: extend the existing tests of each touched module (replay, replay-assemble, embed page, embed-actions, csv) plus
  a chat-card render test for a scatter message.
- [ ] Steps: failing tests → implement → the touched test files → full web suite once (`npm run web:test` or the
  script the web package uses) → `npm run web:typecheck` → commit
  `feat(web): scatter answers in chat, replay, embed, CSV and proof panel (#296, part 2 Task 7)`.

---

### Task 8 (controller): verify for real + docs

- Full verify block (`scripts/verify-block.sh`, detached) + `/code-review` LOW + `npm run audit:verify` (validator/R8 path
  touched) before push.
- Real browser check on the dev server (no live LLM spend): produce a stored scatter answer hermetically or through the
  RUNBOOK "Seeing a stored answer's public embed page locally" recipe, and look at the chat card + embed in both
  languages, light and dark, phone width; exercise search, log toggle, swap, table, download.
- Docs: ADR 060 (decision + as-built), ADR 039/054/056 notes, `docs/04-architecture.md` capability row, STATUS,
  open-questions #296, build plan, RUNBOOK if a new procedure appeared.
