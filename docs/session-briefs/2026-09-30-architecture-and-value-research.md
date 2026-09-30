# Is the architecture right, and what is our added value? — research, 2026-09-30 (session 151, owner-requested)

**Trigger.** The owner asked, before any other work: is the current architecture the best way to answer from CBS data, are
we over-engineering, is our own copy of the data needed, can people already get the same from Claude or ChatGPT with a
graph, and what is the benefit of this web app. Row: [open-questions #356](../open-questions.md). This brief records
**measured facts and a recommendation.** One decision followed the same day (ADR
[065](../decisions/065-retire-whole-table-copies-one-route.md): retire the whole-table copies); the rest is still open.

## 1. Blind test — what a general assistant with web access returns today

One run, ten questions, a mid-tier model allowed only web search and page fetch (no repository access, no expected
answers given, told to look for the official CBS figure, about six tool calls per question). Seven questions are benchmark
tasks; three are outside our loaded tables. Ground truth: `benchmark/answer-key.json` and CBS's own API, fetched the same day.

| Question | Assistant | Our frozen key / CBS cell | Verdict |
|---|---|---|---|
| Utrecht population 1 Jan 2024 | 374,238 | 374,238 | exact |
| Unemployment Q4 2025 | 3.9% (not seasonally adjusted); 4.0% flagged as unverified | 4.0% (seasonally adjusted headline) | real CBS cell, not the headline definition |
| Average sale price 2024 | 450,985 | 450,985 | exact |
| Sale price series 2019–2024 | six yearly values | same values | exact |
| Bankruptcies 2025 | 4,105 (all), with 3,226 businesses shown | 3,226 (businesses, our stated default) | real CBS cells, different default |
| Solar electricity 2024 | 22,257 mln kWh (from a CBS report page) | 21,822 mln kWh (StatLine cell, re-checked today) | two different official numbers |
| Average household income 2023 | 57.6 thousand euro | 57.6 | exact (it was unsure which row is the total) |
| Asylum applications "last month" | August 2026 figures, said September is not published | not in our tables | it answered; we cannot |
| Fully electric cars 1 Jan 2025 | declined: the table's "Elektriciteit" 1,621,141 includes hybrids | not in our tables | honest decline, trap avoided |
| Westerkwartier population + households 1 Jan 2023 | 64,946 and 27,291 | 64,946 and 27,291 (CBS API) | exact; households table not in our set |

- **No invented number.** Eight answers were read straight from CBS's open API through the page-fetch tool.
- **About 36 seconds per question** (10 questions, 38 tool calls, 6 minutes) against our measured 6.5 s median.
- **Three of seven benchmark questions got a different real CBS number than the headline one** — exactly the cases where
  our registry pins a stated default.
- **Limits of this test (say them whenever it is quoted):** one run, n = 10, no chart was requested, the assistant was told
  to be careful and to find the CBS figure, and its fetch tool can open any address. A consumer chat used casually answers
  from search snippets and news. It is an upper bound on what a skilled user gets, not a measurement of the average user.
  ChatGPT was not tested.

## 2. What exists (web research, same day; key items re-checked by the session)

- **CBS connectors for assistants exist, all community-made, none mainstream:** three small GitHub projects (0–9 stars;
  star counts and dates re-checked through the GitHub API) and one Dutch open-source server covering 46 Dutch and EU
  sources including CBS and Eurostat, free, "every response carries provenance" (page opened). All need technical setup.
  No CBS or Eurostat connector was seen in Claude's public connector list (partial read). ChatGPT's directory not checked.
- **CBS itself:** no AI or chat over StatLine found. The move to a new platform is off for now (CBS update, February 2026);
  both APIs stay.
- **Eurostat:** no official assistant or connector found; community ones exist.
- **The trend elsewhere is official connectors:** India's statistics office (Feb 2026), France's data.gouv.fr (Feb 2026),
  the US Census Bureau, the World Bank (can return chart specifications), Google Data Commons (hosted since Feb 2026).
- **Accuracy of ungrounded assistants is still poor:** an IMF paper (March 2026, read through a summary) reports ChatGPT
  correct 34% of the time on G7 growth data in one conversation and 17% across separate ones.
- **Chart tools:** Flourish ships an assistant and a connector on every plan; Competitor G sells unlimited AI charts from
  about $16 a month; Datawrapper shows no built-in AI. None has official Dutch statistics built in.
- **Not verified:** whether ChatGPT's or Claude's code sandbox can reach CBS's API; Perplexity and Copilot; any internal
  CBS experiment.

## 3. Our own numbers (read-only, 2026-09-30)

- `npm run usage:report`: 4 signups, 2 accounts that ever asked a question, about 76 real questions in three months, 12 of
  them ended in our own internal-error refusal, 5 anonymous trial questions. No outside user.
- Coverage: 21 of 1,277 current CBS tables (ADR 062's count). The any-table lane is built and switched off.
- Code, excluding tests: about 110,000 lines. The data-copy machinery (`ingestion`, both adapters, `catalog`, `registry`)
  is about 13,000 of them; the answer pipeline 23,600; the web interface about 50,000. Tests: about 138,000 lines.

## 4. Answers to the owner's questions (the session's judgment)

1. **Is the core architecture right?** Yes for the part that matters: code computes, only stored and checked cells are
   shown, refuse instead of guess. The test shows why it still matters — not against invention, which a careful assistant
   no longer does, but for **consistency**: the same question always gives the same, stated definition.
2. **Is a full copy of CBS needed?** No, and ADR 062 already concluded that (all current tables hold about 3.5 billion
   cells). What is needed is keeping **the cells we have shown**: a published chart must be reproducible, must survive a
   CBS outage, and CBS revises figures silently (#355: GDP 1.3 became 1.6). A cache with receipts, not a mirror.
3. **Are we over-engineering?** Not in the number pipeline. Yes around it: billing, a subscription, two co-pilots, thirteen
   templates, own-data import, a second source and an English answer path were all built before one outsider used the
   product (the 2026-09-29 review said the same).
4. **Can people get the same from Claude or ChatGPT?** The number: increasingly yes, slower and with a less predictable
   definition; with a community connector, more so. Standing risk 1 in [01-product-vision.md](../01-product-vision.md)
   has the revisit trigger "a major assistant demonstrably answers CBS questions with correct cell-level attribution" —
   **partly met** for a careful user, not by default. The chart you can publish: no. A general assistant draws a generic
   chart in a chat; it gives no source line built in, no embed, no share link, nothing that stays current.
5. **So what is the added value?** Not "the AI that does not invent numbers" — that edge is shrinking. It is **the fastest
   way from a question to a publishable, sourced chart of official statistics, with the same defensible number every
   time.** That is ADR 063's direction; this research supports it and weakens the older fact-check positioning.

## 5. Recommendation (one, in order — for the owner to accept, change or reject)

1. Keep the core. Do not rebuild.
2. Treat the any-table lane as the priority inside the 1 October recording run (its part A) and aim at switching it on:
   breadth is the one place the general assistant beat us in this test.
3. Load no further whole tables by hand; ~~the 21 stay as the fast showcase set~~ **owner decision the same day: the
   whole-table copies are retired, the pinned definitions are kept — ADR [065](../decisions/065-retire-whole-table-copies-one-route.md).**
4. Record, do not build: offering our checked numbers and charts **inside** Claude and ChatGPT as a connector, since that
   is where people will ask. A roadmap candidate, behind the phase gate.
5. Reword the public comparison with general chatbots from "they invent numbers" to speed, consistency and the
   publishable chart — once the owner agrees.
