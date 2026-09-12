# Session 98 kickoff (written 2026-09-12, session 97, autonomous)

Read in this order: [CLAUDE.md](../../CLAUDE.md) → [STATUS.md](../STATUS.md) top block → this file →
[ADR 045](../decisions/045-journey-programme-first-five-minutes.md) → [08-build-plan.md § Journey programme](../08-build-plan.md)
→ [open-questions #238 + #237](../open-questions.md).

## Where things stand (verified 2026-09-12)

- `main` is live: the visual-upgrade programme (PRs #10–#12) and WP218 (PR #7).
- **Branch `journey-programme` — PR #14 open for the owner's review (CI gate PASS on `633db3f`), NOT merged, NOT live.** It carries the Journey
  programme phases 0, 1, 3, 4, 5 (ADR 045): the usage report, the first-question bundle, the coverage disclosure and
  findability copy, the two draft trust pages, the one-click clarification options, the chips collapse, the phone
  header. Fully verified (see the PR body). Verify with `gh pr list` before saying anything about its state.
- Also open: PR #9 (embed; needs `EMBED_TOKEN_SECRET` on merge, Live re-render still gated) and PR #13 (Story stage
  motion pass, opened by a parallel session 2026-09-11).
- Owner steps: migrations 028 + 029 (`npm run db:migrate`); optional `BRANDFETCH_API_KEY`; **read the two draft pages
  `/werkwijze` and `/privacy` and fill in the contact e-mail placeholder**; after 028, run `npm run usage:report` once.
- The product is live and handles money (#118): owner present → push to `main` after the full verification block;
  autonomous → branch + PR. **R3 (confirm before a 100-credit fetch) = money path = branch + PR + explicit owner go.**

## The single next priority (owner, 2026-09-12: "do it in the prompt for the next session" — the merge was deliberately
## NOT done in session 97 even though the owner was present at its end)

1. **Merge PR #14** (`gh pr checks 14` must still be green; a fresh `main` may have moved — rebase/merge `main` in first if
   so, re-run the verification block on the result). Then check production answers (200) and the two new pages serve.
   Then ask the owner, in plain sentences, one at a time: (a) confirm-before-fetch chip yes/no (R3); (b) signup grant
   larger than one fetch — a number, or "keep 100"; (c) the contact e-mail for `/privacy`, and whether the two draft
   texts may lose their draft note. Then the owner-only commands: `npm run db:migrate` (028 + 029), `npm run usage:report`.
   Then look into the 7 all-time `internal` refusals (error log / `audit_answers` refusal_reason = internal) before
   building anything new.
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

## Autonomous big-build variant (owner ask, 2026-09-12: "starts building top-notch progress on the webapp")

If the session runs autonomously (owner away), it does NOT merge PR #14 (an autonomous merge of a money-path branch is
outside #118(b)); it builds on top of it. Order, each as its own branch stacked on `journey-programme` with a PR, full
verification block + `/code-review` LOW + a real-browser pass before "done", multiple worktree agents, big steps:

1. **The public face** ([#237](../open-questions.md)(d), decision 12): the landing page rebuilt around the positioning
   sentence ("chat from official-statistics research to an embedded, sourced chart") and a **public gallery of ~10 real
   stories** — curated charts through the SAME `ChartView` (templates, Insights, Present all live on them), each with
   its source badge, a template applied, an Insights story, and a copy-able embed once PR #9 is in. Registry-built,
   deterministic captions only; no AI spend on the public page. Both languages. Noindex stays until the owner lifts it.
2. **The whole journey on a phone** (R9.1, [#238](../open-questions.md)): landing → trial → login → first question →
   clarification → answer card → chart → Style → Insights → Present → credits → history at 375 px, light + dark, in a
   real browser (Playwright allowed); fix everything broken; the footer/theme-toggle overlap included.
3. **Unblock Live embeds** ([#224](../open-questions.md), PR #9): the creator-e-mail lookup that lets the gated Live
   re-render activate — its own small design note first, no schema change if avoidable.
4. Only with an explicit owner go in the chat: **R3** confirm-before-fetch + the larger grant (money path).

Not for an autonomous session: applying 028/029, real LLM spend, lifting noindex, the trust-page draft notes, Eurostat
as a source (never named as answering before it does).
