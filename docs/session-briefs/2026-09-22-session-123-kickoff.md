# Session 123 kickoff (handoff from session 122, 2026-09-22)

Paste this at the start of session 123 if the chat/context from session 122 is gone. The repo is the
source of truth — verify everything below against `git log`/CI/the docs themselves before trusting it,
per CLAUDE.md's own Golden Rule. Do not skip that check just because this file sounds confident.

## Reading order

1. [CLAUDE.md](../../CLAUDE.md) — working agreements, binding constraints.
2. [docs/STATUS.md](../STATUS.md) — **read the top block first, it is authoritative over everything below
   it and over this kickoff file too if they ever disagree.**
3. This file, for the narrative session 122 left off with.
4. [docs/open-questions.md](../open-questions.md) rows #306–#311 for the live architectural candidates.

## Where things stand (verify, don't trust from memory)

`main` is at `2c9456c` as of this write (confirm with `git log -1 --format='%h %s'`). Session 122 (one
long calendar day, 2026-09-22) closed, in order: the phase-6 fix wave + merge to `main`; own-data
co-pilot parity (3 of 6 storytelling primitives); a git-credential limit (can push, can't delete a
branch — handed to the owner); [#307](../open-questions.md)/[#308](../open-questions.md) (a prompt
accuracy fix in both tiers + full CBS-tier e2e render coverage); and a self-found, self-corrected gap
in [#311](../open-questions.md) (`setDimmed`/`setHeadlineOverride` were never actually own-data
chat-reachable, despite this session's own earlier claim otherwise). Full narrative:
[docs/status-archive.md](../status-archive.md)'s own "Session 122" entry (prepended at wrap-up — read it
before re-deriving any of this from git log alone, it has the reasoning, not just the SHAs).

**All six phase 4/6 storytelling primitives (goal line, era shading, dim-not-hide, headline-override,
difference/mean overlay) are now chat-reachable on BOTH the CBS/Eurostat card and the own-data
("eigen data") card.** CI confirmed green (gate + deploy) on every commit that touched code this session
— the last one, `b64ffe7`, confirmed via `mcp__github__actions_get` (run `35706081745`, all 5 jobs
`success`) immediately before this handoff was written.

## No single mandated next task — pick deliberately, don't default

Session 122 closed every small, clearly-scoped, non-owner-gated gap it could find by actually reading
source (not by assuming). What's left splits into three real categories:

1. **Owner-gated, genuinely blocked, not yours to start:** `registry:apply`, the DOI backfill, a live
   benchmark run, region-set Task 9, audit row 22, and the `:record` real-model fixture confirmations —
   all blocked on the Anthropic workspace usage cap, which lifts **2026-10-01**. Don't attempt these
   before then; they need real spend and/or live DDL, both owner-supervised per CLAUDE.md.
2. **Real, unscheduled architectural candidates the owner has seen and not yet chosen between**
   ([#306](../open-questions.md)): (b) two-measure charts (scatter etc.) — the biggest genuine rebuild,
   needs the query layer itself changed, explicitly held by the owner's own call after investigation
   ([#296](../open-questions.md)); (c) make Eurostat actually answerable in chat (E2) — not yet designed
   at all; (d) own-data parity for phase 5/5b (chart-fit scorer forms, verified-whole pie/stacked) — not
   investigated; own-data has no "regions" concept, so a verified-whole analog may not even apply the same
   way. **If the owner is present in chat, ask which of these (or something else) they want — don't guess
   a product-scope decision autonomously.** If working autonomously with no owner steer, (d) is the most
   consistent continuation of session 122's own pattern (own-data parity), but investigate before
   committing — session 120 already found (c)'s sibling investigation, scatter, was a bigger lift than it
   looked.
3. **Small, cheap, low-value cleanup, explicitly NOT scheduled by session 122 — pick up only if already
   touching the relevant file for another reason:** the own-data tier's equivalent of #308 (only its
   difference overlay and, as of `b64ffe7`, `setDimmed`/`setHeadlineOverride` have a dedicated real-browser
   e2e case — `addEraShading`, the mean-overlay variant, and the goal line still don't).

## Binding constraints (unchanged, restated because they matter)

- Full verification block before ANY push: root+web typecheck, root+web vitest (full suites, not a
  subset), hermetic benchmark (14/14+6/6+0 fabricated, GATE PASS), `/code-review` LOW on the diff, real
  `next build`. A prompt-byte change (any edit to a `SYSTEM_PROMPT` string) means `npm run
  chart-copilot:fixtures` / `attachments:fixtures` (free, offline, no live spend) before that verification
  block — don't skip fixture regen and don't reach for `:record`/live spend for an EXISTING case's hash
  drift, only for a genuinely new case.
- Owner-present sessions push directly to `main`, no PR, no branch — confirm the owner is actually present
  in THIS session before relying on that; an autonomous/scheduled session touching core-product code needs
  branch + PR per CLAUDE.md's #118(b) rule.
- `git push origin <sha>:main` (explicit SHA) is this session's established safe-push pattern — always
  `git fetch origin main --quiet && git merge-base --is-ancestor origin/main HEAD` immediately before, to
  guarantee a genuine fast-forward. **After a SHA-push, your LOCAL `main` branch ref is stale** (it only
  updates `origin`'s ref) — `git checkout main` afterward silently carries uncommitted edits onto the old
  base with no error. Session 122 hit this once and recovered without data loss (see
  status-archive.md's own account) — don't repeat it: re-fetch and re-check before trusting a local
  `main` checkout post-SHA-push.
- CI confirmation is via a scheduled check-in (`mcp__Claude_Code_Remote__send_later`), never manual
  polling/sleep. Check BOTH `gate` (all backend shards + web) AND `deploy` specifically — a green
  run-level rollup usually means both passed, but verify the `deploy` job's own steps (especially "Deploy
  prebuilt output" and the post-deploy smoke check), don't infer it from the rollup alone.
- Model identity never goes in commits/PRs/code — chat replies only.
- GitHub scope: `stefan7168/checkdecijfers` only.

## A live process lesson worth internalizing before you start

Session 122's own docs (STATUS.md, ADR 056, open-questions #311) stated for several hours that
`setDimmed`/`setHeadlineOverride` "needed no work, already own-data-wired" — written earlier the SAME
session, and wrong (true of the panel doorway only). It was caught only because a later continuation
re-read the actual source file instead of trusting that recent claim. **A claim this session (or the last
one) wrote is not automatically verified just because it's recent — re-check against source before
repeating it, especially before telling the owner something is "done."**
