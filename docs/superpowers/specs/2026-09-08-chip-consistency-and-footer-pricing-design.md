# Chip styling consistency + footer pricing line

Design spec for a small batch of UI feedback given live by the owner while looking at the running app, 2026-09-08 (same session as [2026-09-08-chat-interaction-polish-design.md](2026-09-08-chat-interaction-polish-design.md), a separate/independent piece of work). Pure client-side UI, no answer-pipeline/billing/CBS-data code touched, no ADR needed for the chip fixes — the footer relocation introduces one small piece of shared client state (see below), still UI-only.

## Scope

1. **Remove "Soon"** — the `<Badge>Soon</Badge>` on the disabled "Connect database" chip (`web/components/chat.tsx:1092`).
2. **Chip styling consistency** — "Add link" (`CHIP_ACTION`) currently reads differently from an *unselected* source/Internet chip (`CHIP_OFF`, dimmer `text-muted-foreground`). Switch "Add link" to `CHIP_OFF`'s baseline look so all three (CBS-data chips, Internet, Add link) read the same by default.
3. **Clearer selected-vs-not** — add a checkmark icon to the selected (`CHIP_ON`) chip style, so "this source is active" doesn't rely on a subtle background/text-color shift alone.
4. **Move the pre-send pricing line to the site's global footer** — owner-confirmed: appended after the existing attribution text, in the real `<footer>` (`web/components/site-footer.tsx`), not just restyled in place.

## 1–3: Chip fixes

Straightforward edits in `chat.tsx`:
- Delete the `<Badge>Soon</Badge>` (and, if nothing else references the now-unused `Badge` import in that file, remove the import too — check first, `Badge` may be used elsewhere in the file).
- `CHIP_ACTION` constant: change "Add link"'s className from `CHIP_ACTION` to `CHIP_OFF`. Leave "Upload file" (enabled variant) as `CHIP_ACTION` — it's a genuinely different kind of control (a real action button, not a toggle), not part of the owner's complaint (which named CBSDATA/Internet/AddLink specifically).
- `CHIP_ON` constant/usage: add a small checkmark icon (`lucide-react`'s `Check`, already a dependency) before the existing icon+label in both the source chips and the Internet chip's selected render path — conditionally rendered only when `active`/`webSelected` is true.

## 4: Footer pricing line

**The real constraint:** `SiteFooter` is mounted in `app/layout.tsx` as a *sibling* of `{children}` (the page content), not a descendant of `Workspace`/`Chat` — there is no prop-drilling path from Chat's local pricing state down into it. This needs a small piece of shared client state bridging the two.

**Design:** a new React Context, `PricingHintContext` (`web/lib/pricing-hint-context.tsx`):

```ts
interface PricingHintValue {
  pricingHint: string | null;
  setPricingHint: (hint: string | null) => void;
}
```

- `PricingHintProvider` wraps `{children}` and `<SiteFooter />` together in `app/layout.tsx` (inside `<ThemeProvider>`).
- `Chat` computes the exact same three pricing-text variants it renders today (`chat.tsx:1140-1150`) — same conditions, same numbers — but instead of rendering a `<p>` inline, calls `setPricingHint(text)` in an effect whenever the computed text changes, and `setPricingHint(null)` on unmount or whenever the `pricing` prop is absent (replicating today's `{pricing ? ... : null}` guard exactly — trial mode, which never passes `pricing`, is untouched and keeps its own "X free questions left" messaging).
- `SiteFooter` reads `pricingHint` via a `usePricingHint()` hook and appends it (` · ${pricingHint}`) right after the existing attribution/"Over dit project" segment, only when non-null.
- The context's default value (used by any component rendered without a `PricingHintProvider` ancestor — every existing test) is `{ pricingHint: null, setPricingHint: () => {} }` — a no-op setter. This is what keeps every existing byte-pinned footer test (in `workspace.test.tsx`) unaffected without touching them: those tests never wrap their render calls in the new provider, so `Chat`'s calls to `setPricingHint` there hit the no-op default and `SiteFooter`'s `pricingHint` reads stay `null`, exactly like today.

**Existing tests that DO need updating** (in `web/components/chat.test.tsx`) — these currently assert the pricing text appears *inside Chat's own rendered DOM*, which will no longer be true once the text moves to the footer:
- `describe('Chat — WP20 cost transparency (#82)')` → `'shows the pre-send cost line with live prices and balance'`
- `describe('Chat — WP129+130 cost-line variants (⟨W4⟩)')` → all 3: `'shows the base line when Internet is off'`, `'CBS + internet: ...'`, `'web-only: ...'`

Each needs converting from `render(<Chat pricing={pricing} />)` + `screen.getByText(exact or partial pricing string)` to wrapping in `<PricingHintProvider><Chat pricing={pricing} /><SiteFooter /></PricingHintProvider>` and asserting against the footer's `textContent` (a substring check, since the pricing hint is now one segment of a longer footer line, not its own text node). `next/navigation`'s `usePathname` needs a light mock added to `chat.test.tsx` for `SiteFooter` to render at all (it isn't mocked there today).

Two adjacent tests do **not** need changes: `'repeats the reply price at the clarification message itself'` (a different, per-message cost annotation inline in the transcript, untouched by this work) and `'renders none of the cost surfaces without the pricing prop'` (already only asserts *absence*, still true either way).

## Testing

- Chip fixes: extend the existing chip-related tests in `chat.test.tsx` (WP129+130 source-chips block) with an assertion that a selected chip's accessible content includes the checkmark, and that "Add link"'s class matches the unselected-chip baseline.
- Footer wiring: a new small test file for `pricing-hint-context.tsx` (provider + hook, in isolation) plus the 4 converted `chat.test.tsx` tests above.
- Full definition of done per `CLAUDE.md`: both typechecks, full web suite, `next build` clean, `/code-review` LOW clean, real browser check (both chip states, the footer's new segment, light/dark) before done.

## Docs impact

None beyond this spec — no ADR (small UI-only change, matches the sidebar-collapse/#213 precedent for "no invariant or architecture decision at stake"), no open-questions row (this wasn't a previously-tracked friction point, just live owner feedback acted on directly).
