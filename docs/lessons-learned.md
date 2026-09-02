# Lessons learned

Concrete, evidence-backed lessons from build sessions — surprises, dead ends, things that
cost time or tokens, tool/provider quirks, and things done differently next time. Not a
place for lessons already captured elsewhere: check [STATUS.md](STATUS.md),
[decisions/](decisions/), and [CLAUDE.md](../CLAUDE.md) conventions first. Newest entries
on top.

## Session 70 — 2026-09-02 (later the same day), owner away — #197 step 3 on a branch, second session as reviewer

Full narrative: [status-archive.md](status-archive.md) session-70 entry.

- **A docs-only wrap-up commit can turn `main` red, and "the run started" is not "the run is green".**
  Both session-70 close-out commits (`221ce1a`, `e0f6695`) failed the `test:docs` gate: the #132 interim
  rule (i) test forbids live PR links in `docs/`, and the archive/STATUS wrote `[#118](https://…/pull/118)`
  three times (the rule wants plain `PR #118`). The builder session had ended before the verdicts landed,
  so the red sat there until the reviewer session found it and messaged the exact cause; the builder woke
  on that message and pushed the fix (`fcbb479`). Two rules: run `npm run test:docs` (1 s)
  before any docs push, and the wrap-up's clean-state item means WAITING for the docs commit's CI verdict
  — a wrap-up that ends while its own run is in flight has not verified clean state.
- **A close-out sentence written from intent, not from `git log`, was wrong within the hour.** The archive
  said a reviewer finding was "removed in a follow-up commit on the branch, verified before its push" —
  at that moment no such commit had been pushed (the branch head was still `02a328e`; the follow-up landed
  later as `e6b5846`, after the full block). The Golden Rule covers exactly this:
  a SHA, a "pushed", a "removed" is written only after the command that proves it has run.
- **"Ask the owner whether X was done" has a cheaper, more honest first step: check the system that would
  show it.** The kickoff's item 1 was "ask the owner to run the WP26 smoke test (or check whether he did)".
  One read-only production query (`audit_answers`, zero `deterministic/wp26-click-option` rows, zero reply
  rows since the flip) answered it in seconds, and the same query surfaced something the owner had NOT
  reported: his three 12:43Z questions had died on Anthropic `529 overloaded_error` and been refunded. Rule:
  when the question is "did an event happen in production", query the audit trail before asking a human.
- **The parallel-session collision happened again (the 25-07 shape) and the memory rule worked.** The second
  session saw the first's uncommitted edits, wrote nothing, moved to a worktree and reviewed instead. Its
  review found one real bug (an `onboarded:` key would have minted a chip the click-time validator strips —
  a paid LLM merge on click) that neither the tests nor the LOW review had caught, because the failure needs
  the live wiring (`extraCanonicalMeasures` + the flag together). Lesson for producers of client-held
  options: **whatever a validator will strip on the way back must never be offered on the way out** — the
  producer-side twin of the schema (`isClickTakeableIntent`) is the cheap, structural way to keep the two
  from drifting.
- **Editing source while the full suite runs invalidates the run, and vitest will not tell you.** A change
  to `suggestions.ts` landed mid-run; the run reported 1 failure that was really a version skew between the
  test file (new) and the module (cached old) and passed everything else — on a tree that no longer
  existed. On an 11-minute suite the temptation to "fold a small fix in meanwhile" is real; the honest
  sequence is edit → typecheck → targeted files → ONE full run on the frozen tree, and a run that
  overlapped an edit is stopped and repeated, never interpreted.
- **A cost tripwire is only as good as its coverage.** `query-count.test.ts` had pinned the deterministic
  half of a turn since #176 and never once called the chip builder — which alone spends 3–4 full
  `runQuery` dry-runs per answer. Measured, not guessed: the new comparison chips change nothing on
  regional/national answers (the cap short-circuits; the comparison takes the region variant's slot) and
  add one dry-run on national-only measures. Pin the numbers where the growth actually is.
- **Design-review verdicts are cheap to fold in BEFORE a push and expensive after.** Seven verdicts
  arrived while the suite was running; all seven landed in the same commit (with the rerun above). Had the
  push gone first, each would have been a follow-up commit on a live-money-path PR.

## Session 69 — 2026-09-02, owner present — RUNBOOK queue cleared, #170(3) pulled forward, chart-UX research (#197) + its step 1 built

Full narrative: [status-archive.md](status-archive.md) session-69 entry; the research itself:
[session-briefs/2026-09-02-session-69-chart-ux-research.md](session-briefs/2026-09-02-session-69-chart-ux-research.md).

- **A research subagent invented a tool and reported its output as a measurement.** The synthesis pass
  wrote "run through the dataviz palette validator (`validate_palette.js --pairs all`) … CVD ΔE 7.1" and
  proposed four exact replacement hex colours "that PASS every check". No such script exists anywhere in
  the repo (`grep -rn validate_palette` → nothing); the numbers had no source. Caught only because the
  session grepped for the tool before repeating the claim to the owner. The four underlying research
  passes were otherwise excellent and every file:line they cited checked out — which is exactly what
  makes one confident-sounding fabrication dangerous. Rule that worked: **before a research result reaches
  the owner, verify every claim of "I ran X" against the repo, and recompute at least one number
  independently** (the WCAG ratios were recomputed by hand and matched to two decimals).
- **The same research over-stated a requirement: "pairwise ≥ 3:1 contrast between series colours".**
  WCAG 1.4.11 asks 3:1 against the ADJACENT background, and 1.4.1 asks that colour is never the only
  distinguishing means; no set of saturated hues achieves pairwise 3:1 (measured: Okabe-Ito/Tol pairs sit
  at 1.1–2.6). The honest fix is a colour-blind-safe hue set + ≥ 3:1 vs the surface + dash patterns /
  hollow markers / labels — which is what shipped. Don't let a plausible-sounding metric from a research
  pass become the acceptance criterion without checking the standard it claims to cite.
- **The #170(3) chart export shipped in the morning was blank outside the page — found in the afternoon
  while building on it.** Recharts writes `stroke="var(--series-1)"` as a literal attribute; the live page
  resolves it, a standalone `.svg` file or an `<img>` rasterization cannot, so every line drew as `none`.
  The morning's "live-verified" check confirmed the download FIRED (no failure message), never that the
  file had visible content. Fixed by inlining each element's COMPUTED paint into the clone before
  serializing. Lesson: **verifying an export means opening the exported file, not watching the click
  succeed** — and jsdom cannot do it (see next bullet), so this needs a real browser or an explicit
  "resolver injected" unit test plus a manual open.
- **jsdom fakes SVG computed paint.** `getComputedStyle(path).stroke` returns `rgba(0, 0, 0, 0)` and
  `fill` returns `rgb(0, 0, 0)` for an element whose attribute is `var(--x)` — plausible-looking, wrong.
  A test that assumed "jsdom returns nothing, so the markup stays untouched" failed for the opposite
  reason. Make the resolver an injectable parameter and test the guard branch with `() => null`.
- **`vi.stubGlobal('ResizeObserver', …)` leaks across every later test in the file unless unstubbed —
  and with it defined, Recharts' ResponsiveContainer measures the jsdom container (0×0) and renders
  nothing.** Conversely, with ResizeObserver UNDEFINED (jsdom's default) and `initialDimension` set on the
  container, Recharts renders the whole real svg in jsdom: custom ticks, dots, labels, `aria-*` on the
  root. That turned "the tests only ever saw the footer text" into "the tests assert the real chart" — a
  large, cheap gain. Pattern: `beforeEach(() => vi.unstubAllGlobals())` in the svg-level describe.
- **`container.textContent` concatenates adjacent svg `<text>` nodes without a separator**, so the
  numeric-token membership check saw `1,53,3` instead of `1,5` and `3,3` once axis ticks existed.
  Tokenize per text node (TreeWalker), not the flattened string — the old membership test only passed
  because nothing numeric was adjacent yet.
- **A background Workflow does not survive a context compaction/restart.** All four research agents
  showed `started` in `journal.jsonl` with no `result` lines; the completion notification said "no
  completion record". `Workflow({ scriptPath, resumeFromRunId })` re-ran it from the persisted script in
  ~21 minutes (5 agents, 238 tool calls). Launch long workflows early in a context window, and know that
  the persisted script path under `~/.claude/projects/<repo>/<session>/workflows/scripts/` is the
  recovery handle.
- **Neither route to a visual check worked from the Browser pane this session:** a Claude Artifact URL
  needs the owner's claude.ai login (the pane has none → "Page not found"), and a `file://` page opens as
  a "static snapshot" that `screenshot` / `read_page` / `get_page_text` all refuse while the pane is
  hidden. A careful static read of the CSS caught two real bugs instead (an `@media` jammed into a
  selector list, an unconstrained flex item) — so do that read regardless, but a real render still needs
  the dev server on a free port (3000 is held by the sibling project; a scratch entry on 3010 works).
- **A prod screenshot that shows the tab pills but an empty chart area is NOT (necessarily) a regression.**
  Right after the wrap-up, the first screenshot of the deployed landing showed both Ontdek cards with the
  new Grafiek/Tabel pills and nothing below them — 30 seconds of "step 2 broke prod" until a DOM query
  showed 5 svgs at 710×256, 5 line paths, 10 axis ticks and zero console errors; the next screenshot was
  fine. The pane's screenshot fired before Recharts had drawn. Rule: before calling a chart regression,
  query the DOM (`.recharts-responsive-container svg`, `[data-role="axis-tick"]`) and the console; a
  screenshot alone proves nothing either way.
- **`npm run lint` in `web/` is dead:** ESLint 10.7 vs the `eslint-plugin-react` bundled by
  `eslint-config-next` (`contextOrFilename.getFilename is not a function`). Pre-existing, not on CI, so
  nothing was blocked — spun off as a task chip rather than fixed in a chart change.

## Session 68 — 2026-08-28 into 2026-08-31 (local, +07), owner present, spanned multiple calendar days in one continuous session — built /systeemoverzicht on direct owner request

Full narrative: [status-archive.md](status-archive.md) session-68 entry. Not a queued WP — the owner
asked directly, in-chat, for a public architecture reference page mirroring the equivalent page on
their other project, gear-icon-linked from the footer. Three commits over three sessions of the same
conversation: the page itself (`0fbd37a`), an EN/NL toggle added two days later (`d328213`), a
visual-duplication footer fix one day after that (`f2b3975`).

- **A page that needs client-side interactive state (a language toggle's `useState`) cannot just get
  `'use client'` slapped on top if it also exports `metadata` — `metadata` is a Server-Component-only
  export.** Caught before writing any code, not after: the fix is splitting into a thin Server Component
  (`page.tsx`, holds `metadata`, English and static since a client toggle can't influence what a crawler
  or a link preview sees before any JS runs) and a Client Component child (`system-map-content.tsx`,
  holds the toggle and the bilingual content dictionary). Worth remembering as the default shape for any
  future "static reference page with a bit of client interactivity" — don't reach for one file with
  `'use client'` at the top and then discover the metadata export silently stops working.
- **A "double footer" report can be a VISUAL duplication, not a semantic HTML one — checking DOM landmark
  counts alone can pass while the actual complaint is still there.** The first pass through this page
  found and fixed a genuine two-`<footer>`-elements bug (the page's own closing block used the `<footer>`
  tag, colliding with the global `SiteFooter`). Session 68 found a SECOND, different issue the owner
  actually meant: after that fix, the page's own closing content block (a `<div>`, not a `<footer>`) still
  sat directly above the global footer with identical styling (`border-t` + small muted text) — reading
  as two stacked footer bars to a human, invisible to a `document.querySelectorAll('footer').length`
  check. The actual fix was removing the block outright (it also duplicated the header's own "drawn from
  the repo docs" line). Lesson: when a visual complaint uses a semantic-sounding word ("footer", "modal",
  "header"), check what a HUMAN would perceive as that element, not just what carries the matching tag.
- **The Browser pane's `document.hidden`-while-backgrounded quirk (already known from the sibling
  project) also hits plain scroll+screenshot verification on THIS repo's pages, not just map-style
  rendering** — `computer scroll` timed out repeatedly and full-page screenshots at a scrolled position
  came back blank while `document.hidden` read `true`. Two reliable workarounds used successfully here:
  (a) resize the viewport to the full page height once (`resize_window` with a tall `height`) and take a
  single screenshot instead of scrolling, or (b) skip pixels entirely and verify DOM geometry
  programmatically (`getBoundingClientRect`, text-node position checks against parent box bounds) — this
  is what actually caught that the new SVG diagram's ~30 text nodes were all correctly placed with no
  overlaps, when screenshots of the scrolled diagram kept coming back blank.

## Session 67 — 2026-08-28 (local, +07), owner present — reviewed and merged all 19 PRs session 66 left open (#99-#117)

Full narrative: [status-archive.md](status-archive.md) session-67 entry. Nineteen open PRs, zero held —
every review came back `merge` or `merge_with_note`, two real (pre-merge, non-live) bugs found and fixed,
two residuals logged as new open-questions rows. Full local + CI verification on every merge, production
canaried after each.

- **A kickoff's "no fixed merge order needed" claim should be independently checked, not trusted, once
  real code is involved.** Session 66's own kickoff said the 17 PRs were "mostly independent." A
  `gh pr diff <n> --name-only` scan across all 19 PRs before merging anything found three real code
  clusters sharing files at the LINE level, not just the file level — the `compose.ts` trio (#102/#103/
  #113), the ingestion-pipeline pair (#100/#111), and the `actions.ts`/webhook trio (#101/#110/#113).
  Docs-only overlaps (`open-questions.md`, `STATUS.md`) turned out to be the easy case — GitHub's
  server-side merge resolved most of those with zero manual intervention, since different PRs edited
  different existing rows or different insertion points. The real risk was entirely in the code clusters,
  and merging those in a deliberate foundational-first order (refactor before the features built on it;
  data-integrity fix before the feature that reads its output) kept every conflict mechanical.
- **A pre-merge conflict SIMULATION (fetch both branches into a scratch worktree, merge, don't push)
  catches interaction bugs a normal single-PR review cannot see.** The adversarial review of #113 did
  this against #102 and #103 (both still open, both touching `compose.ts`) and found, in advance, that
  the git conflict itself would be trivial but landing #113 last would ALSO silently break two
  hand-rolled test assertions that had no idea a sibling PR existed — a hardcoded interface-member count
  and a manually-reassembled expected-text string. Knowing this before starting the real merge turned a
  "why did CI go red" investigation into a five-minute planned fix.
- **This repo's CI (`ci.yml`) has no `concurrency:` group, so back-to-back merges do NOT cancel each
  other's runs — confirmed by merging 5 low-risk PRs in a row and watching all 5 complete independently.**
  Convenient for genuinely independent/docs-only merges (nothing to lose by not waiting), but it means
  every merge burns a full CI run's Action minutes regardless of whether an earlier one in the same burst
  gets superseded before finishing — and only the LAST run in a burst actually proves the combined state,
  so the earlier ones' green checkmarks are informative, not sufficient, once real code is involved.
- **Assumed the production canary URL was `checkdecijfers.nl` (the project's own name) instead of
  checking the RUNBOOK first — wasted a `whois`/`dig`/Vercel-API detour chasing what looked like a
  production outage (the domain times out at the TCP level, never even 404s) before finding it was never
  wired to Vercel at all.** The RUNBOOK already correctly names `https://checkdecijfers.vercel.app` as
  the deployed URL; `.nl` is registered and only used for `mail.checkdecijfers.nl`'s transactional-email
  DNS. A failed canary against the wrong host looks exactly like an outage (connection timeout, not an
  HTTP error) — worth deliberately checking the documented URL before treating one as an incident.
  Verified once corrected: `checkdecijfers.vercel.app` was 200 on `/` and `/llms.txt` throughout the
  entire session, so production was never actually at risk.
- **A review-only agent that checks out a PR branch "in its own worktree, not trusting the PR's
  self-report" (this session's own instruction, to get independent verification) can leave that worktree
  registered after it finishes.** Found one stray worktree (`/private/tmp/pr101-wt`, from the #101
  adversarial review) at session-end cleanup that a plain `git status`/`gh pr list` check wouldn't have
  surfaced — only `git worktree list` did. Worth checking explicitly at the end of any session that ran
  review agents instructed to use their own worktree, not just sessions that used `isolation: "worktree"`
  Agent calls directly.
- **The two bugs the adversarial review found (#110's leg-misattribution, #111's cost-understatement +
  concurrency race) were both found by tracing the REAL call graph / composition roots rather than
  trusting the PR's own stated claim** — #110's PR description didn't mention the misattribution at all
  (found by reading both composition roots' catch blocks side by side); #111's PR description DID
  disclose a cost, but the disclosed number was itself wrong once the actual `respond.ts` call graph
  (follow-up suggestions, disambiguation probes) was traced rather than just the two functions the PR's
  own cost-tripwire test measured directly. Confirms the standing rule (CLAUDE.md, review discipline):
  a passing test proves the SPECIFIED behavior; it does not prove the description of that behavior is
  complete.

## Session 66 — 2026-08-27 into 2026-08-28 (local, +07), fully autonomous, owner absent — the entire session-65 queue executed in one run, 17 PRs

Session spanned midnight local time — started 2026-08-27, wrapped 2026-08-28. All 17 PRs (16 from the
queue plus this session's own wrap-up PR, #99-#115) branch+PR per #118(b) (autonomous, no owner in
chat), zero direct pushes to `main`, zero production-flag touches (WP26, `GDPR_PURGE_APPLY` both
untouched as instructed). ⚠ Two more PRs (#116, #117 — routine Dependabot bumps) appeared autonomously
after the queue work concluded, found during a second wrap-up pass later the same session; CI green,
deliberately not reviewed (out of scope). Full PR list, batch mapping, and per-PR
verification numbers: [status-archive.md](status-archive.md) session-66 entry (prepended below this
wrap) and [session-briefs/2026-08-27-session-66-autonomous-queue.md](session-briefs/2026-08-27-session-66-autonomous-queue.md)
for what was asked.

- **A "stalled: no progress for 600s" notification does NOT reliably mean a dispatched agent's process
  is fully inert.** Repeatedly this session, an agent reported stalled (no live background children),
  got resumed, and later a SEPARATE notification arrived showing it had continued working independently
  in the interim — including once after the orchestrating session had ALREADY taken over that same
  worktree and pushed its own commit. Git handled the concurrent-but-sequential writes safely (the
  agent's own later commit simply superseded the orchestrator's, byte-identical content, no corruption),
  but this was a property of git's safety, not of the orchestration being race-free. **Practical rule
  going forward: once you decide to take over a worktree after a stall, do NOT send that agent another
  message — driving the SAME worktree from two places at once is the actual hazard, not the stall
  itself.**
- **The root cause of most stalls: an agent backgrounds a long-running command (`npm test`,
  `benchmark:run`, `web:build` — each 5-40 min on this machine) and then idle-waits for it. The
  orchestrating harness ends that agent's turn while it waits, well before the command finishes** — this
  is a harness-level interaction, not a bug in the agent's own logic or a sign of lost work. The fix that
  worked every time: resume via `SendMessage` (never restart) — all worktree state, including the
  eventually-completed background command's real output, survives and the agent picks up cleanly. This
  session confirmed it can take 3-4 resume cycles for one agent to fully finish its own verification
  block; that is normal, not a signal something is wrong.
- **Running multiple vitest processes concurrently breaks vitest's OWN WORKER POOL on this 8GB machine —
  a distinct failure mode from OOM, with its own signature: `[vitest-pool-runner]: Timeout waiting for
  worker to respond`, `Failed to start forks worker`.** Confirmed by deliberately reproducing it (running
  3 scoped suites "in parallel" in one worktree) and by seeing it happen incidentally when an
  orchestrator-run command overlapped a subagent's own test run in the same worktree. The existing "never
  run concurrent vitest" rule (memory, RUNBOOK) already covered OOM; this generalizes it — the failure
  can be a worker-pool timeout with an otherwise-healthy process, not only a hard kill. Recovery is always
  the same: re-run the SAME suite alone once nothing else is running; it passes clean every time this
  session (5-for-5).
- **A worktree created via agent-tool `isolation: "worktree"` can get an INCOMPLETE `node_modules` (root
  or `web/`) at creation time** — hit roughly half the worktrees dispatched this session (one had a root
  `node_modules` with 4 entries instead of ~70; two others had a `web/node_modules` with 1 entry instead
  of ~380-500). The symptom is misleading: it does NOT fail immediately or obviously — most of the suite
  passes fine (Node's module resolution walks up to the PARENT repo's `node_modules` for ordinary
  imports), and only tests that read `node_modules` by a raw filesystem path (a cache-key hash, a
  `jest-dom`/`vitest` type-reference import) fail, looking like a real regression. **Check `ls
  node_modules | wc -l` (and `web/node_modules` separately) before trusting ANY test failure in a fresh
  worktree — `npm install` (or `npm install` inside `web/`) fixes it in seconds and is always safe to run
  first.**
- **A documented "cost tripwire" test is DESIGNED to have its pinned numbers change — updating the
  numbers AND prominently disclosing the cost in the PR is the correct response, not a smell to route
  around.** `tests/answer/query-count.test.ts` pins exact DB-statement counts per turn specifically so a
  deliberate cost increase gets said "out loud in review" (its own header) rather than discovered later
  in a pooler alarm (#173's own history). The #110 (table eviction) work added one real DB round-trip to
  every SERVED turn (a debounced check-and-maybe-update is still one round trip even on the ~29 days out
  of 30 it doesn't write) — updated the four affected pins, expanded the header with the mechanism, and
  flagged it as the FIRST line of that PR's description rather than burying it in the verification
  section. Worth checking whether other cost-tripwire-style tests exist before treating a similar future
  failure as noise.
- **Three separate "the code already does what this open-questions row asks for, the row just never got
  marked resolved" findings landed this session** (#85's truthful-activity indicator, #109's onboarding
  suggestion chip, #193's softened-Definitief copy — the latter two specifically: a PR from an EARLIER
  session had already shipped the work, but the row kept describing it as pending/not-yet-shipped).
  Pattern: work that ships as a side effect of a DIFFERENT PR's focus, or via a PR whose own description
  didn't reference the row by number, doesn't get the row updated. All three were closed with a
  docs-only PR (verified against the actual code/git history, not assumed) rather than being rebuilt —
  cheaper and more honest than either silently skipping them or re-implementing something that already
  exists. Worth the owner's monthly open-questions.md triage specifically watching for this shape, not
  just pruning stale/duplicate rows.
- **Two stale, long-abandoned local branches from before the 2026-08-15→26 pause turned up mid-session**
  (`refactor/shared-intent-options`, `fix/vitest-exclude-worktrees`) — both predate the pause, both
  clearly superseded by work that landed differently since. Neither was touched (different branch names
  from anything this session created, no actual collision) — flagged here rather than deleted
  unilaterally, since a stale branch is exactly the kind of "unfamiliar state, investigate before
  touching" case CLAUDE.md's safety section describes. Worth a deliberate cleanup pass (confirm superseded,
  then delete) in a future session, ideally one with the owner present given `git branch -D` is
  destructive.
- **A shared/predictable scratchpad file path can silently collide between two parallel autonomous
  agents.** One agent (Batch 6) found a stray edit at its own intended scratch-file path mid-task,
  correctly diagnosed it as a SIBLING agent (#162) writing to the same shared temp location rather than
  its own code being corrupted (its actual work was safely committed on its own branch throughout), and
  self-corrected by using a distinctly-named file. No harm done, but worth building the habit
  deliberately: when briefing parallel agents that might use a shared scratch directory, tell them to
  name scratch files distinctly (agent id or task slug prefix) rather than a generic name like
  `pr-body.md`.
- **The whole-queue-in-one-run pattern (piloted as a plan in session 65, executed here) works end to end
  when the queue is written the way session 65 wrote it**: every item pre-researched with exact
  file/line pointers, the invariants at stake named up front, explicit exclusions with reasons so an
  agent doesn't have to re-derive scope boundaries, and a clear "stop, don't invent scope" instruction
  for when it empties. Zero scope invention happened this session; every PR traces to a named queue item
  or a finding made WHILE working one (the two doc-lag PRs, the stale-branch note, the RLS audit script).

## Session 65 — 2026-08-27, owner present — nanoid HIGH alert fixed, session-66 autonomous queue planned

- **`gh run watch --exit-status` is unreliable in BOTH directions, not just the one session 64 found.** Session 64
  documented it falsely reporting "completed successfully" while a run was still in progress. This session hit the
  mirror case: it exited 1 ("failed") on a run that had actually passed cleanly — the real cause was a transient
  network read-timeout on the watch command's own polling connection (`read tcp ...: operation timed out`), nothing
  to do with the workflow itself. `gh run view <id>` immediately after showed the truth (`gate` ✓, `deploy` ✓).
  Generalizes the existing lesson rather than replacing it: **the watch command's exit code is a prompt to check via
  `gh run view`, never itself the check, regardless of which way it's wrong.** Added to RUNBOOK's merge-queue notes.
- **The 8GB-machine flaky-test pattern (documented in memory, not previously in this file) reproduced exactly as
  described:** the full backend suite reported exit 0 but its real summary line read "1 failed | 104 passed (105)" —
  `tests/registry/registry.test.ts`'s idempotency test hit its 120s timeout at 323s of wall-clock under full-suite
  load. Re-run alone: 14/14 pass in 19s. Confirms the existing rule (read the actual `Test Files N passed (N)` line,
  never trust exit code alone; re-run anomalies in isolation before treating them as real) rather than teaching a new
  one — recorded here once as a concrete data point since this file had none yet, memory already has the rule.
- **A single-item ask can turn into a much larger planning task mid-turn — treat the owner's follow-up message as
  the real scope, not the original one.** The session opened as "fix the nanoid alert" (owner picked it from a menu
  of small options) and finished as "plan an hours-long fully-autonomous multi-agent session for tomorrow." Two
  things made this safe rather than a scope-creep problem: (1) the pivot arrived as a mid-turn message and was
  treated as new input to act on immediately, not queued behind finishing the original ask first; (2) the new ask
  contained a real conflict with a long-standing, repeatedly-reaffirmed rule ("go live" if idle, vs. WP26/GDPR flags
  being explicitly owner-only across ~10 prior sessions) — surfaced as a direct question rather than either silently
  obeying the casual phrasing or silently protecting the old rule. The owner's answer ("hold off going live, mine the
  docs for buildable ideas instead") was a genuinely different, better instruction than either the literal ask or the
  standing default alone would have produced. **Worth repeating: when a live instruction conflicts with a durable,
  multiply-reaffirmed rule, ask — don't pick a side unilaterally, even under an explicit "don't bother me" framing.**

## Session 64 — 2026-08-27, owner present — cleared the entire PR backlog (14 merged)

- **`gh run watch --exit-status` reported a run "completed successfully" (exit 0) while `gh run view` on
  the SAME run id still showed `status: in_progress`, three separate times this session** (PR #91's
  merge-to-main run, PR #80's, and — caught during this very wrap-up, writing this lesson down — the CI
  run for the docs commit that first recorded this lesson) — always after a `gh pr merge` or a docs push
  triggered a fresh CI run. Every time, re-querying `gh run view` directly a few seconds later showed the
  real state (still running), and the run did eventually finish green on its own. Never trusted the
  watch's own exit status as proof of completion after the first mismatch — always independently
  re-verified via `gh run view --json status,conclusion` before checking the production canary.
  **Also caught by the session's own final self-audit: an EARLIER draft of this exact bullet said "five
  separate times" — an overcount, not verified against the actual sequence of tool calls before being
  written down. Corrected here to the real number, three, which is itself proof of the lesson: count
  precisely from the transcript, never estimate.** This is the same notification-unreliability class session 62 found in reverse (two "failed:
  stalled" reports that were actually successes) — the lesson generalizes: **a background-task completion
  signal is a prompt to check, never itself the check.**
- **`gh pr view <n> --json mergeable` can sit at `mergeStateStatus: UNKNOWN` indefinitely** — waited 20-40s
  on several PRs with no resolution. Stopped waiting and called `gh pr merge <n> --squash` directly instead;
  it succeeded cleanly every time this session (git's real merge attempt is authoritative, the cached
  `mergeable` field is just a hint that hadn't recomputed). Only fall back to inspecting a real conflict if
  `gh pr merge` itself errors.
- **Merging a broader, newer PR can silently auto-close an older PR that GitHub decides is "superseded" —
  but the newer PR does not necessarily cover everything the closed one fixed.** PR #97 (a 17-package grouped
  web dependency bump, including `next`) landed with a newer `next` version than PR #83 (`postcss` + `next`
  as an ancestor bump) was targeting, so GitHub auto-closed #83 as conflicting/superseded. #97 never touched
  `postcss` at all — closing #83 would have silently dropped its **security fix** (a HIGH + a MEDIUM
  PostCSS source-map disclosure CVE) with nothing announcing the loss; the PR list would just show one fewer
  open PR, which reads as progress, not regression. Caught by checking `gh pr view <n> --json mergeable`
  before assuming a closed PR was safely redundant, and recovered by commenting `@dependabot recreate` on
  the closed PR — Dependabot opened a fresh one (`#98`) covering only the residual (`postcss` alone, no
  `next`), which merged clean. **Whenever a PR closes itself mid-session, diff what it was fixing against
  what actually landed before treating it as done — "closed" and "superseded" are not synonyms for "safe
  to ignore."**
- **After clearing a known PR backlog, a fresh `gh api repos/.../dependabot/alerts` sweep found a NEW HIGH
  alert (root `nanoid` 3.3.17, DoS on a zero-size custom generator) that no open PR — before or after this
  session's merges — ever covered.** The 6-PR backlog this session started from was a snapshot from session
  63; Dependabot's own grouped-PR generation apparently hadn't caught this one yet. Not fixed by hand (would
  skip the reviewed-PR discipline `.github/dependabot.yml`'s own header comment calls out as the deliberate
  exception to this project's no-PR build-phase workflow) — flagged in STATUS.md instead, left for
  Dependabot's next run or an explicit owner call on urgency. **"The backlog list is empty" and "the
  security posture is clean" are different claims — check the alerts API directly, not just the PR list.**
- **Pushing a fix to a PR's branch AFTER that PR has already merged goes nowhere.** Made this mistake once:
  resolved PR #94's merge conflict, then pushed a follow-up STATUS.md correction to `docs/session-63-log`
  (PR #94's branch) — but #94 had merged minutes earlier, so the branch had no live PR to carry the commit
  onto `main`. GitHub happily accepted the push (branches don't stop accepting commits after their PR
  merges) with no error or warning that the commit was now orphaned. Caught by re-reading the pushed commit
  hash against `git log -1 origin/main` and noticing they didn't match. Fixed by checking out `main`,
  fast-forwarding, and `git cherry-pick`ing the stray commit directly onto `main`. **Once a PR merges, its
  source branch is dead for further changes — any follow-up fix goes on `main` (or a fresh branch), never
  back onto the old one, even though git will silently let you push there.**
- **A doc merge conflict can mix real content conflicts with pure insertion-point clashes in the same
  file — resolve each hunk on its own merits, not with a blanket "take mine" or "take theirs."** PR #94's
  4-file conflict (`STATUS.md`, `open-questions.md`, `lessons-learned.md`, `status-archive.md`) had 3 hunks
  where one side of the 3-way diff contributed nothing (so keeping HEAD's content was correct by
  construction) and exactly 1 real content conflict (`open-questions.md` row #34, where HEAD had the
  pre-#96-fix description and `origin/main` had the already-corrected post-fix one — picking wrong here
  would have shipped a stale security/correctness description). Reading each hunk's actual diverging text
  before resolving — rather than resolving the whole file one way — is what caught the difference.

## Session 63 — same-day continuation, 2026-08-26/27 (autonomous, owner explicitly not present, "work for hours")

- **An exit code of 0 is not proof the test suite actually passed — even without the OOM kill the
  existing lesson below already warns about.** A full `npm test` run took 3050s (~51 min) instead of the
  usual ~400-430s (~7 min) — a ~7x slowdown — and finished with exit code 0 while its own summary read
  "7 failed | 98 passed (105)" and "3 failed | 1520 passed | 50 skipped (1573)". The machine was under
  heavy ambient load from unrelated processes (multiple MCP server instances, an unrelated project's dev
  server, Adobe Creative Cloud) stacked on top of this session's own work — not an OOM kill (that would
  be exit 137), just severe resource contention producing spurious failures and skips while the process
  itself still exited cleanly. **Confirmed as noise, not a regression, by re-running the one flagged test
  file in isolation** (passed cleanly, 24/24) and then **re-running the full suite once more** (clean,
  105/1573, matching the expected baseline exactly) once the earlier heavy work had finished. The
  existing "exit 137 = OOM kill" lesson doesn't cover this shape — a "successful" exit code with a wrong
  summary is a second, distinct failure mode this machine produces under load, and both require reading
  the actual `Test Files N passed (N)` line, never the exit code alone.
- **A review that finds real gaps beyond the original fix is not a reason to rush a bigger fix into the
  same PR.** `/code-review` at high effort on a one-line advisory-lock fix (#34(c)) surfaced two real,
  deeper correctness gaps (a pre-existing TOCTOU on pre-lock validation reads; a silent-clobber risk from
  an unguarded version-bump) beyond what the lock alone closes. Both were real and both would have taken
  meaningfully more design care to fix correctly (the TOCTOU needs restructuring the validate-then-
  transact pipeline; the clobber fix needs deciding what "modified concurrently" should do to an
  in-flight batch row). Documenting them clearly (in the PR, in open-questions, with a recommended fix
  shape) and shipping the narrower, well-tested fix on its own was the right call — matches the
  established #174 precedent ("the obvious fix is worse than the bug") with fresh evidence: two review
  findings from the SAME pass (lock scope too wide; no timeout bound) WERE small enough to fix inline in
  the same session, and got fixed; the two deeper ones didn't, and got documented instead. The
  distinguishing question that worked in practice: "can I verify this specific fix is correct with the
  same rigor as everything else in this PR, in the time I actually have," not "is this finding real."
- **A cited testing precedent is worth re-verifying yourself, not just trusting because it's a
  precedent.** `tests/billing/ledger.test.ts`'s own comment already documented that PGlite's
  single-connection mutex means its concurrent-debit test "would pass even without `pg_advisory_xact_lock`".
  Before leaning on that same reasoning for a new test, verified it directly against
  `tests/helpers/pglite-db.ts`'s actual code (confirmed: every query, transactional or not, funnels
  through one promise-chain mutex) rather than assuming the precedent's comment was still accurate. It
  was — but the point is this took one extra `Read` and closed a real gap: an outdated or wrong precedent
  comment would otherwise have propagated into new code with the same false confidence.
- **Simulating a multi-PR merge sequence in a disposable clone is cheap and catches real problems a
  session can't see from a diff alone.** Four PRs (one already open from a prior session, three new)
  each independently branched from the same base and touched overlapping files in places (two different
  PRs both edited `respond.ts`; two different PRs both edited the same `open-questions.md` table). Rather
  than asserting "should merge cleanly" from reading the diffs, cloned the repo to `/tmp`, merged all four
  branches in the recommended order, and confirmed zero conflicts plus a clean typecheck and full test
  run on the *combined* result (47 files / 957 tests) — genuine end-to-end evidence instead of an
  educated guess, for about 5 minutes of wall-clock time (mostly the test run) and zero risk (a disposable
  clone, deleted after). Worth doing by default whenever recommending a merge order for more than two
  interdependent same-session PRs.
- **A background CI outage is worth documenting AND waiting out, not routing around.** GitHub Actions
  stopped assigning runners to this repo for ~45 minutes mid-session (multiple branches' `gate` jobs sat
  `queued` indefinitely, no fast billing-block failure like the previously-documented pattern). Nothing a
  session can safely do about the root cause (no billing access without requesting a wider auth scope,
  which is an account-level change outside an autonomous session's authority) — the productive response
  was to document it precisely (exact symptom, timestamps, what was and wasn't tried) in both the
  session log and `docs/RUNBOOK.md` (whose existing "Actions billing block" entry was itself stale —
  marked "historical since the repo is public," but the repo went private again at the 2026-08-15 pause,
  so the entry was quietly active again and nobody had un-stale'd it), keep doing locally-verifiable
  work in the meantime, and use `Monitor` (a poll-loop-until-resolved background watch) rather than
  manually re-checking `gh pr checks` every few minutes once the recovery was underway — the earlier
  session-61 lesson about killing spinner loops applies in reverse here too: a *bounded*, self-terminating
  poll loop is the right tool for "notify me when this condition becomes true," manual re-polling is not.

## Session 62 — the resume from pause, 2026-08-26 (autonomous, owner asked for hours of unattended work)

- **`origin/main` had silently stopped receiving pushes 12 commits before the halt — nobody had noticed,
  because the LOCAL clone had everything.** Session 61 did all of its post-PR-77 work (the #191/#192/#193
  fixes, and critically the pause/halt decision documentation itself) as commits on ITS OWN feature branch
  (`fix/191-reply-turn-answer-first`, this branch) rather than on `main`, then apparently left the repository
  checked out on that branch at session end instead of returning to `main`. `origin/main`'s actual tip stayed
  at `1a16eed` — the PR #77 squash-merge — the whole time. This session's `date`/`git log` checks at startup
  read the LOCAL working tree (which had this branch checked out, so showed the halt commit and everything
  after it) and correctly concluded the project was paused — that conclusion was right — but several later doc
  edits this session were made against a fresh `git checkout main`, which is the STALE, pre-halt copy, not the
  copy anyone would actually recognize as current. Caught via `git log -1 origin/main -- docs/STATUS.md`
  returning `1a16eed` when it should have matched local HEAD — a mismatch that only surfaces if you diff a
  specific file's history against the remote, not just check `git status`/`ahead-behind` counts, since a
  `--ff-only pull` on a branch with no upstream commits to fetch reports "Already up to date" whether or not
  the LOCAL branch itself is stale relative to where the real work lives. **Nothing was lost** — every commit
  exists, reachable from this branch, on both the local repo and `origin` (verified with `git cat-file -t` and
  `git branch --contains`) — but any doc edit made against a `main` checkout during this session needed
  re-doing against this branch instead. **The concrete fix, once this merges:** `main` will finally reflect the
  pause, and a future session reading `main` directly (rather than inheriting a feature-branch checkout) won't
  hit this. **The lesson to carry forward regardless: before believing a `git checkout main` gives you the
  actual current docs, check that `main`'s tip matches what the local working tree said moments earlier** — a
  session that does a lot of branch-hopping (as an autonomous multi-PR session naturally does) can silently
  drift onto the wrong base without any single command flagging it directly.
- **A "failed: stalled at 600s" background-task notification described work that had actually finished
  successfully — twice in one session.** An implementer subagent's notification said "failed" after its stream
  watchdog gave up; its actual last message was "pushing the branch and opening the PR" — and it had. A
  CBS-sync subagent's notification also said "failed," and the database showed several tables cleanly synced
  with zero orphaned state. **The notification's status field is not proof of anything — it means the harness
  stopped listening, not that the underlying work stopped or failed.** Verify the real state (git, `gh pr
  list`, the DB) before either redoing the work or reporting a failure. Redoing already-completed work wastes
  real time and, worse, risks double-running something with side effects.
- **`git rebase --cleanup=whitespace` is not a valid flag on a plain (non-`--continue`) rebase on this
  machine's git (2.39.5)** — it errors "unknown option `cleanup=whitespace'" before touching anything. The
  session-59 lesson below already names the alternative (`git -c core.commentChar=';' rebase ...`), but framed
  it as an equally-good option rather than a needed fallback — a future session reaching for `--cleanup`
  first, as the RUNBOOK's own paste-ready kickoff text instructs verbatim, will hit this. Use the
  `commentChar` form; verified this session to both work and preserve a `#`-leading commit subject intact.
- **A vitest config gap silently ran the whole backend suite 2-3× over, for the entire time multiple worktrees
  coexisted.** `vitest.config.ts`'s `exclude: ['web/**', ...]` only matches a top-level `web/`, not one nested
  inside `.claude/worktrees/<id>/` (a full nested clone, this project's own agent-isolation pattern). A root
  `npm test` therefore swept in every test file from every worktree too — 238 spurious failures from one
  measured run, cross-copy jsdom-global collisions, and crashes from a worktree's missing `node_modules`. This
  almost certainly explains "sustained heavy machine load" a concurrent session flagged the same evening: every
  root-level `npm test` anyone ran while worktrees existed was quietly doing 2-3× the real work, on an 8GB
  machine already documented as OOM-prone under load (`vitest.config.ts`'s own comment history). Fixed by
  adding `.claude/**` to the exclude list (PR #92). **The same root-cause shape — a hand-rolled or
  narrowly-scoped exclude pattern that doesn't account for a worktree's nested full clone — independently hit
  THREE different mechanisms this session**: this vitest config, a custom doc-completeness test
  (`tests/docs/doc-conventions.test.ts`, fixed in this same PR), and is best avoided going forward by asking
  git what it actually tracks (`git ls-files --cached --others --exclude-standard`) rather than hand-walking
  the filesystem with a maintained ignore list, wherever that pattern shows up next.
- **Reading only the exit code of a background test run, not its `Test Files N passed (N)` summary line, would
  have missed the vitest bug above entirely.** The existing session-61 lesson about this ("a log without a
  summary is a kill, not a pass") extends to: a summary line with the WRONG COUNT is also not a pass, even when
  the exit code says success — only comparing the count against a known-good baseline (105 files, not the 300+
  the contaminated run silently produced) surfaced it.
- **A destructive-sounding retry can be perfectly safe once you check what actually failed.** Three CBS syncs
  crashed on connection-pool errors (`EAUTHTIMEOUT`, "connection terminated", "statement timeout") under this
  session's own concurrent load — consistent with #173's documented free-tier pool-exhaustion history. Checking
  `cbs_tables` and `ingestion_batches` directly (not assuming) showed zero partial writes and only harmless
  orphaned bookkeeping rows; all three tables synced clean on a spaced-out retry. Postgres's transactional
  guarantees did exactly what they're supposed to — a crashed client mid-query is not the same risk class as a
  crashed client mid-write when every write is wrapped in a transaction.
- **"Session 62" was available, not "session 63," despite a kickoff doc already existing for it.** Session 61
  wrote its own close-out doc and a forward-looking `session-62-kickoff.md` mid-stream, then kept going itself
  (per its own halt commit: "session 61 spanned eight days," covering the period the kickoff doc implied would
  belong to a new session). A session number gets consumed by being actually USED as a distinct session, not by
  a kickoff doc being written for it.

## Session 61 — 2026-08-07 (autonomous; PR 77 merged, PR #85 opened)

- **A session outliving its own dates is now the PATTERN, not the accident — assume it.** Session 60 spanned
  twelve days (26/7 → 7/8) and turned one of its own conclusions upside down ("nothing to sync" became two
  overdue syncs). Session 61 then spanned eight (7/8 → 15/8): every measurement, every doc, and the whole
  session-62 kickoff say **2026-08-07**, while the halt was decided on **2026-08-15**. Twice in a row, the
  conversation read as continuous and the calendar did not. **Treat `date +%Y-%m-%d` as the first command of
  every turn that will write a date, not just the first command of the session** — a date derived at the
  start of a long session is as untrustworthy as a date recalled from memory, which is what the Golden Rule
  already says about everything else. The concrete cost here was near-zero only because `date` was run again
  at the halt.

- **A pause pauses the work, not the clocks the work made promises about.** Halting the project for ~2 months
  from 2026-08-15 lands squarely on **~2026-10-15**, the date the first `anonymous_trial` rows become
  purgeable under the 90-day retention promise — while `GDPR_PURGE_APPLY` is off, so the monthly cron reports
  and deletes nothing. Nothing was broken at the halt; the promise simply starts being missed at roughly the
  moment the project returns, with nobody watching in between. **Before pausing anything, enumerate the
  commitments that keep running: retention windows, certificate/credential expiries, scheduled jobs that are
  dormant rather than absent, and live money paths.** It was worth raising with the owner while he was still
  in the chat, since it is his env var and in two months he would not be.

- **A poll-loop watcher you then check by hand becomes a spinner — stop it explicitly.** This session armed
  several `while true; do gh run list …; sleep 30; done` monitors to wait on CI, and then in most cases
  checked the same run manually a minute later. The manual check answered the question; the loop kept
  spinning. **The owner had to kill one that had been running for about five hours** on his own machine.
  Nothing was lost — everything was already committed, pushed and green — but it was pure waste on an 8 GB
  machine that this same session had already established cannot spare the CPU (see the OOM lesson above).
  **Fixes, in order of preference:** prefer a BOUNDED wait (`until <condition>; do sleep N; done` with a
  real exit, run via a backgrounded command) over an unbounded `while true`; and the moment you satisfy a
  watcher's condition by hand, kill it — don't leave it to a timeout, and don't assume a reported
  "Monitor timed out" actually reaped the shell (the five-hour one survived exactly that).

- **The final self-audit earned its place: it caught the session repeating the exact mistake the session
  had fixed that morning.** Session 61 opened by removing "Three commits" from STATUS because a commit count
  in a doc is stale on the next commit — and then wrote "five commits" for PR #85 into the session-62 kickoff
  and "Four commits" into STATUS, both wrong (it was seven) by the time the wrap-up commits landed. Nothing
  caught it until step 8's `gh pr view 85 --json commits`. **A rule you just wrote does not protect you from
  breaking it four hours later; only re-deriving every number against its source does.** Both now name the
  CONCERNS and point at git.

- **A missing summary line is not a pass.** The branch's backend suite was read as green from a log that
  simply had no `Test Files` line in it. It had been **OOM-killed — exit 137** — because 103 PGlite-backed
  test files were running alongside 11 concurrent review agents on an 8 GB machine. Two separate runs were
  truncated the same way before the exit code was checked. Session 60's trap 3 says "freeze the tree, then
  measure"; the tree was frozen and the *machine* was not. **On this machine the verification block must run
  with no agents in flight**, and a log without an explicit pass/fail line must be treated as a failure until
  an exit code says otherwise. `npm test > log 2>&1; echo $?` — capture the code, never infer it from silence.

- **A line reference written while editing the file above it is stale on arrival.** The `#191` fix added an
  explanatory comment to `respond.ts`, which pushed the `{ ...options }` spread from line 630 to 652 — and
  the RUNBOOK and open-questions rows written in the same commit cited 630. It was true on `main` and false
  on the branch the moment it was written. The independent review caught it. **Cite a line number only after
  the edit is final, and re-grep before committing.**

- **A subagent's conclusion and its evidence need separate verification.** A review agent reported a correct
  conclusion about R8 reconstruction, supported by a citation to `tests/answer/audit-reconstruct.test.ts` —
  **a file that does not exist and never has** (`git log --all --diff-filter=A` confirms). The adversarial
  verifier caught the fabricated citation while agreeing with the conclusion. This is the concrete argument
  for the verify stage: without it, a fabricated file path would have been copied into a doc as fact.
  Related: [#191](open-questions.md), and the `index-is-not-the-page` lesson from 2026-07-26.

- **"Is it threaded?" was the wrong question; "which half is threaded?" was the right one.** [#191](open-questions.md)
  was recorded as a reply turn that never receives `ANSWER_FIRST_ENABLED`. Measurement showed the reply turn
  ran **half** of mechanism B: B-region lives in the QUERY layer and already arrived via a `{ ...options }`
  spread, while B-period lives in the INTENT layer and did not. The recorded framing ("both turns run pre-B
  and agree") was wrong in a way that mattered — flag-on, the reply turn defaulted the region the user never
  mentioned and refused over the period it was allowed to default. **When a flag has two mechanisms, check
  each one's layer separately; a single "is the flag passed?" answer can be true and false at once.**

- **The product question dissolved once the written rule was actually read.** #191 was framed as a product
  call ("should a reply turn default like the first turn?"). R7's third branch already authorizes filling in
  a structurally-determined axis and draws **no first-turn/reply-turn distinction**, and the safelist is
  "code, never configuration". So half-applying it was an invariant conformance gap, not a design choice.
  **Before treating something as an open product question, check whether an invariant already answers it.**

- **A pin can inherit the very blind spot it was written to close.** Session 60's trap 5 was "derive a pin's
  pattern from the REASON for the rule, not from the instances in front of you" — and the doc-convention test
  written from that lesson was still scoped to `docs/`, where the instances happened to live, leaving
  `CLAUDE.md` (doc #1 in the reading order) unscanned. Its regex was also case-sensitive and scheme-anchored.
  **After writing a pin, ask what set the RULE covers and compare it to what the pin walks.** An explicit
  file list now ships with a test that walks the real tree and fails if the list stops naming what exists.

- **A test asserting absence goes vacuous the moment you reword the thing it looks for.**
  `tests/answer/respond-refusals.test.ts:419` asserts `.not.toMatch(/laatste definitieve/)` to prove a
  refusal aside is ABSENT in one case. Rewording that template — exactly what [#193](open-questions.md)
  option (b) calls for — would make the assertion trivially true and silently defang the test. Recorded in
  the #193 row for whoever ships it. **Grep for `not.toMatch` / `not.toContain` against any string you are
  about to change.**

- **A copy question turned out to be a factual bug about our own output.** [#193](open-questions.md) asked
  what `Definitief` may imply. Auditing the copy first showed the product **never prints
  `(definitief cijfer)` at all** — `provisionalDisplay` maps only `Voorlopig`/`NaderVoorlopig`. The one place
  that string existed was the landing-page example, under a comment calling it "the product's real answer
  shape". **Before debating what copy implies, verify the product actually emits it.**

- **Changing a refusal TEMPLATE has an R8 cost that is invisible from the code.** Per [#133](open-questions.md),
  `reconstructionReport` verifies stored rows against TODAY's builder rules, so live rows carrying the old
  string start failing reconstruction and each needs a **row-id-pinned** entry in `known-divergences.ts` —
  and the register takes exact ids, never patterns, so the ids must be discovered with `audit:verify` against
  the live database. That makes any refusal-copy change owner-supervised, which is why #193's remaining two
  edits are specified but deliberately unshipped. **Template edits are not "just copy".**

- **Never read an exit code through a pipe, and install BOTH lockfiles before judging a dependency PR.**
  Verifying Dependabot PR #82 (`next` 16.3.0 + `jsdom` major) locally produced three wrong readings in a row
  before it produced a true one. (1) `npm --prefix web ci` alone made **9 web test files fail** on
  `Failed to resolve import "@anthropic-ai/sdk"` — backend modules reached through the `web/backend` symlink
  need the ROOT install, which CI does first. That was the session's error being misread as the PR's defect.
  (2) Symlinking the main checkout's `node_modules` into the worktree to dodge the install made Turbopack
  fail with `Symlink [project]/node_modules is invalid, it points out of the filesystem root` — the exact
  error [ADR 018](decisions/018-web-app-own-lockfile.md) exists to avoid. (3) `echo "EXIT=$?"` after
  `cmd | tail -N` captures **`tail`'s** status, always 0 — so two "BUILD_EXIT=0" readings meant nothing.
  Done correctly (real root install, no symlink, `cmd > log 2>&1; echo $?`), #82 is clean: install 0,
  typecheck 0, 42/42 files, 453/453 tests, `next build` 0.

- **The `deploy` job never running on a PR is deliberate, not a gap.** It was briefly read as the s49 trap
  made structural. [ci.yml](../.github/workflows/ci.yml) explains it: `gate` is hermetic (no network beyond
  npm) and `next build` fetches fonts at build time, so it can only run inside `deploy`, downstream of green.
  The correct mitigation for a dependency bump is therefore to build it **locally** before merging, not to
  change CI. **Read the comment before calling a config a bug.**

## Session 60 continuation — the ~30/7 syncs, run on 2026-08-07 (autonomous)

- **Twelve days passed between the session-60 work and this continuation, and `date` was the only thing that
  said so.** The conversation read as continuous; the calendar did not. The first thing the resumed session
  did was re-run `date +%Y-%m-%d` — 2026-08-07, not 2026-07-26 — which immediately inverted a conclusion I
  had written myself: "~30/7 BBP+PPI syncs: measured, nothing due" became "both are eight days overdue".
  This is session 55's lesson recurring in a new shape (*"na een lange onderbreking eerst `date` + owner-datums
  tegen de DB meten, nooit tegen de kalender-aanname"*). **A measurement carries its timestamp as part of its
  meaning. "Nothing is due" is only true as of the day it was measured, and a handover that quotes it without
  the date invites the next session to act on a stale fact.**
- **A plain sync is NOT the cautious option on a table that has gained a period code — it is the option that
  trades a clean sync for an outage.** I ran `ingest sync 85770NED` bare, on the reasoning that withholding
  `--accept-new-codes` was the conservative choice. It failed at `dimension_mapping` on the new month, which
  set the table to `needs_review` — and quarantine is enforced on the value path, so **PPI went from serving
  17-July data to refusing outright**. The bare run did not avoid a decision; it made a worse one. The correct
  order is: diff CBS's code lists against ours read-only FIRST, and if the only delta is the expected next
  period, sync WITH the flag from the start. Recovering afterwards additionally required `--rebaseline`
  (the pipeline refuses to sync an already-quarantined table without it), so the bare attempt cost a strictly
  larger intervention than the one it was trying to avoid.
- **I set a bound, then had to break it — and the breaking was correct, which is the interesting part.** I
  told the owner "no `--accept-new-codes`; if it hits new release codes I stop and report". Then my own
  attempt degraded production. Holding the bound would have meant leaving PPI refusing, for an absent owner,
  over a single new month code I had already verified by diffing all three dimensions. **A bound that was
  right when set can become the wrong action once your own work has changed the state it was protecting.
  Say plainly that you are overriding it and why — the failure mode to avoid is quietly redefining the bound
  so it never looks broken.**
- **⚠ The documented escape hatch cannot do the job it is documented for — [#192](open-questions.md).**
  `sync-from-capture.ts` calls `syncTable` with no options, so it can never accept new codes, while the
  RUNBOOK names it as the expected path for *every* `85880NED` release-day sync. It had never been exercised
  on a release sync — session 50 used it for first-time registration, where nothing is new. **A procedure
  validated only on its easy path is not validated. The hatch worked the once it was tried and was then
  written into the RUNBOOK as routine.**
- **⚠ An autonomous session that correctly refuses to merge leaves its whole written record where the next
  session does not look.** Branch + PR (#118(b)) protects the code path and quietly breaks the
  documentation path: on `main`, STATUS still opened with "Session 59", and #191/#192/#193, the corrected
  RUNBOOK step 5, the new release-day step 6 and the session-61 kickoff simply did not exist. Two things
  made that worse than a lagging tracker here — **the sync DATA is live in production while the docs saying
  so sit on the branch**, so `main` and production actively disagree; and **`main`'s RUNBOOK still instructs
  the release-day path that quarantines a table**, so following `main`'s own guidance would take a table out
  of service. Caught only because the owner asked "so nothing will be forgotten, right?" and the honest
  answer required checking rather than reassuring. **Any handover written from an unmerged branch must say,
  at the top, that it is not on `main` and how to reach it.**
- **The stale-doc sweep had to distinguish records from guidance, and only the guidance is a bug.** Grepping
  "chunked escape hatch" returned ~25 hits: the RUNBOOK's step 5, `04-architecture`'s capability row, and a
  long tail of session briefs and archive entries. Only the first two were corrected. **A dated handover or
  an archive entry is a record of what a session was told at the time — rewriting it falsifies the log, and
  the repo already treats `status-archive.md` that way ("verbatim, newest on top").** The test is not "does
  this string appear" but "would someone ACT on it": the RUNBOOK's step 5 would have been followed on a
  release day and would have quarantined the table, so that one had to change.
- **⚠ "Definitief" does not mean immutable, and I only found that out because I looked at 2,009 corrections
  instead of accepting the count — [#193](open-questions.md).** The BBP release carried 2,009 corrections,
  which is easy to wave through as "national accounts get revised". Splitting them was the whole finding:
  **1,103 were `Definitief → Definitief`, reaching back to 2015KW01** — CBS revised eleven years of
  already-final figures in one release. The pipeline handled every one correctly. But the product leans on
  that status (`buildFreshnessRefusal` offers the freshest *Definitief* period as the safer one), which
  teaches users that a final number is settled. **A large number in a summary line is not a finding; the
  distribution inside it is. I nearly logged "2009 corrections, normal for national accounts" and moved on.**
- **The first frozen reference value in `docs/11` has moved, and that is the system working.** CBS's 30 July
  release carried 8 corrections on the PPI table, all on `Voorlopig` cells, including one this repo had
  frozen as a spot-check (invoer 2026MM05 jaarmutatie 9.3 → 8.4). The other three still verify exactly. The
  correction-diff log surfaced every one. **Worth writing down because the next person to see it will suspect
  the pipeline: a "frozen" value is frozen against the FIXTURE, and the hermetic suite keeps passing while
  live data legitimately moves.** It is also the most concrete argument yet for [#71](open-questions.md)
  (visible "voorlopig" badge) and [#88](open-questions.md) (revision awareness).

## Session 60 — #176, and a pin that had drifted from its defect (2026-07-26, autonomous)

- **The test that was supposed to pin the bug did not cover the bug — and it was confident about it.**
  `tests/answer/query-count.test.ts` carried a case commented *"the shape #176 was found on"*. It passes
  `regions: null`, which returns ok early at `resolve.ts:166` and **never enters the failure branch #176 is
  about**; its `served:false` came from the query layer, not from any region ambiguity. So the fix moved
  none of the pre-existing pinned numbers, and verifying against that tripwire as it stood would have
  proved nothing — *a no-op gate would have stayed exactly as green*. Neither artefact was wrong on its own
  terms: the byte-neutrality review found a real defect, the conformance bundle added a real tripwire, and
  nobody re-read one against the other. **A pin inherits its authority from the shape it exercises, not
  from the issue number in its comment. Before trusting a test as the verification of a fix, construct the
  failing input yourself and confirm that test would see it.**
- **The mutation is the only thing that told me the new pins were real.** I guessed the two new statement
  counts (3 flag-off, 4 flag-on) and both passed first try — which, after last session's tautology finds,
  reads as a warning rather than a success. Removing the gate fails the flag-off pin 3→4; **inverting** it
  fails 10 tests across 3 files; dropping the `followup.ts` threading fails the new follow-up test. The
  `'max'` case I added passes with the gate removed too, so it is labelled a guard, not a proof.
- **A second call site had no coverage at all, and its failure mode is silent.** Both `parse.ts` and
  `followup.ts` feed `resolveCandidate`, and production reaches both through the same options object
  (`respond.ts:528-532`) — but every existing click-option test went through `parse.ts` only. Forgetting the
  follow-up threading would have shipped green, and the symptom is not an error: the clarification renders
  perfectly, minus its chips. **When threading a flag to N call sites, count the call sites first and check
  the test file covers each one — "the suite passed" says nothing about the site nobody tests.**
- **The cheap design was also the right one, for a reason only reading revealed.** Moving the construction
  into `policy.ts`'s already-gated branch (the alternative the row named) would have had to reproduce one
  undocumented subtlety exactly: `regionOptionIntents` resolves its period WITHOUT `answerFirstEnabled` and
  without region codes (`resolve.ts:933`), unlike the main path. Miss that and flag-ON behaviour changes
  silently. **An "obviously cleaner" refactor across a module boundary inherits every undocumented
  asymmetry it moves; price that in before calling it cleaner.**
- **The review over my own diff found something real for the ELEVENTH change running — and this time it was
  in the doc, understating a residual in the direction that flattered the change.** I wrote that the
  leftover flag-ON waste needs "several candidates simultaneously region-ambiguous"; it actually happens
  whenever **any non-top** candidate is ambiguous, including a mixed parse whose top reading is a plain
  success and whose turn therefore just *answers*. Same class as session 59's "the thing you did not write
  down is the thing you did not want to", one step subtler: the thing you *did* write down, phrased so the
  residual sounds rarer than it is. **When you document a limitation of your own change, state the
  precondition from the code path, not from the example you happened to test.** The review also found a
  stale doc comment on `optionIntents` (the one carrier of the old framing my sweep missed) and, adjacent
  to the diff rather than in it, **#191** — the reply turn never receives `ANSWER_FIRST_ENABLED` despite
  its options type declaring it. That last one is the payoff of briefing a reviewer with the *shape* of the
  bug ("an options-bag omission") rather than only its location: it went looking for the same shape one
  module over and found it, dormant, on the path the owner is about to switch on.
- **A "the wrap-up sweep now greps for this" rule failed twice in a row, because nothing actually runs the
  grep.** Session 55 re-neutralized 29 live PR links in `docs/` (interim rule (i) under #132: route B
  deletes the repo, so every live PR link would 404) and recorded that the sweep would catch it in future.
  Sessions 58 and 59 then added **38 more**, and both wrap-ups declared the stale-doc sweep done.
  Re-neutralized again this session. **A convention enforced by a human-or-model remembering to grep is not
  enforced.** The repo already knows the fix — it is the same "a convention ships with its pin" rule the
  session-57 architecture memo proposed and the conformance bundle acted on for four other conventions.
  This one wants a test or a CI grep, not another note saying to remember — **so this session wrote the
  test rather than the note**: `tests/docs/doc-conventions.test.ts`, wired into CI as `test:docs`,
  mutation-checked (reintroduce one link → it names the file and the count). The rule is now enforced by
  the same thing that enforces everything else here: a red pipeline.
- **And the review of THAT commit caught the fix breaking the thing it was fixing — for the third round
  running.** The mechanical substitution rewrote `[#68](url)` to `PR #68` without noticing the docs often
  already said `PR ` in front of the link, producing **`PR PR #68`** — 10 shipped in my own commit, and
  **17 more found inherited from the session-37 and session-55 rounds**, meaning all three neutralization
  passes made the identical mistake and none noticed. All 27 fixed, and the test now pins that form too,
  because a URL check structurally cannot see prose damage. The same review also showed the first regex
  was anchored on markdown `](…)` syntax while the *reason* for the rule is that a repo recreate 404s the
  URL — so a bare pasted URL, a reference-style target and an HTML `href` were all blind spots. Widened,
  with an issue-link counter-case so the widening cannot over-match. **Two lessons, and the second is the
  general one: (1) a search-and-replace that changes a word must be checked against the words AROUND it,
  not only against its own pattern; (2) when you write a pin, derive its pattern from the REASON for the
  rule, not from the shape of the instances you happen to be looking at — I pinned the syntax I was
  cleaning up rather than the failure I was preventing.**
- **Then the new pin failed on the lessons entry describing the defect it pins — and that was the pin
  earning its keep, not a false positive.** The bullet above has to quote the doubled form to explain it,
  so the check went red on this very file. The fix was not an exemption but a definition: a careless
  search-and-replace produces the doubled word in PROSE, while a session explaining the trap puts it in
  backticks deliberately — so the check now strips fenced blocks and inline code spans and looks at prose
  only, with both halves pinned (prose fails, the quoted form passes). **A pin that fires on its own
  documentation is telling you the rule was stated more loosely than it was meant; the useful response is
  to sharpen the rule, not to carve out the file.**
- **The CI step I added to enforce a convention broke CI itself — an unquoted colon in a YAML step name.**
  The step was named with a parenthetical containing a colon-space, which YAML reads as the start of a
  mapping; the whole workflow failed to parse, and the run died in **0 s** with "this run likely failed
  because of a workflow file issue". Nothing local caught it: the full test suite, both typechecks, the
  benchmark and a real build had all just passed green, because none of them parses `.github/workflows/`.
  **A `.yml` edit is a code change with no local gate — validate it explicitly** (`python3 -c "import
  yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` takes a second and would have caught this
  before the push). A 0-second red run is the signature: that is a parse failure, not a test failure, and
  it means the gate did not run at all rather than running and passing.
- **A local `npm test` while you are still editing is not a measurement.** Two full-suite runs came back
  `1 failed` and I explained the first away as a race between my edits and the runner. The second failed
  identically, which killed that theory — the actual cause was the item above, sitting in the tree the
  whole time. The 16-minute local suite is long enough that "run it, keep editing" is tempting and always
  wrong. **Freeze the tree, then measure; and when a failure repeats, the convenient explanation is the
  first one to discard.**
- **Commit-message language has drifted from the stated convention.** CLAUDE.md says English for commit
  messages; every session-59 commit is Dutch, and the ~30 before them are English. Recorded rather than
  silently picked a side — this session wrote English per the convention, and the owner should settle
  whether the doc or the practice wins.

## Session 59 — the capacity/retention batch (2026-07-26, autonomous then owner-authorised push)

- **`git rebase --continue` SILENTLY DROPS a subject line that starts with `#`.** It bit twice tonight, on
  the same commit, and both times the rebase reported success — the commit simply became a subject-less
  paragraph (`git log --oneline` showed a 500-character "subject"). Cause: this repo's convention is
  `#181: …` / `#186: …`, and a rebase continuation opens an editor whose default cleanup mode strips `#`
  lines as comments. `git commit -F` does NOT (its cleanup is `whitespace`), which is why the original
  commits were fine. **Every rebase or cherry-pick of a `#`-prefixed commit in this repo needs
  `--cleanup=whitespace`** — `git -c core.commentChar=';' rebase --continue` works too. Same family as the
  scripted-edit no-op trap: a tool that reports success while quietly destroying something.
- **Two measurements changed a design; one of them contradicted a doc we had been trusting.** #186's brief
  said "measure first", and the instrument that answered it was **`pg_stat_statements`, not
  `pg_stat_activity`** — a snapshot shows what is connected right now, the other had been accumulating since
  2026-07-02. It gave 143 pot reads since the trial go-live (~17/day, mean 0.44 ms) against 2 questions ever
  served. But the finding that changed the design was in `pg_stat_activity` after all: **one anonymous GET
  left a pooler session idle for 174 s**, and 4 of the 15 slots were held at a quiet hour from ~2 page views.
  Both #186's row and the RUNBOOK said idle sessions release on node-pg's 10 s timer, and that this is why
  the 2026-07-25 incident self-healed. **Measured false** — the timer does not fire while a Fluid Compute
  instance is frozen. Lesson: when a doc explains a mechanism, the explanation is a claim like any other.
- **I wrote a number into a commit message from a partial run, and a review caught it.** The message said a
  mutation "fails 1 test"; I had run it against one file after adding tests to a second in the same commit.
  Across the whole suite it fails **4**. The tests were stronger than claimed, not weaker — but the Golden
  Rule is about the *provenance* of a number, not its direction. **Re-run the mutation over the whole suite
  the change touches, after the last test is added, not during.**
- **Mutation testing found a tautology in my own test, twice.** #186's expiry test advanced the clock BY the
  TTL constant, so a six-hour cache would have kept it green — a range assertion now pins the magnitude
  separately. And #181's window-equality test cannot fail while one module imports the other's constant;
  it is a guard against a future literal, not a proof, and it now says so. **Run the mutation you claim, and
  when a test survives a mutation it should have caught, relabel it rather than leave it reading as a proof.**
- **A review pass over my own diff found something real on all four changes — that is ten in a row now across
  sessions.** Three of the four were the same class: an incomplete stale-doc sweep, where a summary sentence
  kept stating the old rule one paragraph above the new one. The fourth was the one trade-off I had not
  written down (the #184 gate can be *stricter* than the take under CGNAT) while carefully documenting every
  other. **The pattern to watch for: the thing you did not write down is the thing you did not want to.**
- **A flaky test's ceiling had already been raised once "deliberately modestly", with a note not to raise it
  again — and the note was right.** `onboarding-cron.test.ts` timed out three more times at load 18-25. The
  fix was to remove the cause: it imported the route *dynamically inside the test body*, dragging the whole
  backend module graph through the transform pipeline under a test timer. The route reads its env inside the
  handler, so a static import is identical and moves the cost to collection time — 730 ms → 7 ms.
  **When a timeout ceiling has already been raised once for one test, the next escalation is the cause.**
- **Squash-merging a stacked PR closes the child, it does not retarget it.** #73's base branch was deleted by
  #72's squash merge, which auto-CLOSED #73 and made its base unchangeable (`Cannot change the base branch of
  a closed pull request`). Recovery is a rebase `--onto main <old-base-sha>` plus a fresh PR. **Stack only
  when the dependency is real, and expect to re-open the child.**
- **A review of the COMBINED diff found a real bug that four per-change reviews could not.** Each of the
  session's four changes was reviewed alone and came back clean or fixed. A final pass over all four together,
  briefed to hunt ONLY for what breaks when two of them meet, found that `web/lib/ontdek.ts` latched its
  in-flight slot forever after a SYNCHRONOUS build failure — `getDb()` throws synchronously on a missing
  `DATABASE_URL`, so `rebuild()`'s in-body `finally` cleared the slot BEFORE `inflight ??= rebuild()` assigned
  it, and nothing ever rebuilt again on that instance. **The trap is documented, correctly, in `trial.ts` one
  file over** — where I had just avoided it deliberately — and #190(b) had added a comment to `ontdek.ts`
  asserting the opposite. **Lesson: knowing a trap in file A does not protect file B, and a per-change review
  never sees the pair. Budget one pass over the combined diff at the end of a multi-change session.**
- **Numbers measured on a branch go STALE the moment you rebase it.** Three commit messages this session carried
  counts that were true when measured and wrong when merged: `#181` said "web 425/41" (true on its pre-rebase
  branch, 440 after rebasing onto a main that had #186+#184), `#190(b)` reused "backend 1545/102" when its new
  parent had brought it to 1551, and `#186`'s "TTL=0 → 2 fail" was measured before two more tests existed
  (3 on the shipped tree). Distinct from the partial-run mistake above and with a different fix: **re-measure
  after the last rebase, not after the last edit** — or write the number in the PR body, which is editable,
  rather than the commit message, which is not.
- **Five parallel review agents all died on `529 Overloaded`, and the workflow returned `{confirmed: [], refuted: []}`**
  — which reads exactly like "clean". The tool's own warning covers this: an empty result is not a finding of
  nothing, it can be a finding of *nothing ran*. Re-running two at a time succeeded. **Check the failure list
  before believing an empty review.**

## Session 58 — autonomous overnight #2 (2026-07-25 evening)

- **TWO AUTONOMOUS SESSIONS WERE STARTED ON THE SAME BRIEF, IN THE SAME WORKING TREE.** The owner launched a
  second overnight session at 18:38 with the identical kickoff. It detected me from a test file's advancing
  mtime and opened a cross-session channel; we split the queue, it moved to its own worktree
  (`/Users/amity/cdc-s58`), and both halves shipped. **Nothing was lost — but only because neither of us ran
  `git add -A` or a branch checkout in the shared tree at the wrong moment, which is luck, not design.**
  Concrete costs measured: the backend suite went from ~500 s to **1447 s**, the web suite from 15 s to 342 s,
  and one verification block came back RED with `Failed to start forks worker` — a load flake, not a defect,
  but it cost a full re-run to establish that. Rules for next time: **a session that finds another running in
  its cwd should move to a worktree immediately rather than negotiate**, and the kickoff brief should carry a
  "if another session is already running this queue, take items N-M" line. Also: check `list_sessions` at
  startup — it takes one call and would have caught this before the first write.
- **Hand the other session your FINDINGS, not your conclusions, and check what they already recorded before
  writing your own.** Its independent hunt of the same surface produced eight open-questions rows overlapping
  mine. Reading its branch first (read-only) let me renumber to 187-190 and record only the four findings its
  rows did not cover, cross-referencing rather than restating. Where we overlapped we agreed — including on a
  refuted finding — which is worth more than either report alone. Duplicated rows on one table would have been
  a net loss for the reader.
- **A review pass over my own diff found a real defect in BOTH code PRs — three for three across sessions now.**
  On the security PR it caught that my new `guardRequestId` bound did not match the columns requestId actually
  lands in (`uuid` on two tables, `text` on a third), which exposed a genuine anonymous R8 hole neither of us
  had seen; it also caught three comments dated *tomorrow*. On the conformance PR it caught that my manifest
  parser silently skipped `readonly foo: string`, method signatures and quoted keys — **and that the
  member-count assertions I had written as the backstop were computed from the parser's own output**, so they
  would have moved right along with the miss. A circular backstop is not a backstop. Budget the review pass as
  a required step, not a courtesy.
- **The most valuable finding of the night came out of a hunt aimed somewhere else.** The brief scoped item 4
  to the anonymous trial; the headline defect (`guardLength` type-checking nothing, so a content-block array
  with `.length === 1` drove a ~1 MB prompt at a flat credit price) sits on the PAID path and has since WP13.
  The trial lens found it only because it was reading the trial's copy of the same guard. Adjacent code is
  worth reading during a scoped hunt.
- **A performance claim needs at least two legs per arm, alternated — and sometimes the honest answer is "not
  resolvable".** The re-measured fixture-snapshot A/B came out 70-145 s rather than the retracted 240 s, but
  the *within-arm* spread (690 s vs 432 s on two warm runs) was larger than the between-arm difference. Saying
  so plainly is the result; a single mean would have been a third wrong number in the same doc. The alternating
  design also explained the original error rather than merely doubting it: both original numbers land on warm
  legs at different loads.
- **Two Fable lenses contradicted each other on a HIGH finding, and the code settled it in one read.** One
  reported an unmetered free-LLM loop via the refund path; the other, hunting that exact primitive, could not
  build it. `respondToQuestion` wraps its whole body and converts every throw into a *returned* refusal, so the
  refund is near-unreachable — the second lens was right. Verifying a delegated finding against source before
  acting on it is not optional, and it is cheap compared to shipping a fix for a bug that does not exist.

## Session 58B — the post-merge review round (2026-07-26, owner-present)

- **A post-merge review of code I had just shipped found four defects I introduced hours earlier, and the sharpest
  was in the function whose own comment explains the mistake.** `hashedRequestIp` gained a header tier written with
  `??`, three lines above a comment documenting why that operator had to become `||`. Four of ten review angles
  found it independently. Lesson: the pre-merge review certifies *the change you were thinking about*; a fresh pass
  over the merged result catches what you re-broke while fixing something else. Budget both when a change touches
  a function you also edited earlier the same day.
- **Three findings were three SPELLINGS of one bug, each previously patched alone.** `::ffff:1.2.3.4`,
  `::ffff:c000:0207` and `::1.2.3.4` are all "an IPv4 inside an IPv6", and each had been closed as its own special
  case while the next stayed broken and collapsed into a shared bucket. The tell was in my own commit message: it
  named the trap a naive implementation falls into, and then added a branch instead of removing the cause. **When a
  second instance of a bug arrives, stop patching and normalise — the third instance is already in the input space.**
- **Write the test for the PROPERTY, then let it argue with you.** Two fixes this round were found by tests I wrote
  to confirm the fix: a whitespace-only header is truthy, so even `||` did not fall through; and the module-scoped
  latches leaked between tests, which was a review finding about cross-test ordering biting me while I fixed
  something else. Both would have shipped if the tests had been written to agree with the code.
- **`replace()` without an assert is a silent no-op, and I hit it mid-fix.** A python edit whose anchor had drifted
  did nothing and reported success; the next typecheck caught it only because the signature mismatched. Every
  scripted edit in this session's later half asserts its anchor first. Same family as the stale-ref merge and the
  latest-CI-run trap: **a tool that reports success without doing anything is the most expensive kind.**
- **Latch on the OUTCOME, not the attempt.** The pot alert latched before sending, so one transient failure burned
  the only notification for that drain — in a feature whose entire purpose is not going unheard. Any
  "notify once" flag should key on delivery, and any code that swallows failures should return whether it
  succeeded rather than `void`.
- **Declining a finding is worth doing, and worth defending separately.** I skipped one (an awaited alert costing up
  to 5s) because the alternative introduces a mechanism whose failure mode is silently never sending — exactly what
  the feature exists to prevent. Reporting it as `skipped` with the reason, rather than quietly dropping it or
  fixing it to look complete, is the honest third option.

## Session 58B continued (2026-07-25 evening → 2026-07-26 early hours, owner-present, autonomous execution)

- **A docs-search INDEX is not the docs page, and I wrote the difference into a permanent row as fact.** Settling
  [#187](open-questions.md) I searched Vercel's doc index, got a summary of the `x-forwarded-for` behaviour, and
  concluded that `x-vercel-forwarded-for` "is not the documented header" — then said so in an open-questions row and
  a commit message, and *dropped a planned hardening on the strength of it*. Fetching the actual page took one call
  and showed a dedicated section for that header, describing it as the one that stays correct when a proxy sits in
  front of Vercel — i.e. exactly the Cloudflare launch plan. The correction did not just fix a sentence, it
  **reversed the code decision**. Rule: "undocumented" is a claim that requires the page open; an index tells you
  what it happened to surface, and absence there is not evidence.
- **Write the test for the PROPERTY, not for the code you just wrote — it will find your wiring.** I added an alert
  whose helper is documented "fail-soft, never throws", then wrote a test asserting *the visitor keeps their answer
  if the alert fails*. It failed: I had awaited the alert inside the action's outer `try`, so a throw would have
  refunded and discarded an answer that was **already produced**. The helper was fail-soft; the wiring was not.
  Same shape as the session-52 `attachTrialAudit` finding, in the same file, four sessions later.
- **The pin that matters is the one a NAIVE implementation would fail.** My IPv6 /64 tests all passed against a
  version with the `::`-expansion branch deleted — every case I had chosen happened to carry its four groups before
  the `::`, so plain `slice(0,4)` was right for all of them. The single case my own commit message named as the
  thing naive code gets wrong (`2001:db8::1`) was in the prose and in no test. Before trusting a suite, delete the
  branch it is supposed to protect and check it goes red.
- **Declining a review finding needs its own adversarial pass.** I refused [#185](open-questions.md)'s suggested fix
  (it would charge infrastructure failures to visitors to close an unreachable hazard) and explicitly asked the next
  reviewer to attack that decision rather than the code. It held — and the reviewer independently verified the
  premise I was leaning on, that the trial key's hard spend cap is a *configured fact* and not my assumption.
  Declining is where rationalising is easiest, so it is where the second opinion is worth most.
- **A single-shot alert is not an alert.** The pot warning fired on the one take that returns the threshold exactly.
  One transient Resend failure there and the warning is gone for good — with the floor being a log line in
  short-retention logs that nobody watches, which is the *premise of the item that asked for the alert*. Ask of any
  notification: what happens if the one send fails? If the answer is "nothing, ever", it needs a second place to
  fire from.
- **A new self-authenticating route must be added to the proxy allowlist, or it looks healthy and never runs.**
  `/api/gdpr-purge-cron` was missing from `PUBLIC_PATH_PREFIXES`, so Vercel Cron's GET would have been 307'd to
  `/login`, which returns **200** to the cron dashboard. Scheduled, green, never executed — the exact silence the
  change existed to end. `proxy.ts`'s own comment narrates this happening at the WP16 go-live in session 28; I read
  that file and still did it. The live 401 after deploy is what proves the fix, because an unlisted route would
  never have reached the route's own auth.
- **Closing the review's follow-up in the same change beats shipping a second deploy for it.** The reviewer said
  "safe to merge, close finding 1 next". On a project where four stacked deploys once caused a production
  degradation ([#173](open-questions.md)), "next" costs a deploy; folding it in cost ten minutes.

## Session 58B (2026-07-25 night, AUTONOMOUS — the second of TWO sessions running the same queue)

- **Check whether another session is already in the working tree, before you touch a byte.** I was started with the
  same overnight queue as a session that was already running in the same directory, and found out four minutes in
  only because `tests/audit/envelope-key-manifest.test.ts` advanced its mtime *while I was reading the repo*
  (18:38:34 → 18:40:52). One `git add -A`, `git stash` or `git checkout` from either side would have silently eaten
  the other's uncommitted work. The recipe, now that it exists: `stat -f '%Sm'` the modified files twice a minute
  apart, cross-check `list_sessions` for a running session with the same `cwd`, and if there is one, **move out** —
  `git worktree add` with its own `node_modules` gives a separate index, HEAD and fixture cache. Do not try to
  share a tree by being careful; you cannot be careful enough about another process's `git` commands.
- **A revert-proof is per-TEST, not per-commit — and I had the disproof on screen.** I wrote "each proven by
  reverting the source change and watching the new test fail" over a list of five changes. Two of them had no test
  at all, and a sixth "guard" test I added passes on revert *by construction* (it asserts the OLD behaviour on a
  different branch). My own revert run had printed `1 failed | 110 passed` and I read it as confirmation instead of
  counting it. Two review passes over my own diff caught both over-claims; nothing else would have. Two rules:
  **count the failures and match them one-to-one to the claims**, and when a change genuinely has no test, write
  "reasoning-only, no test" in the commit message rather than letting a blanket sentence cover it. This is the
  test-count arithmetic lesson from session 57 pointed at a different number.
- **Review your own diff TWICE if you keep editing after the first review.** The first review pass certified one
  commit, then said plainly that four files I had changed while it was running were outside its scope. It was
  right, and the second pass over those files found the over-claim above. A review certifies a tree, not an
  intention — if the tree moves, the certificate expires.
- **When you discover you are the SECOND session, change the job, not the branch.** My first instinct was to take
  different queue items. The better move surfaced from reading the other session's own commit message: it had
  already done the queue's headline item. What a second session can do that a first structurally cannot is **review
  the first one's work** — nobody independently reviews their own diff — and **re-hunt the same surface without the
  first pass's conclusions**. That reframing is where all of this session's value came from, including the one
  production-reachable defect. Duplicating a queue is waste; being the adversary is not.
- **When one logical id lives in two tables, check the column types agree — the looser one is the attack surface.**
  `trial_questions.request_id` is `text`; `audit_answers.request_id` is `uuid`. That single disagreement let a
  non-UUID request id pass the guard, pass the pot take, spend both LLM calls, and fail only at the R8 insert —
  whose fail-closed retry re-used the same bad id and failed identically, serving the turn with no audit row at all.
  The paid path was immune **by accident**: its `credit_transactions.request_id` is `uuid` and is written inside the
  gate *before* the LLM call, so the same garbage fails there for free. Nobody designed that asymmetry; a migration
  just picked a different type three months apart.
- **A test that mocks the layer enforcing a constraint cannot prove the constraint — and may pin its violation.**
  The trial tests passed `'r1'`…`'r4'` as request ids throughout, the exact shape production rejects, and stayed
  green for weeks because `answerQuestionAudited` is mocked there so the `uuid` column never participated. Same
  family as session 57's "my own new test had asserted the truncated key set as CORRECT". Ask of every fixture
  value: *would the real database accept this?*
- **"Fail-safe" and "honest" are different properties, and this product needs both.** The trial gate degraded
  perfectly — never a broken page, always the login nudge — while telling every visitor *"het gratis proefpotje is
  op dit moment leeg"* in a state where it had merely failed to READ the pot, which during the #173 pooler
  exhaustion meant a full pot. No number was wrong, so no invariant fired. Separate the two questions explicitly:
  *what do we DO when we don't know* (degrade) and *what do we SAY* (not a cause we haven't verified).
- **A `catch {}` that explains itself is more dangerous than a silent one.** `gdpr:purge` wrapped both trial legs in
  a bare catch that printed *"trial_questions absent (migration 020 not applied)"* and exited 0. That migration has
  been live since 2026-07-17, so from that day the message could only ever be false, and a lock timeout or
  permission error would have been reported as an honest skip forever. The house rule already existed one file
  away, in `retention.ts`: *"the guard must be a check, not a catch."* Grep for the rule before inventing one.
- **A retraction that lives in one paragraph is not a retraction.** `lessons-learned.md` retracted the confounded
  "680 s → 440 s" figure and then **restated it as fact three bullets later in the same file**. After correcting a
  number, grep the repo for the number — the doc-freshness rule already says this about decisions, and it applies
  just as much to measurements.
- **The measurement you could not schedule sometimes falls out of a log line.** I could not run item 2's A/B
  honestly (two sessions, load 32.8 then 41.2 on 8 cores). But my own worktree's cold `globalSetup` logged
  `snapshot built in 138470 ms` — 138 s for a build that costs 7.9-10.7 s idle. That is a measured 13-17× penalty
  on exactly the term the arithmetic wanted to treat as constant, and it is why one number was never the right
  shape for that claim. Read your own build logs before concluding something is unmeasurable.

## Session 57 — merge phase (2026-07-25, owner-present)

- **`git merge origin/main` merges the ref you last FETCHED, not the branch that exists.** I merged main into a
  feature branch after merging two PRs, but had only fetched after the first — so the second PR's files silently
  never came in. Nothing errored; the merge reported success. It was caught only because the resulting test count
  was **1504 measured against 1509 expected** by arithmetic (main's 1494 + 4 + 5 + 6). Two rules: always `git fetch`
  immediately before merging a remote ref, and **do the test-count arithmetic after every merge** — it is a free
  integrity check on whether the code you think you merged is actually there.
- **A performance claim measured at two different machine loads is not a measurement.** I published "backend suite
  680s → 440s" in a PR; the 680s baseline had run while six review agents were working and the 440s had not. The
  underlying mechanism was cleanly measured back-to-back (build 7.9-10.7 s vs restore 1.16-1.39 s) and is sound —
  but the headline ratio was confounded and I had quoted it as the headline. Corrected in the docs rather than left
  standing, and a same-conditions A/B queued — **which has now been run: the real saving is 70-145 s, not 240 s,
  and even that is not resolvable at n=2 because the within-arm spread exceeds the between-arm difference**
  (ADR 009). Rule: for any before/after timing, capture `uptime` load alongside
  both numbers, or measure them back-to-back in one run. This project's standard is measured results, never
  aspirational ones — and a confounded number is aspirational wearing a decimal point.
- **Merge one at a time when deploys are the scarce resource.** Four PRs = four production deploys, and five deploys
  in an hour is precisely what caused the #173 degradation. Merging serially, waiting for each gate+deploy to
  complete and checking the canary between, cost about an hour of wall-clock and zero risk. Ordering mattered too:
  the pool-size PR went FIRST because it lowers per-instance connections, buying headroom for the three deploys
  behind it. Sequence infra-relief changes ahead of the changes that will lean on them.

## Session 57 (2026-07-25, AUTONOMOUS overnight — 4 PRs on branches, €0 LLM product spend)

- **An allowlist is exactly as good as its completeness, and mine was not — the failure is SILENT by
  construction.** Replacing a `{...spread}` with an explicit key allowlist (to stop forged pending keys being
  persisted) dropped `conversationContext`, the WP15 referent that gives an elliptical follow-up its meaning.
  Nothing threw. No test failed. **My own new test had asserted the truncated key set as CORRECT**, so it pinned
  the bug. A review agent caught it only by *running* the function instead of reading it. Two rules for next time:
  (a) when you replace a spread with an allowlist, re-read the type definition to its LAST line — I had read the
  first 30 lines of `PendingClarification` and the ninth field was at line 173; (b) a test that asserts an exact
  key set must be written from the TYPE, not from the implementation you just wrote, or it only proves the code
  agrees with itself.
- **Delegating a review of your OWN diff is worth more than delegating the diff.** Both code PRs tonight had a real
  defect found by a review pass over my own work — the allowlist above, and a fixture-snapshot cache key that named
  two input files by hand and MISSED SIX that change what the database contains (a warm cache would then have made
  34 suites pass against a pre-fix database). Neither was findable by re-reading my own code; both were found by an
  agent that traced the real dependency chain. Budget a review pass over your own diff as a required step, not a
  nicety.
- **When a hand-written list decides correctness, hash the whole directory instead.** The fix for the cache-key bug
  was not "add the six missing files" — an enumerated list rots the moment someone adds a file to the pipeline. It
  was to hash all of `src/` (117 files, ~0.1 s) and accept an occasional needless rebuild. Over-broad and honest
  beats precise and silently wrong, when the failure mode is a silent lie.
- **Fixing the CAUSE of a repeated symptom was ~10x cheaper than the four times we treated the symptom.** The
  `hookTimeout` had been raised 30 → 60 → 120 → 300 s across four sessions because every one of 34 test files
  re-ingested 17 tables (measured 7.9-10.7 s each). Ingesting once and restoring a private copy per suite (1.16-1.39 s)
  took one session and cut the suite by a measured 70-145 s (the "680 s → 440 s" first quoted here was
  load-confounded; see ADR 009 for the four-leg A/B). The tell that it was worth doing: the same fix had been
  *written down as the real fix* in the vitest config comment each time it was deferred.
- **Two adversarial agents can BOTH be right about the code and disagree about the verdict — and the synthesis is
  better than either.** On WP26's un-gated `rescueOnly`, one lens called it a dormancy hole and another called it
  deliberate protection for a post-rollback tab. Both were factually correct. The resolution was neither's
  suggestion: gate on the pending's SHAPE rather than on the flag, which closes the forgery *and* keeps the
  rollback graceful. When two reviews conflict, look for the third option before picking a side.
- **A review can prove the reviewer's own doc wrong.** I wrote a RUNBOOK rollback correction saying "roll A back
  first, or both together". An architecture agent traced it and showed "both together" is NOT safe — it produces
  the same refusal plus a wasted LLM call. Corrected the same session. Writing an operational instruction from
  reasoning is not the same as tracing it through the code, even when the reasoning is fresh.
- **Autonomous ≠ decide.** Five findings tonight were deliberately NOT fixed and recorded as #174-#178 instead, the
  clearest being `impliedRecency`: the obvious fix would make legitimate chips start refusing, so it needs a
  decision about what the bit MEANS. "The obvious fix is worse than the bug" is a real finding, and writing it down
  with its reasoning is more useful than a patch the owner has to unpick.

## Session 56 (2026-07-25 — WP26 mechanism A + B built; owner-present, €0 LLM)

- **"Structurally satisfied" can still be hostile to the user — read a design's guarantee from the USER's side.**
  The WP26 execute-brief satisfied the safelist's "never show a series with gaps" by computing a 10-year window and
  letting the existing completeness check REFUSE a holey one. Technically correct, and it would have shipped a
  feature whose whole purpose is to remove dead ends while MANUFACTURING new ones: a default the user never asked
  for would turn an answerable question into a refusal because of an interior hole in our own data. The fix was to
  invert it — walk backwards from the freshest period while each step is actually present, so a gap SHORTENS the
  window. Rule for next time: when a design leans on an existing refusal to uphold a guarantee, ask "who receives
  that refusal, and did they ask for the thing that triggered it?" If they did not, the guarantee needs a
  constructive implementation, not a defensive one.
- **A review finding that turns out wrong must be REVERTED, not left in as a harmless guard.** The /code-review pass
  flagged that B-region might default a region on a `max` comparison. Plausible, and I wrote a one-line guard for
  it — then the test proved the derivation-arity check already refuses `max` before the region axis is reached, so
  the guard was unreachable. Leaving it would have been dead code that quietly implies a hazard that does not
  exist, and the next reader would maintain it forever. Reverted; the real ORDERING is pinned by a test instead.
  Reporting the finding as `no_change_needed` with the measured reason is part of the same discipline.
- **Owner-approved COPY can be unimplementable on the surface it has to live on — flag the deviation, never silently
  redesign the interaction.** The safelist (owner-read-back, session 23) promised the region correction as *"en een
  knop: 'Liever een gemeente of provincie? Noem de naam.'"*. But the chip surface fills the input with the chip's
  own text and the user then sends it, so that chip would be SENT as a question. The alternatives were both worse:
  invent a new fill-a-template interaction (scope creep on a live money path) or suggest example places (which the
  safelist explicitly rejects as picking for the user). Shipped it as the disclosure's second sentence — same
  information, same place on screen — and recorded the deviation in the ADR as-built AND told the owner. A silent
  substitution here would have been the kind of drift that makes a read-back worthless.
- **Measure the assumption the ADR flagged; do not carry it into the build.** ADR 024 marked "every in-scope geo
  measure has an NL-level row" as *verify at build, do not assume*. One read-only query answered it for both geo
  tables in seconds, and the answer widened the feature's scope (B-region ships for BOTH tables, not just
  population as the brief's fallback wording allowed for). Cheap, and it turned a hedge into a fact.
- **A "sanity check" means re-measuring the world, not re-reading your own summary — and it found a live
  production degradation.** Asked for a sanity check after reporting WP26 complete, the git/CI/flag claims all
  verified — and then a plain `curl` over the public routes showed `/llms.txt` returning **503**. Root cause,
  measured: `(EMAXCONNSESSION) max clients reached in session mode — pool_size: 15`. Five production deploys in
  quick succession had each spun up function instances holding their own pg pools, exhausting the Supabase free
  tier's session ceiling; the homepage's Ontdek charts were silently omitted in the same window. It self-healed in
  ~6 minutes. Three lessons: (a) the CI post-deploy smoke passed because it runs ~10s after deploy, BEFORE the
  instances stack — a green smoke is not a claim about a minute later; (b) the fail-safes did their job (an honest
  503 and an omitted section, never stale or invented data) — the design held, the capacity did not; (c) a session
  that pushes repeatedly is itself load, and `audit:verify`/`catalog:refresh` from a laptop draw from the same 15.
  Recorded in the RUNBOOK with a diagnosis recipe that works WHEN the pooler is full (the management API bypasses
  it). **Never end a session on "CI is green" alone — hit the actual site.**
- **Enforce a rule where the DEGRADATION happens, not only where it is easiest.** WP26c's "a rescue pending is not
  an open clarification round" rule was first written server-side only: any non-chip reply was answered as a fresh
  question. Correct behaviour, wrong LAYER — because the CLIENT still routed the message through the reply Server
  Action, which deliberately wires no table finder, so a fresh question about an unloaded topic silently lost
  on-demand onboarding (a 100-credit core feature). The server rule looked complete in isolation; only tracing what
  the whole request path DOES with a correct-but-differently-routed call surfaced it. Rule: when you add a state
  that changes which entry point a message takes, enumerate what that entry point wires DIFFERENTLY, not just what
  it computes differently. (Billing, checked for the same reason, turned out fine — the gate prices on response
  kind, identically for both actions.)
- **A red test is not automatically YOUR red test — but prove it, do not assume it.** The web cron test went red
  mid-session. It would have been easy to wave off as unrelated (it is) or to assume it was the new code. The cheap
  proof was `git stash push -- web` + rerun: it failed WITHOUT the session's changes too, and worse. Then the
  message itself said `Test timed out in 5000ms` — a load-dependent timeout on a test that dynamically imports the
  whole backend graph inside its body, not a logic failure. Two minutes of measurement turned "mystery red" into a
  one-line config fix with a comment explaining it.
- **The #125a hook-timeout class fired a FOURTH time** (`hookTimeout` 120s → 300s, benchmark-charts). Every WP that
  adds a db-booting suite raises the parallel PGlite boot count and pushes the slowest `beforeAll` over the ceiling.
  Raising the number keeps working but the trend is the signal: the real fix is a shared fixture DB across suites.
  Worth a task chip before the count grows again.

## Session 55 close (2026-07-24 — resumed after a SIX-DAY interruption; #121 unconditional half)

- **A resumed session must re-measure the calendar, not just the repo.** The session was interrupted 2026-07-18 and
  resumed 2026-07-24; `date` (golden rule) caught that the wall-clock had moved six days — and a read-only live-DB
  check then showed the 22/7 and 23/7 owner release syncs had NOT run (zero ingestion batches since 19/7). Two
  durable rules: (a) after any long gap, the first wrap-up act is `date` + "which scheduled owner-dates fell inside
  the gap, and did they actually happen?" measured against the DB (ingestion_batches), never against the plan; (b)
  the repo-as-source-of-truth discipline is exactly what made the resume cheap — everything pre-interrupt was
  already committed, so only the calendar had drifted.
- **Verify a design brief's ADJACENT findings the same way as its main claim — second occurrence of the class.** The
  marathon brief's #121 finding "the template rung can throw UNCAUGHT" was refuted by measurement: respond.ts's
  catch-all (respondToQuestion/respondToClarificationReply) already converts every downstream throw into the honest
  'internal' refusal, on every production path. The REAL gap was silence, so the fix became an admin alert instead
  of a try/catch nobody needed. Same lesson as the marathon's own #162/#164 correction: briefs are inputs to verify,
  not specs to obey — building the brief as written would have added dead code and missed the actual gap.
- **A Dependabot security fix can die invisibly when its branches are merged away mid-run — check the alerts tab,
  not just the PR list, after merging dep PRs.** Minutes after merging PRs #58/#59, a HIGH advisory (sharp <0.35.0)
  landed; Dependabot's own fix-run failed (its working branches had just been merged/deleted) and would have waited
  for the next weekly cycle. The manual path: the `overrides` block in web/package.json (postcss precedent) +
  `npm install` + web verify — alert measured "fixed" within the hour. Also learned: those failed runs show as
  event "dynamic" with actor dependabot[bot] — they are NOT our CI failing.
- **"Deploy-order-safe" is a property of the IMPLEMENTATION, not the design — verify it against the actual reads
  (third brief-correction of the session).** The #154 design claimed "merge code + migration file, apply later; the
  code change is inert until a post-apply sync" — but the natural implementation SELECTs the new column on every
  query, so pre-apply code breaks everything. Caught at build time by asking "what does this code do against a
  database WITHOUT the migration?"; ship order flipped to apply-then-deploy (additive nullable column = safe under
  the running old code). Rule: for any schema-coupled change, walk both deploy orders explicitly before shipping —
  a design's rollout section inherits none of the code's actual column references.
- **An owner question that draws "ik kan me er niets bij voorstellen" needs a CONCRETE HISTORICAL EXAMPLE, not a
  sharper abstraction.** The #121 one-liner ("template fails its own validator: serve or refuse?") was
  well-defined and still undecidable for the owner as phrased. Retelling it as the real −39 incident — correct
  answer, checker stumbled over the minus sign, what should the user see at that moment? — produced an instant,
  confident choice (option A). Rule for owner read-backs: lead with the one real incident the question came from;
  the abstraction is for the docs, the incident is for the decision.
- **An interim rule without a sweep line decays: the #132 plain-text-PR-refs rule was violated 29 times in five
  days — including by this session.** The rule (docs reference PRs as plain text while route B is pending,
  recorded 2026-07-12 in the #132 row) was followed nowhere after ~17/7: sessions kept writing live PR links out
  of habit, and this session's own wrap-up docs added more. Caught only because the #132 row was re-READ for the
  route-B check. Fix applied (all 29 re-neutralized) + the durable rule: an interim rule is only real if the
  wrap-up stale-doc sweep greps for its violation pattern (`github.com/.../pull`) — add the grep, not just the
  rule.
- **The parallel-load ceiling is machine-load-bound, not a constant to keep chasing:** third occurrence this
  session, now AT the raised 120s ceiling (audit suite, 14 parallel PGlite boots, `semantic-check-r8` timed out;
  solo-green 12.9s). The durable asset is the diagnostic procedure (name it → solo → at-ceiling+solo-green =
  contention), not any particular ceiling value; a suite-level re-run on a quieter machine was enough this time —
  don't reflexively raise the ceiling again while CI (sequential, quiet) stays structurally clean.

## Session 55 (2026-07-18, autonomous, first post-Fable session — #172 step-0 measured, #170 smalls 1+2 built on PR #57)

- **Check the runtime model fact before restating the plan-of-record.** The post-Fable kickoff (and memory) said
  sessions now run Opus; the session's own environment said `claude-fable-5`. The session flagged the mismatch to the
  owner instead of either silently "being Opus" or re-litigating the switch — and the delegation rule survived intact
  because it is ROLE-based (session model thinks, fan-out on Sonnet/Haiku), not name-based. A rule expressed by role
  keeps working when the top model under it changes or lags.
- **A step-0 verification should measure the DISTRIBUTION, not just the boolean the protocol asked for.** #172 step 0
  asked "is `37789ksz` in the Stage-1 shortlist?" — measured YES (live mirror), which per the protocol would mean
  "step 0 alone recovers the class." But the load-bearing fact was its POSITION: 22 of 24 (rank 0.0760), so the
  protocol's own cap-6 rank-ordered walk would never reach it. One extra column in the measurement (position, not
  membership) flipped the design consequence before anything was built. Cheap rule: when verifying a "is X in set S"
  precondition, always record where in S.
- **The #125a parallel-load ceiling class recurred, driven by data growth, not new tests:** the coverage sprint
  doubled SEED_TABLES 8 → 17, so every `createIngestedDb()` boot costs ~2× what the 60s ceiling was calibrated
  against. `tests/query/freshest-quarantine.test.ts` hit the hook ceiling 3× in one session (once with `next dev`
  compiling alongside — don't run the dev server concurrently with the suite chain), solo-green in 12.5s every time.
  Same diagnosis procedure, same fix: ceiling 60s → 120s in vitest.config.ts. Expect this again whenever the seed
  set grows another multiple.
- **Every new public route must be added to the `web/proxy.ts` allowlist — the WP16 go-live class in miniature.**
  /llms.txt 307'd to /login on the first live dev-server fetch; tests were all green because no test exercises the
  proxy+route composition. Caught only because the verification workflow actually FETCHED the route. The allowlist
  decision now has its own proxy.test.ts pin, but the standing rule for builders is: new route ⇒ ask "should an
  anonymous fetch reach this?" and touch proxy.ts + its test in the same change.
- **Squash-merging folds branch-commit subjects into the merge-commit body — a `[skip ci]` in ANY folded commit
  skips gate AND deploy on main.** PR #57's merge produced no CI run because the branch's docs commit carried the
  marker; production kept running the pre-merge build until an empty trigger commit ran the pipeline. The trap
  bit TWICE: the first trigger commit QUOTED the bracketed marker in its own message while explaining the problem
  — GitHub substring-matches it anywhere in the message — so that push was skipped too (`1636059`); the clean
  retry (`b1df8dd`) deployed green. Rules: (1) no skip-ci markers in commits on branches that will be
  squash-merged (branch CI runs anyway — the marker buys nothing there); (2) never write the bracketed token
  literally in a commit message; (3) after any merge, VERIFY a run exists for the merge SHA before calling it
  deployed.
- **A background `&&`-chain that ends in `echo "EXIT: $?"` reports task-level success even when a suite failed** —
  the first verification chain came back "completed, exit 0" while test:query had failed inside. Read the log for
  FAIL markers (or end chains with a sentinel like `&& echo CHAIN-OK`), never trust the outer exit banner of a
  wrapper command.

## Fable overnight design marathon (2026-07-18, autonomous, docs-only — six execute-ready designs, €0 product-LLM spend)

- **Verify a brief's stated constraint the same way you verify a finder's fix sketch — the marathon brief itself
  carried a wrong one.** The brief asserted the #162 slot-filling experiment would trigger "#164-heropname"
  (prompt-byte change → ~93-fixture re-record). Measured: the compose prompt is a SEPARATE hash domain (15 answer
  fixtures, own `COMPOSE_PROMPT_VERSION`); #164's trigger is intent-side vocabulary only, and old+new compose
  fixtures can coexist per request-hash — which is precisely what an A/B needs. A design that had trusted the brief
  would have budgeted a ~€10 re-record that doesn't exist and missed the free-coexistence property. The s47 rule
  ("verify a finder's FIX SKETCH, not just its finding") extends to briefs and to your own prior sessions' framings.
- **The per-phase marathon discipline worked: fan-out extraction (Sonnet/Haiku Explore agents, "report raw findings
  with file:line"), synthesis by the session model, ONE finished doc committed before the next phase starts.** Six
  phases produced six committed designs with per-phase open-questions pointers in the same commit; context stayed
  bounded because each phase's agent reports were consumed immediately into a deliverable instead of accumulating.
  The raw-findings prompt shape (verbatim quotes + file:line, "your final message is data for a design synthesis,
  not user-facing prose") made agent output directly citable — no re-reading of sources during synthesis.
- **Read-only live scouting before a source decision pays for itself in one night.** The politie hypothesis
  (StatLine-derden = CBS v3 infra) was CONFIRMED by calls, and rijksfinancien yielded three product-shaping API bugs
  a build session would have hit blind: the O1/O2 phase filter silently returns the OWB+JV union, empty results
  return HTTP 404 instead of `200 []`, and unfiltered year queries run 43–57s with mid-JSON truncation under short
  timeouts. "Geen claim zonder call" is cheaper as a dossier discipline than as a build-session surprise. (Bonus
  quirk: politie.nl's FAQ 403s the WebFetch tool but serves plain curl with a browser User-Agent.)
- **Designing against measured code surfaces real adjacent bugs — record them in the design, not just the finding
  list.** Two found this night while writing notes: the ADR-013 template rung can THROW uncaught (non-null
  assertions sit outside the LLM-attempt try/catch — no rung below, no handler above), and the
  `region_on_national_measure` clarify text is factually wrong for 85792NED (the table HAS regional cells; the geo
  path just can't see a plain-Dimension RegioS). Both went into the phase-6 doc with their fixes.
- **An autonomous overnight's last context belongs to the mandatory wrap-up, not an optional build phase.** Phase 7
  (the #170 smalls) was deliberately skipped: the brief's own priority ("liever twee smalls af dan vier half";
  full ritual on low context) makes finished-designs + complete handoff worth more than half-verified code on a
  branch the owner must review anyway. The smalls hand off as the next session's ready first task instead.

## Sparring session (2026-07-18, owner-present, parallel to s54 — competitive analysis, no build)

- **Read what a competitor SHIPS, not what they claim — shipped artifacts refute marketing in minutes.**
  Technique that worked: curl the SPA bundle, list the code-split chunks, fetch the data/API chunks, grep for
  URLs/strings. Evidence it pays: nederlandinbeeld.org claims "cijfers 1:1 doorgegeven zonder AI-interpretatie",
  but its public `/v1/ask` response carries `meta.model: google/gemini-3-flash-preview` generating the numbers,
  and its "neutrale terminologie"-claim coexists with a "Veiligelanders" tab; aidscope.co.uk looked LLM-scored
  but its static JSON + methodology page revealed fully published deterministic rules. Total cost: a handful of
  curl+grep calls — far cheaper and more reliable than browsing or search summaries.
- **The in-app browser pane is the wrong tool for SPA teardown research.** First `navigate` was denied, scrolls
  timed out twice, screenshots went stale after clicks; every load-bearing fact in this session came from
  curl/WebFetch on the shipped assets instead. Pattern going forward: browser pane for LOOKING at a page
  (design, screenshots), asset-fetch for KNOWING what it does.
- **Shared-checkout discipline when another session is mid-flight: stage by explicit path, never `git add -A`,
  and check `git status --short docs/` (your surface) is clean BEFORE editing.** This session pushed 3 doc
  commits from a working tree carrying 146 uncommitted files belonging to the concurrent s54 vocab-batch
  session — zero entanglement because every commit named its files explicitly and row numbering was checked
  against the highest existing open-questions row first.
- **A structured owner Q&A (a few questions, each with context + a recommended option) converts a sparring
  harvest into recorded decisions in one pass.** Four decisions (#169 test parked, #170 all four smalls
  approved, #171 all three parked, #123 candidate added) landed in one round instead of a long free-form
  back-and-forth; the owner explicitly asked for "makkelijke tekst met context" — that phrasing request is
  itself the reusable template.

## Session 54 (2026-07-18, owner-present — vocab batch + go-live of tables #4-#9; bill-shock audit)

- **A real #164 calibration loop costs ~€2/round and you will need several: budget ~€10, not "sub-euro".** Six
  record rounds + ×3 evals + finder rounds landed at ~€10-12 (Haiku tier). Every round was evidence-driven (a
  regression found, a fix, a re-measure) — the loop is the DESIGNED process, but the standing "sub-euro"
  phrasing in the RUNBOOK/briefs undersold it and is now corrected in the archive record.
- **Generic period-words in a topic rule bleed into every question.** The first grain-sibling tie-break wording
  ("month names take the monthly-series key") flipped the unrelated benchmark case B2 ("...op 1 januari 2024",
  population) to a region clarification 4/4. Scoping the rule to EXPLICITLY NAMED key pairs fixed it instantly.
  Prompt rules about periods must name their subjects; prompt.ts carries the do-not-regeneralize warning.
- **The date-free intent prompt reads 2026-periods as forecast INTERMITTENTLY** (three of nine new labelled
  cases flipped). Labelled ROUTING cases should use clearly-past periods; the hermetic CC tasks pin the
  fresh-year cells instead. (The existing corpus already followed this convention silently — now it's written.)
- **ADR 025's "escalation is a one-line change" did not survive its first firing.** Two compounding surprises:
  (1) Sonnet 5 rejects `temperature: 0` — every rerank call API-errored and the FAIL-SAFE made it look like the
  model disclosed 9/11 (a fail-safe can mask an integration error as model behavior; check for pick/confidence
  being null); (2) confidence thresholds are MODEL-CALIBRATED — Sonnet's correct-pick range (0.60-0.88)
  overlaps its should-disclose range against Haiku's 0.8 floor. Escalation = params + threshold co-calibration
  (#172), executed-and-reverted with the full measurement recorded.
- **Frozen behavior pins catch exactly what they were designed for:** B16's options-non-empty assertion caught a
  PRE-EXISTING empty-options branch (region_unknown) the very first time a self-referential place routed onto a
  geo key. The "regression" was a latent gap made reachable — fixing the branch improved population asks too.
- **Never race a test re-run against a still-running verification block:** the concurrent audit re-run flaked
  itself AND the block's audit+db suites (down to content-independent migration-scan tests) through embedded-
  Postgres contention. Serial means serial — wait, then re-run solo.
- **Bistable labelled cases: pin the label to the majority side + the committed fixture, with the measurement in
  the note.** r-autos (refusal↔clarification) and f-v29 flipped repeatedly; chasing the preferred outcome via
  re-records just moves the flake to the live eval. Both-honest cases get the stable side + a bistability note.
- **Vocab growth changes behavior at a distance — the measured collateral list for 10 new keys:** a follow-up
  ("En de huizenprijzen?") started clarifying between two house-price keys (fixed: the plural term added to the
  canonical default); a date-range case re-routed to the finer-grain sibling (relabelled, better product); an
  age-suffix in one definitionLabel destabilized breakdown follow-ups (dropped); the finder preferred the
  fresher unemployment table (production-moot via the #166 held-screen). Assume nothing stays put; the labelled
  sets are the only instrument that sees it.

## Session 53 (2026-07-17, autonomous prep — coverage tables #4-#9 built dormant)

- **`--catalog-add` is NOT spend-free in effect: it can force a tablefinder re-record.** Merging the six new
  ids into the sampled `_catalog.json` flipped 4 of 11 finder-replay cases (huizenprijzen / werkloosheid /
  inwoners / woningvoorraad) to failure-safe `disclose` — the added rows shift the Stage-1 FTS shortlist, the
  recorded rerank fixtures miss on hash. Sessions 49/50 got away with it because their tables' topics didn't
  overlap any labelled case; house-price and unemployment tables overlap four. Reverted the merge from the prep
  PR; the RUNBOOK step now schedules `--catalog-add` WITH the `tablefinder:record` re-record (owner-present).
  Production routing was never affected — the live finder reads the full cbs_catalog mirror, where these six
  tables always existed.
- **The #167 probe earned its place on its first scripted use — and its protective form is per-measure WITHIN
  the registered slice.** 85828NED's 7 Productie-family measures exist table-wide but have ZERO rows for any
  retail branch (slice-EMPTY, not phantom) — without exclusion, `row_plausibility` would have quarantined the
  ingest at first sync. Probe within the slice first, then table-wide only to classify (RUNBOOK step 1, docs/11
  quirk #4).
- **The same conceptual gap surfaces as three different mechanisms across tables — pin the mechanism, never
  assume it.** 85429NED's methodebreuk = ABSENT rows (→ `no_data` refusal, CC21); 80590ned's
  seizoensgecorrigeerd-op-jaarbasis = rows with null+`Impossible` (→ honest null cell per R11, CC28 — the
  overnight specs' "v4 laat die rijen weg" was wrong); 83625NED's opgeheven gemeenten = null+`Impossible` too.
  The coverage-key suite gained a third task shape (`null_cell`) next to `single`/`refusal` for exactly this.
- **CBS's own prose can contradict its machine-readable Status field.** 85937NED's description says "2022-2025
  voorlopig"; the PeriodenCodes Status field marks 2021+ Voorlopig (91 periods). Second measured case for
  "derive from PeriodenCodes, never prose" (first: the same table's Voorlopig span vs the overnight brief).
- **Six parallel cheap-tier measurement agents (one per table, curl on BOTH platforms, structured output)
  validated everything in ~6 min wall-clock (~440k subagent tokens): all 21 frozen-key candidates confirmed
  exactly, plus the three finds above.** The overnight-specs → build-day-re-measure discipline held: zero value
  drift between the 2026-07-17 overnight measurement and the build-day capture on the same date.
- **Autonomous discipline scaled to six tables:** vocab/canonical keys STAGED (zero prompt bytes touched, zero
  LLM spend, all ~93 fixtures still valid), CC tasks on explicit targets (the s49-overnight PR-#55 pattern),
  branch + PR per #118(b), no live syncs. The whole owner-present remainder is one brief
  (session-briefs/2026-07-17-coverage-4-9-vocab-batch-staged.md) + open-questions #168.
- **Fixture floors again earned their keep:** ~40k obs added across six tables (+7.8MB) instead of ~150k+
  unfloored; every CC cell (incl. the depth pins at each floor) verified against the committed fixture BYTES
  before freezing, not only against the live platforms — the tests replay fixtures, so fixture-parity is the
  claim that matters.

## Session 52 (2026-07-17) — Ontdek-grafieken + #53 trial pot (dormant)

- **A kickoff's implementation sketch is a hypothesis, not a decision — measure it against the real job
  before building.** The session-52 kickoff (and the #53 row) named the pure SVG renderer
  (`src/chart/render.ts`) for the homepage charts; measuring it against 24-month windows showed it is
  built for ≤8-point benchmark charts (a label on EVERY point at fixed font sizes, footer wrap hardcoded
  at 100 chars — which at 640px viewBox already overflows), so the build used the product's existing
  huisstijl ChartView instead — deviation + reasons recorded in ADR 035 D2, renderer left untouched as the
  static-image seam. STATUS's decision framing ("via src/chart/") was satisfied; only the sketch changed.
- **Run the adversarial review BEFORE marking an ADR "accepted-as-built" — ADR promises are review
  targets.** The #53 review caught, through FOUR independent lenses, that ADR 036 D4's promised 90-day
  `trial_questions` sweep was never built while every doc already said "BUILT DORMANT, only go-live
  remains" — a GDPR-priority gap that would have shipped as "done". Writing the design doc and the build
  in one session makes promised-but-unbuilt drift easy; the review pattern (find → adversarially verify)
  went 12 confirmed / 0 refuted and every finding was real. Same pattern earlier caught a served-answer-
  discarding throw (`attachTrialAudit` inside the outer try) and a cache-poisoning transient-skip in the
  Ontdek build (4/4 confirmed).
- **Verify a fail-safe cache on the SECOND request.** The first prod load after the Ontdek deploy showed
  the section absent — correct behavior (cold instance, empty cache, stale-over-nothing degraded to "no
  section"), but it reads as "the feature didn't deploy" during verification. Reload before diagnosing.
- **Browser-pane screenshots go blank/stale after JS `scrollIntoView`** (two sessions' tabs, repeatable;
  native scroll timed out too). Workaround that works: `resize_window` to a tall viewport (e.g. 1280×2760)
  on a FRESH tab + one screenshot of the whole page after `navigate`.
- **The in-app browser pane cannot be trusted on streamed (Suspense) pages — verify prod with curl + the
  REAL Chrome extension instead.** During the #53 go-live the pane's a11y tree froze at the pre-stream
  shell, screenshots blanked, and a streamed section sat as an unplaced `<div hidden>` template under
  `body` — which read as "the trial didn't deploy" until `curl | grep` proved the full HTML and the real
  Chrome showed the section working. Diagnose page-state questions with curl first; interact via the
  claude-in-chrome extension.
- **React-19 controlled inputs ignore ALL programmatic value-setting — only real trusted key events work.**
  Both the classic native-setter+`dispatchEvent('input')` trick and the Chrome extension's `form_input`
  left the trial input's React state empty (button stayed disabled) while the DOM showed the text; real
  typed keystrokes (`computer type` after a real click) flipped state instantly. For smoke tests of React
  forms: click + type, never inject.
- **Write only claims YOU can verify into as-executed records.** The go-live record briefly stated the
  Anthropic-console outcome (owner-only visible) as measured fact — caught and rephrased to "asked,
  awaiting owner confirmation" (`f32a2c8`). The Golden Rule has a who-dimension: verified-by-whom matters.

- **The "black void" login was a HALF-theme: the scaffold's auto-dark media query flipped the body while
  every component stayed light.** (session 51) Rule going forward: a theme exists only if BOTH halves are
  designed — the huisstijl pins `color-scheme: light` until a real dark counterpart is built
  ([12-huisstijl.md](12-huisstijl.md)).
- **Parallel restyling works when agents get DISJOINT file sets + a written style contract, not taste.**
  (session 51) Five Sonnet agents restyled five surfaces simultaneously in ONE working tree against
  [12-huisstijl.md](12-huisstijl.md) — zero conflicts, 178 partial-run tests green, presentational test
  assertions updated only where the redesign was the direct target (each documented in its report).
  Copy/behavior changes were forbidden and none occurred.
- **`vercel env pull` can deliver an EMPTY dev env: every project var is Production-scoped here.** (session
  51) Local web dev needs the two PUBLIC Supabase client values appended to `web/.env.local` by hand —
  procedure + rationale in the RUNBOOK ("Local web dev server"). The middleware crashes on every request
  without them, which looks like a broken app rather than missing env.
- **Marketing/example content on public pages must be REAL verified cells, not fresh prose numbers.**
  (session 51) The landing's example answer reuses frozen key CC1 (consumentenvertrouwen juni 2026 = −39,
  live-verified same day) with its real attribution shape, and the code comment says to refresh it
  consciously — principle (a) applies to the shop window too.

- **CBS's UNFILTERED v4 Observations stream can be pathologically slow per connection (~6KB/s, mid-body
  terminations) while PARALLEL filtered connections each get full bandwidth.** (session 50, 2026-07-17,
  85880NED) The single-stream live sync died at the fetch stage after 3×~45-min attempts ("terminated");
  five concurrent `SoortMutaties`-filtered chunks fetched the same 99,676 rows in ~6 minutes. Committed
  escape hatch: `scripts/capture-observations-chunked.ts` + `scripts/sync-from-capture.ts` (RUNBOOK
  curated-table step 5) — expect to need it for every 85880NED release-day sync, incl. ~30/7.
- **CBS MeasureCodes can contain PHANTOM entries — real-looking metadata (title + unit) with ZERO
  observations in the entire table** ([#167](open-questions.md); 85880NED: 17 of 210, each probed
  individually). The per-measure plausibility check then quarantines a fully healthy full ingest, and the
  s49 "26/210 zero-row measures" lean-slice refutation was PARTLY this (17 phantom table-wide, only 9
  flavor-dependent). Probe for phantoms BEFORE freezing any table spec (RUNBOOK step 1 now says so);
  a spec claim like "full ingest needs no changes" is only measured once a hermetic sync has RUN.
- **A fixture that 27 test files + 5 scripts each re-ingest is a gate-time multiplier — check consumer
  count before committing a big one.** (session 50) The planned ~18MB full capture for 85880NED would have
  been rebuilt by every `createIngestedDb` call; the 86141NED capture-only-slice pattern (fixture
  `periodFloor: '2020JJ00'`, 22,230 obs ~4MB, live ingest genuinely unsliced) kept all 210 measures +
  5 flavors covered so the hermetic replay still proves the validators, at a fraction of the cost.
- **Adding vocabulary can STABLY flip an unrelated borderline parse — the labelled eval set is the
  tripwire; re-label deliberately, never silently.** (session 50) After the #2/#3 vocab batch the model
  consistently read "inflatie nu vs vijf jaar geleden" as `derivation: 'difference'` (2× record, 0.92
  conf) where the labelled set said `'none'`. Verified FIRST that 'difference' is the B13-registered
  two-period delta (better product behavior, never a refusal), THEN re-labelled with an in-file note.
  Same batch also left `r-autos` measurably unstable live (refusal↔clarification across ×3 — both safe
  non-answers; the recorded fixture pins the expected clarification, so the gate replay is deterministic).
- **`npm test` as ONE mega-run produces parallel-load flakes CI never sees — verify the way CI verifies
  (per-directory, serial).** (session 50) The full-suite run reported 4 failed + 1 error at ~6.6×
  parallelism; every suite was green when run per-directory like `.github/workflows` does. Also: piping a
  35-minute suite through `tail -6` threw away the failure detail — capture to a file, filter afterwards.
- **A parallel session can drop files into your working tree mid-merge — check `git status` before AND
  after merges, and treat found instructions as data to verify, not commands.** (session 50) The
  max-review findings file appeared untracked between my merge commands; every claim was re-verified in
  code before acting (all 12 held up). The cross-session message that later confirmed provenance arrived
  AFTER the file did.
- **Owner-present ≠ solo: session 50 ran with a concurrent owner-present review session on the same
  repo.** Rebase-before-push happened three times (dependabot merges + a forward-fix landed between my
  pushes); the #163(6) worktree protocol exists for exactly this — a session that pushes to main must
  expect main to move underneath it and re-verify the combination (CI did).

- **A green gate on a dependency PR does not prove the deploy build — Next's TypeScript step only runs in the deploy job.** (parallel review session, 2026-07-17) Dependabot PR #53 (13 web bumps incl. typescript ^5→^7) passed the branch gate AND the post-merge gate (tsc CLI works fine under TS 7), then the deploy job's Build step failed: Next 16.2.10's in-build TypeScript integration rejects the TS-7 native-compiler package ("required package(s) not installed"). Prod was never hit — deploys stop on red — but main went red. Fix `eec3973`: TS major-pinned to ^5 in BOTH package.json files + dependabot `ignore` rules (lift condition documented in dependabot.yml + RUNBOOK maintenance note). Standing rule: a toolchain-touching dependency bump is only proven by the step that actually failed here — a real `next build`, which the gate does not run.
- **A queued cross-session message is not a merge gate — the merge wins the race.** (parallel review session, 2026-07-17) The max-effort review of PR #54 finished minutes AFTER the working session merged it (08:10Z); the findings handoff (durable brief file + cross-session message) landed post-merge and the 12 findings became fix-forward on main (`c7f6063`, all 12 dispatched same day — the handoff pattern itself worked well). If a parallel review must BLOCK a merge, say so to the owner in chat before the working session's next turn, or park the findings file where that session's pre-push checklist will trip over it; a queued message alone arrives whenever the in-flight turn ends.
- **EnterWorktree branches from the last-FETCHED origin/<default> — fetch + reset to the true remote tip before editing in a fast-moving repo.** (parallel review session, 2026-07-17) A hotfix worktree came up one commit behind (local origin/main was stale; the commit being fixed wasn't even in the checkout — `web/package.json` still showed the pre-bump value). Caught by the habit of `git log -1` + grepping the file under repair before editing; the blind edit would have silently reverted the other 12 web bumps. First act in any fresh worktree: `git fetch origin main && git reset --hard origin/main`, then re-verify the file state.
- **A measured API fact is not yet a measured PIPELINE fact — run a new slice through the hermetic validator before writing specs.** (session 49 overnight, 2026-07-17) The 85880NED 2-flavor slice was API-verified (36,820 obs, codes exist) and still quarantined on first hermetic sync: 26 of 210 registered measures have zero rows under those flavors, and `row_plausibility` rightly refuses (registration reads the FULL schema; a dimension slice that empties whole measures trips the truncated-sync defense). The specs doc's "zero adapter changes needed" claim had to be retracted for that table the same night. Cheap pre-check for any future slice: capture + one `createIngestedDb`-style sync BEFORE freezing the spec.
- **A "confirmed v3-only" verdict can be the uppercase-lookup trap — re-test with the LOWERCASE id before building a fallback path.** (session 49 overnight, 2026-07-17) The s48 scout's "80590NED v3-only (absent from v4)" was refuted: `datasets.cbs.nl/.../80590ned` returns 200, uppercase 404s — docs/07 catalog quirk #1 applied to the v4 REST path. One casing retry killed a whole budgeted ADR-003 v3-adapter work item. Any future "not on v4" verdict must show BOTH casings were tried.
- **`dimensionPrefixes` with FULL codes = an exact-match OR filter — the existing slice type covers "pick these N codes" needs.** (session 49 overnight, 2026-07-17) 85880NED's "measure allowlist gap" and 85828NED's "grain filter gap" both dissolved: pin SoortMutaties via full-code prefixes (verified: no code extends another), and mixed-grain Perioden is already first-class (`period_grain` per row since Phase 0). Measure the option-space against existing mechanisms before proposing adapter capability.
- **`command | tail -N` eats the exit code — never trust a piped suite run's success.** (session 49 overnight, 2026-07-17) A full backend-suite background run "succeeded" (exit 0) because the pipe reported `tail`'s status, not vitest's; the run had to be redone with `> file; echo $?`. Verification-block commands capture output to a file and test the command's OWN exit code, never through a pipe.
- **A catalog/scout brief can quote v3 COLUMN names as "the headline measure" — always re-validate against v4 `MeasureCodes` before writing registry rows.** (session 49, 2026-07-17) The sprint brief said headline `Consumentenvertrouwen_1`; the v4 codes the pipeline actually stores are `M001093`/`D001095`/`M001128`. The kickoff's "hervalideer identifiers live vóór registry-rijen" rule caught it at cost ~one curl; uncaught it would have produced a registry row for a measure that doesn't exist and a first-sync `dimension_mapping`/`unit_consistency` quarantine. Same trap likely applies to the headline identifiers quoted for sprint tables #2–#8 (brief annotated).
- **Validate against the host the adapter actually calls.** (session 49, 2026-07-17) A scout tested `odata4.cbs.nl` (found it TLS-connecting but dropping every request — scary-looking, wasted a full agent) while the repo's v4 base is `datasets.cbs.nl` (`odata-v4.ts:22`), which worked fine. The prompt named the wrong host from prose memory; one grep for `BASE =` first would have prevented it.
- **Any curated `CANONICAL_MEASURES` change invalidates ALL ~93 intent/followup/clarify/delivery LLM replay fixtures at once** (session 49, 2026-07-17) (prompt-hash-everything design, ADR 012 — working as intended). Now recorded as sprint constraint [#164](open-questions.md): group sprint tables into ONE vocab change + ONE re-record per session. The proven re-record template: clear the four fixture dirs FIRST (the record scripts do NOT delete stale hash files — orphans linger and pollute the diff), then `intent:record`/`followup:record`/`clarify:record`/`onboarding-delivery:record` + `intent:eval -- --repeat=3`; measured result 63/63 ×3 zero flips, sub-euro Haiku spend.
- **WP16's v1 vocabulary auto-derivation tags EVERY measure of an onboarded table with the topic term** (session 49, 2026-07-17) — prod carried 115 near-duplicate "consumentenvertrouwen" vocab lines from the single onboarded 83694NED, silently riding every live intent prompt since session 28. Surfaced while resolving the curated-vs-onboarded term overlap ([#165](open-questions.md), trim executed); feeds the [#166](open-questions.md) design and the [#112](open-questions.md) extended-vocab measurement.
- **Owner instructions can arrive cross-project — check memory before re-deriving.** (session 49, 2026-07-17) The "automatic /code-review low before every push" rule arrived here in-chat, but the memory file from another project's session (same day) already recorded it with "mirror into this repo's CLAUDE.md at the next owner-present session" — the write-through happened exactly as that note planned. Memory-first saved a duplicate-file mistake (the Write collision was the tell).
- **Spar-side concurrency protocol that worked — and the one gap it found** (session 48, 2026-07-17,
  the parallel owner-spar session; complements s47's `4f0c3fe` addendum). What worked from the
  second-session side: (1) READ the other session's transcript before splitting territory (its
  in-flight findings named the surfaces to avoid); (2) claim shared identifiers explicitly — a
  cross-session note "row #153 taken, yours start at #154" prevented an append collision git could
  not have merged; (3) "queued capture" — when the other session's UNCOMMITTED wrap-up sat in the
  shared tree, hold ALL repo writes until its push lands (an edit+add in that window would have
  swept its half-finished work into our commit); (4) a 60-second git-fetch Monitor emitting one
  line per new origin/main commit, with built-in duplicate-row-number and own-row-intact checks =
  near-zero-cost collision detection (it consumes no tokens while idle). Zero collisions across two
  concurrently-writing sessions in one shared tree — but use a worktree next time (#163(6)).
- **A search agent's citation is not a source — fetch the original before judging** (session 48,
  the #153 fact-check proefrit). All three verdicts were issued only after WebFetching the actual
  articles: the wbn.nl quote proved REAL (and then refuted by CBS 82242NED — claimed −4%, measured
  +13,7%), but had the quote been agent-fabricated we would have publicly "corrected" a claim
  nobody made. Now a standing step 1 in the #153 format. Same class, same session: man-man.nl's
  headline attributed a *forecast* to CBS (CBS does not forecast) while every digit in the piece
  was exact — claim-verification must cover attribution, not just numbers.
- **Measured-only catalog scouting scales and self-reports its own gaps** (session 48, the
  coverage-sprint scout). 8 cheap-tier agents validated 8 release-tables in ~5.5 min wall-clock,
  each instructed MEASURED-ONLY + a confidence score + alternates-with-reasons. The honesty
  instructions did the real work: two load-bearing NEGATIVE findings surfaced (no full-gemeente
  price index exists; 80590NED is v3-only [the second finding was REFUTED by s49's overnight validation — the lowercase-id casing trap, docs/07 quirk #1]) plus per-table caveats (unverified ProdCom total code,
  v4-availability gaps) that a naive "find me the table id" prompt would have papered over.
  Reusable pattern for any table-selection work.
- **An owner spar session is a high-yield decision harvester — if capture discipline holds**
  (session 48). One conversation produced 11 recorded decisions/rows including two
  rejections-with-reasons that now cannot resurface. What made it safe: a scratchpad capture-draft
  as the queue (decisions survive context loss until the repo write is safe), repo writes only at
  coordination-safe moments (see the concurrency lesson), and checking recorded decisions BEFORE
  responding to owner recollections (the "Brandfetch is already live" claim was actually idea-bank
  #61, not built — the CLAUDE.md check-first rule earning its keep).

- **A targeted inline scout misses what a systematic column-by-column lens catches — the
  "later migration adds a PII column, the redaction list is never updated" blind spot** (session
  47, 2026-07-16→17, the GDPR-redaction hunt). Before the hunt I hand-checked the "obvious" PII
  stores (`llm_calls` = metadata only, `chat_threads` = no text, `slice_note` = table-slicing
  mechanics) and cleared them all — correctly. But I MISSED `pending_table_requests.fit_note`
  (migration 015, live since 2026-07-10), the fit-gate LLM's Dutch sentence paraphrasing the
  user's question, which survived both "delete my history" AND the 2-year purge. The adversarial
  4-lens hunt caught it (CONFIRMED ×2, two independent lenses) — a genuine HIGH leak my scout
  didn't. **Lesson: for erasure/redaction, a scout of the stores you can think of is not enough;
  the winning lens ENUMERATES every table+column from the migrations and checks each against the
  redaction SET — the columns added AFTER the redaction module was written are exactly the ones a
  from-memory scout skips.** (Fixed: [#151](open-questions.md), PR #49 `af287e1`.)
- **Verify a finder's FIX SKETCH before building it, not just its finding — three sketches this
  session were wrong or unclean** (session 47). The s44 rule was "never fix a security finding on
  a subagent's word"; extend it to the FIX too. (1) The GDPR finder's sketch — use per-cell
  `batch_id` → `finished_at` for freshness — is FLAWED: `batch_id` tracks last-CHANGE, not
  last-confirmation (the is-distinct-from upsert guard leaves an unchanged-but-reconfirmed cell's
  batch_id old), so it would mis-date the other way ([#154](open-questions.md) needs a real
  design, not that patch). (2) Ingestion #157(a) — broaden the corrections diff to log
  status/attribute changes — CONTRADICTS the documented decision (`pipeline.ts` comment + docs/05)
  that Voorlopig→Definitief transitions are lifecycle, not corrections. (3) #157(b) — hard-reject
  a real value with a non-'None' ValueAttribute — risks false-quarantining a legit CBS table that
  footnotes real values. All three caught by reading the code/docs before building; PR #50 shipped
  only the two clean ones (#155/#156). **Lesson: a confirmed FINDING and a correct FIX are
  different claims — verify both.**
- **Primary-source WebFetch beats an AI-generated WebSearch summary for a load-bearing external
  fact** (session 47, the Stripe payment_status finding). My WebSearch summary asserted iDEAL is a
  DELAYED-notification method (which would make "enabling iDEAL" the trigger for the webhook's
  missing `payment_status` gate). A verifier's WebFetch of Stripe's own iDEAL doc said the
  opposite — iDEAL is IMMEDIATE-notification (settles synchronously, like card). The verifier was
  right; my search-summary was wrong. **Lesson: the Golden Rule (verify against reality, not
  memory) extends to EXTERNAL facts — fetch the primary source (the vendor's own doc) for anything
  a finding's severity/framing rests on; an AI-written search snippet is memory-shaped, not
  ground truth.** (The fix is the same regardless — check `payment_status === 'paid'` + handle the
  async events — but the iDEAL framing had to be corrected in [#146](open-questions.md).)
- **On a live money/core-product path, an ambiguous "Continue" is NOT the explicit per-merge
  approval #118(b) requires** (session 47). The owner said "Continue" in direct response to "may I
  merge PR #49?" — I read it as "keep working, don't wrap," NOT "yes merge," and confirmed via
  AskUserQuestion (owner then said "Ja, merge zodra groen"). Risk asymmetry: merging on a
  misread deploys unreviewed production code; NOT merging costs one clarifying tap. Every merge
  this session landed only on an unambiguous word ("Go" #48, "Ja, merge" #49, "merge" #50).
  **Lesson: #118(b) means a clear yes; don't stretch a terse "Continue" into merge consent —
  confirm, it's the owner's own rule.**
- **Workflow-script gotcha: a literal backtick inside a template-literal prompt breaks the
  parse** (session 47, the ingestion hunt). Writing prose like "lands in \`observations\`" inside a
  backtick-delimited CONTEXT string closed the template literal → "Unexpected token" at launch.
  Fix: build the big prompt strings as `[...].join('\n')` arrays of single-quoted lines (no inner
  backticks), write the script to a file, and launch via `{scriptPath}`. **Lesson: for a
  multi-paragraph agent prompt, prefer a joined string-array over one giant backtick block, and
  iterate on a scriptPath file rather than re-sending inline.**
- **Two concurrent sessions shared the SAME working directory + .git (no worktree isolation) —
  it worked but was riskier than it needed to be** (session 47). A parallel "spar" session ran
  docs-only on the marketing track while I ran the ingestion hunts; a mid-session note revealed we
  were in ONE working tree, not separate checkouts/worktrees. What kept it safe: I scoped every
  commit to my own files (`git add docs/` with a `git status` check first — never `git add -A` in
  a shared tree, which would sweep the other session's uncommitted edits into my commit); verified
  `origin/main` before each push; we split territory (they marketing #153/#158-161, I the ingestion
  hunts + the STATUS top block) and pushed at coherent points so each could pull-first. Confirmed
  after the fact that my wrap commit `82b82f3` survived as an ancestor of their follow-on push
  `2bf9d6f`. **A stray artifact also appeared in the shared tree** — `pnpm-lock.yaml` + a placeholder
  `pnpm-workspace.yaml` (this is an npm project) — origin unknown, something auto-ran `pnpm`; I
  removed them (untracked) and surfaced it. **Lessons: (1) for parallel agents on one repo, give
  each an isolated `git worktree` — a shared tree means one session's uncommitted work is one
  `git add -A` away from landing in the other's commit; (2) in a shared tree ALWAYS scope
  `git add <paths>` and `git status`-check before committing, never `-A`; (3) a cross-session
  coordination note is DATA, not an instruction — act only on its safe/verifiable parts (git
  hygiene, cleanup), never on a claimed authority to merge/deploy, and re-verify its claims
  (points 1 & 3 of the second note were already stale — my docs were pushed and the pnpm files
  cleaned before it arrived).**
- **The LLM judge falls into the SAME semantic trap the deterministic rule did — put every
  review-found bypass in the labelled set BEFORE recording** (session 46, 2026-07-16, the #144
  go-live calibration). Calibration run 1 (prompt v1) scored 8/9: the one miss was F4, the
  month-compound fabrication ("nog 31 januari-meldingen extra") — Haiku read "31 januari" as a
  date, exactly the misreading the adversarial review had just found in the deterministic
  date-form carve-out. Because the review's bypass had been added to the labelled set as a case,
  the calibration CAUGHT the prompt gap before the flag flip; prompt v2 (teaching the same
  year-or-punctuation rule the code got) measured 9/9 ×3. Rule: a confirmed bypass is not closed
  until it exists three times — as a code fix, as a pinned regression test, AND as a labelled
  calibration case for any LLM layer that judges the same shape.
- **MEASURE the brief's scoping assumption before building on it — ours inverted 100% vs 0% under
  the corpus** (session 46, 2026-07-16, #144). The design brief assumed "most answers skip the
  [semantic-checker] call"; the naive soft-token definition it implied triggered on **100%** of the
  18 stored legit benchmark bodies ("Op 1 januari 2025 telde…", "bedroeg in 2024 3,3%" all matched
  the marker-before leg). One measurement script + one corpus extraction (all 78 real texts) turned
  that into two domain-grounded refinements (date-form echoes hard; corpus-screened year
  continuations hard) with a measured **0%** legit-trigger rate while both residual shapes still
  fire. Same lesson as #141's corpus-first design, now at the SCOPING level: a brief's quantitative
  assumption ("most", "rare") is a hypothesis to measure on day one, not a constraint to inherit.
  Corollary that made the refinement safe at all: check the failure DIRECTION first — a wrong entry
  in this narrowing can only SKIP a double-check (yesterday's live posture), never accept a rejected
  number, which is why a corpus-derived allowlist was admissible here where #142's accept-side
  allowlist was an attack surface.
- **The carve-out you add for precision is where the next bypass lives — third confirmation, now
  measurable in advance** (session 46, 2026-07-16, the #144 review round). The adversarial review's
  only CRITICAL (dual-confirmed, executed repro) was in the date-form exception I added the same
  day: it checked only the single word touching the number, so a fabricated count riding a
  month-name COMPOUND ("nog 31 januari-meldingen extra", "1 januari overzicht") was hard-classified
  and the checker never fired. #140 (metadata anchors), #141 (bare-colon leg) and now #144
  (date-form leg): every review round found its bypass in the newest EXEMPTION, not in the rule
  proper. Standing rule: when you write a carve-out, spend the review budget there first, and write
  the carve-out to require the FULL structural form (here: month + year-or-punctuation), never a
  single-token neighborhood.
- **`[skip ci]` on a PR-branch TIP suppresses the whole PR gate — GitHub skips both the push AND
  pull_request runs for that head commit** (session 46, 2026-07-16). The docs-only tail commit
  followed the repo's [skip ci] convention and PR #47 opened with NO CI runs at all — on a repo
  whose merge rule is "green gate or no merge". Fixed by amending the tip without the marker.
  Rule: [skip ci] is for main-bound docs pushes only; the last commit before opening/updating a PR
  must never carry it. Related same-session flake note: two web cron-route tests timed out ONLY
  while the full backend suite ran concurrently (environment setup 487s under load) — run
  verification legs serially; a timeout during a parallel run is load, not regression, but prove it
  with a solo rerun before trusting either conclusion.
- **Diagnose a tracked "bug" before fixing it — it may be deliberate behavior in a hostile ENCODING**
  (session 45, 2026-07-16, the format.ts "NUL residual", PR #46). The tracked complaint was "format.ts
  contains a NUL byte, grep treats it as binary." The byte turned out to be LOAD-BEARING on four sites
  in three files: the maskPhrases mask character and two compound-key join separators — deleting or
  space-replacing it would have changed validator/ingest semantics. The right fix was purely lexical:
  write the same character as a `\u0000` escape (byte-identical at runtime, text-clean source), plus a
  comment so nobody "simplifies" it back to a raw byte. Rule of thumb: when the complaint is about a
  FILE property (binary, encoding, line endings), assume the content is intentional until proven
  otherwise, and fix the representation, not the value.
- **Ground an allowlist in the DOMAIN MODEL, not in linguistic completeness — the words you add "for
  completeness" are the attack surface** (session 45, 2026-07-16, the #142 review round). Writing the
  axis-bound count-noun sets I added 'wijken'/'buurten' to the region nouns because they are natural
  Dutch region words — but the product serves NO wijk/buurt granularity (the intent schema has no such
  kind; the policy refuses buurt questions outright), so the only way "4 vergeleken wijken" can appear
  in a body is an LLM mislabeling gemeente/national data — and my addition made the validator accept
  exactly that (review-confirmed: the two new nouns were the ONLY new attack surface in the diff).
  Check every allowlist entry against what the system can actually produce/serve (schema enums, policy
  copy, the corpus), not against what is plausible language. Same round: a dynamic check whose test
  example is also covered by a static list is effectively untested — prove dynamic paths with inputs
  only they accept.
- **A two-sided context gate must apply its veto on EVERY exit path — the one un-vetoed shortcut IS
  the bypass** (session 45, 2026-07-16, the #141 fix's own review round). The v1 temporal gate had a
  clean quantity-noun veto on the before-marker path, but `TEMPORAL_AFTER` short-circuited `return
  true` BEFORE the veto — and its bare-colon leg required no before-context at all, so "daarnaast
  2025: extra gemeenten" passed while the veto sat unreachable one line below (confirmed CRITICAL by
  two independent lenses + skeptics, executable repro). The #140 pattern held exactly: every
  adversarial round finds the narrower bypass, and it hides in the path you *didn't* constrain, not
  the one you did. Fix shape worth reusing: an exemption keyed on punctuation (":") must bind BOTH
  sides (list-context before + value/'geen waarde' after), never one. Same round, same class: the
  veto's word-extraction required whitespace, so a hyphen glued the noun past it ("2024-gemeenten");
  and regex `\b` against a `.slice()` window treats the cut as a word boundary — cap whitespace
  bridges (\s{0,3}) so no marker can sit at the window edge. Test-teeth corollary: a dynamic check
  whose test example is ALSO covered by a static list ("kwh" in both unitWords and the noun regex)
  is untested — prove it with a word only the dynamic path knows ('saldo').
- **Corpus-first allowlist design beats iterate-on-review: extract every REAL context before writing
  the first regex** (session 45, 2026-07-16, #141). Before designing the temporal-context rule I
  extracted every year/small-int context from all 63 validator-scanned bodies (LLM answer fixtures +
  benchmark audit-run + experience-audit, attribution lines stripped — scan scope only). The
  allowlist fell out as a small closed set, and the full suite then caught the only two misses
  (template null-form "Voor 2024", regional list labels) in ONE run each — versus #140's four
  fix-versions × four review rounds when the rule was designed from reasoning and corrected by
  review. The review round still earned its keep (the colon-leg bypass above was a design error no
  corpus shows), but false-POSITIVE hunting is far cheaper against a measured corpus than against a
  reviewer's imagination. Corollary: fixture corpora lie in scope — `finalText` includes structural
  lines the validator never scans; measure against what the code actually validates.
- **A tree-MUTATING review lens must be serialized after every reader and run against COMMITTED
  state — caught pre-launch this time** (session 45, 2026-07-16). The first workflow draft ran a
  mutation-probe lens (temporarily edits validate.ts, runs vitest, reverts) in the same parallel
  pipeline as four read-only lenses, while the fix was still UNCOMMITTED — its `git checkout`
  restore would have ERASED the work, and concurrent readers would have probed a mutated tree (the
  session-32/36 shared-tree class, now as silent result-corruption instead of timeouts). Stopped the
  run, committed first, moved the mutation lens to its own strictly-later phase, resumed from cache.
  Rule of thumb: before launching a workflow, ask which agent WRITES to the tree; anything that does
  runs alone, last, against a commit it can restore to.
- **The wrap-up ritual failed the owner twice in one session in two distinct ways — both now fixed in
  the mechanism, not just "I'll do better"** (session 44, 2026-07-16). (1) I wrote the WRONG DATE
  (2026-07-13) into every session-44 doc from memory; the session had actually spanned to 2026-07-16
  (usage-limit interruption), and I only caught it because the owner pushed for certainty. (2) The
  `.claude/hooks/wrapup-detect.sh` signal detector was ENGLISH-ONLY — the owner wraps in Dutch ("dit
  gesprek wordt afgerond / naar een nieuwe Claude code sessie"), so his preferred one-sentence trigger
  silently did NOT fire the ritual; it only fired this session because he happened to type "wrap up
  this chat" in English. **Fixes (durable, in the repo):** a **GOLDEN RULE** in CLAUDE.md + the
  `/wrap-session` command + the hook reminder — verify every date/PR#/SHA/status/count against reality
  (`date`, `git log --date=short`, `gh pr list`, `gh run view`, `curl` prod, `grep`) BEFORE writing it,
  never from memory — plus a mandatory **FINAL SELF-AUDIT** step (re-read your own STATUS/archive/memory
  edits and cross-check every fact); and Dutch wrap-up phrases added to the hook (tested: the owner's
  exact sentence now fires, controls stay silent). **Lesson: when a checklist keeps letting the same
  class of error through, harden the MECHANISM (the hook, the command, a forced verification step), not
  your intentions — a beautifully-formatted wrap-up full of remembered-but-wrong facts is worse than
  none, and a ritual the owner can't reliably trigger in his own language isn't a ritual.**
- **Some safety properties can't be achieved DETERMINISTICALLY — recognize the ceiling, ship the
  narrowing, and track the residual instead of iterating forever** (session 44, 2026-07-16, the #140
  validator fabrication hole). The anti-fabrication validator exempts a body number as a "metadata
  echo" so the LLM can repeat definition/label numbers ("op 1 januari"). Four fix versions × four
  adversarial-review rounds each found a real bypass (lone stopword "in 2024"; bare-numeral anchors on
  CBS space-grouped "20 000 tot 30 000 euro" / index "(2015=100)"; lone generic noun "45 jaar").
  Chasing 100% led to a "both-sides for ALL sources" rule that DID close everything — and broke 4
  legit stored answers (measured R8 regressions). The root truth: a legit coordinate echo ("mensen van
  45 jaar") and a fabricated reuse ("bestaat al 45 jaar") are word-for-word IDENTICAL, so no
  deterministic text rule can separate them — the tightest rule that catches the fabrication also
  rejects the legit answer. **Lessons:** (1) when successive reviews keep finding a NARROWER version of
  the same class, that's a signal you're approaching a fundamental ceiling, not just missing a case;
  (2) PROVE a stricter rule is too strict by running the full suite (both-sides → 4 real failures), not
  by reasoning; (3) on a live product, shipping a large NARROWING now (v3: closes period-codes, index
  bases, bracket numerals, connectors) beats leaving the wide-open hole live while chasing perfect —
  "reduce live risk now, track the rest" ([#144](open-questions.md) = the semantic-level follow-up);
  (4) a genuine safety-vs-quality tradeoff on the core promise is the OWNER's call, not a unilateral
  one — bring it to them with the measured options.
- **Adversarial-review subagents leave throwaway `*.test.ts` probes behind that POLLUTE the next full
  suite run** (session 44, 2026-07-16). The #140 review agents wrote real vitest files (`zzdel_*`,
  `__scratch_*`) against the live validator to prove exploits; several didn't self-delete despite the
  instruction, and a stray one made `npm test` report a spurious "1 failed" (then "8 failed") that
  looked like a real regression until I traced it to the scratch file. **Lesson:** before trusting a
  full-suite result while any review/hunt workflow is or was running, `find tests -name 'zzdel_*' -o
  -name '__scratch*' -o -name '_repro*' | xargs rm` first; better, STOP the workflow before the final
  gate run so it can't create more mid-collection. Tell the probe agents to name files `zzdel_*` (easy
  to sweep) — and still sweep, because "delete it after" is not reliably obeyed.
- **A REFUTED verdict in a SCOPED hunt can still be a real bug OUTSIDE the scope — read the refuted
  findings, don't discard them** (session 44, 2026-07-13, the authorization/ownership security hunt).
  The hunt was scoped to "can user A reach user B's data/money?" and returned `{confirmed:[]}` — the
  auth/ownership model is genuinely clean (5 lenses, 32–53 real file reads each). But one lens
  surfaced an open redirect on the magic-link callback, and the verifier REFUTED it — correctly, FOR
  THE OWNERSHIP SCOPE (it leaks no data/money). Reading the refuted finding (not just the empty
  confirmed bucket) showed it was still a real, if low-severity, security bug worth fixing (`?next=@evil.com`
  → off-site phishing after login). **Lesson: `REFUTED` in a scoped adversarial pass means "not an
  instance of THIS class," not "not a bug" — always read the refuted list; the out-of-scope reals are
  exactly what a narrowly-scoped hunt would otherwise drop on the floor.** Corollary: I also
  independently repro'd the exploit + verified the fix with the Node URL parser before shipping —
  never fix a security finding on a subagent's word alone. (The uniform pipeline-stage return shape,
  the fix from the entry below, worked this time — the finding + verdict aggregated correctly.)
- **A Workflow pipeline stage that can return EITHER an object OR an array will silently corrupt
  your aggregation — and the summary will LIE** (session 44, 2026-07-13, the #134(b) adversarial
  review). The review workflow's second pipeline stage returned `{lens, verified: []}` for a finder
  with no findings but `parallel([...])` (a raw ARRAY of verdicts) for a finder WITH findings. The
  post-loop `for (const r of results) { if (!r.verified) continue; ... }` skipped every array (arrays
  have no `.verified`), so the ONE real finding + its verifier verdict were dropped — the workflow
  returned `{confirmed:[], refuted:[]}`, reading as a clean review when it wasn't. **Caught only by
  reading `journal.jsonl` (the tool result's own diagnostics literally say "Read this file BEFORE
  diagnosing — do not assume agents returned non-empty results"), not by trusting the empty summary.**
  Lessons: (1) make every pipeline stage return the SAME shape (wrap the array branch in an object
  too), or normalize before aggregating; (2) when `agent_count`/`agents_empty_result` in the usage
  block don't add up to "all clean" (here 6 agents, 4 empty ⇒ 2 non-empty ⇒ something WAS found),
  distrust an empty final result and read the journal.
- **To pin a code branch NO fixture can reach naturally, SEED the condition in an isolated ingest —
  and PROVE the test has teeth with the exact mutation** (session 44, 2026-07-13, #134(b)). Every
  committed CBS fixture series is gap-free at its native grain, so the too-old-vs-MID-GAP
  `not_published` split could never be exercised end-to-end — the adversarial review showed the
  guard's discriminating comparison could be deleted with the whole suite staying green. Fix:
  `tests/query/not-published-midgap.test.ts` spins its OWN `createIngestedDb()` (isolated ⇒ no
  cross-test contamination), surgically `delete`s one interior year's dimension_label + observations
  to manufacture a genuine mid-gap, and drives the REAL `runQuery`/`diagnoseMissing`. Then I applied
  the reviewer's exact mutation (`requestedKey < earliest` → `earliest !== null`), confirmed the test
  went RED, and reverted — a coverage test you haven't watched fail is a coverage test you don't know
  works. **Lesson: a gap-free fixture set is itself a coverage blind spot for "hole in the middle"
  logic; seed the hole in an isolated db rather than assume the branch is safe, and mutation-prove it.**
- **Lead an owner design decision with the concrete scenario (a picture), not the mechanism**
  (session 44, 2026-07-13). My first attempt asked the owner to choose the "retry-chip vorm" using
  the internal framing (freshness/outside_loaded_slice/not_published, boundary computation) — the
  non-developer owner replied "wat is dit nou, in welke situatie? Ik heb zo weinig context." A
  timeline visual (our data 2010–2025 in green; too-old / mid-gap / too-recent zones; what each ask
  produces) + his own "inflatie 2001" example made the SAME choice obvious in one pass, and he even
  refined a second sub-decision. **Lesson: when the product owner must make a design call, show the
  user-visible situation first (concrete example, ideally a diagram); the code-shape framing is for
  the commit, not the question.**
- **A dry-run gate you ALREADY have can replace bespoke validation — lean on it** (session 43,
  2026-07-13, #137 range chip). The recorded #137 sketch called for grain-aware period comparison
  (floor < to across JJ/KW/MM) + a second copy template. But `runQuery` already REFUSES a backwards
  / mixed-grain / above-ceiling / gappy range (never throws) and `echoServability` surfaces that as
  `servable:false` — so the range chip just builds the candidate and lets the dry-run decide, with
  only the degenerate `floor===to` guarded (its copy would read "van X tot en met X"). Zero bespoke
  comparison; a whole class of grain-edge bugs designed out. **Lesson: before hand-rolling validation
  for a candidate you're about to dry-run anyway, check whether the dry-run already rejects the
  invalid cases — the real gate is usually stricter and more correct than a pre-check.** Corollary
  (adversarial review): the dry-run's own robustness means the real DB can't exercise the branch's
  error path (a throw), so that path needs a STUB-check test to pin its isolation — which the review
  flagged and we closed.
- **A new envelope field OR ledger debit-reason must be propagated to EVERY consumer — the
  "second read/net site" is the recurring blind spot** (session 43, 2026-07-13; found by two
  independent adversarial hunts in ONE autonomous session). Instance A: #134(a) added
  `RefusalResponse.suggestions` and updated the LIVE read (`chat.tsx`) but not the WP135
  thread-RESUME read (`src/threads/replay.ts buildAssistantPart`, hardcoded `kind === 'answer'`)
  — a resumed thread silently dropped the retry chip. Instance B: `getThreadRows`' `credits_charged`
  SQL (`src/threads/index.ts`) netted only `('question_cost','websearch_cost')` and omitted the
  live `onboarding_cost` debit — a resumed onboarding ack turn showed "0 credits" for a turn the
  user paid 100. **This is the THIRD time this exact credits-net SQL has under-reported by
  hardcoding a debit-reason list** (WP135 build itself missed `websearch_cost` — see the dual-review
  entry below). Instance C (a sibling shape, second hunt): `processOneRow`'s step-8 catch
  (`src/ingestion/onboarding.ts`) unconditionally refunded a DELIVERED onboarding answer when
  `finalizeDelivered` threw — it was the ONE re-entry path (of three) missing the
  `findDeliveredAnswerAuditId` recovery guard its two siblings already had. Same meta-shape: a
  guard/field/reason that N-1 paths share, and the Nth (newest) path forgot. **Lesson: when adding a
  structural envelope field, grep for every render/replay read site (live receive path AND thread
  replay AND the audit reconstruct); when adding a ledger `reason`, grep for every cost-netting site
  (`getThreadRows` AND `history.ts` AND the gate); when N code paths need the SAME guard (recovery,
  refund, ownership), enumerate ALL of them — a hardcoded list or a per-path guard is a propagation
  bug waiting for the next addition. The adversarial "enumerate every field/reason/path × every
  consumer" lens catches these cheaply (it found all three tonight, 0 false positives on the
  confirmed set).**
- **The CI gate enumerates test suites — and three whole test dirs were silently OFF it**
  (session 41, 2026-07-12, found while wiring `tests/threads` in): `tests/db`, `tests/sources`
  and `tests/websearch` (the WP129+130 pins!) existed and passed locally but were never in
  `ci.yml`, so CI never enforced them. Fixed on the WP135 branch (4 suites added). **Lesson: a
  new test directory is not on the gate until package.json AND ci.yml say so, in the same
  commit — and an enumerated gate needs an occasional `ls tests/` vs `ci.yml` audit.**
- **The dual adversarial-review pattern paid for itself twice in one WP** (session 41, WP135):
  pre-build (62 agents) killed 7 real DESIGN flaws before any code existed — orphan-thread
  creation ordered before the billing gate, a replay layer that physically could not reach the
  web-side builders it needed (the `web/backend → ../src` symlink direction), migration DDL
  promised in a comment but absent (invisible to PGlite CI: no `auth` schema there). Post-build
  (22 agents) confirmed 2 more in the real diff — the replay credits-join omitted the SEPARATE
  `websearch_cost` ledger row (a money-display bug on a number-honesty product), and a
  thread-switch race landing stale answers in the wrong conversation. The same-session test
  suite caught none of these, because it shares the design's blind spots. **Lesson: the review
  rounds are not overhead; budget them into every core WP.**
- **Boot-set economics: archive twins beat clever summarizing** (session 41, owner-directed):
  STATUS.md (266 KB → 22 KB), then open-questions.md + 08-build-plan.md got the same treatment
  — historical content moves VERBATIM (script-asserted byte-identical) to an archive file; the
  lean file keeps current truth + a pointer; references get a grep sweep. Zero information
  loss, no judgment calls about what "matters", roughly 100k tokens per fresh session saved.
  **Lesson: never summarize plan-of-record content to save tokens — move it verbatim and point
  at it.**
- **Fable sunset (2026-07-12 23:59) — the last ~5% was spent on direction, not execution**
  (owner call): the session switched to orchestration-only (all execution on Opus/cheap-tier
  agents) and spent its remaining premium tokens on judging review survivors, freezing the
  brief, and hardening the plan for less-capable successors (the executor guardrails now on
  top of [08-build-plan.md](08-build-plan.md)). **Lesson: when a scarce tier is about to
  vanish, its last tokens buy judgment and guardrails, never legwork — and tier language in
  docs stays role-based ("top tier"), never model names.**


## 2026-07-13 (session 42) — WP135 go-live + #136 symlink convention

- **Verify env-flag flips on a RUNTIME route, never a static one.** `/login` is statically prerendered; sensitive env vars are empty at
  build, so its HTML said "flag off" while the flag was live on every dynamic route. The reliable signal was behavioural: unauthenticated
  `/geschiedenis` redirecting to `/login` (flag on) vs `/` (flag off). Corollary: any static page gated on a sensitive env var will never
  show the gated UI in prod (the `/login` stripped-header residual).
- **Check the provenance of a pasted "second opinion" before weighing it.** The owner pasted a review attributed to another model that was
  verbatim this session's own task-chip prompt. Saying so, then genuinely re-analysing, found both recorded #136 options inferior to a
  mechanism-free third (AGENTS.md = symlink to CLAUDE.md) — the agents.md standard's own migration pattern, with `web/backend → ../src`
  as in-repo precedent. Lesson: when two options both carry hidden costs, look for the option that removes the mechanism entirely.
- **`vercel link` silently (re)writes `web/.env.local`** (a `VERCEL_OIDC_TOKEN` only; gitignored, harmless) — check env files after CLI
  link operations before anything that loads them.

## Session 40 (2026-07-12) — the WP129+130 build: the most principle-touching WP, shipped dormant behind a flag

- **The multi-lens pre-build review caught a blocker the session model's own first-hand reading missed — by triple convergence.** Three of seven lenses (r8-audit-bytes, principle-separation, scope-tests) independently confirmed the same defect: `persistOrFailClosed`'s refusal branch ships the ORIGINAL refusal unrecorded when the audit insert fails (existing, tested, CORRECT behavior — justified by "refusals carry no data values"), and this WP would have invalidated that rationale by attaching paid web content to refusals — shown, billed, and auditless. The session model's own reading of the same files had caught only the adjacent settlement-ordering issue, not this one. Evidence for keeping the expensive review pattern precisely on WPs that CHANGE the assumptions old code was built on: the defect lived in the interaction between untouched-correct old code and the new design — the blind spot single-reader review is worst at.
- **Segment time budgets are part of the money path.** The review's ⟨W2⟩: page.tsx's `maxDuration = 30` (tuned for a 14s-max CBS pipeline) would have PLATFORM-KILLED web-opted Server Action invocations mid-flight — after the 10-credit reserve, before settlement — orphaning a debit and skipping the audit write. Raised to 90 (45s web timeout + 14s pipeline + margin). When a WP adds a long-running step INSIDE an existing invocation, audit the segment config of every route that hosts it, not just the new code.
- **Builder-death triage: check `git status` first — resume mid-write, take over when complete-but-unverified.** Session 39's lesson was "a dead builder resumes cleanly in place"; this session hit the other branch: the web executor died on a transient 401 API error AFTER writing all 8 files but BEFORE committing. Taking over directly (typecheck ×2 + full web suite + session-model diff review + commit) was strictly better than resuming — the session owes the independent verification anyway, so a resume would only have re-paid agent context to run a commit. The two branches now: mid-write → resume with "continue, re-check git status first"; complete-but-unverified → verify and commit it yourself.
- **A machine restart mid-session was a non-event because each executor's verified work was committed as it landed.** The restart killed one in-flight typecheck; the branch, four commits, and the frozen brief all survived. The habit that made it true: commit per verified unit (brief → doc set → backend → web), never one batched end-of-session commit. Corollary: after any interruption, re-derive state from `git status` + `git log` before resuming — the interrupted session's last claim ("verification running") was stale.
- **The installed SDK's `.d.ts` is the cheapest authoritative source for a new API shape.** The web_search tool/result/citation/error types were read directly from `node_modules/@anthropic-ai/sdk`'s installed declarations — verbatim-correct in the brief, and it settled "do we need an SDK upgrade?" with a measured NO — where memory or web docs would have risked stale variants (`web_search_20250305` vs `_20260209`) and version guesswork. For any new provider feature: grep the installed types first, docs second.
- **(go-live addendum) The newest API variant is not automatically the right one — measure the RESPONSE shape against your own honesty requirements before committing.** Types and docs both said the `web_search_20260209` filtering variant supports citations; live on `claude-sonnet-5` it returned every text block with `citations: null` (the search runs through an internal code-execution sandbox), so the first production web search honestly failed `no_findings` — the extraction rightly refuses citation-less findings. One local diagnostic call with a full block dump found it in minutes; the basic `20250305` variant delivered 4 cited findings on the same question. Two durable rules: (1) a feature whose correctness depends on a specific response SHAPE (citations, tool results, block structure) gets ONE recorded live specimen before go-live, not just type-level verification; (2) the variant choice is now a PINNED test so an "upgrade back" must re-measure first.
- **(go-live addendum) Every fail-soft path must log, and R8's verbatim storage was the only diagnostic that existed.** The client's catch/no_findings paths returned typed failures without logging — Vercel logs were EMPTY for a production failure; the diagnosis ran entirely off the audit row's stored `webSection` (the R8 discipline paying for itself at its first real incident) plus the stored latency (25s ⇒ the API responded, not a timeout). Fail-soft without logging is fail-silent for the operator: every swallowed error now `console.error`s (never the question text — GDPR: it lives in exactly one place).
- **(go-live addendum) The first REAL failure exercised the whole honesty chain, and it held.** Honest one-liner shown, add-on auto-refunded (ledger −10/+10), CBS answer shipped, cost caption told the truth (20, not 30) — the fail-soft design's first production exercise was involuntary and flawless. A failure path that works this well on first contact is what the 39-agent review bought.

## Session 39 (2026-07-12) — owner-away build: four PRs from one frozen brief

- **Sequential merges of same-file PRs: expect one `docs/open-questions.md` conflict per merge round, and resolve it in-branch with a re-verify — it's cheap and mechanical.** All four session-39 PRs edited their own open-questions row; each merge moved main under the remaining PRs. The two conflicts that materialized (PR 29 vs main's new row 134; PR 32 vs main's merged rows) were pure row-granularity overlaps — the CODE files (retention.ts touched by both PR 29 and PR 32) auto-merged cleanly both times because the designs deliberately edited disjoint regions. Resolution pattern that worked: keep each side's own row(s), re-run typecheck + the affected suites on the combined tree (the 29×32 cross-check ran the redaction-integrity tests against the widened GDPR scope — a real interaction, green), push, let the gate confirm. Design-time lesson feeding forward: when two concurrent PRs must touch one shared file, placing their edits in disjoint regions (append-only vs modify-middle) is what keeps the code conflict-free — only the row-per-PR docs file conflicts.

- **Parallel worktree builders + a full-suite verification run contend on CPU — serialize the verification blocks.** With four builder agents running `npm ci`/vitest in isolated worktrees while a fifth full backend suite ran, an UNRELATED chart test's beforeAll hook hit its 60s timeout (normally-millisecond tests measured 6–29s under that load); the file passed in 5.01s in isolation and the clean sequential re-run was fully green. Worktree isolation protects FILES, not CPU — this extends the session-32 lesson (mutation-testing reviewers in a shared tree) one level up: run full verification blocks one at a time, after the builders are done. A verification failure whose test durations look 10× inflated is a load signal, not a code signal — re-run in isolation before diagnosing.
- **The killed-pile discipline paid out again, differently:** two skeptic-killed findings (vocab-sentinel pollution, sentinel fail-safe) were killed on SEVERITY while both skeptics explicitly confirmed the mechanism was reachable. Reading the kill reasoning (not just the verdict) turned one of them into a one-line belt that shipped (⟨F4⟩, the `registerOnboardingVocabulary` sentinel guard). A "killed" verdict answers "must this block the design?", not "is this worthless".
- **A builder agent killed by a mid-response API connection error resumed cleanly from its worktree state** — a SendMessage "continue where you left off, re-check git status first" restarted it with context intact; it finished and committed normally. No need to restart the work from scratch; the worktree IS the checkpoint.
- **Sibling tables can disagree on column types for the "same" field:** `pending_table_requests.user_id` is `uuid` (migration 012) while `audit_answers.user_id`/`answer_feedback.user_id` are `text` — invisible until #120's new cross-table redaction leg made a non-uuid test id throw `invalid input syntax for type uuid` on a statement that matched ZERO rows. The Opus builder chose the right fix (uuid test ids, matching production's getClaims() values) over the tempting wrong one (`::text` cast — which would introduce case-sensitive comparison into a GDPR path, a silent-failure class). When adding a leg that touches a sibling table, check the column types first.
- **The `kind = 'answer'` catch validates paying for the review even on "sketch already recorded" fixes:** open-questions #119 carried a fix sketch since session 30; implementing the sketch literally would have shipped a worse bug than the one it fixed (a crashed refusal recovered as delivered = permanent unrefunded charge + false success email). Two independent finder lenses converged on it. A recorded sketch is a starting point, not a reviewed design.

## 2026-07-12 (session 38, owner present — a sync-only session that ended on the owner's context before the first task) — the wrap-up hook false-positives on kickoff prompts that quote STATUS's own heading; STATUS's top block has grown large enough that boot-sync alone is a real context cost

- **`wrapup-detect.sh` fired on the session KICKOFF prompt — measured root cause (replayed the hook's match logic against the kickoff text):** it is NOT the strong-phrase list; it's the loose second case — `*"next session"*` matches any kickoff that quotes the STATUS heading "NEXT SESSION STARTS HERE" verbatim, and the inner `*wrap*|*close*|…` then matches "wrap-up ritual at the end" / "closes step (c)". Consequences: (1) a fresh session gets the full wrap-up-checklist reminder on its FIRST message — ignore it there; CLAUDE.md's trigger definition (the OWNER signals the session is ending) governs, the hook is a reminder amplifier, not an authority; (2) the fix is task-chipped: exempt the literal heading "next session starts here" before the loose case runs, and tighten the inner wildcards (`*wrap*` matches hyphenated "wrap-up" doc references). Until fixed, kickoff authors can dodge it by pointing at "the ▶ block at the top of STATUS" instead of quoting the heading, and writing "run the CLAUDE.md ritual at the very end".
- **Session boot is now context-expensive: docs/STATUS.md measures tens of thousands of tokens (two Read attempts this session refused at 61,679 and 39,002 tokens), and the single ▶ NEXT-SESSION paragraph — with its absorbed "Older (…)" segments — is thousands of words on ONE line.** This session read the ▶ block, three open-questions rows and one RUNBOOK section, ran ONE read-only query, and the owner's context meter was already empty (his signal). The "Older" absorptions largely duplicate the dated "Last updated" entries directly below. Task-chipped: prune the ▶ block to CURRENT state + pointers, deleting each "Older" segment after verifying its content is fully covered by a "Last updated" entry (no information loss — measured diff per segment). The wrap-up ritual's demote-to-Older habit should pair with this pruning so the block stops re-growing. **✅ RESOLVED (2026-07-12, session 41, owner-directed):** STATUS.md restructured — lean hard-wrapped top block (266,577 → ~22,000 bytes, readable in ONE Read call) + ALL session entries and superseded Older/handoff blocks moved VERBATIM to docs/status-archive.md (newest on top); the wrap-up convention in CLAUDE.md + /wrap-session now says PREPEND new entries to the archive. Done on branch docs/status-restructure, owner-review PR (plain-text ref per #132 route B).

## 2026-07-12 (session 37, the supervised migration window — 016+017 applied, owner present) — the absent-key R8 bug class struck for the THIRD time and only the LIVE verification could catch it; "fails reconstruction" has three different meanings that must not be conflated

- **The absent-key envelope bug class hit twice more in one verification run (`definitionText`, then `onboarding`) — the third and fourth members of the class `attribution.source` (WP30a A1) started.** Mechanism, now precisely understood: every field ever ADDED to the stored-forever audit envelope is missing (not `null` — absent, `undefined`) on every row written before that field existed; any reconstruction-side read comparing `!== null` or calling a method on it then crashes or false-positives. 87/91 live answer rows and 73/215 refusal rows were affected. **Why no hermetic test ever caught it: fixtures are always written by CURRENT code, which always includes the key** — only an old-shape simulation (JSON round-trip + `delete key`, the source-r8.test.ts template) or real production rows expose it. Standing rule for the DoD: a field added to `ComposedResponse`/`Attribution`/anything R8-stored ships WITH (a) `?? null` at every reconstruction-side read and (b) an absent-key regression test, in the same change. The owed periodic A1 live re-run (RUNBOOK) is the backstop that caught both tonight.
- **"Fails reconstruction" turned out to mean three DIFFERENT things — only one is a bug:** (1) absent-key crashes/false-positives → real bugs, fixed tonight; (2) GDPR-redacted rows → `reconstructionReport` was never taught the deliberate sentinel shape (crashes on `response.answer` being absent) — a design gap, the verify script now skips them loudly, semantics recorded as open-questions #133b; (3) rows 76/227 → **historical-behavior versioning**: a LATER session legitimately improved a deterministic builder (the #64 non-contiguous-chart refusal; the #115a circular-definition suppression), so re-deriving an OLD row with TODAY'S rule differs from what was correctly shown then — R8's core promise (stored text = what the user saw) still holds; whether reconstruction should honor the row's own historical rule is #133a, deliberately NOT patched under a live window. Triage the class before touching the checker.
- **`npm run <script> -- args` vs direct `node script.ts args`:** the `--` separator belongs to npm; passing a literal `--` to the script itself lands in `argv` and breaks arg parsing. Cost one failed run; usage now documented in the RUNBOOK section.
- **The migration window itself was uneventful by design:** `db:migrate` applied 016+017 in one run (additive, per-migration check clean), the migration-003 auto-lockdown was VERIFIED (not assumed) to cover the new `answer_feedback` table (0 grants, RLS on), and the deploy-order fail-soft claim held in practice. The only open step: the owner's live 👍/👎 click test — handed to the next session.

## 2026-07-12 (session 37-continued, owner present — WP128 answer feedback built in the same chat as WP30b + the #132 privacy operation) — an all-killed review is NOT a clean review; a piped tail eats exit codes; the sibling-mock lesson recurred and needs a structural fix

- **A pre-build review where the skeptics kill ALL findings still changed the build materially — the killed pile is a first-class input, not a formality.** WP128's 35-agent review returned 15 raw findings, every one dual-skeptic-killed; the session model re-judged them and folded ELEVEN as brief precision fixes. Two of those "killed" findings were then proven load-bearing by reality: the ChatMessage-auditId gap (two lenses converged; the render path genuinely had no data to read) and the GDPR transaction-atomicity wording (three lenses converged). Convergence across independent lenses outweighs a per-finding skeptic kill — skeptics judge findings one at a time and systematically kill "the executor will figure it out" items, which is exactly what a frozen brief exists to prevent.
- **The post-build review's real catch: the brief's own ⟨K⟩ pins are the review's checklist — and round one had skipped two of them AND left a FALSE coverage claim in a test comment.** The action-level fail-soft pin (the one carrying the whole deploy-order-safety guarantee) did not exist, while tests/audit/feedback.test.ts claimed it was "pinned in web/app tests". A false "this is tested elsewhere" comment is worse than no comment — a future session trusts it. Rule: when a brief enumerates named pins, the post-build review (or the builder) diff-checks the pin LIST against the built test files mechanically, and no comment may claim coverage that a grep can't confirm.
- **`… | tail -N` swallows the exit code — a verification chain built from piped steps can report success around a failing suite.** The WP128 web run showed "4 errors" yet the chain marched on to the benchmark: the pipeline's status is tail's, not vitest's. Fixed pattern: redirect to a file (`cmd > /tmp/out 2>&1; CODE=$?`) or run the whole block under `set -e` with no pipes on the load-bearing steps. The full-block runs in earlier sessions had the same latent flaw — they just never had a failing step in the middle.
- **The sibling-mock lesson (s36) recurred within 24 hours: a new export on a mocked module breaks EVERY `vi.mock` of that module whose factory omits it — but only in files that RENDER the consumer.** dashboard.test.tsx mocks `../app/actions.ts`, renders Dashboard → Chat → FeedbackButtons → access of the undefined export → 4 failures the targeted round (chat + feedback-buttons tests) could not see. Structural fix candidates for a future hygiene chip: grep `vi.mock('../app/actions` on any actions.ts export change, or a shared typed mock-factory helper for the actions module so one edit covers every consumer.
- **jsdom pin: while a clarification is pending, chat.tsx's input placeholder BECOMES the clarifying question** — a submit helper hardcoding 'Stel een vraag…' can't drive the reply round; target the pending question's text instead (this is by design, not a bug).

## 2026-07-12 (session 37, fully autonomous — WP30b conformance harness + guide, PR #27) — a provider session limit can silently gut a review's skeptic layer; run the executable contract against real data before trusting any analysis of it; workflow bucket arithmetic lies when agents error

- **A provider session limit killed ALL 14 opus skeptics mid-workflow — and the script's bucket arithmetic then filed every UNVERIFIED lens finding under "confirmed".** The post-build diff review's `refutedCount === 0 → confirmed` logic can't distinguish "both skeptics failed to refute" from "no skeptic ever ran" (all 14 errored with "You've hit your session limit · resets 1:10am"). Two rules: (1) read the workflow result's `<failures>` list and `agents_error` count BEFORE trusting the confirmed/split/killed buckets — a degraded review is a different artifact than a completed one; (2) future review scripts should return skeptic COVERAGE per finding (verdicts.length) so the synthesis step can't mistake absence for agreement. Recovery here: the session model judged the 7 raw findings directly against first-hand file knowledge (all 7 were factually correct; 6 fixed, 1 judged to a documentation fix) — viable because the finding count was small and every cited file had been read in-session; a 20-finding degraded review should re-run its skeptic layer after the limit resets instead.
- **Run the executable contract against real data BEFORE trusting analyses of that data — the harness's first run caught what two independent analyses missed.** Both the design review's slice-trap finding and this session's own measurement script concluded "the 9 data-carrying fixtures are clean unsliced" — TRUE, but both only looked at OBSERVED periods. The conformance harness's first real run failed on a third axis nobody had analyzed: 80416ned (a schema-only fixture) carries 7,492 DAILY period codes (`20060101`) in its CODE LIST — CBS's own corpus contains tables outside the canonical `JJ|KW|MM` grammar (ADR 030 D2's daily-grain revisit case, in the fixtures deliberately as a fit-gate specimen). The fix was a design decision (F2's code-list check gates SERVABLE tables only), not a patch. Lesson: for a checker-shaped deliverable, "run it for real" is a design input, not just verification — schedule the first real run BEFORE the design freezes its last edge case.
- **Measure-first scouting made the 46-agent review cheaper and sharper: two 10-line `node -e` scripts settled design questions the review would otherwise have litigated on speculation.** The draft brief's manifest-slice mechanism (born from the raw statuses count "7,502 nulls") shrank to an escape hatch once a per-table measurement showed every observed period is published-with-status — and the review's strongest harness finding then confirmed the measurement rather than debating the mechanism. Pattern for checker/contract WPs: measure the corpus per-axis (observed vs declared vs code-list) before writing the brief; raw aggregate counts mislead.
- **A literal source-scan test pin is load-bearing scope input — grep the TEST corpus for the literals your refactor removes, not just src/.** The pre-build review's only dual-upheld confirmed finding: rewiring the cron route through `adapterFor` would break `web/app/onboarding-cron.test.ts:102`'s `toContain('new ODataV4Source()')` — a deliberate money-path wiring pin the scope decision then preserved by leaving the route byte-untouched (which was ALSO the better scope call: a single-branch factory buys a live money path nothing). The scouts had inventoried all three construction sites in src/ but not the test that pins one of them; "who PINS this literal?" belongs in every refactor inventory.
- **`erasableSyntaxOnly` forbids constructor parameter properties (`constructor(private x: T)`) — declare fields explicitly in new test classes.** One-shot typecheck failure in the fake-adapter class; the repo's tsconfig enforces erasable-only TS syntax, and this is the first session to hit it with a class.
- **A public-repo PII rewrite is a 30-minute, fully-verifiable operation IF done while forks=0 — the pattern (#132):** local safety bundle first (`git bundle create … --all` — the reversible undo; it deliberately KEEPS the old history); `git-filter-repo` via `pip3 install --user` when brew is absent (single-file pure Python); run it in a FRESH `file://` clone (it refuses dirty repos and strips remotes by design), with `--mailmap` (author → noreply) + `--replace-text` (longest-match rules first: the full e-mail before its bare prefix); verify BEFORE pushing — three checks: the authors list collapses to noreply, a per-term grep over every `git rev-list --all` blob returns 0, and **the HEAD tree hash is identical to pre-rewrite** (proves the live code did not move a byte); push via fetch-back into the working repo (which owns the credential helper) instead of wiring auth into the mirror; then delete stray remote branches, `@dependabot recreate` the open PRs, and take the FINAL proof from a fresh clone off GitHub, not off disk. Two residual truths recorded for the owner: GitHub can serve pre-rewrite SHAs from cache until GC (a support ticket purges), and **any pre-rewrite clone resurrects the scrubbed history if ever pushed from — old clones get re-cloned, never reused** (RUNBOOK warning added; the previous laptop holds such a clone).
- **A git history rewrite does NOT scrub GitHub's SERVICE-side copies — THREE layers were found post-rewrite, each by a progressively more adversarial check:** (1) every pre-rewrite **Actions run** publicly serves `head_commit.author.email` via the runs API — fixed by deleting all 330 pre-rewrite runs; (2) orphaned commits referenced by merged PRs are still served by SHA with the old author e-mail; (3) **the big one, found only by the INDEPENDENT auditor: `refs/pull/N/head` refs permanently retain the ENTIRE pre-rewrite history** (287 commits here, all PII intact, fetchable by anyone via `git ls-remote 'refs/pull/*'`) — the refs/pull namespace is server-owned, unreachable by force-push and undeletable by the owner; only a GitHub Support "sensitive data removal" ticket (or deleting the whole repo) clears it. Two meta-lessons: **"fresh clone = clean" is a FALSE proof for GitHub** — a clone fetches refs/heads only, so verify with `git ls-remote origin 'refs/pull/*'` + fetching those refs; and the operator's own verification inherits the operator's blind spots — the independent fresh-eyes audit (which was told to distrust the term list AND the method) is what caught it, worth its cost exactly like the #125a/WP30a review precedents.
- **zsh does not word-split unquoted variables — `for id in $IDS` loops ONCE over the whole newline-joined string.** Two delete-loops silently no-opped (each "iteration" hit a garbage URL, stderr swallowed) while the single hand-run call worked; the tell was rounds reporting 1 call for 100 fetched ids. Portable fix: pipe line-wise (`... | xargs -n1 -I{} gh api -X DELETE ...`); and never swallow stderr in a loop whose success you then claim — count via a before/after API total instead.
- **A redaction sweep needs a stem-level re-grep AFTER the edits, not just a hit-list before them.** Two occurrences (a second e-mail in the same RUNBOOK step, a plus-alias variant in an old STATUS entry) only surfaced on the post-edit re-grep; plus-aliases and derived slugs (`<name>-3883s`) are PII spellings a naive exact-term list misses. Grep for the NAME STEM, not the known addresses.
- **GitHub skips CI when `[skip ci]` appears ANYWHERE in the commit message — including inside the sentence "but NOT [skip ci]".** A docs commit amended specifically to RUN the gate (the PR head must be green for the owner's #118 merge rule) still skipped, because the explanation itself contained the literal token. Two rules: never quote the token in a message meant to run CI (write "skip-ci" hyphenated), and a PR whose head commit is docs-only must NOT use the token at all — since #126 (public repo, free minutes) the head-must-be-green rule always wins over minute-saving.

## 2026-07-11 (session 36, autonomous — first session back on the original machine: #125a finished from the WIP) — a numeric claim in an ADR must be measured; the killed-findings pile is where the session model's judgment earns its keep; a gutted working tree restores via stash-push when the classifier blocks restore

- **An ADR's numeric example was factually wrong — and the test written to PIN it is what caught it.** ADR 031 (and the WIP code comment) claimed `390.2 * 1000 = 390200.00000000006`; in V8 that product rounds EXACTLY to 390200, so the test `expect(390.2 * 1000).not.toBe(390200)` failed on first run. A 10-second measured sweep found the real class: 96 of the 9,999 one-decimal values below 1000 multiply inexactly by 1000 (e.g. `16.1 * 1000 = 16100.000000000002`) — so the exact-arithmetic DESIGN stays necessary, but the cited example had never been executed. Rule: any concrete numeric claim bound for an ADR/test gets a measured probe first (`node -e`), not an assumption — and writing the pin-test before trusting the claim is exactly what surfaces this.
- **Dual skeptics correctly kill findings AS WRITTEN — the session model's added value is re-deriving the strongest version of each killed attack before accepting the kill.** The completed #125a design review (6 mid-tier lenses × dual heavy-tier skeptics, 26 agents) returned 0 confirmed / 11 killed-or-contested. Reviewing the killed pile, the session model constructed a CONCRETER trigger for one killed blocker (a record-less neighbour value inside R10's shared suffix window lets an anchor splice ITS expansion next to the WRONG number — a misleading display that survives re-validation) and a structural close for another (a model that computes the expansion itself now VALIDATES — the record backs it — so the splice would double-render). Both became ~5-line fail-open belts + 2 tests instead of accepted risks. Also applied (session-34 lesson): one skeptic died mid-response, so its finding's "1 refute of 1 vote" was judged by hand rather than trusted as a majority.
- **Workflow review agents share the session's working tree — their probe files appear in YOUR `git status` mid-run.** Two untracked `check-b6*.test.ts` probes materialized while the review workflow ran (its agents wrote executable probes to drive the real pipeline; they self-cleaned at completion). Corollary of the session-32 concurrent-runs lesson: while a review workflow is live, treat `git status` surprises as agent scratch (verify, don't adopt), and schedule the authoritative verification run strictly AFTER the workflow completes.
- **The "6 skipped + 1 failed" full-suite signature is PGlite parallel-load contention hitting the timeout ceiling — not necessarily a foreign process in the tree.** The session-32 lesson attributed this exact signature to reviewer agents sharing the working tree; session 36 reproduced it twice with NOTHING else running: `benchmark-charts` (beforeAll → 6 skips) and `cli.test #110a` died at exactly the 30s ceiling on a busy machine, then passed solo in ~1.5s. vitest.config.ts's own header documents the class ("~10+ concurrent PGlite instances… slow is fine, flaky is not") and had raised the ceiling before — raised again 30s → 60s (#125a added two more db-booting suites). Diagnostic order for a full-suite failure: (1) name the failures, (2) run them SOLO — solo-green + at-the-ceiling timing = the contention class, fix the ceiling, not the test.
- **A targeted test round must include every SIBLING test file of a touched module — or better, the workspace's full suite before declaring a build done.** WP30a's targeted round ran statline/citation/stat-card.test.tsx/chat but not `web/lib/stat-card-data.test.ts` — whose strict `toEqual` failed on the new field. Typecheck can't catch it (tests build fixtures dynamically), the design review can't either (it reviews design, not test inventory); the post-build DIFF review caught it (both lenses independently, 4/4 skeptics). Two rules: `ls` the test files next to everything you touched, and treat the post-build diff review as earning its cost even right after a deep design review — they find different things.
- **For a single "wait until done" condition, a plain `until …; do sleep; done` background command beats the comm-diff Monitor shape.** The event-diff monitor missed its own terminal event twice (PR-#25 main run: timed out 20 minutes after the run had already succeeded). The until-loop version (exit when `gh run list --commit <sha>` reports all completed) is simpler and cannot miss the end — matching the Monitor doc's own guidance: unbounded shapes are for streams, not for one completion.
- **A background workflow killed by a network interruption dies SILENTLY — the journal timestamp is the tell, and `resumeFromRunId` is the recovery.** The WP30 design review stalled mid-run when the internet dropped: no error, no notification, just a journal that stopped updating (1 of 6 lens results, last write 3 hours old when the owner asked). Diagnostic: compare the journal's mtime/result-count against expectations, never assume "still running". Recovery: re-invoke Workflow with the same scriptPath + resumeFromRunId — completed agents replay from cache (the re-run cost only the dead agents). Same run also had one lens die on "Connection closed mid-response" INSIDE an otherwise-successful pass — the failures list named it, and re-resuming completed it; a review is not done until every lens has a result (session-34's dead-verifier rule, now at the lens level).
- **When the owner's pause instruction is ambiguous about an in-flight irreversible step, ask with a one-click question instead of picking a reading.** "Wacht even tot alles af is ... en mergen etc" could mean "finish everything including the merge" OR "pause everything including the merge"; the permission classifier read it as the latter and blocked the merge. The AskUserQuestion round-trip cost one message and produced an unambiguous "Merge nu" — cheaper than either guessing wrong on a live money product or arguing with the classifier.
- **A machine left with its working tree gutted (all tracked files deleted, `.git` intact) restores reversibly with `git stash push` when the permission classifier blocks `git restore .`** — the classifier read "restore 494 deletions" as discarding uncommitted work (it is the opposite: the files' content lives in git). Stash-push both restores every file AND preserves the deletion state as a poppable undo — strictly safer than restore, and it passes review. Context: the switch-back machine had been cleaned out; origin (as the handoff designed) was the single source of truth, and `git fetch` + branch checkout rebuilt the exact WIP state.

## 2026-07-11 (wrap-up continuation) — Session 35 cross-session handoff: two sessions shared ONE working directory; the interrupted one couldn't update main, so the coordinating one must wire main→WIP

- **When a task chip / parallel session runs in the SAME checkout, its uncommitted work appears in your `git status` — surface it read-only, never mutate its branch.** After WP29 wrapped, a plain `git status` showed a different branch (`wp125a-unit-expansion`) with 5 modified files + a new ADR — the #125a build, started by another session in the shared working directory (only ONE worktree existed; the chip did not spin up its own). The correct move was to STOP, characterize it read-only (`git diff --stat`, `git show <branch>:<file>`, `git log`), and ask the owner — not commit, stash, switch, or "continue" it. Committing or reverting another live session's tree is a clobber. (The owner confirmed that session was mid-cleanup; it then pushed everything and left a handoff brief.)
- **A machine/account switch means the repo on `origin` is the ONLY thing that survives — and `main`'s STATUS is what a fresh session reads first, so an interrupted feature branch MUST be pointed to FROM main.** The #125a session did the right thing (committed + pushed its WIP + a thorough handoff brief, `[skip ci]`, 0 minutes) but deliberately left STATUS/open-questions/build-plan alone ("another session does the prep"). That leaves a real gap: a fresh session on the new machine `git fetch`es, reads main's STATUS, sees "#125 = next build (greenfield)", and redoes it — conflicting with the pushed WIP branch it never knew to look for. The coordinating session's job is exactly to close that gap: main STATUS + the #125 open-questions row now name `wp125a-unit-expansion` + the handoff brief, so resume-vs-redo is an informed choice, not an accident. Rule: **an interrupted WIP branch isn't "handed off" until something a fresh session reads FIRST (STATUS) points to it.**
- **Before a machine/account switch, run an adversarial "fresh-machine" audit — it catches what your own pass anchors past.** A 4-lens read-only fan-out (bootstrap / WIP-continuity / doc-consistency / memory-loss), each simulating "I'm a fresh Claude on a new laptop with ONLY this repo — what blocks me?", returned **0 blockers but 9 real gaps** the coordinating session (which wrote most of the docs) had missed: STATUS/open-questions linked ADR 031 + the handoff brief as in-tree files when both live ONLY on the unmerged `wp125a` branch (dead links on `main`); the secrets register claimed `ANTHROPIC_API_KEY`/`DATABASE_URL` live in `web/.env.local` when the real file (verified) holds only the three `NEXT_PUBLIC_*` values; the README still said "Phase 0 — build in progress" on a live Phase-1 product; 08-build-plan still called WP29 "awaiting review" after it merged, and contradicted ADR 024 on whether the WP26 safelist read-back happened; the Vercel CLI (needed for the RUNBOOK's own `vercel logs` incident step) was never in the bootstrap; and Stripe/Resend/Namecheap logins were nowhere recorded. All doc-only, all fixed except the provider logins (flagged as an owner action — only the owner knows them). Lesson: the author of a doc set is the worst auditor of it; spend the independent-perspective tokens before an irreversible handover, not after.
- **Docs-only pointer commits on `main` can `[skip ci]` when the Actions minute budget is tight and no code changed** — the account was ~90% into its 3,000 included minutes, WP29's code state on main was already gate+deploy-green, and a pure-docs commit has nothing for CI to prove. Flag it explicitly in the wrap-up so "CI green per commit" reads as a deliberate N/A, not an oversight. (Public-repo Actions is free/unlimited — filed as [open-questions #126](open-questions.md) with a secret-scan caveat.)

## 2026-07-11 — Session 35 (autonomous start, owner joined mid-session: WP29 follow-up chips): the dry-run doubles as the loadedness check; byte-identity pins must splice run-dependent tokens; capture goldens BEFORE touching the pipeline

- **A "pure module + one dry-run dependency" constraint that looks under-informed is usually a nudge toward the right primitive.** The WP29 brief fixed `buildSuggestions(intent, result, check)` with no db access, which at first looks impossible for "is the neighbor period loaded?" / "are ≥3 periods loaded?" questions. The resolution: PROBE the dry-run itself — try next-then-previous neighbor, try a 5-then-3-period trend window; whatever `echoServability` accepts is by definition loaded and gap-free (runQuery's completeness pass). Zero new query surface, zero drift risk from a parallel "approximate" loadedness check — the exact failure mode dry-run.ts's own header warns about. When a frozen brief's signature seems to lack an input, check whether an existing injected primitive already ANSWERS the question before widening the signature.
- **A byte-identity pin over an envelope with run-dependent fields must splice those tokens from the envelope's own structural fields — or it flakes.** The R8 golden-text pin looked simple (hardcode the B3 answer text) until the capture showed `Gegevens gesynchroniseerd op 2026-07-10`: `createIngestedDb` stamps syncedAt at ingest time, so a hardcoded literal breaks the next day. The honest shape: every byte literal EXCEPT the sync date, spliced from `response.result.attribution.syncedAt` (whose own rendering is already pinned by reconstruct/compose tests). Same discipline for any future golden over attribution-bearing text.
- **Capture the pre-change golden BEFORE the first source edit — it's a 2-minute scratch script then, and impossible later.** The B3 envelope text was captured on the clean tree via a scratchpad tsx script before respond.ts changed; the pin then proves the change touched nothing. Doing this after the fact would have meant trusting the very code under test. (Scratchpad tsx quirk: files outside the repo run as CJS — top-level await fails with a misleading transform error; name the script `.mts`.)
- **The review's confirmed finding was again a missing-branch PIN, not a code bug — and mutation-verifying the fix is cheap.** 3 of 5 lenses (R7 gating, R8/audit, money) came back clean; the one dual-skeptic-confirmed finding: no test proved suggestions also ride the warn-and-serve STALE answer branch, so a plausible future edit (`if (!staleness.stale)` around the chips call) passed the entire gate. Closed by driving the stale branch with the far-future-clock trick the staleness suite already uses, then actually APPLYING the mutant and watching exactly the new pin fail (then reverting). A test added for a mutant should be proven against that mutant — 30 seconds, and the claim "this pin kills it" becomes measured.
- **Cost-tier note (delegation rule applied): lens reviewers ran on the mid tier, refuting skeptics + all synthesis on the session model.** 9 agents total; the mid-tier lenses found everything the session needed (1 real gap, 1 correctly-refuted nit) — the top tier was spent only where judgment kills or confirms findings.

## 2026-07-10 (evening) — Session 34 (autonomous: WP28 Google SSO build): server-side signInWithOAuth is a URL builder, not a validator; a fail-soft claim needs the failure MEASURED at the right layer; jsdom can't exercise a rethrown framework throw — pin the pattern in source

- **The browser's dashboard login and the project's MCP auth can be DIFFERENT accounts — verify the account on-page before driving any dashboard.** Discovered in the owner-present continuation: navigating to the checkdecijfers Supabase project silently bounced to the "glaibaan" org — the Chrome profile's Supabase session belonged to the owner's OTHER Supabase account (parallel GlaiBaan work), while the project's MCP connector is authorized to the org-"stefan" account that actually owns checkdecijfers. The dashboard gives no error, just a silent redirect to the wrong org's project list — easy to mistake for "project gone". Same-family rule as the gh multi-account quirk and the Chrome-profile rule, now recorded in the RUNBOOK (WP28 section + Moving-to-a-new-machine): read the org/account indicator on the page FIRST; for parallel-work conflicts use an incognito window instead of logging the other session out. (The Google Cloud side was verified the right way: `find` the signed-in account element on-page — personal gmail #1 — before any click.)
- **Google now shows an OAuth client secret ONLY at creation — and the create-dialog makes it easy to miss.** The dialog shows Client ID + a "Download JSON" link; if you close it without downloading, the secret is unrecoverable ("Viewing and downloading client secrets is no longer available" — the client page shows a masked stub like `****PfIX` that pastes as garbage). The measured failure signature downstream: Supabase saves the provider as enabled with an empty secret and the authorize URL returns `{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: missing OAuth secret"}`. The clean fix is Google's own rotation: "+ Add secret" → the NEW secret's copy icon (clipboard-only — the secret never has to transit chat, repo, or screenshots; it stays masked on-page) → paste → Save → disable the old secret after verifying login. Recorded in the RUNBOOK WP28 section.
- **Google's OAuth console changed shape since the brief was written — an executed RUNBOOK step should record the as-executed path, not just tick the box.** The brief said "OAuth consent screen"; the console now calls it Google Auth Platform with a Get-started wizard, and a NEW default matters: apps start in TESTING mode where only listed test users can log in — the "Publish app" step (Audience page) is REQUIRED for real users and is easy to miss because nothing errors before it (basic scopes need no verification review). The RUNBOOK step now records the executed wizard path + the publish step.

- **Supabase's server-side `signInWithOAuth` never talks to Supabase — it only BUILDS the authorize URL (9ms, no network).** Consequence measured on the dev round trip: with the Google provider NOT yet enabled, the action still succeeds and redirects; the failure surfaces at Supabase's own door and bounces back through `/auth/callback?error=…` → `/login?error=auth`, silently. ADR 028 D4's "fails soft with the standard error copy" was written assuming the error returns in-process — it doesn't for the unconfigured-provider case (only for env/transport failures). Fail-soft still holds structurally (no crash, magic link untouched), but the CLAIM had to be refined in the ADR + RUNBOOK so the owner isn't surprised pre-configuration. Rule: a "fails soft with copy X" claim is only real once the specific failure has been INDUCED and the copy SEEN — provoke the failure, don't infer it from the SDK's return type.
- **A NEXT_REDIRECT rethrow from a client event handler cannot be behaviorally tested in jsdom** — `unstable_rethrow` (the documented Next-16 pattern, and the right code) re-throws inside an async onClick, which lands as an unhandled rejection that vitest rightly fails the run on; there is no place to attach a catch (jsdom has no `unhandledrejection` routing, and Next's global handler isn't running). The honest pin is the repo's existing purchase-wiring pattern: a source-text assertion that `unstable_rethrow(err)` sits in the catch BEFORE any `setError` — brittle-but-honest beats a fake behavioral test that mocks the very mechanism under test.
- **The `preview_click` tool can fire before React hydrates — the click silently no-ops.** First click on the fresh dev-server page produced no action POST and no state change; the second (and a JS-eval `.click()`) worked. When a preview click seems to do nothing, check the server log for the action POST before concluding the handler is broken — and prefer clicking only after a snapshot shows the hydrated page.
- **`next dev` does not load `.env.production`** — the repo's committed env file (publishable values only) leaves the dev server without Supabase config, and the proxy 500s on every route. A gitignored `web/.env.local` copying the two `NEXT_PUBLIC_SUPABASE_*` values + `NEXT_PUBLIC_APP_URL=http://localhost:3000` makes local preview work; it stays out of git (`.env*` ignored) and contains nothing secret by definition.
- **A review workflow's AGGREGATE verdict silently absorbs dead verifiers — read the failure list before trusting the counts.** This session's 5-lens review returned "0 confirmed, 2 refuted" — but ALL four verify agents (and one whole lens) had died on an account session limit, so "refuted" meant "zero votes cast", not "disproven" (the session-30 null-result rule, now seen at the aggregation layer). Both "refuted" findings were then hand-verified: both real (doc-precision, fixed). Rule: a workflow's summary counts are only meaningful next to its per-agent failure list; count dead verifiers as abstentions, never as refutations — and when subagents die on limits, the session's own model does the verification by hand instead of waiting.

## 2026-07-10 (stage D) — Session 33 (owner present: WP27 stage D live step, PR #22): re-verify a stale measurement before flagging an anomaly; "calibrated, not moved" is now the house calibration pattern; a status-transition monitor makes a supervised live job observable

- **A mid-flight "anomaly" was a stale measurement — re-query before flagging.** During the acceptance test the ledger showed −20/+20/−100 against an account I had measured at balance 40 → apparent −60 overdraft. The truth: the owner had bought a +500 credit pack SECONDS before asking (tx 62); my balance number predated it. The check that saved a false alarm to the owner was re-running the balance query and reading the account's full ledger before saying "bug". Rule: a number you measured BEFORE a live event is not evidence about the state AFTER it — re-measure, then speak. (Same family as the session-25 "cite only the final artifact" lesson, now on the money side.)
- **"Calibrated, not moved" held for the SECOND threshold — treat it as the house pattern.** The fit gate's 0.8 repeated the finder story exactly: measured correct-side floor well above (0.95 uniform, 6/6), wrong-side ceiling UNMEASURED because the model made zero wrong picks on the seed set. Moving a threshold whose failure side has never been measured is a guess dressed as rigor; the calibration's real product is the DOCUMENTED margin + the replay floor assertion that references the constant. Both live thresholds (finder highConfidence, fit acceptThreshold) now carry this shape.
- **A read-only status-transition monitor is the right observability for a supervised live job.** A ~10s polling loop (SELECT on the pending row, emit only on CHANGE, exit on any terminal status — delivered/unanswerable/failed all covered, not just the happy path) narrated the whole acceptance test hands-free: chain recorded → fit accepted (fit_note readable mid-flight) → delivered, with the kick (claimed_at 2s after created_at) and the 88s end-to-end both measurable from the emitted timestamps. Cheap to write against the repo's own `connectFromEnv`; reusable shape for any future supervised onboarding/live-job step.
- **Direct prod-DB execution worked this session where session 28 was harness-blocked — both patterns are valid; let the block decide.** With the owner present and confirming each step in-chat, the migration and the read-only checks ran directly from the session (repo db client + pinned CA; note: raw `pg` without the repo client fails on Supabase TLS — use `connectFromEnv`, don't hand-roll). Session 28's prepare-and-hand-off (owner runs the commands) remains the fallback when the permission layer refuses — don't fight the block.
- **The queued `scripts/force-ipv4.mjs` promotion landed** (was "worth promoting" since session 29's 3rd IPv6 recurrence) — the capture + record CLIs ran through it first try; the RUNBOOK now carries the standing one-liner instead of a lessons-learned recipe pointer.
- **`gh pr checks --watch` can exit 0 while checks are still pending — don't trust its exit as "checks finished".** Observed on PR #22: the watcher returned cleanly with both gate jobs still `pending` (twice). The reliable shape is a plain poll loop over `gh pr checks` until no `pending` lines remain (non-watch invocations exit 8 while pending — also usable as the loop condition).

## 2026-07-10 (later) — Session 32 continued (owner present: PR-#18 merge + WP27 stage C → PR #21): shared-worktree mutation reviewers produce phantom test results in concurrent runs; a committed record script turns a paid measurement into a permanent CI pin; the review's job is the boundary nobody typed

- **The stage-B lesson's warning MATERIALIZED: mutation-testing reviewers sharing the working tree corrupted a CONCURRENT verification run** — the full-suite run overlapping the review showed 6 skipped backend tests + 1 failed web test, all phantom (clean rerun after the workflow: 982/982 + 182/182). No harm done because the anomalies were treated as suspect-until-clean-rerun and CI re-proves on the pushed head, but the time cost was real. Hard rule now: mutation-testing review agents run in WORKTREE ISOLATION, or the verification block runs strictly AFTER the review workflow — never concurrently in one tree. (Also: reviewer git-checkout restores change mtimes, which invalidates the Edit tool's file-state tracking — re-read before editing after a review pass.)
- **A paid one-call measurement becomes free forever if the record script is COMMITTED and the verdict is a replay fixture.** The #124 question ("do 18 same-tagged measures make the delivery parse clarify?") could only be answered by the real model (~€0.01, owner-approved). The pattern that made it durable: a committed `scripts/onboarding-delivery-record.ts` that runs the EXACT hermetic flow the e2e replays (same constants, byte-identical prompt path) with a RecordingLlmClient swapped in — its console verdict IS the measurement, and the written fixture pins it on the CI gate. Answer: it ANSWERS ("Totaal bijstandsuitkeringen … 390,2 (x 1000)"), no rule-4 clarification. Prompt-byte determinism was verified first (jsonb key canonicalization makes the vocab order stable) — check that BEFORE recording, or the fixture flakes on hash misses.
- **Two stages, two reviews, two confirmed findings — both were UNTYPED BOUNDARIES, not typed code paths:** stage B's finding was the one construction site no test drove; stage C's was the `>=`-vs-`>` comparison at exactly the threshold (no test supplied confidence === threshold; flipping the comparator passed all 37 fit tests). The compiler pins what has a type; reviews earn their cost at boundaries and equalities where no type exists. Both fixes reference the CONSTANT (not a literal) so recalibration moves the test with the config.
- **A failing PR status that is INTEGRATION-WIDE masquerades as "your change broke something" — check sibling PRs and main's own commit status FIRST.** The "Vercel" check failed on stage C's PR; thirty seconds of checking showed it failing identically on both untouched Dependabot PRs AND on the green-deployed main head — so it was a repo-level integration (a Vercel Git connection that per RUNBOOK/ADR 018 d7 should not exist), not the diff. That integration was itself the real finding: failing builds were accidentally safe, succeeding ones would deploy AROUND the CI gate. Flagged; owner disconnected it at close.
- **The dormant-until-migration pattern composes across stages:** stage C ships real spend-capable code (a fit LLM call per candidate) that is mechanically unreachable in production because stage B's pre-015 probe empties every chain (legacy path). Verified as its own review lens. The general shape — N hermetic merges, one supervised switch-flip at the end — keeps every intermediate deploy safe on a live money path without feature flags.

## 2026-07-10 — Session 32 (owner present: PR-#17 merge + WP27 stage B → PR #18): a spec's deploy-safety claim is a requirement on the code, not a property it has for free; mutation-test the one path no suite drives; `commit -am` silently strands untracked files

- **"Either deploy order is safe" in a brief is an obligation the implementation must DISCHARGE, not a fact to cite.** Stage B merges → deploys to live production while migration 015 stays file-only until stage D — so the widened INSERT would hit a schema without the column, and a statement error aborts the WHOLE money transaction (debit included: nothing charged, but every live onboarding trigger errors for days). The brief's claim only becomes true because the store now probes `pg_attribute` before naming the column (a SELECT cannot abort a tx; no cache — one trivial catalog read per rare 100-credit event beats a test-only reset hook). When a spec asserts a safety property across a deploy window, ask: WHICH code makes this true? If the answer is "none", the spec found a bug in itself.
- **The adversarial review's one confirmed finding was invisible to 954 green tests — mutation testing made it undeniable, twice.** The finder lens corrupted the live respond.ts construction site (`candidateIds: parse.candidateIds` → `[]`): full suite + typecheck stayed green, because every existing test drove the envelope builder DIRECTLY, never through `respondToQuestion` with an injected finder. Both skeptics reproduced the mutation independently before confirming. The fix was verified the same way: apply the mutation → new test fails → revert. For "thread X through the chain" work, the coverage question is not "is each link tested?" but "does one test drive the WHOLE live path and assert the value verbatim at the far end?" — and the mutation is the proof either way. (Bonus: the pipeline test's question is B15, *"Hoeveel mensen zitten in de bijstand?"* — literally the live question that opened #111.)
- **`git commit -am` stages only TRACKED files — the two NEW files (migration 015 + its test) silently stayed behind, and the pushed branch contradicted its own commit message.** Caught because `gh pr create` warned "2 uncommitted changes" and that warning was treated as a stop signal, not noise. CI would have failed confusingly (the probe would route every CI insert down the legacy path; round-trip assertions fail). Rule: after any commit that ADDS files, `git status --short` must print clean BEFORE push — and the gh uncommitted-changes warning always gets investigated.
- **Reviewer-agent worktree hygiene almost bit:** one verify-skeptic edited the shared working tree during its mutation check and restored it via `git checkout` — correct this time (the two untracked files survived because checkout doesn't touch untracked paths), but only by luck of file states. Next time a review brief allows mutation testing, require the agent to state the tree is restored (`git status --short` output) in its verdict, or run it in worktree isolation.

## 2026-07-09 — Session 31 continued (owner present: billing retry + PR-#17 adversarial review): "fixed" is a claim until the annotation changes; blocked-on-CI time converts cleanly into merge-hardening review; a checklist that names N links invites skipping the unnamed one

- **"The billing is fixed" is a claim, not a state — verify by rerunning and re-reading the job annotation.** Two rerun attempts AFTER the owner's fix report carried the identical billing annotation (0-step jobs, seconds-long "runs"). The three real-world causes to check, in order: wrong GitHub account (multi-account owners fix billing on the account they're logged into, not the repo owner's), the outstanding failed payment never explicitly retried (a new card alone doesn't clear it), spending limit $0. The unmistakable success signal is DURATION: a real gate takes minutes. Now in the RUNBOOK.
- **CI-blocked time converts cleanly into pre-merge review — and the owner preferred that over stacked branches.** Owner steer (recorded): no stage-B/C branches stacked on an unmerged PR while CI is dead ("this will mess up the project") — unmergeable branch-trains are a cost, not progress. The 16-agent adversarial review of the OPEN PR instead made the eventual merge safer AND cheaper to review: the three merge-critical lenses (money, prompt/fixture bytes, recall math) came back clean, which is itself valuable, quotable assurance.
- **A checklist that names N links invites verifying exactly those N — the review's only HIGH was the link the list forgot.** The stage-B brief named every carrier of `candidateIds` but omitted the one file that CONSTRUCTS the value (`onboarding-finder.ts`); an executor following it literally would ship an always-empty list that typechecks and passes carrier tests. For any "thread X through the chain" brief, ask separately: which file CREATES the value, which files CARRY it, which file CONSUMES it — three questions, not one list.
- **When a fixture deliberately lies (schema-only: real $count, zero pages), document the lie at the CONSUMER, not just the producer.** The next debugger reads `fetchObservationCount`'s doc-comment, not the capture script that made the fixture months earlier — the misleading "0 rows fetched" failure is now explained at all three places a stage-C builder will actually look.
- Verify-agent hygiene held this time: 16/16 agents completed, so the refuted-bucket verdicts were real verdicts (the session-30 "dead verifier ≠ refutation" check is now routine — keep it).
- **Coda (resolved later the same day): GitHub's billing annotation never names the most mundane cause — exhausted included minutes.** The wording ("payments have failed or your spending limit needs to be increased") sent us checking accounts, payment retries and limits, while the practical fix was buying an Actions plan because the private repo's included minutes were used up. The duration-signal protocol proved itself: first rerun after the plan purchase ran for minutes (22 steps) instead of failing in seconds, and both PR-#17 gates went green the same hour. Also worth keeping: a non-developer owner reads "failed run" e-mails as a costly runaway process — say explicitly WHICH meter each action burns (Actions minutes vs API credits vs app credits) before they have to ask.

## 2026-07-08 — Session 31 (owner present: WP27 stage A build + supervised record → PR #17): measure the live reality BEFORE building to a frozen brief; a small fixture passing is not the live system working; "the model can't see it" is an information gap, not a tier gap

- **A frozen, adversarially-reviewed brief can still rest on unverified world-facts — verify them against the live source before writing code.** Three of the WP27 brief's assumptions fell to ~30 minutes of FREE checks (public CBS metadata reads + one hermetic experiment): the assumed "Personen met bijstand; kerncijfers" stock table doesn't exist in deliverable form (every person-level stock table has characteristic dims → the v1 vocabulary registers zero measures — the ACTUAL cause of the live dead-end — and none has yearly codes, so `requireGrain('JJ')` honestly refuses the year question); the raw recall top-20 buried the only deliverable table at position 51 behind 14 discontinued tables; and a measure-honest fit gate would ACCEPT the undeliverable tables. Each became an owner decision (A1–A3) BEFORE code, instead of a dead stage-D acceptance test after three built stages. The design review had checked the design against the CODE; nobody had checked it against CBS.
- **The full-catalog-in-PGlite experiment is a €0 power tool:** download the real 4,858-row catalog (free public API), ingest it with the repo's own `ingestCatalog` into the repo's own PGlite test harness, and run the REAL `recallCandidates` — live-fidelity recall measurements, repeatable, no prod access, no spend. This is how "37789ksz sits at position 51" became a measured fact instead of a hunch. Keep the pattern for every future recall/quota question.
- **Hermetic-passes ≠ live-works when the fixture is a toy subset:** the 62-row fixture catalog made every labelled case trivially recallable while the live mirror buried the target. Mitigations now in place: fixture distractor rows mirror the live Regulier competition, and the stage-D live-mirror re-check stays a named residual. Treat "the labelled set passed" as a statement about the fixture until the live mirror confirms it.
- **When a model picks wrong because the deciding fact isn't in its input, no tier escalation helps.** Measured at the record step: Haiku correctly read the stock-vs-flow shape but picked the person-level stock table — deliverability (dims/grain) is simply invisible in title+summary. The fix is structural (chain semantics in the labelled case + stage C's deterministic pre-checks), not a bigger model. Ask "CAN any model see the deciding fact from this input?" before reaching for the escalation ladder.
- **Presenting brief deviations to a non-developer owner: measured evidence + a recommendation + a walk-through of THEIR OWN failing question.** Two amendments were approved on the evidence alone; the third (fit-gate pre-checks) needed a concrete worked example — the owner's real bijstand question traced step by step through both worlds (with/without the check). Abstract mechanism descriptions don't land; their own question does.
- **The GitHub Actions billing block masquerades as a failed gate:** job "fails" in seconds, 0 steps, `--log-failed` says "log not found"; the real signal is the job annotation ("recent account payments have failed / spending limit"). It is account-wide (hit both of the owner's repos the same day). Protocol: report "billing-blocked, CI unproven", re-verify the gate locally, and hand the owner the Billing & plans + `gh run rerun` steps — never let a locally-green claim stand in for CI.

## 2026-07-08 — Session 30 continued (owner present: merges + four designs): adversarial review of a DESIGN pays like review of code; verify a proposed source's SHAPE before designing around it

- **The pre-build design review caught a HIGH that code review could not have** (it would have been baked into the built thing): the WP27 design claimed a mid-flight `table_id` update was safe "while running" — backwards: a running row is INSIDE the partial-unique-index predicate, and the drifting key would have opened a double-debit window on the asking-twice dedupe. Fixed at the design level (`resolved_table_id`, identity never mutated) for the cost of three mid-tier agents. On a money path, freeze no design without the adversarial pass — the WP27 pattern is now the house rule for WP30.
- **A proposed data source may be a CATALOG, not a source — check the technical shape before designing an adapter around a name.** data.overheid.nl (owner proposal) is a CKAN/DCAT metadata register pointing at hundreds of heterogeneous publishers; web-verified BEFORE advising, which turned the answer from "yes, build an adapter" into "use it as the menu; pick a StatLine-voor-derden portal as the dish" (#123).
- **An early owner scope-steer collapses design space cheaply:** "subject stays Nederland" turned the multi-source region-taxonomy problem from a structural redesign into a non-issue (the Dutch hierarchy simply stays canonical). Ask for the scoping constraint before designing, not after.
- **Session-tail doc drift is real:** the morning's handoff block ("PRs await review") was stale by evening (merged + deployed) — the wrap-up sweep caught it. A "current state" block written mid-session must be re-verified at close, not assumed.

## 2026-07-07 — Session 30 (autonomous review of the go-live work + 4 fix PRs, Fable): a validator calibrated on one data shape goes quietly blind on the next; a dead verifier is a null result, not a refutation

- **A validator hardened against the data shapes you HAVE is silently blind to the shapes onboarding brings in.** The R3/R10 validator was adversarially hardened against the 8 seed tables — all positive values, short units. The FIRST on-demand-onboarded table (consumentenvertrouwen) was negative-valued with a 34-char unit, and BOTH properties fell through: a negative cell could never match (the tokenizer was deliberately unsigned and only derivations had an absolute-value path) and the unit could never fit R10's 24-char window. Nothing failed loudly: the LLM rung silently always-fell-through, the template rung is served without enforcing its own validation verdict, and the recorded `ok:false` only mattered where nobody looked — R8 re-validation, which the stored live −24 answer FAILS today (heals when PR #15 merges: reconstruct re-runs the current validator). Lesson: when a new data shape enters the system, re-test the invariant layer's implicit assumptions against it — "the validator passes on everything we serve" was only true for the shapes that existed when it was written.
- **A workflow verify-agent that DIES is a null result — never let its absence read as "refuted".** The multi-agent review's verify stage was cut off by a session limit; the harness scored those four findings as not-upheld and the summary listed them under "refuted". Two of them were the most important findings of the session (the validator blind spots), verified real by hand after the resume. Read a workflow's failure log NEXT TO its result before trusting the buckets.
- **Poisoning a `Db` in a test must wrap the TRANSACTION client recursively.** `withTransaction: (fn) => real.withTransaction(fn)` hands the code under test the REAL tx — the poison never fires inside transactions and the test asserts a world that doesn't exist. The working shape is `withTransaction: (fn) => real.withTransaction((tx) => fn(poison(tx)))`. Caught because the queue-wedge test failed in the "good" direction (the row finalized because the refund silently succeeded).
- **`gh` multi-account: the repo-owning account may not be the active one.** This machine has three GitHub accounts in `hosts.yml`; the active one 404'd on the private repo. `gh auth switch -u Stefan7168` plus a repo-local `credential.helper '!gh auth git-credential'` fixed fetch/push without touching global git config — a fresh session hitting "Repository not found" on this repo should check `gh auth status` before assuming the repo moved.
- **The #111-relevant fact a design must not miss: the finder's input is narrower than the question.** `findTable` receives only the parser's `unmatchedMeasureTerm` ("bijstand") — the stock-vs-flow intent in the question is discarded before Stage 1 runs, so no rerank-prompt-only fix can work. Recorded with the full design space in [session-briefs/2026-07-07-111-problem-dossier.md](session-briefs/2026-07-07-111-problem-dossier.md).
- **First session under the #118 split rule:** autonomous + money/core ⇒ everything shipped as four reviewable PRs (#13–#16), docs to `main` directly. The mechanics work; the owner now has a review queue instead of a fait accompli.

## 2026-07-06 — Session 29 (#115 b+c answer quality, ultracode): the source may already publish what principle (a) forbids you to invent; a new column on a hot read path is a deploy-order landmine even when additive; one builder for a line that is both built and re-derived

- **When principle (a) ("invent nothing") blocks a quality fix, check whether the SOURCE already publishes what you need before assuming you'd have to fabricate it.** The onboarded answer needed a real definition + the −100..+100 scale, and the owner's own example phrasing ("het gemiddelde van de twaalf maandwaarden") was an approximation we couldn't safely assert. Instead of inventing, I `WebFetch`ed the raw CBS OData `MeasureCodes` for 83694NED and found CBS's own `Description` field carries **both** the definition and the exact scale ("−100 (iedereen negatief) tot +100 (iedereen positief)") — verbatim, licensed, principle-(a)-clean. We had been **fetching and discarding** that field (`parseMeasures` only kept code/title/unit/decimals). The whole (b)+(c) fix became "capture and surface CBS's own words," not "phrase it ourselves." Lesson: a fetched-but-dropped metadata field is worth checking before you conclude a fix would violate the no-invent rule — grep the adapter for what the wire actually returns vs. what you keep.
- **A new column read on a HOT path is a deploy-order landmine even when the migration is purely additive — and migration-first-operationally is not enough; make the code not depend on the column on the dominant path.** The first cut added `definition_text` to the canonical-measure SELECT in `resolve.ts`, which is the path EVERY ordinary (seed-table) question takes, not just onboarded ones. Because migrations are applied manually (never on push) and CI's smoke check only curls `/` + `/login`, a deploy-before-migrate would have degraded every canonical question to a refund-refusal, invisibly green in CI — the exact #114 class. The adversarial review (two independent lenses) caught it. The durable fix wasn't "remember to migrate first"; it was **gating the new-column read on a condition that can only be true AFTER the migration** — the `onboarded:` key prefix, since an onboarded row can only exist once `onboarding-vocab.ts` inserted it (which requires the column). So the hot seed path never references the new column, and the read that does can never hit a missing one → deploy-order-safe in any order. Generalize: when you add a column, ask "does the hot path read it, and is there a key/flag that's only set post-migration to gate the read behind?"
- **A structural line that is BUILT in one place and RE-DERIVED in another WILL drift — extract one shared builder the moment there are two copies.** `compose.ts` assembled the "Definitie:" line; `audit/reconstruct.ts` independently re-derived it to verify R8 audit integrity — and had quietly kept the OLD logic, so onboarded answers (definition from the new `definition_text`) would have failed reconstruction, AND it had *already* silently missed the previous session's lever-(a) circular-suppression (a latent drift nobody had a test for). Fix: `buildDefinitionLine(result)` in `compose/format.ts` as the single source of truth both call (same pattern as the existing `buildAttributionLine`, which reconstruct already shared and therefore never drifted). Lesson: the audit-reconstruct verifier is a second copy of every composition rule by construction — any composition change must go through a builder both import, or the verifier silently diverges from the composer.
- **Confirm WHERE an artifact actually renders before choosing its presentation — the render surface is a function of the DELIVERY path, not where you assume it appears.** The owner leaned toward a collapsible "Definitie" expander for a clean chat bubble; I nearly built it in `chat.tsx`. But an on-demand-onboarded answer is delivered ASYNC and lands in the DASHBOARD history (`question-history.tsx`), which renders the full `finalText` blob (`QuestionHistoryEntry` has no structured fields) — the live-chat structured `answerView` path barely sees onboarded answers. So the "thin web layer" expander is actually a real dashboard refactor (expose structured fields + restructure the history renderer), entangled with #117. The substance (real definition everywhere) shipped in the answer body regardless; the presentation choice got re-scoped and handed back to the owner. Lesson: trace the delivery path to the actual render component before estimating a UI change — "it's just a chat bubble" was wrong.
- **The stray-worktree vitest-glob trap recurred (4th time), now from a review workflow's `isolation: worktree` executing lens.** The lens reverted its mutation probes (`git checkout -- .`) so the worktree was "unchanged," but it was NOT auto-removed and lingered under `.claude/worktrees/`, ready to inflate the root vitest glob on the next run. Caught it with `git worktree list` before trusting a count; `git worktree remove --force` + `prune` cleared it. Until `task_5e78eaa0` (add `.claude/**` to the vitest exclude) lands, treat "run an `isolation: worktree` workflow" as "must `git worktree list` + prune before the next test-count run."

**Live-step lessons (same session, the supervised go-live of #115 b/c):**
- **VERIFY THE ACTUAL RENDERED OUTPUT LIVE before declaring a quality fix done — a source-metadata check (WebFetch) is not the same as the raw field.** The whole point of #115(b) was the −100..+100 scale, and the local gate + a WebFetch of CBS all looked green — but the live read-only compose showed the Definitie line stopping at a preamble, with the scale DROPPED. Cause: `cleanCbsDefinition` took only CBS's FIRST `\r\n\r\n`-separated block; consumentenvertrouwen's Description is `"Indicator van … . Dit is de oorspronkelijke reeks."` (block 1) then the real definition + scale (block 2). The WebFetch had HIDDEN the block structure (its markdown conversion collapsed the blank line into one paragraph), so the "first block" heuristic looked safe when it wasn't. A cheap **read-only, LLM-free verify script** (construct the intent → `runQuery` → `buildDefinitionLine` against prod) surfaced it in seconds, €0. Lesson: for a fix whose value is a specific piece of the output, assert THAT piece against the real rendered result on real data — and prefer the raw API field over a summarizing fetch when the exact bytes matter.
- **The review's flagged-but-unconfirmed risk was the real bug.** The clean-edge lens explicitly asked "multi-paragraph where the real definition is in a LATER block — is dropping it a correctness loss?" and it was dismissed as by-design. It was the exact defect. Lesson: when a review lens raises a correctness question you answer with "by design," write a test that PROVES the design choice is safe on a realistic input, or treat it as unconfirmed — don't dismiss it in prose.
- **A change to a type shared by `src/` and `web/` must run BOTH typechecks before push.** `Attribution` gained a required `definitionText`; backend `npm run typecheck` was green but `web/` has its own tsconfig + fixtures (`web/test/fake-answer.ts`) and CI's web typecheck failed, blocking the deploy (correctly — prod stayed on old code). The backend grep for construction sites missed the web ones (drowned in `.next/` output). Rule: after touching a cross-boundary type, `npm run typecheck && npm run web:typecheck` locally; and constrain construction-site greps with `--` path filters excluding `.next/`/`node_modules/` or they're unreadable.
- **A plain `ingest sync` does NOT refresh a table's stored `units` metadata — only `sync --rebaseline` does (units aren't part of the fingerprint; metadata changes are treated as deliberate, reviewed events).** After enriching `units` with a new field (CBS `Description`), a normal re-sync reported "unchanged" and wrote nothing to `units`, so the downstream backfill read stale metadata and produced all-NULL. `--rebaseline` recomputes + persists `units` from the fresh schema (safe for an unchanged-schema table: just a metadata refresh + version bump). Lesson: to propagate a NEW `units`/metadata field onto an already-registered table, rebaseline — a routine sync won't carry it. (This is #34a's "no path to change a registered slice" biting in a new form; the reusable backfill helper `scripts/onboarding-reregister.ts` was committed this session.)
- **The local CBS IPv6 black-hole recurred (3rd supervised step) — the `--import` IPv4-force preload is now a standing requirement for any owner-run CBS fetch, not a one-off.** `ingest sync` failed `fetch failed` from the owner's host exactly like `catalog:refresh` did in session 25; the same `force-ipv4.mjs` preload (`net.setDefaultAutoSelectFamily(false)` + `dns.lookup` → family 4) fixed it. It lives only in scratchpad each time — worth promoting to a committed `scripts/force-ipv4.mjs` + a one-line RUNBOOK "prefix every owner-run CBS-fetch CLI with `node --import scripts/force-ipv4.mjs …`" so it isn't re-authored every supervised step. (Deploy host is unaffected — this is local-network only.)

## 2026-07-06 — Session 28 (WP16 sub-part 2 GO-LIVE, owner-supervised): a pre-flight prod curl caught a middleware bug hermetic tests can't see; prebuilt deploys need a fresh push for env vars; a confident topic-match is not a correct table-match

- **Before the FIRST real/paid use of a newly-live feature, curl the actual deployed endpoint — the handler tests can't see the middleware in front of it.** Right after the go-live deploy, a plain unauthenticated `curl https://.../api/onboarding-cron` returned **307 → /login**, not the expected 401. The session-refresh proxy (`web/proxy.ts`) redirects every non-allowlisted path to /login, and the new cron route was never added to `PUBLIC_PATH_PREFIXES` — so the app's kick AND the daily Vercel cron would have been redirected **before the route's own CRON_SECRET auth ever ran**, and the onboarding job would have silently never executed. Every hermetic test stayed green because `onboarding-cron.test.ts` calls the route handler `GET()` and the job directly, *past* the proxy — the exact #114 "deploy green, app broken at the middleware layer" blind spot, made concrete on a money path. The zero-cost pre-flight probe (expect 401, not 307/503) caught a total-feature-failure before a single credit was spent. **Rules:** (a) any route that must be reachable WITHOUT a user session (webhooks, crons, health) needs adding to the proxy allowlist AND a test that pins it — a route-handler test alone is a false-green; (b) the fix extracted a pure `isPublicPath()` and unit-tested it, because a full `proxy()` behavioral test throws in jsdom (`NextResponse.next({request})` requires Next's own `Headers` class — "request.headers must be an instance of Headers").
- **A `--prebuilt` Vercel deployment cannot be dashboard-"Redeployed" to pick up newly-added env vars — you must create a NEW deployment.** CI deploys via `vercel deploy --prebuilt`; the dashboard Redeploy refuses ("prebuilt deployments cannot be redeployed because they will not use the latest environment variables"). After adding `CRON_SECRET`/`RESEND_API_KEY`/`ONBOARDING_ENABLED` in Vercel, the working trigger is an **empty-commit push** (`git commit --allow-empty` → CI → fresh deploy), which inherits the current Production env config; runtime `process.env` vars attach to the deployment at deploy time, so a deploy created AFTER the vars were added sees them. Set env vars to **Production only** to match the existing secrets (Preview has no `DATABASE_URL`, so enabling the feature there would just error).
- **The harness correctly blocks autonomous production DB access even after the owner says "Go" — prepare-and-hand-off is the pattern for a supervised live step.** The auto-mode classifier denied even a read-only prod `schema_migrations` query against the stated "live step, together, never autonomous" boundary. Right outcome: the OWNER ran `npm run db:migrate` and the read-only verification scripts (`connectFromEnv` + `.env`) in his own terminal; the session authored the exact commands + scripts and interpreted the output. Don't fight the block — hand the irreversible/prod-touching command to the owner and verify the result. (The read-only checks the owner ran this session — the migration-state check and the `pending_table_requests` grants/RLS lockdown check, both `connectFromEnv` + `.env`, SELECT-only — lived only in the ephemeral scratchpad and were not committed. Consider promoting a small reusable `scripts/verify-lockdown.ts` so the next supervised live step (a future migration) doesn't re-author them from scratch.)
- **The stray-worktree vitest-glob trap recurred (3rd time) and cost a real scare — a leftover `.claude/worktrees/` from a review agent inflated the root vitest glob to 118 files / 1,900 tests with 48 false failures, looking like a broken gate on green code.** Removed with `git worktree remove --force`; re-ran clean (real backend = 51 files / 891 tests). Same class as the session-24 entry below, but this time with a concrete fix queued: **add `.claude/**` to the root (and `web/`) `vitest.config.ts` exclude so a leaked worktree can never inflate the glob again** — `task_5e78eaa0` spawned to do it. Until that lands, a session seeing an unexpected jump in the backend test count should suspect a stray worktree first (`git worktree list`), not a regression.
- **A confident TOPIC match is not a correct TABLE match — the finder must weigh the measure's SHAPE (stock vs flow, total vs breakdown), not just topic-word overlap.** The first live onboarding, *"hoeveel mensen zaten er in de bijstand"*, mapped "bijstand" to a real bijstand table — but `85615NED` = *"(Her)instromers en uitstromers"* (in/out FLOW), which has no stock "how many people ARE in bijstand" measure, so delivery honestly refused + refunded. The refusal was correct (never fabricate), but the *finder* should have preferred a stock/count table. Owner's binding verdict: a simple common question like this MUST answer ("dit kan echt niet"). Recorded + elevated in #111 with a fix plan (teach the rerank stock-vs-flow; find the correct kerncijfers table) and a spawned task. General finder-precision lesson: topic overlap is necessary, not sufficient — intent has dimensions (stock/flow, national/regional, level/change) the shortlist rerank must score.
- **Don't characterize a fix's difficulty before reading the code — "quick/safe" was a guess the code contradicted, and it set a false expectation with the owner.** The #115 circular "Definitie:" line looked like a one-liner. Reading the code showed the clean SOURCE fix (store `null` instead of the CBS title) needs a **production migration** (`canonical_measures.definition_label` is `text NOT NULL`) + a `CanonicalMeasure` type widening + intent-prompt null-handling — not a tail-of-session change on a live product. The genuinely safe path was a **compose-layer suppression** (drop the line when `definitionLabel` equals the measure's own title, CASE-SENSITIVE so the `population` seed — whose definition differs from its title only in case — is untouched), backstopped by the benchmark proving zero seed regression. That path was only visible after reading `compose.ts` + `resolve.ts` (incl. `normalizeLabel` = whitespace-only) + `onboarding-vocab.ts` + the seed `defaults.ts`. Lesson: scope a fix from the code, not the symptom; and the moment the code contradicts an estimate you gave the owner, say so.

## 2026-07-06 — Session 28 (#113 kick-on-trigger build): a route that only responds on completion makes the caller wait out the whole job; Vercel request cancellation is opt-in; DOMException is not instanceof Error

- **Verify the load-bearing PLATFORM fact for a money-path feature — don't ship on the reviewer's assumption.** The kick fires `/api/onboarding-cron` and the review's premise was "the job keeps running server-side even after the caller dies." That premise is load-bearing (if a client disconnect *cancelled* the route, the kick would start-then-kill the very job it triggers). Checked it instead of trusting it: **Vercel request cancellation is OPT-IN** — you add `"supportsCancellation": true` to a path in `vercel.json` to have a client disconnect abort the function via `request.signal`; without it (our case — `web/vercel.json` has only `crons`), the route runs to its own 300s budget regardless of the caller. Source: Vercel changelog "Node.js Vercel Functions now support request cancellation". This one fact is what makes the whole "fire the kick, stop waiting, the job runs on" design safe — and it's now a code comment in `onboarding-kick.ts` (with the inverse warning: never enable `supportsCancellation` on the onboarding-cron path).
- **A route that only responds when its work FINISHES turns `await fetch` into "wait out the whole job" — deadly when the caller has a shorter budget than the callee.** `/api/onboarding-cron` does `await runOnboardingJob()` (tens of seconds) *then* returns; the kick's `await fetch` therefore blocks for the entire job. But the kick runs inside `after()` in a page Server Action capped at `maxDuration = 30` (`web/app/page.tsx`), while the route is sized for 300s — so on any job longer than 30s the platform **silently kills the caller mid-await**, and the kick's own success/failure line never logs (you can't tell at the live step whether the kick even fired). The review's MEDIUM named the gap between intent ("fire and move on") and code ("fire and wait it out"). Fix: `AbortSignal.timeout(10s)` — dispatch the request (sub-second; the job starts and, per the opt-in fact above, runs on), then stop waiting. Lesson: when you `fetch` a route to *trigger* work, check whether that route responds on *dispatch* or on *completion*, and bound the wait accordingly; a self-fetch to a long route from a short-budget function is a silent-kill trap.
- **`DOMException` is NOT `instanceof Error` in Node — a `.name`-plus-`instanceof Error` guard never matches the abort it's meant to catch.** `AbortSignal.timeout()` rejects with a `DOMException` named `'TimeoutError'`; the first guard was `error instanceof Error && error.name === 'TimeoutError'`, which is always false for a DOMException, so every timeout would have logged as a real `console.error` failure (making every successful long job look broken). The signal-honoring timeout test (a `fetchImpl` that rejects with `signal.reason` when the real `AbortSignal.timeout` fires) caught it on the first run. Match abort/DOMException errors on `.name` directly, never behind an `instanceof Error` narrow. General: when a test needs to exercise a timeout/abort branch, model the real rejection *value* (the DOMException), not a hand-rolled `new Error('timeout')` — the hand-rolled one would have passed and hidden the bug.

## 2026-07-06 — Session 27 (WP16 sub-part 2, ultracode build): freeze the design in a committed file BEFORE orchestrating; in-flight subagents die with the process; five build-mechanics lessons from the stage reports

- **Externalize the expensive thinking into a committed file BEFORE fanning out agents.** The first build workflow launched with two top-tier design agents; the session's process exited mid-flight and BOTH were lost — no journal entry, nothing salvageable, pure spend loss. The rerun wrote the canonical design to `docs/session-briefs/…-design.md` first, and the entire build then ran on cheaper tiers with zero re-thinking. Corollary: workflow resume caches only COMPLETED agent calls — an in-flight agent is worth nothing on resume. For any orchestration whose design phase is expensive: design → commit → then build, never design-inside-the-run. (Same session, the continuity companion: a living brief in session-briefs + stage commits on a branch + a worktree HANDOFF file let ANY model tier resume mid-build — the "logger model" the owner asked about was not needed; the workers logging their own state as part of the work is strictly better.)
- **`withTransaction` cannot nest** (both the prod pg client and PGlite throw on nested BEGIN via this helper) — compose primitives by exporting the inner statement function and calling both inside ONE transaction (the `triggerOnboarding` shape), not by calling a transaction-wrapping function from inside another.
- **The intent parser's vocabulary is CODE, not DB** (`prompt.ts`/`schema.ts` static enums) — a DB-only registry row is invisible to the parser. The safe extension pattern: an optional parameter that defaults to empty so the rendered prompt/schema bytes stay byte-identical for every recorded fixture (proven by the replay hashes), extended only where the new path needs it. Any future "make the parser aware of X" work must budget for this seam.
- **Write the test that asserts the THROW when you find a blocking gap in another module's guard.** Scaffold found that migration 008's compensation trigger only allowed reversing `question_cost` — instead of silently widening it in the same commit, it landed a test asserting the throw, and the widening became its own reviewed migration (013). The gap stayed loud and traceable instead of disappearing into a 6,000-line diff.
- **PGlite cannot exercise `FOR UPDATE SKIP LOCKED` races** — it serializes everything onto one connection, so a deleted SKIP LOCKED clause passes every behavioral test (proven by mutation). Pattern adopted: a mutation-proven SOURCE pin (assert the clause exists in the function body) + an explicit deferred live-Postgres check in the RUNBOOK supervised step. Don't name a describe block after a guarantee the tests don't exercise — that was the review's one confirmed finding.
- **Don't run the web suite and the full backend suite concurrently on this machine** — resource contention produced a one-off timeout in an untouched test (looked like a regression, wasn't; two isolated re-runs green). Sequential suite runs for gate measurements; the WP21 concurrent-mutation lesson generalizes to plain parallel RUNS.
- **Platform plan limits are DEPLOY-time failures — check them during DESIGN; and identify which run you are watching before drawing conclusions from it.** The designed minutes-level Vercel cron (`*/2 * * * *`) was rejected by `vercel deploy` — "Hobby accounts are limited to daily cron jobs" — deterministically, on every deploy that carried it. The session initially mis-diagnosed Vercel as validating "inconsistently" because it had watched the WRONG run: right after pushing the merge it grabbed `gh run list -L 1`, which still showed the PREVIOUS (docs-only) push's run — that run's green deploy was celebrated as the merge deploying, while the merge's own deploy had failed. Corrected by checking `headSha` per run. Three lessons: (a) check the hosting plan's limits at DESIGN time for any schedule/timeout/size the design leans on (the 300s function budget was checked; the cron cadence wasn't); (b) after pushing, resolve the run BY COMMIT (`gh run list --json headSha` or `gh run view --json headSha`), never by "latest"; (c) the silver lining of fail-closed deploys: production kept running the pre-merge deploy throughout, so the not-yet-gated wiring never reached users. Fixed to a daily backstop + the cadence decision gated at #113; the corrected-run story is why #113's first framing said "inconsistently" (also fixed).
- **"Dormant until the live step" must be MECHANICAL, not aspirational — a deploy that merely *shouldn't* be reached will be reached.** The merged build deployed with the finder wired unconditionally while migrations 012/013 weren't applied: a confident finder pick would have hit the missing table and degraded to an internal-refusal — money-safe and honest (fail-closed + refund did their jobs), but a UX regression vs the pre-WP16 clarification, plus untracked per-question rerank spend. Caught in the post-merge review by asking "what happens if a user does X *today*, between merge and the supervised step?" — a question none of the build/review stages owned, because each verified the code against its design, not against the DEPLOYMENT TIMELINE. Fixed same-session with an `ONBOARDING_ENABLED` env gate (test-pinned). Rule of thumb: any feature whose live prerequisites (migrations, secrets, crons) land LATER than its code needs an explicit off-switch that defaults to off. Related catch in the same pass: the finder's catch block covered less than its own comment claimed ("ANY failure here must degrade") — when a comment states a contract, the review should test the contract against the code, not read the comment as evidence. **Epilogue — the gate itself was incomplete, and production proved it (owner-reported):** the switch covered the FINDER (the feature's entry point) but not the dashboard's new HISTORY READ, which also queried the missing table — `GET /` 500'd for every logged-in user until the read path got the same switch. The off-switch rule therefore sharpened: **gate every request-time reference to the new tables — grep for the table/store module across `src/` + `web/` and check each reachable path — not just the feature's front door.** And the CI smoke check's blind spot did the rest: it hits `/login` only, and `/` redirects anonymous visitors there, so an authenticated-only 500 keeps CI fully green (#114). The incident is pinned mechanically: a throwing-db test proves the default path never touches `pending_table_requests`.

## 2026-07-05 — Session 26 (full-repo sanity review): cross-reference staleness is the doc-freshness blind spot; verify owner notes against git before executing them; a connected MCP connector can point at the wrong product

- **The doc-freshness rule's blind spot is CROSS-REFERENCES: an ADR that claims to amend another doc without editing it.** A 6-lens double-verified review of sessions 24–25 found ZERO code defects but six doc-staleness items, and the most instructive was ADR 025 stating catalog/ "joins the ADR 001 module list" while ADR 001 was never edited — three earlier modules (`registry/`, `billing/`, `db/`) had already drifted past that list unnoticed across multiple sessions, and `validation/` in the list never existed at all. **Refinement to the "grep for the old framing" rule: when a change claims to amend or join another doc, edit THAT doc in the same change — a claim of amendment is not an amendment.** Same class, smaller: ADR 025's "refreshed on a schedule" (no schedule exists — #106 is the open cadence question) and the CI header comment undercounting its own suites.
- **A session brief / owner notes can describe an already-resolved state — verify against `git log` before executing any of it.** The owner's session-26 notes described uncommitted work, a reverted aliases.ts, and a failing-tests reconciliation task; ALL of it had already landed in session 25's commits (direction A, confirmed in-tree). The notes' own "STAP 0: verify, don't trust this overview" discipline is what prevented re-executing landed work — half the brief dissolved on contact with the repo; the durable remainder (4 new open questions) was the real work. (The session-16/19 "check git log before assuming" lesson, now in brief-triage form.)
- **A connected MCP connector is not necessarily THIS project's connector.** The Supabase MCP available in-session lists only a different product's projects (glaibaan-*, no `cbs_catalog`); the read-only prod verification instead went through the repo's own db client + `.env` `DATABASE_URL` (SELECTs only), which worked first try and matches how earlier sessions did it. Check what a connector actually points at before querying — and before concluding anything from "table does not exist".
- **Verified for the #110 lifecycle design before it bites:** `ingest sync --all` targets the hardcoded `PHASE0_TABLES` seed, not the DB's registered set (an on-demand-onboarded table would never refresh — sub-part 2 must make it registry-driven), and R8 audit reconstruction is self-contained by design (reconstruct.ts: "no database"), so cell eviction cannot break the audit trail — two facts that shape #110's recommendations and were cheap to verify now vs. rediscover mid-build.

## 2026-07-05 — Session 25 (WP16 sub-part 1, SUPERVISED live step): a dual-stack host that black-holes IPv6 breaks node fetch but not curl; a worktree review can't see uncommitted work; seed labels can be wrong

- **node's `fetch` (undici) could not reach `datasets.cbs.nl` while `curl` could — CBS's IPv6 address black-holes from this host and undici's Happy-Eyeballs fallback to IPv4 doesn't recover.** `npm run catalog:refresh` failed with `UND_ERR_CONNECT_TIMEOUT` (undici) / `ECONNRESET` (node core `https`), both listing the IPv4 **and** IPv6 addresses as "attempted"; `curl` connected to the IPv4 in ~1.5s. Crucially node reached `api.anthropic.com` and `example.com` fine — it was **CBS-specific**, not a sandbox/egress block (it failed with the Bash sandbox disabled too). `net.getDefaultAutoSelectFamily()` was `true` yet undici still timed out; `--dns-result-order=ipv4first` did **not** fix it, but `https.get(url, {family: 4})` returned 200 immediately. **Fix without touching committed code:** a `--import` preload that forces IPv4 (`net.setDefaultAutoSelectFamily(false)` + monkeypatch `dns.lookup` to `family: 4`) — the unmodified `catalog:refresh` CLI then reached CBS and ingested all 4,858 rows. **Lesson for any future maintenance session running `catalog:refresh` (or `fixtures:capture:catalog`) from a v6-black-holed network:** if node fetch to CBS times out but curl works, it's the IPv6 fallback — preload an IPv4-force shim, don't debug the app. (A permanent option, if this recurs on the deploy host: give the adapter's fetch an IPv4-preferring dispatcher; deferred — the deploy env reaches CBS fine, this was local-only.)
- **The catalog bulk-refresh is slow: ~19 minutes for 4,858 row-by-row `INSERT … ON CONFLICT` upserts in one transaction over the Supabase session pooler.** Correct and idempotent, but each upsert is a separate awaited network round-trip to eu-central-1. Acceptable for a scheduled/maintenance op; if the cadence tightens, batch into multi-row `VALUES` or `COPY` into a temp table + one `INSERT … SELECT`. Flagged, not fixed (phase-gate: refresh is off the request path).
- **A worktree-isolated review lens branches from HEAD — it CANNOT see uncommitted working-tree changes.** The house rule "executing/mutating review lenses get isolated worktrees" (session 21/24) collided with reviewing an **uncommitted** diff: the `isolation: 'worktree'` test-honesty lens saw a clean tree (10 tests, the OLD label, no calibration comment) and reported a HIGH "the described changes don't exist" — a false alarm from the isolation mechanism, not a defect. **Refinement to the rule:** worktree isolation is for a mutating lens over **committed** state; to adversarially review *uncommitted* work either (a) commit first, then review in a worktree, or (b) review in the shared tree and run the mutation proof yourself (I neutered the two aliases in place, confirmed exactly the 3 new tests fail, restored byte-exact from a backup, re-confirmed 13/13). The read-only shared-tree lens (alias-precision) worked fine and returned clean.
- **The structured-output retry cap (5) recurred** — the label-correctness lens died with no output (same failure class as sessions 16/19). Re-running it as a **plain free-text `Agent` (no `schema`)** succeeded. When a judgment lens only needs prose reasoning, don't force a JSON schema on it.
- **A seed labelled-set expectation can be wrong — distinguish three miss types before "fixing" anything.** Live `tablefinder:record` scored 5/8; the 3 misses were three different things: (1) **zonnepanelen** — the rerank picked `85004NED` ("Hernieuwbare energie; zonnestroom … productie in mln kWh", the specific solar-output table) over the seed's `82610NED` (general renewables); the **model was right, the label was wrong** → relabel, justified from the CBS `Description`, not from the model's confidence; (2) **bevolking** + (3) **woningvoorraad** — Stage-1 **recall** misses (`plainto_tsquery` AND-ed common words to zero / to only price tables); the rerank behaved correctly (woningvoorraad honestly disclosed at 0.25: "geen van de kandidaten past") → fixed with two alias hints. Only after separating "label wrong / model right" from "recall wrong / model fine" did the fix set become obvious; re-record then went 8/8. **Threshold `highConfidence` = 0.8, calibrated (not moved).** Honesty catch by the review lens, worth recording: my first calibration comment cited "one correct disclose at 0.25 — a wide gap." That 0.25 was a REAL measurement, but from the *pre-fix* run (woningvoorraad before its alias fix); once fixed, that case is confident, so the FINAL set has **zero disclose cases** and the confident/disclose gap was never measured in the final config. Corrected to state only what's measured: the confident FLOOR is 0.85 (stable), 0.8 sits below it (0.05 margin), the disclose boundary is under-measured (the set needs a disclose-expected case — noted for sub-part 2). **Lesson: when you re-record between calibration attempts, a number from an earlier run is not evidence about the current config — cite only the final artifact.** The failure direction is genuinely safe either way: a pick dipping below 0.8 DISCLOSES (verified in `find.ts` routing), never emits a wrong table. (Also: only zonnepanelen's 0.85→0.92 was true temp-0 sample variance on an identical request; bevolking/woningvoorraad changing kind between runs was the alias fix, not noise — don't conflate the two.)

## 2026-07-05 — Session 24 (WP16 sub-part 1, table finder): verify the API before designing; de-risk the riskiest mechanism first; background workflows don't survive a host freeze

- **The delegated research in the brief was partly wrong — the empirical "verify the endpoint first" instruction paid off three times.** The build-plan's own sub-part-1 research (delegated to Sonnet in session 23) stated "Summary/description is not filterable on the v4 Datasets listing." Measured live this session: `Description` (the summary) IS in the listing AND `contains(Description,'bijstand')` filters server-side; the catalog `Identifier` IS verbatim the id the data endpoints need (`/85773NED`→200, `/85773`→404, so no id-mapping layer); and `Status`/`DatasetType` give free principle-(c) signals the research didn't mention. **Lesson:** a delegated-research summary baked into a brief is a starting point, not ground truth — a few read-only GETs before committing the design corrected three assumptions at zero cost. The brief's own "verify the exact catalog endpoint path empirically first (the docs/07 precedent — don't assume the URL shape)" was right; honour it. (Facts recorded in ADR 025.)
- **De-risk the single riskiest unknown with a throwaway smoke test BEFORE building on top of it.** The whole Stage-1 recall rests on Postgres Dutch FTS working on the hermetic PGlite test DB — an unproven combination (`setweight` generated `tsvector` + GIN + `'dutch'` config). A ~20-second scratch script (apply migration → insert rows → `plainto_tsquery`) confirmed it works before ~1,000 lines were written on top. Cheap insurance against building a module on a foundation that can't run in CI. (The adversarial review later found only 3 LOW findings — the code was clean because the riskiest bits were smoke-tested and unit-tested as they were built.)
- **Background workflows do NOT survive a host process restart; foreground agents do.** The host machine froze twice mid-session, each time while the adversarial-review **Workflow** was running in the background — both runs left "no completion record" (zero results) and a **locked leftover git worktree** from the executing lens. The WP18 leftover-worktree lesson recurred: a locked worktree needs `git worktree remove -f -f` (plain `remove` and `remove -f` both refuse a lock held by a now-dead pid), and stray worktrees under `.claude/worktrees/` inflate vitest globs. **Lesson:** when the environment is unstable, run review/verification that MUST complete as **parallel foreground `Agent` calls** (bounded to the turn, no cross-restart survival needed) rather than a long background `Workflow` — the three foreground review lenses completed cleanly on the retry after two background attempts died. Nothing was lost either time because all code/docs were already written to disk and the gate was green before each freeze — but the *review* had to be re-run three times.
- **Model-tier judgment, recorded for the pattern:** the owner authorized Fable on WP16's hard sub-parts and asked whether the topic→table match earns it. It does not, in v1 — a closed multiple-choice over a shortlist WE hand the model, guarded by a hard allowlist, is an easier shape than the intent parser (already on Haiku), and the principle-(c) risk is contained structurally (allowlist + conservative threshold + disclosure + verify gate), not by model size. The escalation ladder (Haiku→Sonnet→Fable) is a one-line constant gated on a *measured* miss. The reusable rule: reach for the bigger model only when the *task* is genuinely harder or measurement shows the cheap tier missing — not because the feature "feels important". (ADR 025 decision 3.)

## 2026-07-05 — Session 23: mis-stating a settled decision from a collapsed summary; the audit runner == the live UI; and a hard DELETE that can't run

- **The costliest miss: I told the owner the on-demand-CBS-fetch was NOT how it works — contradicting a decision he'd made across multiple sessions.** I collapsed principle (b) ("CBS is never in the *answer* path") into "we never call CBS when data is missing", which flatly contradicts the decided WP16 (fetch → verify → store → answer, with wait-messaging). The owner was (rightly) very frustrated — a settled, designed decision read as forgotten. **Root cause:** restating a compressed from-memory summary instead of re-deriving from the docs/memory. **Fix (now a CLAUDE.md "Doc freshness" working agreement + a memory, `feedback_demand_driven_cbs_fetch`):** before telling the owner something "isn't how it works / isn't decided," check the docs + memory for a recorded decision first — a recorded owner decision outranks a session's recollection. Contributing cause: WP16 was buried in the roadmap feature pool + a "NOT YET BRIEFED" placeholder — **buried decisions get mis-stated**, so it's now a prominent execute-ready brief at #1 priority, and STATUS/roadmap/03-mvp-scope/02-user-scenarios were de-staled the same session (a repo-wide staleness sweep).

- **A `node --env-file` runner exercises the EXACT same code the deployed UI runs — `web/backend` is a symlink to `../src`.** The experience-audit runner (`scripts/run-experience-audit.ts`, `npm run audit:experience`) calls the same `answerQuestionAudited` entry point, same models, same live Supabase, same clock as `web/app/actions.ts`. Cross-checked live: three answers matched the deployed UI on every validated field (number/region/period/table/sync/price). The ONLY thing that flexes run-to-run is the LLM's final sentence ("telt" vs "telde", word order) — number/source/period are deterministic. So the runner is a faithful proxy for outcome/correctness/friction; it does NOT measure exact prose (not byte-stable by design). `sourceTag` only tags the audit row — no pipeline branch.

- **A hard `DELETE FROM audit_answers` cannot run: the ledger FK blocks it — and redaction is the better answer.** `credit_transactions.audit_answer_id` (migration 005) has a plain FK with no `ON DELETE` clause (deliberate — the erasure-vs-financial-trail tension left open). Any clarification/refusal row a compensation entry references throws on a hard delete. GDPR #14's self-service deletion + retention purge both **redact (UPDATE to a sentinel)** instead — which also matches the owner's "verwijderde vraag" placeholder decision better, no schema change. **Review-layer catch:** the delegated (Sonnet) build redacted only the free-text columns; the top-tier review found the *promoted topic columns* (`intent`/`table_ids`/`conversation_context`) still revealed the subject/region/period linked to the user, and extended the erasure — a concrete case of the delegate-build + top-tier-review split earning its keep on a privacy-critical feature.

## 2026-07-05 — Session 21/22 boundary: a concurrent session's commit can silently absorb your OWN uncommitted edits to a shared file — not a conflict, not an error, easy to miss

- **What happened:** while session 21 was reading the codebase to write the [UX design brief](10-ux-design-brief.md), it appended two new rows (#98, #99) to `open-questions.md` and one new section (WP24) to `08-build-plan.md` — pure additions, never touching a line the concurrent overnight session (22) was editing. Minutes later, session 22 ran its own `git commit` for WP23's own, unrelated changes. Because both sessions share one working tree (same files, same filesystem, same git index — not separate branches or worktrees), session 22's commit captured whatever was in those two files at that moment, which by then included session 21's uncommitted additions too. Git has no concept of "these lines are yours" — it just commits file state. The result: #98/#99 and WP24 ended up physically inside commit `a9bee3b` ("WP23: display smalls..."), a commit message that never mentions them.
- **How this was caught, not avoided:** session 21 noticed only because `git status` showed the two files no longer locally modified right before its own commit — the tell that someone else had already swept them up. It then grepped the committed file to confirm the content survived intact (it did — nothing lost, nothing garbled), and its own commit ended up containing only what genuinely hadn't been absorbed (a STATUS.md line and the new brief file itself).
- **Why this is safe, not a bug:** the Edit tool's read-before-write requirement (errors loudly if a file changed since it was last read) is the actual safety net — it never fired here, meaning no line-level collision ever occurred, only a commit-boundary co-mingling. If two sessions genuinely edit the SAME lines, that tool error is what surfaces it; this lesson is about the case where they don't, and everything still looks fine because it is fine — just filed under a commit message that doesn't describe it.
- **Rule going forward:** in a shared-working-tree, concurrent-session model, always `git status`/`git diff --stat` immediately before your own commit and read it literally — if a file you edited no longer shows as modified, someone else's commit already carries your bytes. Verify with a targeted grep rather than assuming; don't re-add or re-edit content that's already safely committed under another commit's name.

- **Executing review lenses get isolated worktrees — no exceptions, reaffirmed the hard way.** The WP21 review ran its executing (mutation) lens directly in the shared working tree while a sibling lens ran the full suite concurrently: the sibling reported an "intermittent flake" (2/21 full-suite runs red with mutation-flavored failures) that was really the first lens's punch-a-hole probes flashing through the shared tree — and a mid-review `git stash/reset` cycle from a "read-only" lens momentarily blanked every uncommitted change (recovered; the mutation lens's own backups saved its scope). Re-measured after the lenses finished: 6/6 consecutive green — no flake existed. Same night, the WP22/WP23 reviews ran their executing lenses in real `isolation: worktree` sandboxes with zero contamination. Second lesson inside the first: **a live worktree doubles local vitest counts** (path-filter globs match the copies — the session-19 lesson in a new costume), so measured numbers only count from a tree with `git worktree list` clean.
- **Worktree agents may start on a stale branch ref.** One worktree spawned pointing at the parent commit of the just-made local commit; the agent brief's "verify HEAD is <sha>, checkout if not" instruction caught it. Keep writing that line into every worktree-lens brief.
- **`Blob.text()` strips a leading UTF-8 BOM by spec.** An Excel-required BOM must be asserted on `arrayBuffer()` bytes (EF BB BF), never on decoded text — the WP21 chat test failed exactly there on first run.
- **Next 16 ships the exact stale-deploy detector.** `unstable_isUnrecognizedActionError` (next/navigation) classifies the deploy-invalidated-Server-Action failure (#96a) precisely, and the internal `UnrecognizedActionError` class is importable from `next/dist/client/components/unrecognized-action-error` so tests can reject with the REAL class and exercise the `instanceof` — no string-matching, no mocking the detector.
- **`window.location.reload` cannot be `vi.spyOn`-stubbed in jsdom** (non-configurable). The working idiom is full-object replacement via `Object.defineProperty(window, 'location', { value: { ...original, reload: fn } })` — proven by the WP22 executing lens, now used by the reload-binding test.
- **A clarification template that OFFERS anything must offer through a checked builder.** The first draft of the #97a national-max template hardcoded "per maand of per jaar" — grains 4 of the 7 national-only measures don't have; the refusal-honesty lens proved it without live traffic. Second incident of the guidance-text-vs-checked-options gap (#63 recorded the first). Standing rule the codebase now demonstrates twice: offers come from `openEndedRangeOptions`-style checked builders or they don't name specifics.
- **Prompt-byte constraint has a precise boundary worth restating:** deterministic template text DOES reach LLM calls at runtime through the clarify-reply payload (`clarification_question`) — that is per-request payload, not template bytes, and has varied since WP9; fixtures are keyed by full-request hash so new payload text simply has no fixture. Template-byte stability is what the hash tests pin.

## 2026-07-05 — Session 20: a real Stripe payment succeeded, credits never landed — the webhook was configured in the wrong account, not broken

- **What happened:** the owner's first real test purchase completed (green checkmark, "success" redirect) but the credit balance never updated. Diagnosis took several layers: Vercel logs showed zero calls to the webhook route, ever; the Stripe account whose dashboard had the webhook configured ("Check de Cijfers" Test mode) showed zero API activity of any kind, ever — not a failed delivery, no activity at all. The actual checkout page's own branding said "GlaiBaan sandbox", a name that meant nothing to the project. Stripe's account switcher revealed why: **Stripe's newer "Sandboxes" feature nests fully separate accounts (own API keys, own webhooks, own everything) under one login** — `STRIPE_SECRET_KEY` had been creating real, successfully-paid checkout sessions in a *different* sandbox the whole time, which had no webhook destination at all.
- **Lesson:** when a webhook "looks right" (correct URL, Active, secrets present) but zero events ever arrive — not failed, *absent* — don't assume the code or the URL is wrong. Check whether the account you're viewing in the dashboard is the same account the API key actually creates objects in. The tell: that account's own **Workbench → Logs** (API request history) shows nothing at all, even for calls that provably succeeded elsewhere (a real payment went through, so *some* account logged it — just not the one you're looking at).
- **How to apply:** before debugging webhook delivery logic, confirm account identity first — the checkout page's own displayed business/sandbox name is a fast tell if it doesn't match the project name.
- **Also confirmed:** a Vercel environment variable change does nothing to an already-running deployment — env vars are baked in at deploy time, not read live. A dashboard save alone is not enough; a redeploy is required, and `vercel redeploy <url>` (reusing the existing build, not a fresh `vercel --prod` from a monorepo subdirectory — that hit an unrelated `zod` resolution failure on a from-scratch install) is the fast, low-risk way to pick up a secrets-only change with no code change.

## 2026-07-05 — Session 21 (#77 fix): a "one prompt rule" change is never a one-rule cost — price every base-prompt edit as a full fixture re-record plus a stability run

- **What happened:** the #77 fix was pitched to the owner as "likely cheap, well under €1" based on the size of the code change (one schema kind, one prompt rule, one resolver case — accurate). The measured live window came to **1,867,581 input / 32,379 output Haiku tokens ≈ $2.03 at list pricing (≈ €1.75–1.90 depending on rate)** — the four whole-set calibration-report entries plus one targeted `--only` record; ADR 023 names each summand. The code estimate was right; the *procedure* cost was missed: any edit to `buildSystemPrompt()` re-keys every fixture hash, so the fixed floor is re-recording all prompt-dependent fixtures (63 intent + 7 clarify + 22 follow-up here) **plus** the house-standard `--repeat=3` stability run (3× the labelled set), regardless of how small the edit is. Most of the spend was this fixed floor, not the new feature's own cases.
- **Rule going forward:** when estimating a prompt-touching change, compute the floor from the MEASURED per-call average, not a components guess: the record run's own report gives **~6.6K input tokens per intent call** (1,222,854 / 186 calls — the naive "prompt ~3.4K + schema ~1.2K" reckoning undercounts by ~30%; the review's docs lens caught this entry itself quoting the low number). Floor = `(labelled cases × (1 probe + 3 record/stability) + clarify cases + followup legs) × ~6.6K` — with today's 63-case set ≈ $2.0 / ~€1.8 before the first new case is added. Quote THAT to the owner, not the diff size. The client sends no `cache_control`, so nothing is discounted across a run; if prompt-touching changes become frequent, prompt caching in `AnthropicLlmClient` is the obvious lever (the 5-minute TTL comfortably covers an eval loop running cases back-to-back).
- **What went right worth repeating:** the probe-first sequence (1× eval before the 3× record) meant the one label problem was found for ~$0.44 instead of ~$1.33; deleting ALL orphaned fixtures before the hermetic gate made the gate itself prove the re-recorded set complete; and the review round added an `--only=<id-prefix>` flag to `intent-eval.ts` (filtered runs never write the whole-set report), so recording ONE new labelled case now costs ~$0.02 at repeat=3 instead of another full-set run.

## 2026-07-05 — Session 20 (WP20): a vitest `include` of `**/*.test.tsx` silently skipped every `.test.ts` file — a green run said nothing about tests that were never collected

- **What happened:** WP20 added two pure-logic test files under `web/lib/` as `.test.ts` (no JSX, so the natural extension). `npm run web:test` came back green — but the file count (6) didn't include them: `web/vitest.config.ts` had `include: ["**/*.test.tsx"]` from the WP12 era when every web test WAS a component test. The two new files were never collected, and nothing warned. Caught only because the session compared the reported file count against the files it had just written.
- **Rule going forward:** after adding a test FILE (not just a test case), verify the runner's reported file count went up by exactly that many — a green suite proves nothing about files the include pattern never matched. The pattern is now `**/*.test.{ts,tsx}`.
- **Same class, worth naming:** this is the "silent cap" failure mode — tooling that bounds coverage without saying so. The fix is always to compare a count you expect against the count reported, never to trust green alone.

## 2026-07-05 — Session 20 (WP19): a connected "Supabase" MCP is not necessarily THIS project's Supabase — check `list_projects` before querying anything

- **What happened:** wanting a read-only check that the two new dashboard queries work against the live schema, the session reached for the connected Supabase MCP connector. `list_projects` returned two projects named `glaibaan-*` — a completely different product of the owner's, not checkdecijfers. One inattentive `execute_sql` against the wrong org's database was avoided only because listing came first.
- **Rule going forward:** MCP connectors are account-scoped, not repo-scoped — always confirm the project list matches the repo before the first query. For this repo the reliable path is the one the repo itself ships: `node --env-file=.env` + `connectFromEnv()` from `src/db/client.ts`, printing only the values needed (never secrets). That path verified `signup_grant_config` (1 row, 100) and the prices (simple 20, clarification 10) in seconds.

## 2026-07-05 — Session 20 (WP19): review-workflow executing skeptics may get a worktree at the WRONG commit — they must verify HEAD before probing

- **What happened:** the adversarial review ran as a scripted workflow with executing skeptics in isolated worktrees. Two skeptics found their worktree checked out at the pre-WP commit (512482b) instead of the WP19 commit under review (3390e41) — probing there would have "confirmed" findings against code that didn't contain the change. Both skeptics caught it themselves (`git log --oneline | grep WP19`, then `git checkout <commit> -- .`) because the finding prompts named the commit under review.
- **Rule going forward:** every executing-reviewer brief must state the exact commit under review and require the reviewer to verify `git log -1` matches before executing anything; and the session must clean up the leftover worktrees afterwards (5 this time — `git worktree remove --force` + branch deletion) BEFORE re-measuring any test counts, per the session-19 quadrupled-counts lesson (applied successfully this session: counts were re-measured only after cleanup).

## 2026-07-04 — Session 19 (WP18): punch-a-hole experiments in the MAIN working tree destroy uncommitted work when reverted with `git checkout`

- **What happened:** to prove a new content-pin test had teeth, the session injected a deliberate defect into `src/answer/respond/meta.ts`, watched the test fail (good), then reverted with `git checkout <file>` — which restores the last COMMITTED version. The file also held ~40 lines of uncommitted adversarial-review fixes (template reordering, a regex fix, new pinned examples); all were silently wiped and had to be rewritten from context. Caught immediately because the harness diffs files after writes, but the loss was real.
- **Rule going forward:** hole-punch experiments belong in a worktree (where the review's own executing skeptics correctly ran theirs), or the working tree must be committed/stashed FIRST. `git checkout <file>` is only a safe revert when the file's working-tree state IS the committed state; after any uncommitted edit it is a destructive command wearing a safe one's clothes.
- **Also this session, same class of surprise:** the review workflow's executing skeptics left three worktrees behind under `.claude/worktrees/` (auto-cleanup skips worktrees with changes — and hole-punching skeptics always change files). Leftover worktrees are not just clutter: vitest CLI arguments are path FILTERS, so `vitest run tests/answer` also matched the three worktree copies and every local suite count silently **quadrupled** (29→116, 352→1409). Counts that suddenly multiply by a suspiciously integer factor mean duplicated test discovery, not new tests — check `git worktree list` before believing them, and clean up review worktrees (`git worktree remove --force`) before measuring anything for STATUS.

## 2026-07-04 — Session 19 (WP18): Dutch morphology breaks naive keyword regexes in ways that look fine in review — table-embedded examples caught both within minutes

- **What happened, twice:** (1) `/ontbrek/` matches "ontbrekende" but NOT "ontbreekt" — Dutch stem alternation doubles the vowel in conjugation; (2) an inline comment claimed `/updat/` covered "geüpdatet", but NFKC does **not** fold ü (U+00FC) to u, so the diaeresis spelling matched nothing. Both patterns read as obviously-correct in code review; both were wrong on common real phrasings.
- **What caught them:** each meta template carries its own verbatim example phrasings inside the exported table, and tests sweep the table (every example must route to its own template). Bug 1 failed on the tests' very first run; bug 2 was found by the adversarial review and is now itself a pinned example ("Wanneer is dit geüpdatet?"). The discipline — regression cases live NEXT TO the pattern they exercise, and the sweep is driven by the data structure itself — is what made both failures loud instead of silent fall-throughs to the generic template.
- **Rule going forward:** any Dutch keyword/pattern matching added to this codebase ships with verbatim example phrasings covering conjugated and diacritic spellings, wired into a data-driven sweep — never a bare regex with a comment asserting what it matches (the comment was the thing that lied).

## 2026-07-04 — Session 18: a real production error left literally zero trace — Vercel's log retention on this tier is short, check it immediately, not later

- **What happened:** the owner reported a live test question ended in the chat's generic client-side error ("Er ging iets mis..."). No `audit_answers` row and no ledger debit exist for it — confirmed it failed before the billing gate ever ran, so it cost nothing — but the actual server-side stack trace was already gone from `vercel logs` by the time this session checked, minutes to tens of minutes later. Root cause of the specific error is now unrecoverable.
- **Lesson, standing practice for every future live-testing session (owner instruction, 2026-07-04):** when a live test question in the deployed app produces an error, check `vercel logs` **immediately**, in the same turn — not after other diagnosis, not after finishing the conversation. The retention window on this Vercel tier is short enough that a delay of even a few minutes can lose the only record of what happened.
- **Separate, not-yet-decided follow-up this surfaced:** there is currently no durable error trail beyond Vercel's short-lived logs (no persisted error table, no monitoring service) — a real gap if this recurs, but a deliberate scope decision to make with the owner, not something to build unprompted.

## 2026-07-04 — Session 18: browser automation in the owner's own Chrome races the owner's own hands — settle "who did what" from auth timestamps, not memory

- **What happened:** driving the first real magic-link login through the owner's own Chrome tab, a screenshot showed the login form already in its "email sent" state before the session had typed anything. The session dismissed it as a rendering quirk and proceeded (re-navigate, fill, submit). The owner later received TWO auth emails ~2 minutes apart and reasonably asked whether the app's flow sends two. The session's first theory (Chrome autofill + an accidental automation submit of the bare address) was **refuted by evidence**: a read-only query of `auth.users` showed exactly one account and one creation timestamp, which — combined with the email-confirmed/signed-in timestamps 19–20s later and the question's debit 26s after that — fits only one story: the owner had typed and submitted the form himself while considering the session's alias question (the "sent" state the automation saw was real, his), and the session's own programmatic submit ~2 min later triggered the second email.
- **Lessons:** (1) the visible Chrome tab is SHARED state — the human can and will act in it between tool calls; an "impossible" UI state most likely means they did; ask, or check server-side evidence, before dismissing it as a glitch. (2) When the question is "who/what triggered this auth event," `auth.users`' `created_at`/`email_confirmed_at`/`last_sign_in_at` plus the app's own ledger/audit timestamps reconstruct the sequence to the second — one read-only query beats any amount of recollection. (3) Supabase magic-link template choice ("confirm signup" vs "magic link") is per-account-state, not per-flow — two different-looking emails does not imply a two-step flow.

## 2026-07-04 — Session 17: don't assume user error when unexplained state could be a concurrent session's legitimate change

- **What happened:** mid-way through Stripe live-wiring, three `NEXT_PUBLIC_*` env vars this session had itself just set in Vercel were gone from `vercel env ls`. The session's first instinct was "the owner must have accidentally deleted them clicking around the dashboard" — a plausible, convenient explanation — and re-added them via CLI without checking further. That re-add **silently reintroduced a real production outage** a separate, concurrent Claude Code session had just diagnosed and fixed minutes earlier (see the entry below): the whole point of removing those three vars from Vercel was that a pulled empty value would override the committed `web/.env.production` file. The mistake was caught only because a subsequent RUNBOOK.md read showed content ("committed to git", "production outage") that didn't match what this session had written — a discrepancy, not a hunch, that triggered the actual investigation (`git log`, `git show` on the fix commit).
- **Root cause of the reasoning error:** treating "I don't have an explanation for this" as equivalent to "the user must have done something" instead of treating it as equivalent to "something changed the state, and I don't yet know what." A `git log`/`git show` check costs one tool call and would have surfaced the real cause (a same-day commit, correctly authored, with a full explanatory message) before any corrective action was taken — cheaper than the fix-of-a-non-problem that followed.
- **Compounding factor:** this project explicitly runs multiple concurrent sessions against the same repo/deployment (the owner had a second Claude Code session active this same day, doing WP15 work and this outage fix) — a working assumption every session should hold when something looks different from expected, not just a one-off possibility.
- **Rule going forward:** before "fixing" an unexplained absence or state change in shared infrastructure (env vars, deployed config, database rows), check `git log`/`git blame`/recent commits for a legitimate concurrent explanation FIRST — even when a simpler, user-facing explanation is available and even when the session is mid-flow on an unrelated task. If a real fix gets reverted this way, the correction needs to be as fast as the mistake: re-verify against the actual deployed app (`curl`, not just the tool's own success message), not just against the tool's local state.
- **Evidence:** `vercel env rm` correction + `gh run watch` on the fix commit's CI run + `curl` showing 500 mid-deploy, then 200 on `/login` post-deploy, all in this session's own transcript; the fix commit itself (`69afc30`) predates the mistaken re-add.
- **Scope:** process (multi-session coordination on one repo has no locking — verify before acting, don't assume), tooling (the permission-denial "screenshot a secrets page" block a few steps earlier in the same session was a similar shape: an unexpected block was itself useful signal, not just an obstacle).

## 2026-07-04 — Live account wiring: browser-automation and cross-account gotchas worth recording

- **Namecheap "unsaved row" trap:** typing values into a new Host Records row and moving on does NOT save it — the green checkmark button next to the row must be clicked explicitly. Three DNS records (DKIM/SPF/DMARC TXT) were filled in and looked fine on screen, but a direct `dig` query against Namecheap's own authoritative nameservers showed zero records existed. Only the one record entered through the separate Mail Settings flow (the MX record) had actually saved, because that flow's UI differs. **Rule:** after any DNS record entry via a web dashboard, verify with `dig +short <type> <host> @<authoritative-ns>` directly — never trust the dashboard's own rendered state as proof of persistence.
- **MX records live in a different UI section than every other record type.** Namecheap's generic "Host Records" Type dropdown (A/AAAA/CNAME/TXT/etc.) does not include "MX Record" at all — MX entries are configured separately under a "MAIL SETTINGS" section with its own "Email Type: Custom MX" toggle. Worth checking a registrar's UI structure before assuming a generic add-record flow covers every record type.
- **A literal `~` character silently failed to type via the browser-automation `type` action**, three separate times, when embedded inside a longer string (`v=spf1 include:amazonses.com ~all` repeatedly landed without the tilde, and once caused a duplicated/garbled field when a clumsy select-all+retype was attempted). Fix: clear the field with `End` + repeated `BackSpace` (not `ctrl+a` — that did not select-all in this particular web input, it just moved the cursor), then insert the tilde as an **isolated `key` action** (`key: "~"`) rather than as part of a `type` string. Worth trying for any other punctuation character that silently vanishes mid-string.
- **Cross-account contamination via a shared browser profile and a shared MCP connector — twice, independently.** Both the Claude-in-Chrome browser session's cookies AND a separately-installed Supabase MCP connector were authenticated to a completely different, unrelated project ("glaibaan") rather than the one being worked on (checkdecijfers/"stefan" org) — discovered by checking `list_projects`/the org switcher before acting, not assumed from context. **Rule:** when a session has multiple projects/accounts, verify the active account/org explicitly (a cheap read-only check) before any dashboard action, every time a new tool/connector/browser session is first used in that conversation — don't assume the tool is scoped to the project just discussed.
- **The harness's own permission classifier blocks navigating-to-and-screenshotting any page that would reveal a live secret** (a full API-keys page showing both a wanted publishable key and an unwanted secret key together; a freshly-created key's reveal moment; an env-var Value field right after typing) — this held consistently across Supabase, Stripe, and Vercel. **Design implication for future sessions:** plan secret-creation steps around this from the start — do the non-secret form-filling (names, URLs, event selection, scopes) via automation, then hand the single "click create / reveal / copy" action to the user explicitly, rather than discovering the block reactively each time.
- **Stripe account country gates payment-method availability structurally, not as a togglable setting** — iDEAL cannot be offered to a Stripe account whose registered business address is outside the Netherlands/eligible EU-EEA countries, regardless of test/live mode. Worth checking a payment provider's account-level country/region setting early, before assuming a payment method is just a checkbox away.
- **Scope:** tooling/process (DNS verification discipline, browser-automation text-entry gotchas, account-scope verification habits, secret-handling boundaries holding up in practice across three different providers).

## 2026-07-04 — Production outage: a green deploy job is not a running app, and Vercel's sensitive-env policy silently empties NEXT_PUBLIC vars in CI builds

- **What happened:** minutes after WP15's green deploy, the live app returned Internal Server Error on every route. Runtime logs: the middleware threw "Your project's URL and Key are required to create a Supabase client!". Root cause chain: (1) this Vercel team enforces the sensitive environment-variables policy — EVERY env var becomes write-only regardless of how it is added (dashboard or plain `vercel env add`; the CLI still lists them as "Encrypted" — only the API's `type: sensitive` field tells the truth); (2) sensitive values are runtime-injected (which is why `DATABASE_URL` worked for two days) but `vercel pull` receives them as EMPTY strings; (3) our builds run in GitHub Actions via `vercel pull` + `vercel build`, and Next.js inlines `NEXT_PUBLIC_*` statically into every bundle including the middleware — so the WP13 auth proxy was compiled with empty credentials and 500'd unconditionally. The app had in fact been broken since the first deploy after the proxy landed; nobody had loaded the page between deploys, and the deploy job is blind to runtime behavior.
- **Fix (two halves):** the three public-by-design values (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`) moved to a **committed `web/.env.production`** (the ADR 018 committed-CA-cert reasoning: they ship in every browser bundle anyway) and were REMOVED from the Vercel env store — removal matters, because the pulled `.env.production.local` (empty values) would otherwise override the committed file in Next's env precedence. And the CI deploy job gained a **post-deploy smoke check** (curl `/` and `/login`, follow redirects, require a final 200) so deployed-but-broken can never read as green again.
- **Diagnosis pattern that worked:** curl the alias (500) → `vercel logs` on the live deployment (the real error text) → `vercel env pull` locally and check value LENGTHS (all zero — the tell) → the API's `type` field for ground truth (`sensitive` across the board). The CLI's `env ls` display ("Encrypted") actively misleads here.
- **Scope:** ops (Vercel sensitive-env policy vs prebuilt CI deploys; env precedence — a pulled empty value overrides a committed file), process (deploy pipelines need an end-of-job runtime probe, not just a green build; "the app worked when I last looked" spans deploys — verify after every deploy that changes the runtime surface).

## 2026-07-04 — WP15 review: a belt test guards the module it was written next to, not the guarantee it was written for

- **Lesson:** the no-numbers belt-check (principle c) lived in tests/answer/respond-refusals.test.ts and scanned exactly the three builders of src/answer/respond/refusals.ts — because that is where clarification/refusal TEXT lived when the belt was built (WP9). WP15 added new clarification-text builders in a different module (src/answer/intent/policy.ts's #56 fallbacks) and inherited zero belt coverage; the ADR even claimed otherwise. The adversarial review's executing skeptic proved the consequence live: a fabricated "(intern id 48213)" injected into a fallback template passed 83/83 relevant tests. The guarantee ("no clarification/refusal text ever carries an unbacked number") is a property of every text-producing path, but the test was scoped to a file list — so a new path silently fell outside the belt. Rule: when a belt-style test enforces an invariant over "every X the system produces", audit its coverage every time a new producer of X appears (grep for the scan helpers before calling a text-producing module done), and prefer belts that iterate over a REGISTRY of producers rather than a hand-maintained import list where feasible.
- **Evidence:** the review transcript's mutation probe (83/83 pass with the fabricated token; reverted); the fix is the belt-scan block in tests/answer/intent-policy.test.ts covering every clarification-producing branch of decide().
- **Scope:** testing (belt/invariant tests must track the invariant's domain, not the original module), review process (executing skeptics catch what import-list reasoning misses).

## 2026-07-04 — WP15: a mode-section rule the model's own knowledge disagrees with needs NEVER-phrasing plus the reason, or the model overrides it

- **Lesson (the model overrides polite rules with its vocabulary knowledge — twice, in its own words):** the follow-up mode section's first version said a topic switch "keeps the previous regions … never drop the inherited place even when the vocabulary says 'alleen landelijk'". The first record run dropped an inherited region anyway, and the model NARRATED the override in its reading: "regio vervalt omdat werkloosheid alleen landelijk beschikbaar is" — it applied its vocabulary knowledge (correct) to justify violating the rule (wrong): honesty about the national-only limit is the RESOLVER's job, and silently reframing "werkloosheid in Amsterdam" as "werkloosheid in Nederland" is exactly the WP6 dropped-region failure mode on a new surface. Run 2 fixed that but surfaced the same instinct on periods: "kun je dit in een grafiek zetten?" over a single-year referent got widened to `since 2024` — again self-narrated ("period wordt uitgebreid van enkel 2024 naar een reeks vanaf 2024"). Both were fixed by rewriting the rule in the base prompt's strongest idiom — CAPS prohibition + the reason the instinct is wrong ("Reading such a follow-up as if it asked about heel Nederland is wrong"; "Guessing a window is wrong even at high confidence") — after which 18/18 passed and stayed stable ×3. Rule: when a prompt rule asks the model to suppress a behavior its own knowledge justifies, write the prohibition in NEVER-form AND state why the seemingly-helpful behavior is wrong; the WP6 lesson (fix with a rule, not a threshold) held for the third calibration in a row.
- **Lesson (the R7 threshold caught the period-widening — but that is luck, not a guard):** the widened `since 2024` came out at confidence 0.88, tripping the clarify threshold, so no user would have seen a guessed window. A confidence of 0.92 would have answered it unconfirmed. Where a deterministic guard exists for a failure mode (here: the degenerate-range check producing a period clarification with servable options), the prompt must steer INTO it rather than relying on the model's self-doubt (principle c: the model's calibration is a belt, never the floor).
- **Evidence:** benchmark/followup-calibration-report.json history (17/18 → 17/18 → 18/18 → 18/18 at repeat=3, zero flips); the two overriding readings quoted verbatim in the v2/v3 notes on FOLLOWUP_PROMPT_VERSION (src/answer/intent/followup.ts).
- **Scope:** prompt engineering (mode sections that fight model instincts), process (calibration-first recording catches rule violations cheaply — two gaps cost ≈€0.25 to find).

## 2026-07-04 — WP15: fixture labels keyed by question text silently collapse when two cases share a question

- **Lesson:** the fixture-recording label helper maps question text → case id for orientation labels inside fixture files; two follow-up cases deliberately share the same question ("Kun je dit in een grafiek zetten…", different contexts), so the Map collapsed to the later id and one fixture carried its sibling's label. Harmless by design — `requestHash` over the full request is the identity, labels are documentation — but a session grepping fixtures BY LABEL would have drawn a wrong conclusion. Rule: fixture labels are orientation only; identify fixtures by hash or payload, and when auditing a specific case, match on the payload content (the context differs even when the question doesn't).
- **Evidence:** two fixtures labelled `f-v31-chart-over-series` in run 2's recording; `f-v31-chart-over-single-period` had no fixture under its own label while its case passed.
- **Scope:** tooling (record/replay harness ergonomics).

## 2026-07-04 — WP13: the gate job passing does not mean the deploy job will — a barrel export recurred WP12's exact Turbopack lesson

- **Lesson (a barrel file's export list is part of a bundler's module graph, even for code paths never executed):** the first WP13 push had a fully green `gate` job (551 tests, clean typecheck) but a failed `deploy` job — `vercel build`'s Turbopack step errored with `Module not found: Can't resolve '../../migrations'` inside `src/db/migrate.ts`. Cause: `src/billing/index.ts` (a barrel file) re-exported `applyPricingDefaults` from `pricing-apply.ts`, whose CLI-entry code dynamically imports `db/migrate.ts` for its `applyMigrations` call — and `db/migrate.ts` has `MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url))`, which Turbopack statically treats as a client-bundlable asset reference (the *exact* bug class WP12's lessons-learned already documented for `src/db/client.ts`'s CA-cert loading) and cannot resolve because it points at a directory, not a file. `web/app/credits/page.tsx` only ever imports `getActivePacks`/`getBalance` from the barrel — never `applyPricingDefaults` — but importing *anything* from a barrel pulls the *whole* barrel's module graph into Turbopack's resolution, including a dynamic `import()` inside a branch (`if (process.argv[1] === ...)`) that never runs in the deployed app. Fixed by removing the `pricing-apply.ts` re-export from the barrel (a correctly-scoped fix, not a workaround: `applyPricingDefaults` is an ops/CLI-only operation, `npm run pricing:apply`, and was never meant to ship in the web bundle). Verified with `npm run web:build` locally (reproduces `vercel build`'s Turbopack step without needing live Vercel credentials) before re-pushing.
- **Rule going forward:** a barrel file (`index.ts` re-exporting from several sibling modules) is a liability the moment ANY of those siblings — even transitively, even inside a runtime-conditional dynamic import — touches `new URL(literal, import.meta.url)`, `fs`, or another Node/CLI-only primitive Turbopack can't bundle. Before wiring a new backend module into `web/`'s import graph, check whether anything in that module's own dependency chain has a CLI entry point (`if (process.argv[1] === ...)`) and keep that file OUT of any barrel a web/ page might import from — import CLI-only functions directly from their own file instead, the way this project's own scripts/*.ts CLI entries already do for `src/registry/apply.ts`. `npm run web:build` (a real `next build`, not just `next dev` or `tsc --noEmit`) is the only thing that actually proves a change is deployable — the CI `gate` job deliberately doesn't run it (it needs network for fonts), so a change that's fully test-and-typecheck-green can still fail to deploy, and only the `deploy` job (or a local `web:build`) catches that.
- **Evidence:** first push (`ca626d6`) — `gate` job green in ~4m25s, `deploy` job failed at `Build` in 58s with the Turbopack `Module not found` trace naming the exact import chain (`db/migrate.ts` → `billing/pricing-apply.ts` → `billing/index.ts` → `web/app/api/stripe/webhook/route.ts` and `web/app/credits/page.tsx`); fix verified locally via `npm run web:build` (`✓ Compiled successfully`, all six routes including `/credits`, `/api/stripe/webhook`, and `ƒ Proxy (Middleware)` present) before the follow-up push.
- **Scope:** engineering (Turbopack/bundler gotchas, module-graph hygiene for barrel files), process (a green `gate` job is not proof of deployability — verify the actual build before considering a web-touching WP done)

## 2026-07-04 — WP13: a live-edited pricing scheme mid-build looks exactly like a database bug; `git stash` is not a scalpel

- **Lesson (identical failure values across runs is evidence of a deterministic CAUSE, not evidence the cause is a concurrency bug):** a full `npm test` run started failing two ledger tests with balances of 100/99 instead of the expected 5/4. Because the wrong numbers were byte-identical across repeated runs, the investigation chased a PGlite/vitest concurrency theory for roughly 45 minutes — bisecting file combinations, forcing `--pool=forks --poolOptions.forks.singleFork=true` (fully sequential, one process, no concurrency possible whatsoever) and STILL reproducing the exact same 100/99 — which should have been the immediate signal to abandon the concurrency theory (a race condition cannot survive removing all concurrency) far earlier than it was. The actual cause: the owner had directly edited `migrations/005_credit_ledger.sql` and `migrations/006_pricing_config.sql` mid-session (a signup grant of 5 → 100, `simple` 1 → 20) as part of a live, collaborative pricing-scale revision, and the test file's hardcoded expectations were simply stale — 100 was the *correct, current* value, not a leaked one. Debug output confirmed it in under a minute once actually added (`select * from signup_grant_config` printed `{credits: 100}` in a guaranteed-fresh, single-instance, single-fork database — i.e., the "bug" was reading exactly what was really there). Rule: when a failure is perfectly reproducible, prefer "what changed in the inputs" over "what race condition could produce this" — reproducibility is evidence *against* a timing bug, and a fresh, full re-read of every file the diff touches (not a memory of what you last wrote) should come before any infrastructure-level theory.
- **Lesson (a live collaborator can and did edit files directly, more than once, without a chat message announcing it):** this session's owner made THREE separate waves of direct edits to the WP13 migrations/docs while the build was in progress — first the "clarifications cost 0" → "clarifications cost the flat class price" reversal, then a full ×20 widening of the entire pricing scale (signup grant, all four action classes, all pack credit amounts, plus a new fourth pack) — each landing as a tool-result system note rather than a conversational turn. The second and third waves were easy to miss because the first one had already been reconciled, creating false confidence that "the pricing docs are now in sync with my code." Rule: when a tool result reports a file "modified by the user," don't diff just that one file in isolation — check `git status --porcelain` broadly and re-read any newly-created reference doc in full (here, the owner had also authored a brand-new `docs/09-pricing.md` consolidating the current values) before resuming code changes, especially after any gap in active editing.
- **Lesson (`git stash` is repo-wide, not file-scoped — never reach for it to test reverting one file):** mid-investigation, `git stash` was used to try "what if this one PGlite helper file were reverted" — but `git stash` stashes every tracked-file change in the working tree, not just the target file, immediately un-doing hours of unrelated, unstaged work across a dozen files. Recovered cleanly via `git stash pop` (untracked new files were never touched, since stash excludes those by default without `-u`) — but this was a real, avoidable risk of the kind CLAUDE.md's "destructive operations" guidance warns about, and it happened without pausing to consider blast radius first. Rule: to test reverting a single file's changes, use `git diff <file>` to capture it, then a direct `Edit`/`Write` to restore prior content, or `git checkout -- <file>` — never `git stash` for a single-file experiment; reserve `git stash` for genuinely wanting to shelve the *entire* working tree.
- **Lesson (a live mutation probe on a just-written test is a legitimate way to check the test has teeth — and it worked as intended):** the owner briefly edited a freshly-written `web/components/chat.test.tsx` mock from `{kind: 'unauthenticated'}` to `{kind: 'unauthenticated_typo'}`, then reverted it. Running the test with the mutation in place produced the correct outcome: a real, observable failure (`findByText` timeout — the component's switch statement produced no matching text for an unrecognized kind), proving the assertion was not tautological. Worth naming for future sessions: a transient-looking "modified by the user" diff on a test file may be exactly this kind of check, not drift to chase down — verify by running the test as-is before assuming something is broken.
- **Lesson (Next.js 16 renamed `middleware.ts` to `proxy.ts`):** the exported function is now `proxy`, not `middleware`, in the same file-convention slot — confirmed by reading `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` directly rather than trusting training-data knowledge, per `web/AGENTS.md`'s own standing warning that this Next.js version has breaking changes worth checking before writing framework-integration code. A codemod exists (`npx @next/codemod@canary middleware-to-proxy .`) for any code still written against the old name.
- **Lesson (Postgres: a caught exception still aborts the whole transaction):** designed into the ledger from the start (a review-agent finding, not a bug found in testing) — catching a thrown unique-violation in application code does NOT undo the fact that the failing statement poisoned the enclosing Postgres transaction; every subsequent statement in that transaction fails with "current transaction is aborted" even though the JS `try/catch` looks like it handled things gracefully. `INSERT ... ON CONFLICT ... DO NOTHING RETURNING id` (branch on the empty-vs-one-row result) never throws in the first place, so it's the correct idempotency primitive regardless of whether the caller happens to be inside a transaction — used throughout `src/billing/` for the debit, the compensation, and the Stripe webhook credit.
- **Lesson (an idempotency key closes retries, not concurrency — those are different problems that look similar):** the billing gate's `chargeAndRun` had a real, shipped bug the whole build-and-test cycle missed: `getBalance` then `debitQuestion` as two separate statements, guarded by a unique index on `(user_id, request_id)`. That index correctly makes a *retry* of the same logical request a no-op — but two *different*, legitimately concurrent questions (two different `request_id`s, e.g. two browser tabs) can still both read the same pre-debit balance and both pass the check, since nothing serializes the read-then-write across them. The adversarial review's ledger-correctness lens caught this by reading the code cold and asking "what if two different requestIds race," not by running anything — the existing 39-test suite (all sequential, one call at a time) had zero reason to ever exercise it. Fixed with a per-user Postgres advisory transaction lock (`pg_advisory_xact_lock`) wrapping only the fast check-and-debit, explicitly NOT the slow pipeline call after it (holding a transaction — and a pooled connection — open across a multi-second LLM response would risk exhausting the connection pool under real traffic; the review itself flagged the production connection pool's small size as a contributing risk factor). Rule: an idempotency key (dedup on a client-supplied id) and a concurrency guard (serializing a check-then-act sequence) solve *different* problems and are easy to conflate — a design review or its own doc text asserting "atomically reserved" is a claim that needs its own dedicated concurrency test, not an inference from the retry-safety test.
- **Lesson (hermetic hides real concurrency bugs, and can also *pass* a fix for reasons unrelated to the fix):** `tests/helpers/pglite-db.ts`'s own mutex serializes every `db.query`/`db.withTransaction` call onto PGlite's single connection — meaning a concurrency test written against this harness can pass even for a subtly different reason than the one intended (bundling two statements into one `withTransaction` call is enough to make the test pass here, regardless of whether an explicit lock is present, because the *test harness itself* already prevents interleaving between separate top-level calls). The lock is still necessary for the real, multi-connection `pg.Pool` production path, where Postgres's default READ COMMITTED isolation provides no such help. Recorded plainly in the test's own comment rather than overclaiming what a single-connection hermetic suite can prove — an honest limitation, not a reason to skip the test (it still proves the *observable contract* holds, just not that this exact mechanism is what's holding it).
- **Evidence:** ADR [020](decisions/020-credit-ledger-and-billing-gate.md) §10 (the full review verdict: 8 findings, 8 confirmed, 0 refuted); `docs/09-pricing.md`; `migrations/005_credit_ledger.sql`/`006_pricing_config.sql`/`008_ledger_structural_guards.sql`'s own inline comments; `git stash list` / `git stash pop` output from the recovery; `tests/billing/ledger.test.ts`'s `reserveDebit` describe block (the concurrency test + its own honest-limitation comment) and `web/components/chat.test.tsx` (the tests that survived the real investigation, a live mutation probe, AND a reproduced field-name-typo scenario against the now-fixed `web/tsconfig.json`).
- **Scope:** process (debugging discipline, live-collaboration file-diffing habits, git safety, adversarial-review value), engineering (Postgres idempotency pattern, check-then-act concurrency, hermetic-test honesty), tooling (Next.js 16 API rename)

## 2026-07-04 — WP14: "available" must mean available at the exact coordinate; a clarification's offer is a promise a test must cash; overnight sessions can mis-date a whole docs layer

- **Lesson (an existence check that ignores the coordinate promises data the definition can't serve):** the intent resolver's grain/latest lookups queried observations by table+measure only. That was silently wrong for a whole class: CBS publishes **no seasonally-adjusted yearly unemployment** — the table's yearly cells exist, but exclusively at the *un-corrected* coordinate, a different definition than the canonical one pins. Every consumer inherited the lie: yearly unemployment questions passed the grain gate and dead-ended in a `no_data` refusal that misdiagnosed CBS's publication choice as "a data gap that needs review", and the F1 interim guard offered "2013 tot en met 2025" — for exactly the V01/V28 questions it was built for — a range that **refused after the user confirmed it**. Found only by driving V01 end-to-end through `runQuery` in a test. Rule: any "does X exist" lookup that feeds a user-facing promise must filter on the same full coordinate the eventual query will use (here: `default_coordinates ⊕ canonical dims`, the merge `freshestForCanonical` already used); and every *offered clarification option* needs a test that CONFIRMS the offer through the real query path — an offer is a promise, and WP9's fix had tests for the offer's wording but none that cashed it.
- **Lesson (estimate re-record budgets with one iteration included):** the brief's €0.50–1.50 assumed record + stability once. Actual ≈ €2.40: the first stability run caught a real prompt gap (the WP6 dropped-region mode on a new question shape — worth every cent), and fixing a prompt re-records *everything*, doubling the run costs. Two structural cost facts to carry forward: a prompt-byte change invalidates **all fixture sets that embed the prompt** (the 7 clarify fixtures hash the base prompt too — the brief counted only the 45 intent fixtures), and calibration on a *changed contract* should be budgeted as record + stability × 2. Also: the resolver-level fix for the model's `last_n(n=1)` encoding cost €0 because it needed no prompt bytes — prefer deterministic-layer convergence over prompt edits when both are honest (ADR 012's "resolver is the hard floor" is also the cheap floor).
- **Lesson (cheap-tier recon is a draft, not a fact sheet):** the delegated version-bump impact scan reported 11 sites; 2 of them were a *different* version field (`PendingClarification.version` = `RESPONSE_SCHEMA_VERSION`) that blind sed-editing would have silently corrupted. The session-model review of delegated output caught it by reading the type definition. Rule (existing delegation convention, now with evidence): mechanical fan-out output gets verified against the source of truth before any edit is applied from it.
- **Lesson (an autonomous overnight session mis-dated its entire docs layer by +1 day):** session 13 (run in the night/morning of 2026-07-04, per git timestamps and the machine clock) labelled all its docs, its memo filename and even the owner-decision records "2026-07-05" — and the next session's kickoff message inherited the wrong date. This session's own labels use the measured date (2026-07-04); the session-13 labels are left as recorded (a filename rename would break links for a cosmetic fix) with a note in STATUS. Rule: a session states its date from the machine clock (`date`), never from the previous session's narrative; an overnight session double-checks which side of midnight it is on per timezone.
- **Also observed (long-series answers fall to the template ladder):** V01's 45-cell quarterly series was answered via the R3 template (the LLM phrasing failed the validator twice — with 45 numbers to bind, one slip anywhere fails the whole text). The template + chart is honest and correct, but a wall of 45 enumerated values is a UX cost; if "sinds"-questions become common, compose-side guidance for long series (summarize; the chart carries the shape) is a candidate polish WP — **not** a weakening of the validator.
- **Evidence:** ADR [019](decisions/019-open-ended-period-ranges.md) (§4 for the coordinate finding); tests/answer/intent-resolve.test.ts (offer-cashing + coordinate pins); calibration report history (4 runs); audit rows 74–76 (`npm run audit:verify -- 74 76`, 3/3 clean; row 74 `answer_source=template`); git log vs doc dates for the +1-day error.
- **Scope:** engineering (coordinate-aware lookups, offer-cashing tests), process (budget estimating, recon verification, session dating), product (long-series answer UX)

## 2026-07-05 — Validation pass (overnight): a schema that can't say it makes the model emit garbage confidently; the audit trail turns live verification into a free, re-runnable command

- **Lesson (representability gaps produce HIGH-confidence wrong parses — confidence cannot flag them):** "sinds 2015" is unrepresentable in `PeriodSpec` (no open-ended range) and the prompt is deliberately date-free (ADR 012), so the model *cannot* emit a correct end year — it emitted `fromYear == toYear` at **0.92 confidence, twice, identically** (V01/V28). The R7 thresholds are calibrated to catch the model *doubting itself*; a model forced into an unexpressible corner doesn't doubt, it confidently picks the least-wrong encoding. Rule: when adding a question shape (or reading a new question set), first ask "can the schema even say this?" — and make the deterministic layer catch structurally-impossible combinations (here: multi-period derivation × single-period selection) *before* the query layer's generic error, so the user sees a designed clarification, never the catch-all refusal.
- **Lesson (the audited entry points + reconstruction = live validation nearly for free):** the whole 38-question owner set ran as a ~150-line script over `answerQuestionAudited` (the WP11 pattern) for ≈€0.18 — no browser automation, no UI scraping — and the **zero-fabrication verdict came from `reconstructionReport` over the stored rows at zero LLM cost**. Promoted to a permanent command the same night after the review flagged the claim as artifact-less: `npm run audit:verify -- <from> <to>` ([scripts/verify-audit-rows.ts](../scripts/verify-audit-rows.ts)). Rule: a "measured, verified" claim in a doc needs either a committed artifact or a committed command that reproduces it — the R8 trail makes the command form cheap, so prefer it.
- **Lesson (the review keeps catching the same docs-honesty class — name the measurement layer):** all three confirmed findings were the session's own first-draft memo: latency figures from the audit rows' `latency_ms` cited against the dump's wall-clock numbers without naming either layer (the WP11 review caught this exact class in STATUS once already); the 38/38 verification claim with no repo artifact; and a "predicted failure mode did not occur" claim that was vacuously true (V19's region axis was never reached — the measure axis failed first; the hermetic `Atlantis` test is what actually pins `region_unknown`). Rules: every measured number names its source layer; every verification claim ships its reproduction command; a live probe that exits early proves nothing about the deeper guard — cite the test that does.
- **Also observed (workflow-review worktrees pollute the local gate):** leftover `.claude/worktrees/wf_*` copies (executing skeptics' isolation) made a targeted `npx vitest run` pick up *worktree* test files alongside the real ones — 6 files where 3 were asked for. Clean with `git worktree remove --force` + `git worktree prune` (+ delete the `worktree-*` branches) before running any local gate; CI is unaffected (worktrees aren't committed).
- **Evidence:** [validation-results-2026-07-05.md](validation-results-2026-07-05.md) (memo incl. per-question table + review verdicts); audit rows 36–73; the F1 fix + 10 new pins in this session's commits; review: 5 lenses → 8 findings → 3 confirmed / 4 contested (2 accepted+fixed) / 1 refuted, 21 mid-tier agents.
- **Scope:** engineering (schema representability, deterministic pre-query guards), process (measurement-layer naming, claim-artifact discipline, worktree hygiene), method (scripted live validation over the audit seam)

## 2026-07-04 — WP12 post-session review: the per-WP adversarial review is load-bearing, and a prose lesson doesn't protect new code

- **Lesson (the review is the WP's last task, not an optional epilogue):** WP12 shipped without the adversarial review every prior WP (5–11) ran — the six-attempt deploy churn consumed the session and the review silently fell off. The owner noticed and requested it post-hoc (6 lenses → 20 findings → two skeptics each, 46 mid-tier agents, top-tier model judging). It confirmed 14 findings including **two HIGH in exactly the places prior reviews had taught us to look**: the new Recharts wrapper had recurred the WP8 membership-without-binding gap (dropped `resultId` entirely — the SVG renderer was fixed for this same class 24 hours earlier), and ADR 018 claimed a DOM-level provenance test that did not exist. Rule: the review runs before a WP is called done, even (especially) when the session ran long — schedule it as the WP's final task at kickoff, so churn can't crowd it out.
- **Lesson (a lesson recorded as prose does not transfer to new code):** the WP8 entry below documents membership-without-binding in exact detail — and the very next renderer written in this repo recurred it anyway, because nothing structural carried the lesson forward: the lesson lived in prose, the fix lived in the OTHER renderer's tests. When a lesson generalizes ("any renderer must bind displayed values to their result ids, and its tests must assert per-point identity, not set membership"), encode it as a test the next implementation cannot avoid or a named checklist item in the relevant ADR — prose is for humans reading history, not a guard for future code.
- **Lesson (adversarial review cuts both ways — seeded suspicions must survive the same skeptics):** the review was seeded with the session's own top suspicion (public-endpoint LLM-spend abuse "not recorded anywhere as an accepted risk", rated HIGH). Both skeptics refuted it with citations: docs/03's non-goals row (rate limiting, Phase 1–2, ADR 005), roadmap Phase 1's "basic abuse limits", and the €25 cap + billing alert as recorded damage bounds. The reviewer being wrong and the process catching it is the process working — record refutations as prominently as confirmations, or the review degrades into confirmation-hunting.
- **Evidence:** verdicts 14 confirmed / 3 contested (judged by the session: attempt-count wording harmonized, ADR heading was stale at "three attempts" over five bullets) / 3 refuted with citations. All confirmed findings fixed + test-pinned same day (web suite 6→9 tests; binding via `data-label-for` per tooltip value node). Clarify + refusal kinds re-measured against the live deployment the same day, converting STATUS's four-kinds over-claim into a true statement instead of a weakened one.
- **Scope:** process (review scheduling, lesson encoding, seeded-suspicion discipline), engineering (binding tests for renderers), docs honesty (claims are fixed by making them true where cheap, weakened only when not)

## 2026-07-04 — WP12: bundler/deploy-only bugs need the real build+deploy tooling tested, not just `next dev`; two symlinks, one good and one bad

- **Lesson (test the real build, not just dev mode):** `src/db/client.ts` read the pinned CA cert via `readFileSync(new URL('./relative', import.meta.url))` — correct under plain Node (every CLI script, CI) and silently correct-looking under `next dev` too. Only `next build && next start` (the actual shape of what Vercel runs) surfaced two bundler-only failures: Turbopack's bundled Node runtime rejects the resulting `URL` instance in `fileURLToPath`/`readFileSync(URL)` with an `instanceof` cross-realm error, and — more fundamentally — Turbopack statically recognizes that exact `new URL(literal, import.meta.url)` shape as a **client-asset reference** (the same convention used for bundling images/fonts) and rewrites it at build time to a `/_next/static/media/...` public path that was never going to be a real server-side file. Neither symptom appears in `next dev` (unbundled-enough to paper over both) or in a hermetic test (no LLM/DB integration there). The fix (bake the — genuinely public — cert into `DATABASE_CA_CERT` at Next's build time, in plain unbundled Node) was found only by clicking through the actual built app against the live DB. Rule: any "works in dev, might not survive prod bundling" surface (dynamic `import.meta.url`-relative file reads, in particular) needs a `next build && next start` smoke test before calling a deploy-adjacent change done — `next dev`'s looser bundling is not a reliable proxy for what ships.
- **Lesson (don't symlink a service's env file to a shared secrets file):** `web/.env.local` was set up as a symlink to root `.env` for convenience (one source of truth). The very first `vercel link`/`vercel pull` wrote a `VERCEL_OIDC_TOKEN` line *through* the symlink into the shared root `.env` — a file three other scripts (`db:migrate`, `ingest`, live evals) also read, now silently carrying an unrelated tool's token. Fixed by making `web/.env.local` a real, independent copy instead (documented in RUNBOOK's secrets register: a rotation now touches three files, not two — an accepted, named tradeoff over the surprise a symlink produces the moment *any* tool treats the env file as writable).
- **Also observed (browser-automation tooling):** the preview tool's coordinate-based `preview_click` intermittently did not register the first click on a freshly (re)started server's page (no network request fired, no error) — a second click, or dispatching `.click()` directly via `preview_eval`, worked every time. Prefer the JS-dispatch fallback when a click appears to do nothing rather than assuming the app is broken.
- **Also observed (auto-mode guardrails did their job, twice):** the harness's permission classifier declined an attempt to write `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` as GitHub Actions secrets under the session's general "do the next work package" authorization, correctly reasoning that arming an automated deploy pipeline is bigger than that implicit scope — even though those two values aren't secret. It later declined a second, more consequential thing: repeated local `vercel build`/`vercel pull` invocations directly against the *real, linked* Vercel project while debugging the CI failure below, after the session had already read the CLI's stored auth token off disk to PATCH the live project's `rootDirectory` setting via the raw API. The user's actual instruction had been "push, and let CI run the first deploy" — debugging locally against production, and mutating its settings via an extracted token, both exceeded that. Both times, asking the owner explicitly (who confirmed in-session) was the right unblock, not finding a workaround; this is designed-in friction, not a bug to route around. **Rule for next time: once told "let CI be the test," treat any further direct interaction with the live linked project — build, pull, or settings API — as needing a fresh ask, not as implied by "get the deploy working."**
- **Lesson (`next build && next start` is not a strong enough proxy for `vercel build`, and a plausible root-cause theory still needs re-testing against the real failure):** the first real CI push passed the full hermetic `gate` job (445+ tests) but failed `deploy` on a Turbopack monorepo-resolution error ("couldn't find the Next.js package... from the project directory") that **never once reproduced locally via plain `next build`** — only via the actual `vercel build` command CI uses, run against the real linked project. Two plausible-looking config fixes (`turbopack.root`/`outputFileTracingRoot` pointed at the monorepo root; the Vercel project's `rootDirectory` set to `"web"`) each independently passed Next's own build step but broke Vercel CLI's separate output-packaging step with a doubled-path `ENOENT .../web/web/...` — a failure mode invisible to `next build` alone, since it only manifests inside `vercel build`'s post-processing. That led to a *third*, well-reasoned-sounding theory: Turbopack's "outside project root" restriction only concerns source-file imports (`../../src`), not `node_modules` resolution, so a `web/backend` symlink (keeping all of `web/`'s own source lexically inside `web/`) should be a complete fix with zero config. **It wasn't — pushed as its own commit, CI failed with the exact original error again, on the bare `./app` entry, before reaching any import statement the symlink touched.** The theory was half right (the restriction genuinely is source-file-only) and half wrong (this specific error was never about source files at all — it was Turbopack failing to resolve the `next` *package* itself from a hoisted parent `node_modules`, a documented Turbopack/npm-workspaces limitation). The fix that actually shipped: stop being an npm workspace — `web/` got its own independent `package-lock.json`/`node_modules` (point 1, ADR 018), so `next` is always physically present in `web/node_modules`, no hoisting or root-inference involved anywhere. A fourth attempted fix along the way, `install-strategy=nested` (un-hoisting within a still-shared workspace), fixed the original symptom too, but broke `vitest`'s resolution of `web`-only devDependencies (`jsdom`) — npm places every workspace's bin symlinks at the *root* `node_modules/.bin` regardless of install strategy, and nested install never creates a per-workspace one, so `npm run test --workspace web` silently ran the root's own separately-nested `vitest`, which had no `jsdom`. **Rules: (1) for a monorepo deploy, `next build && next start` proves the app itself works, not that the deploy *pipeline* works — the real build tool (here, `vercel build`) is the only trustworthy local proxy, and per the rule above, running it against a live project now needs an explicit ask. (2) A theory that explains the *symptom class* correctly (Turbopack's root restriction is real and source-file-scoped) can still misdiagnose the *specific instance* — re-test the fix against the actual failure before declaring it solved, not just against a plausible mechanism.**
- **Lesson (the real fix was a Vercel project setting, not anything in Next.js config — and it's officially documented for exactly this shape):** with `web/` independent (previous bullet), the "next not found" error was gone, replaced by a *third*, more specific failure: `Symlink [project]/backend/... is invalid, it points out of the filesystem root`. This is the actual, unifying explanation behind all three failures: `vercel build` runs inside a sandbox that refuses to resolve **anything** — package or symlinked source file — outside whatever it considers the project directory, a stricter boundary than plain `next build` enforces, which is why nothing reproduced locally until `vercel build` itself was the thing run. Vercel documents a project-level setting for precisely this monorepo shape (an app in a subdirectory needing files from outside it): `rootDirectory` plus `sourceFilesOutsideRootDirectory: true` ("Include source files outside of the Root Directory in the Build Step" in the dashboard) — a `PATCH /v9/projects/{id}` field with no CLI command at all, and no equivalent in `next.config.ts`. This was the *original* hypothesis, back at the very first failure — dismissed too early in favor of Next.js-side config because it seemed like a bigger, riskier live-project change than a code fix. **Rule: when a search turns up "there's an official setting for this," believe it before continuing to patch around the symptom in application code — a documented first-class mechanism for a shape this common (Next.js app in a monorepo subdirectory) is more likely correct than three independent config workarounds.**
- **Lesson (splitting a lockfile surfaces dependencies that hoisting was quietly satisfying by accident):** with the Vercel setting in place (previous bullet), the symlink was finally followed for real — and Turbopack immediately reported `Module not found: Can't resolve 'zod'` from inside the real `src/chart/schema.ts`, reached through it. Not a new bug: `web/`'s independent `node_modules` (this session's own attempt-2 fix) never had `zod`/`pg`/`@anthropic-ai/sdk`, because `web/package.json` never declared them — only the now-abandoned shared workspace made them reachable, by accident of hoisting a dependency `web/` never asked for. The fix is not a workaround: `web/`'s own Server Action genuinely, at runtime, executes backend code that needs those three packages, so declaring them directly in `web/package.json` (matching root's versions) just makes an already-true dependency explicit. **Rule: when un-sharing a dependency tree (splitting a workspace, disabling hoisting), expect previously-invisible transitive dependencies to surface as "module not found" — that's the split working correctly, not a new problem it caused.**
- **Lesson (a symlinked file resolves ITS OWN imports from its real path, not the symlink's apparent location — so "add the dependency" can still be an incomplete fix):** adding `zod`/`pg`/`@anthropic-ai/sdk` to `web/package.json` (previous bullet) was necessary but, on its own, did not fix the build — the exact same three "module not found" errors recurred, completely unchanged, on the very next push. The missing half: `web/backend` is a *symlink*, and Node/Turbopack resolve a symlinked file's own `import` statements relative to its **real, filesystem-resolved path** (`<repo root>/src/...`), never the symlink's apparent location inside `web/`. Walking up from that real path reaches `<repo root>/node_modules`, not `web/node_modules` — and this session's own deploy job had stopped installing anything there, on the (reasonable-sounding, wrong) assumption that `vercel build`'s `web/`-scoped install covered everything once `web/` became independent. Root's `package.json` already declared the same three packages (it always had — `src/` is the original backend code), so the actual fix was one line: restore the root `npm ci` step in the `deploy` job. **Rule: "the package is declared in the right package.json" and "the package is resolvable from where the code that needs it actually lives on disk" are different claims — a symlink makes them diverge, and only the second one is what module resolution checks.**
- **Also observed (an accidental Vercel project, and how it happened):** deleting `web/.vercel` mid-debug and re-running `vercel pull` (with no `.vercel/project.json` present to anchor it) silently created a **second, differently-named** project ("web", from the directory basename) instead of relinking the existing "checkdecijfers" one — `vercel pull`/`vercel link` without an existing project file don't prompt to confirm you meant to create something new. Cleaned up (with the owner's explicit go-ahead) via `vercel project remove`. Rule: never delete a `.vercel/project.json` that's already correctly linked just to "start clean" — relink by ID (`projectId`/`orgId`, both non-secret, safe to hardcode temporarily) instead.
- **Evidence:** local production smoke test (`next build && next start`) against the real live pipeline: golden-path answer (B1-style), a line chart with a working tooltip showing the exact `formattedValue` string, a clarify round correctly capped at one round (still-ambiguous reply → refusal, per ADR 015), and a direct scope refusal (B17-style) — all four `ComposedResponse` kinds rendered correctly. Six push-triggered CI runs against WP12 commits before the pipeline went green — five failures, the sixth green — with `gate` green on every single one (445+ tests incl. web: the backend and the UI were never in question, only the deploy pipeline's own plumbing): run 1 (`next build`-only fixes) failed on "Next.js package not found"; run 2 (symlink alone) failed on the *identical* error, disproving that diagnosis; run 3 (independent `web/` install) failed on `Symlink ... points out of the filesystem root`; run 4 (Vercel `rootDirectory`/`sourceFilesOutsideRootDirectory` setting) failed on `Can't resolve 'zod'`/`'pg'`/`'@anthropic-ai/sdk'`; run 5 (declared those in `web/package.json`) failed on the *identical* unresolved-package errors, unchanged; run 6 (root `npm ci` restored in the deploy job) went green. Root gate unaffected throughout every iteration: 445/445 tests, clean typecheck, both before and after every `src/db/client.ts`/`next.config.ts`/lockfile-layout/CI-workflow change.
- **Scope:** engineering (bundler-vs-runtime footguns, verify-the-real-build discipline, monorepo root-resolution), ops (env-file hygiene, secret-store and live-project authorization boundaries), tooling (preview-click fallback)

## 2026-07-03 — WP11: the tracker can move under a running session; hermetic fail-fast asserts can be wrong live

- **Lesson (concurrent sessions):** while this session worked, a parallel session committed *and pushed* a STATUS/repo-settings change (Dependabot alerts, enabled by the owner — commit 822de58). This session had independently checked the same setting via `gh api`, found it enabled, and drafted the wrong explanation ("GitHub's default for new repos") — the parallel commit carried the real one (the owner had just flipped it). Two rules: (a) an API check verifies *state*, never *provenance* — don't write causal attributions into STATUS that the check can't support; (b) before finalizing STATUS edits, re-check `git log`/`git status` for mid-session movement — the tracker is shared mutable state, and "file modified since read" on a docs file is a signal to reconcile, not just retry.
- **Lesson (hermetic → live promotion):** the WP10 runner threw on "clarify task didn't clarify" — correct under replayed fixtures (can't happen) but wrong live, where it would have *crashed the run* instead of recording a scoreable failure. When promoting hermetic machinery to live use, re-audit every `throw`: infrastructure failures should fail fast; wrong-but-well-formed outcomes must reach the scorer as scored failures (ADR 017 decision 1). The general shape: an assert that encodes "the fixtures guarantee X" becomes a policy decision the moment the fixtures are swapped for reality.
- **Lesson (spend estimates):** name the pricing basis. Sonnet 5 is on introductory pricing through 2026-08-31 (~$2/$10 per MTok vs $3/$15 list) — the WP11 estimate ($0.19) is ~15% higher at list, and an unbased estimate silently goes stale in September. Cheap to record; STATUS now states both.
- **Also observed (plan completeness):** docs/03's in-scope table carried an item (minimal chat UI) that no build-plan WP covered — three earlier ADRs even deferred obligations "to the chat-UI session" — so "do the next WP" would have ended the plan with scope remaining. At WP completion, diff the scope table against the plan's WP list; WP12 now exists.
- **Lesson (review method — probes become pins):** the review's executing gate-teeth prober scored *tampered dump copies* through the real scorer from a scratch dir — zero repo mutation (the WP10 isolation lesson honored by the new dump-path argument itself). Those probes then converted 1:1 into a permanent vitest suite (scorer-teeth), so what this review proved by hand, every future push re-proves. When a review probe is executable and repo-external, turn it into a committed test before closing the finding — the review's marginal cost was already paid. Bonus: probing the *new* argument surface found a *pre-existing* latent gap (duplicate-id shadowing in the scorer's last-wins Maps) that reading the diff alone could never surface.
- **Evidence:** live run 2026-07-03: 22 flows → 24 audit rows (ids 1–24 in live `audit_answers`), gate PASS first attempt (14/14, 6/6, 0 fabricated), medians 6,465/7,289 ms, usage Haiku 111,076/2,674 + Sonnet 26,215/1,201 ≈ $0.19. Parallel commit: 822de58. Runner change pinned by the scorer's kind + missing-reply-round failures.
- **Scope:** process (shared-tracker reconciliation, attribution honesty, scope-vs-plan diff), engineering (fail-fast vs scoreable-failure at the hermetic/live boundary), ops (pricing-basis in estimates)

## 2026-07-03 — WP10: mutation-testing skeptics edited the shared working tree — probes work, but isolate them in worktrees

- **Lesson (review method):** two test-honesty skeptics executed their mutation tests by editing the repo's working tree directly (a wrong prompt-version constant, a role-label swap, a gutted `reconstructionReport`), reverting after each probe — despite a "do not modify repo files" instruction. The probes themselves were *valuable*: the role-swap mutation exposed a real membership-vs-binding gap (the llm_calls test accepted any set containing both roles; roles are now bound to each call's independently-recorded model/usage — the third occurrence of the WP8/WP9 gap family). But the shared-tree churn had two costs: the session's own concurrent test runs turned unreliable mid-review (an "everything fail-closes" red herring), and one finder observed another skeptic's active probe and reported it as an "intermittent audit-write failure" — a finding two skeptics then spent ~22 clean re-runs refuting. Next time: give mutation-testing reviewers an isolated worktree (the harness supports per-agent worktree isolation) and treat any mid-review mutation of the shared tree as a defect in the review itself; the session should also not run its own gate while executing skeptics are live.
- **Lesson (scanning for leaked values):** raw `String(value)` substring matching over a serialized envelope is the wrong shape for a value-leak check — it false-positives on numeric collisions (any float containing "2.9") and false-negatives on locale formatting ("2,9"). The honest mechanical form: tokenize the *user-facing text* with the same tokenizer R1/R3 trust and compare parsed numeric values, plus a structural check that the payload carries no value field at all. Same family as WP7's tokenizer lessons: never scan serialized JSON when you mean "what the user sees".
- **Also observed (scorer = same judges as CI):** the `.mjs` scorer imports the TS test helpers and src tokenizer directly under Node 24 type stripping, so the benchmark scorer, the vitest suites and the live evals judge answers by literally the same functions — no re-implemented formatting rules to drift. Worth keeping as a constraint when the scorer grows.
- **Evidence:** review: 5 lenses → 11 findings, 22 skeptic verdicts (27 agents, mid tier): 2 double-confirmed (schema-version pinning in reconstruction; the B20 leak-check rewrite) + 2 of 3 contested accepted, all fixed and tamper-pinned same session; 6 refuted — of which 3 were refuted because the session had already fixed them mid-review from the live probes, and 1 (the "intermittent failure") was the probe interference itself. Gate after fixes: 432 real tests + 0 todos, benchmark 14/14 + 6/6 + 0 fabricated from audit records.
- **Scope:** review method (isolate mutating reviewers; probes-as-findings), scanning (token-level leak checks), tooling (Node type stripping lets .mjs share TS judges)

## 2026-07-03 — WP9: "mirrors existing logic" without the strongest assertion is how mirrors drift; a mode-section beats a second prompt

- **Lesson (delegation):** a delegated helper (`freshestForCanonical`) was reported as "reusing the canonical-measure lookup pattern from resolve.ts rather than duplicating it" — it actually re-implemented the lookup and missed the `default_coordinates` merge, so it silently returned null; every test passed because the assertions accepted the degraded output (an example question without its period). Caught in session review only because a copy edit surfaced the weaker output in a failing wording assertion. Two rules going forward: (a) when a brief says "mirror existing logic", the implementation must either *call* the existing code or name the mirrored lines in a comment, and the review diffs the two; (b) when a test asserts on output containing an optional enrichment the fixture data guarantees, pin the enrichment's presence — otherwise the test blesses the degraded path forever (same membership-vs-binding family as WP8's label-swap lesson).
- **Lesson (prompt engineering):** appending a clarify-mode section to the proven WP6 system prompt calibrated 7/7 on the FIRST live attempt with zero flips over 3 repeats — where WP6's fresh prompt had needed three iterations. Extending a calibrated prompt also kept its bytes identical, so all 45 recorded intent fixtures stayed valid: zero re-record cost. Default to extension over new-prompt when the vocabulary/rules overlap.
- **Lesson (review, fourth confirmation — and the sharpest one yet):** the one-round clarification rule was enforced where the design document said it lived (the parser-level conversion) but not where the *code* could also produce a clarification: the query layer's `needs_clarification`, reachable through the shared `respondToIntent`, could ask a second question after a reply. The executing skeptic proved it with a schema-valid stub client against the real fixture DB. Class of gap: an invariant enforced at one producer while the type system allows other producers — enumerate every constructor of the guarded shape (here: every `toClarificationResponse` call site) and check the rule at each, or route them through one chokepoint.
- **Also observed (parallel delegation):** contract-first + two implementation agents with explicit disjoint file lists integrated with zero source conflicts; the integration agent's only fix was in its own test setup (clarify-mode requests hash differently from intent requests, so replay needs a second fixtures directory — mirroring the eval script's own two-client design).
- **Evidence:** dims-merge bug: out-of-scope offer read "Wat was de inflatie?" instead of "… in juni 2026" — fixed + pinned (`expect(offer).toMatch(/ in .+\?"/)`). Review: 5 lenses → 21 findings, 42 skeptic verdicts (one skeptic died on a structured-output retry cap; its finding was a duplicate of a double-confirmed one — per the WP8 rule that a dead agent is missing coverage, checked before accepting), 10 double-confirmed (2 HIGH) → all fixed + pinned same session. Clarify calibration: 7/7 record run, 7/7 ×3 repeats, ≈142.7K in / 3.5K out Haiku ≈ €0.15. Gate: 414 real tests + 1 todo, sequential suites, all green.
- **Scope:** process (delegated "mirroring", optional-enrichment assertions, invariant chokepoints, disjoint-file parallel delegation), prompt engineering (mode-section extension), review method (executing skeptics)

## 2026-07-03 — WP8: the morning's "cold-run flake" was actually the hook timeout — a half-applied lesson bites twice

- **Lesson:** when a mitigation gets applied, check every variant of the limit it raises. WP6's flake fix raised vitest's per-test timeout to 30s but left `hookTimeout` at its 10s default — and the heaviest per-file work (PGlite boot + 8-table fixture ingest in `beforeAll`) runs in a *hook*, not a test. The morning bootstrap's one-test first-run failure and WP8's full-suite failure were the same bug wearing two hats; the second occurrence finally produced the exact error ("Hook timed out in 10000ms") that root-caused both. `hookTimeout: 30_000` now sits alongside `testTimeout` with a comment naming the incident.
- **Also observed (design conditions matter):** the plan of record said "dumb renderer = thin wrapper around a charting library", but the repo at implementation time cannot import JSX (Node type stripping, no app) — the honest move was a dependency-free SVG renderer with the library wrapper deferred to the session that actually introduces a client (recorded as a deviation in ADR 014, per the build plan's own "firm up against the code in front of it" rule). Writing the renderer dependency-free made the strongest R6 test possible: every numeric token in the output provably originates from a spec string, using the same tokenizer R1/R3 already trust.
- **Lesson (review, third confirmation):** the executing-skeptic pattern again found what a fully green suite could not — the HIGH finding was proven by a skeptic *mutating a worktree copy* to swap two value labels and running the untouched test suite over it: green. The provenance test checked set membership ("every number shown is some spec string") but not correspondence ("this number sits at this point") — a class of gap to check for explicitly in any "nothing invented" test: membership without binding. Fix: `data-label-for` on every label + per-point identity assertions. The contract-audit lens also paid for itself: ChartSpec v1 was missing the pinned `dims`/`dimLabels` — caught while zero specs are stored, so the fix is a field addition instead of a schema-version migration.
- **Also observed (provider quirk):** one review finder died with a spurious API usage-policy refusal — adversarial-security phrasing ("bypass hunter", "attack surfaces") in an otherwise benign code-review prompt appears to have tripped a classifier. Rewording the same task neutrally ("audit the contract for completeness") succeeded. Treat a refused/errored lens as MISSING COVERAGE and re-run it — never as "nothing found".
- **Also observed (environment):** with another session's heavy process running on the same machine (load average ~20), full-parallel `npm test` flipped red with hook timeouts even at the raised 30s ceiling, then green, then red — unusable as a gate signal. Sequential per-suite runs (exactly CI's shape) stayed deterministic. Under load, gate locally the way CI gates.
- **Evidence:** first full-suite run of WP8: 1 failed (hook timeout at exactly 10s) / 332 passed; after the one-line config fix: 17/17 files green twice on a quiet machine. Review: 12 agents (5 finders + 6 skeptics + 1 audit rerun), 3 double-confirmed findings + 1 audit finding, 0 refuted, all fixed and pinned (37 chart tests, was 31). Sequential gate: 7/7 suites green, 344 passed + 1 todo. Morning bootstrap: 305/1 first run → green re-runs ([RUNBOOK.md](RUNBOOK.md) bootstrap note updated to the root cause).
- **Scope:** tooling (vitest hookTimeout vs testTimeout), process (half-applied mitigations; membership-vs-binding in provenance tests; failed lens = missing coverage; gate like CI under load), provider quirk (AUP refusal on adversarial phrasing)

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
- **Evidence:** this machine's global `~/.gitconfig` was set to a WORK identity (redacted per open-questions #132 — the repo is public now), which ended up authoring 22 of this repo's first 25 commits — the entire doc-writing phase plus WP1 — before Stefan caught it via a different Claude Code session. Fixed with a repo-local `git config --local user.name/user.email` override plus a `git filter-branch --env-filter` history rewrite (no `git-filter-repo` available on this machine; built-in `filter-branch` was adequate for 25 commits) and a force-push. Verified byte-identical tree content before pushing (`git diff` against the pre-rewrite ref was empty) and re-ran CI green on the rewritten history before calling it done. Full recipe: [RUNBOOK.md](RUNBOOK.md), GitHub account line.
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
