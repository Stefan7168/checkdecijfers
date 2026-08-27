# STATUS

> **Tracker, not a source of truth.** Scope and the gate are defined in [03-mvp-scope.md](03-mvp-scope.md), the benchmark in
> [02-user-scenarios.md](02-user-scenarios.md). This file only records progress against them. Update it whenever project state changes (see the
> definition of done in [CLAUDE.md](../CLAUDE.md)) — with **measured results only, never aspirational ones**.

> **Session log lives in [status-archive.md](status-archive.md)** — full per-session "Last updated" entries, verbatim, newest on top.
> **Convention (since 2026-07-12, session 41):** at session wrap-up, PREPEND the full session entry to
> [status-archive.md](status-archive.md) and update only the lean top block below. Keep STATUS.md readable in one
> Read call: hard-wrap every line at ~150 chars, no kilobyte-long lines.

**▶ RESUMED 2026-08-26 (session 62, autonomous). Session 63 (same day, autonomous) continued the queue —
full narrative in [status-archive.md](status-archive.md) (prepended) and
[session-briefs/2026-08-26-session-63-resume-log.md](session-briefs/2026-08-26-session-63-resume-log.md).
Session 64 (2026-08-27, owner present) merged EVERY open PR — zero PRs open, `main` fully current.**

**✅ ZERO OPEN PRS (2026-08-27, session 64) — every PR open at session start is merged.** Merged serially,
each with gate+deploy green on `main` and a production canary (`/`, `/llms.txt` both 200) confirmed before
the next merge. The 8-PR bridge chain: **#85** (`d6f6a5f`) → **#93** (`18a68d2`) → **#95** (`12e5799`,
fixed [#178](open-questions.md)) → **#96** (`50d3c63`, fixed [#34](open-questions.md)(c)) → **#94**
(`7133428`, docs) → **#91** (`e15c953`, fixed [#193](open-questions.md) copy) → **#92** (`8d16ff7`) →
**#80** (`c794d5c`). Then the Dependabot backlog: **#89** (`4eef2a6`, brace-expansion) → **#86**
(`b41841b`, nanoid/web) → **#84** (`f29a5ae`, postcss/root) → **#97** (`7e51307`, 17-package web group,
supersedes #88, bumps `next`→16.3.2) → **#83 auto-closed** (superseded by #97's `next` bump, but was the
ONLY PR fixing the web postcss alerts — `@dependabot recreate` triggered a fresh one, **#98** (`a1e9365`),
merged) → **#90** (`6b372cc`, Stripe/pg/LLM-SDK bumps, lockfile-only diff). Owner-present session, standing
push authorization (#118 revision) — no per-merge approval needed; WP26 flags and `GDPR_PURGE_APPLY`
untouched throughout. Verify yourself: `git log -1 origin/main` should show `a1e9365` or later and
`gh pr list --state open` should be empty.

**⚠ ONE SECURITY ALERT REMAINS, with NO PR covering it: root `nanoid` 3.3.17, HIGH** ([#194](open-questions.md); "custom generators
can loop indefinitely when size is zero", fixed at 3.3.18) — alert #28, root `package-lock.json` (not
web, already fixed by #86). Not in #90's npm-all group bump (Dependabot hadn't flagged it yet when #90 was
generated) and no existing PR to `@dependabot recreate` against. **Not fixed this session, deliberately** —
hand-authoring an unplanned dependency bump would skip the reviewed-PR convention
`.github/dependabot.yml`'s own comment documents as load-bearing. Wait for next week's scheduled run, or
check whether this codebase ever calls nanoid's custom generator with `size: 0` (if unreachable, the DoS is
theoretical here) to judge urgency yourself.

**Three traps hit while merging, all caught by not trusting a single signal:** (1) `gh pr view <n>
--json mergeable` returned `UNKNOWN` for several PRs even after 20s+ waits — merging directly via `gh pr
merge` worked cleanly every time rather than blocking on that async field. (2) **`gh run watch` reported
"completed successfully" (exit 0) on runs that `gh run view` on the SAME run id still showed
`in_progress`, three separate times this session** — the inverse of session 62's "false stalled" finding.
Caught every time by independently re-querying `gh run view` before trusting a canary, never by the watch's
exit status alone. (3) **#83 and #97 both bumped `next` in web/** — #97 landed the newer version and
GitHub auto-closed #83 as superseded, which would have silently dropped #83's UNRELATED postcss security
fix (#97 never touches postcss) if not caught — recovered via `@dependabot recreate` → PR #98.

**PR #94 conflicted with the new `main`** (`STATUS.md`, `open-questions.md`, `lessons-learned.md`,
`status-archive.md` — all four also touched by #85/#93/#95/#96's own doc updates). Three were pure
insertion-point clashes (one side of the 3-way merge contributed nothing, so keeping HEAD's content was
correct by construction); `open-questions.md` row #34 was a REAL content conflict — HEAD carried the
pre-#96-fix description, `origin/main` the correct post-fix one, so `origin/main`'s version was kept.
`respond.ts` + 6 other code files auto-merged with zero textual conflicts. Full local verification run once
on the resulting merge commit (typecheck ×2, backend 105/105 · 1579/1579, web 42/42 · 453/453, benchmark
14/14+6/6+0 GATE PASS, real build) plus a `/code-review` LOW pass — 0 findings, since the only genuinely
new content was the doc resolution itself.

**⚠ THE TWO THINGS THAT ARE STILL ONLY YOURS, untouched again:** the **WP26 flags**
(`CLARIFY_CLICK_ENABLED`, `ANSWER_FIRST_ENABLED`) and **`GDPR_PURGE_APPLY`**. Read
[#175](open-questions.md) before flipping WP26 — the anonymous trial receives NEITHER flag.
✅ **[#191](open-questions.md), the pre-flip blocker, is FIXED** (in PR #85, merged — see above).
**GDPR dry-run measured 2026-08-26: 0 rows purgeable yet** (first ones land ~2026-10-15) —
`GDPR_PURGE_APPLY` is still off, unchanged.

**Dependabot backlog — CLEAR.** All six + the #83→#98 recreate merged this session (see above). Only the
root-`nanoid` gap above remains, with no PR yet.

**CBS data:** all 20 registered tables checked this session; the 12 with real drift are synced clean.
Nothing stale beyond what CBS itself hasn't published yet.

**▶ NEXT, in order:** (a) ~~merge every open PR~~ **DONE, session 64 — zero open, `main` current**; (b) the
**owner-supervised WP26 go-live** — one flag at a time, RUNBOOK "WP26 answer-first + clickable options";
#191 no longer blocks it, and #178's "nu"-staleness half is now fixed in #95 (age-bound/TTL half still
open, see below); (c) **`GDPR_PURGE_APPLY=1`** plus one watched run; (d) decide on the root-`nanoid` HIGH
alert above (wait for Dependabot, or judge urgency yourself); (e) **#193's live `audit:verify` pinning
step** (R8 divergence check against production — expected clean per PR #91's own investigation, but
unverified); (f) **#132 route B** GO or defer (T-0 condition — `forks_count` — still 0, re-measured
2026-08-26); (g) then the owner menu: WP30c choice / [#162](open-questions.md) / [#170](open-questions.md)
rest (3)+(4). **Engineering follow-ups available whenever a session has room (none owner-blocked):**
#34(b)+(c)'s residuals, #93's `RespondOptions`/`ComposeOptions`/`SemanticCheckOptions` dedup — see the
tracked list below.

**Tracked, deliberately NOT built:** [#174](open-questions.md) and [#185](open-questions.md) (both explicitly
held), [#183](open-questions.md) (product call), [#188](open-questions.md) (concurrency on a live money path
— supervised), [#190(a)](open-questions.md) (whether an infrastructure-caused refusal should cost a trial
question — a conversion judgement, yours), **[#178](open-questions.md)'s age-bound/TTL half** (the
"nu"-staleness correctness half is fixed in PR #95 — session 63; picking "how many days is too old" for a
client-held pending stays your call), **[#34](open-questions.md)(b)** (batch `dimension_labels` writes —
confirmed still open, session 63) **and (c)'s two deeper residuals** (a pre-existing TOCTOU on pre-lock
validation reads; the rebaseline's unguarded version-bump allowing a silent clobber between two
concurrent rebaselines), **PR #93's two review findings** (`RespondOptions`/`ComposeOptions`/
`SemanticCheckOptions` still hand-duplicate a smaller version of the same options-bag seam; the two
`respond.ts` construction sites have no shared builder) — none of these are owner-blocked, each just
needs its own scoped session rather than a rushed addition to an already-large PR.

Full session-62 record: [status-archive.md](status-archive.md) +
[session-briefs/2026-08-26-session-62-resume-log.md](session-briefs/2026-08-26-session-62-resume-log.md).
Full session-63 record: [status-archive.md](status-archive.md) (prepended) +
[session-briefs/2026-08-26-session-63-resume-log.md](session-briefs/2026-08-26-session-63-resume-log.md).

---

**(Historical — the pause, 2026-08-15 to 2026-08-26.)** Project was paused ~2 months (owner decision) and the
repo set PRIVATE at the same time ([#132](open-questions.md) option D). Production stayed live and unattended
throughout, correctly: `/` and `/llms.txt` 200 the whole time, no data corruption, the trial pot untouched.
The GDPR retention clock does not pause — first purgeable rows land ~2026-10-15, right at the resume point;
handled above. Full pause-era detail in the session-61 halt entry, [status-archive.md](status-archive.md).

**(Historical from here down.)**

**(Sessions 58 + 58B, 2026-07-25 evening/night — TWO AUTONOMOUS overnight runs. ⚠ THE OWNER
STARTED TWO SESSIONS ON THIS BRIEF; both ran, split the queue over a cross-session channel, and both shipped.
Read [status-archive.md](status-archive.md) for the full record and the merge order.**

**✅ ALL FOUR ARE MERGED AND LIVE** (owner present in-chat, 2026-07-25 evening; he delegated the merge call to
the session with *"jij bent de expert"*). Merged **serially**, one deploy at a time, gate+deploy green and a
production canary between each — the #173 discipline. **Both WP26 flags are still OFF; that go-live is his.**

| # | PR | Squash | What | CI + canary |
|---|---|---|---|---|
| 1 | PR #64 | `58c814b` | Server Action arguments were type-checked only by `.length`, so a content-block array (`.length === 1`) drove a ~1 MB prompt at a flat credit price — on the PAID path too, not just the trial. | gate+deploy ✅, 200/200 |
| 2 | PR #67 | `b05a1d3` | 58b's trial hardening: a non-UUID requestId reached the LLM and was rejected only by the R8 insert (served with `auditId: null`); the landing asserting an unverified "pot is leeg"; `x-forwarded-for`/HMAC-secret defaults; the purge's bare `catch`; the cap clamp. **Plus [#177](open-questions.md)** (the rescue parse now records `'intent'`, not `'clarify'`). Rebased onto #64 — guard order `typeof question → length → trialConfigured → requestId shape`. | gate+deploy ✅ (run 30160467319), 200/200 |
| 3 | PR #65 | `ed5f240` | The conformance bundle: the double-default test, single-sourced `NL01`, the envelope-key manifest, the query-count pin. Disjoint — floated. | gate+deploy ✅, 200/200 |
| 4 | PR #66 | `b4da3b2` | This docs close-out. Conflicted with #67 in `open-questions.md`, `lessons-learned.md` and the RUNBOOK — resolved by **taking both sides** (rows #179-#186 from 58b, #187-#190 from 58; both session sections kept). | — |

**Measured on `main` AFTER all four merges, arithmetic checked:** backend **1536 / 101 files**
(1509 + 3 from #67 + 24 from #65) and web **397** (385 + 6 from #64 + 6 from #67); benchmark **14/14 + 6/6 +
0 fabricated, GATE PASS**; real `next build`. Redo that arithmetic after any future merge — it is the check
that catches a silently-dropped file.

**The measured result the queue asked for:** the fixture-snapshot saving is **70-145 s, not the retracted
240 s** — and the within-arm spread exceeds the between-arm difference, so at n=2 the magnitude is not
resolvable. Full four-leg table in ADR [009](decisions/009-hermetic-test-database.md).

**✅ [#189](open-questions.md) — `gdpr:purge` IS scheduled now** (it was not, and nothing had noticed: no cron,
no CI schedule, no RUNBOOK duty, while two retention clocks depended on that one command). A monthly Vercel cron
runs it, **dormant** until `GDPR_PURGE_APPLY=1`. The first trial rows become purgeable **~2026-10-15**, so the
flip has time — but it is the one thing standing between the code and the promise.

**▶ NEXT, in order:** (a) ~~review + merge~~ **DONE — all four merged and live, see the table above**; (b) the **owner-supervised WP26
go-live** — one flag at a time, RUNBOOK section "WP26 answer-first + clickable options", NOT during a deploy
burst (#173); (c) **~30/7 BBP+PPI syncs** (`85880NED` MUST use the chunked escape hatch, RUNBOOK step 5);
(d) re-ask **#132 route B**.

**✅ THREE MORE ITEMS BUILT AND LIVE under the autonomy steer, each deployed on its own with a production canary
between** (serial per [#173](open-questions.md)). Measured after those three (`e88cfea`): backend
**1544 / 102 files**, web **417 / 41 files** — the FINAL numbers are below, after the review round. CI green on
every commit, production 200 on `/`, `/llms.txt`, `/login` after each deploy.

| # | PR | Squash | What | Left for you |
|---|---|---|---|---|
| [#189](open-questions.md) | PR #68 | `fbffe48` | The GDPR purge is **scheduled monthly** at last — nothing ran it before, and the first trial rows become purgeable **~2026-10-15**. Ships **DORMANT**: reports only. A review caught a blocker first — the route was missing from the proxy allowlist, which would have made the cron read as scheduled AND healthy while never running once. | **`GDPR_PURGE_APPLY=1`** + one watched run (RUNBOOK). Unsetting it is a full rollback. |
| [#182](open-questions.md) + [#187](open-questions.md) | PR #69 | `33a051d` | The per-IP backstop bounded **nothing** over IPv6 (a /64 gives one visitor 2^64 buckets); now keyed on the /64. #187 answered from Vercel's docs — `x-forwarded-for` is **not** forgeable on Hobby — and the code now reads the proxy-safe `x-vercel-forwarded-for` first, which matters the day Cloudflare fronts the apex. | — |
| [#180](open-questions.md) | PR #70 | `e88cfea` | The trial pot now **warns at 5 and reports empty**. It had no watcher: an outsider drains a 25-question pot for well under a euro and you'd find out by looking at the homepage. | — |

**✅ THEN A MAX-EFFORT REVIEW OF THAT WORK — PR #71, `d4ade6d`.**
Ten finder angles over the three merged PRs returned 15 findings; **four were defects introduced hours earlier the
same night**, the sharpest being a `??` that reintroduced an empty-header bug three lines above the comment
explaining why it had to be `||`. **14 fixed, 1 skipped with reasoning.** Three findings turned out to be three
spellings of one bug, so `ipBucketKey` was rebuilt to normalise once rather than gain a fourth special case; the
pot-alert latch now keys on DELIVERY rather than on the attempt; the proxy allowlist splits into exact and prefix
lists. Live-verified after deploy: `/api/gdpr-purge-cron` returns 401 (its own auth) and
`/api/gdpr-purge-cron-status` returns 307 — the prefix widening is genuinely closed. Final: backend **1545 / 102
files**, web **425 / 41 files**, benchmark **14/14 + 6/6 + 0 GATE PASS**.

**[#185](open-questions.md) was DECLINED with reasoning, not shipped** — the suggested fix would charge
infrastructure failures to visitors to close a hazard that is unreachable and already bounded by the trial key's
hard spend cap. A reviewer asked to attack that decision agreed. Better future fix recorded in the row.

**▶ AND FOR AN AUTONOMOUS SESSION — start here, not at the owner.** Owner steer 2026-07-25: *"I want you to work
autonomously."* Everything previously parked on him now has a written default, bound and rollback in
**[session-briefs/2026-07-26-autonomous-followups.md](session-briefs/2026-07-26-autonomous-followups.md)** (and the kickoff: **[session-briefs/2026-07-26-session-59-kickoff.md](session-briefs/2026-07-26-session-59-kickoff.md)** — the two earlier session-59 kickoffs are superseded) —
**#187** (two requests, ~€0.04, expected result: the header is NOT forgeable), **#189** (build the purge cron,
dry-run behind a flag), **#181/#183** and the residuals #180/#182/#184/#185/#186/#174 each with a recommended
default. Act under #118(b) (branch + PR) and let him veto by exception. **The ONE exception is the WP26 flag
flip — he has reserved it in his own words, repeatedly, and it stays his.**

Full session record in [status-archive.md](status-archive.md).)**

**Session 57 (2026-07-25 — autonomous overnight, then owner-present for the
merges. **ALL FOUR PRs ARE NOW MERGED AND LIVE** (`e334590` #60, `ea71c96` #61, `29e9e8b` #62, `447fca9` #63), each deployed separately with a settling gap and a production check between — deliberately, per #173.
Production verified healthy after every deploy: `/llms.txt` 200, `/` 200, Ontdek section rendering.
**⚠ THE WP26 FLAGS ARE STILL OFF — that go-live is yours, and the corrected rollback order below matters.**

**▶ THE NEXT SESSION IS ANOTHER AUTONOMOUS OVERNIGHT RUN** — queue in
[session-briefs/2026-07-26-overnight-queue-2.md](session-briefs/2026-07-26-overnight-queue-2.md):
the conformance bundle, a clean A/B of the fixture-snapshot saving, #177, and a Fable adversarial pass on the
anonymous-trial surface (the only anonymous money-adjacent surface, and un-hunted).

(Historical, from the autonomous phase of this session: €0 live-LLM product spend, zero prompt bytes, no DDL, both WP26 flags still OFF.**

| PR | What | CI |
|---|---|---|
| PR #60 | #173(c): pg pool `max` 4 → 2 per process. 3 busy processes fitted under the 15-session ceiling; now 7 do. | green |
| PR #61 | Fixture DB ingested once per run, not once per suite. Measured per suite: **build 7.9-10.7s → restore 1.2-1.4s**. Suite level, MEASURED properly 25/7 in a 4-leg alternating A/B: **70-145 s saved, not the 240 s first quoted** (ADR 009). | green |
| PR #62 | WP26 trust-boundary hardening + the corrected RUNBOOK rollback order. | green |
| PR #63 | Doc-consistency sweep, the Fable architecture memo, and this close-out. | green |

**⚠ TWO THINGS TO KNOW BEFORE THE WP26 GO-LIVE — both found tonight, both change what you should do:**
1. **The RUNBOOK's rollback order was WRONG.** Correct order: turn `CLARIFY_CLICK_ENABLED` **off first**, leave
   `ANSWER_FIRST_ENABLED` on for a day, then turn that off. Rolling B back while A is on strands region-less
   chips in open tabs as guaranteed refusals, and "both together" is **not** a safe shortcut (same refusal, plus
   a wasted LLM call). Fixed in PR #62 — merge it before the flip.
2. **The anonymous trial never receives either flag** ([#175](open-questions.md)). Flipping them changes the paid
   product and NOT the trial — the surface whose measured misfires motivated WP26c. Also: a logged-out smoke test
   would therefore prove nothing. This is a product decision, so the session did not make it.

**The Fable architecture review** (5 agents, one per question, + a synthesiser) is at
[session-briefs/2026-07-25-wp26-architecture-review-memo.md](session-briefs/2026-07-25-wp26-architecture-review-memo.md).
Verdict: architecture in good shape, the honesty seam came through WP26 clean; the one cross-cutting problem is
that the project **pins every rule about a NUMBER with machinery and every rule about the SYSTEM with prose**.
Its top three: fix the RUNBOOK (done, PR #62), decide the trial-flag question, and add the small conformance
bundle (a double-default test, a single-sourced `NL01`, an envelope-key manifest, a query-count pin).

**Also recorded, not fixed — [#174-#178](open-questions.md)**, each with the reasoning for deferring. The one
worth reading is **#174**: a client-held `impliedRecency` bit can turn a stale-table refusal into a served
figure, and the obvious fix is *worse than the bug* (it would make legitimate historical chips start refusing).
It needs a decision about what the bit means.

**▶ NEXT, in order:** (a) review + merge the four PRs; (b) the **owner-supervised WP26 go-live** — one flag at a
time, RUNBOOK section "WP26 answer-first + clickable options", NOT during a deploy burst (#173, `/llms.txt` = 200
is the cheapest canary); (c) **~30/7 BBP+PPI syncs** (`85880NED` MUST use the chunked escape hatch, RUNBOOK step
5); (d) re-ask **#132 route B**; (e) then the owner menu: WP30c choice / #162 / #170 rest (3)+(4).

Item 5 of the overnight queue (#162 slot-filling) was **not started** — it was explicitly "only if time remains",
and verifying the review findings was the better use of the session.

Full session record in [status-archive.md](status-archive.md).)**

**Session 56 (2026-07-25, owner-present, Opus 5. **WP26 IS COMPLETE and pushed —
mechanism A + B-region + B-period + WP26c — all DORMANT behind two independent flags. €0 LLM spend: nothing in
this WP needed a live model, so the planned €5 / capped €10 was never touched. Zero prompt bytes, zero pricing
change, no DDL.**

**Owner read-back this session (in-chat):** safelist re-read aloud, approved UNCHANGED; take-path **A2** chosen
over ADR-024's A1; **WP26c in scope** (severable); **#132 route B: "nog niet, later beslissen"** — the row still
awaits an explicit GO, and `forks_count` was measured **0** today, so the T-0 condition holds. **Re-ask #132 next
session.**

**Shipped (each with the full verification block + its own /code-review LOW pass):**
(1) **Mechanism A** `8ee71c8` (CI 30117971427 green) — clarification options carry a dry-run-verified intent; a
reply byte-equal to an offered label resolves deterministically with ZERO LLM calls, composed via the template
rung. Chips reuse the existing suggestions surface (#75 handler unchanged). Flag `CLARIFY_CLICK_ENABLED`.
(2) **B-region** `37a3c55` (CI 30119491343 green) — no place named on a measure with a national row → the
national figure, disclosed + correctable. ADR 024's flagged assumption was MEASURED: both geo tables have the
NL01 row. The existence check runs per-measure every time; without a row it still clarifies (pinned).
(3) **B-period** `1a99b3d` — no period signal → a bounded recent trend, **walked** backwards so gaps SHORTEN the
window instead of causing a refusal (this replaces the brief's let-completeness-refuse design, which would have
manufactured dead ends). Flag `ANSWER_FIRST_ENABLED`, independent of A's.
(4) **WP26c** `1a4ca89` — the two MEASURED trial misfires ("Wat was de inflatie in juni 2026?" → forecast; "Wat is
het consumentenvertrouwen?" → meta) now carry ONE deterministic rescue chip beside the unchanged, still-honest
refusal. Offered only when code proved the figure loaded and servable; taking it never re-enters the parse that
misfired. Rides A's flag.

**⚠ FOUND BY THE OWNER'S SANITY CHECK (2026-07-25, after the build): a ~6-minute PRODUCTION degradation.**
`/llms.txt` served its 503 fail-safe and the homepage Ontdek charts were omitted, because five deploys in
quick succession exhausted Supabase's free-tier **15-connection session pool**
(`EMAXCONNSESSION`). It SELF-HEALED; all routes verified 200 again, Ontdek back, llms.txt serving real
content. Both surfaces degraded exactly as designed — no stale or invented data — so this is CAPACITY, not
correctness. New [#173](open-questions.md) + a RUNBOOK section with a diagnosis recipe that works while the
pooler is full. **Note the CI post-deploy smoke passed: it runs ~10s after deploy, before instances stack —
a green smoke is not a claim about a minute later.**

**▶ NEXT, in order:** (a) the **owner-supervised go-live** of the two flags — NOT during a deploy burst
(#173: both mechanisms add DB work per request; `/llms.txt` = 200 is the cheapest go/no-go canary) — RUNBOOK section "WP26
answer-first + clickable options", one flag at a time with rollback + live smoke; (b) **~30/7 BBP+PPI syncs** — measured at CBS today: nothing was due yet (`85880NED` still on Modified 2026-07-01,
`85770NED` on 2026-06-30, both behind our 17/7 sync). `85880NED` MUST use the chunked escape hatch (RUNBOOK step
5); (d) **re-ask #132 route B**; (e) then the owner menu: WP30c choice / #162 / #170 rest (3)+(4).

**▶ DE VOLGENDE SESSIE IS EEN AUTONOME OVERNACHT-RUN.** Wachtrij + regels + de Fable-opdracht staan in
[session-briefs/2026-07-26-overnight-autonomous-queue.md](session-briefs/2026-07-26-overnight-autonomous-queue.md).
Kort: sessiemodel Opus 5 orkestreert, **architectuur en complexe analyses gaan naar Fable-agents**
(owner-steer 25-07), mechanisch legwork naar Sonnet/Haiku. Branch+PR per #118(b), €0 live-LLM, nul
promptbytes, geen DDL, vlaggen blijven UIT, en geen gestapelde deploys (#173). Slotfase: Fable
controleert de architectuur van WP26 + #154/#121/#138/#172-stap-0/#170.

Full session record in [status-archive.md](status-archive.md).)**

**Design marathon (2026-07-18 overnight, AUTONOMOUS docs-only — FABLE'S LAST SESSION before the model
switch; from now sessions run Opus/Sonnet (top model = Opus; the delegation cost-tier rule survives: the session model thinks, fan-out on
Sonnet/Haiku). SIX EXECUTE-READY DESIGNS delivered (commits `8ac0e59`→`ead1ead`, all `[skip ci]`, zero live-LLM spend / prompt bytes / DDL):
(1) [WP26 execute-brief](session-briefs/2026-07-19-wp26-execute-brief.md) — corpus-grounded, safelist read-back doc, NO live DDL needed
(jsonb confirmed), A2 take-path recommendation + WP26c forecast/meta rescue-chips (severable), plan €5/cap €10;
(2) [#162 slot-filling ADR-DRAFT](session-briefs/2026-07-19-adr-draft-slot-filling.md) — typed-slot contract + A/B meetopzet; measured:
compose fixtures are a SEPARATE hash domain, #162 does NOT trigger #164; (3) [#172 escalation
protocol](session-briefs/2026-07-19-172-escalation-protocol.md) — structural shortlist-walk fix FIRST, RerankProfile co-calibration,
separation-gap ≥0.05 ×4 as the go-number; (4) [#154 design](session-briefs/2026-07-19-154-design.md) — NULL-sentinel `last_seen_batch_id`,
migration-021 plan, flag-free; (5) [WP30c beslismemo](session-briefs/2026-07-19-wp30c-rijksfinancien-dossier.md) — BOTH candidates
live-scouted (rijksfinancien: begroot≠uitgegeven verified, Defensie 2023 18% gap, CC0, measured API bugs; politie: v3-on-dataderden
CONFIRMED, byte-identical period codes, CC0, `47013NED` first candidate), 4 framed options, choice stays the owner's;
(6) [small designs](session-briefs/2026-07-19-small-designs.md) — #138 (no owner question, ready), #121 (one-line owner question +
uncaught-throw finding), 85792NED (bounded regionDimensionOverride + honest fallback). Phase 7 (#170 smalls build) deliberately SKIPPED —
capacity went to the full wrap-up; the smalls are the ready first build task. Kickoff for the first post-Fable session:
[session-briefs/2026-07-19-session-post-fable-kickoff.md](session-briefs/2026-07-19-session-post-fable-kickoff.md).
▶ NEXT: owner dates (22/7 06:30 sync `85773NED` generale; 23/7 06:30 sync `83693NED` julicijfer; ~30/7 BBP+PPI syncs — 85880NED via the
chunked escape hatch; #132 route B on/after 19/7), then the owner-decision stack — NOW WITH DESIGNS ON THE TABLE: WP26 (trial-conversion
stake; needs the safelist read-back + 2 read-back items), #170 smalls (sparring-approved, build-ready, branch+PR per #118(b) if
autonomous), WP30c (memo ready — 4 options), #172 (supervised WP, step-0 verify first), #154 (rider on any supervised window), #138
(ready, no question), #121 (one-line owner call), #162 (after WP26). Trial ops: pot was 23/25 at s52 close, `npm run trialpot:set`.
Outstanding owner clicks: GitHub Budgets (the 2026 gotcha), Resend free-confirm, optional Vercel Firewall rate-limit rule. Full session
record in [status-archive.md](status-archive.md).)**

**Session 54 (2026-07-18, owner-present — THE COVERAGE SPRINT'S TABLE SET IS COMPLETE: [#168](open-questions.md)
RESOLVED end-to-end. ALL NINE coverage tables are LIVE AND ANSWERING (the six #4-#9 joined #1-#3): PR #56 merged `5e3a8e2` → vocab batch
`49135ef` (10 canonical keys; prompt v6 = the deferred ADR-023 bare-'tot' fix + a grain-sibling tie-break rule SCOPED to named pairs after the
generic first wording broke B2 4/4; ONE #164 re-record over SIX calibration rounds — final gate intent 72/72 ×3 ZERO flips, conf min 0.92 /
median 0.95, followup 23/23, clarify 7/7, tablefinder 11/11 live + hermetic; three reasoned relabels with measured rationale; the B16
region_unknown options gap fixed — clarifications now carry choice labels) → live syncs ×6 (batches 19-24, 136,511 rows, 0 corrections, 0
quarantines — 85828NED's excludeMeasures proved itself live, no chunk hatch needed) + registry:apply (17 tables / 26 keys) AFTER verified
deploy + 10 LLM-free spot-checks ALL exact incl. the regional key (NL01 479.527 / Amsterdam 630.621 & 303.925). Measured LLM spend ~€10-12
(calibration loops multiply — NOT sub-euro; within the €25 cap). ⚠ NEW TRACKER [#172](open-questions.md): finder-chain regression
(bijstand-stock lost 37789ksz from the Haiku chain on a byte-identical prompt — upstream drift; the class is honest-but-undeliverable via
refuse+refund) + the measured-and-REVERTED Sonnet escalation (temperature-0 rejection + muddy confidence distribution; needs model+threshold
CO-calibration as its own supervised WP). Also this session: the BILL-SHOCK AUDIT (owner-asked): Vercel=hobby, Supabase=free, repo public,
Anthropic 2× hard-capped → surprise bill structurally impossible TODAY; RUNBOOK "Bill-shock protection" = the record + the Pro-upgrade
spend-cap rule; outstanding owner clicks: GitHub Budgets (the 2026 gotcha), Resend free-confirm, optional Vercel Firewall rate-limit rule.
The MODEL SWITCH the owner announced this day (Fable through 2026-07-19 only, then Opus/Sonnet) was executed as the overnight design
marathon — see the ▶ block above. Full entry in [status-archive.md](status-archive.md).)**

**Session 53 (2026-07-17→18, AUTONOMOUS — tables #4-#9 BUILT DORMANT on PR #56 per #118(b): measured on both platforms via 6 parallel
agents, CC11-CC31 frozen with explicit targets, the #167 probe caught 7 slice-empty Productie-measures, the `--catalog-add` finder-fixture
trap found and scheduled. Superseded same-day by session 54's go-live above; full entry in [status-archive.md](status-archive.md).)**

**Sparring session (2026-07-18, owner-present, parallel to the s54 build session — NO build, docs-only `203a371`/`fab0433`: competitive
teardown of nederlandinbeeld.org + aidscope.co.uk; verdienmodel doubt addressed (access ≠ answers) with a parked LLM-benchmark test
[#169](open-questions.md); four visibility smalls owner-approved [#170](open-questions.md); API/MCP + transparency + correlation ideas
parked with rationale [#171](open-questions.md); rijksfinancien.nl added as second-source candidate [#123](open-questions.md), DNB on the
long-term roadmap list. Architecture sketches + analysis in
[session-briefs/2026-07-18-sparring-competitive-analysis.md](session-briefs/2026-07-18-sparring-competitive-analysis.md) +
[…-parked-ideas-architecture-sketches.md](session-briefs/2026-07-18-parked-ideas-architecture-sketches.md). Priority stack UNTOUCHED —
#168 remains the single next owner-present build step. Full entry in [status-archive.md](status-archive.md).)**

**Session 52 (2026-07-17 — PRODUCT-AF DELIVERED: (a) "Ontdek Nederland in grafieken" LIVE on `/` (`752af59`, ADR
[035](decisions/035-homepage-discovery-charts.md)); (b) the #53 anonymous trial pot (`9317acb`, ADR [036](decisions/036-anonymous-trial-pot.md))
BUILT + supervised go-live RUN same day — THE TRIAL IS LIVE on `/` (pot 23/25 after smoke; ops via `npm run trialpot:set`). ⚠ WP26 stake
raised: both casual smoke phrasings drew honest conservative refusals — trial conversion now leans on WP26. Full entry in
[status-archive.md](status-archive.md).)**

**Session 51 (2026-07-17 — the PRODUCT-FINISH pivot: papier-en-inkt huisstijl + public landing on `/` + all surfaces restyled, live
`4dc5273`; #98 resolved (homepage = the product's face); #53 owner refinements recorded (trial ON the homepage, empty-pot fail-safe, two
belts). Full entry in [status-archive.md](status-archive.md).)**

**Session 50 (2026-07-17 — sprint tables #2 `85880NED` (FULL ingest) + #3 `85770NED` DONE END-TO-END + LIVE (build `57be40a`; all six frozen
cells LLM-free exact on prod); PRs #54/#55 reviewed + merged incl. the 12-finding parallel max-review dispatch `c7f6063`; #167 phantom-measure
exclusion mechanism; slow-stream escape hatch (chunked capture + sync-from-capture — needed for every 85880NED release-day sync); ONE #164
re-record (62/63 + ×3, os-v02 deliberately re-labelled, r-autos live-unstable but gate-deterministic). Full entry in
[status-archive.md](status-archive.md).)**

**Session 49 (2026-07-17 — coverage-sprint table #1 `83693NED` DONE END-TO-END + LIVE (build `c4134bc`, sync batch 15, registry:apply 9/11,
#165 trim 115/115, LLM-free verify −39); sprint-wide finds #164/#165/#166 recorded; #118 code-review-LOW governance addition `09b6191`;
overnight addendum: PR #54 (#166 guard) + PR #55 (table #3 prep) built awaiting review, tables #2-#9 measured (specs doc), "80590NED v3-only"
REFUTED, table #2 descoped pending the slice decision (since resolved s50). Parallel review session same day: PR #54 max-review 12 findings
(dispatched s50), dependabot #51-#53 merged, #53 deploy-red → TS ^5 pin `eec3973`. Full entries in [status-archive.md](status-archive.md).)**

**Session 48 (2026-07-17 — the parallel owner-"spar" strategy session, docs-only: ELEVEN owner decisions #153-upd/#158–#163 + the #118
standing-push revision; #153 proefrit executed (wbn.nl ❌ −4% claimed vs +13,7% CBS-measured); coverage sprint scouted + briefed (8 gap tables,
two load-bearing finds: no full-gemeente price index anywhere [CONFIRMED s49]; "80590NED is v3-only" [REFUTED s49 overnight — v4 works with the lowercase id, docs/07 quirk #1]). Full entry in [status-archive.md](status-archive.md).)**

**Session 47 (2026-07-16→17 — THREE adversarial security/data-integrity hunts (each 4-6 lenses, dual-verified, Sonnet
fan-out) + a frontend-render scout. THREE fixes merged+live, each on an EXPLICIT owner word (#118b). (1) BILLING/MONEY-PATH: NO live credit-
conservation bug; one reachable-today gap FIXED ([#145], PR #48 `7e42656`) — `guardPending` bounds the untrusted reply-turn `pending`. (2) GDPR-
REDACTION: a real HIGH leak the inline scout MISSED — `pending_table_requests.fit_note` (LLM sentence paraphrasing the question) + topic-disclosing
table-ids survived erasure; FIXED ([#151], PR #49 `af287e1`; fit_note all rows, table-ids terminal only). (3) INGESTION/DATA-INTEGRITY: quarantine
ENFORCEMENT on the value path is airtight (`resolve.ts:306` refuses a needs_review table before any cell is served); two hardenings FIXED ([#155]
freshestForCanonical status gate + [#156] one validated dimension set per sync, PR #50 `b654010`). CLEAN lenses: money-conservation, cross-user,
derived-surface, frontend XSS/injection. Tracked NOT built: [#146] Stripe payment_status (dormant, card-only; RUNBOOK pre-delayed-method gate added),
[#147]-[#150] billing low/latent, [#152] feedback insert-race (self-healing), [#154] retained-cell false-fresh date (MEDIUM-HIGH, a DESIGN WP — the
finder's batch_id sketch is flawed), [#157] a/b deliberately dropped. ⚠ [#151] is FORWARD-ONLY: pre-deploy prod rows keep unredacted fit_note/table-
ids until a purge/re-deletion — a one-off backfill is a supervised step. See open-questions #145-157.)**

**Session 46 (2026-07-16 — #144 DONE END-TO-END in ONE session:** built + adversarially reviewed + merged (PR #47, squash `94b90e4`, owner in-chat
approval per #118(b)) + the supervised go-live EXECUTED (calibration, fail-open+admin-alert decision, flag flip, live smoke). The semantic checker is
LIVE and ACTIVE in production; the whole session-44 data-integrity hunt list is now CLOSED.)

- **#144 — the semantic fabrication check — ✅ DONE END-TO-END (ADR [034](decisions/034-semantic-fabrication-check.md); PR
  PR #47 squash `94b90e4` + go-live commits `8eef383`/`deabbfb`; all gates + deploys green,
  prod HTTP 307).** The additive REJECT-ONLY cheap-tier LLM checker over validated bodies that leaned on a residual-prone exemption
  (`ClassifiedToken.soft`) — the shared close for the #140 (descriptor-echo) and #141 (temporal-marker+un-listed-noun) deterministic ceilings.
  Corpus-MEASURED scope (the brief's "most answers skip the call" assumption inverted: naive = 100% trigger on the 18 stored legit bodies →
  shipped = 0%, while both residual shapes still fire); a fabricated verdict takes the same R3 ladder (regenerate → template); verdict stored on
  the envelope, recorded-not-rederived, its SCOPE re-derived by R8 with tamper teeth; checker calls = `llm_calls` role `semantic_check`; wired on
  all three answer paths (question, reply, onboarding delivery). **Adversarial review (5 lenses × dual refute-verify + a SERIALIZED mutation
  probe, 26 agents, cheap tier): 1 CRITICAL confirmed with executed repro + closed same day (the date-form compound-noun bypass — "nog 31
  januari-meldingen extra" skipped the checker gate; DATE_FORM_AFTER now requires a year/punctuation after the month), 2 refuted-but-adopted
  hardenings (maxTokens scales with suspects; treat-as-data covers all payload fields), mutation probe 5/5 RED, flag-off byte-neutrality 0
  findings.** **Go-live (owner present): calibration run 1 (prompt v1) = 8/9 — FN on the month-compound case, the model fell into the SAME trap
  the code had; prompt v2 (teaches the DATE_FORM_AFTER rule) = 9/9 FP=0 FN=0 flips=0, also at --repeat=3; replay leg pins the calibrated behavior
  on the gate (`tests/answer/semantic-check-replay.test.ts`, commit `8eef383`). Owner decisions in-chat: merge ✓; FAIL-OPEN + ADMIN ALERT per
  skip (`src/answer/audit/alerts.ts` → e-mail via Resend to ADMIN_ALERT_EMAIL with audit row/user/question/error/meaning, console.error as the
  floor; SEMANTIC_CHECK_FAILMODE deliberately unset). Env flags set via vercel CLI; the flip-deploy (`deabbfb`, run 29513127181) gate+deploy ✓;
  live smoke: owner question → audit row 253 carries `skipped_no_suspects` (prompt v2, ZERO extra LLM calls), pre-#144 row 252 has no key (A1),
  `npm run audit:verify -- 253 253` exit 0.** Merge-block verification: backend 1333/1333, web 314/314 (solo re-run; 2 parallel-load flakes),
  benchmark 14/14 + 6/6 + 0 fabricated, real next build, `audit:verify -- 1 252` exit 0 (225/227 + the 2 pre-existing pinned divergences).

**Session 45 (2026-07-16, THREE PRs merged + LIVE, all data-integrity; full entries in [status-archive.md](status-archive.md)):** #141 HIGH
period-exemption hole (PR #44 `d192775`), the #142/#143/row-227 trio (PR #45 `6291dfc`), format.ts raw-NUL cleanup (PR #46 `f909e66`); merges
that session in-chat DELEGATED (#118(b) precedent — NOT automatically renewed; session 46 asked and received explicit per-merge approval);
the #144 design brief was written there and executed by session 46.

**Session 44 (2026-07-13 → 2026-07-16, 3 PRs merged: #134(b) too-old retry chip PR #41 `12518eb`, auth/ownership hunt CLEAN + open-redirect fix
PR #42 `4e2a2fd`, the #140 validator narrowing PR #43 `882c808`; full entries in [status-archive.md](status-archive.md)).**

- **Next — the coverage sprint ([#163](open-questions.md)(3), owner-approved 2026-07-17):** build order, validated slices and caveats in
  [session-briefs/2026-07-17-coverage-sprint-brief.md](session-briefs/2026-07-17-coverage-sprint-brief.md); per-table measured record in
  [11-coverage-table-set.md](11-coverage-table-set.md). **Table #1 `83693NED` ✅ DONE + LIVE (session 49); next = #2 `85880NED` + #3 `85770NED`
  before 30/7 as ONE batch (#164 re-record constraint).**
  **Fresh hunts are PAUSED per #163(1)** — un-hunted surfaces (auth/session-flow, answer-composition/LLM-harness) stay listed for when hunts
  resume. Tracked follow-ups #146-150 + #152 low/latent; #151 backfill sweep = supervised; #154 = a design WP, owner's call on priority.
- **Next — owner decisions (queue behind the sprint per #163) — every item below now has an execute-ready design from the 2026-07-18
  overnight marathon (see the ▶ block above for links):** **#138 ✅ DONE + LIVE (session 55, `f2d015a` — off this menu)**, **WP26**
  (execute-brief ready — safelist read-back + 2 read-back items), **#121** (one-line owner question), **#131** (multilingual L1 — no
  design yet), **WP30c** (beslismemo ready, 4 options), **#162** (ADR-draft ready — after WP26). Tracked-not-focus: #132 route B
  ~2026-07-19 (check on/after 19 juli), #104/#112 (need live-LLM spend). (The /login header cosmetic that used to be
  listed here was FIXED 2026-07-24, session 55 — see the ▶ block.)


**▶ TOP PRIORITY STACK — owner decision, session 23 (2026-07-05); this ORDER overrides the "decision-gated" framing below.** The owner set an explicit
sequence; everything else queues behind it:
0. **✅ DONE + live-verified on production (2026-07-05): GDPR retention purge + self-service deletion (#14).** `npm run gdpr:purge` + a "Verwijder mijn
   vraaggeschiedenis" button, both **redact** the content (question + answer + the topic columns gone; the financial skeleton stays — a
   `credit_transactions` FK blocks a real row-DELETE). Reviewed + committed (`6aafb40`); 715 backend + 135 web tests green. The purge ran clean on
   prod (0 rows — nothing is 2 years old yet); ongoing retention = the monthly maintenance session — **which did NOT list the purge on its agenda until 2026-07-25 ([#189](open-questions.md)); it does now, and nothing else schedules it.** Owner confirmed the redact-and-retain posture.
   *Full detail: the session entry in [status-archive.md](status-archive.md) + the #14 section in [08-build-plan.md](08-build-plan.md). ([#59](open-questions.md) — the separate
   account-deletion FK tension — stays open; #14 does not touch it.)*
1. **On-demand CBS fetch when data is missing — WP16.** If a question needs data not in our DB, fetch the CBS table via API → verify → store → answer,
   with *"je tabel wordt voorbereid"* wait-messaging (email + dashboard "wordt aan gewerkt"). Was Phase 2-3, now **#1, the biggest build.
   Execute-ready brief in [08-build-plan.md](08-build-plan.md); Fable-authorized on the hard sub-parts (owner).** **Sub-part 1 (table discovery) — ✅
   HERMETIC FOUNDATION BUILT (session 24, 2026-07-05), full gate green; design + the Fable judgment in ADR
   [025](decisions/025-cbs-catalog-table-discovery.md).** Shipped hermetically (€0 spend, no live DDL): a `cbs_catalog` mirror (migration 011) + Dutch
   FTS (verified on PGlite), `CbsSource.fetchCatalog()`, and `src/catalog/` = ingest + Stage-1 FTS recall + Stage-2 rerank (hard allowlist,
   `TABLE_RERANK_MODEL='claude-haiku-4-5'`) + the `findTable` router (confident/disclose/none). **The Fable answer (owner asked): topic→table does NOT
   earn Fable in v1** — a closed shortlist multiple-choice with a hard allowlist, safer structurally than by model size; one named constant with a
   recorded Haiku→Sonnet→Fable escalation ladder gated on a measured miss. **Sub-part 1 supervised live step — ✅ DONE (session 25, owner present):**
   migration 011 applied to prod (grants/RLS live-confirmed locked by inheritance — 0 anon/authenticated grants, RLS on, 0 policies); real
   `catalog:refresh` mirrored 4,858 rows; `tablefinder:record` run live (Haiku) → `DEFAULT_FIND_TABLE_CONFIG.highConfidence` **calibrated to 0.8**
   (confident floor 0.85 measured/stable, failure-safe = disclose) + an end-to-end replay test now on the gate (`tests/catalog/find-replay.test.ts`,
   8/8 hermetic); 3 finder misses fixed (1 mislabel zonnepanelen→85004NED + 2 alias recall gaps) → 8/8. **Residual — ✅ CLOSED session 31 (WP27 stage
   A, PR #17):** the labelled set now has a disclose-expected case (`inkomen-vaag`) and the confident/disclose boundary is directly measured
   ([#104](open-questions.md)). **WP16 sub-part 2 — ✅ LIVE IN PRODUCTION (go-live session 28, 2026-07-06, owner-supervised).** On-demand CBS fetch
   works end to end; both paths verified live (delivered: consumentenvertrouwen→CBS `83694NED`, −24, full CC BY attribution, 100 credits kept;
   unanswerable+refund: bijstand → `85615NED`, ledger compensation +100). A go-live proxy bug was caught pre-flight + fixed (`42b275b`). **➡ Both
   go-live follow-ups are DONE: #115 shipped sessions 28–29; #111 CLOSED via WP27 (sessions 31–33, ADR [027](decisions/027-finder-shape-fit-gate.md))
   — the bijstand question now ANSWERS live (stage-D acceptance test, session 33). See the session log in [status-archive.md](status-archive.md) for the records.** (Built session
   27: 888 backend tests, benchmark 14/14 + 6/6 + 0 fabricated, 154 web tests.) Full build detail in the WP16 section of
   [08-build-plan.md](08-build-plan.md); residuals [#111](open-questions.md) (delivery coverage: national single-dimension tables answer,
   geo/sub-coordinate refuse-and-refund) + [#112](open-questions.md) (extended-vocab prompt variant unmeasured). The original seam notes, for the
   record: **Seam precision (session-26 review): that seam is TWO structurally different exits, not one** — the `unmatchedMeasureTerm` parse exit
   carries free text and fits `findTable(topic)` directly (the live seam); the `runQuery`→`buildQueryRefusal`/`table_not_registered` branch has no
   free-text phrase left and needs its own adapter (and is effectively unreachable with the current hand-curated registry) — exact shapes in the WP16
   brief ([08-build-plan.md](08-build-plan.md)). Sub-part-2 design inputs logged as [#107](open-questions.md)–[#110](open-questions.md) (slice
   greediness, successor re-discovery, onboarding chip, data lifecycle/eviction — incl. the verified gap that `sync --all` is seed-bound, not
   registry-driven). **All four blocking decisions now LOCKED (session 26, ADR [026](decisions/026-on-demand-fetch-job-architecture.md)): Vercel Cron
   job engine, 100-credit pricing on the existing "heavy" tier, internal-consistency-only verification for v1, core-loop-only scope**
   (successor/chip/eviction deferred, except the one verified #110(a) registry-driven-refresh bug). **Ready for an execute build session — no further
   owner decisions needed to start the hermetic foundation** (mirrors sub-part 1: build + gate green first, live DDL + real spend in a separate
   supervised step after).
2. **New data sources beyond CBS** (likely API-based). **▶ ARCHITECTURE DESIGNED (session 30, 2026-07-08, owner-steered
   source-neutral/Nederland-scope): ADR [030](decisions/030-multi-source-architecture.md) + [audit
   dossier](session-briefs/2026-07-08-multi-source-dossier.md); build = WP30 in [08-build-plan.md](08-build-plan.md), after WP27; the concrete first
   source is an OPEN owner decision (WP30c).** Broadens the public claim from "official CBS cell" to "official sources" (CLAUDE.md needs a matching
   update) and likely triggers the ADR 001 Python split.
3. **Answer/question-quality optimization on the widened data base** — re-run the experience audit + ship the clarify-policy fix (**WP26 ✅ BUILT session 56, dormant behind two flags — only the supervised flip remains; the "tier-3, after the data work" sequencing below is historical**,
   ready but after the data work).

*Grounded in the session-23 experience audit (110 questions, live, measured): 40 answer / 32 clarification / 38 refusal; **20 of 56 answerable
questions did not just answer**, and **all 14 out-of-coverage questions hit the wall** — the coverage wall (1/2) is a bigger lever than the
clarify-policy (3) alone.*

**Current phase:** Phase 0 complete; **WP21 (CSV export #52) + WP22 (live-feedback smalls #95/#96a/#97a) + WP23 (display smalls
#84/#86/#90/#91/#92/#71/#75) all shipped 2026-07-05, session 22 overnight**, **#14 GDPR retention + self-service deletion shipped 2026-07-05
(code-only/hermetic session, item 0 above)** on top of the #77 fix (session 21, ADR [023](decisions/023-explicit-date-range-parsing.md)), WP19+WP20
(session 20), WP18/WP17 and the live-verified end-user flow — **next follows the TOP PRIORITY STACK above (GDPR #14 done → WP16 → new sources → WP26),
NOT the old "decision-gated" framing:** the session-22 wrap-up items (#98/#99 site shell, #96b, #97b, #53) and the **#65 error logging** brief
([08-build-plan.md](08-build-plan.md)) are real open items but no longer the front of the queue; anonymous-trial [#53] has its full brief (the
session-19 owner-delegated order is complete), **plus a large decided-but-unbuilt backlog — everything below is owner-confirmed, no priority order
implied:**
  - **Bug-shaped, from live testing:** explicit multi-period/multi-region auto-display ([#64](open-questions.md)); durable error logging beyond
    Vercel's short retention ([#65](open-questions.md))
  - **WP16, demand-driven table onboarding:** now owner-confirmed wanted, with its user-facing copy and "costs credits" pricing decided
    ([08-build-plan.md](08-build-plan.md), [#24](open-questions.md))
  - **Clarification UX — one WP (WP26), designed session 23 (ADR [024](decisions/024-answer-first-defaults-and-clickable-options.md)), ✅ BUILT session 56 and DORMANT behind two flags; the text below describes the design as it awaited
    owner read-back of the safelist + a supervised build:** clickable pre-verified suggestion buttons ([#66](open-questions.md)/Mechanism A) +
    smart-default-with-escape-hatch on the narrow safe set instead of always clarifying ([#72](open-questions.md)/Mechanism B) — the two root causes
    of the "paid dead-end" (net 10 credits for nothing), zero prompt bytes, pricing deferred ([#101](open-questions.md))
  - **Dashboard polish — ✅ all four built in WP19 (session 20, entry in [status-archive.md](status-archive.md)):** collapse a clarification round into one history item
    ([#67](open-questions.md)); live balance updates instead of only-on-reload ([#68](open-questions.md)); low-balance warning banner
    ([#69](open-questions.md)); a brief credits-economy explainer under the "Credits kopen" button ([#76](open-questions.md))
  - **"Next-level" UX ideas, all owner-approved:** clickable source-attribution drill-through ([#70](open-questions.md)); a visual "voorlopig" badge
    ([#71](open-questions.md)); follow-up suggestion chips under an answer ([#73](open-questions.md)); a live status panel for pending WP16 onboarding
    requests ([#74](open-questions.md)); example-question chips on an empty chat ([#75](open-questions.md))
  - **GDPR:** [#14](open-questions.md) question-log retention — **✅ built** (2026-07-05, code-only/hermetic session): 2-year purge CLI + self-service
    deletion, both via redaction (see item 0 above). Live purge run against production is still outstanding, owner-supervised, whenever a maintenance
    window opens.
  - **Second creative-brainstorm batch (2026-07-05, owner-filtered, rows [#78–#93](open-questions.md)):** top-5 = citation-copy button (#78), "bewijs
    dit cijfer" audit exposure (#79, brief first — merge with #70/#90), stat card + PNG download (#80), revision-risk gauge (#81, LARGE — needs
    revision statistics, brief with #88), pre-send cost transparency (#82); plus batch questions (#83), message-type styling (#84), honest
    waiting-steps (#85, real steps blocked on the ADR 018 streaming seam), CBS deep-link (#86), historical-range chip (#87, real R5 derivation),
    revision awareness (#88), "waarom dit antwoord" (#89), source chip (#90), number typography (#91), chart-footer rearrangement (#92); **three ideas
    explicitly REJECTED by the owner (#93: watch-list, pattern-encoding, comparison card)**. Owner authorized immediate execution alongside recording
    — **the three small top-5 items (#78/#80/#82) were built the same day as WP20 (session 20, entry in [status-archive.md](status-archive.md))**;
    CSV export [#52] stays next in the standing order after that
  
  **KvK is deliberately parked until the website is finished (owner decision 2026-07-04, [#54](open-questions.md)) — do not raise it as a next step.**

## Phase 0 checklist

- [x] Open questions #10, #18, #20 answered by Stefan (2026-07-02 — see [open-questions.md](open-questions.md))
- [x] Doc-set sign-off by Stefan (2026-07-02)
- [x] CBS table set chosen; IDs validated against the live catalog (2026-07-02, open-questions #1 resolved — 8 tables, all v4-reachable, every
      benchmark period confirmed present: [07-phase0-table-set.md](07-phase0-table-set.md))
- [x] Benchmark answer key frozen (2026-07-03: [benchmark/answer-key.json](../benchmark/answer-key.json) — 14/14 answerable tasks + B20 freshness
      reference, values re-verified against the live ingest, not just copied from docs; [02-user-scenarios.md](02-user-scenarios.md), Scoring)
- [x] Ingestion + validation pipeline with fixture tests (2026-07-03: five ordered checks, quarantine, correction-diff log, idempotent syncs; the 10
      inherited `todo` obligations are now 21 real fixture tests + 8 adapter tests on an embedded real-Postgres test DB (ADR
      [009](decisions/009-hermetic-test-database.md)); adversarial review found and fixed 2 ordering/defaulting bugs; live ingest recorded above)
- [x] Table registry + alias list (2026-07-03: ADR [010](decisions/010-registry-canonical-measures.md);
      `cbs_tables.default_coordinates`/`.period_semantics` populated for all 8 tables, `canonical_measures` alias list seeded with 8 canonical
      concepts, applied live and idempotently; 14 hermetic tests incl. cross-checks against the frozen benchmark key)
- [x] Intent parsing (schema-validated, ranked candidates + confidence) (2026-07-03: `src/answer/intent/` per ADR
      [012](decisions/012-intent-parsing-llm-harness.md) — LLM emits registry vocabulary only, deterministic resolution to CBS codes, R7 thresholds
      calibrated at 0.9/0.35 against a 45-case labelled set, 45/45 measured live with zero flips over 3 repeats; CI replays committed LLM fixtures
      hermetically)
- [x] Deterministic query + validation + registered derivations (2026-07-03: `src/query/` per ADR [011](decisions/011-query-contract.md) — intent
      contract fixed for WP6, coordinate result-ids, registered derivations with CC BY marking, ten-kind refusal taxonomy incl. slice-vs-unpublished
      distinction and value-free freshness refusals; B1–B14 reproduce the frozen key + B20 refuses correctly, hermetically in CI)
- [x] Answer composition with verbatim/semantic/unit checks (2026-07-03: ADR [013](decisions/013-answer-composition.md) — `src/answer/compose/` +
      shared LLM harness; R1/R2/R3/R4/R5/R9/R10/R11 answer-side invariant tests real; B1–B14 end-to-end hermetic in CI with zero fabricated numbers;
      14/14 measured live, prompt v3, zero template fallbacks)
- [x] Chart spec + dumb renderer (2026-07-03: `src/chart/` per ADR [014](decisions/014-chart-spec-v1-and-renderer.md) — versioned zod-validated
      ChartSpec v1 built deterministically from validated results, pure dependency-free SVG renderer, R6 real; B4/B8 line charts reproduce the frozen
      key hermetically in CI; Recharts client wrapper deferred to the chat-UI session per ADR 014)
- [x] Refusal & clarification behavior (2026-07-03: ADR [015](decisions/015-refusal-clarification-composition.md) — `src/answer/respond/`
      deterministic templates + one-round clarify-reply merge; B15–B20 6/6 hermetic in CI; staleness both branches clock-injected; clarify-reply
      calibrated live 7/7, zero flips ×3)
- [x] Audit record per answer (R8) (2026-07-03: ADR [016](decisions/016-audit-records.md) — migration 004 `audit_answers`, one row per
      answer/refusal/clarification written before the response returns, fail-closed on audit failure; `reconstructionReport` re-verifies every row
      from the stored row alone with tamper tests proving teeth; benchmark scorer reads audit records: hermetic run/score pair in CI, gate PASS
      measured 14/14 + 6/6 + 0 fabricated)
- [x] CI gate live (2026-07-02): GitHub Actions runs typecheck + the eight gate suites + the benchmark run/score pair on every push. State after WP10
      (2026-07-03): **432 real tests + 0 todos** — the query suite scores B1–B14 against the frozen key (hand-authored intents), the answer suite
      drives B1–B14 **and B15–B20 plus the clarification round** end-to-end over replayed intent/answer/clarify fixtures (ADR
      [012](decisions/012-intent-parsing-llm-harness.md)/[013](decisions/013-answer-composition.md)/[015](decisions/015-refusal-clarification-composition.md)),
      the chart suite proves B4/B8 line charts against the frozen key, the audit suite proves R8 (rows reconstruct, fail-closed, tamper detection),
      and `benchmark:run`+`benchmark:score` produce and score the full 20-task run from audit records (a missing dump is a CI failure) — still no
      secrets and no network. After WP11 (2026-07-03): **445 real tests** — the benchmark suite gained the scorer-teeth tests, which score tampered
      dumps through the real scorer subprocess and pin every docs/03 gate leg (both sides of the ≥12/14 boundary, 6/6, zero-fabricated, the
      fail-closed duplicate-id/missing-dump guards). **After WP12 (2026-07-04): `gate` job also runs `web/`'s own typecheck + 6-test suite; a second
      job, `deploy`, is gated on `gate` via `needs:` and is the only thing that ever deploys (Vercel git integration deliberately not connected) —
      deploy-blocking-on-red is live, not just planned.**
- [x] Provider spend caps, billing alerts, and dependency alerts set (complete 2026-07-04: Anthropic €25/mo spend cap confirmed set 2026-07-02;
      **Anthropic billing alert confirmed set by the owner 2026-07-04** (RUNBOOK step done); **dependency alerts complete** 2026-07-03 — weekly
      grouped version-update PRs via `.github/dependabot.yml`, Dependabot *security alerts* enabled by the owner (verified via the GitHub API,
      `/vulnerability-alerts` → 204), Dependabot *security-update PRs* enabled via the API in WP11 (`/automated-security-fixes` → `enabled: true`);
      web/'s own independent lockfile got a matching second Dependabot entry in WP12)
- [x] Full benchmark run recorded below (2026-07-03, WP11: live run through the audited pipeline — gate criteria measured PASS, see scoreboard;
      provenance in [benchmark/live-benchmark-report.json](../benchmark/live-benchmark-report.json), policy in ADR
      [017](decisions/017-live-benchmark-run.md))
- [x] Minimal chat UI + first deploy (2026-07-04, WP12: [web/](../web/) — Next.js App Router chat UI over the audited entry points, Recharts wrapper
      over ChartSpec v1, CI-gated Vercel deploy; ADR [018](decisions/018-chat-ui-and-deploy.md). **Live at https://checkdecijfers.vercel.app** — all
      four `ComposedResponse` kinds (answer, chart, clarify-then-refusal, direct refusal) measured working against the real deployment)

## Benchmark scoreboard

| Date | Answerable (of 14) | Refusal (of 6) | Fabricated numbers | Median response | Gate verdict |
|---|---|---|---|---|---|
| 2026-07-03 (live, WP11) | **14/14** | **6/6** | **0** | 6,465 ms (all 20 first turns; answerable-only 7,289 ms) | **PASS** |

Gate: ≥12/14 answerable, 6/6 refusal, **zero** fabricated numbers ([03-mvp-scope.md](03-mvp-scope.md)). Also reported, informational: median latency,
clarification count on B1–B14, template-fallback count, un-disambiguated phrasing check ([02-user-scenarios.md](02-user-scenarios.md), Scoring).


## Phase history

| Phase | Status | Gate result |
|---|---|---|
| Docs / discovery | ✅ complete (2026-07-02) | — |
| Phase 0 | ✅ complete (started 2026-07-02, closed 2026-07-04) | **PASS** — criteria measured 2026-07-03 (live run, see scoreboard row + [benchmark/live-benchmark-report.json](../benchmark/live-benchmark-report.json)); owner (Stefan) signed off in session, 2026-07-04; WP12 (chat UI + deploy) closed the checklist 2026-07-04 |
| Phase 1 | — | — |
| Phase 2 | — | — |
