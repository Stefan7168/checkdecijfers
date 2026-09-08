# Chip Consistency + Footer Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "Soon" badge, make the "Add link"/CBS-data/Internet chips read consistently, make the selected-chip state visually obvious, and move the pre-send pricing line from inside the chat card into the site's global footer.

**Architecture:** Three small, independent edits inside `web/components/chat.tsx` (chip styling), plus one new shared-state mechanism (`PricingHintContext`) bridging `Chat` (deep inside `Workspace`) to `SiteFooter` (a sibling in the root layout, with no other path to reach it).

**Tech Stack:** Next.js 16 App Router, React 19 Context, Vitest + `@testing-library/react`, `lucide-react` (already a dependency, adding the `Check` icon).

## Global Constraints

- No answer-pipeline/billing/CBS-data code touched. No ADR needed — same class of change as `#213`'s sidebar fix.
- The "Upload file" chip (`CHIP_SOON` in its disabled variant, `CHIP_ACTION` when enabled) is explicitly OUT of scope — the owner named CBSDATA/Internet/AddLink specifically; don't touch it.
- `PricingHintContext`'s default value (used by anything rendered without a `PricingHintProvider` ancestor) MUST have a no-op `setPricingHint` — this is what keeps every existing byte-pinned footer test in `workspace.test.tsx` passing unmodified. Do not "fix" this by wrapping those tests in the provider; leaving them exactly as they are IS the correct behavior.
- Full definition of done (Task 4): both typechecks, full web suite, `next build` clean, `/code-review` LOW clean, real browser check.

---

## Task 1: Chip styling — remove "Soon", unify "Add link", add a selected checkmark

**Files:**
- Modify: `web/components/chat.tsx` (imports ~line 15 & 51, constants ~line 63-67, JSX ~line 1004-1094)
- Modify: `web/components/chat.test.tsx` (extend the existing WP129+130 source-chips tests)

**Interfaces:** None external — self-contained styling change.

- [ ] **Step 1: Write the failing tests**

Find the existing `describe('Chat — WP129+130 source chips (#129)')` block in `web/components/chat.test.tsx` (it contains `'toggles the chips (aria-pressed) on click'`). Add these two tests right after it, in the same `describe` block:

```tsx
  it('a selected chip shows a checkmark; an unselected one does not', () => {
    render(<Chat pricing={{ simple: 20, clarification: 10, balance: 100 }} websearch={{ enabled: true, addonPrice: 10 }} />);
    const cbsChip = screen.getByRole('button', { name: /CBS data/ });
    expect(cbsChip.querySelector('svg.lucide-check')).not.toBeNull();
    const internetChip = screen.getByRole('button', { name: 'Internet' });
    expect(internetChip.querySelector('svg.lucide-check')).toBeNull();
    fireEvent.click(internetChip);
    expect(internetChip.querySelector('svg.lucide-check')).not.toBeNull();
  });

  it('"Add link" reads the same as an unselected source chip, not the always-on action style', () => {
    render(<Chat pricing={{ simple: 20, clarification: 10, balance: 100 }} websearch={{ enabled: true, addonPrice: 10 }} />);
    const addLink = screen.getByRole('button', { name: 'Add link' });
    const internetChip = screen.getByRole('button', { name: 'Internet' }); // starts unselected (CHIP_OFF)
    expect(addLink.className).toBe(internetChip.className);
  });
```

Also add this test to `describe('Chat — attachment entry points (#201/#202, session 83 scoping; ADR 037 D10)')`, right after the existing `'renders upload/data-source buttons as disabled...'` test:

```tsx
  it('"Connect database" no longer shows a "Soon" badge (owner feedback, session 88)', () => {
    render(<Chat />);
    const button = screen.getByRole('button', { name: 'Connect database' });
    expect(within(button).queryByText('Soon')).toBeNull();
  });
```

(`within` is already imported at the top of this file — confirmed at the existing `import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';` line.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run components/chat.test.tsx -t "checkmark|reads the same|Soon.*badge"`
Expected: FAIL — no checkmark exists yet, "Add link" and "Internet" (unselected) have different classNames, and (this one may already trivially pass or fail depending on jsdom's text-matching — verify it fails for the RIGHT reason, i.e. `Soon` is still literally present today).

- [ ] **Step 3: Implement the chip changes**

In `web/components/chat.tsx`, update the icon import (line 15) to add `Check`:

```tsx
import { Check, Database, Globe, Link2, Paperclip, Plug } from 'lucide-react';
```

Change the "Add link" button's className (currently ~line 1048, `className={CHIP_ACTION}`) to:

```tsx
          className={CHIP_OFF}
```

Add the checkmark to both toggle chips. The CBS-data map (~line 1006-1017) changes from:

```tsx
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => toggleSource(key)}
                className={active ? CHIP_ON : CHIP_OFF}
              >
                <Database aria-hidden="true" className="size-3.5" />
                {`${SOURCES[key]!.displayName} data`}
              </button>
```

to:

```tsx
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => toggleSource(key)}
                className={active ? CHIP_ON : CHIP_OFF}
              >
                {active ? <Check aria-hidden="true" className="size-3.5" /> : <Database aria-hidden="true" className="size-3.5" />}
                {`${SOURCES[key]!.displayName} data`}
              </button>
```

The Internet chip (~line 1019-1027) changes the same way, from:

```tsx
          <button
            type="button"
            aria-pressed={webSelected}
            onClick={() => setWebSelected((v) => !v)}
            className={webSelected ? CHIP_ON : CHIP_OFF}
          >
            <Globe aria-hidden="true" className="size-3.5" />
            Internet
          </button>
```

to:

```tsx
          <button
            type="button"
            aria-pressed={webSelected}
            onClick={() => setWebSelected((v) => !v)}
            className={webSelected ? CHIP_ON : CHIP_OFF}
          >
            {webSelected ? <Check aria-hidden="true" className="size-3.5" /> : <Globe aria-hidden="true" className="size-3.5" />}
            Internet
          </button>
```

Remove the `<Badge>` around "Soon" entirely (~line 1090-1094), from:

```tsx
          <Plug aria-hidden="true" className="size-3.5" />
          Connect database
          <Badge aria-hidden="true" variant="outline" className="h-4 px-1 text-[10px] leading-none">
            Soon
          </Badge>
        </button>
```

to:

```tsx
          <Plug aria-hidden="true" className="size-3.5" />
          Connect database
        </button>
```

Remove the now-unused `Badge` import (line 51): delete `import { Badge } from './ui/badge.tsx';` entirely — confirm first with `grep -n "Badge" web/components/chat.tsx` that no other usage remains (the only other `Badge`-named import, `SourceBadge`, is a different component and stays).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run components/chat.test.tsx`
Expected: PASS — the 3 new tests, and every pre-existing test in the file (none of them assert the CBS-data/Internet chips' exact icon SVG or the "Add link" button's exact className — checked in Task 1's investigation; only accessible names and `aria-pressed`, both unchanged).

- [ ] **Step 5: Commit**

```bash
git add web/components/chat.tsx web/components/chat.test.tsx
git commit -m "feat: chip styling consistency + remove the Soon badge

Add link now reads like an unselected source chip instead of its own
always-on style; selected chips show a checkmark instead of relying
on a subtle background/text-color shift alone.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `PricingHintContext`

**Files:**
- Create: `web/lib/pricing-hint-context.tsx`
- Test: `web/lib/pricing-hint-context.test.tsx`

**Interfaces:**
- Produces: `PricingHintProvider({ children }): JSX.Element`, `usePricingHint(): { pricingHint: string | null; setPricingHint: (hint: string | null) => void }`. Task 3 (`Chat`) calls `setPricingHint`; Task 4 (`SiteFooter`) reads `pricingHint`. Also produces the exported `PricingHintContext` object itself, in case a future consumer needs direct access (not expected here, but matches React's own convention of exporting the context alongside its hook).

- [ ] **Step 1: Write the failing tests**

```tsx
// web/lib/pricing-hint-context.test.tsx
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PricingHintProvider, usePricingHint } from './pricing-hint-context.tsx';

afterEach(cleanup);

function Consumer() {
  const { pricingHint, setPricingHint } = usePricingHint();
  return (
    <div>
      <span data-testid="hint">{pricingHint ?? '(none)'}</span>
      <button type="button" onClick={() => setPricingHint('Een vraag kost ~20 credits')}>set</button>
      <button type="button" onClick={() => setPricingHint(null)}>clear</button>
    </div>
  );
}

describe('PricingHintContext', () => {
  it('starts null and updates when setPricingHint is called, inside a provider', () => {
    render(
      <PricingHintProvider>
        <Consumer />
      </PricingHintProvider>,
    );
    expect(screen.getByTestId('hint').textContent).toBe('(none)');
    act(() => screen.getByRole('button', { name: 'set' }).click());
    expect(screen.getByTestId('hint').textContent).toBe('Een vraag kost ~20 credits');
    act(() => screen.getByRole('button', { name: 'clear' }).click());
    expect(screen.getByTestId('hint').textContent).toBe('(none)');
  });

  it('a consumer outside any provider gets the no-op default (null, setter does nothing)', () => {
    render(<Consumer />);
    expect(screen.getByTestId('hint').textContent).toBe('(none)');
    act(() => screen.getByRole('button', { name: 'set' }).click());
    // No provider above this Consumer, so the default no-op setter is what
    // runs -- the value stays null. This is the exact behavior every
    // existing byte-pinned footer test in workspace.test.tsx relies on.
    expect(screen.getByTestId('hint').textContent).toBe('(none)');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run lib/pricing-hint-context.test.tsx`
Expected: FAIL — `Cannot find module './pricing-hint-context.tsx'`

- [ ] **Step 3: Write the implementation**

```tsx
// web/lib/pricing-hint-context.tsx
// #211 chat interaction polish, session 88: SiteFooter (mounted in
// app/layout.tsx as a SIBLING of the page content, never a descendant of
// Workspace/Chat) has no prop-drilling path to a live, per-chat value like
// the pre-send pricing line. This context bridges the two. The default
// value's setter is a DELIBERATE no-op: any component rendered without a
// PricingHintProvider ancestor (every existing test that doesn't opt in)
// gets pricingHint: null and a setter that does nothing -- which is exactly
// today's "no pricing line" behavior, unchanged.
'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

interface PricingHintValue {
  pricingHint: string | null;
  setPricingHint: (hint: string | null) => void;
}

export const PricingHintContext = createContext<PricingHintValue>({
  pricingHint: null,
  setPricingHint: () => {},
});

export function usePricingHint(): PricingHintValue {
  return useContext(PricingHintContext);
}

export function PricingHintProvider({ children }: { children: ReactNode }) {
  const [pricingHint, setPricingHint] = useState<string | null>(null);
  return (
    <PricingHintContext.Provider value={{ pricingHint, setPricingHint }}>
      {children}
    </PricingHintContext.Provider>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run lib/pricing-hint-context.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add web/lib/pricing-hint-context.tsx web/lib/pricing-hint-context.test.tsx
git commit -m "feat: add PricingHintContext bridging Chat to the global footer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Wire `Chat` to set the pricing hint instead of rendering it inline

**Files:**
- Modify: `web/components/chat.tsx` (imports, the pricing block ~line 1140-1150)
- Modify: `web/components/chat.test.tsx` (convert the 4 tests identified below; add `next/navigation` mock)

**Interfaces:**
- Consumes: `usePricingHint` from `../lib/pricing-hint-context.tsx` (Task 2).

- [ ] **Step 1: Add the `next/navigation` mock**

`web/components/chat.test.tsx` doesn't mock `next/navigation` today (only `workspace.test.tsx` does) — `SiteFooter` needs `usePathname`. Add this near the top of the file, after the existing imports (before the `vi.hoisted` block):

```tsx
vi.mock('next/navigation', () => ({ usePathname: () => '/chat' }));
```

(`/chat` rather than `/` deliberately — it keeps `SiteFooter`'s "Over dit project" anchor-probe branch inert in these tests, matching the real logged-in chat route, which isn't `/`.)

Add the two new imports needed for Steps 2 & 4:

```tsx
import { PricingHintProvider } from '../lib/pricing-hint-context.tsx';
import { SiteFooter } from './site-footer.tsx';
```

(Use whichever extension convention the file's other same-directory imports already use — check `chat.tsx`'s own import of `./ui/badge.tsx` etc. for the `.tsx` suffix convention before finalizing these two lines.)

- [ ] **Step 2: Convert the 4 existing tests to check the footer**

In `describe('Chat — WP20 cost transparency (#82)')`, change:

```tsx
  it('shows the pre-send cost line with live prices and balance', () => {
    render(<Chat pricing={pricing} />);
    expect(
      screen.getByText(
        'Een vraag kost ~20 credits · saldo: 100 credits. Stel ik eerst een verduidelijkingsvraag, dan kost die 10 credits en krijg je de rest terug.',
      ),
    ).toBeInTheDocument();
  });
```

to:

```tsx
  it('shows the pre-send cost line with live prices and balance, in the footer', () => {
    render(
      <PricingHintProvider>
        <Chat pricing={pricing} />
        <SiteFooter />
      </PricingHintProvider>,
    );
    expect(document.querySelector('footer')!.textContent).toContain(
      'Een vraag kost ~20 credits · saldo: 100 credits. Stel ik eerst een verduidelijkingsvraag, dan kost die 10 credits en krijg je de rest terug.',
    );
  });
```

In `describe('Chat — WP129+130 cost-line variants (⟨W4⟩)')`, apply the same wrap-and-check-the-footer conversion to all 3 tests:

```tsx
  it('shows the base line when Internet is off', () => {
    render(
      <PricingHintProvider>
        <Chat pricing={pricing} />
        <SiteFooter />
      </PricingHintProvider>,
    );
    expect(document.querySelector('footer')!.textContent).toMatch(/Een vraag kost ~20 credits · saldo: 100 credits/);
  });

  it('CBS + internet: "~30 credits (waarvan 10 voor internet)"', () => {
    render(
      <PricingHintProvider>
        <Chat pricing={pricing} />
        <SiteFooter />
      </PricingHintProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Internet' }));
    expect(document.querySelector('footer')!.textContent).toMatch(/~30 credits \(waarvan 10 voor internet\)/);
  });

  it('web-only: "~10 credits (er wordt tijdelijk 30 gereserveerd)"', () => {
    render(
      <PricingHintProvider>
        <Chat pricing={pricing} />
        <SiteFooter />
      </PricingHintProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Internet' })); // web on
    fireEvent.click(screen.getByRole('button', { name: 'CBS data' })); // cbs off
    expect(document.querySelector('footer')!.textContent).toMatch(/~10 credits \(er wordt tijdelijk 30 gereserveerd\)/);
  });
```

Leave `'repeats the reply price at the clarification message itself'` and `'renders none of the cost surfaces without the pricing prop'` (both in the WP20 block) UNCHANGED — the first tests a different, still-inline per-message cost annotation; the second only asserts absence, which remains true either way.

- [ ] **Step 2b: Run to verify these now-converted tests fail**

Run: `cd web && npx vitest run components/chat.test.tsx -t "footer|base line when Internet is off|CBS \\+ internet|web-only"`
Expected: FAIL — `Chat` doesn't call `setPricingHint` yet, so the footer never shows the text.

- [ ] **Step 3: Wire `Chat` to the context**

Add the import near `chat.tsx`'s other local imports:

```tsx
import { usePricingHint } from '../lib/pricing-hint-context.tsx';
```

Inside the `Chat` component function, call the hook once near the top (alongside the other hooks):

```tsx
  const { setPricingHint } = usePricingHint();
```

Replace the existing pricing block (currently ~line 1140-1150):

```tsx
      {pricing ? (
        <p className="text-xs text-muted-foreground">
          {websearch && webSelected && selectedSources.size > 0
            ? `Een vraag kost ~${pricing.simple + websearch.addonPrice} credits (waarvan ${websearch.addonPrice} voor internet) · saldo: ${pricing.balance} credits. ` +
              `Stel ik eerst een verduidelijkingsvraag, dan kost die ${pricing.clarification} credits en krijg je de rest terug.`
            : websearch && webSelected
              ? `Een vraag kost ~${websearch.addonPrice} credits (er wordt tijdelijk ${pricing.simple + websearch.addonPrice} gereserveerd) · saldo: ${pricing.balance} credits.`
              : `Een vraag kost ~${pricing.simple} credits · saldo: ${pricing.balance} credits. ` +
                `Stel ik eerst een verduidelijkingsvraag, dan kost die ${pricing.clarification} credits en krijg je de rest terug.`}
        </p>
      ) : null}
```

with an effect that feeds the context instead of rendering inline (place it directly above the `return (` of the component, alongside this file's other `useEffect` calls — do NOT leave a `<p>` element behind, this block now renders nothing):

```tsx
  // #211 chat interaction polish, session 88: this used to render its own
  // <p> here. It now feeds the SAME three text variants into the global
  // footer instead (SiteFooter, via PricingHintContext) -- the owner asked
  // for the pricing line to live in the footer, not just be restyled here.
  useEffect(() => {
    if (!pricing) {
      setPricingHint(null);
      return;
    }
    const hint =
      websearch && webSelected && selectedSources.size > 0
        ? `Een vraag kost ~${pricing.simple + websearch.addonPrice} credits (waarvan ${websearch.addonPrice} voor internet) · saldo: ${pricing.balance} credits. ` +
          `Stel ik eerst een verduidelijkingsvraag, dan kost die ${pricing.clarification} credits en krijg je de rest terug.`
        : websearch && webSelected
          ? `Een vraag kost ~${websearch.addonPrice} credits (er wordt tijdelijk ${pricing.simple + websearch.addonPrice} gereserveerd) · saldo: ${pricing.balance} credits.`
          : `Een vraag kost ~${pricing.simple} credits · saldo: ${pricing.balance} credits. ` +
            `Stel ik eerst een verduidelijkingsvraag, dan kost die ${pricing.clarification} credits en krijg je de rest terug.`;
    setPricingHint(hint);
    return () => setPricingHint(null);
  }, [pricing, websearch, webSelected, selectedSources, setPricingHint]);
```

Delete the old inline `{pricing ? (<p>...</p>) : null}` block entirely (it's now fully replaced by the effect above).

`useEffect` is already imported in this file (used elsewhere) — confirm via `grep -n "^import.*useEffect" web/components/chat.tsx` and don't add a duplicate import if so.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run components/chat.test.tsx`
Expected: PASS — the 4 converted tests plus every other test in the file (nothing else in this file asserted the OLD inline `<p>`'s presence in a way that would now fail, per Task 3's own upfront investigation — but if something unexpected turns up, fix it here, don't skip it).

- [ ] **Step 5: Commit**

```bash
git add web/components/chat.tsx web/components/chat.test.tsx
git commit -m "feat: Chat feeds the pricing hint to the footer via context

The pre-send pricing line no longer renders inside the chat card --
it's set into PricingHintContext, which SiteFooter (Task 4) reads.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `SiteFooter` renders the pricing hint; wire the provider into the root layout

**Files:**
- Modify: `web/components/site-footer.tsx`
- Modify: `web/app/layout.tsx`
- Modify: `web/components/workspace.test.tsx` (no test content changes expected, but re-run to confirm — see Step 3)

**Interfaces:**
- Consumes: `usePricingHint` from `../lib/pricing-hint-context.tsx` (Task 2).

- [ ] **Step 1: Write the failing test**

Add a new test file `web/components/site-footer.test.tsx` (this file doesn't exist yet — the existing footer tests live inside `workspace.test.tsx` and stay there unchanged, per the Global Constraints note):

```tsx
// web/components/site-footer.test.tsx
import { cleanup, render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PricingHintProvider, usePricingHint } from '../lib/pricing-hint-context.tsx';
import { FOOTER_ATTRIBUTION, SiteFooter } from './site-footer.tsx';

vi.mock('next/navigation', () => ({ usePathname: () => '/chat' }));

afterEach(cleanup);

function SetHint({ hint }: { hint: string }) {
  const { setPricingHint } = usePricingHint();
  act(() => setPricingHint(hint));
  return null;
}

describe('SiteFooter — pricing hint (session 88)', () => {
  it('appends the pricing hint after the attribution when one is set', () => {
    render(
      <PricingHintProvider>
        <SetHint hint="Een vraag kost ~20 credits · saldo: 100 credits." />
        <SiteFooter />
      </PricingHintProvider>,
    );
    const footer = document.querySelector('footer')!;
    expect(footer.textContent).toBe(`${FOOTER_ATTRIBUTION} · Een vraag kost ~20 credits · saldo: 100 credits.`);
  });

  it('shows only the plain attribution when no hint is set', () => {
    render(
      <PricingHintProvider>
        <SiteFooter />
      </PricingHintProvider>,
    );
    expect(document.querySelector('footer')!.textContent).toBe(FOOTER_ATTRIBUTION);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run components/site-footer.test.tsx`
Expected: FAIL — the footer's `textContent` doesn't include the pricing hint yet (`SiteFooter` doesn't read the context at all).

- [ ] **Step 3: Wire `SiteFooter`**

In `web/components/site-footer.tsx`, add the import:

```tsx
import { usePricingHint } from '../lib/pricing-hint-context.tsx';
```

Inside `SiteFooter`, call the hook and append the hint. Change:

```tsx
export function SiteFooter() {
  const pathname = usePathname();
  const showAbout = useAboutTargetPresent(pathname);
  return (
    <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
      <span>
        {showAbout ? FOOTER_PREFIX : FOOTER_ATTRIBUTION}
        {showAbout ? (
          <a href={`#${ABOUT_ANCHOR_ID}`} className="underline underline-offset-2 hover:text-foreground">
            {FOOTER_ABOUT_LABEL}
          </a>
        ) : null}
      </span>
```

to:

```tsx
export function SiteFooter() {
  const pathname = usePathname();
  const showAbout = useAboutTargetPresent(pathname);
  const { pricingHint } = usePricingHint();
  return (
    <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
      <span>
        {showAbout ? FOOTER_PREFIX : FOOTER_ATTRIBUTION}
        {showAbout ? (
          <a href={`#${ABOUT_ANCHOR_ID}`} className="underline underline-offset-2 hover:text-foreground">
            {FOOTER_ABOUT_LABEL}
          </a>
        ) : null}
        {pricingHint ? ` · ${pricingHint}` : null}
      </span>
```

(The rest of the function — the gear-icon `<Link>` — is unchanged.)

- [ ] **Step 4: Wire `PricingHintProvider` into the root layout**

In `web/app/layout.tsx`, add the import:

```tsx
import { PricingHintProvider } from "../lib/pricing-hint-context.tsx";
```

Change the body from:

```tsx
      <body className="flex h-dvh flex-col">
        <ThemeProvider>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
          <SiteFooter />
        </ThemeProvider>
      </body>
```

to:

```tsx
      <body className="flex h-dvh flex-col">
        <ThemeProvider>
          <PricingHintProvider>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
            <SiteFooter />
          </PricingHintProvider>
        </ThemeProvider>
      </body>
```

- [ ] **Step 5: Run the new test file, then the full suite**

Run: `cd web && npx vitest run components/site-footer.test.tsx`
Expected: PASS (2 tests)

Run: `cd web && npm test`
Expected: PASS — full suite, including `workspace.test.tsx`'s byte-pinned footer tests UNCHANGED (they render `<Workspace>`/`<Landing>` + `<SiteFooter>` directly, without a `PricingHintProvider` wrapper, so `pricingHint` there is the context's default `null` — see Global Constraints).

- [ ] **Step 6: Commit**

```bash
git add web/components/site-footer.tsx web/app/layout.tsx web/components/site-footer.test.tsx
git commit -m "feat: SiteFooter shows the live pricing hint after the attribution

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Full verification block

- [ ] **Step 1: Typecheck**

Run: `cd web && npm run typecheck`
Expected: PASS, 0 errors.

- [ ] **Step 2: Full web test suite**

Run: `cd web && npm test`
Expected: PASS — full suite green.

- [ ] **Step 3: Production build**

Run: `cd web && npm run build`
Expected: PASS, clean build.

- [ ] **Step 4: `/code-review` LOW**

Run the `/code-review` slash command (LOW effort) over the diff. Fix or consciously dispatch every confirmed finding before proceeding.

- [ ] **Step 5: Commit any fixes**

Only if Step 4 produced changes:

```bash
git add -A
git commit -m "fix: address /code-review LOW findings on the chip/footer diff

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Real browser verification

- [ ] **Step 1: Start the dev server preview and sign in**

Use the Browser pane's `preview_start`.

- [ ] **Step 2: Verify the "Soon" badge is gone**

Look at the "Connect database" chip. Confirm no "Soon" text/badge is visible, and its disabled tooltip still shows on hover (title attribute unchanged).

- [ ] **Step 3: Verify chip consistency and the checkmark**

Confirm "Add link", an unselected CBS-data chip, and the unselected Internet chip all look the same (same border/background/text color). Select a source chip and confirm a checkmark replaces its icon; deselect and confirm it reverts.

- [ ] **Step 4: Verify the footer pricing line**

On the logged-in chat screen, confirm the pricing line ("Een vraag kost ~X credits...") now appears in the site's bottom footer bar, after the attribution text — not inside the chat card anymore. Toggle the Internet chip and a source chip off/on; confirm the footer text updates to match the correct variant (base / CBS+internet / web-only). Navigate to a page with no active chat (e.g. `/systeemoverzicht`) and confirm the footer shows the plain attribution only, no stale pricing hint left over.

- [ ] **Step 5: Verify light and dark mode**

Toggle the theme switch. Confirm the checkmark icon and footer text are legible in both themes.

- [ ] **Step 6: Screenshot for the record**

Capture at least one state (the footer with a pricing hint visible, and the chip row with a selected checkmark) as evidence.

---

## Task 7: Push

- [ ] **Step 1: Push**

```bash
git push
```

Per `CLAUDE.md`'s standing owner-present-session authorization (#118 revision). Watch the resulting CI run to completion before considering this plan done.
