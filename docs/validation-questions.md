# Validation question set — 20 questions for the post-Phase-0 validation pass

**What this is:** a fixed set of 20 example questions (owner-authored, 2026-07-04) across 10 categories, to be run against the **live** chat UI (https://checkdecijfers.vercel.app) or a local production build as a **validation pass before Phase 1 building begins**. This is distinct from the 20-task frozen *benchmark* ([02-user-scenarios.md](02-user-scenarios.md), scored in CI) — that one gates correctness on a known-good set; **this** one deliberately probes beyond the loaded slice, into ambiguous/out-of-scope territory and conversational patterns, to surface *architectural decisions* for Phase 1.

**How to run (next session):**
- Ask each question, one at a time. Each is a real LLM call against the €25/mo Anthropic cap — ~€0.20–0.40 for the whole set (WP11 measured ~€0.19 for 20 tasks). Be deliberate; no bulk retries. A **local production build still hits the live DB + LLM (same cost)** — the only difference from using the deployed instance is that it doesn't touch production; either is fine.
- For each, record: **(a)** answer / clarify / refuse; **(b)** was that outcome *correct and honest* — right table/period/region, **zero fabricated numbers**, honest refusal where genuinely out of scope; **(c)** the architectural gap or Phase-1 decision it surfaces.
- Produce a short **architecture-decision memo** at the end feeding Phase 1 planning. Do not change code without owner go.

**Predicted outcomes below** are this-session estimates (Opus 4.8, 2026-07-04) from the known architecture — recorded so the next session *confirms* rather than rediscovers, and can flag any surprise (a predicted-answer that refuses, or vice-versa, is a finding). Convention note: questions stay in the owner's Dutch (benchmark/product phrasing is allowed in Dutch per [CLAUDE.md](../CLAUDE.md)); analysis is in English.

**Loaded Phase 0 data (context for predictions):** 8 CBS tables only — population, inflation/CPI, unemployment, housing stock, house price, bankruptcies, solar electricity, disposable income. Single source (CBS). No document/policy layer. No multi-turn conversation memory (only the one-round clarification, ADR [015](decisions/015-refusal-clarification-composition.md)). One-measure / one-varying-axis query contract ([open-questions #38](open-questions.md)).

---

## 1. Basisvragen over CBS-data
*Owner's intent: does the chain "intent → right table → filters → chart → explanation" work on simple cases? Right StatLine tables? Correct periods/units/labels? Sensible chart choice?*

1. "Hoe ontwikkelt de werkloosheid zich in Nederland sinds 2015?"
2. "Wat is de huidige inflatie in Nederland vergeleken met vijf jaar geleden?"
3. "Hoeveel inwoners telt Nederland op dit moment?"
4. "Wat is het gemiddelde inkomen per huishouden in Nederland?"

**Predicted:** all four should **answer** (topics loaded, national scope). Q1 series→line, Q2 comparison, Q3 single value (B1-like), Q4 single value. *Watch:* Q4 depends on the exact disposable-income measure loaded matching "gemiddeld inkomen per huishouden"; Q2's "vijf jaar geleden" relative period resolves against the Europe/Amsterdam reference date (fixed this session).

## 2. Regio- en tijdspecifieke vragen
*Owner's intent: do municipality/province filters and period selection work? Does the query stay under the 10k-cell limit? Are region labels matched to CBS codes?*

5. "Hoe is de bevolking van Amsterdam veranderd tussen 2010 en 2020?"
6. "Wat is de werkloosheid in Noord-Brabant per jaar sinds 2015?"
7. "Hoeveel bijstandsontvangers zijn er in Rotterdam in 2023?"
8. "Hoe verschilt de woningvoorraad tussen Utrecht, Groningen en Limburg in 2022?"

**Predicted:** Q7 **refuses** — bijstand is not a loaded table (confirmed repeatedly this session; it clarifies/refuses). Q5/Q6/Q8 are the **highest-value unknowns**: they *should* answer, but whether they do depends on **what region granularity was actually ingested per table** (the frozen benchmark only exercised national + a fixed G4/subset). Q8 is a multi-region comparison (3 provinces at one period = one varying axis, allowed by the contract → bar chart) — good test of both region mapping and the comparison path. **If Q5/Q6/Q8 refuse "outside loaded slice", that's the key Phase-1 signal: regional coverage needs expanding.**

## 3. Thema-gestuurde vragen
*Owner's intent: does intent → right theme-set work? Are multiple sources combined, or does the system honestly say it has only one? Clear definitions?*

9. "Wat is de impact van migratie op de woningmarkt in Nederland?"
10. "Hoeveel mensen met migratieachtergrond ontvangen bijstand per jaar?"
11. "Wat zijn de cijfers over veiligheid en criminaliteit naar herkomstgroepering?"
12. "Hoe ontwikkelen de uitgaven aan onderwijs zich in de Rijksbegroting?"

**Predicted:** all four **refuse honestly**. Q9 is causal + migration-not-loaded; Q10 bijstand + migration not loaded; Q11 not loaded; Q12 Rijksbegroting is not a CBS source (single-source limit). This whole category tests *honest refusal under single-source* — should all pass; low surprise risk.

## 4. Vergelijkingsvragen
*Owner's intent: can it place multiple datasets/regions side by side? How does it handle "Randstad" (composite)? Are "jeugd"/"bijstand" definitions explained?*

13. "Vergelijk de jeugdwerkloosheid in Amsterdam en Den Haag in de afgelopen vijf jaar."
14. "Welke provincie heeft de hoogste gemiddelde woningprijs, en hoe is dat veranderd sinds 2010?"
15. "Zijn de bijstandscijfers hoger in de Randstad dan in de rest van Nederland?"
16. "Vergelijk de bevolkingsgroei van Nederland met een andere EU-lidstaat."

**Predicted:** Q13 exceeds the one-varying-axis contract (2 regions × time × "jeugd" age subgroup) — likely **refuses or clarifies**; also tests whether a "jeugd" age dimension exists in the loaded unemployment table. Q14 is compound (max across regions *and* a time series) — may refuse compound or partially answer. Q15 **refuses** (bijstand not loaded; also "Randstad"/"rest van NL" are composite regions, not CBS codes). Q16 **refuses** (no EU/other-country data — CBS NL only). *Signals:* composite-region support and multi-axis/compound queries are real contract limits — note if these phrasings are common.

## 5. Fout- en edge cases (bewust vaag of verkeerd)
*Owner's intent: how robust are intent-detection, validation, error messages?*

17. "Laat me alle CBS-data zien over alles in Nederland." *(too broad)*
18. "Geef mij alle cijfers over 'geluk'." *(no direct CBS indicator)*
19. "Toon migratiecijfers voor de gemeente 'Gotham City' in 2022." *(non-existent municipality)*
20. "Hoeveel inwoners heeft Nederland in 2050 volgens CBS?" *(future / forecast)*
21. "Wat is de werkloosheid per dag in 2023?" *(CBS doesn't publish daily)*

**Predicted (this is the most valuable category to actually run — a wrong outcome here is a *bug*, not a design limit):** Q17 too-broad → refuse/clarify; Q18 no "geluk" indicator → refuse (scope); Q19 **region-resolution failure** (Gotham City not a CBS code) → should refuse with a clear "unknown region" message — *watch for a fabricated or silently-wrong region match*; Q20 **forecast refusal** (B18-like) → should refuse, offering realized/historical instead; Q21 **frequency limit** → should refuse (CBS publishes monthly/quarterly, not daily). *(Note: this category has 5 questions — 21 total in the set; the owner grouped them as "20" loosely.)*

## 6. UX- en performance edge cases
*Owner's intent: caching, cell-limits, performance.*

22. "Geef een overzicht van alle gemeenten in Nederland met hun bevolking per jaar sinds 1970." *(huge query)*
23. "Toon de volledige tijdreeks van inflatie vanaf 1960 tot nu, met maandcijfers." *(long time series)*
24. "Laat alle regio's zien met het aantal bijstandontvangers én het gemiddelde inkomen én de woningvoorraad in één grafiek." *(too many dimensions)*

**Predicted:** Q22 tests the **10k-cell guard** (~342 municipalities × 55 years ≈ huge) *and* likely predates the loaded slice (1970) → should refuse gracefully (cell-limit or outside-slice), **not** error. Q23 monthly CPI 1960→now (~780 cells, under 10k) but 1960 almost certainly outside the ingested slice → refuse "outside loaded slice" or answer from the available range. Q24 is multi-measure (3 measures in one chart) + bijstand not loaded → **refuses** (one measure per query). *Signal:* confirm the cell-limit path refuses cleanly rather than crashing.

## 7. Context- en documentvragen (open.overheid.nl / beleid)
*Owner's intent: is the future document/context layer cleanly stubbed?*

25. "Is er een beleidsdocument dat uitlegt waarom de bijstandscijfers zijn veranderd in de afgelopen jaren?"
26. "Welke stukken van de Rijksoverheid gaan over het beperken van migratie?"
27. "Kun je het CBS uitleggen hoe zij hun cijfers berekenen en controleren?"

**Predicted:** all **refuse / say the document layer isn't connected** (Phase 2+). Acceptable Phase 0 behaviour is an honest "that layer isn't available yet." *Watch:* it should not hallucinate a document or methodology.

## 8. UX-testvragen voor chatinterpretatie *(the key architectural test)*
*Owner's intent: does the system retain context across follow-up turns?*

28. "Wat is de werkloosheid in Nederland sinds 2010?"
29. "En hoe zit dat voor jongeren?"
30. "En alleen in de Randstad?"
31. "Kun je dit in een grafiek zetten en een korte uitleg geven?"

**Predicted — this is the single biggest architecture signal.** Q28 answers. But **there is no multi-turn conversation memory**: each question is parsed independently (only the one-round clarification carries state). So Q29 ("hoe zit dat voor jongeren?") has no "dat" to resolve and will **refuse or clarify from scratch**; Q30 ("alleen in de Randstad?") likewise, plus "Randstad" is a composite non-CBS region; Q31 ("dit in een grafiek") has no "dit" referent. **This is a *known* Phase 0 non-goal — but it's the real Phase-1 fork: does conversational context get added, and if so, how does it thread through intent parsing without weakening the anti-fabrication guarantees?**

## 9. Product-idee testvragen (interpretatie/gevoel)
*Owner's intent: does the LLM interpret only from real numbers, without drifting into opinion?*

32. "Is de situatie op de woningmarkt verbeterd of verslechterd in de afgelopen tien jaar?"
33. "Wat zijn de belangrijkste trends als je kijkt naar migratie en veiligheid?"
34. "Kun je mij een kort verhaal geven bij deze grafiek over bijstand naar herkomstgroepering?"

**Predicted:** Q32 asks for a value judgment ("verbeterd of verslechterd") — should **refuse to interpret / stay descriptive** (B19-like causal/opinion guard), or answer with the price series and let the reader judge. Q33 migration/veiligheid not loaded → refuse. Q34 bijstand + herkomst not loaded → refuse. *Signal:* Q32 tests the "no opinion, stick to data" guard on a loaded topic — the most interesting one to actually run.

## 10. Meta-vragen over betrouwbaarheid
*Owner's intent: are UI and backend transparent about provenance?*

35. "Uit welke CBS-tabel komt deze grafiek precies?"
36. "Wanneer zijn deze cijfers voor het laatst bijgewerkt?"
37. "Hoe ga je om met ontbrekende waarden of geschorste cijfers?"
38. "Welke bronnen gebruik je naast CBS voor deze vraag?"

**Predicted:** the *information* Q35/Q36 want is **already shown inline in every answer** (R4 attribution line: table id + sync date). But as **standalone follow-up questions with no conversation memory**, "deze grafiek"/"deze cijfers" have no referent → likely classified as smalltalk/refuse. Q37 is a methodology/meta question → explains product behaviour or refuses. Q38 → honest "only CBS in Phase 0". *Signal:* attribution is inline-only, not conversationally queryable — fine while every answer carries it, but reinforces the conversation-memory decision from Category 8.

---

## Cross-cutting architectural signals (predicted — confirm in the pass)

1. **Multi-turn conversation memory (biggest):** absent by design. Categories 8 and 10 depend on it. Real Phase-1 fork.
2. **Regional coverage of the ingested slice:** the genuine unknown — Category 2 (Q5/Q6/Q8) reveals whether municipal/provincial data beyond the benchmark set is loaded. Highest-value *should-answer* probes.
3. **Composite regions** ("Randstad", "rest van NL"): not CBS codes; unsupported. Categories 4, 8.
4. **One-measure / one-varying-axis contract** ([#38](open-questions.md)): multi-measure or region×time cross-products refuse. Categories 4, 6.
5. **Single source, no document layer:** Categories 3, 7 refuse honestly.
6. **Guard robustness (run these for real):** Category 5 (bad region, forecast, frequency, too-broad) and Q32 (opinion guard) — where a *wrong* outcome would be a bug, not a design limit.
