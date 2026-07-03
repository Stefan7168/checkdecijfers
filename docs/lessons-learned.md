# Lessons learned

Concrete, evidence-backed lessons from build sessions — surprises, dead ends, things that
cost time or tokens, tool/provider quirks, and things done differently next time. Not a
place for lessons already captured elsewhere: check [STATUS.md](STATUS.md),
[decisions/](decisions/), and [CLAUDE.md](../CLAUDE.md) conventions first. Newest entries
on top.

## 2026-07-03 — fresh-machine bootstrap walked for real: the runbook held, three frictions written back

- **Lesson:** a runbook section becomes trustworthy only after someone actually walks it. The first real execution of "Moving to a new machine" worked end to end, and surfaced three frictions now written back into that section: (1) the GitHub CLI was listed as optional but is required in practice — the repo is private and `gh auth login` is what gives git its clone credentials; (2) a non-developer creating `.env` as a new TextEdit document gets a rich-text `.env.rtf` that nothing can read — the safe path (duplicate `.env.example` in Finder, rename) is now step 5, and a session can live-verify both credentials without ever displaying them (Anthropic's free model-list endpoint; `select 1` through the pinned-CA client); (3) the coldest-ever `npm test` run can still push one ingest-heavy test past even the raised 30s ceiling — re-run once before diagnosing (WP6's `testTimeout` mitigation reduces, not eliminates, first-run flakiness; CI is unaffected, its suites run as separate steps).
- **Also observed (process):** the bootstrap checklist was first pasted into a chat session anchored to a *different* project's folder, and got confidently "corrected" against that repo (npm→pnpm, "wrong" clone URL) before being verified against this one. A session must confirm which repo a pasted instruction targets before verifying it against whatever happens to be its working directory.
- **Evidence:** this session (2026-07-03): clone + verify measured — typecheck clean; first run 305 passed / 1 failed, then green in isolation and on the full re-run (306 passed / 2 todo, matching STATUS.md's WP7 count); `.env.rtf` detected, converted (`textutil`), 3 stray formatting characters cleaned from a comment line, both credentials live-verified; RUNBOOK §"Moving to a new machine" updated in the same commit as this entry.
- **Scope:** process (walk runbooks for real; confirm the target repo of pasted instructions), tooling (TextEdit RTF trap; cold-run vitest flake)

## 2026-07-03 — WP7: adversarial review with *executing* skeptics found five validator bypasses a green suite had missed — and the review harness itself needs guardrails

- **Lesson (review value):** for anti-hallucination code, a passing test suite proves the checks you thought of; an adversarial review whose skeptics must *execute* every claimed bypass against the real validator proves the ones you didn't. WP7's review (5 lenses, 75 agents, 2 skeptics per finding) double-confirmed 23 findings on a diff that was already fully green — among them five real bypasses in the R3/R9 core: Dutch cardinal number-words ('zeshonderdzeventigduizend' produced zero digit tokens, so the whole scan never saw it), the noun 'daling' and separable verbs ('nam af/toe') invisible to the direction check, fullwidth Unicode digits invisible to the tokenizer, derivation values escaping period binding entirely, and fabricated integers colliding with structural counts. The instruction that made skeptic verdicts trustworthy: "a bypass the validator actually catches is refuted — run it." Several plausible-sounding findings died exactly that way (5 refuted, incl. a ReDoS whose trigger precondition can't occur at the call site).
- **Lesson (harness guardrails):** three self-inflicted process wounds, each cheap to prevent next time. (1) A workflow-script bug — passing `agent(...)` promises to `parallel()` instead of thunks — silently discarded every verdict of the first run; workflow **resume** with the fixed script recovered all completed agents from cache, so the retry cost minutes, not a re-run. Test the aggregation shape of a workflow script before a 70-agent fan-out. (2) The tests-lens finder did live **mutation testing in the working tree** (isolation wasn't specified) and failed to restore two of its probes — one left a marker comment, the other silently deleted a load-bearing detection (`ten opzichte van` base-year rule) whose regression test kept passing *for the wrong reason* via a fail-open that was itself removed later. File-mutating agents get `isolation: 'worktree'`, no exceptions; after any agent run over the live tree, verify with the full suite + a git-level diff review, not a grep for one marker string (the first grep searched 'MUTATED' and missed 'MUTATION-TEST'). (3) "File was modified by the user or a linter" notices during a multi-agent run can be your own subagents — verify who/what before trusting either the old or new content.
- **Lesson (calibration, WP6's lesson re-confirmed +1):** three more validator false positives were found only by live runs, never by reading — the subtlest on run three: the '4' in the CBS period label '2025 4e kwartaal' collided with the cell value 4,0 and demanded a % sign next to an ordinal. Ordinal/embedded digits (digit glued to a letter) now only ground as period/metadata. And prompt rules stating a norm ("aantallen in cijfers") were ignored by the model until given a good/bad example ('de 2 gemeenten', NOOIT 'de twee gemeenten') — prompt v3's example fixed what v2's rule text didn't; the fail-closed ladder kept every intermediate run honest (its engagements are preserved in the eval report's history).
- **Evidence:** [benchmark/answer-eval-report.json](../benchmark/answer-eval-report.json) history (v1: 12 llm + 1 retry + 1 template; v2: 11 llm + 3 template; v3: 14/14 llm, repeat=2 stable); ADR [013](decisions/013-answer-composition.md) §6; the review workflow transcript (75 agents, ~5.5M subagent tokens on the session harness — not project API spend).
- **Scope:** process (executing skeptics; workflow authoring; agent isolation; verify-the-tree), tooling (workflow resume), calibration (live runs over reading)

## 2026-07-03 — WP6: the first live calibration run was worth more than any amount of prompt polishing

- **Lesson:** don't polish an LLM prompt speculatively — get a labelled set and a cheap measured run in front of it as early as possible. One ≈€0.25 live run against 45 labelled questions found three *real* parser gaps (self-referential places like "mijn gemeente" silently dropped; past-tense/baseline-less questions guessed as "latest" at 0.75–0.85 confidence; causal-vs-out-of-scope precedence on B19) that no amount of reading the prompt would have surfaced. Each fix was a **rule in the prompt**, with the calibrated threshold (0.9) as backstop — never a threshold tweak to paper over a prompt gap. Corollary: prompt fixes cascade — the "never drop places" rule broke B6 ("Nederland" emitted as a region term on a national-only measure suddenly read as a mismatch), caught only because the whole set re-runs after every prompt change. Re-run everything, every time; it's cents.
- **Evidence:** calibration progression 40/45 → 43/45 → 45/45 as observed in-session (then 45/45 at `--repeat=3`, zero outcome flips — that final run is the committed artifact, [benchmark/intent-calibration-report.json](../benchmark/intent-calibration-report.json)). The intermediate runs left no artifact because the script overwrote its report each run — itself a lesson, caught by this WP's adversarial review: **an eval that overwrites its own report destroys the evidence its conclusions cite.** The script now appends per-run history. Total session API spend ≈ €1.30 of the €25/mo cap (in-session estimate; only the final run's 618,705/14,333 tokens are committed — reconcile against the Anthropic Console for exact spend).
- **Also observed (provider quirks):** the structured-outputs schema dialect rejects `oneOf` — zod v4 renders discriminated unions as `oneOf`, so the generated JSON schema needs a `oneOf`→`anyOf` rewrite (semantically identical for disjoint discriminated unions). And `erasableSyntaxOnly` (Node type stripping) forbids TS constructor parameter properties — write explicit field assignments.
- **Also observed (tooling):** vitest's 5s default per-test timeout turned flaky once `npm test` ran ~10 concurrent PGlite instances (WP6 added three suites). CI was never affected (suites run as separate steps); fixed locally with `vitest.config.ts` `testTimeout: 30_000`. Slow is fine, flaky is not.
- **Scope:** process (measure early; re-run the whole set per prompt change), provider quirk (oneOf/anyOf), tooling (vitest timeout under PGlite load)

## 2026-07-03 — post-WP5 wrap-up: a stale session-start file read nearly caused a phantom "docs out of sync" fix

- **Lesson:** before declaring a doc out of sync with the code (or "fixing" it), verify against git — `git diff HEAD -- <file>` plus a fresh `grep` of the on-disk file — rather than trusting a file read from the start of the session. A session's first read of a file can be stale.
- **Evidence:** this session's opening read of [STATUS.md](STATUS.md) showed the pre-WP5 version (WP5 unchecked, "next up: WP5") even though HEAD was already the WP5 commit and `git status` was clean — disk content and the read genuinely disagreed. On that basis the session reported a bookkeeping gap to the owner and planned a STATUS rewrite; the pre-edit ground-truth check (`git show 4d3b980 -- docs/STATUS.md`, then `git diff HEAD` + `grep` of the live file) showed the WP5 commit had already done the bookkeeping correctly and the working tree matched it. Nothing needed fixing; rewriting from the stale copy would have *created* the drift it claimed to repair.
- **Also observed, no action needed:** CI's checkout/setup-node actions (`@v4`) emit a Node 20 deprecation annotation (forced to Node 24 by GitHub since 2025-09). Harmless warning; Dependabot's github-actions updates will deliver the `@v5` bumps.
- **Scope:** process (verify-before-fix on docs), tool-quirk (stale first read)

## 2026-07-03 — WP5: a "$top sample" fixture silently missed every benchmark cell it existed to serve

- **Lesson:** a fixture captured as "the first N rows" of a large table is a sample of *whatever order the API returns*, not of what the tests need — verify a fixture's **coverage against its consumers' actual cells** before building on it, cheaply and up front. The WP2-era CPI fixture (`$top=1000`) contained only periods up to 2020MM12, so the cells B3, B4, and B20 score against simply weren't in it; every other table was covered by luck of size, which is exactly what made the gap invisible.
- **Evidence:** caught before any query code was written, by running a scratch coverage script (full fixture ingest into PGlite, then look up all 33 answer-key cells): 25/33 present, all 8 missing cells in `86141NED`. Fixed by replacing the `$top` sample with a **capture-only slice** (`Bestedingscategorieen eq 'T001112'`, the headline series) in `scripts/capture-cbs-fixtures.ts` — same wire format, 1,505 rows, contains every benchmark period including the B20 freshness references. The re-captured live data still matched the frozen key exactly (no CBS drift since 2026-07-02). The capture script also gained a per-table CLI arg so one fixture can be refreshed without touching the other seven, and it now *fails loudly* if a capture would exceed its page cap instead of silently truncating.
- **Scope:** process (verify fixture coverage before designing against it), tooling
- **Bonus quirk, same session:** CBS metadata carries stray whitespace — `82242NED`'s measure title is `Uitgesproken  faillissementen` (double space) on the wire, and `82610NED`'s table title has a trailing space. Codes were already trimmed at parse time (WP2's quirk #2); human-readable titles/labels are now whitespace-normalized at the query seam (`normalizeLabel`, [src/query/resolve.ts](../src/query/resolve.ts)) so attribution matches how the frozen key and docs record them. Found because the benchmark-intents test compares titles against the key byte-for-byte.

## 2026-07-03 — Supabase "Automatically expose new tables" granted anon/authenticated full CRUD

- **Lesson:** on a managed Postgres platform with an auto-generated public API layer (Supabase's PostgREST Data API), a project-level "expose new tables" setting can grant real privileges to unauthenticated/public roles the moment a table is created — independent of whether the app ever uses that API. Check this explicitly for any project the app doesn't intend to expose via the platform's own API, don't assume "we never call that API" means "it can't be called."
- **Evidence:** Stefan flagged the toggle after another session mentioned it. Verified via `get_advisors` (security) + direct SQL against `information_schema.role_table_grants`: all 6 tables had `SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` granted to both `anon` and `authenticated`. Not actually exploitable in this window: Supabase's own `rls_auto_enable()` event-trigger function had already enabled RLS on every new table with zero policies, which blocks all non-owner access regardless of the underlying grants — but that's "safe because nobody has added a policy yet," not a real defense. Also found and fixed: `rls_auto_enable()` itself had `EXECUTE` granted to `PUBLIC` (Postgres's default for new functions, not something Supabase deliberately opened) — revoked, confirmed safe since event triggers fire via the engine, not through a caller's EXECUTE privilege.
- **Fix:** `migrations/003_lock_down_api_access.sql` — revokes the grants, sets default privileges so future tables from our own migrations don't inherit them, revokes the stray function EXECUTE. Guarded with `pg_roles`/`pg_proc` existence checks so it's a safe no-op on the hermetic PGlite test database (ADR 009), which has neither Supabase's roles nor its functions. Verified with `get_advisors` before/after: went from 2 WARN + 6 INFO to 6 INFO (the intended "RLS on, no policy, fully closed" state).
- **Owner step, now done (and stronger than asked):** the dashboard control isn't reachable via SQL or the management MCP tools, so the owner had to act. Rather than just the "Automatically expose new tables" sub-toggle, Stefan disabled the **entire Data API** (Data API integration → Overview → "Enable Data API" → off). That's the cleaner fix when the app never uses PostgREST at all — it removes the whole `/rest/v1/` surface in one switch instead of managing per-table exposure, and makes the sub-toggle moot. **Lesson within the lesson:** when hardening a managed-platform API the app doesn't use, look for the master on/off first; a per-item exposure setting is the narrow tool, the master switch is the right one. Verified afterward (2026-07-03): the app's `DATABASE_URL` path (direct Postgres via the pooler) was completely unaffected — disabling the REST layer doesn't touch database connections — and the security scan stayed clean (6 INFO, 0 WARN).
- **Non-developer-owner note:** the dashboard UI had evolved past the exact wording in the first instruction ("Settings → API → Data API"); the actual path was a "Data API" integration page with an "Enable Data API" master toggle. Guiding a non-dev through a dashboard, describe the *intent* ("turn off the whole REST API — our app doesn't use it") and confirm against what they actually see, rather than hard-pinning menu labels that drift.
- **Scope:** provider-quirk, security

## 2026-07-03 — Supabase capacity incident, ongoing (ops awareness, not a bug)

- **Lesson:** when infrastructure looks flaky, check the provider's status page before assuming a code bug — especially for the exact region a project runs in.
- **Evidence:** status.supabase.com reports an ongoing incident (since 2026-06-30, still "Investigating/Mitigating" as of 2026-07-02 15:08 UTC): capacity issues affecting **project creation, resizing, restarts, and branch operations** across nearly every region, including **eu-central-1** (where the `checkdecijfers` project lives). Supabase's own note: existing projects are unaffected *unless restarted or resized*. Our project (`ACTIVE_HEALTHY`, created 2026-07-02, mid-incident) has ingested and queried normally throughout — no observed impact on ordinary reads/writes.
- **Action while this is open:** avoid restarting, resizing, or pausing the Supabase project. If a connection failure looks infrastructure-related rather than code-related, check status.supabase.com first. This entry is time-bound — safe to ignore once Supabase resolves it (no fixed date; re-check status.supabase.com if anything Supabase-related misbehaves).
- **Scope:** provider-quirk, ops

## 2026-07-03 — git identity leak (work email into a personal-project repo)

- **Lesson:** check a machine's *global* `git config user.email` before the first commit in a new repo, especially a personal/private one — it silently applies unless a repo-local override exists, and nothing about writing a commit warns you whose identity it's using.
- **Evidence:** this machine's global `~/.gitconfig` was set to a work identity (`redacted-work-id <redacted-work-email>`), which ended up authoring 22 of this repo's first 25 commits — the entire doc-writing phase plus WP1 — before Stefan caught it via a different Claude Code session. Fixed with a repo-local `git config --local user.name/user.email` override plus a `git filter-branch --env-filter` history rewrite (no `git-filter-repo` available on this machine; built-in `filter-branch` was adequate for 25 commits) and a force-push. Verified byte-identical tree content before pushing (`git diff` against the pre-rewrite ref was empty) and re-ran CI green on the rewritten history before calling it done. Full recipe: [RUNBOOK.md](RUNBOOK.md), GitHub account line.
- **Scope:** process, provider-quirk (git config inheritance)

## 2026-07-03 — WP4: table registry + alias list

- **Lesson:** when the `Db` abstraction's `query()` only ever returns `{ rows }` (no `rowCount` — by design, so PGlite and pg stay interchangeable, ADR 009), don't infer "did this UPDATE match a row" from the result shape. An UPDATE without `RETURNING` always returns `rows: []` whether it matched zero rows or a thousand — a plausible-looking `if (result.rows.length === 0)` existence check is silently always-true.
- **Evidence:** caught before committing, by tracing through the "table not yet registered" test scenario on paper rather than trusting the first draft: `src/registry/apply.ts` initially tried to detect a missing `cbs_tables` row this way, which would have made every UPDATE look like a miss. Fixed by checking existence with an explicit `select ... where id = any($1)` *before* writing anything, which also fixed a second latent bug the same rewrite caught: `canonical_measures.table_id` has a foreign key to `cbs_tables`, so a mid-loop insert against an unregistered table would throw and abort with some rows already written. The upfront check makes the whole apply all-or-nothing.
- **Scope:** provider-quirk (Db interface), process (trace scenarios before trusting a first draft)

## 2026-07-03 — WP3: benchmark answer key frozen

- **Lesson:** A previous session's CI safety rail can itself become the blocker — read the guard's actual code, not just trust its intent, before treating a documented plan as blocked. `scripts/score-benchmark.mjs` hard-failed the moment the key froze (`answer-key.json` exists), with a comment reading "implement [scoring] before freezing the key" — directly contradicting `tasks.json`'s own `frozenNote` ("frozen=true only when every answerable task has an entry") and STATUS.md's explicit session-3 plan to freeze the key well before the answer pipeline exists. Left as-is, freezing the key today would have turned CI red for every push across several future work packages.
- **Evidence:** Fixed by making the post-freeze branch validate the key's *structure* honestly (mirroring the existing skeleton-mode pattern: real checks, zero scores claimed) instead of hard-failing until scoring is implemented. Full local gate (typecheck, ingestion, invariants, benchmark incl. a new structural test, scorer) green after the fix.
- **Scope:** process

- **Lesson:** When a task says "freeze against the ingested cells," query the live database directly rather than trust even already-verified docs — and don't let a sampling `LIMIT` stand in for an exhaustive check on the exact cell you need.
- **Evidence:** An exploratory `LIMIT 10` query over `82610NED`'s distinct measure×dims combinations didn't surface the `M002264_1`/`E006590` (Zonnestroom) pair the B11 answer key needed at all — 10 rows out of dozens of technology×measure combinations happened to miss it. A direct, unlimited, filtered query found it and confirmed the value matched docs/07 exactly. Every one of the 20 cells pinned in `benchmark/answer-key.json` was re-queried this way, not copied from the doc.
- **Scope:** process

- **Lesson:** Batch/session date labels can drift a day from the underlying UTC timestamps near a timezone boundary — worth reconciling once, explicitly, rather than either ignoring it or treating it as a data discrepancy to chase.
- **Evidence:** STATUS.md and this session's brief both called it "the 2026-07-03 sync batches"; the actual `ingestion_batches` rows are all timestamped `2026-07-02T16:4x` UTC (the author's commit is `+07:00`, still July 2 there too). There is exactly one successful batch per table either way, so no batch-selection ambiguity — noted in the frozen key's `pinnedTo.note` and moved on.
- **Scope:** process

## 2026-07-02 — WP2: ingestion + validation pipeline

- **Lesson:** Verify a hosted database's connection string from the actual machine before building on it — Supabase's direct `db.<ref>.supabase.co` host is IPv6-only and unreachable from typical IPv4-only home networks; the fix is the Session-pooler URL (same database, same password). Derive unknowns deterministically (the pooler region came from AWS's published IP ranges) instead of probing endpoints with credentials.
- **Evidence:** `EHOSTUNREACH` on the direct host's IPv6 address; a credential fan-out across guessed pooler regions was rightly blocked by the permission layer; one AWS ip-ranges lookup identified eu-central-1 and the second targeted attempt connected. (Supersedes WP1's untested "default to the Session Pooler" hedge — now measured and fixed in `.env`, RUNBOOK, and `.env.example`.)
- **Scope:** provider-quirk

- **Lesson:** When a provider's TLS chain ends in its own root CA, pin the public root certificate (committed to the repo) instead of disabling verification; and note that node-postgres lets a `sslmode` URL parameter override an explicit ssl config — strip the URL's query and pass the ssl object.
- **Evidence:** `SELF_SIGNED_CERT_IN_CHAIN` on the Supabase pooler; the root extracted from the TLS handshake and committed as `config/supabase-prod-ca-2021.pem`; strict verification passes only once `sslmode=require` is stripped from the URL.
- **Scope:** provider-quirk

- **Lesson:** Probe the live wire format for half an hour before pinning contracts — measured shapes beat documented shapes, and reference values from earlier docs double as free cross-validation.
- **Evidence:** Probes pinned dimension `Kind` values and `ValueAttribute` semantics, showed the documented trailing-space quirk does not reproduce on v4 (trim defense kept anyway, it's cheap), and reproduced docs/07's population figure (17,942,942) exactly.
- **Scope:** process

- **Lesson:** For repeatable data work (fixtures, captures, scoring), a committed deterministic script beats AI agents: no transcription risk, re-runnable in one command, and fixtures can be raw wire responses replayed through the same parser production uses — one parser, tested against reality.
- **Evidence:** `scripts/capture-cbs-fixtures.ts` captured all 8 tables (sliced where registered) in one run; tests replay those exact responses; the initial idea of agent-based capture was dropped for this.
- **Scope:** delegation

- **Lesson:** Parallel implementation agents in one working tree are safe when the contracts (types, schema, seed data) are committed *first* and each agent owns an explicit, disjoint file list — the expensive model writes contracts and briefs, cheap models write the code.
- **Evidence:** Three cheap-tier (Sonnet) agents built adapter, pipeline, and tests concurrently with zero file conflicts against pre-pinned contracts; the integrator found nothing left to fix.
- **Scope:** delegation

- **Lesson:** Multi-agent builds should be orchestrated so a process crash loses nothing: journaled workflows resume with finished agents returned from cache, and state that matters lives on disk (repo, STATUS, fixtures), never only in a chat.
- **Evidence:** Claude Code exited mid-workflow during WP2; all three implementers' output was on disk, the run was resumable from cache, and no work was re-paid.
- **Scope:** tooling

- **Lesson:** Declaring CI hermetic (no secrets, no network) early is an architecture forcing-function, not just an ops choice — it pushed the pipeline behind a minimal `Db` interface with an embedded real-Postgres test database, which is also what makes it vendor-swappable.
- **Evidence:** ADR 009: PGlite runs the same committed migrations as Supabase; `npm test` works on a fresh clone with nothing but npm.
- **Scope:** process

- **Lesson:** A fully green test suite and adversarial review are complementary, not redundant: tests prove specified behavior, reviewers hunt the unspecified paths. Review the *ordering* of side effects especially — "persist, then validate" bugs hide behind loud failures.
- **Evidence:** With the suite fully green, review lenses still found two real bugs: `--rebaseline` swapped the registry baseline *before* the five validation checks ran (a failed rebaseline would silently keep the bad baseline), and a missing CBS period status silently defaulted to `Definitief` (an R11 guess). Both fixed the same day with regression tests.
- **Scope:** delegation

- **Lesson:** Strict structured-output schemas on review agents are fragile — an agent that can't satisfy the schema after N retries returns *nothing*, silently costing a whole review lens. Treat schema-validated agent output as fallible: detect empty lenses and re-run them with a plain-text report format.
- **Evidence:** 3 of 5 structured review agents hit the retry cap and produced no output; the same three lenses re-run as plain-text reviewers completed, and two returned genuine findings.
- **Scope:** tooling

- **Lesson:** Give test suites their own adversarial "honesty" review that asks: would a broken implementation also pass? Vacuous assertions and missing state checks look green just the same.
- **Evidence:** The honesty lens found a CLI test whose "row counts printed" assertion (`/\d/`) was satisfied by any digit in the output (even the duration line), four failure tests that never checked the table was actually quarantined in the database, and two untested condition branches — all strengthened the same day.
- **Scope:** process

## 2026-07-02 — Phase 0 kickoff (WP1: CI skeleton + CBS table validation)

- **Lesson:** An honest-skeleton CI gate (real doc-consistency tests + `todo`-marked obligations) beats both "no CI yet" and fake-green placeholder tests; every later work package inherits its obligations as a checklist.
- **Evidence:** 9 real tests + 21 todos went live in WP1; the scorer refuses to emit scores until the answer key freezes, so nobody can quote a meaningless benchmark number. WP2 converted its 10 inherited todos into real tests.
- **Scope:** process

- **Lesson:** Always pin `model:` explicitly on every `Workflow` `agent()` call — it silently inherits the session's top-tier model if you don't, with no warning.
- **Evidence:** A 9-agent CBS-catalog research workflow ran unmodeled, inherited the session model (Fable), and all 9 agents failed mid-run with "You've hit your session limit" after burning 130,524 subagent tokens for zero usable output. The fix was one line per `agent()` call (`model: 'sonnet'`); the rerun completed cleanly (17 agents, ~1.1M tokens, 187 tool calls).
- **Scope:** tooling / provider-quirk

- **Lesson:** Assume `main` is push-protected from message one; scaffold the branch+PR flow before the first commit instead of attempting a direct push. And note the complement: GitHub's *own* defaults don't protect `main` for solo repos — the CI gate is advisory until deploy-blocking attaches at Vercel.
- **Evidence:** `git push origin main` was denied by the harness's auto-mode classifier ("bypasses PR review... push to a feature branch instead"), forcing a mid-task detour: `checkout -b`, push branch, `gh pr create`, `gh pr merge`. Meanwhile nothing on GitHub's side technically prevented pushing red to main.
- **Scope:** tooling

- **Lesson:** Treat any live-database call — even a harmless `SELECT version()` connectivity check — as an action that needs the user's explicit, named-target sign-off before attempting it, not after being denied.
- **Evidence:** Building a `DATABASE_URL` from credentials already in-chat and then trying to verify it with one test query was blocked: "the user asked only to store the connection string in .env, not to query the production DB... requires explicit approval naming the target." Had to store the string untested and flag that explicitly instead.
- **Scope:** process / tooling

- **Lesson:** If a tsconfig scaffold uses newer JS built-ins (e.g. `Object.groupBy`), set `"lib"` explicitly (`["ES2024"]`) — bumping `target` alone doesn't pull in the newer standard-library surface, and the TS2550 error message doesn't say which config field to change.
- **Evidence:** First `npm run typecheck` failed with TS2550 on `Object.groupBy` plus three cascading implicit-`any` errors from the same missing lib; fixed with one tsconfig line, `target` stayed ES2022.
- **Scope:** tooling

- **Lesson:** CBS's OData catalogs are case-inconsistent *per table*, not per platform — some tables are lowercase on both v3 and v4, others uppercase on both — and querying with the wrong case returns an empty array silently, not an error.
- **Evidence:** Live probes returned `{"value":[]}` for `70072NED`/`03759NED` (need lowercase) but that assumption was *wrong* for `83932NED` (uppercase on both). The research workflow's own briefing guessed "v4 is usually uppercase" and had to self-correct mid-run after a live query contradicted it.
- **Scope:** provider-quirk

- **Lesson:** A catalog's stated update-cadence label (e.g. "Permaand") describes *cadence*, not which period grains exist — always enumerate the periods collection directly rather than inferring availability from that label.
- **Evidence:** `82242NED` (bankruptcies) is labeled "Permaand" (monthly) but has a full yearly grain back to 1981; a naive frequency-only check would have wrongly ruled it out for the yearly benchmark task.
- **Scope:** provider-quirk

- **Lesson:** Never carry a table/entity ID from planning notes into implementation without live verification — a wrong-but-plausible neighbor ID can silently answer a different question.
- **Evidence:** `85552NED`, cited in the project's brainstorm notes for solar generation, doesn't exist on either CBS catalog. The plausible neighbor `85005NED` does exist, but measures installed *capacity*, not *production* — using it unverified would have produced a confidently wrong number for a benchmark task.
- **Scope:** process / product

- **Lesson:** When a work package's output is a *claim about the world* (table X serves benchmark Y), an adversarial second pass that re-derives every claim from the source API catches transcription errors the first pass rationalizes.
- **Evidence:** All 8 table verdicts re-verified by independent agents; two initial claims corrected before they entered docs/07.
- **Scope:** delegation

- **Lesson:** In multi-agent delegation, state which model tier ran the work in the same breath as reporting results — don't wait for the user to ask.
- **Evidence:** The model-tier question only surfaced because the user asked it after a session-limit failure; nothing in the workflow's own output volunteered which model it used. The fix landed as a written rule (CLAUDE.md's "Delegation cost-tier rule"), but the reporting habit is the generalizable process lesson.
- **Scope:** delegation

- **Lesson:** When a task needs a secret, don't ask an open-ended "what do you need from me?" — name the exact destination ("create the key, paste it into your local `.env` yourself, tell me when it's done") so the user is never invited to paste it into chat.
- **Evidence:** In response to an open "what do you need from me?", the user pasted a live Anthropic API key, a Supabase account password, and a database password directly into the transcript — despite the project's own RUNBOOK already stating secrets never belong in chat. The rule existed; the prompt shape didn't route around the failure mode.
- **Scope:** process

**If starting a new web app tomorrow, three changes to the kickoff prompt:**

1. State the delegation cost-tier rule (pin cheap models on fan-out work, report the tier used, unprompted) in the *first* message, not after a session-limit failure burns real credit.
2. Explicitly name secret-handoff destinations up front ("when you need to give me a credential, paste it into local `.env` yourself — never in this chat") instead of leaving it to an open "what do you need from me?"
3. State the branch/PR convention (no direct pushes to `main`) as a standing rule before the first commit, so the first `git push` doesn't need a mid-task detour.

## 2026-07-02 — docs & discovery

- **Lesson:** Digesting a long, contradictory notes file works best with parallel readers plus one synthesis pass, but the interview memo is the real deliverable — invest there.
- **Evidence:** 3,737-line brainstorm digested into one batched decision memo; Stefan answered 6 questions once, no follow-up rounds needed.
- **Scope:** process

- **Lesson:** Separating owner decisions (product) from architect decisions (stack, via ADRs) prevents a non-developer owner from being asked to pick frameworks.
- **Evidence:** Interview covered pricing/audience/scope only; all tech choices landed in 8 ADRs Stefan reviewed as documents.
- **Scope:** process
