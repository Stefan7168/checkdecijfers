# Session 68 — close-out (2026-08-28 into 2026-08-31, local +07, owner present)

**What happened, in one line:** built `/systeemoverzicht`, a public architecture reference page, on
direct owner request — not a queued work package, and not part of session 67's already-closed queue.

## What was asked

The owner asked in-chat, across three separate follow-up requests in the same conversation:
1. (2026-08-28) "Can you create a page that explains the architecture of this project? Probably need
   some diagrams here and there, as per my other project [GlaiBaan's `/en/system-map`], which should be
   reachable via a gear icon in the footer as well."
2. (2026-08-30) "On that page, only add a language toggle and add English. Start with English. Dutch
   comes second."
3. (2026-08-31) "Remove the last (double) footer, and then wrap up per docs."

## What was built

**Commit `0fbd37a` — the page.** `web/app/systeemoverzicht/page.tsx` + `web/components/
system-map-diagram.tsx`. Content mined from `docs/04-architecture.md`'s System shape diagram, RUNBOOK's
external-services checklist, and the trial-pot/onboarding source directly: the big-picture system
diagram (hand-drawn inline SVG, `stat-card.tsx`-style rect/text/line + an arrowhead marker, huisstijl CSS
vars), an 8-step "journey of one question," an allowed/never AI-scope list, every external service with
cost/status, a scheduled-automations table, and a "built, off" list for the dormant WP26/#162 flags. A
hand-drawn gear icon (no icon library exists in this codebase) added to `SiteFooter`, linking to the new
route.

**Two real issues found and fixed before this push:**
- The route wasn't in `web/proxy.ts`'s `PUBLIC_EXACT_PATHS` allowlist — caught by actually navigating to
  the page in a local dev server (it redirected to `/login`), not by reading the code. Fixed as an
  exact-match entry, pinned in `proxy.test.ts` with both a positive and two `startsWith`-would-have-
  wrongly-matched negative cases.
- The pre-push LOW code-review caught `StatusLegend` hand-duplicating the exact class strings and labels
  `StatusPill` (defined a few lines below) already encoded for the same three states. Refactored to a
  shared `StatusKind`/`STATUS_STYLES`/`STATUS_LABELS` trio; `StatusLegend` now renders `StatusPill`.

**Commit `d328213` — the EN/NL toggle, English default.** Required splitting the page: `metadata` can
only be exported from a Server Component, and the toggle needs `useState`, so `page.tsx` stayed a thin
Server Component (its `metadata` now in English) delegating to a new Client Component,
`system-map-content.tsx`, holding the full bilingual content dictionary (English authored as canonical,
Dutch translated to match) and the toggle itself. `system-map-diagram.tsx` took a `lang` prop and its own
bilingual `TEXT` dictionary, including two aria-label translations. Persisted per-viewer in
`localStorage` only; `document.documentElement.lang` tracks the active language while on the page and
resets to the site's Dutch default on unmount.

**Commit `f2b3975` — a visual double-footer fix.** Not the same bug as the allowlist fix above (already
closed) — this was the page's own closing content block (a `<div>`, correctly not a second `<footer>`
tag) sitting directly above the global `SiteFooter` with identical styling, reading as two stacked footer
bars to a human even though a DOM landmark count would show only one `<footer>`. Removed outright — its
content (a repeated "drawn from the repo docs" line, already stated once in the header; a "back to home"
link) was genuinely redundant, not merely misplaced.

## Verification held on every one of the three pushes

`web:typecheck` clean, full web suite green (494/494 throughout, unchanged since no backend code was
touched), a LOW-effort `/code-review` pass (findings: one reuse issue fixed on push 1, zero on pushes 2
and 3), CI green (gate + deploy) on every push, and a production canary after every deploy
(`checkdecijfers.vercel.app/systeemoverzicht` → 200, plus a live footer-count check on push 3).

**One tooling wrinkle, not a product bug:** the Browser pane's screenshot/scroll tools became unreliable
mid-verification (`document.hidden === true`), a quirk previously only seen on the sibling project's map
rendering. Worked around by resizing the viewport to the full page height for a single screenshot, and by
verifying the SVG diagram's geometry programmatically (`getBoundingClientRect` on every text node — zero
overlaps, zero orphaned labels) rather than relying on pixels. Recorded in [lessons-learned.md](../lessons-learned.md)'s session-68 entry.

## What this does NOT touch

Nothing from session 67's "▶ NEXT" list. The WP26 flags, `GDPR_PURGE_APPLY`, the three live migration
applies (023/024/025), #193's live `audit:verify` step, #162's A/B measurement, #132 route B, and the
owner-menu items all stand exactly where session 67 left them — untouched, still entirely
owner-supervised, still no deadline.

## Session-69 starting point

No queue remains — same as session 67 left it, since session 68 was a side quest that didn't consume
anything from that list. Paste-ready kickoff:
[2026-08-31-session-69-kickoff.md](2026-08-31-session-69-kickoff.md).
