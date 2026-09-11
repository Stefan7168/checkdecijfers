# Experience improvement plan — the whole journey of a journalist, now that the chart work is done

**Status: proposal for the owner to react to — nothing in this document is decided, scheduled or built.**
Written 2026-09-11 by Fable 5.1 on the owner's open-ended ask ("how can we improve the experience"), in the
same shape as the 2026-09-10 visual plan ([2026-09-10-visual-next-level-plan.md](2026-09-10-visual-next-level-plan.md)).
This is a plan, not a build: no code, no branch, no other doc was changed for it. Every "as built" statement
below was read directly from the repository at the time of writing (paths given; the chart-side files from
`origin/main`, where the three visual-upgrade pull requests #10–#12 had landed — merge commits `ca5ba19`,
`696c1c3`, `29aadde`, all dated 2026-09-11), never recalled from memory. Everything owner-facing is in plain
English; engineering detail sits under the headings marked for build sessions.

The owner's ask, kept whole: **"how can we improve the experience?"** — asked right after the chart thread
(designed default, templates, the Story stage) closed. This document therefore does **not** re-propose
anything from the visual plan. It looks at the *rest* of the journey: arriving, the first question, trusting
an answer, publishing it, paying, and coming back.

## 0. Read this first — what this plan is grounded in, and what it is not

- **Grounded in:** the code of every surface a journalist meets (`web/app/*`, `web/components/*`,
  `web/lib/i18n/messages.ts` — which *is* the interface copy), the product docs (vision, scenarios, scope,
  pricing, house style), the one measured experience audit this project ever ran
  ([experience-audit-results-2026-07-05.md](../experience-audit-results-2026-07-05.md), 110 live questions),
  and the rough edges already recorded in [open-questions.md](../open-questions.md) that nobody picked up.
- **Not grounded in real users.** The README states it plainly: *"the owner is the only user so far."* There is
  no analytics of any kind in the web app (verified: no `@vercel/analytics`, no `track(` anywhere under
  `web/`), and the one usage counter that exists (`chart_style_usage`, WP218 phase 6) records nothing until
  migration 028 is applied — still an owner step. So every friction point below is inferred from reading the
  interface and from the July audit, not observed on a journalist. **That is itself the first finding**, and
  the first recommendation (§4, R1) exists so the next plan of this kind can be measured instead of inferred.
- **Not a rebrand or a marketing plan.** The tagline decision ("Turn your data into a story",
  [#7](../open-questions.md)), the trust/methodology pages the owner asked for ([#207](../open-questions.md))
  and the owner's own demo gallery ([#208](../open-questions.md)) are open owner threads; this plan points at
  them where the journey needs them and does not write copy for them.

## 1. In one page, for the owner

The product is in an unusual position: the *hard* part — an answer that is right, sourced and dated, or an
honest refusal — is built, hardened and now good-looking, while the *easy* part around it has gaps that a
first-time journalist will hit in the first five minutes. Reading the interface end to end as a newcomer
("Fleur", the freelance persona), these are the moments that decide whether she comes back:

1. **She cannot find the product.** Every page is marked "do not index" (`web/app/layout.tsx`), it lives on a
   `vercel.app` address, and the domain checkbox in the RUNBOOK is still open. Nothing in this plan fixes that —
   it is your decision when the site "goes public" — but it frames everything: today the only way in is a link
   you send.
2. **Her first question decides everything, and the product cannot tell her what it knows.** The chat opens as
   a bare box (your session-87 decision). Nothing in the app says which topics are loaded, so a newcomer's
   first question lands on the coverage wall by chance. In the July audit, **14 of 14** out-of-coverage
   questions hit that wall and **20 of 56** answerable ones did not simply answer on the first try; a lot has
   shipped since (answer-first defaults, one-click options, on-demand fetching, nine more tables), but nobody
   has measured the new numbers. And when a question is *not* covered, the product fetches the table
   automatically for **100 credits — exactly the whole signup grant** — without asking first. Your own vision
   document promises the opposite ("confirmation for heavy queries"). One unlucky first question empties a new
   account.
3. **Trust is well served; the paperwork is not.** The answer card already shows the source, the sync date, a
   StatLine link, a "prove this number" panel, provisional and staleness marks and an honest refusal badge —
   this is the product's strength and it shows. What a journalist typing investigative questions does *not*
   find: a privacy policy (open since July, [#14(d)](../open-questions.md)) and the methodology page you asked
   for yourself ([#207](../open-questions.md)). The footer has no privacy link because there is no page.
4. **The new chart features exist but do not announce themselves.** Templates sit in a tab of the Style panel
   (which still opens on "Chart"), "Present" sits inside the Insights panel, and the landing page never
   mentions any of it — even though the homepage charts already carry the real controls. A newcomer can walk
   past all of it.
5. **Small verified defects in the money loop.** In the live workspace the low-balance warning and the
   "what your credits buy" explainer are never shown (they only exist in a screen the live flag no longer
   renders); the "not enough credits" message names `/credits` as plain text, not a link; the credits page
   lists each pack as "€5 — 200 credits" with a Buy button and nothing else — not what one question costs from
   that pack, not "≈ N questions", not "credits never expire", the one honest promise your business model
   makes; the purchase-success banner tells people to refresh the page.
6. **Clarifications are captioned wrong.** When the product asks a clarifying question, the answer options
   are labelled "Suggesties voor een vervolgvraag" ("suggested follow-up questions") — the caption for a
   different feature — and a click only fills the box; the reader must press Send again even though the price
   was already shown.
7. **Nobody has looked at the whole journey on a phone.** The chart work was battle-tested at 375 px; the
   header still wraps into three lines there ([#214](../open-questions.md)), and the composer's chip row —
   six chips, four of which do nothing yet — almost certainly wraps too (unverified).

**What this plan proposes, in order:** first *measure* the journey from data the database already holds
(signups, first questions, outcomes, refusal reasons, trial conversions, feedback — a read-only report, no
tracking, no personal data, half a day); then fix the verified defects in one small bundle; then decide the
one money-path question (confirm before a 100-credit fetch); then give newcomers a deterministic "what can I
ask?" disclosure built from the table registry; then make the chart features findable with copy, not code;
then the trust pages; then the clarification, composer and phone items. **Every recommended item is
deterministic, needs no AI call, no new library and no schema change** — the two exceptions (re-running the
experience audit, which costs real LLM spend; the fetch confirmation, which touches the money path) are
marked as owner-supervised. The bigger things a journalist would eventually want — a verdict on "klopt het
dat…?", shareable answer pages, a charts gallery, alerts on new CBS releases — are all already on the roadmap
in a later phase; §5 names them so they are not silently dropped, and does not pull them forward.

## 2. Verified current state — the journey as the code actually plays it

### 2.1 Arriving

- **Discoverability: none by design, for now.** `web/app/layout.tsx` sets `robots: { index: false, follow:
  false }` on every route (the comment: "internal/testing deployment on a *.vercel.app subdomain, not the public
  launch"). Production is `https://checkdecijfers.vercel.app` ([RUNBOOK.md](../RUNBOOK.md) line 25); the
  "confirm you control checkdecijfers.nl" checklist item (line 26) is unchecked. The free browse layer / SEO
  pages are a Phase 1 (late)–2 item in [03-mvp-scope.md](../03-mvp-scope.md) and stay there.
- **The landing (`web/components/landing.tsx`)**, logged out: a stripped header (wordmark + NL/EN); the pinned
  Dutch headline "Chat met de officiële cijfers van Nederland" + subtitle; "Begin met vragen" → `/login` and
  "Hoe het werkt" (anchor); the **anonymous trial** (`trial.tsx`/`trial-chat.tsx` — two free questions, no
  account, live since session 52; answer-first defaults reach it, one-click options deliberately do not,
  `trial-actions.ts` lines 208–211; there is no clarification reply round — a clarification is read-only and
  points at "maak een gratis account"); a frozen **real example** answer (consumer confidence, June 2026, −39 —
  Dutch verbatim in both languages by design); **"Geen gokwerk, maar rekenwerk"** in three steps (you ask /
  code computes / source included); the **Ontdek** section (`ontdek.tsx`, five curated charts rendered by the
  *same* `ChartView` as the paid product, so the Style, Insights and — since PR #12 — Present controls are all
  on the public homepage); a pricing paragraph ("credits, no subscription, free account") + "Maak gratis een
  account". Footer (`site-footer.tsx`): the CC BY attribution sentence, an "Over dit project" anchor to the
  how-it-works heading, and a gear icon to `/systeemoverzicht` (a public, noindexed technical system map).
  **No privacy link** — the file's own comment: "`/privacy` and `/over` still don't exist (#14(d))".
- **What the landing does not say:** nothing about charts you can restyle, templates, insights, presenting,
  downloading or embedding; nothing about which topics are covered. The decided-but-unexecuted tagline
  ([#7](../open-questions.md), "Turn your data into a story") is not on the page.
- **Anonymous visitors on the Ontdek charts** get the deterministic Insights captions; the AI-phrased upgrade
  is signed-in only (`web/app/chart-insights-actions.ts` lines 47–48 return `unauthenticated`). The panel does
  not say so.

### 2.2 Signing up and the first question

- **Login (`web/app/login/*`):** magic link or "Doorgaan met Google"; no password. Signup grant **100 credits**
  ([09-pricing.md](../09-pricing.md): "equivalent to 5 free `simple` questions"). The Google consent screen
  still shows the raw Supabase project domain ([#7](../open-questions.md), owner: "we must remember it").
- **The workspace (`web/components/workspace.tsx`, `WORKSPACE_ENABLED=1` live):** header with the live balance
  badge, "Credits kopen", "Geschiedenis", NL/EN, "Account" (log out + delete history); a sidebar ("Nieuwe chat",
  a client-side search, day-grouped threads, a ⋯ delete); the chat card; the right-hand chart dock at `lg`+.
- **The empty state is a bare composer** — [12-huisstijl.md](../12-huisstijl.md): "no explanatory copy, no
  example-question chips (the #75 chips were removed from the chat screen; the logged-out landing page keeps
  its own copy)" — an explicit owner decision from session 87. The placeholder reads "Stel een vraag…".
- **The composer (`chat.tsx` lines 1153–1330):** above the input, one row of chips — "CBS data" (pre-checked)
  and "Internet" (web search is live), then **"Link toevoegen"** (opens a URL row that always answers "Dit is
  nog niet beschikbaar — binnenkort wel", a demo-only preview the owner asked for in session 86),
  **"Bestand uploaden"** (disabled until `ATTACHMENTS_ENABLED`, which is unset), **"Sheet koppelen"**
  (disabled) and **"Data koppelen"** (disabled) — six chips, four inert. Below the input, the honest price line:
  "Een vraag kost ~20 credits · saldo: N credits. Stel ik eerst een verduidelijkingsvraag, dan kost die 10
  credits en krijg je de rest terug."
- **What the app knows but does not show: coverage.** The registry can render its own coverage list — it does
  so for machines in `/llms.txt` (`web/lib/llms-txt.ts` → `buildCoverageReport`, `src/registry/coverage.ts`:
  every served table, its title, sync date and "begrippen") — and a typed meta question ("wat kun je?") gets a
  free, deterministic capabilities template (ADR [022](../decisions/022-meta-question-templates.md), 0
  credits). Neither is offered to a newcomer who does not know to ask. Coverage today: the eight Phase-0 tables
  plus the nine coverage-sprint tables ([11-coverage-table-set.md](../11-coverage-table-set.md), all live since
  session 54) plus whatever on-demand fetches have added.
- **The first out-of-coverage question: an automatic 100-credit fetch, no confirmation.** When the table finder
  is confident, WP16 debits the `heavy` price (ADR [026](../decisions/026-on-demand-fetch-job-architecture.md)
  decision 2: 100 credits) and replies with `ONBOARDING_PENDING_TEXT` (`src/answer/respond/refusals.ts` lines
  227–228): *"Dat onderwerp staat nog niet in onze database. We vragen de cijfers nu automatisch op bij het CBS
  en controleren ze — meestal een kwestie van minuten. Je krijgt een e-mail zodra je vraag beantwoord kan
  worden."* The pre-send line just above the input said "~20 credits". The refund on failure is automatic; the
  charge on success is the whole signup grant. [01-product-vision.md](../01-product-vision.md)'s business
  model states: *"Cost transparency before spend: the user sees the credit cost of an action before the
  expensive step runs — estimate label, **confirmation for heavy queries**, visible tariff card."*
  [#109](../open-questions.md) recorded (session 66) that a confirm-first step "would be a confirm-first
  retrofit on the live money path, an owner product decision". It has not been made. How often a real user
  would hit this is unmeasured (`pending_table_requests` holds the data to measure it).
- **Clarifications and follow-ups (`chat.tsx` lines 1073–1109):** every message with `suggestions` renders the
  caption `chat.suggestionsHint` — "Suggesties voor een vervolgvraag:" — **including a clarification, whose
  chips are the answer OPTIONS the server proved answerable** (the code comment at lines 759–764 says exactly
  that). A click *fills* the input (the #75 fill-don't-send convention); the reader presses "Verstuur" again.
  The clarification's own cost line already reads "10 credits · antwoorden op de wedervraag kost ~20 credits".
  [#211](../open-questions.md) named both "clarification-chip legibility" and "fill-don't-send follow-up chips"
  as friction and left them untouched.
- **Waiting:** one awaited Server Action; measured median **6.5 s, max ~14 s** (`web/app/page.tsx` lines 6–15,
  WP11); an honest busy line ("Bezig met het doorzoeken van CBS-cijfers…") plus a skeleton (session 88). No
  streaming — the validate-after-generate tension in [#211](../open-questions.md) is undecided.

### 2.3 Getting an answer and deciding whether to trust it

- **The answer card (`chat.tsx` lines 890–1003)** is strong: the body; the defaulted-axis disclosure at body
  weight ("this is the national figure"); the amber staleness warning; the definition line; the alternate-
  reading line; the derived-data marking. The footer: the "voorlopig" pill, the **full R4 attribution
  sentence**, the **SourceBadge** ("CBS 83693NED · gesynchroniseerd 2026-08-26 ↗", a StatLine deep link), then
  thumbs up/down, **"Bewijs dit cijfer"** (`answer-proof.tsx`: why this reading, the exact cells with sync date
  and CBS status, step-by-step derivations, a technical toggle), "Grafiek in het paneel →" when docked,
  **Kopieer** (the whole answer, source hyperlinked, citation flags appended), **CSV**, the cost.
- **A refusal** announces itself: "Dit kon ik niet beantwoorden" + the badge "geen antwoord = geen gok"; the
  text names the reason (scope / freshness / forecast / causal / …, `src/answer/respond/types.ts` lines 38–78)
  and, for period-coverage refusals, a one-click retry chip for a period that works.
- **What is missing on the trust side is not on the card — it is around it:** no privacy policy
  ([#14(d)](../open-questions.md), open since 2026-07-05; the GDPR section of
  [04-architecture.md](../04-architecture.md) lists the disclosure that questions transit an LLM provider as a
  requirement), no methodology page ([#207](../open-questions.md): the owner asked for "a marketing page AND a
  technical/methodology page" making the CBS-specific scope of the claim explicit). The only public
  explanation of the mechanism is the three landing steps and the technical `/systeemoverzicht`.
- **"Klopt het dat …?"** — the product's namesake moment for the editor persona — restates the official figures
  without a verdict (Phase 0 behaviour, [02-user-scenarios.md](../02-user-scenarios.md)); a verdict needs the
  claim-verification intent + derivations slotted for Phase 1 ([#25](../open-questions.md)). Not built.

### 2.4 Turning it into something publishable

- **Built and live on `main`:** Copy (rich text with the source link), CSV (Dutch notation, attribution inside
  the file), the stat card PNG for single numbers (`stat-card.tsx`, 1200×630, source baked in), chart PNG/SVG
  with the attribution baked in (`chart-download.tsx`), the citation line with provisional/derived flags, the
  five chart forms, the Style panel (Sjablonen · Grafiek · Kleuren · Lettertype · Kader), six templates
  including **Redactie/Newsroom** — "publicatieklaar" in its own description — Insights, and Present.
- **Built, not merged:** the public embed (PR #9, branch `origin/embed-charts`, not contained in `origin/main`
  at the time of writing; its ADR is numbered 041 on that branch while `main`'s 041 is Insights — a numbering
  collision the merging session must resolve). Its "Live" mode cannot activate for anyone until the Pro-owner
  lookup exists ([#224](../open-questions.md)).
- **Where the new features sit:** `chart.tsx` (origin/main lines 2030–2155) renders the Weergave tabs, then the
  **Opmaak/Style** trigger, then the gradient **Inzichten/Insights** trigger; the Style panel's first tab is
  Sjablonen **but the panel still opens on Grafiek** (ADR [043](../decisions/043-chart-templates.md) decision 6:
  "revisit on counter data" — and the counter is blind until migration 028); **Presenteren** is a button inside
  the Insights panel (`chart-story.tsx` origin/main lines 270–272); Download sits at the bottom of the card
  beside the attribution (lines 3013–3045). Nothing on the card or the landing names these features to a
  newcomer.
- **Owner-flagged, explicitly "not now":** PDF instead of SVG, a transparent PNG without baked-in text
  ([#215](../open-questions.md)). Listed in §5, not proposed.

### 2.5 Credits and paying

- **The live workspace never shows the low-balance warning or the credits explainer.** `AccountPanel`
  (`web/components/account-panel.tsx`: the #69 warning "Je saldo is bijna op — er is nog genoeg voor één vraag"
  at lines 35–52, the #76 explainer "Bij aanmelding krijg je eenmalig 100 credits…" at lines 60–68) is mounted
  **only** in `dashboard.tsx` line 124 — the `WORKSPACE_ENABLED`-off branch of `web/app/page.tsx`, which
  production no longer renders (the flag has been live since session 42). Verified by grep: `lowBalance` occurs
  nowhere else. The only balance signals in the live product are the header badge and the pre-send line.
- **"Not enough credits"** renders as a plain info message: "Je hebt niet genoeg credits (N over, 20 nodig).
  Koop credits via /credits." — `chat.insufficientCredits`, rendered through the plain `message.text` branch
  (`chat.tsx` lines 656–680, 1006–1017), so `/credits` is unlinked text.
- **`/credits` (`web/app/credits/page.tsx`)** is a heading, "Je huidige saldo: N credits.", and one row per pack
  showing `pack.label` ("€5 — 200 credits" … "€250 — 25.000 credits", `src/billing/pricing-defaults.ts`
  lines 57–60) + "Kopen" (lines 44–53). Nothing else: no €-per-question, no "≈ N vragen", no "credits
  verlopen nooit" — the promise [01-product-vision.md](../01-product-vision.md) calls "the honest
  differentiator" ("no subscription, no expiry"). Payments run in Stripe **test mode**, card-only; the
  business-entity step behind live mode is deliberately parked by the owner ([#54](../open-questions.md), with
  a standing instruction not to raise it) — noted here as a fact, not as a next step.
- **After a purchase** the banner says: "…Ververs daarna de pagina om je nieuwe saldo te zien." The balance
  moves live on question outcomes (#68) but not on the webhook credit.

### 2.6 Coming back

- Threads persist with derived titles (the first question, `src/threads/index.ts` lines 238–239), a search box,
  day groups, per-thread delete; `/geschiedenis` shows every past answer with its proof panel, in-flight fetch
  status (a 20 s poll) and the delivery e-mail's deep link. The on-demand fetch e-mails the user when a table is
  ready.
- Nothing pulls a journalist back on a *deadline rhythm*: no alerts on CBS releases (Phase 3, scoop alerts),
  no charts gallery ([#159](../open-questions.md), Phase 2), no "what changed since your last visit". Per
  [06-roadmap.md](../06-roadmap.md) these are demand-sequenced later phases; this plan does not pull them in.

### 2.7 Mobile

- The sidebar auto-collapses below 768 px ([#213](../open-questions.md), fixed); charts render inline below
  `lg`; the Style panel is inline everywhere; the Story stage has a phone layout (ADR 044). The header still
  wraps at 375 px ([#214](../open-questions.md), open — "a genuine design decision, flagged for the owner").
  The composer's chip row is `flex-wrap` with six chips (`chat.tsx` line 1168); at phone width it will wrap into
  two or three rows above the input — **Assumption, unverified in a browser.** The only end-to-end phone pass
  on record is the session-92 chart battle test; the chat, login, credits and history pages have never been
  walked on a phone.

### 2.8 Measurement — what the product can and cannot know today

- **No product analytics** (verified; [#220](../open-questions.md) confirms the decision to keep it that way
  beyond one counter). The chart counter (`src/chart/user-styles.ts`, `CHART_STYLE_EVENTS`: panel/option/
  default/brand/story/frame events, now also `template_*`, `stage_open`, `stage_autoplay`) writes to
  `chart_style_usage` — created by migration 028, **not applied**; every "escalate on measured evidence"
  clause in ADRs 042–044 is therefore blind.
- **But the database already records the journey**, as a side effect of doing its job: every signup grant
  (`credit_transactions`, reason `signup_grant`, migration 005), every question with its kind and refusal reason
  and user (`audit_answers`, migrations 004/007), every trial question (`trial_questions`, migration 020),
  every 👍/👎 (`answer_feedback`, migration 017), every thread and its activity (`chat_threads`, migration 019),
  every on-demand fetch (`pending_table_requests`, migration 012). No script reads any of it as a funnel
  (`scripts/` holds evals, purges, audits, `rls-audit.ts`, `verify-audit-rows.ts` — nothing reporting usage).
- **The one measurement of "feel" is fourteen months old in product terms:** the 2026-07-05 audit (110
  questions, 40 answered / 32 clarified / 38 refused; 20 of 56 answerable questions did not simply answer;
  all 14 out-of-coverage questions hit the wall). Since then: answer-first defaults and one-click options
  (WP26, live), on-demand fetch (WP16, live), tables #1–#9 (live), the `max_on_national_measure` fix (#97a),
  the date-range parser (#77). The battery still exists (`scripts/run-experience-audit.ts`,
  `benchmark/experience-audit-questions.json`) — re-running it is real LLM spend, owner-supervised.

### 2.9 Known rough edges already on record that nobody picked up (the ones this plan touches)

[#211](../open-questions.md) (clarification-chip legibility, fill-don't-send, inconsistent attachment-row
affordances, streaming undecided) · [#214](../open-questions.md) (mobile header) · [#14(d)](../open-questions.md)
(privacy policy) · [#207](../open-questions.md) (trust/methodology pages) · [#109](../open-questions.md)
(confirm-first fetch = owner decision) · [#101](../open-questions.md) (two pricing sweeteners, deferred) ·
[#7](../open-questions.md) (tagline decided, not executed; Google consent-screen domain) ·
[#208](../open-questions.md) (the owner's demo gallery, never located) · [#225](../open-questions.md) (no spend
cap on Insights phrasing) · [#172](../open-questions.md) (the bijstand-class fetch refuses-and-refunds after a
model drift — honest, but a newcomer pays the wait). Not touched here but relevant to "publish": [#215](../open-questions.md).

## 3. The diagnosis, in five sentences

The trustworthy answer is the product and it is done well; the *container* around it — arrival, orientation,
money, paperwork — was built one work package at a time and never walked end to end as a stranger. The single
largest lever is not a feature but **knowing**: the product cannot say how many people signed up, asked, hit
the wall, converted from the trial, or came back, although every one of those facts is already in its own
tables. The single riskiest moment is the **first question**: a newcomer has no idea what is covered, and an
unlucky first question silently spends the whole free grant on a fetch the vision document says should be
confirmed. The new chart features are the product's best demo and are **invisible to a newcomer** by
placement and by copy. Everything else is a short list of verified defects that are cheap to fix and cost
nothing in AI, schema or libraries.

## 4. Recommendations, ranked — highest leverage per unit of cost first

Each item: what · why (verified) · mechanism (cheapest first) · cost · principle check · decision needed.
Sizes are build-session estimates in this project's usual shape (cheap-tier implementers, fresh reviewers, the
full verification block, a real-browser pass before "done").

### R1 — Measure the journey from the data you already store (do this first)

- **What:** a read-only report, `npm run usage:report` (a script beside `gdpr-purge.ts`, same conventions),
  printing weekly aggregates: signups (`signup_grant` rows); users with ≥ 1 question; **first-question outcome
  mix** (answer / clarification / refusal by reason) versus later questions; the top refusal reasons and — for
  `scope` refusals — the topic terms that hit the wall; on-demand fetches started / delivered / failed and their
  credit cost; trial questions, and trial visitors who later signed up (the trial's `audit_answer_id` link plus
  a later grant — **Assumption:** joinable without personal data, on counts only); 👍/👎 counts; users active on
  ≥ 2 distinct days ("came back"); users at zero balance who never purchased. **Plus: apply migration 028** so
  the chart counter finally counts (an owner step already listed in every kickoff since session 91).
- **Why:** §2.8 — the product has zero instrumentation of the human journey, yet every "escalate on measured
  evidence" rule in CLAUDE.md and ADRs 042–044 assumes it. This is the cheapest possible instrumentation:
  no tracking code, no third party, no schema, no cookie banner implications.
- **Mechanism:** SQL over existing tables; aggregates only, never question text, never e-mail addresses
  (principle: the same posture as `chart_style_usage`'s "no personal data"). Run by the owner or in the monthly
  maintenance session; optionally e-mailed through the existing admin-alert channel (Resend, `alerts.ts`).
- **Cost:** ~½ day. No LLM, no API, no schema, no library.
- **Also, owner-supervised:** re-run the experience-audit battery once (`npm run audit:experience`, real Haiku
  spend, order of a few euros — **Assumption**, re-check the recorded spend of the July run before starting) to
  re-measure the 20-of-56 friction after WP26/WP16/tables 1–9. It is the only way to know whether "the first
  question" is still the problem it was in July.
- **Decision:** §9, items 1–2.

### R2 — Fix the four verified defects in the first-question and money loop (one small bundle)

1. **Caption the chips by kind** (`chat.tsx` lines 1077–1079): a clarification's options get "Kies een optie:"
   / "Pick an option:"; a refusal's retry chip gets "Probeer in plaats daarvan:" / "Try instead:"; answers keep
   "Suggesties voor een vervolgvraag:". Two new catalogue keys in both languages, digit-free.
2. **Link `/credits`** in the insufficient-credits message (a `<Link>` for the `insufficient_credits` info kind
   instead of the raw path in the sentence) — and, since the message is the one moment a user is told to pay,
   show the pack that covers the shortfall by name (read from `getActivePacks`, never hardcoded).
3. **Restore the low-balance warning and the explainer in the live workspace:** the cheapest honest place is
   the pre-send price line the reader already reads (`pricingHint`, `chat.tsx` lines 810–829) — tint it amber
   and append "…genoeg voor nog één vraag" when `balance < 2 × simple` (the #69 rule verbatim), and put the
   #76 explainer sentence under the balance on `/credits` (see R10). Nothing new is computed: both use the live
   pricing values the page already reads.
4. **After a purchase, poll instead of "refresh the page":** reuse the `OnboardingLiveStatus` pattern
   (`router.refresh()` every few seconds, hidden-tab aware) for a bounded ~30 s after `?purchase=success`, and
   change the banner copy to "je saldo verschijnt hier zodra Stripe bevestigt" — the copy stays honest (the
   webhook still decides; the page merely looks again).
- **Cost:** ~1 day for all four, web-only, no pipeline change. **Principle check:** no number is computed
  client-side that the server did not already return (the #68 rule); every string in `messages.ts` in both
  languages.
- **Decision:** none needed except the caption wording (§9, item 3 asks whether one-click sending is wanted
  too — R7).

### R3 — Cost transparency before the 100-credit fetch (owner decision, money path)

- **What:** when a question would trigger an on-demand fetch, **ask first**: the reply becomes "Dat onderwerp
  staat nog niet in onze database. Ophalen kost 100 credits en duurt meestal enkele minuten." with one chip
  "Haal op voor 100 credits" that takes the fetch; typing anything else is the next question. For the anonymous
  trial nothing changes (it never fetches).
- **Why:** §2.2 — the vision's own rule ("confirmation for heavy queries") is not honoured; the heavy price
  equals the signup grant; the pre-send line says "~20". A first-time journalist who happens to ask about
  "bijstand" or "criminaliteit" (the audit's out-of-coverage probes) spends her whole grant on one question,
  and in the [#172](../open-questions.md) class waits minutes for a refund instead of an answer.
- **Mechanism (cheapest):** the WP26 chip-carrier is already the product's one-click take mechanism
  (`ClickOption` on a present-only `pending`, `respondToClarificationReply`'s deterministic take) — a
  "fetch offer" is one more carrier shape, taken without an LLM parse; the debit moves from the finder's
  confident path to the take. The finder call already happened, so the offer costs nothing extra to show.
  **What it changes:** the live money path — the WP16 design's "no manual click on the happy path" rule
  ([06-roadmap.md](../06-roadmap.md) feature pool; ADR 026 decision 4's v1 core loop) — hence an explicit
  owner decision and, per [#118](../open-questions.md)(b), branch + PR + owner review if built autonomously. A cheaper stopgap if the owner prefers to keep auto-fetch: say the possibility and its price in
  the pre-send line ("~20 credits; een nieuw onderwerp ophalen kost 100") — copy only, ~1 hour.
- **Cost:** ~1–2 days incl. the ledger tests (the `heavy` debit moves, the refund-on-failure path is unchanged).
  No LLM, no schema (the carrier is client-held state, like every other `pending`).
- **Related pricing question, not decided here:** [#101](../open-questions.md) already parks "should a
  defaulted answer / a clicked resolution cost less"; a third one belongs beside it — should a **new** account's
  first fetch be discounted, or the grant sized so one fetch does not end the trial? Config-table values, easy
  to change (ADR 006). §9, item 5.
- **Decision:** §9, items 4–5.

### R4 — "Wat kan ik vragen?" — coverage as a deterministic disclosure

- **What:** a small, collapsed affordance — a link under the input, and the same link in the empty chat state —
  that opens a plain list of what is loaded: per served table its human title and its "begrippen", grouped,
  with one **click-to-fill example question** per topic; a one-line honest note that other CBS topics can be
  fetched on request (and, once R3 exists, what that costs). The same list can render as a section on `/login`
  or the landing ("Dit weten we nu") — same data, same component.
- **Why:** §2.2 — coverage is the product's actual boundary and the newcomer has no way to see it; the July
  audit's biggest lever was the coverage wall. The data is already rendered for machines (`/llms.txt`) and for
  people who know to ask ("wat kun je?"); this is the same registry read, offered before the first question
  instead of after the first refusal.
- **Mechanism:** `buildCoverageReport` (already cached 30 min for `/llms.txt`) → a Server Component list; the
  example questions come from the registry's own per-measure example the meta template already offers (the
  `exampleQuestionNl` context in `refusals.ts` — **Assumption:** one example per canonical measure is
  available or trivially added; verify at build time). Fill-don't-send on click, exactly the #75 convention,
  so the price line is seen before sending. Zero LLM: every string is registry text.
- **The decision it touches:** the session-87 "bare composer, no example chips" decision. This is *not* a row
  of chips in the face of every user — it is a collapsed link that opens a list — but it is the same family, so
  it is the owner's call (§9, item 6). Alternative that leaves the chat untouched: put the list only on the
  landing/login side.
- **Cost:** ~1 day. **Principle check:** the list must state *our* copy's dates ("gesynchroniseerd …", the
  measured date the badge already shows), never cadence promises; digit-free chrome around it.

### R5 — Make the new chart features findable, with copy before code

- **What, cheapest first:**
  1. **A caption under the Ontdek heading** on the landing naming the three verbs the charts already carry:
     "Probeer het meteen: Opmaak (sjablonen), Inzichten, Presenteren — en download als PNG." One catalogue
     string, both languages. The homepage charts are already the live demo; today nothing invites the visitor
     to touch them.
  2. **Open the Style panel on Sjablonen for a chart that has no per-chart tweaks yet** (ADR 043 decision 6
     deferred this "on counter data"; the counter is blind — so this is an owner call, §9 item 7). Once the
     reader has changed anything, keep opening on the last-used tab.
  3. **One honest line for anonymous visitors in the Insights panel:** "Log in voor AI-verwoorde inzichten" —
     a real reason to sign up that is currently invisible (§2.1).
  4. **A fourth landing step, "Publiceer"** ("Kies een sjabloon, download of embed — bron en datum reizen
     mee"), *if* the owner wants the landing to sell the chart work before the tagline rebrand executes
     (§9, item 8 — this overlaps [#7](../open-questions.md) and should be decided together with it).
- **Why:** §2.4 — placement is two clicks deep and the landing is silent; the ADRs deliberately chose the
  placement, so the cheapest lever is telling people, not moving controls.
- **Cost:** ~½ day for 1–3; item 4 is copy. No code beyond the tab default. **Principle check:** the new strings
  are digit-free (the whole-card scan) and in `messages.ts` in both languages.

### R6 — The trust paperwork: a methodology page and a privacy policy

- **What:** two static pages, linked from the footer (ADR 033 D6: no dead links — the footer gains the links the
  day the pages exist): **"Hoe we werken"** (the public-claim sentence, the three landing steps expanded, what
  "voorlopig" means, what a refusal means, what is *not* covered by the claim — user-uploaded data and, later,
  other sources, exactly the scoping [#207](../open-questions.md) records; the `/systeemoverzicht` page and
  `/llms.txt` already hold most of the material), and **"Privacy"** ([#14(d)](../open-questions.md): the 2-year
  retention and self-service deletion that are *already enforced*, the fact that questions transit an LLM
  provider, Stripe as payment processor — the three points [04-architecture.md](../04-architecture.md)'s GDPR
  section lists).
- **Why:** §2.3 — for an audience whose questions are investigative, the absence of a privacy page is the one
  trust gap the answer card cannot cover; and the owner asked for the methodology page himself.
- **Mechanism:** Server Components with catalogue copy, both languages; the privacy text needs the owner's (and
  ideally a legal) read before it ships — content, not engineering. Phase gate: the GDPR checklist is Phase 1
  in [06-roadmap.md](../06-roadmap.md) — in scope.
- **Cost:** ~1 day of build; the review is the owner's time. No LLM, no schema.
- **Decision:** §9, item 9.

### R7 — Clarification options: one click, honestly

- **What:** when a clarification's chips are server-verified options (WP26 mechanism A, `CLARIFY_CLICK_ENABLED`
  is on), a click **sends** the option instead of filling the box. Follow-up chips under an answer keep
  fill-don't-send (they start a new, separately priced question).
- **Why:** §2.2 — the #75 rule ("the user sees the cost line first") is already satisfied for a clarification
  by the clarification's own cost line ("…antwoorden op de wedervraag kost ~20 credits"); the second press is
  pure friction, and [#211](../open-questions.md) named it.
- **Mechanism:** the existing chip click handler binds the carrier and calls `handleSubmit`; the take path is
  unchanged. **It revises the #75 convention for one message kind** — owner decision (§9, item 3).
- **Cost:** ~½ day incl. tests. **Principle check:** the label sent is byte-identical to the offered option,
  so the deterministic rung recognises it exactly as today; no new LLM parse.

### R8 — The composer's inert chips

- **What:** collapse "Link toevoegen", "Bestand uploaden", "Sheet koppelen" and "Data koppelen" into **one**
  chip, "Eigen data (binnenkort)", disabled with the same honest title, until `ATTACHMENTS_ENABLED` is on — at
  which point "Bestand uploaden" alone appears, live. Keep the demo URL row reachable behind that one chip if
  the owner still wants it for demos.
- **Why:** §2.2 — four of six chips do nothing for a newcomer, and the demo one *looks* live and then says "not
  yet". [#211](../open-questions.md) recorded "inconsistent attachment-row affordance states". These chips
  were owner requests (sessions 86 and 90), so this is an explicit reversal to put to the owner, not a fix.
- **Cost:** ~½ day. **Decision:** §9, item 10.

### R9 — A phone-width pass over the whole journey, and the header

- **What:** (1) walk landing → trial → login → first question → clarification → answer card → chart → Style →
  Insights → Present → credits → history at 375 px in a real browser (Playwright, light and dark), fixing what
  is broken; (2) the header ([#214](../open-questions.md)) — recommended cheapest design: below `sm`, keep the
  wordmark, the balance badge and NL/EN, and move "Credits kopen" and "Geschiedenis" into the existing Account
  menu (no new component; the menu already exists). The owner may prefer a hamburger; both are one afternoon.
- **Why:** §2.7 — journalists on deadline read on phones; only the chart card has ever been battle-tested there.
- **Cost:** ~1 day. **Decision:** §9, item 11.

### R10 — The credits page and the purchase moment

- **What:** on `/credits`, keep each pack's label and add "≈ N gewone vragen" and the €-per-question it implies
  (computed from the live `simple` price and the pack's own `priceCents`/`credits`, as `AccountPanel` already
  does for the grant — never hardcoded), the sentence "Credits verlopen nooit. Geen abonnement." (the vision's
  own promise, [#5](../open-questions.md)'s legal wording check pending), and the #76 explainer under the
  balance. Keep the page otherwise as it is.
- **Why:** §2.5 — the page that asks for money says the least. The copy is a read of `credit_packs` +
  `action_class_prices`; nothing new is invented.
- **Cost:** ~½ day. **Principle check:** every number on the page comes from the pricing tables (ADR 006).

### R11 — Honest waiting

- **What:** after **N real seconds** of `busy` (say 8, above the measured median), add one truthful line under
  the skeleton — "Dit duurt iets langer dan gewoonlijk; we controleren het antwoord nog." — and after the
  90-second ceiling the existing error copy takes over. No fake stages, no progress bar.
- **Why:** [#211](../open-questions.md)'s own addendum proposed exactly this as the honest increment and
  nobody built it; a 14-second wait with one static line and a skeleton is where a newcomer doubts the product.
  Streaming stays undecided and is **not** recommended (§5).
- **Cost:** ~2 hours.

## 5. Considered and deliberately not recommended now (each with its phase or decision)

| Idea | Why not in this plan | Where it lives |
|---|---|---|
| Real token streaming of the answer | The pipeline validates the *whole* phrased body after generation and may retry or fall back; streaming would show text the validator has not passed — the #211 tension is a real product decision, and the honest answer under principle (c) is "no" until a design exists that streams only validated text (e.g. slot-filled prose, which the #162 experiment failed twice). | [#211](../open-questions.md) |
| A verdict on "klopt het dat …?" | The product's namesake and the editor persona's core moment — but a pipeline change (claim intent, registered claim-vs-actual derivations, prompt + fixture re-record, benchmark extension). Phase 1 roadmap item; worth its own design round, not a UX polish. | [#25](../open-questions.md), [06-roadmap.md](../06-roadmap.md) |
| Shareable answer pages / OpenGraph images | Phase 2 non-goal (needs public URLs + the correction policy). The embed (PR #9) is the in-scope share shape today. | [03-mvp-scope.md](../03-mvp-scope.md), [#9](../open-questions.md), [#22](../open-questions.md) |
| A "Jouw grafieken" gallery | Decided Phase 2 (a view over history, pinning = sorting). | [#159](../open-questions.md) |
| Alerts on new CBS releases / a publication radar | Phase 3 (scoop alerts); the admin radar [#161](../open-questions.md) is owner-facing. The "coming back" lever for journalists genuinely sits here — flagged, not pulled forward. | [06-roadmap.md](../06-roadmap.md) |
| Example-question chips back on the empty chat | Owner removed them in session 87; R4 proposes a collapsed disclosure instead and asks. | [12-huisstijl.md](../12-huisstijl.md) |
| PDF export, transparent PNG | Owner: "doesn't mean you need to work on it now". | [#215](../open-questions.md) |
| A "next CBS update expected …" line per answer | A cadence *promise*; the source-badge design explicitly refused promises ("never wekelijks bijgewerkt"). Only measured dates are shown. | [#170](../open-questions.md) |
| A subscription tier / free uploads for subscribers | Parked by the owner as its own item. | [#205](../open-questions.md) |
| Google Sheets / live sources | Explicitly out of scope. | [03-mvp-scope.md](../03-mvp-scope.md) |
| Product analytics beyond the counter | [#220](../open-questions.md) scoped analytics to one counter; R1 stays inside that decision by reading what already exists. A broader tool is a separate owner decision and a privacy-page item. | [#220](../open-questions.md) |
| Questions in other languages | L2/L3 of [#131](../open-questions.md): a per-language honesty cost, not a toggle. | [#131](../open-questions.md) |

## 6. Cost — plainly

| Item | LLM spend | Outside API | Database change | Library | Verdict |
|---|---|---|---|---|---|
| R1 usage report + apply 028 | none | none | **028 is an existing file-only migration; the report is read-only** | none | deterministic; owner applies 028 |
| R1 re-run the experience audit | **yes — real spend, owner-supervised** | none | none (writes audit rows like any question) | none | one-off measurement |
| R2 first-question/money bundle | none | none | none | none | web-only |
| R3 confirm-first fetch | none | none | none (ledger rows unchanged in shape) | none | **money path** — owner decision, PR + review |
| R4 coverage disclosure | none | none | none | none | registry read |
| R5 findability | none | none | none | none | copy + one tab default |
| R6 trust pages | none | none | none | none | content; owner/legal review |
| R7 one-click options | none | none | none | none | revises #75 for one kind |
| R8 composer chips | none | none | none | none | reverses two owner asks — ask |
| R9 phone pass + header | none | none | none | none | design pick |
| R10 credits page | none | none | none | none | copy from pricing tables |
| R11 honest waiting | none | none | none | none | one string |

In the owner's terms: **everything recommended is "least usage" — zero AI and zero API spend, no new backend
dependency, no new table; the only cost is build time**, with two owner-supervised exceptions (the audit
re-run's spend; the fetch confirmation on the money path).

## 7. Build sequence (cheapest and highest-value first, with rough sizes)

| Phase | What ships | Size | Gate / owner decision before it starts |
|---|---|---|---|
| **0 — know (owner + ½ day)** | Apply migration 028; build and run the usage report (R1); decide whether to re-run the July audit. | ½ day | items 1–2 |
| **1 — the first-question bundle** | R2 (captions, linked `/credits`, low-balance line, purchase poll) + R11 (honest waiting) + R10 (credits page copy). | ~1½ days | item 3 (caption wording) |
| **2 — the money-path decision** | R3, either the confirm-first chip (recommended) or the price-line stopgap. | ~1–2 days / ~1 hour | items 4–5 |
| **3 — orientation** | R4 (coverage disclosure) + R5 items 1–3 (Ontdek caption, Sjablonen default, the anonymous Insights line). | ~1½ days | items 6–7 |
| **4 — paperwork** | R6 (methodology + privacy pages, footer links). | ~1 day + owner review | item 9 |
| **5 — interaction and phone** | R7 (one-click options) + R8 (chips) + R9 (phone pass + header). | ~2 days | items 3, 10, 11 |
| **6 — re-measure** | Run the R1 report again; only then decide the next round (and the §5 items) on numbers. | — | — |

Why this order: phase 0 is what every later decision in this plan depends on and costs half a day; phase 1
fixes verified defects with no decision cost; phase 2 is the one item with real money-path risk and deserves
its own review; phases 3–5 are the orientation and polish that make the first five minutes work; phase 6 closes
the loop the CLAUDE.md "measured evidence" rule asks for. Owner present → direct push to `main` after the full
verification block; autonomous → branch + pull request ([#118](../open-questions.md)(b)); R3 always branch + PR.

## 8. Invariants and gotchas every item must hold (the checklist for build sessions)

- **Principle (a) by construction:** no item adds a prompt byte or an LLM call; the coverage list, the credits
  copy and the report are registry/pricing/ledger reads; the chip captions and the fetch offer are catalogue
  strings.
- **Principle (b):** the coverage disclosure reads *our* registry, never CBS; it shows measured sync dates,
  never cadence promises (the #170 badge rule).
- **Principle (c):** the waiting line states a fact ("this is taking longer"), never a fabricated stage; the
  purchase banner never claims the credit landed before the webhook did; the fetch offer names the real price
  from the pricing table.
- **The #68 rule:** the client never recomputes a cost or balance — the low-balance tint uses the server's live
  values; the purchase poll re-reads, it does not add.
- **Money path (R3):** the `heavy` debit must stay debit-before-run with full compensation on refusal/throw
  (ADR 026 decision 2, `gate.ts`); the take must re-run the finder-side guards (the [#166](../open-questions.md)
  already-curated guard, the [#174](../open-questions.md) trust-boundary lessons); a forged carrier can never
  fetch for free or charge twice (idempotent `requestId`).
- **Copy:** every new string in `messages.ts` in both languages, digit-free where it can sit inside a chart
  card; the pipeline's Dutch output untouched.
- **No dead links** (ADR 033 D6): footer links to the trust pages appear only when the pages exist.
- **The usage report prints aggregates only** — never question text, never an e-mail address, never a user id
  beside a question; it lives beside `gdpr-purge.ts` and follows its dry-run conventions.
- **Both themes, both languages, phone width** verified in a real browser before "done" (the session-92 and
  session-95 lessons: the hidden pane never hydrates charts; test at 375 px).

## 9. Decisions needed from the owner, in one list (plain full sentences)

1. May a session build the **usage report** over the existing tables (aggregates only, no personal data), and
   will you **apply migration 028** so the chart counter starts counting?
2. Do you want to **re-run the July experience audit** once (real LLM spend, a few euros — the exact amount is
   re-checked before starting) to measure how the first-question friction looks after everything that shipped
   since?
3. For a **clarifying question's options**, may a click **send the option straight away** (the price is already
   shown on the clarification), while follow-up chips under an answer keep filling the box first?
4. Should the product **ask before it fetches a new CBS table for 100 credits** (recommended: one chip "Haal
   op voor 100 credits"), or keep fetching automatically and only mention the 100-credit possibility in the
   price line under the input?
5. Should a **brand-new account's first fetch be cheaper**, or the free grant be larger than one fetch, so one
   unlucky first question cannot end the trial? (A config-table value either way; nothing here decides it.)
6. May the chat show a collapsed **"Wat kan ik vragen?"** link that opens the list of loaded topics with one
   example question each — or should that list live only on the landing/login page, leaving the bare composer
   exactly as you decided in September?
7. Should the Style panel **open on the Sjablonen tab** for a chart the reader has not tweaked yet (there is no
   counter data to decide it "on evidence"; it is a judgment call)?
8. Do you want a **fourth landing step, "Publiceer"**, and the Ontdek caption naming Opmaak · Inzichten ·
   Presenteren — now, or only together with the tagline work ([#7](../open-questions.md))?
9. Will you **review the privacy and methodology pages** (content is drafted from the docs; the privacy text
   should get a legal read) so the footer can finally link them?
10. May the four **inert composer chips** collapse into one "Eigen data (binnenkort)" chip until uploads are
    live — reversing your session-86 (demo link) and session-90 (sheet/database chips) requests?
11. On phones, do you prefer the **header** to move "Credits kopen" and "Geschiedenis" into the existing Account
    menu (cheapest), or a hamburger menu?
12. Do you agree that the bigger journey items — a verdict on "klopt het dat…?", shareable answer pages, the
    charts gallery, release alerts — **stay in their roadmap phases** and are re-judged after the report (item
    1) shows real numbers?

## 10. Assumptions (marked here; to be mirrored into open-questions as one new row when the owner reacts)

- **Assumption:** every friction point in §2 is inferred from the code and the July audit, not observed on a
  real journalist; R1 exists to replace inference with measurement.
- **Assumption:** the trial-to-signup join (a `trial_questions` row and a later `signup_grant`) can be counted
  without handling personal data (counts only, no e-mail, no visitor id in the output); verify at build time.
- **Assumption:** how often a first question would trigger the 100-credit fetch is unmeasured; the report's
  fetch counts settle whether R3 is urgent or merely correct.
- **Assumption:** the composer's six-chip row wraps into two or three rows at 375 px (not verified in a
  browser).
- **Assumption:** one registry example question per canonical measure exists or is trivial to add for R4; the
  meta template's example offer is the precedent.
- **Assumption:** a clarification option sent on one click is honest because its price is already on the
  clarification line — the same class of call as #75's original "user sees the cost first".
- **Assumption:** the re-run of the experience audit costs a few euros (the July run's recorded spend must be
  checked before starting; the finder re-records of session 54 cost far more than hoped, [#168](../open-questions.md)).
- **Assumption:** the low-balance tint on the price line satisfies the #69 owner decision's intent ("warn
  exactly when the balance still covers one more simple question but not two") in a different place.
- **Assumption:** the fetch-offer chip can ride the existing WP26 carrier without a new envelope kind; a build
  session may find the `pending` shape needs one more discriminant and should say so.

## 11. For a tighter follow-up pass: what to share

1. **Run the report (R1) once** and paste its output — it turns half of §2 from "as read" into "as measured".
2. **Ask three journalists** (Fleur- and Daan-shaped) to use the trial and the first five paid questions while
   you watch — the cheapest usability test there is, and the only kind that can contradict this document.
3. **The demo gallery** ([#208](../open-questions.md)) and your intended landing copy for the tagline
   ([#7](../open-questions.md)) — R5 item 4 and R6's methodology page should not be written twice.
4. Your answers to §9 — items 1, 4 and 6 unlock the most.
