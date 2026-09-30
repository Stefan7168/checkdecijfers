# Jev (TypeSafe AI "System One" model): product and API profile, as of 2026-09-30

**Method caveat (read first).** The network proxy blocked direct fetches of every primary domain: typesafe.ai, docs.typesafe.ai, developers.cloudflare.com, en.wikipedia.org, langchain.com, flaviocopes.com, dev.to, mindstudio.ai, vercel.com, datacamp, openrouter.ai, litellm docs, aimlapi docs. Only github.com fetches worked. So nothing below was read from the primary pages themselves. Findings come from (a) WebSearch result summaries that quote those pages (Cloudflare model card, TypeSafe API reference and press coverage) and (b) fetched GitHub pages, which are mostly community or unofficial repos that cite TypeSafe's docs. Every claim is labelled: VENDOR-CLAIM (TypeSafe or its press release), SECONDARY (relayed from TypeSafe docs by a third party), or INDEPENDENT (measured by a third party). Nothing is marked "verified by me". Community, "guide" and SEO sites (jevaiguide.com, jev.pro, layer3labs, orcarouter, etc.) were seen only as search snippets and are low-trust. Also, I was denied a Bash call that looked into the proxy status. I did not try to work around that.

## 1. Input/output contract

### Takeaway
One hosted endpoint takes a `state` (string, object or array) plus a named map of typed questions. Each question is `noul` (yes/no probability), `choice` (pick one of 2-255 labels) or `score` (2-10 ordered levels). Answers come back as typed values with probabilities and a confidence value. Nothing is generated as text. A TypeScript SDK exists, with inferred answer types. I found no published formal JSON Schema. The one I saw referenced is the community "jev-worker" description, which mirrors Cloudflare's. The TypeSafe API reference is at docs.typesafe.ai/api and I could not open it.

### Cited Findings
- Endpoint is `POST https://api.typesafe.ai/v1/systemone`. Each entry in `questions` is a typed question you name. SECONDARY (search-result summary of the TypeSafe API reference) — [docs.typesafe.ai/api](https://docs.typesafe.ai/api)
- Request fields: `model` (e.g. `"jev-latest"`), `state`, `questions`. An unofficial repo shows this example (SECONDARY, not official): `{"model":"jev-latest","state":"Customer context here","questions":{"topic":{"type":"choice","instructions":"...","criteria":{...}},"urgent":{"type":"noul","instructions":"..."}}}` — [codaaiteam/jev-typesafe-ai (unofficial)](https://github.com/codaaiteam/jev-typesafe-ai)
- Input schema as implemented by a Cloudflare Worker wrapper: `state` is a nonempty string or JSON object. `questions` is an object with user-chosen IDs. Each question has `type` ("noul" | "choice" | "score"), `instructions` (string, object or array) and `criteria` (for choice, 2-255 option mappings; for score, 2-10 ordered levels; for noul, `{"true": "...", "false": "..."}`). Example request, verbatim: `{"state":"Please contact me about team pricing.","questions":{"sales":{"type":"noul","instructions":"Is this a genuine sales inquiry?","criteria":{"true":"Real request about buying","false":"Spam or unrelated"}}},"cache":true}` (`cache` is that wrapper's own flag, not part of Jev) — [Jac0bJ/jev-worker](https://github.com/Jac0bJ/jev-worker)
- A search summary states "Cloudflare's question schema is byte-identical to TypeSafe's". SECONDARY — search result summarising [Cloudflare model card](https://developers.cloudflare.com/ai/models/typesafe/jev/)
- Type semantics (SECONDARY, consistent across several sources): Noul is a yes/no question that returns a probability. Choice picks one of up to 255 labels and returns the winner, the full probability distribution and a confidence score. Score is a position on an ordered rubric of 2-10 levels and returns a probability-weighted mean plus the full distribution and confidence — [zeke/jev quick reference](https://github.com/zeke/jev); [codaaiteam](https://github.com/codaaiteam/jev-typesafe-ai)
- Response example fragments from the Cloudflare model card, as relayed in search results: the response carries the model version, `answers` and `usage` (input and output tokens). A choice answer looks like `"choice": "billing", "confidence": 0.8, "probabilities": {"billing": 0.87, "sales": 0, "technical": 0.13}`. A score answer has probabilities per level (`"0": 0, "1": 0.96, "2": 0.04`). SECONDARY — search result on [Cloudflare model card](https://developers.cloudflare.com/ai/models/typesafe/jev/). I did not obtain the full verbatim response JSON, so do not treat the exact field names for noul/score as confirmed.
- Note the example shows `confidence` (0.8) differing from the top probability (0.87). So confidence is a separate calibrated signal, not just max(prob). Complementary probabilities need not sum to 1.0 (see limitations). SECONDARY — [Cloudflare card snippet](https://developers.cloudflare.com/ai/models/typesafe/jev/); limitations per search result on [Jev 1.13 limitations page summaries](https://www.orcarouter.ai/blog/jev-limitations)
- Through Vercel AI Gateway: model id `typesafe-ai/jev`, type "evaluation", `max_tokens: 0`, called via `experimental_evaluate` from the `ai` package. Answers are `choice` (<=255 options), `score` (2-10 levels) or `boolean`, and confidence appears at `providerMetadata.typesafe.confidence`. SECONDARY (a GitHub issue paraphrasing Vercel docs) — [Tristan578/project-forge#10140](https://github.com/Tristan578/project-forge/issues/10140)
- Errors: over-long input is rejected with HTTP 400 `max_tokens_exceeded`. It is not truncated. — [pydantic-ai PR #8740](https://github.com/pydantic/pydantic-ai/pull/8740); [fdsimms/todo#2781](https://github.com/fdsimms/todo/issues/2781)
- Text and structured input only. No image, audio or video. SECONDARY — [fdsimms/todo#2781](https://github.com/fdsimms/todo/issues/2781)

### Inferences
- The contract fits our four jobs (intent classification, table/measure selection, clarification yes/no, validation gates) as typed calls. Confidence gives a natural threshold for "ask the user / refuse", which matches principle (c).
- Because output is only labels and probabilities, Jev cannot itself emit a structured object such as `{table, measure, filters[]}`. Compound parses need one question per slot.

### Gaps
- Official response JSON in full, official TypeScript type definitions and an official JSON Schema: not retrieved (docs.typesafe.ai blocked).
- Exact response field names for `noul` and `score` answers: not confirmed.
- Whether `instructions` and `criteria` are free-form or have their own length limits: not found.

## 2. Supported and unsupported task types

### Takeaway
Officially framed as classification, routing, scoring, gating, and rubric-based ranking/reranking. Explicitly not for text generation, explanation, arithmetic, counting or date logic.

### Cited Findings
- Described as "a smart `if` statement". Applications named: resume screening, ticket triage, retrieval re-ranking, real-time tone analysis, game AI. Key limitations listed: "Cannot perform arithmetic or reliably count", "Struggles with date/time comparisons and complex indirection", "Susceptible to context rot and adversarial input steering", "Cannot generate text, code, or explanations". — [zeke/jev](https://github.com/zeke/jev) (a community research repo)
- TypeSafe publishes a per-version "jaggedness" page (Jev 1.13) at https://docs.typesafe.ai/model-jaggedness/jev-1.13 (URL confirmed as cited in [pydantic/genai-prices#720](https://github.com/pydantic/genai-prices/pull/720)). It reportedly lists nine failure modes, including: literal reading (answers the question you wrote, not the one you meant), weak arithmetic and counting, dates read as text rather than ordered quantities, double negatives and indirection answered less reliably, context rot (accuracy falls as unrelated content grows), no default resistance to adversarial input, contradictory instructions break it, complementary probabilities need not sum to 1.0, no text generation. SECONDARY (search snippets of third-party summaries; the page itself was not read) — [orcarouter summary](https://www.orcarouter.ai/blog/jev-limitations)
- TypeSafe reportedly tells developers to keep exact calculations in code and make questions direct. SECONDARY — same search result.
- Vercel's documentation (relayed): Jev cannot replace permission enforcement or execute tools. — [Tristan578/project-forge#10140](https://github.com/Tristan578/project-forge/issues/10140)
- The uses "routing and classification, scoring and prioritization, guardrails and gates, structured extraction from free text" appear in an unofficial repo. Note "extraction" here means classifying against options, not returning free spans. I found no evidence of span or entity-extraction output. — [codaaiteam (unofficial)](https://github.com/codaaiteam/jev-typesafe-ai)

### Inferences
- Table/measure selection from a dynamic candidate list is possible via `choice` (up to 255 labels per question). Larger catalogues need pre-filtering (retrieval, then Jev choose among top-k), or several questions over shards.
- Slot filling with free-valued entities (years, region names, numbers) is NOT natively supported. Values would still have to come from deterministic code or an LLM.
- Validation checks that need numeric or date reasoning should stay in code, which matches invariants R1-R3 anyway.

### Gaps
- No official statement found on "span extraction" or "numeric prediction". Treat as unsupported.
- The full nine-item list was not read from TypeSafe's own page.

## 3. Context window, input size, languages, dynamic option lists

### Takeaway
About 32k tokens for state plus the longest question (a combined budget of about 64k across all questions). Up to 255 options per choice question. Options are supplied per call, so no training is needed. No published multilingual evaluation was found, and Dutch is not mentioned anywhere I could see.

### Cited Findings
- Cloudflare model ID `typesafe/jev`, 32,000-token context, called via `env.AI.run()`. SECONDARY — search result on [Cloudflare card](https://developers.cloudflare.com/ai/models/typesafe/jev/)
- `context_window: 32000` for `jev-1.13.0`. "Measured live on `jev-1.13.0`, 32,878 input tokens were accepted, and the next size up was refused with HTTP 400." INDEPENDENT (measurement by a PR author, citing TypeSafe's jaggedness page) — [pydantic/genai-prices#720](https://github.com/pydantic/genai-prices/pull/720)
- "Jev refuses a request with HTTP 400 `max_tokens_exceeded` once the state plus the longest question passes about 32k tokens." "The state is counted once per request... The 64k combined budget only binds when the questions themselves are very large." — [pydantic-ai PR #8740](https://github.com/pydantic/pydantic-ai/pull/8740)
- Max 255 choice options ("documented ceiling is 255"). One independent test (2 to 151 options) reports flat latency at 0.17-0.20 s p50 regardless of option count, and stable accuracy. INDEPENDENT (single community harness, `4esv/jev-eval`) — [4esv/jev-eval](https://github.com/4esv/jev-eval)
- No published maximum on question count from TypeSafe. Third-party gateways impose their own limits (the Cloudflare Worker wrapper caps 32 questions per item, 64 KiB per request; these are wrapper limits, not Jev's) — [Jac0bJ/jev-worker](https://github.com/Jac0bJ/jev-worker); search result on Experiential gateway.
- Languages: "no published multilingual evaluation in any of TypeSafe's published material" (a third-party statement in search results, low trust). Dutch: not found. A separate open-source rival, Laya, claims 100+ languages. That is not Jev. — search results for query "Jev TypeSafe multilingual", [DataCamp alternatives page](https://www.datacamp.com/blog/top-open-source-jev-alternatives)
- One reranking benchmark included French Wikipedia queries and NevIR negation pairs. Its README excerpt I could read gives no separate French number. — [anessbelbati/jev-rerank-bench](https://github.com/anessbelbati/jev-rerank-bench/blob/cd9a35b22aeb4187334f7018a0ee1960a7470586/README.md)

### Inferences
- With about 32k tokens, a list of ~500 table titles cannot be one `choice` question (255 cap). Two questions of <=255, or a retrieval prefilter, would be needed. Descriptions per option consume tokens; 255 options with 40-token descriptions is about 10k tokens.
- Dutch performance must be measured on our own benchmark before any decision.

### Gaps
- Official Dutch or multilingual support statement: not found.
- Real token cost of a 255-option question in Dutch: not measured.

## 4. Fine-tuning, per-task setup, task definition

### Takeaway
No fine-tuning or compilation step was found in any source. It is zero-shot: the "task definition" is the question object (type, instructions, criteria) sent with each call. Changing the task means changing the request, at no setup cost.

### Cited Findings
- Same model weights for every customer; not trained on customer requests or responses. — search results on [jevaiguide.com FAQ](https://jevaiguide.com/faq/does-jev-train-on-your-data/) (low trust; matches press claims, see section 8)
- Questions are defined inline per request with `instructions` and `criteria` (see section 1). No separate task-definition artifact found. — [Jac0bJ/jev-worker](https://github.com/Jac0bJ/jev-worker)
- One community eval found accuracy roughly insensitive to prompt wording ("Jev is unmoved by the wording", about 0.94 accuracy across paraphrases on one classification task). INDEPENDENT (single harness, small evidence) — [4esv/jev-eval](https://github.com/4esv/jev-eval)

### Inferences
- The task definition is our prompt-like artifact. Calibration quality across different question wordings and languages needs our own tests.

### Gaps
- I found no evidence of a fine-tuning or custom-model offering either way ("not found").

## 5. Pricing, rate limits, latency

### Takeaway
$0.042 per million input tokens, output free. Latency claimed 70-500 ms (usually about 100 ms). Independent measurements sit in the 130-420 ms range. Published rate limit reported as 1,200 requests per minute (secondary source).

### Cited Findings
- "$0.042 per million input tokens", output free (about $0.0004 per decision, in an unofficial repo). Vercel AI Gateway lists input `0.000000042` per token, output `0`. VENDOR-CLAIM via SECONDARY — [zeke/jev](https://github.com/zeke/jev); [Tristan578/project-forge#10140](https://github.com/Tristan578/project-forge/issues/10140)
- Latency claims: "70-500ms end to end, usually around 100ms" (vendor claim as relayed); "40x-200x faster than frontier LLMs"; press release: "under 100 milliseconds", "up to 100 times faster and cheaper". Vercel listing says "up to 194x faster and 445x cheaper than language models" and "sub-500ms". VENDOR-CLAIM — [zeke/jev](https://github.com/zeke/jev); press coverage in [Morningstar/Business Wire](https://www.morningstar.com/news/business-wire/20260915525333/typesafe-ai-emerges-from-stealth-with-40m-in-funding-with-new-model-for-composable-ai) (search snippet); [Tristan578/project-forge#10140](https://github.com/Tristan578/project-forge/issues/10140)
- Independent latency: median classifier latency 126.81 ms for Jev versus 688.40 ms for Haiku (5.43x faster), cost 96.12% lower (registry-priced). INDEPENDENT-ish (LiteLLM blog, search snippet only, source not fetched) — [docs.litellm.ai/blog/jev-auto-router-benchmark](https://docs.litellm.ai/blog/jev-auto-router-benchmark)
- 0.17-0.20 s p50 across 2-151 options. INDEPENDENT (community) — [4esv/jev-eval](https://github.com/4esv/jev-eval)
- Reranking of 30 BM25 candidates: 422 ms per query, $0.45 per 1,000 queries, versus $2.51 for Cohere Pro. INDEPENDENT (community benchmark; measurements began 2026-09-16) — [anessbelbati/jev-rerank-bench](https://github.com/anessbelbati/jev-rerank-bench/blob/cd9a35b22aeb4187334f7018a0ee1960a7470586/README.md)
- Rate limits reported as 1,200 requests per minute and 250,000 tokens per second, adjusting dynamically and changeable without notice. SECONDARY (third-party guide sites in search results, not the TypeSafe page) — search result for "Jev rate limits", e.g. [jevaiguide.com/jev-rate-limits](https://jevaiguide.com/jev-rate-limits/)
- No free tier or trial credits documented by TypeSafe direct; pay-as-you-go from first token. SECONDARY, low trust — same search result. Vercel gives $5/month AI Gateway credit to free-tier teams. Users on the Vercel Community forum reported paid credits still hitting a "free-tier 429" on `typesafe-ai/jev` (a gateway-side issue) — [Vercel Community thread](https://community.vercel.com/t/ai-gateway-typesafe-ai-jev-returns-free-tier-429-despite-paid-credits/49935) (snippet only)
- Cloudflare bills via the Cloudflare dashboard ("priced in the Cloudflare dashboard"); I did not get the Cloudflare per-token price. SECONDARY — search result on [Cloudflare card](https://developers.cloudflare.com/ai/models/typesafe/jev/)

### Inferences
- Cost is negligible for our volumes. A 5k-token request costs about $0.00021 at $0.042/M input.
- Independent latency near 130-420 ms is consistent with the low end of the claim. It is not the "under 100 ms" of the press release.

### Gaps
- TypeSafe's own pricing page and rate-limit page: not read. Cloudflare's price: not found. Whether paid tiers change rate limits: not found.

## 6. Availability and hosting

### Takeaway
Announced 2026-09-15 as early access. Public self-serve access reportedly opened 2026-09-21, with keys from the console. Also served via Vercel AI Gateway, Cloudflare Workers AI/AI Gateway and OpenRouter. Closed weights, hosted only, no self-hosting. No EU data residency found.

### Cited Findings
- "Public access opened 21 September 2026 — keys from the console." Console at console.typesafe.ai. SECONDARY (community awesome list, "unofficial") — [AnotiaWang/awesome-jev](https://github.com/AnotiaWang/awesome-jev)
- Press: "in early access for select developers" on 2026-09-15 — search snippet of [Business Wire via Morningstar](https://www.morningstar.com/news/business-wire/20260915525333/typesafe-ai-emerges-from-stealth-with-40m-in-funding-with-new-model-for-composable-ai). The two statuses conflict in tone but not necessarily in fact (limited access, then opened). Not verified against TypeSafe's page.
- Available through the TypeSafe direct API, Vercel AI Gateway, OpenRouter and Cloudflare AI Gateway. — [zeke/jev](https://github.com/zeke/jev)
- "Closed weights, hosted API only, no self-hosting or on-device deployment." — [fdsimms/todo#2781](https://github.com/fdsimms/todo/issues/2781). Open-weight lookalikes (Laya, "open-jev") exist but are not Jev. — search results, [creuto.com/openjev-jev-clones-self-host](https://creuto.com/openjev-jev-clones-self-host)
- Data terms: not trained on customer requests or responses; zero data retention is only for enterprise customers (fdsimms issue: "Zero data retention available outside the enterprise tier" as a concern); a data processing agreement is offered. SECONDARY — search results ([jevaiguide FAQ](https://jevaiguide.com/faq/does-jev-train-on-your-data/), [fdsimms/todo#2781](https://github.com/fdsimms/todo/issues/2781))
- "All primary compute, inference, and data processing occur within United States data centers... does not currently offer native data residency options in the EU, UK, or Canada." SECONDARY (guide site; TypeSafe wording not seen) — search result for [jev101.org privacy guide](https://jev101.org/guides/jev-privacy-guide)
- Cloudflare path: requests go through Cloudflare's partner-model terms plus TypeSafe's terms, which someone flagged for review before sending private data. — [Mumega-com/mupot#1437](https://github.com/Mumega-com/mupot/issues/1437)

### Inferences
- For a Dutch/EU product processing only user questions plus public CBS catalogue metadata, US processing is a GDPR transfer question, not automatically a blocker. Inputs are user question text, so a DPA and possibly SCCs are needed. This is an assessment for the owner, not a finding.
- Availability through Cloudflare or Vercel adds a second commercial route and a fallback, but the model is the same and still proprietary.

### Gaps
- TypeSafe's own statement on regions, SOC 2, DPA terms and SLA: not read. "Early access status as of late September 2026" from TypeSafe itself: not read; the awesome-list claim of public access on 2026-09-21 is unofficial.
- Cloudflare model card contents beyond snippets: not obtained.

## 7. SDKs and integrations

### Takeaway
Official TypeScript/JS SDK `@typesafe-ai/sdk` (Node 20+ documented), plus a Python SDK, and Vercel AI SDK support. No OpenAI-compatible chat endpoint for evaluation. LangChain post not read.

### Cited Findings
- Official SDKs: `npm install @typesafe-ai/sdk` (github.com/typesafe-ai/typesafe-sdk-js), `pip install typesafe-sdk`, and a Python "System One adapter" (github.com/typesafe-ai/system-one-adapter-python). Links listed in an unofficial awesome-list — [AnotiaWang/awesome-jev](https://github.com/AnotiaWang/awesome-jev)
- The JS SDK is described as an official client with inferred answer types, documenting Node.js 20+. SECONDARY — search result for [OpenRouter SDK docs page](https://openrouter.ai/docs/guides/community/typesafe-sdk) and [typesafeai.org guide](https://www.typesafeai.org/guides/jev-typescript)
- Vercel AI SDK: `experimental_evaluate` and provider id `typesafe-ai/jev`. — [Tristan578/project-forge#10140](https://github.com/Tristan578/project-forge/issues/10140), search result on [Vercel KB guide](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk)
- Cloudflare: `env.AI.run('typesafe/jev', { state, questions })`, no TypeSafe key needed, billed by Cloudflare. — [Mumega-com/mupot#1437](https://github.com/Mumega-com/mupot/issues/1437); [Jac0bJ/jev-worker](https://github.com/Jac0bJ/jev-worker)
- Search-result claim: "OpenAI-compatible endpoints don't support Jev evaluation" (an OpenAI-compatible adapter exists only as a look-alike shim backed by other LLMs). SECONDARY — search result for the SDK query.
- LiteLLM has a pass-through route for TypeSafe. — search result, [docs.litellm.ai/docs/pass_through/typesafe](https://docs.litellm.ai/docs/pass_through/typesafe)
- LangChain post "building-a-harness-with-jev": content not retrieved (blocked); only the title "What Is Jev? A Guide to TypeSafe AI's System One Model" is known from search results. — [langchain.com](https://www.langchain.com/blog/building-a-harness-with-jev)

### Gaps
- SDK API surface (method names, types, retries, error classes), version and license: not read. LangChain details: not found.

## 8. Company and risk signals

### Takeaway
Young San Francisco lab (founded 2024, out of stealth 2026-09-15) with $40M seed led by DCVC; a single product so far. No roadmap or deprecation policy found beyond versioned model names.

### Cited Findings
- $40M seed led by DCVC; emerged from stealth 2026-09-15. Founder and CEO Diogo Almeida, a former OpenAI researcher described as a co-inventor of RLHF; co-founders Erik Gafni and Sasha Sheng. VENDOR-CLAIM (press release), repeated widely — [Morningstar / Business Wire](https://www.morningstar.com/news/business-wire/20260915525333/typesafe-ai-emerges-from-stealth-with-40m-in-funding-with-new-model-for-composable-ai) and [Yahoo Finance copy](https://finance.yahoo.com/technology/ai/articles/typesafe-ai-emerges-stealth-40m-190000776.html) (search snippets)
- Founded in 2024 (per a Wikipedia search snippet): [en.wikipedia.org/wiki/Jev_(AI_model)](https://en.wikipedia.org/wiki/Jev_(AI_model)). Name refers to the Jevons paradox.
- Model versioning exists (`jev-1.13.0`, alias `jev-latest`). Using `jev-latest` means silent model changes, so pinning is advisable. — [pydantic-ai PR #8740](https://github.com/pydantic/pydantic-ai/pull/8740); [codaaiteam](https://github.com/codaaiteam/jev-typesafe-ai)
- Independent evidence is thin: "No independent benchmark of Jev exists as of September 2026" per one aggregator's claim, while community benchmarks (above) do exist. Reranking nDCG@10 0.692 versus 0.691 for Cohere Pro (not distinguishable). In a separate test, Jev reranking alone did not beat vector retrieval. — search result for [Jagent benchmarks](https://jev-agent.com/benchmarks); [jev-rerank-bench](https://github.com/anessbelbati/jev-rerank-bench/blob/cd9a35b22aeb4187334f7018a0ee1960a7470586/README.md)
- Calibration (ECE) of 0.039 on CLINC in one community harness; an open-weight rival was better calibrated on 4 of 5 tasks. INDEPENDENT (single harness) — [4esv/jev-eval](https://github.com/4esv/jev-eval)
- A "no independent benchmark" claim and "mathematically cannot hallucinate or produce type errors" (marketing) are both to be treated with care: the model can still return a wrong label with high confidence; type safety only guarantees the shape.

### Inferences
- Vendor-risk profile: about two weeks old at the time of writing, one product, US-only, no stated deprecation policy. Use behind a thin adapter with a fallback to the current LLM.
- No roadmap, deprecation or SLA statement was found.

### Gaps
- Official statements on roadmap, model retirement timelines, SLA and SOC 2: not found. Wikipedia and typesafe.ai/team could not be read directly.

## Source-quality summary for the report writer
- Primary sources (typesafe.ai, docs.typesafe.ai, Cloudflare card, Wikipedia, LangChain post): not directly read. Quote them only as "as relayed by".
- Most reliable secondary items: the pydantic-ai and genai-prices PRs (measured limits, cite TypeSafe docs), the jev-rerank-bench and jev-eval repos (real measurements), the Cloudflare Worker wrapper (an implementation of the schema).
- Lowest trust: the many SEO or "guide" sites (jevaiguide, jev.pro, layer3labs, orcarouter, lmspedia, etc.) and unofficial repos. Their claims on rate limits, US-only hosting and no free tier need confirmation from TypeSafe's docs before an engineering decision.
- Suggested next step: have someone with unrestricted network access open docs.typesafe.ai/api, docs.typesafe.ai/model-jaggedness/jev-1.13, the Cloudflare card and console pricing, and confirm sections 1, 5 and 6.
