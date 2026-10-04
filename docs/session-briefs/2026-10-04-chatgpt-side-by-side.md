# Side-by-side: our app vs ChatGPT on 12 everyday questions (session 155, 2026-10-04)

**Why.** The owner said at the end of session 154 that he was getting sceptical about the app. Owner choice at the start of
session 155: run an honest side-by-side. Row: [open-questions #366](../open-questions.md).

**How.** Twelve everyday Dutch questions, written by the session before running anything: seven about the Netherlands and
five about Europe. Each question went into a fresh chat.
- **ChatGPT:** chatgpt.com, logged out (the free default with web search), in the Claude browser pane.
- **Our app:** production (checkdecijfers.vercel.app), in the owner's own logged-in account, with the CBS and Eurostat
  chips on.
- **Ground truth:** a cheap-tier agent read every figure directly from the CBS OData and Eurostat APIs the same day.
- **Spend:** our app used 130 credits (the owner's balance went from 1,990 to 1,860). Wrong-answer refusals cost 0.
- **Timing:** not measured to the second. ChatGPT answers were ready at about 15 s. Ours were ready at about 25–30 s;
  the session waited fixed intervals.

## Scorecard

| # | Question | ChatGPT | Our app | Official figure (API) |
|---|---|---|---|---|
| 1 | Hoeveel inwoners heeft Amsterdam? | 941,873 (the municipality's own count, 1 Jan 2026) | **941,927** ✔ | 941,927 (CBS 03759ned, 1 Jan 2026) |
| 2 | Hoe hoog is de inflatie nu? | 3.4% Sept 2026 ✔ (plus an unasked Thailand figure) | **3.4%** ✔ | 3.4% (86141NED, flash) |
| 3 | Wat kost een huis gemiddeld? | €503,500 Aug 2026 + 2025 €479,500 ✔ | **€503,523** ✔ | €503,523 (85773NED) |
| 4 | Faillissementen in 2025? | 3,636: matches no CBS figure | **3,226** businesses ✔, notes the 4,105 total | 3,226 / 4,105 (82242NED) |
| 5 | Elektrische auto's op 1 jan 2025? | 569,144 fully electric (source not a CBS table; unverified) | **refused**, and the reason is wrong: "name a year" (the question named one; known #361) | no CBS table has this exact stock; "Elektriciteit" includes hybrids |
| 6 | Hoeveel mensen werken in de zorg? | ~1.9 mln jobs, ~1.7 mln people ✔ | **refused**: picked "Zorginstellingen; financiën en personeel", said "not sure which figure" | 1,901k jobs / 1,682k people (85918NED, 2025) |
| 7 | Bestelauto's gesloopt in 2024? | 9,517 ✔ + 2022/2023 | **9,517** ✔ | 9,517 (85245NED) |
| 8 | Werkloosheid in Spanje? | 9.87% Q2 2026 (Spain's own INE survey; real) | asked "which age?" with 35 options; after picking 15–74: **10.5% (2025)** ✔ from a by-citizenship table, with an English title inside the Dutch sentence | 10.0% Aug 2026 (une_rt_m); 10.5% 2025 (une_rt_a) |
| 9 | Hoeveel inwoners heeft Polen? | ~37.2 mln (Poland's own national count) | **refused**: "no table found" | 36,332,765 (Eurostat tps00001, 1 Jan 2026) |
| 10 | Verkeersdoden Frankrijk 2023? | 3,398 incl. overseas / 3,167 mainland (French national source) | **3,154** ✔ | 3,154 (tran_sf_roadro) |
| 11 | Welk EU-land heeft de hoogste staatsschuld? | Greece 143.5% (Q1 2026), Italy, France ✔ | **refused**: "no table found" | Greece 146.1% (2025, gov_10dd_edpt1) |
| 12 | Inwoners Nederland in 2040? | 19.14 mln (CBS forecast) ✔ | **refused**, and the reason is false: "CBS and Eurostat publish no forecasts" | 19,139,199 (CBS 86244NED, Kernprognose) |

## What it says

- **Answer rate.** ChatGPT answered 12 of 12. We answered 7 of 12; one of those needed a follow-up click.
- **Wrong numbers.** Neither side invented a number outright.
  - ChatGPT gave two figures that cannot be traced to the official table: #4 matches no CBS cell, and #5 has an
    unknown source.
  - On #8, #9 and #10 ChatGPT gave real national figures that differ from Eurostat's. That is defensible, but a reader
    cannot tell which definition they got.
  - All 7 of our answers match the official cell exactly.
- **Where we are better:**
  - The exact official cell, every time.
  - The source table and the sync date are shown.
  - The headline definition is chosen on purpose (#4 businesses, with the alternative named).
  - A ready chart.
  - We refuse rather than guess.
- **Where we are worse:**
  - We refuse 5 out of 12 everyday questions.
  - Two of those refusals tell the reader something false or confusing (#5 "name a year", #12 "CBS publishes no
    forecasts").
  - Eurostat answers come with a long choice list and an English title (#8).
  - We are slower.
- **The edge only counts when we answer.** Today a reader meets a refusal on about 4 of 10 everyday questions. That
  wipes out the advantage of proof.

## Failure classes, all layer problems (not single tables)

1. **The finder misses the obvious Eurostat table:** #9 (population, tps00001 / demo_pjan) and #11 (debt).
2. **Ranking questions:** "which country has the highest …" is not a question shape the lane handles (#11).
3. **Forecast tables:** the refusal text claims no forecasts exist, but CBS publishes the Kernprognose. The lane should
   answer from it and label the figure as a forecast (#12).
4. **"op 1 januari JJJJ"** is read as a one-day range and refused (#5; already #361).
5. **Wrong table pick on a broad topic:** "werken in de zorg" lands on the care-institutions finance table, not labour by
   sector (#6).
6. **Eurostat defaults:** the reader is asked for an age group where the headline (15–74, or the total) is obvious. The
   answer sentence carries the English measure title (#8; session-155 kickoff open items 1 and 2).

## Recommendation (one)

Build a fixed set of about 50 everyday questions (CBS + Eurostat), frozen like the front-door holdout set. Measure the
answer rate and wrong-number count on it. Then work the layer, failure class by failure class, until the answer rate is
high with 0 wrong numbers.

Order of the work, by how many readers it costs: finder misses (1, 5) → Eurostat defaults + Dutch titles (6) → forecasts (3) →
ranking (2) → "1 januari" (4). The false refusal text in #12 is a small, cheap fix and should go first.
