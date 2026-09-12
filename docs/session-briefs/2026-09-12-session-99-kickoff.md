# Session 99 kickoff (written 2026-09-12, session 98, autonomous)

Read in this order: [CLAUDE.md](../../CLAUDE.md) → [STATUS.md](../STATUS.md) top block → this file →
[08-build-plan.md § Journey programme](../08-build-plan.md) → [open-questions #237 / #238 / #224](../open-questions.md).

## Where things stand (verified against GitHub on 2026-09-12)

- `main` is live: the visual-upgrade programme (PRs #10–#12) and WP218 (PR #7). Nothing was merged in session 98.
- **Five PRs wait for the owner, in this stacking order:**
  1. **PR #14** `journey-programme` → `main` — Journey programme phases 0/1/3/4/5 (ADR 045). CI green. Owner steps on merge:
     read + fill in `/werkwijze` and `/privacy` (contact e-mail), `npm run db:migrate` (028 + 029), `npm run usage:report`
     once, say go/no on R3.
  2. **PR #18** `journey-public-face` → `journey-programme` — the public face: landing around the positioning sentence +
     `/galerij` with twelve real stories on the live `ChartView` (ADR 046). CI green (`gate`), Opus-reviewed + fix wave,
     real-browser pass. No AI spend, no server action on the public pages (test-pinned). Noindex stays.
  3. **PR #19** `journey-phone` → `journey-programme` — the whole journey walked at 375 px light + dark in a real browser;
     header wrap, six tap targets, the Present stage's phone captions fixed. CI was still running at wrap-up — check
     `gate` on its head `16dc9fc` before saying anything about it.
  4. **PR #9** `embed-charts` → `main` — embeds (needs `EMBED_TOKEN_SECRET` on merge).
  5. **PR #15** `embed-live-creator-lookup` → `embed-charts` — the creator-e-mail lookup that lets Live embeds activate
     (reads `auth.users.email` through the existing pool; fail-closed). CI green. Owner step after merge: run
     `select email from auth.users limit 1;` as the `DATABASE_URL` role once (RUNBOOK) — no error ⇒ Live works for
     `PRO_ACCOUNT_EMAILS` owners.
  Also open: PR #13 (Story stage motion pass), Dependabot #16/#17.
- **New tooling:** [scripts/dev-harness/](../../scripts/dev-harness/README.md) + RUNBOOK §"Local real-browser harness" —
  the whole app, logged-in and with benchmark questions, locally with no secrets and no LLM spend. Use it for every
  browser pass from now on.
- The product is live and handles money (#118): owner present → push to `main` after the full verification block;
  autonomous → branch + PR. **R3 (confirm before a 100-credit fetch) = money path = explicit owner go.**

## The single next priority

**If the owner is in the chat:** merge in the stacking order above (each PR's CI must be green on its head; after
merging #14 into `main`, retarget/merge #18 and #19; after #9, merge #15), then the owner steps listed per PR, then the
three decisions the session-98 kickoff asked for (R3 chip yes/no; signup grant number or "keep 100"; the contact
e-mail + dropping the trust-page draft notes), then the 7 all-time `internal` refusals.

**If the owner is away:** do not merge (money path). Candidates, cheapest first, each branch + PR:
1. #240 — delete the now-unmounted Ontdek section, its feed slot, tests and i18n keys (mechanical, after #18 merges or
   stacked on it).
2. The gallery's copy-able embed code per card once #9 + #15 are in (#237(d) follow-up).
3. The sidebar icon-button tap targets (< 44 px, shared `Button` size tokens) as a small design-system audit (#238).
4. `agentRules: false` in `web/next.config.ts` so `next dev` stops rewriting `web/CLAUDE.md` (RUNBOOK harness section).
5. The repositioning ADR + roadmap re-phasing (#237(a)) — docs only.

## Binding constraints / owner steers

- Cheapest mechanism first: no AI call, no new library, no schema change unless the owner says otherwise.
- Never name a data source publicly before it answers questions (principle c). Eurostat is "binnenkort", not "in".
- Every new public route goes into `isPublicPath` (web/proxy.ts) with its test in the same commit.
- Public pages: zero LLM spend, zero server-action calls — pin it with a sink/spy test, not by reading.
- Plain English for the owner. No R-codes without the sentence.

## Model tiers in session 98

Session model (Fable) planned, built the harness, reviewed every diff and screenshot, resolved the docs merge, opened the
PRs; three Sonnet implementers (one resumed twice — a walk needs its full step list enforced); one Opus whole-branch
reviewer (10 findings, 1 HIGH, all fixed).
