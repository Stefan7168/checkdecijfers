# Eurostat public-claim sweep — DRAFT for owner sign-off (ADR 048 D3(d), #357 step 5)

> **SIGNED by the owner 2026-10-04 (session 154, in chat, four questions):** (1) the general wording, items 1–9 and
> 11–13, **signed as proposed**; (2) item 10, the source chips: **Eurostat gets its OWN chip** (not riding with CBS) — a
> reader can pick CBS only, Eurostat only, or both; the table search follows the selection; (3) model prompts: **change
> them and re-record** (owner chose this over the session's "leave them, no spend" recommendation; ~$5 approved);
> (4) **GO** for the flag flip `EUROSTAT_FINDER_ENABLED=1` in Production together with the wording, then a live check of
> real Dutch Eurostat questions against Eurostat's own site (~2 cents each), switching off again if any number is wrong.

Session 153, 2026-10-02. **Nothing here is applied (as of the draft; see the signed block above).** ADR 048 D3(d) says the public wording changes from
"official CBS" to "official sources" **in the same change** that switches the first Eurostat answers on, owner-signed —
never before. This page is the list to sign, with a proposed wording per item, so that change can be made in one go.

## Already done (no sign-off needed — they follow the table, CBS wording byte-identical)

Built 2026-10-02 (dark until the Eurostat finder is switched on): the answer's source line, the table-lane refusals
("Eurostat-tabel"), the table-lane waiting bubble ("Gevonden: Eurostat-tabel …", "Cijfers ophalen bij Eurostat…"),
the derived-data marking ("bewerking van Eurostat-gegevens door graphmaker.studio", NL + EN, CSV, citation, proof
panel), the staleness note ("bijgewerkt door Eurostat", NL + EN), the not-published / outside-slice / quarantine /
"status definitief" refusals, the proof panel's link title and missing-value note, the chart card's tagline, the
"no line" reason on a gapped chart (now neutral: "Deze tabel meet niet elke periode").

## To sign — general claims (become incomplete once Eurostat answers)

| # | Where | Today (short) | Proposed |
|---|---|---|---|
| 1 | Public claim (CLAUDE.md, werkwijze `publicClaim`, share card neutral tagline) | "Elk getal herleidbaar tot een officiële CBS-tabel" | "Elk getal herleidbaar tot een officiële tabel van CBS of Eurostat, met bron en datum" |
| 2 | Meta description, trial subheading, landing steps 2–3, hero subtitle/claim, gallery intro | "officiële CBS-cijfers" | "officiële cijfers van CBS en Eurostat" |
| 3 | Footer attribution (site-wide) | CBS licence line | CBS line + "Europese cijfers: © Europese Unie, Eurostat (CC BY 4.0)" (the `/eurostat-explorer` line already exists) |
| 4 | Werkwijze steps 1–3, provisional body, "notCoveredBody" ("andere bronnen … in de toekomst") | CBS-only | name both; drop "in de toekomst" |
| 5 | About intro, privacy LLM body | CBS-only | name both |
| 6 | Coverage disclosure (`coverage-disclosure.tsx`) | one hard-coded "CBS" heading over every row | group rows by their own `sourceDisplayName` (the rows already carry it) |
| 7 | Meta answers (`src/answer/respond/meta.ts`: sources template "andere bronnen gebruik ik niet", traceability, peildatum, capabilities, example chips) | CBS-only | "officiële cijfers van CBS (Nederland) en Eurostat (Europa)"; the sources template must stop saying "andere bronnen gebruik ik niet" |
| 8 | Scope + smalltalk refusals (`refusals.ts`) and the intent-policy refusals without a table ("officiële CBS-cijfers", "geen CBS-cijfers") | CBS-only | "officiële cijfers (CBS en Eurostat)" |
| 9 | Forecast / causal refusals ("CBS publiceert gerealiseerde cijfers") | CBS | "Het CBS en Eurostat publiceren gerealiseerde cijfers …" |
| 10 | Source chips: "Je hebt CBS-data uitgeschakeld" + `sourceSelectionRefusal` checks only the CBS key | CBS-only | needs a decision: does Eurostat get its own chip, or ride with CBS? (behaviour, not just text) |
| 11 | `/llms.txt` intro + "Bron en licentie" block | CBS-only | name both, add Eurostat licence line |
| 12 | `/systeemoverzicht` (hand-written NL + EN constants, the "CBS StatLine: the only source that matters" card, the diagram) | CBS-only | add Eurostat as a second source card |
| 13 | Chart notes / goal line / era shading "(geen CBS-data)", embed "wanneer het CBS de cijfers corrigeert" | CBS | "(geen officiële data)", "wanneer de bron de cijfers corrigeert" |

## To sign — model prompts (owner-supervised re-record, real spend)

These prompts say CBS; changing them shifts every recorded fixture's hash, so each needs a supervised re-record:
`src/answer/intent/prompt.ts`, `src/answer/table-parse/parse.ts` (system prompt: "checkdecijfers.nl … officiële
CBS-cijfers … ÉÉN CBS-tabel"), `src/catalog/rerank-prompt.ts`, `src/catalog/search-terms.ts` (Dutch prompt; the English
Eurostat variant is separate), `src/ingestion/onboarding-fit.ts`, `src/attachments/*/prompt.ts`. Measured today: the
table reader reads Eurostat correctly WITHOUT changing its CBS wording (benchmark answers 6/6, 0 invented), so the
prompt change is cosmetic for the model — **recommendation: change only the table-reader and rerank prompts, together
with the flag flip, and re-record both sets (CBS + Eurostat) in one supervised run.**

## Stays CBS (checked)

The `/netherlands-cbs-data` SEO page, the CBS on-demand onboarding texts and e-mails, region-class / whole-checking
features (CBS regions only), the new-CBS-data alert e-mail, registry notes.
