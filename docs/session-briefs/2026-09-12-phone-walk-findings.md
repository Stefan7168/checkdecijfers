# Phone walk — 2026-09-12 (session 98, branch `journey-phone`)

Scope: R9.1 (#238) — walk the product journey at 375px, light + dark, in a real
Chromium browser (Playwright via the session's screenshot harness), and fix
what's broken or cramped. This is a partial walk, not the full 20+ step
journey in the kickoff brief — see "What was not covered" below.

## Findings

| Step | Wrong | Fix | Before | After |
|---|---|---|---|---|
| Workspace header, 375px, light+dark | The wordmark "Check de Cijfers" wrapped onto two lines (header + balance chip + NL\|EN + Account button don't fit on one line at 375px even after session 97's fix moved two links into the Account menu). The wrap blew out the header's fixed `h-12` height. | `web/components/site-header.tsx`: `whitespace-nowrap`+`shrink-0` on the wordmark link and the balance `Badge`; `gap-2 px-3` on mobile widening to `gap-3 px-4` at `sm`. | `phone/01-landing-light.png` | `phone/01b-landing-fixed.png`, `phone/03-dark-fixed.png` |

Screenshots referenced above live in this session's scratchpad
(`$SCRATCHPAD/phone/`), not committed to the repo — durable evidence is this
table plus the code diff.

Other steps walked and found OK (no fix needed): `/login` (form + Google
button, no overlap besides the Next.js dev-tools badge, which is not part of
the product); the workspace composer + disclosure + first-question round trip
(B4 inflation question, replayed via the LLM stub) — chart, answer body,
attribution chip, download link, and follow-up chip all render without
overflow or clipping at 375px; `/credits` (four packs, "≈ N vragen" line,
purchase buttons — not clicked through to Stripe per the brief); `/404`.
`scrollWidth` was 375 (no horizontal scroll) on every page shot. Desktop
(1280px) screenshots before/after the header fix show no layout change.

## What was not covered in this pass

Given the size of the full walk in the kickoff brief, this pass covered the
header regression (the one concrete, reproducible bug found) plus a
representative slice of the journey (landing/workspace, login, one answer
round trip, credits, 404) rather than the complete step list. **Not walked:**
the trial section, the busy-state/honest-waiting line at 8s, the visual
dock/chart tabs/Style panel/Insights/Present stage in detail, a clarification
round + one-click option send, a refusal, the insufficient-credits path, the
purchase-success banner, `/geschiedenis` in detail (only a single screenshot
taken, not interacted with), the sidebar/thread list, the Account
menu/logout flow, `/werkwijze` and `/privacy`, keyboard focus order and
44px tap-target audit, and an EN spot-check. These remain open under #238.

## Verification (measured)

- `npm run web:typecheck` — clean.
- `npm run web:test` — 98 files / 1492 tests passed (matches the branch
  baseline exactly; no regressions).
- `web:build` and the benchmark were not run in this pass (only
  `web/components/site-header.tsx` and its test changed; no `src/` change).
