# Jev (TypeSafe AI) — independent evaluations, criticisms and limits, as of 2026-09-30

Evidence-quality note (read first): the network proxy blocked WebFetch for almost every domain (typesafe.ai, arxiv.org, news.ycombinator.com, dev.to, mindstudio, langchain, wikipedia, huggingface, langwatch, etc.). Only github.com pages could be fetched in full. Everything else below is from WebSearch result summaries (snippet level), not the full page. Items marked [read] were fetched in full; items marked [snippet] were seen only as search summaries and should be re-verified before anyone quotes them. I could not open the HN threads, Reddit, X, or TypeSafe's own launch post/docs; HN content is known only from search snippets. Jev is ~2 weeks old; nearly all "independent" tests are small (n = 100 to a few thousand), single-author blog/GitHub studies, not peer-reviewed. Several are arXiv preprints from the last 2 weeks (not reviewed).

Labels: VENDOR = TypeSafe's own claim; INDEP = independent measurement; OPINION = commentary/argument.

## 1. What TypeSafe publishes, and what has been reproduced or challenged

### Takeaway
TypeSafe's headline numbers (193.6x faster, 444.6x cheaper, "0% hallucination", "competitive intelligence") are best-case figures on workloads designed for Jev. Independent re-measurements find roughly 2x to 7x faster and 9x to 65x cheaper than small/mid LLMs, with accuracy roughly level with small LLMs (Haiku class) and behind frontier models. The "0% hallucination" is a schema-conformance statistic, not an accuracy statistic.

### Cited Findings
- VENDOR: Jev launched 2026-09-15 with $40M seed (DCVC lead, ~$200M valuation per reports); described as non-autoregressive with a "parallel sampler" and a training method called Reinforcement Learning for Calibrated Decisions (RLCD); returns typed decisions with probabilities, not text. — [Morningstar/BusinessWire release](https://www.morningstar.com/news/business-wire/20260915525333/typesafe-ai-emerges-from-stealth-with-40m-in-funding-with-new-model-for-composable-ai) [snippet]; [SiliconANGLE](https://siliconangle.com/2026/09/16/typesafe-ai-exits-stealth-with-40m-to-build-ai-for-use-by-software/) [snippet]
- VENDOR: home-page headline "193.6x faster, 444.6x cheaper"; TypeSafe's own launch post reportedly says these are "on the higher end of real world gains" and they are maxima on System-One-style judgment tasks with a Jev-shaped workflow. — [Ariful Islam, DEV](https://dev.to/arifulislamat/typesafes-jev-model-is-it-really-193x-faster-and-444x-cheaper-56oa) [snippet]; [Tom's Hardware](https://www.tomshardware.com/tech-industry/artificial-intelligence/typesafe-ais-jev-offers-an-alternative-to-llms-that-claims-to-be-193x-faster-and-445x-cheaper-system-one-type-model-is-bespoke-for-probabilistic-decision-making) [snippet]
- VENDOR: "0% hallucination" chart. The launch-post fine print reportedly explains the zero: Jev cannot output anything outside the supplied schema, so TypeSafe counted schema violations, which are always 0. Claude Haiku 4.5 is shown with a 45.5% structured-output error rate on TypeSafe's test. — [Jev limitations/hallucination summary via search](https://www.datacamp.com/blog/system-one-models-jev) [snippet, secondary]; [Layer3 Labs comparison](https://www.layer3labs.io/comparisons/jev-vs-claude-haiku-4-5) [snippet]. Not verified against the primary post (typesafe.ai blocked).
- VENDOR (per secondary sources): price $0.042 per 1M input tokens, output tokens free; 70 ms to 500 ms latency per call. — [MindStudio](https://www.mindstudio.ai/blog/jev-system-one-model-launch) [snippet]; [eesel/HN summary](https://www.eesel.ai/blog/typesafe-jev-review) [snippet]
- OPINION/METHOD CRITIQUE: HN commenters reportedly flagged that TypeSafe's evals grade agreement against an average of other frontier models rather than ground truth. — [eesel summary of HN](https://www.eesel.ai/blog/typesafe-jev-review) [snippet]; HN threads [item 49745752](https://news.ycombinator.com/item?id=49745752), [49767192](https://news.ycombinator.com/item?id=49767192), [49847030](https://news.ycombinator.com/item?id=49847030) [titles only; not opened]
- INDEP (self-measurement, 100 tickets x 4 question types): Jev 4x to 7x faster and 31x to 65x cheaper, not 193x/444x. — [Ariful Islam, DEV](https://dev.to/arifulislamat/typesafes-jev-model-is-it-really-193x-faster-and-444x-cheaper-56oa) [snippet]
- INDEP: 215 self-measurements gave a median 7x speedup; another roundup reports median speedup 7x and median cost reduction 30x across user-published tests; a third reports "we measured 1.7x and 100x". — [KitWorks](https://note.com/kitworks/n/n057d8857b025?hl=en) [snippet]; [TrueStandard](https://truestandard.ai/blog/is-jev-really-193x-faster) [snippet]; [explainx fact-check](https://explainx.ai/blog/jev-speed-cost-claims-fact-check-2026) [snippet]
- INDEP [read]: on 770 Reddit AITA posts, Jev was 6.3x faster than Sonnet 5 (median 0.39 s vs 2.46 s), "not 40-200x"; cost $0.037 vs $2.291 per 1,000 posts (about 62x cheaper); top-1 accuracy 75.4% vs 76.9%, but always answering the majority class "NTA" scores 74%. — [dchristopoulos/jev-aita](https://github.com/dchristopoulos/jev-aita)
- INDEP: Banking77 (77-way intent), 385 messages: Jev 84.9% correct, statistical tie with Claude Haiku 4.5, ~3 points behind Sonnet 5 / Opus 5; Jev ~300 ms vs Haiku 0.8 to 2.2 s. — [Layer3 / onewave / rusanau summaries, snippet](https://rusanau.me/blog/jev-spring-ai-langchain4j/) (title: "Up to 7x Faster, 9 to 21x Cheaper, Not More Accurate")
- INDEP: a test against GPT-5.4 nano, Gemini 3.5 Flash-Lite, Claude Haiku 4.5 and GPT-5.6 Terra on intent routing + prompt-injection detection: Jev about as accurate as the small models, 2.0x to 3.6x faster at the median, not better than Terra (5 points ahead on 77-way routing). — [LangWatch](https://langwatch.ai/compare/jev-benchmark) [snippet]
- INDEP: an "independent tests after eight days" write-up concludes Jev is "level with mid-price LLMs, behind the frontier". — [DEV/AWS builders](https://dev.to/aws-builders/jev-after-eight-days-of-independent-tests-level-with-mid-price-llms-behind-the-frontier-1c60) [title + snippet]
- INDEP: "I benchmarked Jev against open CPU-only stacks. It won by 0.6 points." — [HF blog, dylantom2012](https://huggingface.co/blog/dylantom2012/i-benchmarked-jev-against-open-cpu-only-stacks-it) [title only]

### Inferences
- Plan on roughly 3x to 7x latency gain and 10x to 60x cost gain versus a small LLM, not 100x+. Absolute cost is a non-issue for graphmaker either way (a Haiku-class parse call is already fractions of a cent), so cost is not a reason to switch.
- Accuracy is at "small LLM" parity on generic intent routing; nobody found it clearly better than Haiku-class.

### Gaps
- No primary TypeSafe post/docs could be read (blocked). No reproduction of TypeSafe's own benchmark suite with ground-truth labels was found. HN/Reddit/X threads not read directly.

## 2. Calibration of the probabilities

### Takeaway
The best evidence says: NOT reliably calibrated out-of-the-box on new tasks. Roughly calibrated in-distribution on public QA benchmarks (which Jev may have seen), mis-calibrated in a type-dependent direction on novel tasks, and it collapses on tasks with no learnable signal. Post-hoc recalibration on your own labelled data fixes most of it. For a "refuse when unsure" product, a per-task threshold calibrated on local data is mandatory; the raw number cannot be read as "60% sure".

### Cited Findings
- INDEP [read]: out-of-distribution test (900 rule-generated tickets; choice / score / boolean): pooled ECE 0.107 = 4.4x the noise floor (0.024). Queue choice: acc 89.0%, ECE 0.082, overconfident. Boolean ("angry"): acc 91.7%, ECE 0.079, UNDERconfident. Priority score: acc 44.7%, ECE 0.325, overconfident on an unknowable rule. Public benchmarks (likely seen in training): OpenBookQA acc 94.2% ECE 0.024; CommonsenseQA 88.1% / 0.032; HellaSwag 86.1% / 0.029. Probabilities are quantised to 0.01 and often exactly 0 or 1; one item gave the correct answer 0.00 while another got 0.99. Repo's own conclusion: human routing thresholds are unsafe without local recalibration. — [scienthoon/jev-ood-calibration](https://github.com/scienthoon/jev-ood-calibration)
- INDEP (snippet of same repo): median ECE 0.157 on social-science tasks beats 16 of 19 LLMs raw, but once every model gets one fitted temperature, 15 of those LLMs beat Jev. Pooled ECE across benchmarks 0.047 (calibrated in aggregate, not within a benchmark). — [scienthoon summary via search](https://github.com/scienthoon/jev-ood-calibration) [snippet]
- INDEP [read, curated index of repos; I read only the index summaries, not each linked repo]: 
  - 123,805 pre-registered requests: calibration holds on support routing (ECE 0.075) but collapses on random 3-SAT where probability barely moves while the true rate spans 0 to 1 (willkelly/jev-evaluation).
  - Stated ~75% confidence but only 10% of civil_comments human-flagged; two-parameter recalibration removes 96% of the error (Adilmp/does-jev-confidence-mean-anything).
  - Boolean type stated 79.0% vs 72.3% actual; Choice type 91.4% stated vs 76.1% actual (Anthus post).
  - Removing the abstain option: KoBBQ accuracy 0.950 -> 0.000, ECE 0.023 -> 0.793 (jujumilk3/jev-calibration-audit).
  - P(x)+P(not x) ranges 0.93 to 1.19 across 20 negation pairs (colinmcnamara/jev-first-look): probabilities are not internally coherent.
  - Repeated identical calls differ by 0.03 to 0.04 in probability (copyleftdev/jev-labs).
  — [awesome-jev-robustness index](https://github.com/Yifan-Lan/awesome-jev-robustness)
- INDEP [snippet, unverified for Jev]: "isotonic calibration cuts ECE from 0.1235 to 0.0077" appeared in a search summary attributed to Jev. The repo I could actually read for this (rcpeken/jev-calibration) tests Qwen3 0.6B/1.7B/4B, NOT the Jev API, and reports its own temperature-scaling gains for those Qwen models. Do not attribute that isotonic number to Jev. — [rcpeken/jev-calibration](https://github.com/rcpeken/jev-calibration) [read]
- INDEP [snippet]: preprint "JEV-as-a-Judge: Accept When Confident, Escalate When Unsure" tests confidence-gated escalation (the pattern graphmaker wants). — [arXiv 2609.26550](https://arxiv.org/pdf/2609.26550) [title only]
- INDEP [snippet]: Claude Haiku scored ECE 0.097 vs Jev 0.154 on phishing emails (referenced in an exploration ledger, not a head-to-head repo). — [scienthoon repo](https://github.com/scienthoon/jev-ood-calibration) [read; secondary mention]
- VENDOR: RLCD training method claimed to produce "epistemically honest probabilities"; method unpublished. — [SiliconANGLE](https://siliconangle.com/2026/09/16/typesafe-ai-exits-stealth-with-40m-to-build-ai-for-use-by-software/) [snippet]

### Inferences
- Use Jev's probability as a RANKING signal, and calibrate a threshold on your own labelled Dutch questions (isotonic/temperature per question type). Treat "choice" and "score" as overconfident and "boolean" as underconfident until shown otherwise.
- Always include an explicit abstain/"none of these" option; the abstain-removal result shows a forced choice with no abstain is catastrophic for a refusal-first product.

### Gaps
- No calibration measurement on Dutch, on statistics/tabular-metadata tasks, or on CBS-like table selection. No head-to-head ECE against Haiku/GPT-mini with the same recalibration except the scattered snippets above. TypeSafe has not published RLCD or its own calibration curves that I could find.

## 3. Known failure modes

### Takeaway
TypeSafe's own limitation list plus independent tests agree: no arithmetic, counting, sorting or date ordering; reads questions literally; degrades with irrelevant/long context; weak on multi-hop reasoning; highly sensitive to question wording and decomposition; and unusually robust to prompt injection in one test but badly susceptible in others.

### Cited Findings
- VENDOR (docs list, via secondary): cannot count reliably, struggles with maths and date comparison ("can read dates as text but does not reliably treat them as ordered values"), loses accuracy on multi-layer indirect reasoning, context rot from irrelevant text; does not write, summarise, translate, chat or explain; keep exact calculation in code. — [orcarouter "Where Jev 1.13 Breaks"](https://www.orcarouter.ai/blog/jev-limitations) [snippet]; [Layer3 Jev limits](https://www.layer3labs.io/guides/jev-limits) [snippet]; [typesafe-jev.com limitations](https://typesafe-jev.com/en/limitations/) [snippet]
- VENDOR/limits: text state capped at ~32,000 tokens (~150,000 characters), 64,000 tokens per request total; choice questions accept up to 255 options; rate limit 1,200 req/min and 250,000 tokens/s in early access, adjusted dynamically. — [OpenTweet limits](https://opentweet.io/jev/limits) [snippet]; [runware summary](https://runware.ai/blog/jev-laya-and-the-emerging-role-of-decision-models) [snippet]; [Models docs](https://docs.typesafe.ai/models) [snippet]
- INDEP: arithmetic accuracy 88% with correct option listed first vs 57.4% when last (11,621 requests) = position bias on many options. — [awesome-jev-robustness index](https://github.com/Yifan-Lan/awesome-jev-robustness) (RINNECODER/jev-behavior-study) [read index]
- INDEP: first-listed option gains +0.37 probability on ambiguous questions; 96.5% accuracy on clear contexts. Reversing two options moves probability 0.005 on most tasks. — same index (pawarbi/jev-bias-audit, calibration-audit)
- INDEP: ~8,400 calls confirm vendor-documented failures (count/sort/add). — same index (dopeCape/typesafe-ai-test)
- INDEP: wording sensitivity: criteria wording moves paired accuracy from 70% to 96%. — same index (RastislavDujava/jev-classification-prompting)
- INDEP [read]: phishing detection: one bare question 61.8% to 62.6%; with 5 split questions + weights fitted on labels 95.0% to 95.2% (Haiku 81.3% single-question and 93.2% with the same decomposition per another summary). Adding a definition gave +28.3 points on emails but HURT the open encoder on tweets (-11.0). "Split + fit never hurt significantly." Cost of the study ~$0.07 to $0.11. — [betulsimsek/jev-decomposition-tr](https://github.com/betulsimsek/jev-decomposition-tr); phishing 62.6% vs Haiku 81.3% and 95.0% vs 93.2%: [Daily Brief](https://www.beri.net/article/typesafe-jev-typed-decision-model-calibration-decomposition-shadow-eval) [snippet]
- INDEP: prompt injection: 96.5% baseline falls to 26.5% under an injected one-line instruction on 486 Wikipedia deletion discussions (zkousama/jagged); 61.4% of 508 items flipped with fluent added context (xzx34/JevOut); yet 1 flip in 1,056 attacks in another bench (cwhy/decision-injection-bench). Results conflict by attack style. — [awesome-jev-robustness index](https://github.com/Yifan-Lan/awesome-jev-robustness)
- INDEP: hallucinated tool calls on 76% of When2Call "no-tool" cases when forced to choose; on Meta's AbstentionBench a mean abstention F1 of 0.855 with an explicit abstain option. — same index
- INDEP: reported with LLM judges: "cheaper, faster, and wrong in the same places" (Rao and Callison-Burch, UPenn, arXiv 2026-09-24): LLM judges cost 29x to 325x more and take 30x to 220x longer; Jev significantly differs from an LLM judge in only 8 of 27 paired comparisons, ahead mostly on binary criteria, behind on graded ones; LLM judges repeat nearly all of Jev's most confident errors, so a cascade gains at most 1.5 points. — [arXiv 2609.29769](https://arxiv.org/abs/2609.29769) [snippet]
- Domain-specific preprints exist (radiology report factuality, medicine, ABSA, pentest): contents not read. — [2609.27607](https://arxiv.org/pdf/2609.27607), [2609.34024](https://arxiv.org/html/2609.34024v1), [2609.35293](https://arxiv.org/html/2609.35293), [2609.28940](https://arxiv.org/pdf/2609.28940) [titles only]

### Inferences
- For graphmaker-style jobs: extracting numbers/dates (period parsing, "between 2019 and 2022") is exactly where TypeSafe itself says not to trust it; keep that in deterministic code. Judging "does this sentence contradict these numbers" requires number comparison, which is a listed weakness. The ~1 to 2 points "gain from cascade" result suggests Jev's confident errors coincide with LLM confident errors, so it is not an independent second opinion.
- Many candidate options (tables) are supported up to 255, but position bias evidence means candidates should be shuffled/order-averaged.

### Gaps
- No test on long candidate-list retrieval-style table selection with real catalogue metadata; no test on numbers-in-text contradiction judgement specifically; no test with adversarial/ambiguous statistical questions.

## 4. Language coverage, Dutch in particular

### Takeaway
No Dutch evidence exists. TypeSafe says English is the primary training language and non-English is handled "not equally well" and should be tested on your own content; no multilingual evaluation is published.

### Cited Findings
- VENDOR (via secondary docs summary): English is where accuracy is best; other languages incl. CJK handled but less well; test on your own content. TypeSafe has not published a multilingual evaluation. — [search summary of docs](https://docs.typesafe.ai/models) [snippet]; [ChatMaxima](https://chatmaxima.com/blog/typesafe-jev-system-one-model/) [snippet]
- INDEP [read]: English vs Turkish on offensive-language tweets: Jev bare 0.693 (EN) vs 0.813 (TR); split+fitted 0.759 vs 0.836. Decomposition helped less in Turkish (1 to 2 points vs 5 to 6 in English). Closest available non-English data point; Turkish is not Dutch, and n = 1,000 per language for one task. — [betulsimsek/jev-decomposition-tr](https://github.com/betulsimsek/jev-decomposition-tr)
- OPINION: Laya, an open non-autoregressive encoder, is described as supporting 100+ languages, running locally in ~33 ms per decision. — [regolo.ai](https://regolo.ai/jev-and-system-one-models-benchmarks-open-source-alternatives-and-when-to-use-them/) [snippet]; [runware](https://runware.ai/blog/jev-laya-and-the-emerging-role-of-decision-models) [snippet: "language coverage does not guarantee equal quality in every language"]

### Inferences
- The Turkish result shows non-English can work on some tasks, but says nothing about Dutch statistical vocabulary (CBS terms, region names like "Land van Cuijk", period phrases such as "eerste kwartaal 2024").

### Gaps
- Zero Dutch measurements found in any source. A Dutch, CBS-specific eval set would be the only way to know.

## 5. Architecture framing, criticism, prior art, research paper

### Takeaway
No TypeSafe technical paper or model card was found; RLCD and the "parallel sampler" architecture are unpublished and weights are closed. Commentators frame it as the return of discriminative/classifier models with an LLM-like zero-shot interface; critics stress that "System One" is a marketing analogy and that the real value is the typed, single-pass interface plus calibration, which is unproven.

### Cited Findings
- VENDOR: framed as "System One" (fast intuitive judgement) vs LLM "System Two" text generation; founder Diego Almeida, ex-OpenAI (RLHF/ChatGPT co-creator per press). — [Wikipedia summary via search](https://en.wikipedia.org/wiki/Jev_(AI_model)) [snippet]; [TypeSafe launch post](https://typesafe.ai/blog/introducing-system-one-models-and-jev) [not readable]
- INDEP: no arXiv paper from TypeSafe found; the arXiv items found are third-party evaluations. — see section 3 links.
- OPINION: "Laya, Jev and the Return of the Discriminative Model" and "Jev and the comeback of classifiers" argue this is a repackaged encoder/classifier approach. — [Maier, Substack](https://akmaier.substack.com/p/laya-jev-and-the-return-of-the-discriminative) [title only]; [AI-ML Companion](https://aimlcompanion.ai/blog/jev-system-one-model-classifier-returns-2026) [title only]
- OPINION [snippet]: with Jev "writing the questions is most of the work of building the classifier"; accuracy and calibration "come from how you break the decision down, the labels you check it against and the per-question fit you maintain". — [XenoSpectrum](https://xenospectrum.com/en/jev-typesafe-bert-classifier-decomposition/)
- Prior art (general, not Jev-specific): non-autoregressive semantic parsing exists in patent/lit (e.g. span pointer networks for task-oriented parsing). — [USPTO PDF](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12045568) [snippet]. Open reimplementation attempts: [kyegomez/open-jev](https://github.com/kyegomez/open-jev) (in the phishing test OpenJev split+fit scored 0.824 vs Jev 0.952: [decomposition-tr](https://github.com/betulsimsek/jev-decomposition-tr) [read]).
- Claim on a comparison to Laya (0.766 vs Jev 0.727) is reported to carry no source for the Jev figure. — [regolo.ai](https://regolo.ai/jev-and-system-one-models-benchmarks-open-source-alternatives-and-when-to-use-them/) [snippet]

### Inferences
- Because the mechanism is undisclosed, nothing predicts where it will fail; only empirical local testing helps.

### Gaps
- Could not read HN critique threads, Wikipedia references, the founders' technical statements, or Reddit r/MachineLearning / r/LocalLLaMA (no Reddit results surfaced at all).

## 6. Vendor risk

### Takeaway
Hosted-only, closed weights, waitlist early access, no fine-tuning, dynamic rate limits, a two-week-old company. I found no deprecation/SLA policy. Mitigations exist (versioned model IDs, an MIT typed-decision adapter, access through Vercel AI Gateway).

### Cited Findings
- Early access, waitlisted API key on the direct API since 2026-09-15; also available via Vercel AI Gateway. Weights unpublished, cannot be self-hosted; no fine-tuning path. — [Failproof AI](https://befailproof.ai/jev/is-jev-open-source/) [snippet]; [OrcaRouter](https://www.orcarouter.ai/blog/jev-open-source) [snippet]; [eesel](https://www.eesel.ai/blog/typesafe-jev-review) [snippet: Vercel says fastest-adopted model on AI Gateway; vendor-adjacent claim]
- Response carries a versioned model ID; advice is to pin the version and re-tune thresholds when moving. — [search summary of docs](https://docs.typesafe.ai/models) [snippet]
- Rate limits "adjusted dynamically during early access". — [OpenTweet](https://opentweet.io/jev/limits) [snippet]
- Company: $40M seed, DCVC lead, ~$200M valuation; reports of talks for a much larger round at $10B valuation (speculative, press). — [Yahoo Finance](https://finance.yahoo.com/technology/ai/articles/typesafe-ai-emerges-stealth-40m-190000776.html) [snippet]; [remio.ai](https://www.remio.ai/post/typesafe-ai-funding-talks-test-whether-jev-can-justify-a-10-billion-valuation) [snippet, low-quality source]
- Search for a deprecation policy returned nothing specific. — search summary only.

### Inferences
- A per-version calibrated threshold means any silent/aliased model update would invalidate the refusal cutoff; you must pin versions and re-run a regression set on every version change.

### Gaps
- No SLA, deprecation window, data-retention/EU-region/GDPR terms found (relevant for graphmaker's GDPR posture). Terms of service not read.

## 7. Same-job comparison: Jev vs alternatives

### Takeaway
Nobody has published a like-for-like test on the four graphmaker jobs. The available evidence supports: intent classification is at parity with Haiku-class and behind frontier; slot extraction and numeric contradiction are outside Jev's stated strengths; candidate selection/reranking has one vendor-adjacent demo and no independent rerank benchmark against cross-encoders; a fine-tuned small model comparison exists only as decomposition studies on other tasks.

### Cited Findings
- Intent classification (Banking77, 77 classes): Jev 84.9% ~ Haiku 4.5 (tie), Sonnet 5/Opus 5 +3 points, GPT-5.6 Terra +5 points; latency ~300 ms vs 0.8 to 2.2 s; cost about 45x lower than Haiku at list price on a 135-item test. — [rusanau](https://rusanau.me/blog/jev-spring-ai-langchain4j/), [LangWatch](https://langwatch.ai/compare/jev-benchmark), [Layer3](https://www.layer3labs.io/comparisons/jev-vs-claude-haiku-4-5) [all snippets]
- Structured output: Jev cannot produce invalid JSON/enum by construction; the "Haiku 45.5% structured-output error" figure is VENDOR and predates/ignores constrained decoding; provider-native structured outputs (Anthropic, OpenAI) with constrained decoding also guarantee schema validity, so this advantage is smaller than the chart implies. — [Layer3 comparison](https://www.layer3labs.io/comparisons/jev-vs-claude-haiku-4-5) [snippet]. I did not verify the provider docs in this session.
- Candidate reranking: a MindStudio demo shows BM25 top-1 21% -> 54% with Jev as reranker; cost/speed tracked Flash-Lite at small chunks, flatter as chunk size grows. No comparison to cross-encoders or Cohere Rerank found. — [MindStudio](https://www.mindstudio.ai/blog/jev-reranker-rag) [snippet, vendor-friendly blog]
- Fine-tuned small models: fitted Jev-decomposition matches or slightly trails open encoders/LLMs on tweets (Laya and Qwen3.5-9B ~0.76 EN / ~0.84 TR vs Jev 0.759 / 0.836); Jev wins on phishing (0.952 vs Laya 0.897). — [betulsimsek/jev-decomposition-tr](https://github.com/betulsimsek/jev-decomposition-tr) [read]
- BERT-style classifiers: Jev vs BERT on Kyoto-ben intent classification and Jev vs BERT/zero-shot NLI benchmark articles exist but were not read. — [AWS Builder Center](https://builder.aws.com/content/3JcBTYjvqJbHO2D6e72S9pPZ41d/jev-vs-bert-on-kyoto-ben-intent-classification-measured), [MindStudio](https://www.mindstudio.ai/blog/jev-vs-classic-classifiers-benchmark) [titles only]
- Contradiction/consistency judging: closest evidence is the rubric-judge preprint (section 3): Jev good on binary criteria, worse on graded; errors correlate with LLM errors. — [arXiv 2609.29769](https://arxiv.org/abs/2609.29769) [snippet]
- Slot extraction (period/region/measure): no evidence found; Jev returns choices/booleans/scores over supplied options, not free extraction. TypeSafe's own list says dates are not reliably treated as ordered values. — [orcarouter](https://www.orcarouter.ai/blog/jev-limitations) [snippet]

### Inferences
- The lowest-risk Jev-shaped jobs for graphmaker are (a) coarse intent/refusal-category routing and (b) boolean gates ("is this asking about a forecast / causation / opinion?"), each with explicit abstain and locally calibrated thresholds. Table selection needs a local test against a cross-encoder/embedding baseline; extraction and number-vs-sentence contradiction should stay in deterministic code.
- Because Jev is only level with Haiku on accuracy and cost is already tiny, the practical case for Jev is latency (~0.3 s) and calibration-if-proven, not accuracy.

### Gaps
- No same-task, same-data comparison versus cross-encoder rerankers (Cohere Rerank, sentence-transformers) or fine-tuned small Dutch classifiers. No Dutch data. No independent per-call latency percentile data (p95/p99) or availability data during early access. Nothing on how Jev handles CBS-style table metadata as candidates.
