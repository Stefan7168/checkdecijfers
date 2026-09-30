# Jev integration patterns (research as of 2026-09-30)

## Source-access caveat (read first)

Egress to these domains was blocked in this session, so their full text was NOT read: langchain.com, dev.to, flaviocopes.com, mindstudio.ai, developers.cloudflare.com, typesafe.ai, docs.typesafe.ai, jevtypesafeai.com, vercel.com, openrouter.ai, datacamp.com, wikipedia, you.com, marktechpost.com, hindsight.vectorize.io, community.vercel.com. For those I only have search-result snippets, labelled "(snippet)". GitHub and spring.io WERE readable, so most code-level detail below comes from GitHub READMEs, TypeSafe's own JS SDK source, and the Spring AI post. One attempt to read the proxy's own README/status was denied by the permission classifier and was not retried. Re-fetch the blocked primary pages from an unrestricted machine before treating this as complete.

Status of jevtypesafeai.com: NOT verified. The search snippet describes it as "the website for Jev" with demos, but I could not open it to check ownership or affiliate disclosure. The official domains are typesafe.ai, docs.typesafe.ai and console.typesafe.ai (from the awesome-list below). Treat jevtypesafeai.com as unverified/third-party until checked.

Primitive facts (TypeSafe's own claims, not independently verified): Jev is non-autoregressive, returns typed answers with probabilities in one parallel pass, no text; early access from 2026-09-15, US$40M seed led by DCVC; $0.042 per million input tokens, output free (snippet, [search result](https://www.langchain.com/blog/building-a-harness-with-jev), [jevtypesafeai.com listing](https://jevtypesafeai.com/)). No named production customer found (see Q8).

---

## Q1. What does the LangChain "Building a harness with Jev" post show?

### Takeaway
I could not read the post itself. Search snippets and the community repo built from it show an "experimental middleware" harness with two decision nodes (a request router that picks a cheaper vs stronger OpenAI model, and a tool-risk gate). Confidence/threshold code was not visible to me.

### Cited Findings
- Post title/summary (snippet): harness adds a Request Router (gpt-4o-mini vs gpt-4o) and a Tool Gate (low/medium/high risk) at agent lifecycle hooks; `TypeSafeClassifier` exposes decisions as a LangChain Runnable (invoke/batch/compose) — [LangChain blog](https://www.langchain.com/blog/building-a-harness-with-jev), [LangChain provider docs](https://docs.langchain.com/oss/python/integrations/providers/typesafe) (snippets only)
- Python only: the community reproduction requires `"langchain-typesafe[experimental]" langchain langchain-openai python-dotenv`; `ModelRouterMiddleware` routes gpt-4o-mini/gpt-4o from a Jev Choice; `AutoModeMiddleware` gates tools like `delete_all_backups` via a Noul; README has no latency/cost data — [dguzman1012/jev-langchain-harness](https://github.com/dguzman1012/jev-langchain-harness)
- Typed outputs are consumed directly as values, e.g. `response.answers.category.choice` in the JS SDK — [typesafe-sdk-js](https://github.com/typesafe-ai/typesafe-sdk-js)

### Inferences
- The LangChain harness is agent-middleware-shaped (Python); it does not directly translate to a Node app with no agent loop. The transferable idea is "decision node before/after the LLM call", not the code.

### Gaps
- Exact post code and threshold values: page blocked. No JS/TS LangChain equivalent found.

---

## Q2. dev.to (valyuai), flaviocopes.com, mindstudio.ai, Cloudflare docs: patterns and payloads

### Takeaway
None of the four pages could be fetched. The Cloudflare call shape is corroborated by third-party repos; the blogger content is unread.

### Cited Findings
- Cloudflare call shape: `env.AI.run('typesafe/jev', { state, questions })`; needs `[ai]` with `binding = "AI"` in wrangler.toml (snippet) — [Cloudflare docs](https://developers.cloudflare.com/ai/models/typesafe/jev/); corroborated by [flue-jev-demo](https://github.com/matthewp/flue-jev-demo)
- Verbatim from flue-jev-demo README (Cloudflare AI Gateway, no app API key needed):
```typescript
await env.AI.run('typesafe/jev', { state, questions });
```
```typescript
{
  state: "I was charged twice for order A-123",
  questions: {
    intent: { type: 'choice', criteria: {...} },
    isUrgent: { type: 'noul', criteria: {...} }
  }
}
```
  Response includes typed answers, `probabilities`, `confidence`, model version, token usage — [flue-jev-demo](https://github.com/matthewp/flue-jev-demo). Note this fetch was summarized by a small model, so payload shapes are paraphrased; the SDK types below are the authoritative shape.
- Official JS SDK (Node 20+), verbatim from the awesome-list's first-party example:
```javascript
import { choice, noul, TypeSafeClient } from '@typesafe-ai/sdk';

const { answers } = await new TypeSafeClient().systemOne({
  state: { ticket: 'I was charged twice. Please refund the extra payment.' },
  questions: {
    team: choice('Which team should handle this ticket?', {
      billing: 'Payments and refunds',
      technical: 'Bugs and integrations',
      other: 'None of the above',
    }),
    refund: noul('Does the customer explicitly request a refund?'),
  },
});
```
  — [awesome-typesafe-jev](https://github.com/AbdelStark/awesome-typesafe-jev), [typesafe-sdk-js](https://github.com/typesafe-ai/typesafe-sdk-js)
- SDK response types (summarized from `types.ts`): NoulResponse `{type:"noul", noul:number}`; ChoiceResponse `{type:"choice", choice:string, confidence:number, probabilities:{[label]:number}}`; ScoreResponse `{type:"score", score:number, confidence, legend, probabilities}`; SystemOneResult `{model, answers, usage:{input_tokens, output_tokens}}` — [types.ts](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/types.ts)
- A Hono + Cloudflare AI Gateway support-message tutorial exists (not read) — [Charlie Gleason](https://code.charliegleason.com/jev-cloudflare-ai-gateway) (snippet)

### Inferences
- The blogger posts likely restate the same SDK primitives; expect no patterns beyond those in the GitHub material. Unverified.

### Gaps
- All of dev.to/valyuai, flaviocopes, mindstudio guide, Cloudflare doc page: unread. Raw HTTP JSON request/response for `/v1/systemone` not seen verbatim (only via agentgateway example description; see Q3).

---

## Q3. Router / pre-classifier, guardrail / verifier, reranker; before/after numbers

### Takeaway
All three patterns exist as third-party repos. Best-evidenced numbers: judge cost/latency (jevals, Vercel gateway), reranker quality (Hindsight), and cascade cost (Janus). All figures are author-reported on small samples.

### Cited Findings
**Router in front of an LLM**
- jev-router: sends only the user prompt to Jev for tier scoring, maps fast/balanced/strong tiers to Haiku/Sonnet/Opus; explicit user request overrides; low confidence prevents downgrades; fail-open (Jev failure never blocks); caches last 20 decisions; latency only on first request of a turn — [gargpratyush/jev-router](https://github.com/gargpratyush/jev-router)
- Cascade (Jev first, LLM only below threshold), Banking77 500 items: Jev alone 77.8% at $0.0507; DeepSeek alone 78.8% at $0.2207; cascade at threshold 0.67 gives 80.2% at $0.1033 with LLM called on 11.6% of requests. Web of Science 145 classes: Jev 52.8% $0.1006; cascade at 0.37 same 52.8% for $0.1474 (+47% cost, no gain). Author conclusion: "none of the routing parameters measured on the first held on the second" — [Janus RESEARCH.md](https://github.com/FirasSX914/Janus/blob/main/RESEARCH.md)
- LangChain-style router/tool-gate: see Q1.

**Guardrail / verifier after the LLM**
- jevals (Openlayer): faithfulness-type check as one Noul per output sentence; verbatim:
```python
def questions(self, s):
    return {f"c{i}": Noul(f"Is claims[{i}] supported by evidence?")
            for i in range(len(split_sentences(s.final_answer)))}
```
  Reported: Jev via Vercel $0.03 per 1,000 samples, p50 244 ms, p95 371 ms vs Ragas + GPT-4.1-mini $2.60 per 1,000 samples, 22-35 s (20-sample dataset, author-run). Also "9 checks in one request" — [openlayer-ai/jevals](https://github.com/openlayer-ai/jevals)
- agentgateway example: Bun webhook scores jailbreak/harm/secret disclosure 0-3 on the last request message and each response choice via `/v1/systemone`; rejects score >= 2 with HTTP 403. The fetched summary contradicts itself on fail-open vs fail-closed for evaluation errors ("Fail-open on errors" heading, "Evaluation errors block the request" text) — check the source before copying — [agentgateway example](https://github.com/agentgateway/agentgateway/tree/main/examples/llm-guardrail-jev)
- Action-gate study (111 tool-call authorisation cases, Allow/Deny/RequireApproval): Jev 92.2% vs Claude Opus 5 89.7% call-weighted (per-case 90.1% vs 91.9%; McNemar p≈0.75, not a significant difference); p50 376 ms vs 2,479 ms; $0.0000268 vs $0.008648 per decision; errors dominated by contract/policy-mapping gaps — [jev-enterprise-decision-fabric](https://github.com/ghubnab99/jev-enterprise-decision-fabric/blob/main/docs/evaluations/agent-action-gate-v1.md)
- Spring AI 0.1.0 starter implements `JevGuardrailAdvisor`, `JevSelfRefineAdvisor`, `JevDocumentReranker`, `JevToolIndex`, `JevEvaluator`; single question ~275 ms, three questions ~310 ms; vendor benchmark claim "10x to 125x faster" and "22x to 805x cheaper" vs claude-haiku-4-5 and reasoning models — [Spring blog](https://spring.io/blog/2026/09/21/spring-ai-typesafe-structured-judgment/)

**Reranker over candidates**
- Hindsight (agent-memory system): candidates become the options of ONE Choice, "the answer is the ranking"; a separate Score question decides how far down relevance extends (prune). 30 candidates, 200 questions: Recall@1 0.950 vs 0.800, NDCG@10 0.957 vs 0.850, latency 0.027 s vs 0.12 s (MiniLM baseline; per-item figures as reported). Pruning: "Precision goes up 17x; the cost is 19% of gold evidence cut" — [Hindsight PR #4522](https://github.com/vectorize-io/hindsight/pull/4522)
- Independent ordering study: Jev passed 6/6 ranking gates on 360 easy rows (ECE 0.045) but on 306 hard human-graded product-query pairs ECE rose to 0.242 and "choice collapses onto Substitute"; 53 rows tie at 0.99 (two-decimal output = only 45 distinct values); packing 40 rows into one state dropped Spearman to 0.579 — [jev-orderby-bench](https://github.com/yodablocks/jev-orderby-bench/blob/main/README.md)

### Inferences
- For the graphmaker pipeline: "judge faithfulness of phrased sentence vs computed numbers" maps to the jevals per-claim Noul pattern; but state must contain the numbers and sentence, and Jev's "supported" is a learned judgment, not a deterministic check. Since invariants forbid guessing, it could only ever ADD a check on top of the deterministic validators, never replace them. (My inference.)
- "Pick a table from candidates" maps to the Hindsight one-Choice-over-pool pattern (but see Q7 caps and the ESCI failure on hard, near-synonymous candidates — statistical table titles are close to that hard case).

### Gaps
- No published before/after from a real production app; all numbers are benchmark or demo runs by authors.
- Fetch summarisation is by a small model; treat exact figures as needing spot-check against the linked pages.

---

## Q4. How is a "task" defined? Versioning, evaluation, fixtures

### Takeaway
A task is defined per request in code: a `state` (any JSON-ish object/string) plus named typed questions, each with natural-language `instructions` and `criteria` (label -> description). There is no training set and no server-side task registry found; versioning and evals are done by teams in their own repos.

### Cited Findings
- Question types: `noul(instructions, criteria?{true,false})`, `choice(instructions, criteria: label->description)`, `score(instructions, criteria: ≥2 rubric descriptions)`; `instructions` optional — [types.ts](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/types.ts). Note SDK README shows `choice(..., {billing: null, ...})`, so descriptions can be null — [typesafe-sdk-js](https://github.com/typesafe-ai/typesafe-sdk-js)
- Description quality matters: "escalate: 'Irreversible or financial, or arguments not grounded in what the customer asked' works a lot better than 'escalate: high risk'" — [jevals](https://github.com/openlayer-ai/jevals)
- Same YAML eval definitions run offline and in production; `jevals calibrate labeled/tool_calls.jsonl --eval evals/tool_call_risk.yaml --label human_decision`; trace replay — [jevals](https://github.com/openlayer-ai/jevals)
- Committed-fixture pattern: 27 runners calling only Jev returned decisions on committed fixtures against jev-1.13.0 — [kenhuangus/jev-usecases](https://github.com/kenhuangus/jev-usecases) (snippet)
- Incident router: thresholds as code constants in `tools/questions.py`; labelled cases in `data/calibration_cases.jsonl`; tracks misroute rate, review rate, minutes-to-correct — [kyle-chalmers/typesafe-jev-incident-router](https://github.com/kyle-chalmers/typesafe-jev-incident-router)
- Model pinning: SDK `defaultModel` is `"jev-latest"`; a `model` override is accepted in the request body — [client.ts](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/client.ts). Benchmarks cite version "jev-1.13.0" — so pin an explicit version, not `jev-latest`, for reproducible evals (my inference).
- Cache pattern: ordering study caches results locally by content hash — [jev-orderby-bench](https://github.com/yodablocks/jev-orderby-bench/blob/main/README.md)
- Independent benchmarks: JevBench (534 decisions, six families incl. request routing, answer-adequacy judging, policy yes/no, intent, ordinal severity, enum extraction; hard tier frozen and hashed; adapters `typesafe`, `openai_compat`, etc.) — [jevbench](https://github.com/fstandhartinger/jevbench/blob/main/README.md). TypeSafe's own: https://evals.typesafe.ai/ (listed, unread) via [awesome-list](https://github.com/AbdelStark/awesome-typesafe-jev)
- Wording sensitivity: same judgment as yes/no vs 2-option choice differs by 0.125 average probability, 16% of items shift > 0.2; complementary pairs sum 0.71-1.42; question order effect negligible (0.005); 16 questions add 14 ms over one — [jev-calibration-audit](https://github.com/jujumilk3/jev-calibration-audit/blob/main/FINDINGS.md). Paraphrase shifts 0.164 avg vs negation 0.016 on hard tasks — [jev-orderby-bench](https://github.com/yodablocks/jev-orderby-bench/blob/main/README.md)

### Inferences
- Task definitions are just code, so they version with git; the eval story is "labelled JSONL + calibrate script", built by the team. This fits a fixture-recording approach (record request+response per case, replay in CI), but I found no first-party record/replay tool. Wording changes move probabilities, so every question edit needs re-calibration.

### Gaps
- docs.typesafe.ai "patterns"/"primitives"/"cookbooks" unread. Whether TypeSafe offers fine-tuning or task-specific training: not found.

---

## Q5. Confidence thresholds and abstention

### Takeaway
TypeSafe's guidance (snippet) is three bands: act, act with caution/flag, route to human. Integrators use per-action thresholds in code (0.70-0.85 typical) and calibrate on labelled own-traffic data. Calibration is shaky under wording and distribution shift; an explicit "unknown/other" option is essential.

### Cited Findings
- TypeSafe confidence docs (snippet): distinguish an option's probability from the `confidence` statistic; do not interchange them in routing code; three bands act/caution/human — search result citing [TypeSafe docs](https://docs.typesafe.ai/) (unread)
- Incident router: Choice confidence < 0.75 -> review; Score confidence < 0.70 -> review; Noul >= 0.70 forces high-priority review — [incident-router](https://github.com/kyle-chalmers/typesafe-jev-incident-router)
- Spring AI guardrail: > 0.70 hazard applies; 0.35-0.70 REVIEW; < 0.35 pass — [Spring blog](https://spring.io/blog/2026/09/21/spring-ai-typesafe-structured-judgment/)
- Stakes-scaled bars from 0.5 (read balance) to 0.9 (close account); "other" or < 0.5 -> human; recognised-but-under-bar -> confirm with user (snippet from an intent-routing example, source not opened) — [AIsa blog](https://aisa.one/blog/jev-typesafe-ai-agent-decisions) (snippet)
- jevals calibration table: threshold 0.70 gives 93.1% auto-pass, 1.9% wrong passes; 0.85 gives 86.0% auto-pass, 0.3% wrong passes — [jevals](https://github.com/openlayer-ai/jevals)
- Conformal risk control on CLINC150 (460 calibration, 400 held-out): alpha 5% selected threshold 0.831; auto-routed 84.75%, error among routed 2.65%, per-query loss 0.0225. Guarantee broke under out-of-scope/shifted taxonomies ("Exchangeability is the assumption, and it is not free") — [jev-certify](https://github.com/nikkoxgonzales/jev-certify/blob/main/results/REPORT.md)
- Overconfidence: "mildly overconfident"; abstain option matters: without an "unknown" option the model answered unanswerable items with a stereotyped answer at 0.79 confidence; with it, abstains on 95% — [jev-calibration-audit](https://github.com/jujumilk3/jev-calibration-audit/blob/main/FINDINGS.md)
- Ties/quantisation: two-decimal probabilities cause ties (53 rows at 0.99) — [jev-orderby-bench](https://github.com/yodablocks/jev-orderby-bench/blob/main/README.md)
- Optimal thresholds do not transfer between datasets (0.67 vs 0.37) — [Janus](https://github.com/FirasSX914/Janus/blob/main/RESEARCH.md)
- Prompt-injection risk to typed decisions: arXiv "Decision Hijacking: Prompt Injection Attacks on Jev's Typed Probabilistic Decisions" (unread) — [arXiv 2609.28613](https://arxiv.org/pdf/2609.28613) (snippet)

### Inferences
- A workable mapping for graphmaker (my inference, not a TypeSafe recipe): answer if top-choice confidence >= T_high AND margin over runner-up is large; ask clarification in the middle band (Choice with explicit `ambiguous`/`other` option); refuse when "other" wins or confidence low. T must be calibrated on the project's own labelled question set (the repo already has a 20-task benchmark that could seed it) and re-calibrated whenever question wording changes.

### Gaps
- TypeSafe's precise official threshold guidance and any calibration tooling: docs unread.

---

## Q6. Fitting a candidate set that changes per call (50-500 tables)

### Takeaway
Supported natively up to a cap: a Choice takes 2-255 options, and the whole candidate list can be passed per call. Above the cap or token limits, people pack and rank in rounds; nobody in the sources pre-filters with embeddings specifically, but Hindsight's input is already an RRF-ranked list.

### Cited Findings
- Choice option count: min 2, max 255 per question; above that, rank in rounds and rank winners against each other because "probabilities are normalised per call and rounds cannot be concatenated" (snippet) — [Hindsight blog](https://hindsight.vectorize.io/blog/2026/09/24/adding-jev-reranker-what-we-learned) (unread), consistent with [PR #4603](https://github.com/vectorize-io/hindsight/pull/4603)
- Token limits: ~32k tokens per question and 64k per request; Hindsight packs pools of at most 250 options and 26k tokens, truncates outliers, runs groups concurrently, promotes top 12 per group to a finals round; query bounded to 2k tokens; non-finalists keep prior (RRF) order. Long pools that failed 100% before now rerank in about 1 s; short pools ~0.27 s — [PR #4603](https://github.com/vectorize-io/hindsight/pull/4603)
- Dynamic options are just per-request `criteria` maps; nothing needs pre-registering (SDK request is state + questions + optional model) — [client.ts](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/client.ts)
- Spring AI ships `ToolIndex` and document reranker SPIs built on Jev — [Spring blog](https://spring.io/blog/2026/09/21/spring-ai-typesafe-structured-judgment/)
- Hard case warning: on near-synonymous candidates (ESCI substitute/exact) confidence stayed high while accuracy was ~53% — [jev-orderby-bench](https://github.com/yodablocks/jev-orderby-bench/blob/main/README.md)

### Inferences
- 50-500 table titles/descriptions: fits in 1-2 rounds; if descriptions are long, token budget (not the 255 cap) binds first. Cheap first stage (existing lexical/embedding shortlist to <=30-50) plus one Choice is the safest shape and mirrors Hindsight; whether Jev beats the current LLM pick here is unmeasured. Option labels must be stable IDs with human-readable descriptions.

### Gaps
- No published test of Jev on statistics-table selection; embeddings-prefilter-vs-direct comparison not found.

---

## Q7. Operational: streaming, batching, timeouts, retries, SDK, Vercel, Cloudflare

### Takeaway
Single non-streaming JSON call; many questions per request run in parallel for near-free; SDK has timeouts/retries built in; there is a Vercel AI Gateway route with free-tier throttling gotchas. Cold-start/region data not found.

### Cited Findings
- No streaming: Jev generates no text and returns one typed result (single parallel pass) — [LangChain harness summary (snippet)](https://www.langchain.com/blog/building-a-harness-with-jev). No streaming API found in any source.
- Batching questions: 20 yes/no questions in one call 332 ms, same as one; 559 input tokens vs ~20 x 290 (snippet, [jevaiguide](https://jevaiguide.com/jev-rate-limits/)); independent audit: 16 questions add 14 ms — [jev-calibration-audit](https://github.com/jujumilk3/jev-calibration-audit/blob/main/FINDINGS.md). But batching many ROWS into one state hurts ranking (Spearman 0.579) — [jev-orderby-bench](https://github.com/yodablocks/jev-orderby-bench/blob/main/README.md)
- SDK config: `apiKey` (or `TYPESAFE_API_KEY`), `baseURL` default `https://api.typesafe.ai`, `defaultModel` `jev-latest`, `timeout`, custom `fetch`, `logLevel`, `retry` policy (`retry.httpStatuses`, retries on timeout/connection errors, exponential backoff with jitter, honours `Retry-After`), `dangerouslyAllowBrowser` off by default. Errors: `APIError`, `APIConnectionError`, `APIUserAbortError`, `TypeSafeError`. Method: `systemOne<const Q extends Questions>(request, options?: RequestOptions): APIPromise<SystemOneResult<Q>>`. Headers: `Authorization: Bearer`, `User-Agent: typesafe-sdk/{VERSION}` — [client.ts](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/client.ts). Node 20+, ESM+CJS+d.ts — [typesafe-sdk-js](https://github.com/typesafe-ai/typesafe-sdk-js)
- Latency: single question ~275 ms, three ~310 ms (Spring, [source](https://spring.io/blog/2026/09/21/spring-ai-typesafe-structured-judgment/)); p50 244 ms / p95 371 ms via Vercel gateway ([jevals](https://github.com/openlayer-ai/jevals)); p50 376 ms in action-gate study ([source](https://github.com/ghubnab99/jev-enterprise-decision-fabric/blob/main/docs/evaluations/agent-action-gate-v1.md)); vendor says 70-500 ms end to end (snippet).
- Rate limits: reported 1,200 req/min and 250,000 tokens/s for Jev 1.13 on TypeSafe's API, but another snippet says TypeSafe has not published limits; a 131-question batch on Vercel free tier took ~90 minutes due to throttling; forum thread "AI Gateway: typesafe-ai/jev returns free-tier 429 despite paid credits" — [jevaiguide](https://jevaiguide.com/jev-rate-limits/), [Vercel Community](https://community.vercel.com/t/ai-gateway-typesafe-ai-jev-returns-free-tier-429-despite-paid-credits/49935) (snippets, conflicting)
- Pricing: $0.042/M input tokens, output free; no free tier/trial credits documented (snippet) — [refix.ai](https://www.refix.ai/news/jev-pricing-latency-benchmarks/)
- Access doors: first-party API, Vercel AI Gateway (jevals used it), Cloudflare Workers AI/AI Gateway (`env.AI.run('typesafe/jev', ...)`), OpenRouter Decisions API (jev-certify used it), local runtimes (Laya for Node.js: ONNX, ~1.7 GB weights) — [awesome-list](https://github.com/AbdelStark/awesome-typesafe-jev)
- Community TS helper: Advocaat (tagged helpers) — [pithings/advocaat](https://github.com/pithings/advocaat)

### Inferences
- The SDK uses global `fetch`, so it should run on Vercel Node runtime and edge-like runtimes, but no source states Vercel cold-start or region behaviour; measure from your Vercel region (Jev's serving region unknown). Fail-open/fail-closed policy must be chosen per decision (jev-router fail-open; for a "refuse rather than guess" product, fail toward the existing LLM path or a refusal, my inference). Stateless per-request design means no session issues on serverless.

### Gaps
- Serving region, cold-start, streaming, SLA, official rate limits: not found. Cloudflare doc page unread (limits, pricing on Workers AI).

---

## Q8. Case studies and early-access customer stories

### Takeaway
No named production customer exists in the sources found; evidence is builder demos and independent benchmarks.

### Cited Findings
- "TypeSafe hasn't named a single customer using Jev in production" (snippet) — [Pinggy/other aggregators](https://pinggy.io/amp/blog/typesafe_jev_system_one_model_use_cases_vs_llms/)
- First-week builder experiments: 1,700 emails triaged for 18 cents; website AI-slop scan in 243 ms at $0.00015/check; browser agent solving 100% of benchmark tasks at 112x lower model cost than a frontier route (snippet, vendor-adjacent) — [runtimewire](https://runtimewire.com/article/typesafe-jev-system-one-ai-model-early-access)
- Listed projects: BTK SEO audit (1,204 pages, 4,816 judgments, <3 min, $0.0048); Paper Radar (50 papers, 5 s, $0.001957); jev-skip (77% sponsor detection, 23 videos); JevSpan NER (73.7 avg F1) — [awesome-list](https://github.com/AbdelStark/awesome-typesafe-jev)
- Integrations by vendors: Arize "Jev-as-a-Judge" evals (snippet) — [Arize](https://arize.com/blog/llm-guardrails-jev/); Vectorize Hindsight reranker (Q3); Spring AI starter (Q3)
- Where Jev is weak: JevBench ranks Jev 1.13.0 4th (63.29) behind open 4B decision models; TypeSafe says it is not for chat/code generation — [jevbench](https://github.com/fstandhartinger/jevbench/blob/main/README.md)

### Inferences
- Evidence base is thin and mostly self-reported; treat vendor speed/cost multipliers (40-400x) as upper bounds until reproduced on your own tasks.

### Gaps
- Real production case studies; TypeSafe's own customer page and evals.typesafe.ai content unread.

---

## Mapping to the reader's six calls (my inference, labelled)

| Current LLM call | Jev fit per sources | Caveat |
|---|---|---|
| Parse intent | Choice/Noul/Score questions; enum extraction is a JevBench family | Free-text slots (numbers, dates, period names) not producible by Jev; keep LLM or deterministic parser |
| Pick table from candidates | One Choice over up to 255 options (Hindsight) | Near-synonym candidates are the documented failure mode; token cap 32k/question |
| Fit a measure | Same as above | same |
| Ask clarification? | Noul/Choice with explicit `ambiguous` option + three-band threshold | Needs calibration on own labelled set; wording shifts probabilities |
| Judge faithfulness of phrased sentence | Per-claim Noul (jevals pattern) | Additive to deterministic validators only; Jev is a learned judge |
| Generate follow-up chips | Not a fit: needs text generation | Keep LLM (or pick from a deterministic candidate list via Choice) |

Minimal TS shape (my sketch on the documented SDK API; NOT from a source):
```typescript
import { choice, noul, TypeSafeClient } from '@typesafe-ai/sdk';
const client = new TypeSafeClient(); // TYPESAFE_API_KEY, retry/timeout configurable
const { answers } = await client.systemOne({
  state: { question, candidates },
  questions: {
    table: choice('Which table answers the question?', { ...ids, none: 'No candidate fits' }),
    needsClarification: noul('Is the question ambiguous between candidates?'),
  },
});
// answers.table.choice / .confidence / .probabilities ; answers.needsClarification.noul
```
