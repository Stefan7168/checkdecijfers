# Session 100 kickoff (written 2026-09-12, session 99, owner present)

Read in this order: [CLAUDE.md](../../CLAUDE.md) → [STATUS.md](../STATUS.md) top block → this file →
[08-build-plan.md § Journey programme](../08-build-plan.md) → [open-questions #237 / #238 / #240](../open-questions.md).

## Where things stand (verified against GitHub on 2026-09-12, session 99)

- **Everything that was waiting is merged and on `main`.** Six PRs, squash-merged in this order, each on a green `gate`:
  PR #14 Journey programme phases 0/1/3/4/5 (`677c5fb`, ADR 045) → PR #18 public face + `/galerij` (`ac14392`, ADR 046)
  → PR #19 phone journey (`189d36b`) → PR #20 sessions 97–98 docs + `scripts/dev-harness/` (`524b63f`) → PR #9 embed
  (`650d664`, ADR 041) → PR #15 creator-e-mail lookup for Live embeds (`8d0f0d4`). `main` deploys on push.
- **The product is live and handles money** ([#118](../open-questions.md)): owner present → push to `main` after the
  full verification block; autonomous → branch + PR. **R3 (confirm before a 100-credit fetch) = money path = explicit
  owner go, still NOT built.**
- **Owner steps now due** (each one made live-relevant by the merges):
  1. `npm run db:migrate` for migrations 028 + 029 (live DDL — owner-supervised), then `npm run usage:report` once.
  2. Read `/werkwijze` + `/privacy`, fill in the contact e-mail, drop the draft notes (a legal read on the privacy
     text is advised).
  3. Set `EMBED_TOKEN_SECRET` in Vercel; run `select email from auth.users limit 1;` as the `DATABASE_URL` role once
     (RUNBOOK) — no error ⇒ Live embeds work for `PRO_ACCOUNT_EMAILS` owners.
  4. Say go/no on R3.
  5. Delete the merged branches in GitHub — the session's git proxy refuses ref deletions: `journey-programme`,
     `journey-programme-v1`, `journey-public-face`, `journey-phone`, `claude/checkdecijfers-journey-programme-rvvipe`,
     `embed-charts`, `embed-live-creator-lookup`, `visual-designed-default`, `visual-templates-v1`, `visual-story-stage`.
- **Still open, deliberately:**
  - PR #13 (Story stage motion/atmosphere) — **the by-hand merge is DONE** (session 97 continued, `27c33d3`): #13's
    own `scroll-mt` phone fix and #19's `min-h-[45dvh] … lg:min-h-[85vh]` fix are both kept in
    `web/components/chart-story-stage.tsx` (different symptoms of the same pinned-chart phone layout, not
    alternatives — git's own auto-merge had silently dropped #19's side with no conflict marker; caught and fixed
    by hand). CI green, `mergeable_state: clean`, re-verified against the current `main` tip. **Still needed before
    merging:** walk the Present stage at 375 px in the local harness — neither branch's own real-browser pass
    covered the combined result. Owner's call whether the motion pass is wanted at all.
  - Dependabot #16 / #17 — untouched; the monthly maintenance session's job.
  - Branch `claude/checkdecijfers-embed-pr-review-acbrd5` — session 96's wrap-up docs + one superseded code commit
    (`038ecd9`). Kept as a record; do not merge (its docs conflict in every tracker, its code is in PR #14 already).

## The single next priority

**If the owner is in the chat:** the five owner steps above, in order — 028 + 029 first, the report right after
(phase 0 finally measures something), then the trust pages, then the embed secret, then R3.

**If the owner is away:** do not touch the money path. Candidates, cheapest first, each branch + PR:
1. [#240](../open-questions.md) — delete the now-unmounted Ontdek section, its feed slot, tests and i18n keys (mechanical).
2. Copy-able embed code per gallery card ([#237](../open-questions.md)(d) follow-up) — PR #9 + #15 are in now.
3. The sidebar icon-button tap targets (< 44 px, shared `Button` size tokens) as a small design-system audit ([#238](../open-questions.md)).
4. `agentRules: false` in `web/next.config.ts` so `next dev` stops rewriting `web/CLAUDE.md` (RUNBOOK harness section).
5. The repositioning ADR + roadmap re-phasing ([#237](../open-questions.md)(a)) — docs only.
6. STATUS.md known debt: migrate the session 92→98 blocks into status-archive.md, leave a lean pointer.

## Binding constraints / owner steers

- Cheapest mechanism first: no AI call, no new library, no schema change unless the owner says otherwise.
- Never name a data source publicly before it answers questions (principle c). Eurostat is "binnenkort", not "in".
- Every new public route goes into `isPublicPath` (`web/proxy.ts`) with its test in the same commit.
- Public pages: zero LLM spend, zero server-action calls — pin it with a sink/spy test.
- Before ANY build: `mcp__github__list_pull_requests` + STATUS top block + `list_sessions` — check nobody else has it
  (lessons, sessions 97 and 99). When adding an open-questions row, check the number against `main` AND every open PR.
- Stacked PRs after a squash merge: `git merge -s ours origin/main` once the trees are verified identical — RUNBOOK
  "Merging a queue", not hand-resolution.
- Plain English for the owner. No R-codes without the sentence.

## Model tiers in session 99

Session model (Fable) did all of it — merge order, conflict resolution, verification, merges, docs; no subagents (nothing
was mechanical enough to delegate at a lower tier without a briefing costing more than the work).
