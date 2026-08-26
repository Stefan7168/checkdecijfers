# Session 64 — kickoff (written by session 63 at close, 2026-08-26)

**Paste-ready prompt, Dutch (matches this project's convention for owner-facing kickoffs):**

> Sessie 64 voor checkdecijfers.nl. Lees eerst `docs/CLAUDE.md`, dan `docs/STATUS.md` (het bovenste
> blok is leidend), dan dit bestand helemaal.
>
> **Verifieer ZELF met `date` en `git log -1 origin/main` voordat je iets aanneemt** — dit bestand is
> geschreven door sessie 63 op 2026-08-26 en kan verouderd zijn tegen de tijd dat jij het leest.
>
> Als `git log -1 origin/main` nog steeds `1a16eed` teruggeeft: **PR #85 staat nog open, `main` mist
> alles sinds de PR-77-merge.** Checkout `fix/191-reply-turn-answer-first` (niet een kale `main`), of —
> beter — controleer eerst of de owner PR #85 inmiddels gemerged heeft (dan is `main` weer de juiste
> basis en kun je gewoon daarvandaan werken).

## Verified state at session-63 close (re-derive, don't trust blindly)

- **Date:** 2026-08-26 (local clock briefly showed 2026-08-27 mid-session, after local midnight — this
  project's timestamps consistently use UTC, which stayed 2026-08-26 throughout; re-run `date` and
  `date -u` yourself).
- **`origin/main` tip:** `1a16eed` (2026-08-07, the PR #77 squash) — unchanged since session 61.
- **8 PRs open, all confirmed CI-green, none merged** (autonomous sessions, #118(b)):
  #85 (bridge, merge first), #91, #92, #80 (session 62); #93, #94, #95, #96 (session 63). Full detail
  and recommended merge order in `docs/STATUS.md`'s top block and the session-63 entry in
  `docs/status-archive.md`.
- **Merge order #85→#93→#95→#96→#94 verified end-to-end** in a disposable clone (session 63): zero
  conflicts, 47 files / 957 tests green on the combined result. This should hold unless something
  changes on GitHub in the meantime (a force-push, a new commit from elsewhere) — re-verify if in doubt,
  don't just trust this note.
- **WP26 flags (`CLARIFY_CLICK_ENABLED`, `ANSWER_FIRST_ENABLED`) and `GDPR_PURGE_APPLY`: still OFF,
  untouched.** Owner-only. #191 (the pre-flip blocker) is fixed, in PR #85.
- **GDPR dry-run (measured 2026-08-26): 0 rows purgeable** (first ones land ~2026-10-15).
- Production live and healthy (`/` and `/llms.txt` both 200, checked at session-63 close).
- No new Dependabot PRs or security alerts beyond the already-tracked 9 high / 6 moderate (checked
  mid-session-63).

## What session 63 did (autonomous, owner explicitly not present — "work for hours")

Four PRs: #93 (consolidated 3 duplicated intent-parsing option interfaces — #176/#191's recurring bug
shape), #95 (fixed #178 — a clicked "nu" WP26 chip could silently serve stale data), #96 (fixed #34(c) —
concurrent CBS table syncs could crash/corrupt data), #94 (docs). Every fix went through a full local
verification block and an automated `/code-review` pass (high effort for #95/#96, since they touch this
project's most-scrutinized code); each review surfaced real follow-on issues, fixed where safely
scoped, documented where not. Also found, diagnosed, and worked through a ~45-minute GitHub Actions
outage on this repo (documented in `docs/RUNBOOK.md`).

Full narrative: `docs/session-briefs/2026-08-26-session-63-resume-log.md` and the session-63 entry
prepended to `docs/status-archive.md`.

## Next up, in priority order (from STATUS.md's own NEXT list — re-check it hasn't changed)

1. **If the owner is present:** review + merge the 8 open PRs (order above), then the owner-supervised
   items only they can do — the WP26 go-live, `GDPR_PURGE_APPLY=1`, the Dependabot merge sequence,
   #193's live `audit:verify` pinning step, #132 route B.
2. **If autonomous again (owner not present):** the eight PRs already cover everything safely buildable
   without owner action right now. Engineering follow-ups with no owner-blocker, each needing its own
   scoped session rather than a rushed addition to an already-large PR:
   - **open-questions #34(b):** batch `dimension_labels` writes in `src/ingestion/pipeline.ts` — still
     row-by-row per-row `INSERT`, confirmed by direct contrast with `observations`' own chunked
     `jsonb_to_recordset` batching in the same function.
   - **open-questions #34(c)'s two deeper residuals** (both documented in the row with a recommended
     fix shape): a pre-existing TOCTOU where the five sync validators read via plain queries before
     `syncTable`'s transaction/lock opens; the rebaseline's `version = version + 1` has no
     optimistic-concurrency guard, so two serialized-but-still-concurrent rebaselines can silently
     clobber each other's result with no error. **Read PR #96's own description and the ADR-024-adjacent
     reasoning in the session-63 archive entry before starting — the fix shape needs real care, not a
     quick patch.**
   - **PR #93's own two review findings:** `RespondOptions`/`ComposeOptions`/`SemanticCheckOptions`
     (in `src/answer/respond/types.ts` and `src/answer/compose/`) still hand-duplicate a smaller version
     of the `client`/`model`/`maxTokens` seam `src/answer/intent/options.ts` already consolidated for
     the intent module — on inspection this is a genuinely smaller, lower-urgency surface (2-3 fields,
     not 7-9) than the original finding suggested, and `RespondOptions` in particular has a different
     shape (two separate clients, not one) that makes a clean unification a real design question, not
     a mechanical extraction. Scope carefully before starting.
   - Before starting any of these: re-verify they're STILL open (`grep` the relevant open-questions row,
     check the code directly) — don't trust this list if real time has passed.
3. **Owner's monthly maintenance agenda is coming due** — dependency alerts, spend dashboards, backup
   status, the `open-questions.md` triage (it's grown large — session 63 found it's ~300KB; the
   project's own convention already has an archive mechanism for closed rows, worth exercising if this
   is the maintenance session).

## Binding constraints (unchanged, re-confirm before acting)

- Autonomous session (no owner in chat) ⇒ branch + PR + owner review before merge, #118(b). Owner-present
  session ⇒ standing push authorization, no per-merge approval needed (owner: "je moet gewoon alles
  pushen ... ik vertrouw jou volledig", session 48) — but this does NOT cover live DDL, real LLM spend,
  or env-flag flips, which stay owner-supervised regardless of presence.
- WP26 flags and `GDPR_PURGE_APPLY`: never flip without the owner explicitly present and asking for it.
- Full verification block (typecheck ×2, backend + web suites, benchmark 14/14+6/6+0, real build) plus
  an automatic `/code-review` before every code push — docs-only pushes are exempt from the review step.
- This machine is 8GB and can produce spurious test failures under concurrent load — a run finishing
  with exit code 0 is not proof it actually passed; always read the real `Test Files N passed (N)`
  summary line, and re-run in isolation if a result looks anomalous (session 63 hit exactly this: a
  51-minute run with 7 "failed" files and exit 0, confirmed as load-noise by re-running clean).
