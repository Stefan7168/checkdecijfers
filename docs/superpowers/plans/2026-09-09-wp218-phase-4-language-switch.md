# WP218 Phase 4 — English/Dutch Language Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `NL | EN` switch in the top navigation that renders every interface string of the web app in the chosen language, with charts following it and each chart carrying its own language choice; CBS's own words come from a maintained word list.

**Architecture:** see the design `docs/superpowers/specs/2026-09-09-language-switch-design.md` (read it first — it is binding): a typed message catalogue (`web/lib/i18n/messages.ts`), a `lang` cookie read server-side (`getLang()`), a `LangProvider`/`useT()` for client components, a `setLanguage` server action + `router.refresh()`, and a deterministic CBS word list for chart text. No i18n library. The inventory of strings and test pins is `.superpowers/sdd/i18n-string-inventory.md`.

**Tech Stack:** Next.js 16 App Router (`cookies()`, `headers()`, server actions), React 19 context, Vitest.

## Global Constraints

- **Backend-built text is never translated** (design §1): answer text, refusals, clarification chips, attribution/definition/staleness lines, question-history text, source names, the attachments backend's English templates, `FOOTER_ATTRIBUTION`. Chart spec strings go through the word-list converters of Task 8 only.
- **The Dutch catalogue entries are today's Dutch strings verbatim** — existing Dutch test pins keep passing under the default language; strings that are English today move to `en` and get a Dutch `nl` entry, and their pins are updated to Dutch. Every migrated component gets one `en` render test.
- **Type safety:** `Messages` is `typeof MESSAGES.nl`; `MESSAGES.en: Messages` — a missing English key fails `tsc`. Keys dotted by surface. Placeholders `{name}` via `fill()`.
- **No digits in chart-card copy** (whole-card scans); the catalogue test asserts no value contains a digit unless its Dutch original did.
- **Default language:** cookie → `Accept-Language` (en preferred over nl → `en`) → `nl`. Cookie `lang`, one year, `SameSite=Lax`, path `/`, not httpOnly.
- **`<html lang>` follows the choice**; systeemoverzicht's own `documentElement.lang` override is removed.
- Copy quality: plain, calm English (house rule 6); Dutch untouched. Web suite green after every task; typecheck clean. Commit only on `wp218-chart-styling`, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Core — catalogue, cookie, provider, action, switch

**Files:** create `web/lib/i18n/messages.ts`, `web/lib/i18n/messages.test.ts`, `web/lib/i18n/server.ts`, `web/lib/i18n/server.test.ts`, `web/lib/i18n/lang-provider.tsx`, `web/lib/i18n/lang-provider.test.tsx`, `web/app/lang-actions.ts`, `web/app/lang-actions.test.ts`, `web/components/language-switch.tsx`, `web/components/language-switch.test.tsx`; modify `web/app/layout.tsx`, `web/components/site-header.tsx`, `web/components/landing.tsx` (header area only), `web/app/systeemoverzicht/system-map-content.tsx` (initial lang + drop the `documentElement.lang` override).

```ts
// messages.ts
export type Lang = 'nl' | 'en';
export const LANGS: readonly Lang[] = ['nl', 'en'];
export const MESSAGES = { nl: { /* keys added task by task */ }, en: { /* … */ } } as const satisfies Record<Lang, Record<string, string>>;
export type Messages = typeof MESSAGES.nl;            // en must have the same keys (enforced: `en: Messages`)
export type MessageKey = keyof Messages;
export function t(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string; // fill '{name}' placeholders; unknown lang → nl
export function isLang(x: unknown): x is Lang;
// server.ts (server-only; imports next/headers)
export const LANG_COOKIE = 'lang';
export async function getLang(): Promise<Lang>;       // cookie → Accept-Language → 'nl'
export function langFromAcceptLanguage(header: string | null): Lang; // pure; tested
// lang-provider.tsx ('use client')
export function LangProvider({ lang, children }): JSX.Element;
export function useLang(): Lang;                        // no provider → 'nl'
export function useT(): (key: MessageKey, vars?) => string;
// lang-actions.ts ('use server')
export async function setLanguage(raw: unknown): Promise<void>; // isLang guard; cookies().set(LANG_COOKIE, lang, { maxAge: 31536000, sameSite: 'lax', path: '/' })
// language-switch.tsx ('use client')
export function LanguageSwitch({ className }): JSX.Element; // role="group" aria-label={t('lang.switchLabel')}; two buttons 'NL' / 'EN' with aria-pressed; onClick → await setLanguage(next); router.refresh()
```

Start the catalogue with the strings Task 1 itself needs (`lang.switchLabel`, the header's `header.credits`, `header.history`, `header.account`, `header.logout`, `header.busy`, `header.balance` `{n} credits`, the landing header's) and migrate `site-header.tsx` fully. Layout: `const lang = await getLang();` → `<html lang={lang}>` → `<LangProvider lang={lang}>` around the existing `ThemeProvider` children. Tests: `t` fills placeholders and falls back to nl; `langFromAcceptLanguage('en-US,en;q=0.9,nl;q=0.8')` → `en`, `'nl-NL,nl;q=0.9,en;q=0.8'` → `nl`, `null` → `nl`, `'fr'` → `nl`; provider default; the switch renders with `aria-pressed` on the current language and calls the (mocked) action + `refresh`; the header renders English under `<LangProvider lang="en">`.

Commit `feat(i18n): message catalogue, lang cookie, provider, NL|EN switch in the header (WP218 phase 4, #219)`.

---

### Task 2: Sweep A — chat surfaces

**Files:** `web/components/chat.tsx`, `thread-sidebar.tsx`, `workspace.tsx`, `visual-dock.tsx`, `dataset-chat.tsx`, `user-chart.tsx`, `feedback-buttons.tsx`, `answer-proof.tsx` (+ their tests, `chat-workspace.test.tsx`, `answer-proof-replay.test.tsx`), `web/lib/i18n/messages.ts`.

Rules: every literal user-visible string (JSX text, `aria-label`, `title`, `placeholder`, status/toast text, `alt`) becomes `t('…')`; the English chips/flows of the attachments track get Dutch `nl` entries (`Add link` → `Link toevoegen`, `Upload file` → `Bestand uploaden`, `Link with sheet` → `Koppel een spreadsheet`, `Connect database` → `Database koppelen`, `Search chats` → `Zoek in chats`, `Chat options` → `Chatopties`, `Delete chat` → `Chat verwijderen`, the delete confirmation, `Cancel` → `Annuleren`, `Send` → `Verstuur`, `Working on it…` → `Bezig…`, dataset-chat's placeholder and credit line, user-chart's keyboard hint and provenance footer, `Charts` → `Grafieken`, the session-expired fallback). Update the pinned tests to the Dutch text; add one `en` test per component. Keep the owner-mandated busy-text honesty distinction in chat.tsx byte-identical in Dutch.

Commit `feat(i18n): chat, sidebar, workspace, dock, dataset chat, proof panel through the catalogue (WP218 phase 4)`.

---

### Task 3: Sweep B — pages and shell

**Files:** `landing.tsx`, `login/login-form.tsx`, `login/page.tsx`, `login/actions.ts`, `credits/page.tsx`, `credits/buy-button.tsx`, `credits/actions.ts`, `geschiedenis/page.tsx`, `question-history.tsx`, `account-panel.tsx`, `dashboard.tsx`, `site-footer.tsx` (everything except the byte-pinned `FOOTER_ATTRIBUTION`), `delete-history-button.tsx`, `trial.tsx`, `trial-chat.tsx`, `lib/trial-copy.ts`, `ontdek.tsx`, `source-badge.tsx`, `stat-card.tsx`, `onboarding-live-status.tsx`, `theme-toggle.tsx`, page `metadata` titles (`generateMetadata` reading `getLang()`), `layout.tsx` metadata (+ tests).

Server components take `lang` from `await getLang()` and call `t(lang, …)`; server actions that return user-facing error strings (`login/actions.ts`, `credits/actions.ts`) return a message KEY (or a `{ key }`) and the client renders `t(key)` — a server action cannot know the client's provider, so read `getLang()` inside the action instead and return the translated string. `Intl` date formatting: `nl-NL` / `en-GB` by lang.

Commit `feat(i18n): landing, login, credits, history, account, trial, footer, theme toggle through the catalogue (WP218 phase 4)`.

---

### Task 4: Charts — per-chart language, card copy, word list

**Files:** `web/lib/chart-presentation.ts` (+ test): `language: 'nl' | 'en' | null` on `ChartPresentation` (`STOCK_PRESENTATION.language = null`, sanitizer enum, always applicable); `web/lib/i18n/cbs-words.ts` + `cbs-words.test.ts` (design §4: `translateUnit`, `translatePeriodLabel`, `translateRegion`, `translateMeasureTitle`, `translateAttributionLine`, each returning the input unchanged when nothing matches; read `src/answer/compose/format.ts`'s `buildAttributionLine` template and `src/registry`'s period-label shapes BEFORE writing the regexes; the digit-invariance test for every converter); `chart.tsx`, `chart-download.tsx`, `chart-notes.tsx`, `chart-small-multiples.tsx`, `chart-toggle.tsx`, `chart-config-panel.tsx` (fold `PANEL_COPY` into the catalogue under `chart.panel.*`; the `lang` prop becomes the resolved chart language) + tests.

In `ChartView`: `const chartLang = pres.language ?? useLang();` → all card copy via `t(chartLang, …)`; the title/unit/series labels/period labels/attribution line pass through the converters when `chartLang === 'en'`; the download menu receives the DISPLAYED attribution line (so the export matches the screen). The panel's Grafiek tab gets the `Taal van de grafiek` select (`Zoals de app` / `Nederlands` / `English`) emitting `{ language: null | 'nl' | 'en' }`. Tests: an English chart shows `Line / Bar / Table`, `From / To`, `Source: CBS StatLine, table 12345NED, …` with the id/version/date byte-identical, `the Netherlands`, `2021 Q1`; the membership scans pass on an English chart; the export markup carries the English attribution line; the per-chart select overrides the app language and is saveable as the account default (`withAccountDefault({ language: 'en' })`).

Commit `feat(i18n): charts follow the app language with a per-chart choice; CBS word list, never machine translation (WP218 phase 4)`.

---

### Task 5: Docs

`docs/decisions/040-interface-language-switch.md` (context #219, decision = the design's §2/§4, alternatives §6, consequences incl. the untranslated-backend-prose limitation, revisit triggers: a third language, a request to translate answer prose → that is a pipeline decision, not i18n); CLAUDE.md Conventions (the s84 "English for new UI" sentence → "every interface string has an nl and an en entry; the Dutch CBS pipeline output stays Dutch"); `docs/12-huisstijl.md` rule 6; `docs/open-questions.md` #219 closed + #218 note; `docs/08-build-plan.md` phase 4 ✅; `README.md` one line (the app is bilingual NL/EN in the interface); `docs/04-architecture.md` row.

Commit `docs(i18n): ADR 040 language switch; conventions updated (WP218 phase 4, #219)`.

## Self-review

Owner A ✔ (T1 switch, T4 chart follow + per-chart select, word list); backend prose untouched ✔ (constraints); tests keep passing by design ✔ (Dutch verbatim); digit-free ✔ (catalogue test + scans); docs ✔ (T5).
