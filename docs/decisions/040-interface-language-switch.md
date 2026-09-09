# ADR 040 — Interface language switch (English / Dutch) without an i18n library

**Status:** accepted, 2026-09-09 (session 91, autonomous, branch `wp218-chart-styling`) — WP218 phase 4 as built; design round in [superpowers/specs/2026-09-09-language-switch-design.md](../superpowers/specs/2026-09-09-language-switch-design.md).

## Context

Open-questions [#219](../open-questions.md): the owner decided (session 90, answer A on #218) that the whole web app gets an English/Dutch switch in the top navigation, that charts follow it, and that each chart also carries its own language choice preselected to the app language. Before this change the interface was a mix — the CBS chat core in Dutch, the attachments track and the newest chrome in English (the session-84 "English for new UI" convention). The inventory ([session-briefs/2026-09-09-session-91-i18n-string-inventory.md](../session-briefs/2026-09-09-session-91-i18n-string-inventory.md)) counted ~565 interface strings across 38 files, with ~28 test files pinning Dutch copy.

Two things are deliberately NOT interface text: everything the backend builds (answer prose, refusals, clarification chips, attribution/definition/staleness lines, question-history text, source names — `src/answer/*`, `src/billing/history.ts`, `src/sources/registry.ts`; and the attachments backend's own English templates, ADR 037), and CBS's own words on charts (measure titles, units, period labels, region names, the attribution sentence). Principles (a)/(c) forbid a translation step that could invent meaning.

## Decision

1. **A typed message catalogue, no library.** `web/lib/i18n/messages.ts` holds `MESSAGES = { nl, en }` with `Messages = typeof nl` and `en: Messages`, so a missing or stray English key fails `tsc`; a runtime test also checks key parity and that no value contains a digit unless its Dutch original does. Keys are dotted by surface; `{name}` placeholders are filled by `t(lang, key, vars)`. **The Dutch entries are the pre-existing strings verbatim**, so every Dutch test pin kept passing; strings that were English got a Dutch entry and moved to `en`.
2. **The choice lives in a cookie** `lang` (`nl` | `en`, one year, `SameSite=Lax`, path `/`, readable by the client), not in the account: it must work for the anonymous homepage and trial too (owner G), and it is the theme toggle's class of mechanism. First visit without a cookie: `Accept-Language` decides (English only when the browser ranks `en` above `nl`), else Dutch.
3. **Server and client halves.** `web/lib/i18n/server.ts`'s `getLang()` reads the cookie (and headers) in server components and in server actions that return user-facing text; `app/layout.tsx` sets `<html lang>` and wraps the tree in `LangProvider`; client components read `useLang()`/`useT()`. The `NL | EN` switch (`web/components/language-switch.tsx`, `role="group"` + `aria-pressed`) sits in the site header (both variants, so the landing and login pages have it too); a click writes the cookie through the `setLanguage` server action and refreshes the router — no full reload, no URL change.
4. **Charts.** `ChartPresentation.language: 'nl' | 'en' | null` rides the presentation mechanism of ADR [039](039-chart-presentation-panel.md) (`null` = follow the app; saveable as an account default); the chart card's own copy goes through the catalogue in the resolved chart language; CBS words go through `web/lib/i18n/cbs-words.ts` — hand-written tables for units, `Nederland`/the provinces with English exonyms, the curated measure titles, regexes for the registry's period-label shapes (`2021 1e kwartaal` → `2021 Q1`, `januari 2024` → `January 2024`, `2026 januari-april` → `2026 January-April`), and ONE regex over `buildAttributionLine`'s exact template that rewrites only its fixed words and keeps table id and date byte-identical. Every converter returns its input unchanged when nothing matches, and a test per converter proves the digit tokens of input and output are identical; the whole-card membership scans pass on an English chart. The export bakes the displayed attribution line. `provisionalNote`, `nullNotes`, `definitionLine` and `trendHeadline` stay Dutch on an English chart (backend prose).
5. **Kept Dutch on purpose:** the "Kopieer als citaat" text (it quotes a Dutch answer sentence, so its flags belong to that Dutch quote), the landing page's frozen demo answer, the source badge tooltip's backend text.

## Alternatives considered

- **`next-intl` / `react-i18next`** with URL-prefixed locales (`/nl/…`, `/en/…`) — a dependency plus a routing convention for two languages; every deep link in the RUNBOOK and in emails would change. The catalogue object is the cheapest viable mechanism (CLAUDE.md convention), and a cookie changes nothing outward.
- **Storing the language in the account** — fails for the anonymous homepage and trial; the cookie covers both, and the chart-language default rides the account row via ADR 039 instead.
- **LLM translation of chart words or backend prose** — refused on principle (a)/(c); a word list cannot invent meaning, a model can.

## Consequences

- The web app is bilingual in its interface; the CBS answer pipeline and its Dutch output are untouched (intent parsing, phrasing, benchmark phrasing).
- The "English for new UI" convention of session 84 is superseded: every new interface string gets an `nl` and an `en` entry.
- Reading cookies in the root layout keeps the layout dynamic — it already was (every page reads the Supabase session); `robots.txt` and `llms.txt` are unaffected.
- Known limitations recorded on [#219](../open-questions.md): backend Dutch prose on English surfaces; the definition toggle's label and the source badge follow the app language rather than a per-chart override; the citation stays Dutch.

## Revisit triggers

- A third language, or a request to translate answer prose — the latter is a pipeline decision (a second language pass through the validators), not an i18n change.
- The catalogue outgrowing one file (a few hundred keys is fine; thousands would want a split by surface).
