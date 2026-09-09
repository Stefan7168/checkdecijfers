# i18n string inventory — web app (read-only Explore agent, 2026-09-09, session 91)

Scope: every non-test `.tsx`/`.ts` under `web/app` and `web/components` except `components/ui/*` — 52 files, 38 with translatable strings, ~565 distinct interface strings (≈222 under app/, ≈343 under components/), excluding backend-built content.

## Per file (strings ≈ distinct user-visible strings incl. aria-label/title/placeholder/metadata)

| File | Surface | Type | Strings | Language today | Examples |
|---|---|---|---|---|---|
| app/layout.tsx | HTML shell + metadata | Server | 3 | nl (`lang="nl"`) | "Check de Cijfers", "Chat met officiële CBS-cijfers…" |
| app/credits/actions.ts | Stripe checkout action errors | Server | 4 | nl | "Betalen is momenteel niet beschikbaar." |
| app/credits/buy-button.tsx | Kopen button | Client | 1 | nl | "Kopen" |
| app/credits/page.tsx | /credits | Server | 5 | nl | "Betaling geannuleerd." |
| app/geschiedenis/page.tsx | /geschiedenis | Server | 1 | nl | title |
| app/login/actions.ts | sign-in action errors | Server | 3 | nl | "E-mailadres is verplicht." |
| app/login/login-form.tsx | login form | Client | 7 | nl | "Stuur inloglink", "Doorgaan met Google" |
| app/login/page.tsx | /login | Server | 2 | nl | title |
| app/systeemoverzicht/page.tsx | system map shell | Server | 2 | en | "System map — Check de Cijfers" |
| app/systeemoverzicht/system-map-content.tsx | system map | Client | ~194 | bilingual already (`CONTENT` en/nl, localStorage toggle, default en) | — |
| app/llms.txt/route.ts | llms.txt | Server | 1 bilingual line | nl/en | — |
| components/account-panel.tsx | dashboard balance | Server | 5 | nl | "Saldo", "Credits kopen" |
| components/answer-proof.tsx | proof panel chrome | Client | 15 | nl | "Bewijs dit cijfer", "Technische details" |
| components/chart-config-panel.tsx | Opmaak panel | Client | ~60 | bilingual already (`PANEL_COPY` nl/en, `lang` prop) | — |
| components/chart-download.tsx | download menu | Client | 5 | nl | "Download als PNG" |
| components/chart-notes.tsx | notes | Client | 6 | nl | "Uw aantekeningen (geen CBS-data)" |
| components/chart-small-multiples.tsx | small multiples | Client | 1 | nl | aria "Kleine grafieken per reeks" |
| components/chart-toggle.tsx | definition toggle | Client | 1 | nl | aria "Definitie wisselen" |
| components/chart.tsx | chart card | Client | ~25 | nl | "Lijn/Staaf/Tabel", "Vanaf/Tot", "Weergave", "Reeksen", keyboard hint, "○ = voorlopig cijfer", "van … reeksen verborgen" |
| components/chat.tsx | CBS chat | Client | ~28 | MIXED | nl chrome ("Stel een vraag…", "Kopieer als citaat"); en chips ("Add link", "Upload file", "Link with sheet", "Connect database", "This isn't available yet — coming soon.") |
| components/dashboard.tsx | legacy dashboard | Client | 3 | nl | "Betaling gelukt…" |
| components/dataset-chat.tsx | dataset chat | Client | ~15 | en | "Ask about your data…", "Send" |
| components/delete-history-button.tsx | GDPR delete | Client | 5 | nl | "Verwijder mijn vraaggeschiedenis" |
| components/feedback-buttons.tsx | 👍/👎 | Client | 7 | nl | "Nuttig antwoord" |
| components/landing.tsx | homepage | Server | 14 | nl | hero, "Hoe het werkt" |
| components/onboarding-live-status.tsx | live CBS request line | Client | 2 | nl | — |
| components/ontdek.tsx | discovery charts | Server | 2 | nl | "Ontdek Nederland in grafieken" |
| components/question-history.tsx | history list | Server | 12 | nl | "Eerdere vragen" |
| components/site-footer.tsx | footer | Client | 3 | nl | `FOOTER_ATTRIBUTION` (byte-pinned), "Over dit project" |
| components/site-header.tsx | top nav | Client | 6 | nl | "Credits kopen", "Geschiedenis", "Log uit" |
| components/source-badge.tsx | source pill | Server | 2 | nl | "gesynchroniseerd" |
| components/stat-card.tsx | stat card | Client | 3 | nl | "voorlopig", "Download als afbeelding" |
| components/system-map-diagram.tsx | system map svg | Server | ~80 | bilingual already (`TEXT` en/nl) | — |
| components/theme-toggle.tsx | theme switch | Client | 4 | en | "Light theme" |
| components/thread-sidebar.tsx | thread list | Client | 18 | MIXED | nl ("Nieuwe chat"); en ("Search chats", "Delete this chat? …", "Cancel") |
| components/trial-chat.tsx / trial.tsx / lib/trial-copy.ts | trial | mixed | 8 + `TRIAL_COPY` | nl | "Probeer het direct" |
| components/user-chart.tsx | user-data chart | Client | 5 | en | keyboard hint, provenance footer |
| components/visual-dock.tsx | dock | Client | 3 | MIXED | "Charts" header vs "Visualisaties" aria |
| components/workspace.tsx | shell | Client | 5 | nl + 1 en fallback | "Your session has expired. Please refresh the page." |

## Test pinning (assertions on literal copy)

chat.test.tsx 223 · chat-workspace.test.tsx 44 · chart.test.tsx 152 · question-history.test.tsx 53 · workspace.test.tsx 44 · answer-proof.test.tsx 40 · chart-config-panel.test.tsx 35 · dashboard.test.tsx 33 · thread-sidebar.test.tsx 30 · chart-download.test.tsx 23 · dataset-chat.test.tsx 22 · feedback-buttons 19 · stat-card 19 · chart-toggle 18 · login-form 17 · account-panel 13 · trial-chat 13 · delete-history-button 12 · visual-dock 10 · user-chart 10 · chart-notes 9 · ontdek 9 · trial 7 · chart-small-multiples 5 · login/page 3 · dormancy 2 · onboarding-live-status 2 · source-badge 2 · site-footer 1 (byte-pin). No tests: site-header, theme-toggle, landing, system-map-*, credits pages, geschiedenis page.

## Backend-built text rendered verbatim (OUT of scope for the interface catalogue)

- `src/answer/compose/*` (Dutch): answer body, attribution line, definition line, staleness/provisional notes, refusal/clarification text → chat.tsx, trial-chat.tsx; via `web/lib/answer-proof.ts` → answer-proof.tsx; via `web/lib/citation.ts` (Kopieer als citaat) and `web/lib/csv.ts` (CSV preamble); via `web/lib/stat-card-data.ts` → stat-card.tsx.
- `src/chart` ChartSpec strings: title, unit, series labels, periodLabel, formattedValue, provisionalNote, nullNotes, definitionLine, attributionLine → chart.tsx, chart-toggle, chart-small-multiples, ontdek.
- `src/billing/history.ts` finalText/answerParts → question-history.tsx.
- `src/sources/registry.ts` displayName/attributionLabel → source-badge, chat chips.
- `src/attachments/templates.ts`/`types.ts` (ENGLISH domain): dataset refusals, `USER_DATA_BADGE`, `USER_DATA_DISCLAIMER` → dataset-chat.tsx, user-chart.tsx, chat.tsx upload error.

## Existing plumbing

- `<html lang="nl">` hardcoded in app/layout.tsx; system-map-content overrides `document.documentElement.lang` while mounted.
- `nl-NL` Intl in question-history.tsx:133 and lib/citation.ts:19; `en-CA` used only as a YYYY-MM-DD trick (not a language choice).
- Bilingual objects to reuse as precedent: chart-config-panel `PANEL_COPY`, system-map-content `CONTENT` + `LangToggle` (localStorage `systeemoverzicht-lang`), system-map-diagram `TEXT`.
- No locale cookie anywhere; proxy.ts / supabase-server.ts only handle Supabase session cookies.
- app/page.tsx: `currentUserId()` null → Landing; else WORKSPACE_ENABLED → Workspace, else Dashboard. No language decision today.
