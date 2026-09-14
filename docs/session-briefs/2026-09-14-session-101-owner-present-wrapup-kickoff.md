# Kickoff — session 101, next continuation (after 2026-09-14, owner-present wrap-up)

Paste this (or just say "continue") to start the next session. Read in the normal order first:
[CLAUDE.md](../../CLAUDE.md) → [STATUS.md](../STATUS.md) (top block is authoritative over anything
below it or in any other doc) → [08-build-plan.md](../08-build-plan.md) → the rest as needed.

## ⚠ This is meant to be a long, autonomous, overnight session (owner's own framing: "hours long,
## insane productive, should move mountains") — owner asleep/away. Read this section first.

"Move mountains" here means real engineering throughput on the ONE big, fully-designed, already-
reviewed body of work actually sitting ready — not scope creep into things this project's own rules
keep owner-supervised. **Recommended primary target: build WP30c phase E1** (the Eurostat adapter +
internal, flag-gated explorer — see "Genuine next-priority candidates" below). It's the obvious
choice for a big autonomous run: ADR [048](../decisions/048-eurostat-data-source.md) already
specifies it in full and has already been through one pre-build adversarial review, so there's a
whole real module to build (`src/eurostat-adapter/`, registry entry, conformance fixtures, an
internal explorer UI) with a clear done-definition — genuinely hours of legitimate work, not
busywork. Don't invent a different giant target without a strong reason; this one is already paid
for in design effort.

**The process for it is NOT "just build it"** — this repo's own WP27/WP30 precedent (which ADR 048
explicitly commits to following) is: (1) turn ADR 048 into a line-by-line executor brief, (2) run
the FULL pre-build adversarial design review AGAIN on that specific brief (today's review checked
the ADR's design, not a frozen brief — both passes are required, not one), (3) fix confirmed
findings, THEN build per the frozen brief, (4) a final whole-branch review before opening the PR.
Skipping straight to code from the ADR is not "moving faster," it's skipping the step that makes
this repo's autonomous builds trustworthy.

**Hard bounds — "move mountains" does not waive any of these, ask instead of guessing:**
- **Branch + PR, never merge** — this is autonomous, core-product code (`open-questions.md` #118(b)).
  Open the PR, leave it for the owner's review, same as PR #22 was left overnight last time.
- **No live DDL, no real Stripe/env/flag changes, ever, autonomously** — the Pro-subscription
  go-live steps (RUNBOOK, steps 4-8) and anything touching production secrets/flags stay strictly
  owner-supervised, regardless of how much progress momentum there is. If E1's own migration needs
  applying, it stays file-only until the owner reviews the PR, exactly like migration 030 was
  supposed to (see the incident below).
- **Never call `spawn_task`** — the owner explicitly does not want suggestion-chip popups. If real
  out-of-scope follow-up work is found, add it as an `open-questions.md` row instead.
- If WP30c E1 turns out smaller than expected and there's still real time left, the CI health-check
  gap (below) is a good, well-scoped second target — also branch + PR, not a merge.
- Scope discipline still applies even in "move mountains" mode: stick to what's actually
  pre-approved (WP30c E1's own design + review), don't wander into E2/E3 or the parked
  pattern-discovery track without the owner — "park nothing on him, but don't wander past what was
  actually authorized" (see [[feedback_document_dont_escalate]] in memory).

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

- `main` is at `21e262d` as of this writing — check `git log`/`git fetch origin main` for the actual
  current tip, don't trust this number if time has passed. Git status clean, no stray worktrees, CI
  green on the last several commits (docs-only pushes skip CI by design).
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
- **Real follow-up, not yet done, NOT tracked via a task chip (owner opted out of those — see
  above):** extend CI's `/api/health` smoke check to cover `pro_subscriptions` unconditionally — it
  currently has a real blind spot that let this session's incident happen (it deliberately skips
  flag-gated tables, but that table is queried regardless of its flag). A good second target if
  there's time left after WP30c E1 (see the top section).
- [open-questions.md](../open-questions.md) #248 and #123 are resolved (Eurostat chosen, EU-wide
  destination settled). #109 and #205 both now point at their merged PRs.

## Genuine next-priority candidates

For an OWNER-PRESENT session with no autonomous-overnight framing: ask rather than assume. For the
autonomous overnight run this brief is written for, see the top section — #1 below is the pick.

1. **Build WP30c E1** (Eurostat adapter + internal explorer) — **the recommended overnight target,
   see the top section for the required process and hard bounds.**
2. **The CI health-check gap** — a good second target if there's time left (see above).
3. **Finish the Pro subscription go-live** (RUNBOOK steps 4-8) — NOT for an autonomous session
   (owner-supervised only, real Stripe/env/flag actions). Owner-present only.
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
