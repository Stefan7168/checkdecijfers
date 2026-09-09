# STATUS

> **Tracker, not a source of truth.** Scope and the gate are defined in [03-mvp-scope.md](03-mvp-scope.md), the benchmark in
> [02-user-scenarios.md](02-user-scenarios.md). This file only records progress against them. Update it whenever project state changes (see the
> definition of done in [CLAUDE.md](../CLAUDE.md)) — with **measured results only, never aspirational ones**.

> **Session log lives in [status-archive.md](status-archive.md)** — full per-session "Last updated" entries, verbatim, newest on top.
> **Convention (since 2026-07-12, session 41):** at session wrap-up, PREPEND the full session entry to
> [status-archive.md](status-archive.md) and update only the lean top block below. Keep STATUS.md readable in one
> Read call: hard-wrap every line at ~150 chars, no kilobyte-long lines.

**▶ SESSION 92 (2026-09-09, owner present all day) — THREE FEATURES BUILT, REVIEWED, VERIFIED AND LIVE
ON `main` THE SAME DAY, EACH VIA SUBAGENT-DRIVEN DEVELOPMENT: STORY MODE, THE CHAT POLISH BATCH,
FRAME STYLING + THE FLOATING STYLE PANEL. Embed is DESIGNED (spec Part B), not built — the next build.**
- **Kickoff item 0:** Dependabot's sharp bump merged (`474d62b`, CI `34334007143` green, health ok).
- **Story mode (ADR 039 addendum; spec Part A; plan `2026-09-09-story-mode.md`):** a gradient-ring
  "Verhaal / Story mode" trigger beside Style opens a story panel under the chart — code-built steps
  from the chart's own strings (overview · start · highest · lowest · latest · explore; per-series
  steps; highest/lowest bars), a dashed ring or bar outline on the step's point, per-step highlight,
  legend/zoom/small-multiples locked while open, snapshot/restore of the reader's view. Assumption
  [#221](open-questions.md) (highest/lowest = a selection, R6). Merged `46d22ed` (fast-forward), CI
  `34355032827` gate + deploy green. Also: the chart-language select preselects the current
  language (owner ask, ADR 040 addendum).
- **Chat polish (eight owner asks, plan `2026-09-09-chat-polish.md`):** icon-only thumbs; "Copy" copies
  the whole answer with the source link (HTML + text); "CSV"; the "Chart in panel →" pill inside the
  answer card with text wrapping; a "Suggested follow-up questions:" hint; narrower side padding; more
  room under the price line; "Connect data" / "Link sheet". Merged `0b161eb`, CI `34356558637` green.
  Seen live in the owner's Chrome (light).
- **Frame styling + floating Style panel (ADR 039 addendum; spec Part C; plan
  `2026-09-09-chart-frame.md`):** a Frame tab (background colour / gradient presets / own image kept
  only in the browser, padding, corners, shadow, inset card, aspect ratio) drawn on screen AND baked
  into PNG/SVG (outer svg, CSS-exact gradient, attribution inside); the Style panel is now a floating
  non-modal dialog beside the chart (one per page; bottom sheet on phones); backgrounds that would hide
  a series are refused, series colours are judged against the active frame, refused presets show
  disabled; no frame in table form (final-review decision). Merged `1a23aa1`, CI `34369657966` gate +
  deploy green, `/api/health` ok. Two whole-branch review rounds (opus) found and fixed two Criticals
  (a white rectangle behind the chart in framed exports; a half-built table path) — lessons-learned.
  [#222](open-questions.md): dark-mode exports were always low-contrast (pre-existing).
- **Verification before each merge:** typecheck ×2, web suite (last 1275/1275, 87 files), backend
  2198/2198 (solo), benchmark 28/28, real `next build`, docs 11/11, `/code-review` LOW 0 findings.
- **Production check:** the chat polish verified in the owner's Chrome; the five homepage charts render
  the Story trigger, Style button and frame wrapper (public page); the INTERACTIVE check of the story
  panel, the floating panel, the Frame tab and the aspect-ratio sizing on a phone width is still to do
  by the owner (no chart thread existed in the account; a chart question hit a clarification).
- **Owner steps unchanged:** migrations 028 + 029 (`npm run db:migrate`), optional `BRANDFETCH_API_KEY`,
  WP202a go-live steps 2–6. **Next build:** Embed (spec Part B) — needs the owner to set
  `EMBED_TOKEN_SECRET` (+ optionally `PRO_ACCOUNT_EMAILS`) when it ships.
Full session entry: [status-archive.md](status-archive.md).

**▶ SESSION 91 (2026-09-09, started AUTONOMOUS — "Start executing, work autonomously … I expect
everything to be done" — the owner returned in the same session) — THE WHOLE WP218 CHART STYLING
PROGRAMME (ALL SIX PHASES) + THE OWNER'S TWO DESIGN PICKS BUILT, REVIEWED, VERIFIED, AND — ON THE
OWNER'S "merge everything" — MERGED INTO `main` (`05ec8ed`, the PR's merge commit) AND LIVE: CI run
`34329626769` gate green + deploy green, `/api/health` `{"ok":true}` (7 checks), checked on production
in the owner's logged-in Chrome light + dark (answer card with the thumbs first; the chart's Style
panel opening under the chart in the dock as a two-column grid; NL | EN switch; Line · Area · Bar ·
Horizontal bar · Table tabs). Migrations 028 + 029 and the Brandfetch key remain the owner's steps.**
- **Built (41 commits, `867393d`..`eab25b6`, Subagent-Driven Development: 20 implementation tasks
  on Sonnet, a fresh Sonnet reviewer per task, one Opus whole-branch review + fix round):**
  phase 0/1 the "Opmaak" panel on every chart (Grafiek / Kleuren / Lettertype tabs; thickness in
  four named steps, markers, grid, axis lines, label angle, value labels, baseline; per-series
  colour with the R11 ring guard; curated Google fonts) — ADR [039](decisions/039-chart-presentation-panel.md);
  phase 2 the account default ("Bewaar als mijn standaard", migration 028, GDPR retention leg,
  self-service delete); phase 6 the anonymous usage counter ([#220](open-questions.md)); phase 3
  brand colours + font via Brandfetch (cache table, migration 029, five lookups per user per day,
  key-gated); phase 4 the NL | EN switch for the whole interface with charts following it and a
  per-chart language choice, CBS words via a hand-written word list ([#219](open-questions.md),
  ADR [040](decisions/040-interface-language-switch.md)); phase 5 two more honest chart types
  (Vlak = area, Liggend = horizontal bar) grown into the Weergave switch after a research read-back.
- **Verified before the push (all at `eab25b6`):** root + web typecheck clean; web suite 1121/1121
  (83 files); backend suite 2191/2191 (142 files, run solo); hermetic benchmark suite 28/28 green
  (its gates: every answer task passes, every refusal task refuses, zero fabricated numbers);
  real `next build` clean; docs conventions test 11/11; Opus whole-branch review "Ready after
  fixes" → all nine findings fixed in `eab25b6`, re-reviewed Approved; LOW-effort review pass on
  the fix commit 0 findings. Browser checks on the local `web-db` server: the panel in light, dark
  and 375 px (one real bug found + fixed: tilted labels clipped left), the language switch (cookie,
  `<html lang>`, English headings via the word list), the five tabs with reasons, the chart-language
  select and the "why no pie chart" note.
- **Owner steps (RUNBOOK § "WP218 chart styling — the supervised go-live"):** apply migrations 028 +
  029 (`npm run db:migrate`); optionally set `BRANDFETCH_API_KEY`. **Owner decision, end of session:
  Brandfetch lookups are hard-capped at 100 real calls per calendar month (`03488d6`, counted in
  `chart_style_usage` as `brand_fetch`, fail-closed when that table is absent; CI run `34332236454`
  gate + deploy green, health ok) — the free tier is never
  exceeded and no paid plan is needed; customers may miss the button for the rest of a month.** Until
  the migrations run: saving a default says "not possible", the counter counts nothing, brand lookup
  is refused — by design, no error pages.
- **Open at the close (not this session's scope):** Dependabot opened pull request number 8 (sharp
  0.35.3 → 0.35.4, one HIGH alert in libheif) while the session closed — first item next session:
  wait for its CI, merge, watch the deploy.
- **Decisions taken under "document, don't escalate"** (each with a rollback in ADR 039/040): a
  two-year retention window for a saved style; a 30-day brand cache; the citation stays Dutch;
  backend prose stays Dutch on an English chart; first visit follows the browser's language;
  saving a default never stores a form-locked value. UNCONFIRMED without a key: the Brandfetch
  endpoint path form (one constant).
- **Later the same session, owner back in chat — two design canvases and two owner picks BUILT on the
  same branch:** the owner asked "check if you can optimise the UI first, use /design". Two Claude
  Design canvases were drawn from the real components (the chart card + its panel:
  https://claude.ai/code/artifact/bb89df71-447a-4c22-9f19-4b66714eff20; the chat screen:
  https://claude.ai/code/artifact/49c2358e-8ef4-40df-a51d-21ac4a7fdbc6), each showing the current build
  beside three options. Picks: chart panel **option A** (compact two-column grid) with the chart on top
  and the settings under it; chat **option B** (answer card with a source/actions footer) with the
  like/dislike buttons first, white with a grey border and a light shadow. Built as `0de0390`, `810c5a6`
  (answer card + the not-helpful panel width fix from review), `e4eee7b`, `d2eabca` (panel under the
  chart; a first portal-based trigger did not work in a real browser and was replaced by a plain
  controlled button — lessons-learned), `cafcafe` (throwaway preview route reverted). Web suite
  1132/1132, typechecks clean, `next build` clean; the answer card verified in the local browser
  (light + dark, thumbs first, full-width panels); the panel layout verified by tests + DOM order
  (the hidden Browser pane never hydrates the chart subtree — lessons-learned).
- **CI minutes (owner question about GitHub's newsletter → three cheap changes, BUILT `c10b874`):**
  our GitHub cost is Actions minutes (~10 min per run); now docs-only pushes skip CI, a feature branch
  gets its gate through its pull request (no double run per push), and a newer push cancels the
  superseded run on the same ref (so the last push on `main` always owns the deploy — the RUNBOOK's
  "two runs in flight" race is closed). Recorded in CLAUDE.md Conventions.
- Unchanged: WP202a go-live steps 2–6 pending (RUNBOOK); #216, #217, #172, #214, #215 tracked.
Full session entry: [status-archive.md](status-archive.md).

**▶ SESSION 90 (2026-09-09, owner present — the owner pasted the session-89 kickoff and stayed in
the chat) — the #218 chart-configuration ARCHITECTURE PANEL RAN and the owner answered its 8
decisions; three small owner UI asks + a per-chat delete SHIPPED to `main`.**
- **#218 architecture pass** (the single next priority from the kickoff): a 4-angle Fable design
  panel + Fable synthesis via the Workflow tool (5 agents, 1,014,545 tokens, 19.5 min; angles:
  presets-only / per-chart-panel / saved-defaults-and-types / spec-seam), the same shape as session
  88's panel. Synthesis published as an artifact (https://claude.ai/code/artifact/5a971401-ce68-40d5-ad28-1a74f2246c39)
  and saved verbatim in [session-briefs/2026-09-09-session-90-chart-config-tool-synthesis.md](session-briefs/2026-09-09-session-90-chart-config-tool-synthesis.md)
  (+ the panel script beside it). Converged mechanism: a `presentation` slice on the session-89
  chart reducer + one pure resolver yielding the EFFECTIVE values and per-option honesty locks, so
  the "Opmaak" panel always shows what is on screen. **The owner then answered decisions A–H in
  chat** (recorded on [#218](open-questions.md)): A an EN/NL switch in the top navigation for the
  whole app, charts following it with a per-chart language dropdown ([#219](open-questions.md));
  B a Colours tab (swatch + hex + colour picker, library colours as default) with an "Apply brand
  colours" button via the Brandfetch API, and the same for fonts; C styles saved in the user's
  ACCOUNT (database); D the app keeps choosing the best type but a dropdown offers more, after a
  best-practice research piece; E each chart starts fresh; F add a simple anonymous usage counter
  ([#220](open-questions.md)); G the panel appears everywhere incl. homepage + trial; H line
  thickness as four named steps. Turned into the 6-phase **WP218 chart styling programme** in
  [08-build-plan.md](08-build-plan.md) — **awaiting the owner's "go" and phase order** (cheapest-first
  proposed: panel → account save → Brandfetch → EN/NL switch → chart types → counter; the owner
  may want the language switch earlier). **Nothing of #218 was built in session 90 — session 91 built all six phases, see above.** B and C knowingly override
  the owner's own 2026-09-08 cheapest-mechanism default (outside service + database now); named
  in chat, the owner's call.
- **Shipped, 3 commits on `main` (`6e2a66b`, `2880b57`, `e6a7ede`), owner-present direct push after
  the full verification block:** (1) the pre-send pricing line sits directly UNDER the "Stel een
  vraag" input again and the whole chip row directly ABOVE it (session-88's `PricingHintContext`
  + footer segment removed as dead plumbing); a disabled "Link with sheet" chip before "Connect
  database"; (2) a plus icon in "Nieuwe chat" and a per-row ⋯ "Chat options" → "Delete chat" →
  inline confirm in the sidebar, backed by `deleteThreadQuestionHistory` (the #14 GDPR redaction
  narrowed to one thread; dataset threads route to `deleteOneDataset`) — no schema change, the
  thread vanishes because its derived title source is gone; shadcn `dropdown-menu` (Base UI)
  added; `scripts/dev-web.mjs` + a `web-db` launch entry run the local web app with the root
  `.env`; (3) the #218 docs. Verified before push: typecheck ×2, web 784/784 (+12), backend
  2093/2093 (+4, incl. a foreign-thread and a ledger-untouched pin), hermetic benchmark 14/14 +
  6/6 + 0 fabricated, real `next build`, `/code-review` LOW 0 findings.
- **CI + production, verified at the end of the session:** run `34261331269` (code push) gate green,
  its deploy step skipped BY DESIGN ("main is already at 4ab390d; that commit's own run deploys it");
  run `34262171903` (docs push `4ab390d`) gate green + deploy green; `/api/health` `{"ok":true}`.
  **Visual check done on production in the owner's logged-in Chrome, light AND dark:** chip row
  above the input, pricing line directly under it, "Link with sheet" before "Connect database", plus
  icon in "Nieuwe chat", ⋯ appears on row hover, "Delete chat" menu opens (closed with Escape, nothing
  deleted), footer without a pricing segment. (A logged-in LOCAL check is impossible as configured —
  RUNBOOK § "Running the web app locally WITH the real database".)
- **Owner steer, recorded as a standing rule:** decision lists in shorthand were unreadable
  ("Didn't I tell you to use plain, normal English?") — every owner-facing option is now a plain
  full sentence (memory `feedback_plain_english_no_jargon`, lessons-learned).
- Unchanged: WP202a go-live steps 2–6 pending (RUNBOOK); #216 (B20 recalibration), #217
  (model-independence), #172, #214, #215 tracked, not touched.
Full session entry: [status-archive.md](status-archive.md).

**▶ SESSION 89 (2026-09-08, started autonomous/no owner present, owner returned mid-session and
authorized direct merge — "you are the expert, continue") — Phases 1-3 of session-88's
chart-editing architecture panel built end-to-end via Subagent-Driven Development, MERGED and
LIVE.** Built a pure client-only view-state reducer for CBS
charts (`web/lib/chart-view-state.ts`) driving 4 user-facing pieces with zero LLM
calls/DDL/prompt-byte changes: a line/bar/table form switch with a multi-region-line guard,
Vanaf/Tot period-range zoom (on-screen + export disclosure), series hide + highlight
(dim-others), and click-to-annotate notes (session-only, mounted outside the export container
so they can never leak into a PNG/SVG download). Executed as 7
`superpowers:subagent-driven-development` tasks (fresh implementer + reviewer per task):
task-level review fix loops caught and fixed real bugs before each commit landed — a stale-form
honesty-guard gap (a disallowed multi-region spec could inherit a stale 'line' form), a
small-multiples zoom leak (small multiples silently ignored the zoom window), and a
highlighted-then-hidden series left permanently dimmed with no UI escape. **A required final
whole-branch review (opus, merge-base `e91cdd1`) then found 5 further Important cross-task
composition-seam bugs invisible to any single task-scoped review** — e.g. annotation markers
not composing the active form (a false "Gemarkeerd in de grafiek" claim would render on a Staaf
view) and a non-monotonic note-id counter where deleting one note could silently delete two —
fixed in one consolidated commit (`1a5e968`), re-reviewed clean.
[ADR 038](decisions/038-chart-view-state-editing.md) records the as-built mechanism and how
open decisions A-H from session 88's panel resolved: A/C/D/E by the mechanism chosen, B/F to
the most conservative default (explicitly NOT an owner decision), G/H untouched; addendum on
[#212](open-questions.md). **Flagged to the owner directly in chat; 2 of 3 fixed same session
(commit `92821a1`, owner: "let's do everything"):** small multiples now gates off (disabled)
once the form is switched away from Lijn, instead of silently continuing to draw line panels;
the Vanaf/Tot zoom selectors now clamp against each other (moving one endpoint past the other
drags it along, closing the inverted-range/nonsense-disclosure gap) — the clamp logic itself was
extracted into two named, unit-tested pure functions per a same-session LOW code-review finding
(the first version duplicated it inline in both onChange handlers). **Left as-is, decided NOT a
bug:** a chosen chart form persisting across a swap to a completely different chart correctly
extends the pre-existing Tabel-persistence behavior to line/bar consistently. Built
autonomously on `feat/chart-editing-p1` per [#118](https://github.com/Stefan7168/checkdecijfers/issues/118)'s
branch+PR rule (no owner present during the build); **owner returned before the branch was
pushed, reviewed this summary, and gave standing owner-present authorization to merge directly**
— fast-forwarded onto `main` (clean, `main` had not moved) and pushed, per CLAUDE.md's
owner-present direct-push convention; the feature branch was then deleted (never pushed to the
remote). 15 commits (`f3bba6b`..`3a92b61`) on `main`. Full verification block re-run immediately
before the merge: typecheck ×2, web 767/767, backend 2089/2089 (unchanged), benchmark
14/14 + 6/6 + 0 fabricated (unchanged — this branch never touches the answer pipeline), real
`next build`. **Verified LIVE:** CI run `34226204304` green; `GET /api/health` on
`https://checkdecijfers.vercel.app` → `{"ok":true}`, all 7 checks passing. **Follow-up same
session** (docs correction `be2d309`, then the 2 deferred-item fixes `92821a1`): full
verification block re-run before each push (typecheck ×2, web 772/772, backend 2089/2089
unchanged), CI runs `34227783282` and `34234407567` both green, `/api/health` reconfirmed
`{"ok":true}` after each deploy. **Also same session:** the WP202a go-live checklist's step 1 —
`dataset_turn` credit price decided (20, mirrors `simple`/`clarification`) — landed in
`478c943`, not yet applied to production (steps 2-6 of [RUNBOOK.md](RUNBOOK.md)'s WP202 checklist
still pending). **Then, owner request ("it becomes costly"): `PHRASING_MODEL` and
`WEBSEARCH_MODEL` switched Sonnet→Haiku** (every other model in the codebase was already Haiku).
Live re-record surfaced ONE real gap (B8, a 6-period series: Haiku omitted intermediate years
while still describing the trend shape correctly — no fabrication, an omission) — fixed by a new
explicit prompt rule (6b: state every period's value) rather than accepted as-is,
`COMPOSE_PROMPT_VERSION` bumped to 4, re-recorded clean (14/14). `WEBSEARCH_MODEL`'s citation
behavior on the untested Haiku+BASIC-variant combination was verified with a real live call
(4/4 findings cited) before shipping, not assumed. Full verification + a LIVE benchmark run
surfaced a second, unrelated finding — [#216](open-questions.md): B20's freshness-refusal
condition has simply been overtaken by real CBS data catching up, a benchmark-maintenance gap,
not a phrasing regression (root-caused, not guessed). Owner's stated further goal — true
model-independence — recorded as [#217](open-questions.md), pointing at the unshipped `#162`
`SLOT_PHRASING_ENABLED` slot-filling mechanism as the real architectural answer, not something to
build today. Full details incl. as-built notes on [ADR 013](decisions/013-answer-composition.md)
and [ADR 032](decisions/032-websearch-augmentation.md). Full session entry:
[status-archive.md](status-archive.md).

**▶ SESSION 86 (2026-09-07, owner present, mixed autonomous/interactive) — the CI `deploy` job is
FIXED and LIVE for the first time in weeks, and that exposed + fixed a real production incident.**
The 3 long-pending `gh secret set` commands finally ran (two non-secret ones by the session, the
`VERCEL_TOKEN` by the owner — twice: the first token was scoped to a single project and could not
run `vercel pull`, a genuine Vercel gotcha; a second, team-wide-scoped token fixed it). The very
first real deploy since session-84's close-out (`22618d3c`) shipped ALL of session 85's UI work to
production at once — and immediately exposed that `listThreads`/`getThreadDatasetId`
(`src/threads/index.ts`) unconditionally query `chat_threads.dataset_id`/`user_datasets`, both
added by migration 026, which has **never been applied to the real database**. Since
`WORKSPACE_ENABLED` is live in production, this broke thread selection/the sidebar and
`/api/health`'s `threads-read` check for every signed-in user — a real instance of the
already-documented RUNBOOK "#154 schema-coupled code" lesson, just never triggered before because
deploy had been broken. **Fixed same session** (`03addbd`, a `userDatasetsTableExists()`
check-not-catch mirroring the `errorLogTableExists`/`trialTableExists` precedent exactly): both
functions fall back to the pre-ADR-037 CBS-only query when the migration hasn't run, and pick up
real dataset behavior automatically once it does. **Verified live**: `GET /api/health` →
`{"ok":true}`, all checks passing. Also this session: WP202a's docs §7 sweep (05-data-rules U-rows,
09-pricing, 13-envelope-presence-grammar, 04-architecture, 03-mvp-scope, 06-roadmap, RUNBOOK's WP202 go-live
checklist), `VisualDock`'s `userChart` dock branch, `ATTACHMENTS_ENABLED` threaded through
`page.tsx` (still unset in Vercel — WP202a itself is still not live), and a demo-only "Link
toevoegen" URL-preview (owner request, no backend). Full session entry: [status-archive.md](status-archive.md).

**▶ SESSION 85 (2026-09-06 into 2026-09-07, owner present throughout, continuing session 84) —
WP202a's backend finished, then its ENTIRE UI slice built and wired end to end: chat-with-your-data
now works fully, still dormant (no `ATTACHMENTS_ENABLED` flag).** Full session entry:
[status-archive.md](status-archive.md).

**Chat-with-your-data (#201/#202, ADR 037/WP202a) is feature-complete, not yet live.** 6 commits
today (`6a3f697`→`5593f3d`→`90c63c0`→`d35c87c`→`52d5fc9`→`49376b0`), each its own full
verification block (typecheck + full backend suite + full web suite + a real `next build`) +
`/code-review` LOW pass — **3 real bugs caught and fixed, none by pre-existing tests**: a bound-
SQL-parameter type-inference miss (`uuid = text`), `DatasetChat` reusing stale state across a
thread switch (missing `key={threadId}`, verified by reverting the fix and watching the
regression test fail), and the upload UI showing the client's raw filename instead of the
server-persisted one. Full per-commit detail: [08-build-plan.md](08-build-plan.md)'s WP202a
section — read that for the exact scope, not this summary.

**v1 scope is deliberately smaller than the CBS chat, documented not silently cut**: no resumed-turn
cost captions, no small multiples/table view/value labels/trend headline/CSV export on
`UserChartView`, "Link toevoegen"/"Databron verbinden" stay disabled (their backends don't exist).
**Session 86 update:** "Link toevoegen" is now clickable (a demo-only URL-input preview, owner
request — see below); its backend (url_html ingest, WP202b) is still not built. "Databron
verbinden" is unchanged.

**Given a 3-way choice (continue into `VisualDock` / stop / skip to the flag+docs sweep), the
owner chose to stop here (session 85).** Migrations 026/027 remain **FILE-ONLY**. Full backend
suite green (2087/2087), full web suite green (682/682), CI `gate` green on all 6 commits (`deploy`
failing on all of them on the same pre-existing Route B secrets gap, [#132](open-questions.md)).

**▶ SESSION 86 (2026-09-07, owner present, "you are the expert, continue") — `VisualDock`'s
`userChart` branch built:** the one purely-additive, non-owner-supervised bullet session 85 left in
WP202a's remaining scope. At `lg`+, a dataset-thread chart now docks with an in-flow reference chip
exactly like a CBS chart does, instead of always rendering inline. `DockVisual` gained an additive
`userChart: UserChartSpec | null` field (zero behavior change to the CBS path, confirmed by the
full pre-existing suite passing byte-identical), `deriveDatasetVisuals` is the `deriveVisuals`
analog, and `DatasetChat` gained `dockMode`/`onVisualsChange`/`activeVisualId`/`onActivateVisual`
props mirroring `Chat`'s own. 15 new tests, full web suite green (697/697). Also threaded
`ATTACHMENTS_ENABLED` through `page.tsx` (the `websearchEnabled` dormancy pattern, code-only —
still **OFF in Vercel**). Full detail: [08-build-plan.md](08-build-plan.md)'s WP202a section.

**✅ #206 — product copy/UI text is English, not Dutch (owner override, session 84)** — every new
string session 85 wrote (buttons, badges, error messages) followed this convention throughout;
still does not touch the CBS chat/answer pipeline's own Dutch output or benchmark task phrasing.

**Untouched, no owner input given specifically:** WP30c, #197's older follow-ups, #205 (a possible
future subscription tier, explicitly parked), #208 (needs the owner's URL/path).

**✅ session 86 — the 3 `gh secret set` commands for Route B are DONE** (see the session-86 entry
above) — `deploy` is green again, no longer a standing blocker.

**▶ NEXT, in order:** (a) sub-project 2's ([#211](open-questions.md)) or sub-project 3's
([#212](open-questions.md)) real design brainstorm with the owner — both still need one before any
build; sub-project 3 is arguably lower-risk to start (tier 3 already confirmed working live, tiers
1-2 have 3 concrete approach options on the table); sub-project 2 has a real unresolved
streaming/validation-timing tension that needs settling first; (b) [#214](open-questions.md), the
mobile header wrapping — needs a real design decision (hamburger/overflow menu? hide the balance
badge? drop secondary links behind "Account"?), no existing collapsed-header UI to reuse; (c)
WP202a's remaining scope — fixtures (`tests/fixtures/llm/attachments/`, real-LLM-spend,
owner-supervised), THEN the owner-supervised migration apply + the actual `ATTACHMENTS_ENABLED=1`
flip + go-live — see [08-build-plan.md](08-build-plan.md)'s WP202a section for the exact list; (d)
WP30c + #197's older follow-ups — owner-menu, no rush. **Also queued, both explicitly "not now" per
the owner (session 88):** [#215](open-questions.md) (chart download: PDF not SVG for vector, PNG
transparent/no baked-in text/smaller) and the click-to-annotate chart-editing preference folded
into [#212](open-questions.md)'s own row — neither designed or scheduled yet.


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
