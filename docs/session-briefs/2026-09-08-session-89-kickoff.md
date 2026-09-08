Session 89 kickoff — paste this as the first message

Written at the session-88 close-out, 2026-09-08. Durable copy of the handoff; the chat may be gone,
the repo is the source of truth. Every fact below was verified against `git log`, `gh run view --json jobs`,
`curl` of production, `git status`, `git worktree list`, and `npm run test:docs` at the time of writing —
not recalled from memory.

Read in this order before doing anything: `CLAUDE.md` → docs/STATUS.md (the top block is the truth) →
this file → docs/status-archive.md (session-88 entry, top) → docs/lessons-learned.md (session-88 entry,
top) → docs/open-questions.md rows #211/#212/#214 (the redesign effort's own tracking rows) →
docs/RUNBOOK.md's WP202 go-live checklist (still the actual next owner-supervised step, unchanged
this session).

Verify yourself first, don't trust this file blindly:

* `date +%Y-%m-%d`, `git log -20 --oneline` — expect one or more small self-audit `docs:` fix
  commits at the very tip (this file was written before the wrap-up ritual's own final self-audit
  pass finished catching its own mistakes — trust `git log` over any exact SHA named in this file),
  then `0360af1`/`e2f442e`/`ad538e5`/`90a93ed`/`f7c1477`/`0e0d219`/`c83d572`/`0aacc5e`/`8ff24ce`/
  `33f1cf6`/`50761d6`/`1213358`/`c87afbe`/`734f7ea`/`0d11e8a`/`6621ef9`/`0ca8853`/`5eec334` below
  that — the 18 build-range session-88 commits.
* `gh run list --branch main -L 3 --json databaseId,headSha,status,conclusion` then confirm the HEAD
  run's `gate` AND `deploy` jobs are both green (deploy actually ran its real steps, not "skip the
  deploy when main has moved on" — check via `gh run view <id> --json jobs -q '.jobs[] | select(.name=="deploy") | .steps[]'`
  if in doubt).
* `curl -s https://checkdecijfers.vercel.app/api/health` — expect `{"ok":true,...}` with 7 checks
  passing.
* `git worktree list` (expect ONLY the main checkout), `git status --short` (expect clean).
* Quick visual sanity check that this session's work is actually live: ask a question in the chat —
  a pulsing skeleton should show alongside the busy text while it generates; the pricing line
  ("Een vraag kost ~X credits...") should appear in the SITE FOOTER at the bottom of the page, not
  inside the chat card; the CBS-data/Internet/Add-link chips should all read the same style, with a
  checkmark on whichever is selected; if a chart appears, the right-hand panel should be
  drag-resizable (it will NOT remember a custom width across a reload — that's expected, not a bug,
  see below).

State after session 88 (2026-09-08, owner present throughout)

1. **Sub-project 2's real ask, clarified via brainstorm:** the owner's actual complaint was missing
   loading FEEDBACK (no spinner/skeleton), not the absence of live-typed streaming text. This
   sidesteps the streaming/validate-after-generate architectural tension session 87's research
   brief surfaced — **that tension is STILL genuinely undecided**, this session did not resolve it,
   only built around it.
2. **Plan 1 shipped and LIVE: loading skeletons (chat answer, chart panel, thread switch) +
   drag-to-resize chart panel.** A mandatory whole-diff `/code-review` LOW pass (required before
   every push, even after 6 individually-approved task reviews) caught a real Critical bug none of
   those task reviews had seen: `Workspace`'s chat section changed its wrapping element TYPE
   depending on whether the chart dock was open, so React unmounted/remounted the whole chat —
   losing live conversation state — every time the dock toggled. Fixed. **Real-browser testing then
   found a genuine defect in `react-resizable-panels@4.12.4`'s own cross-visit width-persistence
   logic** (a saved width comes back swapped/wrong on reload, even violating the chat panel's own
   minimum-width constraint) — traced across 3 different fix attempts before concluding it's the
   library's bug, not ours, and asking the owner. **Owner decision: the chart panel resizes fine
   within a session, it just does NOT remember a custom width across a reload** — this is the
   accepted, deliberate current state, not a bug to fix reflexively if you notice it.
3. **Plan 2 shipped and LIVE: chip consistency + footer pricing**, from live owner feedback given
   mid-session while looking at the running app. Removed a "Soon" badge, made the CBS-data/
   Internet/Add-link chips read identically with a selected-state checkmark, moved the pre-send
   pricing line out of the chat card into the site's global footer (a new `PricingHintContext`
   bridges `Chat` — deep inside `Workspace` — to `SiteFooter`, which is a layout SIBLING of the page
   content, not a descendant). Along the way, caught and fixed: a real sequencing bug in the plan's
   OWN Task 3 (its tests were correctly red pending Task 4, not a defect — the plan itself had a
   cross-task dependency wrong), and a real gap where `Dashboard` (the `WORKSPACE_ENABLED=0`
   fallback — **still live, the documented rollback target, NOT dead code**) was never accounted
   for as a second consumer of the pricing text that moved.
4. **shadcn `Button` conversion for the answer card's action row** (proof/citation/CSV links,
   feedback thumbs), from owner feedback on a live screenshot — these were hand-rolled `<button>`
   markup duplicated across 3 files, never using the shadcn `Button` component the rest of the
   redesign relies on. Pure presentational swap, verified in a real browser.
5. **Research delivered for sub-project 3's future brainstorm** (conversational chart editing),
   via a Fable subagent looking at an external demo site the owner pointed at. Key finding: the
   demo's "storytelling mode" uses ZERO LLM calls — fixed Dutch templates over computed stats this
   product's own R5 derivations already register. Reframes the owner's "very API heavy" framing:
   the real fork is deterministic storytelling (near-zero LLM calls) vs. LLM-authored storytelling
   (multiple calls per story), not chart-type-choice vs. storytelling — chart-type choice is a
   prerequisite to either. Report at `.superpowers/sdd/fable-chart-editing-research.md`
   (session-local scratch, gitignored, NOT committed — read it directly if still present on this
   machine, otherwise it's gone and the summary above plus `docs/status-archive.md`'s session-88
   entry is what survives).
6. **Owner note, not yet acted on:** keep the landing page's "Chat met de officiële cijfers van
   Nederland" headline and its subhead unchanged for now — separate from any future rebrand
   direction the owner is still weighing. Do not touch that copy without being explicitly asked.
7. **Both plans executed via `superpowers:subagent-driven-development`** — fresh implementer +
   reviewer subagent per task, model tier picked by task complexity. Two real process lessons worth
   knowing before running SDD again in this repo (full detail in `docs/lessons-learned.md`'s
   session-88 entry): (a) a subagent told only to "commit" pushed to origin on its own initiative,
   reading this repo's own CLAUDE.md standing push authorization as applying to itself — **future
   SDD dispatches should say "commit only, do not push" explicitly**; (b) an implementer who ran the
   FULL test suite even though their task brief only named one file caught a real cross-task gap
   (`Dashboard`'s stale test) that a narrower instruction would have hidden — trust and reward that,
   don't treat it as scope creep.
8. **Dependency/security check NOT re-run this session** (last clean check was session 87 — 0
   vulnerabilities, 0 Dependabot alerts; the only dependency change this session,
   `react-resizable-panels`, was added and verified against its own installed `.d.ts`). Worth a
   fresh check if it's been a while by the time you read this.
9. **Verified, not assumed, throughout:** 19 commits total (18 build-range + 1 final wrap-up docs
   commit), 6 pushes,
   every single one individually watched to its own green CI run before the next push started, no
   exceptions. Full web suite 717/717 final, full backend suite 2089/2089 (measured once as a final
   sanity check — `src/` was never touched at all this session, confirmed via `git diff --stat`
   across the full range, so there was nothing for it to have broken). Both typechecks clean, real
   `next build` clean, on every push. `/code-review` LOW run before every code push (not just once —
   Plan 1, Plan 2, and the Button-conversion follow-up each got their own fresh pass), one real
   Critical finding caught and fixed (see #2 above), otherwise 0 findings throughout.

▶ NEXT, in order

1. **Sub-project 2's or sub-project 3's real design brainstorm with the owner** — both still
   genuinely need one before any build. See `docs/open-questions.md` rows
   [#211](../open-questions.md)/[#212](../open-questions.md) for exactly what's known vs. still
   open, and `.superpowers/sdd/fable-chart-editing-research.md` (if still present) for the
   sub-project-3-specific demo research. Sub-project 3 is arguably lower-risk to start (tier 3
   already confirmed working live, tiers 1-2 have 3 concrete approach options on the table);
   sub-project 2 has a real unresolved streaming/validation-timing tension that needs settling
   first.
2. **[#214](../open-questions.md), the mobile header wrapping** — a smaller, contained follow-up if
   wanted: needs a real design decision (hamburger/overflow menu? hide the balance badge? drop
   secondary links behind "Account"?), no existing collapsed-header UI to reuse the way #213's
   sidebar fix had.
3. **WP202a's actual go-live** — unchanged from prior kickoffs, still the standing owner-supervised
   item whenever picked up: (a) decide the `dataset_turn` credit amount; (b) apply migrations
   026/027; (c) verify guarded FKs + grants/RLS live; (d) set `ATTACHMENTS_ENABLED=1` + redeploy;
   (e) live smoke test + GDPR spot-check. See `docs/RUNBOOK.md`'s WP202 go-live checklist for the
   exact steps.
4. WP30c + #197's older follow-ups — owner-menu, no rush, untouched again this session.
5. **Two more feedback items, given at the very end of session 88 (in passing — the owner
   explicitly said not to act on them then), neither designed nor scheduled yet:**
   [#215](../open-questions.md) — chart download: the "vector" option should be a PDF, not the
   current SVG; the PNG option should be transparent, with no baked-in source/attribution text,
   and smaller (currently `PNG_SCALE = 2`) — note the current baked-in-text behavior is a
   *deliberate* invariant per the code's own comment ("both formats serialize the SAME SVG
   markup"), so dropping it for PNG is a real product decision to confirm with the owner, not a
   silent bugfix. And an addendum on [#212](../open-questions.md) — the owner leans toward chart
   annotations being a direct click-and-write interaction, not routed through chat.

Binding frames, unchanged from prior kickoffs
Principles (a)/(b)/(c); no prompt-byte changes to the CBS pipeline without owner sign-off; no live
DDL without the owner (migrations 026/027 apply is still explicitly owner-supervised); no fixture
re-recording without explicit authorization. Never run `gh secret set`/`delete` yourself, full stop.
8 GB machine: prefer running heavy suites (backend, especially — ~30 minutes this session) solo
rather than alongside several background agents; this session ran it once at wrap-up without
contention issues, but stayed mindful of it throughout. `npm run test:docs` before every docs push;
`/code-review` LOW before every code push (docs-only pushes exempt) — and per this session, run it
even after individually-approved task-level reviews if using Subagent-Driven Development, since a
whole-diff pass catches things scoped reviews structurally cannot. Owner-present sessions push/
merge directly, no per-change approval needed ([#118](https://github.com/Stefan7168/checkdecijfers/issues/118)
revision). If using `superpowers:subagent-driven-development`, explicitly tell implementer
subagents "commit only, do not push" (session-88 lesson — see #7 above). The Agent tool cannot
resume a subagent — a second `Agent` call spawns an independent duplicate, not a continuation; hold
amendments for the original agent's report-back, or stop and restart with a complete fresh brief.
