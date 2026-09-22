# Chart co-pilot phase 6 — chat wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make five already-built, panel-only chart features (dim-instead-of-hide, pick-the-headline-number, shaded time period, a computed difference/average overlay, a goal line) reachable from the CBS/Eurostat chat co-pilot, and unblock two previously-reverted chat capabilities (donut via chat, the five new house-style templates via chat) by fixing the test-fixture regeneration gap that caused both reverts.

**Architecture:** Every prior chart-copilot phase (3, 5, 5b) added new members to the same `cbsViewCommandSchema` discriminated union in `src/chart/copilot/schema.ts`, taught the model about them in `src/chart/copilot/prompt.ts`, and turned the model's (label-based) output into real client commands in `src/chart/copilot/map.ts`. This plan follows that exact established pattern — no new architecture, no new files for the schema layer. The client-side commands these chat commands produce (`setDimmed`, `setHeadlineOverride`, `addEraShading`, `addDerivedOverlay`, `addGoalLine`) already exist and are already dispatched by the on-screen panel/canvas today (`web/components/chart.tsx`) — this plan only adds a third source ('chat') that produces the same command shapes.

**Tech Stack:** TypeScript, Zod (schema), Vitest (unit/fixture tests), Playwright (e2e, runs against a hermetic mock-fixture LLM server — no live API calls).

**Spec:** No new spec document — this plan extends the architecture already accepted in ADR 056 (`docs/decisions/056-chart-copilot.md`) and its "As built" sections for phases 3/5/5b, which this plan's tasks mirror directly. Read `src/chart/copilot/schema.ts`, `map.ts`, `prompt.ts`, `types.ts` in full before starting — they are short (~50-250 lines each) and every task below modifies them.

## Global Constraints

- **R1/R6/R11 (docs/05-data-rules.md):** the model never computes or invents a number. Any free-text field the model writes (a label) must be guarded against containing a number that is not visible on the chart, using the EXISTING `guardText`/`unplottedDigits` helpers in `src/chart/copilot/text-guard.ts` and `map.ts` — do not write a new guard for text fields, reuse the existing one exactly as `setTitle`/`setCaption`/`addNote` already do.
- **The one field that is a genuine exception, and needs its OWN new guard:** `addGoalLine`'s `value` is a bare number, not text on a chart — it is a reader-supplied target that is legitimately NOT one of the chart's own plotted values. Task 5 below specifies the exact guard: the value must appear as a digit run in the user's own raw chat message, or the command is refused. Do not relax or skip this guard and do not reuse `unplottedDigits` (which checks against the CHART's numbers, not the message) for it.
- **The model answers in LABELS, never keys/ids.** Every new command's fields name a series by its exact label and a period by its exact label, exactly like the nine existing command kinds. `map.ts` resolves labels to real keys/codes/resultIds by lookup against the executed `ChartSpec`; an unresolved label is a refusal, never a guess at the nearest match.
- **Capabilities are advisory only; the client's own dispatch-time validation is the real gate** (`src/chart/copilot/types.ts`'s own doc comment on `sanitizeCbsCapabilities`). `addNote`/`setTitle`/`setCaption` are not gated by any capability field today and rely on the client dropping an inapplicable command silently. Follow the same pattern for the five new commands in this plan — do NOT invent a new capabilities field unless a task below explicitly says to.
- **CBS/Eurostat card only.** None of this plan touches `src/attachments/` (the own-data tier) or `web/components/user-chart.tsx`. Own-data parity is an explicit, disclosed follow-up, not scope here.
- **No live LLM spend required or expected anywhere in this plan.** `npm run chart-copilot:fixtures` / `npm run attachments:fixtures` (no `--record` flag) write fixtures OFFLINE from hand-authored expected output — free, no network, no key needed. Never run the `:record` variants in this plan; they spend real money and are an owner-only step for later.
- **Verification per task:** `npm run typecheck` (root) at minimum after every task; the FULL suite (root vitest + web vitest + real Playwright e2e, run locally — `npx playwright test` or this repo's own e2e script) is REQUIRED at the end of Task 1 and Task 6, not just a subset. A prior session's own lesson, twice-learned today: a narrow vitest pass is not enough to catch a request-hash shift — only the real Playwright suite proves it, and it runs entirely offline against the mock-fixture server.
- **Commit after each task**, using this project's commit style (imperative subject, body explaining why, ending with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`).
- **You are in an isolated git worktree already** (`.claude/worktrees/chart-copilot-phase6`, branch `worktree-chart-copilot-phase6`). Do not touch the main checkout. Do not push — the orchestrating session pushes after final review.

---

### Task 1: Unblock donut + house-style templates via chat (fixture regeneration, not a revert)

**Files:**
- Modify: `src/attachments/copilot/types.ts` (re-add `pieHole` to `PRESENTATION_KEYS`; re-add the five house-style ids to `TEMPLATE_IDS`)
- Modify: `src/attachments/copilot/schema.ts` (re-add `pieHole` to `patchSchema`, if it is not purely derived from `PRESENTATION_KEYS`)
- Modify: `tests/fixtures/chart-copilot/cases.ts` and `tests/fixtures/attachments/cases.ts` (two new hand-authored cases)
- Regenerate (do not hand-edit): everything under `tests/fixtures/llm/chart-copilot/` and `tests/fixtures/llm/attachments/`
- Test: `web/e2e/chart-copilot.spec.ts` (confirm/extend), `tests/chart/copilot-fixtures.test.ts`, `tests/attachments/fixtures.test.ts`

**Context you need first:**
- **Do not run git commands against the original repo checkout or any path outside this worktree — cross-checkout git is blocked from inside a worktree and will fail.** You don't need history for this task: everything you need is CURRENT state, already present in this worktree. Read `docs/open-questions.md` rows #301 and #275 (present in this worktree) for the narrative of what was built and reverted. Read `web/lib/chart-templates.ts`'s `CHART_TEMPLATES` for the five house-style template ids (Salmon Editorial, Studio Grey, Broadsheet, Autumn Letter, Brutalist Ink) — they already exist there, you're only adding their ids to the chat-facing `TEMPLATE_IDS` list, not creating them. Read the CURRENT `src/attachments/copilot/types.ts` to see exactly which keys/ids `PRESENTATION_KEYS`/`TEMPLATE_IDS` are currently missing relative to what the panel already offers (`patchSchema`'s sibling in `web/lib/chart-presentation.ts` / the templates file) — derive the diff from reading current files side by side, not from a stored patch.
- Read `scripts/chart-copilot-fixtures.ts` and `scripts/attachments-fixtures.ts` in full (both short). Understand `writeOffline()`: it rebuilds every case's real request (hash included) from the CURRENT code and writes a fixture file whose response is the case's own hand-authored `output` — no network call. This is why widening a capability list does NOT strictly require live spend: every EXISTING case's hand-authored expected output is unaffected by an unrelated new capability, so regenerating offline reproduces a working fixture for it under the new hash. What genuinely has no offline substitute is confirming the REAL model behaves as hoped on a brand-new capability — that's why this task also adds new cases (below), honestly built by hand, not claimed as live-verified.

- [ ] **Step 1: Re-add the capabilities**

In `src/attachments/copilot/types.ts`, add `'pieHole'` back to the `PRESENTATION_KEYS` array, and add the five house-style ids back to `TEMPLATE_IDS` (read `web/lib/chart-templates.ts`'s `CHART_TEMPLATES` for their exact ids — the ADR 043/STATUS text names them Salmon Editorial, Studio Grey, Broadsheet, Autumn Letter, Brutalist Ink; use whatever ids `CHART_TEMPLATES` actually assigns them, not invented ones). If `src/attachments/copilot/schema.ts`'s `patchSchema` derives its `pieHole` field from a literal rather than from `PRESENTATION_KEYS` directly, add it there too — check both.

- [ ] **Step 2: Soften the TEMPLATE_IDS cross-check test**

Find the test that pins `TEMPLATE_IDS` against `CHART_TEMPLATES` (grep for `TEMPLATE_IDS` in `tests/`). The revert commit `35513e4f` softened this from "TEMPLATE_IDS equals CHART_TEMPLATES" to "TEMPLATE_IDS is a subset of CHART_TEMPLATES" — apply that same relaxation (re-read the commit's diff for the exact assertion if unsure).

- [ ] **Step 3: Add two new hand-authored fixture cases**

In `tests/fixtures/chart-copilot/cases.ts`, add ONE new case to the `CASES` array that asks for a donut via chat, e.g.:

```ts
{
  label: 'chat-donut-piehole',
  spec: REGION_SERIES_SPEC,
  capabilities: {
    forms: ['line', 'area', 'bar', 'hbar', 'table', 'pie'],
    presentationKeys: ['pieHole'],
    templates: [],
    zoom: false,
    lang: 'nl',
  },
  message: 'Maak er een donut van',
  output: {
    version: 1,
    view: [{ kind: 'setPresentation', patch: /* every OTHER key null, pieHole: true — copy the exact shape patchSchema requires from an existing setPresentation case in this same file */ }],
    dataRequest: false,
    refused: [],
    confidence: 0.9,
    reading: 'Reader asked for a donut chart; pieHole is offered, applying it.',
  },
},
```

Copy the exact `patch` object shape (every key present, most `null`) from an existing `setPresentation` case already in this file rather than guessing the field list. In `tests/fixtures/attachments/cases.ts`, add an analogous case for the own-data tier's own `pieHole` (same idea, that tier's own case shape).

Add ONE more case asking for one of the five house styles by name, e.g. message `"Gebruik de Broadsheet-stijl"`, output `{ kind: 'applyTemplate', templateId: '<the real Broadsheet id>' }`.

- [ ] **Step 4: Regenerate fixtures offline (no spend)**

```bash
npm run chart-copilot:fixtures
npm run attachments:fixtures
```

Read the output. Every EXISTING case should print `unchanged` or `written` (a hash shift is expected and fine — that's the whole point); your two NEW cases should print `written`. Commit the new/changed files under `tests/fixtures/llm/chart-copilot/` and `tests/fixtures/llm/attachments/` as part of this task's commit — do not hand-edit them.

- [ ] **Step 5: Full local verification — do not skip the real e2e suite**

```bash
npm run typecheck
npm test
cd web && npm test && cd ..
npx playwright test web/e2e/chart-copilot.spec.ts
```

All must be green, INCLUDING the real Playwright run (this is what the CI mock-fixture server actually exercises — a vitest-only pass is not sufficient evidence, per today's two earlier reverts). If the Playwright run fails on an UNRELATED pre-existing flake, note it and re-run once; if it fails on anything touching chat/co-pilot/templates, that is a real bug in this task, not noise.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(chart): donut + five house styles reachable via chat co-pilot

Both were built earlier today and reverted because widening a
capability list embedded in the LLM prompt shifts the request hash
every existing test fixture is keyed on. The actual fix does not need
live model spend: regenerating fixtures offline
(chart-copilot:fixtures / attachments:fixtures) reproduces a working
fixture for every existing case under its new hash, because none of
their hand-authored expected output changes just because an unrelated
capability was added. Two new hand-authored cases exercise the two
capabilities themselves; real-model confirmation of those two specific
cases is still an owner step once the Anthropic usage cap lifts
(2026-10-01) via chart-copilot:record / attachments:record — see
docs/open-questions.md #301 and #275, updated in the same change as
this plan's final docs task.

Verified: full local Playwright e2e suite green (not just vitest).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `setDimmed` and `setHeadlineOverride` via chat

Both already work from the panel on this tier with no capability gate beyond being a real series/point — the simplest two of the five, and a good template for Tasks 3-5.

**Files:**
- Modify: `src/chart/copilot/schema.ts`
- Modify: `src/chart/copilot/map.ts`
- Modify: `src/chart/copilot/prompt.ts`
- Test: `tests/chart/copilot-map.test.ts` (or wherever `mapCbsCopilotOutput` is unit-tested today — find it by grepping for `mapCbsCopilotOutput` under `tests/`)

**Interfaces:**
- Consumes: `mapCbsCopilotOutput`'s existing `seriesIndex: Map<string, number>` (built at the top of the function from `spec.series`) and its existing point-lookup pattern (see `addNote`'s case).
- Produces: client commands `{ kind: 'setDimmed', hiddenKeys: string[], dimmedKeys: string[] }` and `{ kind: 'setHeadlineOverride', resultId: string | null }` — EXACT shapes already defined in `web/lib/chart-commands.ts`'s `ChartCommandParams` (read them there; do not redefine).

- [ ] **Step 1: Add both to the schema**

In `src/chart/copilot/schema.ts`, add two members to `cbsViewCommandSchema`'s discriminated union (after `addNote`, before the closing `]`):

```ts
z.strictObject({
  kind: z.literal('setDimmed'),
  hiddenLabels: z.array(z.string()),
  dimmedLabels: z.array(z.string()),
}),
z.strictObject({
  kind: z.literal('setHeadlineOverride'),
  seriesLabel: z.string().nullable(),
  periodLabel: z.string().nullable(),
}),
```

- [ ] **Step 2: Add a failing unit test for each**

Find the existing test file that calls `mapCbsCopilotOutput` directly (grep `tests/` for it) and add two tests following its existing style:

```ts
test('setDimmed resolves labels to series keys', () => {
  const output = { ...baseOutput, view: [{ kind: 'setDimmed', hiddenLabels: [], dimmedLabels: ['Rotterdam'] }] };
  const { commands, refused } = mapCbsCopilotOutput(output, REGION_SERIES_SPEC, 'test message', baseCapabilities);
  expect(refused).toEqual([]);
  expect(commands).toEqual([{ kind: 'setDimmed', hiddenKeys: [], dimmedKeys: ['s1'] }]);
});

test('setDimmed refuses an unknown series label', () => {
  const output = { ...baseOutput, view: [{ kind: 'setDimmed', hiddenLabels: ['Utrecht'], dimmedLabels: [] }] };
  const { commands, refused } = mapCbsCopilotOutput(output, REGION_SERIES_SPEC, 'test message', baseCapabilities);
  expect(commands).toEqual([]);
  expect(refused[0]?.reason).toBe('not_on_this_chart');
});

test('setHeadlineOverride resolves a real point', () => {
  const output = { ...baseOutput, view: [{ kind: 'setHeadlineOverride', seriesLabel: 'Amsterdam', periodLabel: '2022' }] };
  const { commands } = mapCbsCopilotOutput(output, REGION_SERIES_SPEC, 'test message', baseCapabilities);
  expect(commands[0]?.kind).toBe('setHeadlineOverride');
  expect((commands[0] as { resultId: string }).resultId).toContain('GM0363');
});

test('setHeadlineOverride null/null clears it', () => {
  const output = { ...baseOutput, view: [{ kind: 'setHeadlineOverride', seriesLabel: null, periodLabel: null }] };
  const { commands } = mapCbsCopilotOutput(output, REGION_SERIES_SPEC, 'test message', baseCapabilities);
  expect(commands).toEqual([{ kind: 'setHeadlineOverride', resultId: null }]);
});
```

Adjust `baseOutput`/`baseCapabilities`/exact series index (`s0`/`s1`) to match whatever fixtures the existing test file already uses — read it first, don't invent a parallel style. Note the THIRD argument `'test message'`: Task 5 changes `mapCbsCopilotOutput`'s signature to take the raw message (needed for the goal-line guard). Add that parameter now (threaded through but unused by these two cases) so Tasks 2-4 don't each touch the signature separately — see Step 3.

- [ ] **Step 2b: Run the tests, confirm they fail** (function doesn't handle these kinds yet / signature mismatch) — expected.

- [ ] **Step 3: Implement in map.ts**

`mapCbsCopilotOutput`'s signature changes from `(output, spec, capabilities, noteIdSuffix?)` to `(output, spec, message, capabilities, noteIdSuffix?)` — add `message: string` as the third parameter (before `capabilities`, matching the test calls above). It is unused by this task's two cases; Task 5 uses it.

**This is a breaking signature change — before writing new code, run `grep -rn "mapCbsCopilotOutput(" src/ tests/ web/` and update EVERY call site it finds to pass the new `message` argument, not just the ones you touch for this task's own tests.** There is exactly one production call site (`src/chart/copilot/respond.ts`, currently `mapCbsCopilotOutput(output, spec, caps)` around line 64 — change to `mapCbsCopilotOutput(output, spec, message, caps)`; `message` is already in scope there, destructured from `input` near the top of the function) but there are very likely several more calls inside the existing test file(s) that predate this task — each one needs a message string inserted as the third argument (any short literal like `'test message'` is fine for a case that doesn't test message-dependent behavior). Run `npm run typecheck` after this step specifically — a missed call site fails loudly there before you get to Step 2.

Add two cases to the `switch (command.kind)` block in `map.ts`, near `setSeriesView` (same family):

```ts
case 'setDimmed': {
  const allLabels = [...command.hiddenLabels, ...command.dimmedLabels];
  const unknown = allLabels.find((label) => !seriesIndex.has(label));
  if (unknown !== undefined) {
    out.refused.push({ request: cap(`series: ${unknown}`), reason: 'not_on_this_chart', control: 'form' });
    break;
  }
  out.commands.push({
    kind: 'setDimmed',
    hiddenKeys: command.hiddenLabels.map((label) => `s${seriesIndex.get(label)!}`),
    dimmedKeys: command.dimmedLabels.map((label) => `s${seriesIndex.get(label)!}`),
  });
  break;
}

case 'setHeadlineOverride': {
  if (command.seriesLabel === null && command.periodLabel === null) {
    out.commands.push({ kind: 'setHeadlineOverride', resultId: null });
    break;
  }
  if (command.seriesLabel === null || command.periodLabel === null) {
    out.refused.push({ request: cap(`headline: ${command.seriesLabel ?? '?'} @ ${command.periodLabel ?? '?'}`), reason: 'not_on_this_chart', control: 'form' });
    break;
  }
  const point = spec.series.find((series) => series.label === command.seriesLabel)?.points.find((p) => p.periodLabel === command.periodLabel);
  if (point === undefined) {
    out.refused.push({ request: cap(`headline: ${command.seriesLabel} @ ${command.periodLabel}`), reason: 'not_on_this_chart', control: 'form' });
    break;
  }
  out.commands.push({ kind: 'setHeadlineOverride', resultId: point.resultId });
  break;
}
```

- [ ] **Step 4: Run the tests, confirm they pass.** Run `npm run typecheck` too — the `respond.ts` call-site change must typecheck.

- [ ] **Step 5: Add prompt coverage**

In `src/chart/copilot/prompt.ts`: bump `CBS_COPILOT_PROMPT_VERSION` from `3` to `4` (this task starts the bump; Tasks 3-5 do NOT bump it again — one bump for the whole phase 6, same as phase 5b did one bump for its three new forms). Add two bullets to the `VIEW COMMANDS` list in `SYSTEM_PROMPT`, in the same style as the existing ones:

```
- setDimmed: {"kind":"setDimmed","hiddenLabels":["<series label>"],"dimmedLabels":["<series label>"]} — dims a series (fades it, keeps it visible) instead of hiding it. Labels exactly as setSeriesView.
- setHeadlineOverride: {"kind":"setHeadlineOverride","seriesLabel":"<series label>"|null,"periodLabel":"<period label>"|null} — features one point's value as the chart's headline number. Both null clears it. Both must name a real point or the request is refused.
```

Update this file's own top-of-file comment noting the version bump reason, matching the style of the existing "Bumped 1 → 2... Bumped 2 → 3..." comment.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(chart): setDimmed + setHeadlineOverride reachable via chat co-pilot

Both already work from the panel with no extra gating beyond naming a
real series/point, so this follows the established label-lookup
pattern (setSeriesView, addNote) with no new capability plumbing.
mapCbsCopilotOutput now takes the raw user message as a parameter
(unused by these two commands) ahead of the goal-line guard landing
in a later task on this same branch.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `addEraShading` via chat

**Files:**
- Modify: `src/chart/copilot/schema.ts`, `src/chart/copilot/map.ts`, `src/chart/copilot/prompt.ts`
- Test: same file as Task 2

**Interfaces:**
- Consumes: `map.ts`'s existing `periodCodeByLabel: Map<string, string>` (already built near the top of `mapCbsCopilotOutput`, currently used only by `setPeriodRange` — reuse it, do not rebuild it), and `guardText`/`CHART_ERA_SHADING_LABEL_MAX_LENGTH`-equivalent local constant (define `ERA_LABEL_MAX = 60` locally in `map.ts`, matching the existing `TITLE_MAX`/`CAPTION_MAX`/`NOTE_MAX` local-constant convention — do not import from `web/lib/chart-commands.ts`, backend code does not depend on web code here).
- Produces: `{ kind: 'addEraShading', era: { id: string, fromPeriodCode: string, toPeriodCode: string, label: string } }` — exact shape from `web/lib/chart-commands.ts`'s `EraShading`.

- [ ] **Step 1: Schema**

```ts
z.strictObject({
  kind: z.literal('addEraShading'),
  fromLabel: z.string(),
  toLabel: z.string(),
  label: z.string(),
}),
```

- [ ] **Step 2: Failing tests**

```ts
test('addEraShading resolves period labels and orders them ascending', () => {
  const output = { ...baseOutput, view: [{ kind: 'addEraShading', fromLabel: '2023', toLabel: '2021', label: 'Herstel' }] };
  const { commands } = mapCbsCopilotOutput(output, REGION_SERIES_SPEC, 'test message', baseCapabilities);
  expect(commands[0]).toMatchObject({ kind: 'addEraShading', era: { fromPeriodCode: '2021JJ00', toPeriodCode: '2023JJ00', label: 'Herstel' } });
});

test('addEraShading refuses an unplotted number in the label', () => {
  const output = { ...baseOutput, view: [{ kind: 'addEraShading', fromLabel: '2021', toLabel: '2023', label: 'Groei van 99 procent' }] };
  const { commands, refused } = mapCbsCopilotOutput(output, REGION_SERIES_SPEC, 'test message', baseCapabilities);
  expect(commands).toEqual([]);
  expect(refused[0]?.reason).toBe('unplotted_number');
});

test('addEraShading refuses an unknown period label', () => {
  const output = { ...baseOutput, view: [{ kind: 'addEraShading', fromLabel: '2019', toLabel: '2023', label: 'Herstel' }] };
  const { commands, refused } = mapCbsCopilotOutput(output, REGION_SERIES_SPEC, 'test message', baseCapabilities);
  expect(commands).toEqual([]);
  expect(refused[0]?.reason).toBe('not_available');
});
```

- [ ] **Step 3: Run, confirm failure.**

- [ ] **Step 4: Implement**

Add `const ERA_LABEL_MAX = 60;` near the top of `map.ts`'s other MAX constants. Add the case (place it near `setPeriodRange`, which already builds `periodCodeByLabel`):

```ts
case 'addEraShading': {
  const fromCode = periodCodeByLabel.get(command.fromLabel);
  const toCode = periodCodeByLabel.get(command.toLabel);
  if (fromCode === undefined || toCode === undefined) {
    out.refused.push({ request: cap(`era: ${command.fromLabel}–${command.toLabel}`), reason: 'not_available', control: 'form' });
    break;
  }
  const label = guardText(command.label, ERA_LABEL_MAX, spec, 'none', out);
  if (label === null) break;
  const [a, b] = fromCode.localeCompare(toCode) <= 0 ? [fromCode, toCode] : [toCode, fromCode];
  out.commands.push({ kind: 'addEraShading', era: { id: `chat-era-${extraCount++}${noteIdSuffix}`, fromPeriodCode: a, toPeriodCode: b, label } });
  break;
}
```

Add `let extraCount = 0;` near the existing `let noteCount = 0;` at the top of `mapCbsCopilotOutput` (a shared counter for every NEW id-minting command kind this plan adds — era shading, derived overlay, goal line — kept separate from `noteCount` so `addNote`'s existing id scheme and any test pinned to it are untouched).

- [ ] **Step 5: Run, confirm pass. Run typecheck.**

- [ ] **Step 6: Prompt bullet**

```
- addEraShading: {"kind":"addEraShading","fromLabel":"<period label>","toLabel":"<period label>","label":"..."} — shades a period range with a typed label. Both labels copied LITERALLY from the CURRENT CHART's period labels, like setPeriodRange.
```

- [ ] **Step 7: Commit** (same message style as Task 2, adapted).

---

### Task 4: `addDerivedOverlay` via chat (difference + mean)

**Read first:** `web/components/chart.tsx`'s two `addDerivedOverlay` dispatch sites (search `data-command-kind="addDerivedOverlay"`) to confirm this task's semantics still match the live panel behavior before implementing — the panel's `difference` requires two points in the SAME region and its `mean` requires exactly one series currently visible, averaging all its currently-windowed points. This task's chat design (below) intentionally simplifies the "exactly one visible" precondition — the model names the series explicitly, which is its own disambiguation, so chat may address a hidden series that the panel button currently cannot reach. If your reading of the current code finds this characterization wrong, follow the real code, not this paragraph, and flag the discrepancy in your task report.

**Files:**
- Modify: `src/chart/copilot/schema.ts`, `src/chart/copilot/map.ts`, `src/chart/copilot/prompt.ts`
- Test: same file as Tasks 2-3

**Interfaces:**
- Produces: `{ kind: 'addDerivedOverlay', overlay: { id: string, calcKind: 'difference' | 'mean', resultIds: string[] } }` — exact shape from `web/lib/chart-commands.ts`'s `DerivedOverlayRequest`.

- [ ] **Step 1: Schema**

```ts
z.strictObject({
  kind: z.literal('addDerivedOverlay'),
  calcKind: z.enum(['difference', 'mean']),
  seriesLabel: z.string(),
  fromLabel: z.string().nullable(),
  toLabel: z.string().nullable(),
}),
```

- [ ] **Step 2: Failing tests**

```ts
test('addDerivedOverlay difference resolves two points on one series', () => {
  const output = { ...baseOutput, view: [{ kind: 'addDerivedOverlay', calcKind: 'difference', seriesLabel: 'Amsterdam', fromLabel: '2020', toLabel: '2024' }] };
  const { commands } = mapCbsCopilotOutput(output, REGION_SERIES_SPEC, 'test message', baseCapabilities);
  expect(commands[0]).toMatchObject({ kind: 'addDerivedOverlay', overlay: { calcKind: 'difference' } });
  expect((commands[0] as { overlay: { resultIds: string[] } }).overlay.resultIds).toHaveLength(2);
});

test('addDerivedOverlay mean takes every point of the named series', () => {
  const output = { ...baseOutput, view: [{ kind: 'addDerivedOverlay', calcKind: 'mean', seriesLabel: 'Rotterdam', fromLabel: null, toLabel: null }] };
  const { commands } = mapCbsCopilotOutput(output, REGION_SERIES_SPEC, 'test message', baseCapabilities);
  const overlay = (commands[0] as { overlay: { resultIds: string[] } }).overlay;
  expect(overlay.resultIds.length).toBeGreaterThanOrEqual(2);
});

test('addDerivedOverlay refuses an unknown series', () => {
  const output = { ...baseOutput, view: [{ kind: 'addDerivedOverlay', calcKind: 'mean', seriesLabel: 'Utrecht', fromLabel: null, toLabel: null }] };
  const { commands, refused } = mapCbsCopilotOutput(output, REGION_SERIES_SPEC, 'test message', baseCapabilities);
  expect(commands).toEqual([]);
  expect(refused[0]?.reason).toBe('not_on_this_chart');
});

test('addDerivedOverlay difference refuses matching from/to', () => {
  const output = { ...baseOutput, view: [{ kind: 'addDerivedOverlay', calcKind: 'difference', seriesLabel: 'Amsterdam', fromLabel: '2022', toLabel: '2022' }] };
  const { commands, refused } = mapCbsCopilotOutput(output, REGION_SERIES_SPEC, 'test message', baseCapabilities);
  expect(commands).toEqual([]);
  expect(refused).toHaveLength(1);
});
```

- [ ] **Step 3: Run, confirm failure.**

- [ ] **Step 4: Implement**

```ts
case 'addDerivedOverlay': {
  const seriesPoints = spec.series.find((series) => series.label === command.seriesLabel)?.points;
  if (seriesPoints === undefined) {
    out.refused.push({ request: cap(`overlay: ${command.seriesLabel}`), reason: 'not_on_this_chart', control: 'form' });
    break;
  }
  if (command.calcKind === 'difference') {
    if (command.fromLabel === null || command.toLabel === null) {
      out.refused.push({ request: cap('overlay: difference'), reason: 'not_available', control: 'form' });
      break;
    }
    const fromPoint = seriesPoints.find((p) => p.periodLabel === command.fromLabel);
    const toPoint = seriesPoints.find((p) => p.periodLabel === command.toLabel);
    if (fromPoint === undefined || toPoint === undefined || fromPoint.resultId === toPoint.resultId) {
      out.refused.push({ request: cap(`overlay: ${command.fromLabel}–${command.toLabel}`), reason: 'not_on_this_chart', control: 'form' });
      break;
    }
    out.commands.push({
      kind: 'addDerivedOverlay',
      overlay: { id: `chat-overlay-${extraCount++}${noteIdSuffix}`, calcKind: 'difference', resultIds: [fromPoint.resultId, toPoint.resultId] },
    });
  } else {
    const resultIds = seriesPoints.map((p) => p.resultId);
    if (resultIds.length < 2) {
      out.refused.push({ request: cap(`overlay: ${command.seriesLabel}`), reason: 'not_on_this_chart', control: 'form' });
      break;
    }
    out.commands.push({
      kind: 'addDerivedOverlay',
      overlay: { id: `chat-overlay-${extraCount++}${noteIdSuffix}`, calcKind: 'mean', resultIds },
    });
  }
  break;
}
```

- [ ] **Step 5: Run, confirm pass. Run typecheck.**

- [ ] **Step 6: Prompt bullet**

```
- addDerivedOverlay: {"kind":"addDerivedOverlay","calcKind":"difference"|"mean","seriesLabel":"<series label>","fromLabel":"<period label>"|null,"toLabel":"<period label>"|null} — a computed overlay drawn on the chart, never a number you state yourself. difference needs fromLabel and toLabel (two different real periods on that series); mean ignores them and averages every point of that series currently on the chart.
```

- [ ] **Step 7: Commit.**

---

### Task 5: `addGoalLine` via chat, with the numeric-provenance guard

This is the one command in this plan that carries a bare number, so it gets its own careful guard — read the Global Constraints section above again before starting.

**Files:**
- Modify: `src/chart/copilot/schema.ts`, `src/chart/copilot/map.ts`, `src/chart/copilot/prompt.ts`
- Test: same file as Tasks 2-4

**Interfaces:**
- Produces: `{ kind: 'addGoalLine', goalLine: { id: string, value: number, label: string } }` — exact shape from `web/lib/chart-commands.ts`'s `GoalLine`.

- [ ] **Step 1: Schema**

```ts
z.strictObject({
  kind: z.literal('addGoalLine'),
  value: z.number(),
  label: z.string(),
}),
```

- [ ] **Step 2: Failing tests**

```ts
test('addGoalLine accepts a value that appears in the user message', () => {
  const output = { ...baseOutput, view: [{ kind: 'addGoalLine', value: 900000, label: 'Doel' }] };
  const { commands, refused } = mapCbsCopilotOutput(output, REGION_SERIES_SPEC, 'Voeg een doellijn toe op 900000', baseCapabilities);
  expect(refused).toEqual([]);
  expect(commands[0]).toMatchObject({ kind: 'addGoalLine', goalLine: { value: 900000, label: 'Doel' } });
});

test('addGoalLine accepts a locale-formatted value in the message', () => {
  const output = { ...baseOutput, view: [{ kind: 'addGoalLine', value: 900000, label: 'Doel' }] };
  const { commands, refused } = mapCbsCopilotOutput(output, REGION_SERIES_SPEC, 'Voeg een doellijn toe op 900.000', baseCapabilities);
  expect(refused).toEqual([]);
  expect(commands).toHaveLength(1);
});

test('addGoalLine refuses a value the user never typed', () => {
  const output = { ...baseOutput, view: [{ kind: 'addGoalLine', value: 12345, label: 'Doel' }] };
  const { commands, refused } = mapCbsCopilotOutput(output, REGION_SERIES_SPEC, 'Voeg een doellijn toe', baseCapabilities);
  expect(commands).toEqual([]);
  expect(refused[0]?.reason).toBe('not_available');
});

test('addGoalLine refuses an unplotted number in the label even when the value is valid', () => {
  const output = { ...baseOutput, view: [{ kind: 'addGoalLine', value: 900000, label: 'Doel voor 2030' }] };
  const { commands, refused } = mapCbsCopilotOutput(output, REGION_SERIES_SPEC, 'Voeg een doellijn toe op 900000', baseCapabilities);
  expect(commands).toEqual([]);
  expect(refused[0]?.reason).toBe('unplotted_number');
});
```

- [ ] **Step 3: Run, confirm failure.**

- [ ] **Step 4: Implement the guard in `text-guard.ts`**

Add this function to `src/chart/copilot/text-guard.ts` (it belongs next to `unplottedDigits`, not in `map.ts` — same module, same reasoning, different source of truth):

```ts
/**
 * True when `value` appears as a digit run inside `message` (thousands/
 * decimal separators ignored on both sides, so "900000" and "900.000"
 * both match). A goal line's value is the one field on this tier that is
 * a bare NUMBER, not guarded text — so unlike a title/caption/note
 * (checked against the CHART's own numbers via unplottedDigits), it is
 * checked against what the READER actually typed: a legitimate goal line
 * names a target that is deliberately NOT one of the chart's own plotted
 * values, so plottedNumbers() is the wrong reference set here. A value
 * that does not appear in the message is, by construction, one the model
 * invented — principle (c)'s worst bug — so it is refused, never guessed.
 */
export function goalLineValueInMessage(value: number, message: string): boolean {
  if (!Number.isFinite(value)) return false;
  const normalize = (run: string): string => run.replace(/[.,]/g, '');
  const target = normalize(String(value));
  const runs = message.match(/[0-9][0-9.,]*/g) ?? [];
  return runs.some((run) => normalize(run.replace(/[.,]+$/, '')) === target);
}
```

- [ ] **Step 5: Implement the case in `map.ts`**

Import `goalLineValueInMessage` from `./text-guard.ts` at the top of `map.ts`. Add `const GOAL_LINE_LABEL_MAX = 60;` next to `ERA_LABEL_MAX`. Add the case:

```ts
case 'addGoalLine': {
  if (!goalLineValueInMessage(command.value, message)) {
    out.refused.push({ request: cap(`goal line: ${command.value}`), reason: 'not_available', control: 'form' });
    break;
  }
  const label = guardText(command.label, GOAL_LINE_LABEL_MAX, spec, 'none', out);
  if (label === null) break;
  out.commands.push({ kind: 'addGoalLine', goalLine: { id: `chat-goal-${extraCount++}${noteIdSuffix}`, value: command.value, label } });
  break;
}
```

(`message` is the new third parameter Task 2 added to `mapCbsCopilotOutput` — this is the task that finally uses it.)

- [ ] **Step 6: Run, confirm pass. Run typecheck.**

- [ ] **Step 7: Prompt bullet**

```
- addGoalLine: {"kind":"addGoalLine","value":<number>,"label":"..."} — value MUST be a number the user's own message actually contains (copy it, never compute or estimate it); anything else is refused. label follows the same number rule as title/caption.
```

- [ ] **Step 8: Commit.**

---

### Task 6: New real fixtures for all five Track-2 commands + full verification

**Files:**
- Modify: `tests/fixtures/chart-copilot/cases.ts` (five new cases)
- Modify: `web/e2e/chart-copilot.spec.ts` (at least one new real end-to-end case)
- Regenerate: `tests/fixtures/llm/chart-copilot/*`

- [ ] **Step 1: Add five hand-authored cases to `CASES`**, one per new command kind, using `REGION_SERIES_SPEC` (Amsterdam GM0363 / Rotterdam GM0599, 2020-2024). Concrete cases to author (match the exact `output` shape `CbsCopilotOutput` requires — copy the envelope fields from an existing case):

  1. `label: 'chat-dim-series'` — message `"Dim Rotterdam in plaats van hem te verbergen"` → `setDimmed` with `dimmedLabels: ['Rotterdam']`.
  2. `label: 'chat-headline-override'` — message `"Maak van Amsterdam in 2022 het hoofdcijfer"` → `setHeadlineOverride` with `seriesLabel: 'Amsterdam', periodLabel: '2022'`.
  3. `label: 'chat-era-shading'` — message `"Arceer 2021 tot 2023 als herstelperiode"` → `addEraShading` with `fromLabel: '2021', toLabel: '2023', label: 'Herstelperiode'`.
  4. `label: 'chat-derived-difference'` — message `"Laat het verschil zien tussen Amsterdam in 2020 en 2024"` → `addDerivedOverlay` with `calcKind: 'difference', seriesLabel: 'Amsterdam', fromLabel: '2020', toLabel: '2024'`.
  5. `label: 'chat-goal-line'` — message `"Voeg een doellijn toe op 900000"` → `addGoalLine` with `value: 900000, label: 'Doel'`.

Each case's `capabilities.forms` must include `'line'` (the spec's own kind) and be otherwise realistic — copy an existing case's capabilities object and adjust minimally.

- [ ] **Step 2: Regenerate offline**

```bash
npm run chart-copilot:fixtures
```

Confirm five new files are `written` and every prior case is `unchanged` or `written` (a hash shift on unrelated cases is expected from the prompt version bump in Tasks 2-5 — that's fine, they're still hand-authored-correct, just under a new hash).

- [ ] **Step 3: Add one real end-to-end Playwright test**

Open `web/e2e/chart-copilot.spec.ts`, find the existing test that drives a chat message through the real UI against the `!!intent` fixture chart (the one `REGION_SERIES_SPEC` was captured from) and add ONE new test in the same style that types one of the five new messages above (pick `addEraShading` or `setDimmed` — whichever the file's existing helpers make easiest) into the real chat box and asserts the resulting chart state changed accordingly (an era-shading region appears / the dimmed series renders faded-not-hidden) — read the file's existing assertions for how prior phases checked their own new command's visible effect and follow that pattern.

- [ ] **Step 4: Full local verification**

```bash
npm run typecheck
npm test
cd web && npm test && cd ..
npx playwright test web/e2e/chart-copilot.spec.ts
```

Every one of these must be green, including the new Playwright test. If anything fails, fix it — this task does not end until the full suite (not a subset) is green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
test(chart): real fixture + e2e coverage for the five new chat commands

One hand-authored case per new command kind (dim, headline override,
era shading, derived difference overlay, goal line), regenerated
offline (no live spend), plus one real Playwright e2e case proving
the mock-fixture server round-trip actually renders the expected
chart change — the lesson from today's two earlier reverts is that a
vitest-only pass is not sufficient evidence for anything that reaches
the LLM prompt.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## After Task 6 (orchestrating session, not a subagent task)

1. Final whole-branch adversarial review of all six tasks together — pay special attention to: the `goalLineValueInMessage` guard (Task 5) for a bypass (e.g. a value that appears in the message but means something else, like a period year being mistaken for a goal value — decide if this is an acceptable false-accept and document it, don't silently ignore it), the `mapCbsCopilotOutput` signature change (Task 2) applied consistently everywhere it's called or tested, and the `extraCount`/`noteCount` id-uniqueness across Tasks 3-5.
2. Update `docs/open-questions.md` #289, #296, #301, #275 (mark the chat-wiring pieces done, keep own-data parity and live-record confirmation open), `docs/decisions/056-chart-copilot.md` ("As built — phase 6"), `docs/08-build-plan.md`'s chart co-pilot entry, `docs/STATUS.md`.
3. Full verification block (typecheck, full suites, benchmark 14/14 + 6/6 + 0 fabricated, real Playwright e2e, `/code-review` LOW effort on the diff, real `next build`).
4. Push directly to `main` (owner present in chat this session — standing authorization applies; no PR needed).
