# Session 65 — kickoff (written by session 64 at close, 2026-08-27)

**Paste-ready prompt, Dutch (matches this project's convention for owner-facing kickoffs):**

> Sessie 65 voor checkdecijfers.nl. Lees eerst `docs/CLAUDE.md`, dan `docs/STATUS.md` (het bovenste
> blok is leidend), dan dit bestand helemaal.
>
> **Verifieer ZELF met `date` en `git log -1 origin/main` voordat je iets aanneemt** — dit bestand is
> geschreven door sessie 64 op 2026-08-27 en kan verouderd zijn tegen de tijd dat jij het leest.
>
> `main` was aan het eind van sessie 64 volledig actueel en er stond GEEN enkele PR open — dat is de
> eerste keer sinds de PR-77-squash (2026-08-07). Als `git log -1 origin/main` iets anders dan `9add066`
> teruggeeft of `gh pr list --state open` niet leeg is, is er sindsdien iets gebeurd — lees wat, voordat
> je verder gaat.

## Verified state at session-64 close (re-derive, don't trust blindly)

- **Date:** 2026-08-27 (both local and UTC — no midnight-rollover confusion this session, unlike
  session 60/61's multi-day gaps).
- **`origin/main` tip:** `9add066` (a docs-only STATUS.md update). Zero open PRs (`gh pr list --state
  open` returned `[]`). Production confirmed healthy: `/` and `/llms.txt` both 200, checked after every
  one of the 14 merges this session, not just at the end.
- **Owner was present in chat for the entire session** — standing push authorization applied (#118
  revision), no per-merge approval was asked for or needed. If session 65 is autonomous instead
  (spawned task chip, overnight run, owner explicitly not in chat), that does NOT carry over — #118(b)
  branch+PR applies to autonomous sessions regardless of what session 64 did.
- **WP26 flags (`CLARIFY_CLICK_ENABLED`, `ANSWER_FIRST_ENABLED`) and `GDPR_PURGE_APPLY`: still OFF,
  untouched.** Both are now fully unblocked (nothing code-side stands in the way) and both are explicitly
  reserved for the owner asking for them in chat, regardless of session presence — never flip either
  without that.
- **One open security finding with no PR: [open-questions #194](../open-questions.md)**, root `nanoid`
  3.3.17, HIGH severity, no existing PR to `@dependabot recreate` against. Check
  `gh api repos/Stefan7168/checkdecijfers/dependabot/alerts` fresh — Dependabot's weekly run may have
  already opened one since session 64 closed.

## What session 64 did (owner present, cleared the entire PR backlog)

Merged all 8 bridge PRs from sessions 61-63 (`#85→#93→#95→#96→#94→#91→#92→#80`), then — after checking in
with the owner and getting a go-ahead — the full Dependabot backlog (`#89 #86 #84 #97 #90` plus a
regenerated `#98`, after `#83` auto-closed itself mid-batch and nearly took a real postcss security fix
down with it). 14 merges total, each with its own CI watch + production canary. One real merge conflict
(PR #94 vs. the new `main`, 4 doc files) resolved by hand, hunk by hunk. Three infrastructure-reliability
traps hit and caught, not trusted at face value — full detail in `docs/lessons-learned.md`'s session-64
entry and the new merge-queue section in `docs/RUNBOOK.md`'s "How work happens".

Full narrative: `docs/status-archive.md`'s session-64 entry (prepended).

## Next up, in priority order (from STATUS.md's own NEXT list — re-check it hasn't changed)

1. **If the owner is present:** the two things only they can trigger, both fully unblocked code-side —
   the **WP26 go-live** (RUNBOOK "WP26 answer-first + clickable options", one flag at a time, check
   `/llms.txt` = 200 as the cheapest pre-flip canary) and **`GDPR_PURGE_APPLY=1`** plus one watched run
   (RUNBOOK's GDPR section). Neither is urgent on a deadline, both are pure "whenever the owner wants it."
2. **The new root-`nanoid` HIGH alert ([#194](../open-questions.md))** — check whether Dependabot's
   weekly run has opened a PR yet; if not and it's been more than a few days, consider whether to wait
   longer or escalate.
3. **If autonomous (owner not present):** #118(b) applies — branch + PR + owner review, no direct push.
   Engineering follow-ups with no owner-blocker, each needing its own scoped session:
   - **open-questions #34(b):** batch `dimension_labels` writes in `src/ingestion/pipeline.ts` — still
     row-by-row, confirmed open twice now (sessions 63 and 64 both re-verified it's still there).
   - **open-questions #34(c)'s two deeper residuals** (TOCTOU on pre-lock validation reads; the
     rebaseline's unguarded version-bump) — read PR #96's description and the session-63 archive entry
     before starting.
   - **PR #93's own two review findings:** `RespondOptions`/`ComposeOptions`/`SemanticCheckOptions` still
     hand-duplicate a smaller version of the options-bag seam `src/answer/intent/options.ts` consolidated
     for the intent module. Scope carefully — on inspection this is a smaller, lower-urgency surface than
     the original finding suggested.
   - **open-questions #193's live `audit:verify` pinning step** — R8 divergence check against
     production, expected clean per PR #91's own investigation, but unverified.
4. **Owner's monthly maintenance agenda** — dependency alerts (should be nearly clean now bar #194),
   spend dashboards, backup status, `open-questions.md` triage (still large; check if it's grown further
   since session 63 measured it at ~300KB).
5. **Then the owner menu:** WP30c choice, [#162](../open-questions.md), [#170](../open-questions.md) rest
   (3)+(4), and [#132](../open-questions.md) route B (T-0 condition still holds, `forks_count` still 0 as
   of 2026-08-26 — re-measure if re-asking).

## Binding constraints (unchanged, re-confirm before acting)

- Autonomous session (no owner in chat) ⇒ branch + PR + owner review before merge, #118(b). Owner-present
  session ⇒ standing push authorization, no per-merge approval needed — but this does NOT cover live DDL,
  real LLM spend, or env-flag flips (WP26, `GDPR_PURGE_APPLY`), which stay owner-supervised regardless of
  presence.
- Full verification block (typecheck ×2, backend + web suites, benchmark 14/14+6/6+0, real build) plus an
  automatic `/code-review` before every CODE push — docs-only pushes are exempt from the review step.
- **New this session — merge-queue operational notes (full detail in `docs/RUNBOOK.md`):** don't trust
  `gh pr view --json mergeable` when it sits at `UNKNOWN` — merge directly instead of waiting. Don't trust
  `gh run watch --exit-status`'s own "completed" signal — always independently re-check `gh run view`
  before trusting a canary. A PR that self-closes as "superseded" mid-batch can still have been fixing
  something unrelated the superseding PR never touched — diff before assuming it's safe to ignore.
- This machine is 8GB and can produce spurious test failures under concurrent load — a run finishing with
  exit code 0 is not proof it actually passed; always read the real `Test Files N passed (N)` summary
  line, and re-run in isolation if a result looks anomalous.
