# Chat Interaction Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add loading-skeleton feedback in the three spots the chat UI currently gives none (or weak) feedback, and make the right-hand chart panel drag-to-resize with a remembered width.

**Architecture:** Two independent, additive client-side features on top of the existing `Workspace`/`Chat`/`VisualDock` components (`web/components/`). No answer-pipeline, billing, or CBS-data code is touched. Skeletons use shadcn's stock `Skeleton` primitive; the resizable panel uses shadcn's stock `Resizable` primitive, which wraps `react-resizable-panels`.

**Tech Stack:** Next.js 16 (App Router), React 19, Vitest + `@testing-library/react` + jsdom, Tailwind v4, shadcn (`base-nova` style, `cn` package for class merging), `react-resizable-panels@^4.12.4` (new dependency).

## Global Constraints

- No answer-pipeline (`src/answer/`), billing (`src/billing/`), or CBS-data code changes — this is UI-only. No invariant (R1–R11) is at risk; no ADR needed.
- Keep the existing busy-text line in `chat.tsx` verbatim — it carries an owner-mandated honesty distinction (CBS vs. web vs. both) from the WP129+130 go-live (2026-07-12). Skeletons are additive, never a replacement for it.
- The chart-panel skeleton must show ONLY when the dock is already open from an earlier turn (`showDock` already true) — never on a brand-new question where we don't yet know a chart is coming.
- `react-resizable-panels`'s `useDefaultLayout` hook defaults its `storage` param to a bare `localStorage` reference, which is unsafe during Next.js server-side rendering of this `'use client'` component (`typeof window === 'undefined'` there). ALWAYS pass an explicit SSR-safe `storage` value — never call `useDefaultLayout` without one.
- Match existing repo conventions exactly: tests co-located as `<file>.test.tsx`/`.test.ts` next to source; `cn` imported from the `"cn"` package (not a relative path) inside `components/ui/*`; shadcn primitives carry no dedicated test file (matches `badge.tsx`, `button.tsx`, etc. today).
- Full definition of done (run at the end, Task 7): both typechecks, full web test suite, `next build` clean, `/code-review` LOW clean, and a real browser verification pass — no UI change ships on test-suite evidence alone (per `CLAUDE.md`).

---

## Task 1: `getPanelStorage` — an SSR-safe storage helper

**Files:**
- Create: `web/lib/panel-storage.ts`
- Test: `web/lib/panel-storage.test.ts`

**Interfaces:**
- Produces: `getPanelStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void }` — a tiny pure function. Task 6 imports it and passes its result as `useDefaultLayout`'s `storage` option.

This is pulled out as its own isolated, pure function specifically so the SSR-unsafe-default risk (see Global Constraints) can be unit-tested directly, without needing to stand up a fully-rendered dock.

- [ ] **Step 1: Write the failing tests**

```ts
// web/lib/panel-storage.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPanelStorage } from './panel-storage.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getPanelStorage', () => {
  it('returns the real localStorage when it is available (the normal browser/jsdom case)', () => {
    expect(getPanelStorage()).toBe(localStorage);
  });

  it('falls back to a no-op storage when localStorage is unavailable (the SSR case)', () => {
    // Simulates Next.js server-rendering this 'use client' component: no
    // bare `localStorage` global exists in that Node environment. Using
    // `vi.stubGlobal` (rather than deleting a jsdom-provided property)
    // rebinds the global cleanly and is restored by `vi.unstubAllGlobals`.
    vi.stubGlobal('localStorage', undefined);
    const storage = getPanelStorage();
    expect(() => storage.getItem('x')).not.toThrow();
    expect(storage.getItem('x')).toBeNull();
    expect(() => storage.setItem('x', 'y')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/panel-storage.test.ts`
Expected: FAIL — `Cannot find module './panel-storage.ts'` (or similar), since the file doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// web/lib/panel-storage.ts
// react-resizable-panels' `useDefaultLayout` hook defaults its `storage`
// option to a bare `localStorage` reference (evaluated as a default
// parameter). That reference does not exist in the Node environment Next.js
// uses to server-render a 'use client' component's initial HTML, so calling
// the hook without an explicit `storage` would crash there — a crash jsdom
// tests can't catch, since jsdom always provides a global `localStorage`.
// This helper is the one place that guard lives.
export function getPanelStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  if (typeof localStorage === 'undefined') {
    return { getItem: () => null, setItem: () => {} };
  }
  return localStorage;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/panel-storage.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/panel-storage.ts web/lib/panel-storage.test.ts
git commit -m "feat: add an SSR-safe storage helper for the resizable panel

react-resizable-panels' useDefaultLayout hook defaults to a bare
localStorage reference that crashes during Next.js SSR of a 'use
client' component. Pulled into its own tiny function so the guard is
unit-testable directly.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Skeleton primitive + `AnswerSkeleton`/`ChartSkeleton`

**Files:**
- Create: `web/components/ui/skeleton.tsx` (shadcn stock primitive — no test file, matches `badge.tsx`/`button.tsx` convention)
- Create: `web/components/loading-skeletons.tsx`
- Test: `web/components/loading-skeletons.test.tsx`

**Interfaces:**
- Produces: `AnswerSkeleton(): JSX.Element` (a few pulsing text-shaped lines), `ChartSkeleton(): JSX.Element` (a pulsing chart-shaped block). Task 3 uses `AnswerSkeleton` in `chat.tsx` and `workspace.tsx`; Task 4 uses `ChartSkeleton` in `visual-dock.tsx`.

- [ ] **Step 1: Add the shadcn Skeleton primitive**

Create `web/components/ui/skeleton.tsx` with this exact content (captured from this project's own `shadcn@4.21.0` registry — `base-nova` style, `cn` import convention, verified to match `web/components/ui/button.tsx`'s and `card.tsx`'s conventions):

```tsx
import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
```

- [ ] **Step 2: Write the failing tests for `AnswerSkeleton`/`ChartSkeleton`**

```tsx
// web/components/loading-skeletons.test.tsx
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AnswerSkeleton, ChartSkeleton } from './loading-skeletons.tsx';

afterEach(cleanup);

describe('AnswerSkeleton', () => {
  it('renders a few pulsing placeholder lines, hidden from assistive tech', () => {
    const { container } = render(<AnswerSkeleton />);
    const root = container.firstElementChild!;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(3);
  });
});

describe('ChartSkeleton', () => {
  it('renders a pulsing chart-shaped placeholder, hidden from assistive tech', () => {
    const { container } = render(<ChartSkeleton />);
    const root = container.firstElementChild!;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && npx vitest run components/loading-skeletons.test.tsx`
Expected: FAIL — `Cannot find module './loading-skeletons.tsx'`

- [ ] **Step 4: Write the implementation**

```tsx
// web/components/loading-skeletons.tsx
// Placeholder-only content for the three "something is loading" spots
// (chat answer, chart panel, thread switch) — never real data, so every
// root is aria-hidden: a screen reader should hear nothing new until real
// content lands, not a pulsing block with no information.
import { Skeleton } from './ui/skeleton.tsx';

export function AnswerSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <Skeleton className="h-3.5 w-3/4" />
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-2/3" />
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3" aria-hidden="true">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-full min-h-40 w-full" />
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run components/loading-skeletons.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add web/components/ui/skeleton.tsx web/components/loading-skeletons.tsx web/components/loading-skeletons.test.tsx
git commit -m "feat: add shadcn Skeleton primitive + AnswerSkeleton/ChartSkeleton

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Chat answer skeleton

**Files:**
- Modify: `web/components/chat.tsx:942-953` (the busy block)
- Test: `web/components/chat.test.tsx` (add one test near the existing busy-text tests, ~line 1055-1090)

**Interfaces:**
- Consumes: `AnswerSkeleton` from `./loading-skeletons.tsx` (Task 2).

- [ ] **Step 1: Write the failing test**

Add this test in `web/components/chat.test.tsx`, right after the existing `'the busy indicator names only het web...'` test (~line 1069-1088), inside the same `describe` block:

```tsx
  it('shows a pulsing answer skeleton alongside the busy text, gone once the answer resolves', async () => {
    actions.askQuestion.mockImplementation(() => new Promise(() => {})); // never resolves — stays busy
    renderChat();
    fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: 'Hoeveel inwoners?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    await screen.findByText('Bezig met het doorzoeken van CBS-cijfers…');
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
```

(If `renderChat()` isn't the exact existing render helper name in this file, use whatever helper the three existing busy-text tests above it already call — match it exactly, do not invent a new one.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run components/chat.test.tsx -t "pulsing answer skeleton"`
Expected: FAIL — zero elements match `[data-slot="skeleton"]`

- [ ] **Step 3: Wire in `AnswerSkeleton`**

In `web/components/chat.tsx`, add the import near the other local imports (top of file, alongside the other `./`-relative imports):

```tsx
import { AnswerSkeleton } from './loading-skeletons.tsx';
```

Then change the busy block (currently ~line 942-953) from:

```tsx
        {busy ? (
          <div className="text-left text-sm text-muted-foreground">
            {/* WP129+130 go-live feedback (owner, 2026-07-12): with the Internet
              * chip on, the wait covers the web search too — say so honestly.
              * Web-only (CBS deselected) names only the web. */}
            {websearch && webSelected && selectedSources.size > 0
              ? 'Bezig met het doorzoeken van CBS-cijfers en het web…'
              : websearch && webSelected
                ? 'Bezig met het doorzoeken van het web…'
                : 'Bezig met het doorzoeken van CBS-cijfers…'}
          </div>
        ) : null}
```

to:

```tsx
        {busy ? (
          <>
            <div className="text-left text-sm text-muted-foreground">
              {/* WP129+130 go-live feedback (owner, 2026-07-12): with the Internet
                * chip on, the wait covers the web search too — say so honestly.
                * Web-only (CBS deselected) names only the web. Session 88:
                * an AnswerSkeleton was ADDED below, this text was NOT removed
                * — it carries a distinction the skeleton can't. */}
              {websearch && webSelected && selectedSources.size > 0
                ? 'Bezig met het doorzoeken van CBS-cijfers en het web…'
                : websearch && webSelected
                  ? 'Bezig met het doorzoeken van het web…'
                  : 'Bezig met het doorzoeken van CBS-cijfers…'}
            </div>
            <AnswerSkeleton />
          </>
        ) : null}
```

- [ ] **Step 4: Run the full chat test file to verify the new test passes and nothing else broke**

Run: `cd web && npx vitest run components/chat.test.tsx`
Expected: PASS — every test in the file, including the 3 pre-existing busy-text tests (their text assertions are untouched) and the new skeleton test.

- [ ] **Step 5: Commit**

```bash
git add web/components/chat.tsx web/components/chat.test.tsx
git commit -m "feat: add a loading skeleton to the chat answer busy state

Kept the existing busy text verbatim (it carries the CBS/web
honesty distinction from the WP129+130 go-live) -- the skeleton is
additive.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Chart panel skeleton

**Files:**
- Modify: `web/components/visual-dock.tsx`
- Modify: `web/components/visual-dock.test.tsx` (add `busy={false}` to all 7 existing render calls; add new tests)

**Interfaces:**
- Consumes: `ChartSkeleton` from `./loading-skeletons.tsx` (Task 2).
- Produces: `VisualDock` gains a new **required** prop `busy: boolean` — required (not optional) so every call site, including `workspace.tsx` in Task 6, is forced by TypeScript to supply it; a forgotten wire-up fails the typecheck rather than silently rendering real charts during busy.

- [ ] **Step 1: Update existing render calls to keep them compiling**

In `web/components/visual-dock.test.tsx`, add `busy={false}` to all 7 existing `<VisualDock .../>` render/rerender calls (lines 71, 76, 91, 98, 108, 116, 118). Example for line 71:

```tsx
    const { container } = render(<VisualDock visuals={[]} activeVisualId={null} onSelect={vi.fn()} busy={false} />);
```

Apply the same `busy={false}` addition to the other 6 call sites (lines 76, 91, 98, 108, 116, 118), each keeping its other props unchanged.

- [ ] **Step 2: Write the failing tests for the busy state**

Add this new `describe` block at the end of `web/components/visual-dock.test.tsx`:

```tsx
describe('VisualDock — busy skeleton (chat interaction polish, session 88)', () => {
  it('shows a chart skeleton instead of the active visual while busy', () => {
    render(<VisualDock visuals={[chartVisual()]} activeVisualId="visual-0" onSelect={vi.fn()} busy={true} />);
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(screen.queryByRole('img', { hidden: true })).toBeNull();
  });

  it('keeps the tabs visible and clickable while busy', () => {
    const onSelect = vi.fn();
    const visuals = [chartVisual({ id: 'visual-0', label: 'Grafiek 1' }), chartVisual({ id: 'visual-1', label: 'Grafiek 2' })];
    render(<VisualDock visuals={visuals} activeVisualId="visual-1" onSelect={onSelect} busy={true} />);
    fireEvent.click(screen.getByRole('tab', { name: /Grafiek 1/ }));
    expect(onSelect).toHaveBeenCalledWith('visual-0');
  });

  it('shows the real chart again once busy clears', () => {
    const { rerender } = render(<VisualDock visuals={[chartVisual()]} activeVisualId="visual-0" onSelect={vi.fn()} busy={true} />);
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    rerender(<VisualDock visuals={[chartVisual()]} activeVisualId="visual-0" onSelect={vi.fn()} busy={false} />);
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && npx vitest run components/visual-dock.test.tsx`
Expected: FAIL — TypeScript/prop error or missing-`busy`-prop test failures (the `busy` prop doesn't exist on `VisualDock` yet).

- [ ] **Step 4: Add the `busy` prop to `VisualDock`**

In `web/components/visual-dock.tsx`, add `busy` to the props type and destructuring:

```tsx
export function VisualDock({
  visuals,
  activeVisualId,
  onSelect,
  busy,
}: {
  visuals: DockVisual[];
  activeVisualId: string | null;
  onSelect: (visualId: string) => void;
  busy: boolean;
}) {
```

Add the import at the top:

```tsx
import { ChartSkeleton } from './loading-skeletons.tsx';
```

Change the content block (currently):

```tsx
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
        {active.kind === 'chart' && active.chart !== null ? (
          <ChartView spec={active.chart} frameless />
        ) : active.kind === 'userChart' && active.userChart !== null ? (
          <UserChartView spec={active.userChart} />
        ) : active.card !== null ? (
          <StatCard data={active.card} />
        ) : null}
      </div>
```

to:

```tsx
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
        {busy ? (
          <ChartSkeleton />
        ) : active.kind === 'chart' && active.chart !== null ? (
          <ChartView spec={active.chart} frameless />
        ) : active.kind === 'userChart' && active.userChart !== null ? (
          <UserChartView spec={active.userChart} />
        ) : active.card !== null ? (
          <StatCard data={active.card} />
        ) : null}
      </div>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run components/visual-dock.test.tsx`
Expected: PASS — all existing + 3 new tests.

- [ ] **Step 6: Commit**

```bash
git add web/components/visual-dock.tsx web/components/visual-dock.test.tsx
git commit -m "feat: show a chart skeleton in the visual dock while busy

busy is a required prop deliberately -- forgetting to wire it at a
call site is now a typecheck failure, not a silent bug.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Thread-switch skeleton

**Files:**
- Modify: `web/components/workspace.tsx` (the `selectThread` function, ~line 150-178, and the chat `<section>`, ~line 296-361)
- Modify: `web/components/workspace.test.tsx` (add one new test)

**Interfaces:**
- Consumes: `AnswerSkeleton` from `./loading-skeletons.tsx` (Task 2).
- Produces: a new internal `threadLoading` state in `Workspace` — no external interface change.

- [ ] **Step 1: Write the failing test**

Add this test to `web/components/workspace.test.tsx`, inside the `describe('Workspace — selecting a thread ...')`-ish block near the existing `selectThread` tests (~line 190):

```tsx
  it('shows a skeleton message list while a clicked thread is loading, then the real messages', async () => {
    let resolveLoad!: (value: LoadedThread) => void;
    actions.loadMyThread.mockImplementation(
      () => new Promise<LoadedThread>((resolve) => { resolveLoad = resolve; }),
    );
    renderWorkspace(MIXED_THREADS);
    fireEvent.click(screen.getByRole('button', { name: 'Inflatie 2024' }));
    await waitFor(() => {
      expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    });
    resolveLoad({ kind: 'cbs', threadId: 1, messages: [], context: null });
    await screen.findByPlaceholderText('Stel een vraag…');
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBe(0);
  });
```

Add `waitFor` to the existing `@testing-library/react` import at the top of the file if it isn't already imported (check the current import line — `import { cleanup, fireEvent, render, screen } from '@testing-library/react';` — extend it to include `waitFor`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run components/workspace.test.tsx -t "skeleton message list"`
Expected: FAIL — no `[data-slot="skeleton"]` element ever appears (times out in `waitFor`).

- [ ] **Step 3: Add `threadLoading` state and gate `selectThread`**

In `web/components/workspace.tsx`, add the import:

```tsx
import { AnswerSkeleton } from './loading-skeletons.tsx';
```

Add a new state near the other `useState` calls (~line 88, after `chatBusy`):

```tsx
  // #211 (chat interaction polish, session 88): true only for the span of a
  // clicked-thread load — false the rest of the time, including for the
  // "Nieuwe chat" reset (startNewChat sets no async work in flight).
  const [threadLoading, setThreadLoading] = useState(false);
```

Change `selectThread` (currently lines ~150-178) from:

```tsx
  const selectThread = useCallback(
    async (threadId: number) => {
      const loaded = await loadMyThread(threadId);
      if (loaded.kind === 'empty') {
        void refreshThreads();
        return;
      }
      setActiveThreadId(loaded.threadId);
      setHandoff(
        loaded.kind === 'dataset'
          ? {
              kind: 'dataset',
              threadId: loaded.threadId,
              datasetId: loaded.datasetId,
              displayName: loaded.displayName,
              status: loaded.status,
              profile: loaded.profile,
              messages: loaded.messages,
              rawState: loaded.rawState,
            }
          : { kind: 'cbs', messages: loaded.messages, context: loaded.context, threadId: loaded.threadId },
      );
      setVisuals([]);
      setActiveVisualId(null);
      prevVisualCount.current = 0;
      setLoadNonce((nonce) => nonce + 1);
    },
    [refreshThreads],
  );
```

to:

```tsx
  const selectThread = useCallback(
    async (threadId: number) => {
      setThreadLoading(true);
      try {
        const loaded = await loadMyThread(threadId);
        if (loaded.kind === 'empty') {
          void refreshThreads();
          return;
        }
        setActiveThreadId(loaded.threadId);
        setHandoff(
          loaded.kind === 'dataset'
            ? {
                kind: 'dataset',
                threadId: loaded.threadId,
                datasetId: loaded.datasetId,
                displayName: loaded.displayName,
                status: loaded.status,
                profile: loaded.profile,
                messages: loaded.messages,
                rawState: loaded.rawState,
              }
            : { kind: 'cbs', messages: loaded.messages, context: loaded.context, threadId: loaded.threadId },
        );
        setVisuals([]);
        setActiveVisualId(null);
        prevVisualCount.current = 0;
        setLoadNonce((nonce) => nonce + 1);
      } finally {
        setThreadLoading(false);
      }
    },
    [refreshThreads],
  );
```

- [ ] **Step 4: Render the skeleton in place of Chat/DatasetChat while loading**

In the chat `<section>` JSX (~line 307), change:

```tsx
          {handoff.kind === 'dataset' ? (
```

to be gated on `threadLoading` first:

```tsx
          {threadLoading ? (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
              <AnswerSkeleton />
              <div className="ml-auto w-2/3">
                <AnswerSkeleton />
              </div>
            </div>
          ) : handoff.kind === 'dataset' ? (
```

(The existing `) : (` / final `)}` closing the ternary chain does not need to change — you're adding one more branch in front of the existing `handoff.kind === 'dataset' ? ... : ...` chain, which stays exactly as it is.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && npx vitest run components/workspace.test.tsx`
Expected: PASS — the new test plus every pre-existing test in the file (the `threadLoading` branch is `false` by default and only becomes `true` during the awaited call, so no other test's synchronous assertions are affected).

- [ ] **Step 6: Commit**

```bash
git add web/components/workspace.tsx web/components/workspace.test.tsx
git commit -m "feat: show a skeleton message list while a thread is loading

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Resizable chart panel

**Files:**
- Modify: `web/package.json` (new dependency: `react-resizable-panels`)
- Create: `web/components/ui/resizable.tsx` (shadcn stock primitive — no test file)
- Modify: `web/components/workspace.tsx` (layout restructuring, ~line 283-368)
- Modify: `web/components/workspace.test.tsx` (one new test)

**Interfaces:**
- Consumes: `getPanelStorage` from `../lib/panel-storage.ts` (Task 1); `VisualDock`'s `busy` prop (Task 4) is now finally wired from `chatBusy`.

- [ ] **Step 1: Install the dependency**

Run:

```bash
cd web && npm install react-resizable-panels@^4.12.4
```

Expected: `web/package.json`'s `dependencies` gains `"react-resizable-panels": "^4.12.4"`; `web/package-lock.json` updates accordingly. No other dependency changes.

- [ ] **Step 2: Add the shadcn Resizable primitive**

Create `web/components/ui/resizable.tsx` with this exact content (captured from this project's own `shadcn@4.21.0` registry against the installed `react-resizable-panels@4.12.4` — note this version's API is `Group`/`Panel`/`Separator`, NOT the older `PanelGroup`/`PanelResizeHandle` naming some older docs/training data describe):

```tsx
"use client"

import { cn } from "cn"
import * as ResizablePrimitive from "react-resizable-panels"

function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn(
        "flex h-full w-full aria-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px items-center justify-center bg-border ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />
      )}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
```

- [ ] **Step 3: Write the failing test**

Add this test to `web/components/workspace.test.tsx` (a top-level `describe`, anywhere after the existing ones):

```tsx
describe('Workspace — resizable chart panel (session 88)', () => {
  it('never mounts the resizable panel group when the dock is not shown (no visuals yet)', () => {
    renderWorkspace();
    expect(document.querySelector('[data-slot="resizable-panel-group"]')).toBeNull();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd web && npx vitest run components/workspace.test.tsx -t "never mounts the resizable panel group"`
Expected: FAIL — this specific assertion actually passes trivially today (there's no such element at all yet), so instead confirm the test file still fails to even import/compile once Step 5 references `ResizablePanelGroup`/`useDefaultLayout` before they're wired — run the FULL file: `cd web && npx vitest run components/workspace.test.tsx` and expect a TypeScript/runtime error until Step 5 is complete, since `workspace.tsx` won't yet use these new imports consistently. Treat this step as "confirm nothing is silently broken before the real change," then proceed.

- [ ] **Step 5: Restructure the layout**

In `web/components/workspace.tsx`, add these imports:

```tsx
import { useDefaultLayout } from 'react-resizable-panels';
import { getPanelStorage } from '../lib/panel-storage.ts';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable.tsx';
```

Add the layout-persistence hook near the other hooks at the top of the component body (after `isNarrow`'s `useEffect`, ~line 107):

```tsx
  // #211 (chat interaction polish, session 88): remembers the dock's width
  // across visits. `getPanelStorage()` is REQUIRED here — the hook's own
  // default `storage` value is unsafe during server rendering (see
  // web/lib/panel-storage.ts).
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'dock-panel-width',
    storage: getPanelStorage(),
  });
```

Then restructure the render. Extract the chat `<section>` (currently ~line 296-361) into a local `const chatSection = (...)` built once per render, changing its className from `flex min-h-0 min-w-0 flex-1 flex-col ...` to `flex h-full min-h-0 min-w-0 flex-col ...` (drop `flex-1`, add `h-full` — inside a `ResizablePanel` the panel itself controls width, so the section only needs to fill the panel's height; the no-dock branch below supplies the horizontal grow instead):

```tsx
  const chatSection = (
    <section
      aria-label="Chat"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground"
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <h1 className="truncate text-[13.5px] font-medium" title={cardTitle}>
          {cardTitle}
        </h1>
        <div className="flex-1" />
        <ThemeToggle />
      </div>
      {threadLoading ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <AnswerSkeleton />
          <div className="ml-auto w-2/3">
            <AnswerSkeleton />
          </div>
        </div>
      ) : handoff.kind === 'dataset' ? (
        <DatasetChat
          key={handoff.threadId}
          datasetId={handoff.datasetId}
          threadId={handoff.threadId}
          displayName={handoff.displayName}
          initialStatus={handoff.status}
          initialProfile={handoff.profile}
          initialMessages={handoff.messages}
          initialRawState={handoff.rawState}
          onThreadId={handleThreadId}
          onBusyChange={setChatBusy}
          dockMode={isWide}
          onVisualsChange={handleVisualsChange}
          activeVisualId={activeVisualId}
          onActivateVisual={activateVisual}
        />
      ) : (
        <Chat
          onOutcome={handleOutcome}
          pricing={{
            simple: simplePrice,
            clarification: clarificationPrice,
            balance,
            ...(websearch ? { websearch } : {}),
          }}
          {...(attachments ? { attachments: { enabled: true, onUploadFile: handleUploadFile } } : {})}
          dockMode={isWide}
          initialMessages={handoff.messages}
          initialContext={handoff.context}
          threadId={handoff.threadId}
          loadNonce={loadNonce}
          onThreadId={handleThreadId}
          onVisualsChange={handleVisualsChange}
          activeVisualId={activeVisualId}
          onActivateVisual={activateVisual}
          onBusyChange={setChatBusy}
        />
      )}
    </section>
  );
```

Then replace the row's chat-`<section>` + dock-`<div>` pair (currently the two blocks right after the sidebar `<div>`, ~line 296-367) with:

```tsx
        {showDock ? (
          <ResizablePanelGroup
            orientation="horizontal"
            defaultLayout={defaultLayout}
            onLayoutChanged={onLayoutChanged}
            className="min-h-0 flex-1"
          >
            <ResizablePanel id="chat-panel" minSize="55">
              {chatSection}
            </ResizablePanel>
            <ResizableHandle withHandle className="mx-1" />
            <ResizablePanel id="dock-panel" defaultSize="33" minSize="18" maxSize="40">
              <VisualDock busy={chatBusy} visuals={visuals} activeVisualId={activeVisualId} onSelect={activateVisual} />
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="min-h-0 min-w-0 flex-1">{chatSection}</div>
        )}
```

(This is the ONLY place `VisualDock` is mounted now — remove the old standalone `{showDock ? <div className="w-96 shrink-0">...</div> : null}` block entirely, it's replaced by the above.)

- [ ] **Step 6: Run the full workspace test suite to verify everything passes**

Run: `cd web && npx vitest run components/workspace.test.tsx`
Expected: PASS — every pre-existing test (none of them exercise `showDock === true`, per the file's default `matchMedia` mock, so they're unaffected by the new branch) plus the new "never mounts... when dock is not shown" test.

- [ ] **Step 7: Run the ENTIRE web suite to catch any cross-file regression**

Run: `cd web && npm test`
Expected: PASS — full suite green (this is the first point where `chat.tsx`'s `dockMode` prop or any other consumer touching the removed inline dock `<div>` would surface a break, if there is one).

- [ ] **Step 8: Commit**

```bash
git add web/package.json web/package-lock.json web/components/ui/resizable.tsx web/components/workspace.tsx web/components/workspace.test.tsx
git commit -m "feat: make the chart panel drag-to-resize, width remembered

Uses shadcn's Resizable primitive (react-resizable-panels). Passes an
explicit SSR-safe storage to useDefaultLayout -- its own default is a
bare localStorage reference that crashes during server rendering.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Full verification block

No new code — this task is the mandatory checklist from `CLAUDE.md`'s definition of done, run once at the end of the coding tasks.

- [ ] **Step 1: Typecheck both**

Run: `cd web && npm run typecheck`
Expected: PASS, 0 errors. (This is the step that would catch a forgotten `busy` prop at a `VisualDock` call site, or a wrong `react-resizable-panels` import name.)

- [ ] **Step 2: Full web test suite**

Run: `cd web && npm test`
Expected: PASS — full suite green, count should be the pre-session-88 701 plus the new tests added in Tasks 1-6 (`panel-storage.test.ts`: 2, `loading-skeletons.test.tsx`: 2, `chat.test.tsx`: +1, `visual-dock.test.tsx`: +3, `workspace.test.tsx`: +2).

- [ ] **Step 3: Production build**

Run: `cd web && npm run build`
Expected: PASS, clean build, no warnings about the new dependency or components.

- [ ] **Step 4: `/code-review` LOW**

Run the `/code-review` slash command (LOW effort) over the diff. Fix or consciously dispatch every confirmed finding before proceeding — per `CLAUDE.md`, this is mandatory before any code push, not optional.

- [ ] **Step 5: Commit any fixes from code review**

Only if Step 4 produced changes:

```bash
git add -A
git commit -m "fix: address /code-review LOW findings on the chat interaction polish diff

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Real browser verification

Per `CLAUDE.md`: "no UI change ships on test-suite evidence alone." jsdom tests cannot prove the SSR-safety fix works in a real server render, nor can they prove the drag interaction or persistence actually feel right.

- [ ] **Step 1: Start the dev server preview**

Use the Browser pane's `preview_start` (with the project's dev-server launch config) to open the app in a real browser tab, signed in.

- [ ] **Step 2: Verify the chat answer skeleton**

Ask a question. Confirm both the existing busy text AND the new pulsing skeleton lines are visible while the answer is generating, and both disappear once the real answer renders.

- [ ] **Step 3: Verify the chart panel skeleton**

Ask a question that produces a chart (so the dock opens). Ask a follow-up question. Confirm the chart area shows a pulsing skeleton while the follow-up is processing, then the (possibly new) chart appears. Confirm that on a BRAND NEW chat (no dock open yet), asking the first question shows no chart skeleton at all until an answer with a chart actually resolves.

- [ ] **Step 4: Verify the thread-switch skeleton**

With at least two threads in the sidebar, click a different thread. Confirm a skeleton message list appears briefly, then the real messages.

- [ ] **Step 5: Verify the resizable panel**

Drag the handle between the chat and the chart panel. Confirm: it resizes smoothly; it won't shrink the chat panel or the dock panel past their configured limits; the little grip handle is visible and has a hover/focus state.

- [ ] **Step 6: Verify persistence**

After dragging to a new width, reload the page. Confirm the dock reopens at the width you left it (not the default 33%).

- [ ] **Step 7: Verify light and dark mode**

Toggle the theme switch. Confirm the skeleton pulses and the resize handle are visually correct (adequate contrast, no jarring color) in both themes.

- [ ] **Step 8: Take a screenshot for the record**

Use the Browser pane's screenshot tool to capture at least one state (e.g., the resize handle mid-drag, or a skeleton in view) as evidence for the session's own verification record.

---

## Task 9: Docs update

**Files:**
- Modify: `docs/open-questions.md` row #211
- Modify: `docs/STATUS.md` (top block)

- [ ] **Step 1: Update open-questions.md row #211**

Read the current row #211 in `docs/open-questions.md`, and append a new "Decided + built (session 88)" note in its resolution column: this concrete increment (3 loading skeletons + the resizable/persisted-width chart panel) was brainstormed with the owner and built; link to `docs/superpowers/specs/2026-09-08-chat-interaction-polish-design.md`. Explicitly restate, in the same edit, that the real-streaming question this row originally raised is STILL NOT decided, and that the other friction points (clarification-chip legibility, fill-don't-send follow-up chips, attachment-row affordance states) remain open — this increment did not touch them.

- [ ] **Step 2: Update STATUS.md's top block**

Add a line to the "current state" section noting: chat interaction polish (loading skeletons + resizable chart panel) shipped session 88, with the measured test count and a one-line pointer to open-questions #211 for what's still open in that sub-project.

- [ ] **Step 3: Commit**

```bash
git add docs/open-questions.md docs/STATUS.md
git commit -m "docs: chat interaction polish shipped -- update #211 and STATUS

Streaming and the other #211 friction points remain explicitly
undecided/open -- this increment only covers loading feedback + the
resizable chart panel.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push**

```bash
git push
```

Per `CLAUDE.md`'s standing owner-present-session authorization (#118 revision), push directly — no per-change approval needed. Watch the resulting CI run to completion before considering this plan done.
