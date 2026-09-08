# English/Dutch language switch — design (WP218 phase 4, open-questions #219)

**Status:** design written 2026-09-09 (session 91, autonomous) as the "own design round" the build plan requires before this phase; decisions below are the session's defaults under the owner's standing "document, don't escalate" rule — each has a stated rollback. The owner vetoes by exception.

**Owner decision (session 90, answer A on #218):** an English/Dutch switch in the top navigation for the whole web app; charts follow the app language; each chart also gets its own language dropdown, preselected to the app language. CBS's own words (measure titles, region names, units, the attribution sentence) come from a maintained word list — never machine translation (principles (a)/(c)). The Dutch CBS answer pipeline (intent parsing, phrasing, answer text, benchmark phrasing) is out of scope.

## 1. What is being translated (inventory, `.superpowers/sdd/i18n-string-inventory.md`)

- 38 files with translatable interface strings, ~565 distinct strings. Today the app is a MIX: the CBS chat core is Dutch, the attachments track (dataset chat, user chart, attachment chips, the thread-delete flow, the theme toggle, the dock header) is English.
- Out of scope, left byte-identical in both languages: everything the backend builds — answer text, refusals, clarification chips, attribution/definition/staleness lines, question history text, source names (`src/answer/*`, `src/billing/history.ts`, `src/sources/registry.ts`); the attachments backend's own English templates (`src/attachments/templates.ts`, ADR 037); the byte-pinned `FOOTER_ATTRIBUTION`.
- Chart text (`ChartSpec` strings) gets the word-list treatment in §4, not the catalogue.

## 2. Mechanism (cheapest first — no i18n library)

1. **Catalogue:** `web/lib/i18n/messages.ts` exports `MESSAGES: { nl: Messages; en: Messages }` where `Messages` is the type of the `nl` object (so a missing English key is a compile error). Keys are dotted by surface (`header.credits`, `chat.placeholder`, `chart.form.line`). Parameterised strings use `{name}` placeholders filled by a tiny `fill(template, vars)`. No pluralisation library: the two or three plural cases in the app get two keys (`history.one`, `history.many`).
2. **Where the choice lives:** a cookie `lang` (`nl` | `en`, one year, `SameSite=Lax`, path `/`, not `httpOnly` so the client can read it too). No database column: the choice must also work for the anonymous homepage and trial (owner G), and a cookie is the theme toggle's own class of mechanism. **Rollback:** delete the cookie handling; the app renders Dutch.
3. **First visit without a cookie:** `Accept-Language` decides — English when the browser prefers `en` over `nl`, otherwise Dutch. Rollback: default Dutch unconditionally.
4. **Server side:** `web/lib/i18n/server.ts` → `getLang()` reads `cookies()` (+ `headers()` for the first-visit rule). `app/layout.tsx` sets `<html lang={lang}>` and wraps the tree in `<LangProvider lang={lang}>`. Server components call `t(lang, key)` directly; client components use `useT()` from the provider. (Reading cookies in the root layout makes the layout dynamic — it already is: every page reads the Supabase session.)
5. **The switch:** a two-segment `NL | EN` control (`role="group"` + `aria-pressed`, the theme toggle's pattern) in `site-header.tsx` (workspace + stripped login variant) and in the landing page header, next to the theme toggle. Clicking calls the server action `setLanguage(lang)` which writes the cookie, then `router.refresh()` re-renders the tree in the new language. No full reload.
6. **Systeemoverzicht** (already bilingual, localStorage toggle): its toggle keeps working but its initial value follows the app language instead of `'en'`; its own `document.documentElement.lang` override is removed (the layout now owns `lang`).
7. **Dates:** `nl-NL`/`en-GB` for the two `Intl` call sites that format for display (question history, citation). The `en-CA` YYYY-MM-DD trick stays (not a language).

## 3. Test strategy

- The catalogue's **Dutch entries are today's Dutch strings verbatim**, so the ~28 test files that pin Dutch copy keep passing under the default language. Strings that are English today (attachments track, delete flow, theme toggle, dock header, session-expired fallback) become Dutch in `nl` — their pins are updated to the Dutch text (and the English text moves to `en`).
- Every migrated component gets one `en` render test: wrap in `<LangProvider lang="en">` and assert one or two English strings — proving the switch reaches that surface.
- One catalogue test: every `en` key exists (type-level) and no value in either language contains a digit unless the Dutch original did (the chart card's copy is covered by the whole-card digit scans).

## 4. Charts: the per-chart language and the CBS word list

- `ChartPresentation` gains `language: 'nl' | 'en' | null` (`null` = follow the app language) — it rides the existing override/resolver/account-default mechanism, so "my charts in English" can be saved as the account default. The panel's Grafiek tab gets a `Taal van de grafiek` select (`Zoals de app` / `Nederlands` / `English`) at the top; the chart card's own controls (Lijn/Staaf/Tabel, Vanaf/Tot, legend buttons, download menu, notes) read `t(chartLang, …)`.
- `web/lib/i18n/cbs-words.ts` — a maintained, hand-written word list + three deterministic converters, all returning the ORIGINAL Dutch when nothing matches (never a guess):
  - `translateUnit(unit)`: exact-match table (`aantal` → `number`, `x 1 000` stays, `%` stays, `euro` → `euros`, `personen` → `persons`, `per 1 000 inwoners` → `per 1,000 inhabitants` …).
  - `translatePeriodLabel(label)`: regex-based for the fixed CBS period shapes the registry produces (`2021` unchanged; `2021 1e kwartaal` → `2021 Q1`; `januari 2024` → `January 2024`; `2024*` unchanged) — the shapes are enumerated from `src/registry`'s period-label builder and each has a test.
  - `translateRegion(label)`: table for `Nederland` → `the Netherlands` and the twelve provinces where an English exonym exists (`Noord-Holland` → `North Holland`, `Zuid-Holland` → `South Holland`, `Friesland` stays, …); municipalities never change.
  - `translateMeasureTitle(title)`: exact-match table seeded from the Ontdek curated set (`src/chart/curated.ts`) and the benchmark's measures; anything else stays Dutch.
  - `translateAttributionLine(line)`: matches the ONE template `buildAttributionLine` produces (`Bron: CBS StatLine, tabel {id}, versie {n}, bijgewerkt op {date}. CC BY 4.0.` — read the exact template from `src/answer/compose/format.ts` first) and rewrites only its fixed words (`Source: CBS StatLine, table {id}, version {n}, updated on {date}. CC BY 4.0.`), keeping id/version/date byte-identical (test-pinned); no match → Dutch verbatim. The export bakes the same translated line (the download menu reads the displayed string), so the PNG says what the screen says.
- The R6 membership scans still pass by construction: every numeric token on an English chart is still a spec string (the converters never touch digits — test: for every converter, `input.match(/\d[\d.,]*/g)` deep-equals `output.match(...)`).
- `provisionalNote`, `nullNotes`, `definitionLine`, `trendHeadline`: backend prose, shown in Dutch on an English chart (the card's key `○ = provisional figure` is catalogue text; the note itself stays Dutch). Documented limitation; the word-list approach cannot honestly translate free prose.

## 5. Build order (plan `2026-09-09-wp218-phase-4-language-switch.md`)

1. Core: catalogue skeleton, cookie + `getLang`, provider/hook, `setLanguage` action, header switch, layout `lang`, landing switch, tests.
2. Sweep A — chat surfaces: `chat.tsx`, `thread-sidebar.tsx`, `workspace.tsx`, `visual-dock.tsx`, `dataset-chat.tsx`, `user-chart.tsx`, `feedback-buttons.tsx`, `answer-proof.tsx`.
3. Sweep B — pages: `landing.tsx`, `login/*`, `credits/*`, `geschiedenis`, `question-history.tsx`, `account-panel.tsx`, `dashboard.tsx`, `site-footer.tsx`, `delete-history-button.tsx`, `trial*`, `ontdek.tsx`, `source-badge.tsx`, `stat-card.tsx`, `onboarding-live-status.tsx`, `theme-toggle.tsx`, metadata titles.
4. Charts: `language` in the presentation model + panel select; chart-card copy through the catalogue (`chart.tsx`, `chart-download.tsx`, `chart-notes.tsx`, `chart-small-multiples.tsx`, `chart-toggle.tsx`, `chart-config-panel.tsx` → `PANEL_COPY` folds into the catalogue); the CBS word list + converters with their invariance tests.
5. Docs: ADR 040 (i18n mechanism), CLAUDE.md convention update (the switch now exists — "English for new UI" becomes "every interface string has both languages"), 12-huisstijl rule 6, #219 closed, README.

## 6. Alternatives set aside

- `next-intl` / `react-i18next`: a dependency and a routing convention (`/nl/…`, `/en/…`) for two languages and ~565 strings — the catalogue object is the cheapest viable mechanism (CLAUDE.md convention).
- URL-prefixed locales: would change every route and every deep link the RUNBOOK and emails carry; a cookie changes nothing outward.
- LLM translation of chart text or backend prose: refused on principle (a)/(c).
- Storing the language in the account: fails for the anonymous homepage/trial; a cookie covers both; the account default for CHART language rides the phase-2 row instead.
