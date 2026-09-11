# Session 98 kickoff (written 2026-09-12, session 97, autonomous)

Read in this order: [CLAUDE.md](../../CLAUDE.md) → [STATUS.md](../STATUS.md) top block → this file →
[ADR 045](../decisions/045-journey-programme-first-five-minutes.md) → [08-build-plan.md § Journey programme](../08-build-plan.md)
→ [open-questions #238 + #237](../open-questions.md).

## Where things stand (verified 2026-09-12)

- `main` is live: the visual-upgrade programme (PRs #10–#12) and WP218 (PR #7).
- **Branch `journey-programme` — PR open for the owner's review, NOT merged, NOT live.** It carries the Journey
  programme phases 0, 1, 3, 4, 5 (ADR 045): the usage report, the first-question bundle, the coverage disclosure and
  findability copy, the two draft trust pages, the one-click clarification options, the chips collapse, the phone
  header. Fully verified (see the PR body). Verify with `gh pr list` before saying anything about its state.
- Also open: PR #9 (embed; needs `EMBED_TOKEN_SECRET` on merge, Live re-render still gated) and PR #13 (Story stage
  motion pass, opened by a parallel session 2026-09-11).
- Owner steps: migrations 028 + 029 (`npm run db:migrate`); optional `BRANDFETCH_API_KEY`; **read the two draft pages
  `/werkwijze` and `/privacy` and fill in the contact e-mail placeholder**; after 028, run `npm run usage:report` once.
- The product is live and handles money (#118): owner present → push to `main` after the full verification block;
  autonomous → branch + PR. **R3 (confirm before a 100-credit fetch) = money path = branch + PR + explicit owner go.**

## The single next priority

1. If the owner is present: walk him through the PR (plain English, one screen at a time), merge, deploy, then the
   owner steps above. The draft notes on the trust pages come off only after his read.
2. Then, with the owner's explicit go: **phase 2 / R3** — one chip "Haal op voor 100 credits" before an on-demand
   fetch, plus the larger signup grant (decision 5, a config value). Money path: branch + PR, debit-before-run with
   full compensation stays (ADR 026), idempotent `requestId`, the finder-side guards re-run at the take.
3. Phase 6: run the report again after 028 and a week of use; judge the next round on numbers. First signal already
   in the data: 7 `internal` refusals all-time — check the error log before anything else.

## Binding constraints / owner steers

- Cheapest mechanism first: no AI call, no new library, no schema change unless the owner says otherwise.
- The composer stays bare; the coverage disclosure is collapsed by design.
- Never name a data source publicly before it answers questions (principle c). Eurostat is "binnenkort", not "in".
- Plain English for the owner. No shorthand, no R-codes without the sentence.
- Every new public route must be added to `isPublicPath` (web/proxy.ts) in the same commit, with its test.

## Tracked but not the focus

- The repositioning ADR + roadmap re-phasing (#237), the #205 Pro-plan brainstorm, the landing/gallery test — owner in
  the chat.
- Eurostat as source two — its own WP through the WP30 narrow waist, after the journey phases.
- STATUS.md known debt: session blocks 92→96 still not archived per convention (this session added its own lean block
  and archived its entry, but did not migrate the older ones).
- The footer's "Cijfers:" prefix sits under the theme toggle at 375 px (pre-existing, cosmetic).

## Model tiers this session

Session model (Fable) planned, merged, resolved conflicts, fixed WP-E's review items, ran the browser pass and the
verification; five Sonnet implementers (one delegated to a nested agent — brief "do it yourself"); two Opus reviewers
(whole-branch + scoped) and one Opus fix wave.
