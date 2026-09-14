# Chart visual + embed pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three additive, low-risk visual/embeddability improvements to the existing chart system: a softer default chrome, two new chart templates (surfaced in the public gallery), and a live chart preview in the embed dialog.

**Architecture:** No new subsystems. Each task extends an existing, already-proven mechanism: `STOCK_PRESENTATION`'s shared defaults (ADR 042), the `template()` roster (ADR 043), and the `ChartEditModal` split-pane pattern (session 101, already used for the Style editor). None of the three touch the honesty contract (no data, label, or resultId-binding logic changes) — presentation only.

**Tech Stack:** Next.js/React, Recharts, Vitest, the repo's existing `web/lib/chart-presentation.ts` / `chart-templates.ts` / `chart.tsx` modules.

**Spec:** None — classified as bounded work in-chat (2026-09-13, owner present): each task extends an existing flow, no new interfaces other modules depend on, no schema/audit change. Design presented and approved in chat; this plan is the only artifact.

## Global Constraints

- **Never weaken the honesty contract.** No task may change what number, label, or provisional marker is shown, or how `resultId` binding works. These are presentation-only changes (colour, shadow, corner radius, gradient, layout).
- **Every pinned test that encodes an old default must be updated to the new intended value, not preserved.** This is a deliberate design-default change (same pattern as ADR 042's own default-changing precedent) — do not treat a failing pinned test as a bug to route around; update its expectation to match the new decision, and say so in the commit message.
- **Run the full verification block before every commit that touches shared code** (per CLAUDE.md): `npm run typecheck` (both root and `web/`, or the repo's combined script if one exists — check `package.json`), the relevant Vitest suites (`npm run test:chart` at minimum for every task; task 3 also touches `web/lib/chart-templates.test.ts` and `src/chart/curated.test.ts`), a real `next build` in `web/` for task 1 (it changes a client component's control flow).
- **Grep for the old framing after any change to a fixed roster or literal list** (e.g. the six template ids, or a literal `'square'`/`'none'` frame default) — the CHART_TEMPLATES roster and its ids appear in more than one test file; find every pinned copy, not just the one you were pointed at.
- This is **not** a money-path or core-answer-pipeline change — ordinary commit-and-push rules apply (CLAUDE.md's owner-present git workflow), not the branch+PR+owner-go rule reserved for R3/billing work.

---

### Task 1: Chart chrome default polish

**Files:**
- Modify: `web/lib/chart-presentation.ts:123-141` (the `STOCK_PRESENTATION` constant)
- Modify: `web/lib/chart-presentation.ts:97-115` (the `CLASSIC_PRESENTATION` constant) — only if your investigation (Step 1 below) finds the 'classic' template's resolved frame values are actually sourced from this constant rather than from `STOCK_PRESENTATION`'s base
- Test: whichever test files in `web/lib/chart-presentation.test.ts` and `web/lib/chart-templates.test.ts` pin `frameCorners: 'square'` / `frameShadow: 'none'` as the default/standard/classic look

**Interfaces:**
- Consumes: nothing new — this only changes two field values on an existing exported constant.
- Produces: nothing new — `STOCK_PRESENTATION`'s shape and every consumer's contract (`resolvePresentation`, `templateById('standard').overrides`, `FRAME_CORNER_PX`/`FRAME_SHADOW` lookups in `chart-frame.tsx` and `chart-download.tsx`) are unchanged; only the *values* two of its fields resolve to change.

**Context:** Every chart in the product that hasn't had its style explicitly customized (i.e. every first-time view, and every gallery/landing chart using the `standard` look) renders with **zero** frame chrome today — `frameCorners: 'square'` (0px radius) and `frameShadow: 'none'`. `FRAME_CORNER_PX`/`FRAME_SHADOW` (`chart-presentation.ts:445-453`) already define a `rounded` (12px) option and a `soft` shadow (`{ dx: 0, dy: 4, blur: 12, alpha: 0.18 }`) — used by other templates already, just never as the *default*. The single defined shadow/corner map is shared by the on-screen CSS render (`chart-frame.tsx`) and the SVG/PNG export (`chart-download.tsx`), so changing the shared default value flows into both automatically — no second place to update for the change to apply everywhere.

- [ ] **Step 1: Investigate exactly how `resolvePresentation` resolves an unset frame key for each template**

Read `resolvePresentation` in full (`web/lib/chart-presentation.ts`, starts at line 247). Confirm: does every template's *unspecified* keys (e.g. `newsroom`, which never sets `frameCorners`/`frameShadow` in its `overrides` object in `chart-templates.ts`) fall back to `STOCK_PRESENTATION`'s values, or to some other base? Is `CLASSIC_PRESENTATION` (the separate constant) actually read anywhere by the resolver, or is it dead/reference-only (a pinned historical snapshot used only by tests)? Write one sentence of findings before proceeding — this determines whether Step 2 touches one constant or two.

- [ ] **Step 2: Change the default**

In `STOCK_PRESENTATION` (`chart-presentation.ts:123-141`), change:
```ts
  frameCorners: 'square',
  frameShadow: 'none',
```
to:
```ts
  frameCorners: 'rounded',
  frameShadow: 'soft',
```
If Step 1 found `CLASSIC_PRESENTATION` also independently drives a template's resolved frame defaults (rather than being resolver-inert), apply the identical change there too, for consistency — a reader should not see the `classic` look revert to bare-square chrome while every other unstyled chart gets the same soft chrome `standard` now has. If `CLASSIC_PRESENTATION` is resolver-inert (only used as a test-comparison snapshot), leave it untouched and do not invent a change nothing reads.

- [ ] **Step 3: Run the chart test suites and fix every pinned expectation the value change breaks**

Run `npm run test:chart` from the repo root (mirrors `tests/chart`) and the `web/` suite's chart tests (check `web/package.json` for the exact script name, likely `npm test` inside `web/` or a `test:chart` there too). Every failure that asserts the OLD `'square'`/`'none'` value as the expected default is expected and correct to fail — update those assertions to the new `'rounded'`/`'soft'` values. Do NOT change any assertion that is unrelated to this default (if a test fails for a different reason, that's a real regression — stop and investigate, don't paper over it).

- [ ] **Step 4: Commit**

```bash
git add web/lib/chart-presentation.ts web/lib/chart-presentation.test.ts web/lib/chart-templates.test.ts
git commit -m "feat(chart): soften the default chart chrome (rounded corners + soft shadow)

The unstyled default look (STOCK_PRESENTATION, ADR 042) rendered with zero
frame chrome (square corners, no shadow) — every chart in the product looked
bare until a reader opened the style panel. Changes only the shared default;
flows automatically into every chart, the gallery/landing, and chart exports
via the same FRAME_CORNER_PX/FRAME_SHADOW maps chart-frame.tsx and
chart-download.tsx already read.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Two new chart templates + gallery variety

**Files:**
- Modify: `web/lib/chart-templates.ts` (add two entries to `CHART_TEMPLATES`, extend `ChartTemplateId`)
- Modify: `web/lib/i18n/messages.ts` (add nl + en name/description keys)
- Modify: `web/lib/chart-templates.test.ts` (update the pinned roster list, add contrast-gate coverage — the existing `for (const t of CHART_TEMPLATES)` loops already cover any new roster entry automatically, but the explicit `toEqual([...six ids...])` assertion needs the two new ids added)
- Modify: `src/chart/curated.ts` (reassign 2 of the 12 `GALLERY_STORIES` entries' `look` field)
- Test: `src/chart/curated.test.ts` — check whether it asserts specific `look` values per story slug; if so, update the two you change

**Interfaces:**
- Consumes: `FRAME_GRADIENT_PRESETS` (`chart-presentation.ts:458-465`) — the `dawn` and `sand` presets, both already contrast-gate-proven against `DEFAULT_PALETTE` per the existing comment at `chart-presentation.ts:455-457` ("dawn's and sand's dark ends were retuned so no preset refuses any DEFAULT_PALETTE colour... gated by a test"). Neither preset is used by any existing template (`ocean` is used by `social`; `presentation` uses a custom slate gradient, not a preset).
- Produces: two new `ChartTemplateId` values (`'warm'`, `'earth'`) that `CuratedChartDefinition.look` (in `src/chart/curated.ts`) and any other `ChartTemplateId`-typed field can now legally hold.

**Context:** ADR 043 requires (Decision 4) every template pass the contrast gate for every `DEFAULT_PALETTE` colour against its own backdrops, and (Decision 5) be genuinely distinct from every other template's override set (no exact tie). Setting `frameInset: 'small'` — the same choice `social` and `presentation` already make — routes the contrast check against the ordinary card colours (`frameBackdrops()`, `chart-presentation.ts:481-487`: `frameInset !== 'none'` → `[CARD_LIGHT, CARD_DARK]`), which `DEFAULT_PALETTE` already passes (every existing template proves this). This means the two new templates below do not need any special palette handling — they inherit the same safe path `social`/`presentation` use.

- [ ] **Step 1: Write the failing roster test**

In `web/lib/chart-templates.test.ts`, update the first test in the `CHART_TEMPLATES` describe block:
```ts
  it('lists the eight looks in order with their catalogue keys', () => {
    expect(CHART_TEMPLATES.map((t) => t.id)).toEqual([
      'standard', 'classic', 'newsroom', 'presentation', 'social', 'minimal', 'warm', 'earth',
    ]);
    for (const t of CHART_TEMPLATES) {
      expect(t.nameKey).toBe(`chart.template.${t.id}`);
      expect(t.descriptionKey).toBe(`chart.template.${t.id}Description`);
    }
  });
```
(Rename from "the six looks" to "the eight looks".)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run web/lib/chart-templates.test.ts` (or the repo's equivalent path from wherever `web/`'s vitest config resolves this file — check `web/package.json`'s test script). Expected: FAIL — `CHART_TEMPLATES` doesn't yet contain `'warm'`/`'earth'`.

- [ ] **Step 3: Add the two templates**

In `web/lib/chart-templates.ts`, extend the type at line 17:
```ts
export type ChartTemplateId = 'standard' | 'classic' | 'newsroom' | 'presentation' | 'social' | 'minimal' | 'warm' | 'earth';
```

Add two preset lookups right after the existing `ocean` lookup (line 28):
```ts
const dawn = FRAME_GRADIENT_PRESETS.find((p) => p.id === 'dawn')!;
const sand = FRAME_GRADIENT_PRESETS.find((p) => p.id === 'sand')!;
```

Append two entries to `CHART_TEMPLATES` (after `minimal`, before the closing `];` at line 87):
```ts
  // A warm, editorial gradient card — same inset-card reasoning as
  // presentation/social (the contrast gate holds by construction).
  template('warm', {
    lineWidth: 'normal',
    markers: 'ends',
    grid: 'horizontal',
    axisLines: 'hidden',
    valueLabels: 'shown',
    frameBackground: { kind: 'gradient', from: dawn.from, to: dawn.to },
    frameInset: 'small',
    framePadding: 'medium',
    frameCorners: 'rounded',
    frameShadow: 'soft',
  }),
  // A bold square card on the sand preset — thicker line, sparser markers,
  // no grid, for a poster-like single-glance read.
  template('earth', {
    lineWidth: 'thick',
    markers: 'provisionalOnly',
    grid: 'none',
    axisLines: 'hidden',
    valueLabels: 'shown',
    frameBackground: { kind: 'gradient', from: sand.from, to: sand.to },
    frameInset: 'small',
    framePadding: 'medium',
    frameCorners: 'veryRounded',
    frameShadow: 'strong',
    frameAspect: '1:1',
  }),
```

- [ ] **Step 4: Run the roster test to verify it passes**

Run: `npx vitest run web/lib/chart-templates.test.ts`. Expected: the roster test passes. The existing `for (const t of CHART_TEMPLATES)` loops (sanitizeOverrides byte-identity, contrast gate) automatically cover `warm`/`earth` too — run the FULL file (`npx vitest run web/lib/chart-templates.test.ts`, no `-t` filter) and confirm every test passes, including the contrast-gate one. If the contrast gate fails for either new template, that means the `frameInset: 'small'` reasoning above was wrong for that combination — stop and re-examine `frameBackdrops()` rather than picking arbitrary different colours to make it pass.

- [ ] **Step 5: Add the i18n keys**

In `web/lib/i18n/messages.ts`, in the Dutch (`nl`) block near the other `chart.template.*` keys (around line 528-544), add — matching the exact style of the surrounding entries (short, digit-free, one clause):
```ts
  'chart.template.warm': 'Warm',
  'chart.template.warmDescription': 'Een zachte kleurovergang, ideaal voor een redactioneel verhaal.',
  'chart.template.earth': 'Aards',
  'chart.template.earthDescription': 'Een stevige lijn op een zandkleurige kaart, vierkant formaat.',
```
In the English (`en`) block near the mirrored entries (around line 1177-1189), add:
```ts
  'chart.template.warm': 'Warm',
  'chart.template.warmDescription': 'A soft colour gradient, suited to an editorial story.',
  'chart.template.earth': 'Earth',
  'chart.template.earthDescription': 'A firm line on a sand-toned card, square format.',
```
Grep the file for any other place the template key list is enumerated (e.g. a validation array of all `MessageKey`s, or a completeness test) and add the four new keys there too if one exists.

- [ ] **Step 6: Run the full messages/i18n test suite**

Run whatever test covers `messages.ts` completeness (search for a test file importing it, e.g. `web/lib/i18n/messages.test.ts`) to confirm nl/en parity holds for the new keys.

- [ ] **Step 7: Reassign two gallery stories to the new looks**

In `src/chart/curated.ts`, in `GALLERY_STORIES`: change the `faillissementen` entry's `look: 'standard'` to `look: 'warm'`, and the `consumptie-huishoudens` entry's `look: 'classic'` to `look: 'earth'`. (These are picked because `standard` and `classic` are each already used twice elsewhere in the list, so the roster stays fully represented after the swap — do not remove the last remaining instance of any existing look.)

- [ ] **Step 8: Check and update the curated-chart test**

Read `src/chart/curated.test.ts`. If it asserts specific `look` values for `faillissementen` or `consumptie-huishoudens` by name, update those two assertions to `'warm'`/`'earth'`. If it only asserts structural things (e.g. "every story's canonical key resolves against the fixtures"), no change needed there — `look` doesn't affect data resolution.

- [ ] **Step 9: Run the full test suite for this area**

Run: `npx vitest run web/lib/chart-templates.test.ts web/lib/i18n src/chart/curated.test.ts` (adjust paths to match the repo's actual vitest project layout — check `vitest.config.ts`/`web/vitest.config.ts` if unsure which project each file belongs to). Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add web/lib/chart-templates.ts web/lib/chart-templates.test.ts web/lib/i18n/messages.ts src/chart/curated.ts
git commit -m "feat(chart): add Warm and Earth chart templates, surface them in the gallery

Two new curated looks (ADR 043's mechanism) using the dawn/sand frame-
gradient presets, neither used by an existing template. frameInset: 'small'
on both routes the contrast gate against the ordinary card colours, the same
safe path presentation/social already use — no new palette risk. Two of the
12 public gallery stories now use the new looks for visual variety.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Embed dialog live preview

**Files:**
- Modify: `web/components/chart.tsx` (extend `openPanel` state to include `'embed'`; wire `ChartEmbedButton` as a controlled trigger; wrap embed content in `ChartEditModal`)
- Modify: `web/components/chart-embed-dialog.tsx` (`ChartEmbedButton` becomes a controlled component; `ChartEmbedDialog`'s content moves from its own bare `Dialog`/`DialogContent` into `ChartEditModal`'s `children`)
- Test: `web/components/chart-embed-dialog.test.tsx`, `web/components/chart.test.tsx` — whichever assertions cover the embed dialog's open/close mechanics and DOM structure

**Interfaces:**
- Consumes: `ChartEditModal` (`web/components/chart-edit-modal.tsx`, already built — `{ open, onClose, title, chartSlot, children }`), and `canvasNode`/`legendNode` (already-lifted JSX values inside `ChartView`, `chart.tsx` — the exact same values already passed to the Style editor's `ChartEditModal` at line 2976-2982).
- Produces: `ChartEmbedButton` changes its prop signature from self-managing (`{ auditId, tableId, lang, currentForm }`, owns its own `open` boolean internally) to controlled (`{ auditId, tableId, lang, currentForm, open, onOpenChange }`) — any other caller of `ChartEmbedButton` in the codebase must be found and updated to the new signature (grep for `<ChartEmbedButton` before starting).

**Context:** Read `web/components/chart.tsx` lines 1416-1465 (the existing `openPanel`/`styleOpen`/`setStyleOpen` state and the cross-chart "closes this one's panel when another chart claims the shared style-panel slot" effect) and lines 2953-2990 (`ChartEditModal` wrapping `ChartConfigPanel`, `chartSlot={<>{canvasNode}{legendNode}{notesNode}</>}`) before writing any code — this is the EXACT pattern this task mirrors for `'embed'`. Read `web/components/chart-embed-dialog.tsx` in full (310 lines) — `ChartEmbedButton` (lines 80-117) currently owns its own `useState(false)` and conditionally mounts `ChartEmbedDialog`, which renders its own `<Dialog><DialogContent>` (lines 185-192) with the fieldset controls and generated `<pre>` code block as children. None of that internal fieldset/code-generation logic changes in this task — only the outer shell (which `open` state drives it, which component renders the modal chrome, and what appears in the modal's left pane) changes.

- [ ] **Step 1: Extend `openPanel`'s type and add the derived `embed` state**

In `web/components/chart.tsx`, at line 1420, change:
```ts
  const [openPanel, setOpenPanel] = useState<'style' | 'story' | null>(null);
```
to:
```ts
  const [openPanel, setOpenPanel] = useState<'style' | 'story' | 'embed' | null>(null);
```
Immediately after the existing `setStyleOpen` function (after line 1435), add a parallel, simpler setter for embed (embed has no Story-mode redirect to preserve, unlike Style):
```ts
  const embedOpen = openPanel === 'embed';
  const setEmbedOpen = (open: boolean): void => {
    setOpenPanel(open ? 'embed' : null);
  };
```

- [ ] **Step 2: Check the cross-chart "another chart claimed the panel" effect**

Read the effect at lines 1462-1465 (`if (stylePanelOwner === null || stylePanelOwner === domId) return; setOpenPanel((current) => (current === 'style' ? null : current));`). This only ever resets `'style'` to `null`, leaving `'embed'`/`'story'` untouched if either is the current value — confirm this is still correct (the embed dialog has no cross-chart shared-slot concept the way Style does per Task 6 of the chart-frame plan) and leave it unchanged unless your reading finds a reason it must also handle `'embed'`.

- [ ] **Step 3: Find and update the `ChartEmbedButton` call site**

At `web/components/chart.tsx:3253-3255`, change:
```tsx
        {embed && state.form !== 'table' && !(smallMultiples && smallMultiplesAvailable) && !embedMode && !inStage ? (
          <ChartEmbedButton auditId={embed.auditId} tableId={spec.attribution.tableId} lang={chartLang} currentForm={state.form} />
        ) : null}
```
to pass the lifted control state:
```tsx
        {embed && state.form !== 'table' && !(smallMultiples && smallMultiplesAvailable) && !embedMode && !inStage ? (
          <ChartEmbedButton
            auditId={embed.auditId}
            tableId={spec.attribution.tableId}
            lang={chartLang}
            currentForm={state.form}
            open={embedOpen}
            onOpenChange={setEmbedOpen}
            chartSlot={
              <>
                {canvasNode}
                {legendNode}
              </>
            }
          />
        ) : null}
```
(No `notesNode` here — the embed preview does not need click-to-annotate; it is a read-only preview of what will be embedded, mirroring why the Story stage also excludes notes.)

- [ ] **Step 4: Search for any other caller of `ChartEmbedButton`**

Run: `grep -rn "ChartEmbedButton" web/ src/` from the repo root. If any file other than `chart.tsx` and `chart-embed-dialog.tsx` itself imports or renders it, update that call site to the new controlled signature too (Step 5 defines the exact new props). If none exists, proceed.

- [ ] **Step 5: Make `ChartEmbedButton` a controlled component**

In `web/components/chart-embed-dialog.tsx`, change the `ChartEmbedButton` signature (lines 80-117) from owning `useState(false)` to accepting `open`/`onOpenChange` and a new `chartSlot` prop, and pass `chartSlot` through to `ChartEmbedDialog`:
```tsx
export function ChartEmbedButton({
  auditId,
  tableId,
  lang,
  currentForm = null,
  open,
  onOpenChange,
  chartSlot,
}: {
  auditId: number;
  tableId: string;
  lang: Lang;
  currentForm?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The live chart canvas + legend, lifted from chart.tsx — rendered inside
   * the embed modal's left pane, mirroring the Style editor's chartSlot. */
  chartSlot: ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Button ref={triggerRef} type="button" variant="ghost" size="sm" onClick={() => onOpenChange(true)}>
        {t(lang, 'chart.embed.trigger')}
      </Button>
      {open ? (
        <ChartEmbedDialog
          auditId={auditId}
          tableId={tableId}
          lang={lang}
          currentForm={currentForm}
          chartSlot={chartSlot}
          onClose={() => {
            onOpenChange(false);
            triggerRef.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}
```
Add `type ReactNode` to the existing `import { useEffect, useId, useRef, useState } from 'react';` line (change to `import { useEffect, useId, useRef, useState, type ReactNode } from 'react';`).

- [ ] **Step 6: Swap `ChartEmbedDialog`'s shell from a bare `Dialog` to `ChartEditModal`**

Add the import: `import { ChartEditModal } from './chart-edit-modal.tsx';` (remove the now-unused `Dialog, DialogContent, DialogDescription, DialogTitle` import from `./ui/dialog.tsx` if `DialogDescription` is no longer used anywhere else in this file — check first).

Change `ChartEmbedDialog`'s signature to accept `chartSlot: ReactNode` (added to its existing props). Replace the outer return (lines 185-192, the `<Dialog open onOpenChange={...}><DialogContent aria-modal="true" className="sm:max-w-md"><DialogTitle>...</DialogTitle><DialogDescription>...</DialogDescription>` opening) with `ChartEditModal`:
```tsx
  return (
    <ChartEditModal
      open
      onClose={onClose}
      title={t(lang, 'chart.embed.dialogTitle')}
      chartSlot={chartSlot}
    >
      <p className="text-sm text-muted-foreground">{t(lang, 'chart.embed.dialogExplain')}</p>
      {/* everything from the old `{result === 'loading' ? ...}` line through
          the old closing `</>` stays exactly as it was — only the outer
          Dialog/DialogContent/DialogTitle/DialogDescription wrapper above it
          is replaced. Close with `</ChartEditModal>` instead of the old
          `</DialogContent></Dialog>`. */}
      ...
    </ChartEditModal>
  );
```
Concretely: keep every line from the current `{result === 'loading' ? ...}` (line 196) through the final `</>` (before line 306's closing) completely unchanged in content — only the two structural wrapper lines at the very top (`<Dialog...><DialogContent...>` → `<ChartEditModal...>`) and very bottom (`</DialogContent></Dialog>` → `</ChartEditModal>`) change, and the stray top-level `<DialogTitle>`/`<DialogDescription>` lines (193-194) move — the title becomes `ChartEditModal`'s `title` prop (as shown above) and the description paragraph becomes a plain `<p>` as its first child (also shown above).

- [ ] **Step 7: Update the failing/affected tests**

Run: `npx vitest run web/components/chart-embed-dialog.test.tsx web/components/chart.test.tsx` (or the repo's equivalent invocation). Fix every assertion that:
- Rendered `ChartEmbedButton` directly with the old uncontrolled props — update to pass `open`/`onOpenChange`/`chartSlot` (a simple `<>{null}</>` or a small stub `<div>preview</div>` is a fine `chartSlot` value for a unit test that isn't testing the preview content itself).
- Queried for the old `role="dialog"` structure assuming `DialogTitle`/`DialogDescription` — `ChartEditModal` still renders a `DialogTitle` (see `chart-edit-modal.tsx:78`) with the same accessible-name contract, but there is no longer a separate `DialogDescription` element — a test asserting that specific role/element needs updating to check for the plain paragraph text instead.
- Do NOT change any assertion about the fieldset controls, code generation, copy button, or Pro-gating logic — none of that changed.

- [ ] **Step 8: Real-browser check**

Since this touches modal-open mechanics and a jsdom test cannot see actual layout (per this repo's own established lesson from the Story-stage and chart-frame work — see `docs/lessons-learned.md`), start the dev server and manually open a chart's Embed dialog in a real browser: confirm the chart renders live in the left pane, the controls still work (colour/type/live toggle/copy), Escape and backdrop-click still close it, and the layout doesn't overflow on a narrow (375px) viewport. Fix anything broken before proceeding.

- [ ] **Step 9: Run the full verification block**

`npm run typecheck` (root and `web/`), the full `web/` Vitest suite (not just the two files above — this touches shared `chart.tsx` state), a real `next build` in `web/`. All must be clean before committing.

- [ ] **Step 10: Commit**

```bash
git add web/components/chart.tsx web/components/chart-embed-dialog.tsx web/components/chart-embed-dialog.test.tsx web/components/chart.test.tsx
git commit -m "feat(chart): live chart preview in the embed dialog

The embed dialog generated an iframe code blob with no way to see what it
would actually look like (open-questions #243, flagged as a natural
follow-up when the Style editor got the same split-pane ChartEditModal
treatment this session). Reuses that exact pattern: chart.tsx's openPanel
state gains an 'embed' value alongside 'style'/'story', ChartEmbedButton
becomes a controlled component, and ChartEmbedDialog's content now renders
inside ChartEditModal with the chart's own live canvas+legend in the left
pane. No change to the embed code generation, fields, or Pro-gating logic.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final steps (after all three tasks)

- [ ] Full whole-branch review (per subagent-driven-development's own process) on the most capable available model.
- [ ] Full verification block one more time on the final state: typecheck ×2, full test suite, real build, LOW-effort `/code-review` over the whole diff (per CLAUDE.md's verification block requirement before any code push).
- [ ] Update `docs/STATUS.md` top block, `docs/open-questions.md` (#243, #237(d) — the embed-preview follow-up is now built), and append an as-built note somewhere findable (ADR 039's addendum already covers `ChartEditModal`'s introduction — a short further addendum there is more appropriate than a new ADR, since this is applying the exact same already-decided pattern a second time, plus a default-value change and a template-roster addition, none of which are new load-bearing decisions).
- [ ] This is NOT money-path/R3 work — push directly to `main` once green, per CLAUDE.md's owner-present git workflow. No PR required.
