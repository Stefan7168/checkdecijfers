# Journey programme — build plan (phases 0, 1, 3, 4, 5; phase 2 = R3 deliberately NOT built)

Written 2026-09-12, session 97 (autonomous). Source of truth for scope: [08-build-plan.md § Journey programme](../../08-build-plan.md)
and [session-briefs/2026-09-11-experience-improvement-plan.md](../../session-briefs/2026-09-11-experience-improvement-plan.md).
Branch `journey-programme`, one PR for the owner (autonomous → branch + PR, #118(b)).

**Not built here, by rule:** R3 (confirm-first 100-credit fetch — the money path needs an explicit owner go); the
larger signup grant (decision 5, a config value the owner sets); the audit re-run (real LLM spend, supervised);
applying migration 028 (live DDL, owner step); positioning items (#237, owner in chat).

## Invariants (every task)

- No AI call, no new library, no schema change. Deterministic only.
- Every new interface string in `web/lib/i18n/messages.ts` in BOTH tables (`nl` and `en`); the `Messages` type makes a
  missing English key a compile error. Digit-free where a string can sit inside a chart card (the whole-card digit
  scan in `chart.test.tsx`). Product copy language: Dutch keys keep Dutch, English keys English.
- The client never recomputes a cost or balance (#68); it renders server-returned pricing values.
- No dead links (ADR 033 D6).
- Tests: vitest, colocated `*.test.tsx`. **One vitest process machine-wide** — before running any test, wait until
  `pgrep -f "[n]ode.*vitest"` returns nothing; run ONLY your own test files (`npx vitest run <file>` inside `web/`
  or the repo root), never the whole suite.
- Follow existing file-header comment conventions (WP/ADR references, why-not-what).

## Work packages (parallel worktrees; disjoint files except `messages.ts`, whose conflicts the orchestrator resolves)

### WP-A — usage report (phase 0, R1) — backend only
- New `scripts/usage-report.ts`, `npm run usage:report` (`node --env-file=.env scripts/usage-report.ts`, beside
  `gdpr:purge`). Read-only. Prints weekly aggregates (last 12 ISO weeks + all-time): signups (`credit_transactions`
  reason `signup_grant`); users with ≥1 question; first-question outcome mix (answer / clarification / refusal by
  reason) vs later questions (`audit_answers`, source_tag `user`); top refusal reasons; on-demand fetches
  started/delivered/failed + credit cost (`pending_table_requests` + ledger); trial questions and trial visitors who
  later signed up (counts only — if not joinable without personal data, print "not measurable" and say why);
  👍/👎 counts (`answer_feedback`); users active on ≥2 distinct days; users at zero balance who never purchased.
- **Aggregates only. Never question text, e-mail, or a user id in the output.** Inspect `migrations/*.sql` for real
  column names; put the SQL in `src/usage/report.ts` (pure functions taking the `Db`) so the aggregation is testable
  with the existing fake/pg-mem test conventions in `tests/` (look at `tests/audit`/`tests/billing` for the pattern);
  the script only prints.
- Optional `--json` flag. `--help`.

### WP-B — trust pages + landing copy (phase 4 R6, phase 3 R5.1 + R5.4) — `web/app/privacy`, `web/app/werkwijze`, `site-footer.tsx`, `landing.tsx`, `ontdek.tsx`
- Two Server Component pages with catalogue copy in both languages, drafted from the docs (`docs/04-architecture.md`
  GDPR section, `docs/03-mvp-scope.md`, `docs/05-data-rules.md`, `docs/decisions/033-*`, `web/app/systeemoverzicht`,
  `web/lib/llms-txt.ts`): `/werkwijze` ("Hoe we werken" / "How we work": the public-claim sentence — "every number
  traceable to an official CBS cell, with source and date shown", never "0% hallucination"; the three steps expanded;
  what "voorlopig" means; what a refusal means; what the claim does NOT cover — user-uploaded data, web results,
  other sources later) and `/privacy` (what is stored: questions + answers as an audit trail, account e-mail;
  2-year retention for account rows, 90 days for anonymous-trial rows; self-service deletion in the Account menu;
  questions transit an LLM provider (Anthropic) to be parsed and phrased — never the raw statistics; Stripe as
  payment processor; no analytics cookies, only the session cookie; contact = the owner's address placeholder
  `[contact e-mail — owner fills in]`). Mark both pages with a small "concept — wordt nog nagekeken" / "draft —
  under review" note key so the owner sees they are drafts (decision 9). Same shell as `/credits` (SiteHeader when
  the shell flag is on, else none); `robots` inherits noindex from layout.
- Footer: add "Werkwijze" and "Privacy" links (both languages) next to the existing about anchor; update the
  file-header comment that says the pages don't exist.
- Landing: (1) a caption under the Ontdek heading naming the three verbs: NL "Probeer het meteen: Opmaak (sjablonen),
  Inzichten, Presenteren — en download als PNG." EN equivalent; (2) a fourth how-it-works step "Publiceer" /
  "Publish": "Kies een sjabloon, download of embed — bron en datum reizen mee." (EN: "Pick a template, download or
  embed — source and date travel with it."). Keep the grid balanced at 4 (check the existing `sm:grid-cols-3` and make
  it 2×2 / 4).
- Tests: page renders both languages (pattern: `credits`/`systeemoverzicht` tests if any, else `landing.test.tsx`);
  footer test updated; landing test for the caption + fourth step.

### WP-C — credits page, purchase poll, phone header, panel default tab, anonymous Insights line
Files: `web/app/credits/page.tsx` (+ new client bit if needed), `web/components/workspace.tsx`,
`web/components/site-header.tsx`, `web/components/chart-config-panel.tsx`, `web/components/chart-story.tsx`.
- R10 `/credits`: per pack add "≈ N gewone vragen" and the € per question (both computed from the pack's own
  `priceCents`/`credits` and the live `simple` price the server reads — look at how `web/app/page.tsx` reads
  `simplePrice` + `signupGrantCredits`, and `account-panel.tsx` for the floor() convention); the sentence
  "Credits verlopen nooit. Geen abonnement." / "Credits never expire. No subscription."; the #76 explainer under the
  balance (reuse the `account.explainer*` keys). Numbers formatted the Dutch way where the code already has a helper;
  € via the existing formatting if any, else `Intl.NumberFormat('nl-NL', {style:'currency', currency:'EUR'})`.
- R2.4 purchase poll: on `?purchase=success` in the workspace, instead of "refresh the page", poll `router.refresh()`
  every ~3 s for a bounded ~30 s, hidden-tab aware — reuse the pattern in `onboarding-live-status.tsx` (extract a
  hook or copy the pattern; do not import that component). Banner copy → "Bedankt! Je saldo verschijnt hier zodra
  Stripe de betaling bevestigt." / EN. Same on the `/credits` success line.
- R9.2 phone header (#214): below `sm`, hide the "Credits kopen" and "Geschiedenis" links from the header row and
  show them as the first two items inside the existing Account menu (`sm:hidden` items in the menu, `hidden sm:inline`
  in the bar). Keep wordmark, balance badge, NL/EN visible at 375 px. No new component.
- R5.2: `chart-config-panel.tsx` opens on `templates` when the chart has no per-chart tweaks yet (find how the panel
  knows whether the current chart's presentation differs from the default/template — a prop or context; if nothing
  exists, open on `templates` when the per-chart override object is empty); once anything was changed, keep the
  current behaviour (last-used / `chart`). Update the ADR 043 decision-6 test expectations.
- R5.3: in `chart-story.tsx`, when the insights action returns `unauthenticated`, render one honest line
  "Log in voor AI-verwoorde inzichten." / "Log in for AI-phrased insights." with a link to `/login`. Digit-free.
- Tests for each.

### WP-D — chat bundle (phase 1 R2.1–R2.3, R11; phase 5 R7, R8) — `web/components/chat.tsx` (+ its tests, messages)
- R2.1 caption by kind: clarification → "Kies een optie:" / "Pick an option:"; refusal retry chip → "Probeer in plaats
  daarvan:" / "Try instead:"; answer keeps `chat.suggestionsHint`. Message kind is on the message object.
- R2.2: the insufficient-credits info message renders `/credits` as a real `<Link>` (a dedicated render branch keyed
  on the info kind, not string parsing), and names the smallest pack that covers the shortfall — the pack list must
  come from the server: check what `pricing`/props the chat already receives from `page.tsx`; if packs are not there,
  thread `packs` (id, label, credits) from `page.tsx` → `Workspace` → `Chat` (server read via `getActivePacks`).
- R2.3 low balance: when `pricing.balance < 2 × pricing.simple` and `≥ simple`, tint the pre-send price line amber
  (`text-warning`) and append " Genoeg voor nog één vraag." / " Enough for one more question." (the #69 rule).
- R11 honest waiting: after 8 real seconds of `busy`, one extra line under the skeleton: "Dit duurt iets langer dan
  gewoonlijk; we controleren het antwoord nog." / "This is taking a little longer than usual; we are still checking the
  answer." Timer cleared when busy ends. Test with fake timers.
- R7 one-click clarification options: when the message kind is `clarification` and its chips are server options, a
  click SENDS the option (bind the carrier exactly as the existing click handler does, then call the submit path with
  that label) instead of filling the input. Answer follow-ups and refusal retry chips keep fill-don't-send. The label
  sent must be byte-identical to the option. Update the comment block that documents #75.
- R8 chips: collapse "Link toevoegen", "Bestand uploaden", "Sheet koppelen", "Data koppelen" into ONE disabled chip
  "Eigen data (binnenkort)" / "Own data (coming soon)" with the same honest `title`, unless `attachments` is enabled —
  then only the live "Bestand uploaden" chip shows. The demo URL row stays reachable only via the old handler if
  `attachments` is off? No — remove it from the UI but keep the handler code path dead-simple to restore (leave a
  comment naming session 86). Keep "CBS data" + "Internet" chips untouched.
- Update `chat.test.tsx` expectations for each; add tests. Keep the file-header comments honest.

### WP-E — coverage disclosure (phase 3 R4) — after WP-D lands (touches chat.tsx)
- `web/components/coverage-disclosure.tsx`: a collapsed `<details>`-style affordance "Welke bronnen zijn ingebouwd?" /
  "Which sources are built in?" that opens a plain grouped list: CBS (today) — per served table its title, sync date
  ("gesynchroniseerd {date}", the measured date, never a cadence promise), its concepts; one click-to-fill example
  question per topic where the registry has one; a line "Andere CBS-onderwerpen halen we op verzoek op." / EN; then
  "Eurostat — binnenkort" / "coming" as a second group WITHOUT naming it as answering anything (principle c).
  Data: `buildCoverageReport` (`src/registry/coverage.ts`, cached via `web/lib/llms-txt.ts`'s cache or a sibling
  30-min cache) read in `page.tsx`, passed as a plain serialisable prop. Rendered: (1) as a small link under the chat
  input next to the price line and in the empty state (collapsed; the composer stays bare otherwise); (2) as a
  "Dit weten we nu" section on the landing above pricing.
- Example questions: check `src/answer/respond/refusals.ts` `exampleQuestionNl` and the meta template (ADR 022) for
  the per-measure example; reuse, do not invent. If a table has no example, show none.
- Tests: component renders both languages; landing section; chat link fills the input on example click.

## Verification (orchestrator, main checkout, after merge of all WPs)
`scripts/verify-block.sh` (typecheck ×2, backend suite, benchmark, web suite, next build) + `/code-review` LOW on the
diff + a real-browser pass at 1280 px and 375 px, light + dark, on the dev server (`scripts/dev-web.mjs`).
