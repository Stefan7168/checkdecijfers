# Kickoff — session 101, next continuation (after 2026-09-14, owner-present wrap-up)

Paste this (or just say "continue") to start the next session. Read in the normal order first:
[CLAUDE.md](../../CLAUDE.md) → [STATUS.md](../STATUS.md) (top block is authoritative over anything
below it or in any other doc) → [08-build-plan.md](../08-build-plan.md) → the rest as needed.

## What just happened (2026-09-14, owner present, this session)

1. A CBS cell-highlight proof-panel link shipped (#247, `10be5db`).
2. A 6-item UI polish batch shipped and deployed (`1a5c8c0`): Download/Embed inside the chart Style
   modal, more modal padding, an always-visible reset button, theme toggle + Geschiedenis moved into
   the Account dropdown, a new `/about` page.
3. **Eurostat chosen as the second data source.** ADR [048](../decisions/048-eurostat-data-source.md)
   is written and has been through a full pre-build adversarial design review (4 lenses, 14
   findings, all resolved or folded in — see the ADR's own "Amendments" section). **WP30c (phase E1
   only: adapter + an internal, flag-gated explorer) is execute-ready in
   [08-build-plan.md](../08-build-plan.md).** Nothing built yet.
4. **Both previously-open PRs merged** on explicit owner instruction: #21 (`eb15838`) and #22
   (`53c7703`). Both deployed, CI green.
5. **A real incident, found and fixed same session:** PR #22 was merged/deployed before its own
   required migration 030 — the exact "total outage" scenario `RUNBOOK.md`'s own pre-written
   go-live checklist warned about. Caught during this wrap-up, verified directly against the live
   database, fixed within ~30 minutes (`npm run db:migrate` applied 5 pending migrations: 026-030).
   **No confirmed user-facing errors found**, but the incident window wasn't fully queried — true
   impact isn't fully known either way. Full account: `RUNBOOK.md`'s Pro subscription go-live
   section, `STATUS.md`, `docs/lessons-learned.md`'s top entry.

## Current state (verify against `git log`/`gh pr list`/`gh run list` before trusting — this is a
## summary, not a substitute for the Golden Rule)

- `main` is at `b427100` (this brief's own commit) plus a small wrap-up-2 addendum right after it —
  check `git log` for the actual tip. Git status clean, no stray worktrees, CI green on the last
  several commits (docs-only pushes skip CI by design).
- Pro subscription tier: code is merged and LIVE but still flag-gated OFF
  (`PRO_SUBSCRIPTIONS_ENABLED` unset). Migration 030 is applied. Remaining go-live steps (4-8 in
  `RUNBOOK.md`'s Pro subscription go-live section) are NOT done: create the real Stripe Price
  object, set `STRIPE_PRO_PRICE_ID`, subscribe the webhook destination to
  `customer.subscription.*`/`invoice.paid`, set the flag, redeploy, smoke test. All owner-supervised
  — do not do any of this autonomously. **Readiness re-confirmed same day:** `STRIPE_SECRET_KEY`/
  `STRIPE_WEBHOOK_SECRET` already set (pre-existing, from credit-pack payments), code read directly
  and confirmed real; `STRIPE_PRO_PRICE_ID`/`PRO_SUBSCRIPTIONS_ENABLED` confirmed unset. **No Stripe
  MCP tool is available in this environment** — whether the webhook destination is actually
  subscribed to the four new event types (step 7) could not be checked from a session; that one
  needs the owner's own Stripe Dashboard.
- **Never call `spawn_task`** (the suggestion-chip tool) in this project — the owner asked to never
  see that popup again (2026-09-14). Record real follow-up work as an `open-questions.md` row.
- Migrations 026-030 are ALL now applied to production (five at once, in this session) — WP202a
  (attachments) and WP218 (chart styling) each had their own go-live checklists whose migration
  step is now also done; their OTHER remaining steps (env vars, flags) are still not done — check
  `RUNBOOK.md` before assuming either is fully live.
- Eurostat/WP30c: scheduled, not started. No code, no migration, nothing public-facing changed
  (the pre-existing "Eurostat — coming" homepage notice was removed this session, `058efdf` —
  the public site currently says nothing about Eurostat at all, which is intentional per ADR 048
  D3's rollout posture).
- A follow-up task chip was spun off (not started): extend CI's `/api/health` smoke check to cover
  `pro_subscriptions` unconditionally — it currently has a real blind spot that let this session's
  incident happen (it deliberately skips flag-gated tables, but that table is queried regardless of
  its flag). Check `/tasks` or ask the owner if it's been picked up.
- [open-questions.md](../open-questions.md) #248 and #123 are resolved (Eurostat chosen, EU-wide
  destination settled). #109 and #205 both now point at their merged PRs.

## No single "next priority" was set by the owner at the end of this session

Genuine open candidates, roughly in the order they came up — ask the owner rather than assuming:

1. **Build WP30c E1** (Eurostat adapter + internal explorer) — per this project's own process, that
   means writing a line-by-line executor brief from ADR 048 first, then running the FULL pre-build
   adversarial design review AGAIN on that brief (today's review checked the ADR's design, not a
   frozen executor brief — the WP27/WP30 precedent this repo follows always does both passes).
2. **Finish the Pro subscription go-live** (RUNBOOK steps 4-8) if the owner wants real billing live.
3. **The CI health-check gap** task chip, if not already picked up separately.
4. Anything else the owner raises fresh.

## Standing reminders

- Git workflow ([open-questions #118](../open-questions.md)): owner-present sessions push/merge
  directly, no per-change approval needed — but **before merging anything with its own RUNBOOK
  go-live section, read that section's prescribed step order FIRST** (this session's own lesson).
  Autonomous sessions still need branch + PR for core-product/money-path code.
- Live DDL, real API spend, and env-flag flips: owner-supervised only, never autonomous.
- Model tiers: express by role ("cheap tier for mechanical legwork"), never hardcode a model name in
  a reusable prompt.
- The Anthropic API usage cap noted earlier in session 101 ([[project_anthropic_api_usage_cap_2026-09-14]]
  in memory) was not revisited this part of the session — check if it's still blocking live LLM
  calls before assuming live chat questions work end-to-end.
