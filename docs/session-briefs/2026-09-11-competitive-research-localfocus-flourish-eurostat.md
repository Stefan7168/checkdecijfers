# Competitive research: LocalFocus, Flourish, Eurostat feasibility (2026-09-11, session 96)

Owner-present session. Two cheap-tier (Sonnet) research agents produced the LocalFocus and Flourish profiles; the
`/deep-research` workflow (105 agents) ran the market / Eurostat / competitor questions — its verify + synthesize
phases hit the account's weekly usage limit part-way, so the session re-verified the 10 unverified Eurostat claims
and the 2 "refuted" claims itself against the live pages (both "refutations" were wrong; reinstated below).
Decisions taken on it: [open-questions #237](../open-questions.md), ICP in [01-product-vision.md](../01-product-vision.md).

## LocalFocus (ANP)

- Tagline "Turn your numbers into graphs and maps in under a minute". Sold by ANP as "ANP Datavisualisatie".
  Founded 2013 by three journalists (Jelle Kamsma, Yordi Dam, Erik Willems); acquired by ANP Dec 2021.
- Pricing (live site 2026-09-11): Teams Standard €530/month (3 users, 1 custom brand made by their designers),
  Teams Complete €890/month (5 users, ANP industry data, quarterly usage reports), Enterprise on request
  (10 users, multiple brands incl. print, self-hosting). 30-day trial. No self-serve paid tier.
- **LocalFocus Connect** (since 2015): a robot maintaining hundreds of open datasets (CBS, Kadaster, …) that
  auto-updates published charts. Their data journalists track CBS, ministries, police and expose the datasets.
- **Nieuwsdienst**: ~5 human-written data stories/week with visuals — product + content marketing in one.
- Sells municipalities a live election-results embed fed by the ANP Verkiezingsfeed.
- Weaknesses: no Q&A, no AI in the core product, thin free tier, price shuts out freelancers/regional desks.
  Only 2025–2026 item found was a co-founder's *separate* SVDJ Incubator project (AI content licensing via
  RSL + MCP) — NOT a LocalFocus/ANP product; no LocalFocus product news found.
- Sources: localfocus.nl, anp.nl/diensten/41/localfocus-datavisualisatie, anp.nl/verkiezingstool-gemeenteraadsverkiezingen,
  villamedia.nl (freelanceleven interview), svdj.nl/nieuws/twee-tools-uit-de-svdj-incubator-2026/.

## Flourish (Canva)

- "Where data meets storytelling". 1.5M+ users at the Feb 2022 Canva acquisition. Customers named: BBC World
  Service, Sky News.
- Tiers: Free (unlimited public projects, attribution on embeds), Presenter (bundled in Canva Business/Enterprise),
  Publisher and Enterprise (quote only; live data updates, team folders, scrollytelling, API gated here).
- **AI (verified on flourish.studio/pricing, 2026-09-11): "Flourish Assistant" (plain-language prompts to refine
  charts; allowance on every tier incl. Free) and "Flourish Connector" (connect Flourish to AI tools that support the
  Model Context Protocol).** Plus an SDK "AI starter kit" for agent-built custom templates.
- Growth playbook: blog, monthly newsletter, monthly webinars, free beginner course, YouTube, ~400-item public gallery,
  attribution-on-free-embeds as distribution.
- Weaknesses for our audience: no data of its own, never checks a number; Datawrapper is faster for everyday charts.

## Market (verified)

- NVJ arbeidsmarktmonitor 2025: ~10,300 salaried journalists (57%); ~500 media organisations; DPG Media + Mediahuis
  employ >3,100 editorial staff (30.3%); 26 paid dailies, 13 national + 13 regional public broadcasters.
- Datawrapper: Pro $21/user/month (per seat, self-serve); Business plan launched July 2026, price not published.
- Municipal segment: VNG Waarstaatjegemeente.nl (free, harmonised CBS data; ~100 municipal organisations held an API
  key by end 2025 — unverified by panel, page reads so); CBS "Cijfers op de Kaart" + new "Overzicht regionale
  Statistieken" dashboard (CBS corporate article, early 2026).
- No direct evidence of willingness to pay for *verification* as such; nearest proxy is LocalFocus bundling curated
  official data into a €530+ plan.

## Eurostat feasibility (all re-verified on ec.europa.eu, 2026-09-11)

- Four APIs: Statistics API (JSON-stat 2.0, REST, CORS), SDMX 3.0, SDMX 2.1, Catalogue API.
- Refresh twice daily, 11:00 and 23:00 CET. **No versioning of past data — only the latest version exists.**
- Sync below 500,000 cells; async (submit + poll) 500k–5M; HTTP 413 above 5M. Fair-use policy on concurrent requests,
  request frequency (day / 7 days / 30 days) and cumulative cost; violations are forced async, not blocked.
- Licence CC-BY 4.0, commercial reuse allowed; prescribed line "Source: [dataset DOI], [access date]". Exceptions:
  non-EU country data (USA, Japan, China) and some CH/AT trade data may not be reused commercially.
- No product found that combines LLM chat with Eurostat or CBS the way we do.

## Recommendations (owner agreed 2026-09-11)

1. Positioning: "Ask the question, get the official number, publish the chart. Every figure traceable to a CBS cell."
2. Maps = biggest visible gap vs LocalFocus; gated on the region-set query capability (#212).
3. "Never stale" live embeds = the Pro monthly plan's reason to exist (#205); Live is gated closed in PR #9 until the
   creator-email lookup exists.
4. Release-day pages (publication radar #161 + browse layer) replace their human Nieuwsdienst.
5. Flourish growth mechanics (free watermarked embeds w/ backlink, gallery, newsletter), not its 50 templates.
6. Newsroom tier at ~half LocalFocus Standard; Pro priced near Datawrapper Pro, not LocalFocus.
7. Direction: specialise on chat-from-research-to-embedded-chart over European + Dutch official data, CBS first,
   Eurostat second (demand-driven, never announced before it answers), RIVM/Kadaster after.
8. Watch the Flourish Connector (MCP); consider our own MCP endpoint later.
