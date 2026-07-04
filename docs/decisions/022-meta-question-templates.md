# ADR 022 — Meta-question templates: a deterministic post-classification router (WP18)

**Status:** accepted (2026-07-04, session 18/WP18)
**Context docs:** [validation-results-2026-07-05.md](../validation-results-2026-07-05.md) finding F3; [05-data-rules.md](../05-data-rules.md) failure-behaviour table; ADR [015](015-refusal-clarification-composition.md) (deterministic templates only); ADR [012](012-intent-parsing-llm-harness.md) (fixture honesty)

## 1. Context

The validation pass found (F3) that genuinely meta questions about the product — "welke bronnen gebruik je?" (V38), "hoe ga je om met ontbrekende waarden?" (V37), "wanneer zijn deze cijfers voor het laatst bijgewerkt?" (V36) — got the identical two-sentence smalltalk deflection as "hallo". The LLM intent parser classifies all of these into one flat `smalltalk_or_other` bucket (deliberately: it keeps the classification contract small), and WP9's composition gave that bucket exactly one template. Honest, but blunt: 11 of the 38 validation questions hit it, and "wat kun je?" is every new user's first question.

## 2. Decision

A **deterministic router that runs only after — and inside — the smalltalk classification**:

1. `src/answer/respond/meta.ts` holds an ordered, **exported** `META_TEMPLATES` table: five templates (`sources`, `missing_values`, `freshness`, `reliability`, `capabilities`), each with Dutch match patterns, **embedded example phrasings** (the validation-pass questions verbatim where one exists), and a static body builder. First match in table order wins; specific cues before broad ones.
2. `buildSmalltalkRefusal` (refusals.ts) consults `matchMetaTemplate(question)`. A hit builds the template body + the existing example-question offer with **reason `'meta'`** (a new `RefusalReason` value); a miss keeps the generic smalltalk template byte-identically. Nothing else calls the router.
3. The response stays a **refusal-kind `ComposedResponse`**. The envelope taxonomy reads "refusal" while the text answers the question — a documented semantic wrinkle, accepted for the structural reasons in §4.
4. Matching normalizes with the belt's own `normalizeForScan` (NFKC + zero-width strip; session-16 lesson) plus lowercase.
5. **Clarify-reply subtlety:** on a reply round, `ParseOutcome.question` deliberately echoes the ORIGINAL question (clarify.ts) while a smalltalk classification belongs to the REPLY (the abandon rule). `buildParseRefusal` therefore takes an optional `metaMatchText`; the reply call site passes the reply text. Found by the pipeline test on first run, not in production.

### Why the safety argument is structural, not behavioral

- A data question can never reach these patterns: the parser already routed it to `data_query`. A router misroute can only ever swap one true product statement for another — there is no fabrication surface by construction.
- Bodies are static strings plus one structured interpolation (the registry topic list). No LLM (ADR 015 unchanged), no cell values in reach (the builders' inputs carry none, same as every refusal builder).
- The table is exported **with its examples**, and the test suite sweeps the table itself: every template needs ≥2 examples, every example must route to its own template (order-honesty — this catches shadowing), every built text is bound byte-exactly to its template body (the WP8 membership-vs-binding lesson), and every built text passes the no-numbers belt against a structured-sources whitelist. A template added later is swept automatically or fails tests by construction — the session-16 lesson that a hand-enumerated belt goes stale.

### Billing and audit consequences (verified, none required code changes)

- `gate.ts` refunds any non-answer in full → meta answers cost 0 credits automatically. Correct product behavior: product help is free (only an intent-parse ran).
- Audit rows store the envelope verbatim; reconstruction applies structural envelope-consistency checks to refusal rows (never text re-derivation, ADR 016 §4), so historical rows are untouched and new meta rows need nothing new. `refusal_reason` is an unconstrained `text` column — no migration.
- The web UI branches only on envelope kind, never on reason — zero web changes.

## 3. Alternatives rejected

1. **Extend the LLM classification** (new `QuestionKind` values or a meta-subtype field). Rejected: any prompt/schema change forces re-recording all 54 intent + 7 clarify + 18 follow-up fixtures plus a live calibration window (~€1+, owner-confirmed spend), and ripples the taxonomy through schema/prompt/types/parse/tests. The accuracy it would buy is not needed — within-bucket misroutes are harmless by construction (§2). **Revisit** if the template set outgrows keyword matching (~10+ templates) or live misroutes are observed.
2. **Pre-parse keyword router** (before the LLM, saving the parse call for meta questions). Rejected: it would run on every question, including real data questions — "welke bronnen van energie zijn er?", "hoeveel woningen ontbreken er?" — where a false positive hijacks a data question into a meta answer. That failure class is exactly what routing *inside* the smalltalk bucket makes impossible.
3. **A new ComposedResponse kind** (`meta` as a fourth envelope kind, or answer-kind with synthetic backing). Rejected: answer-kind triggers byte-identical body re-derivation in R8 reconstruction (needs `ValidatedResult` backing that meta answers don't have); a fourth kind ripples through the audit promoted columns, reconstruction pairing checks, the billing gate's kind branching, and the web UI. The refusal envelope already carries everything needed.

## 4. Trade-offs accepted

- **"Refusal" naming:** rows/envelopes for meta answers say `kind: 'refusal', reason: 'meta'` even though the user experiences an answer. Measured against the ripple of a new kind (rejected alternative 3), the wrinkle is cheap and the reason value keeps rows distinguishable and measurable.
- **Pattern maintenance:** the Dutch pattern lists will grow. Bounded by the safety argument and by the exported-table test discipline; first-contact evidence it works: the order-honesty test caught a real Dutch stem-alternation bug (`ontbreekt` vs `ontbrekende`) on its first run.
- **"0 credits" caption:** the chat shows the cost caption on meta answers (netCost 0) exactly as it already did on every free outcome — pre-existing WP17 behavior, not changed here.
- **V35/V36 stay generic-truthful:** "uit welke CBS-tabel komt deze grafiek?" gets the sources/freshness template (true: the attribution under every answer names table + sync date) rather than naming the actual table of the previous answer. A referent-aware meta answer would need WP15 context integration — deliberately out of v1 scope; revisit trigger below.

## 5. Revisit triggers

- Live misroutes observed (a meta question getting the wrong template, or non-meta smalltalk matching a pattern in a way that confuses) → tune patterns; past ~10 templates → reconsider alternative 1.
- Referent-aware meta answers (V35/V36: naming the actual table/sync date of the previous answer) → design with the WP15 `ConversationContext`, as its own scoped change.
- The labelled sets (`s-hallo`, `c-b15-smalltalk-abandon`, `f-meta-v35/36/38`) pin parser outcomes only; if a future change wants those phrasings classified differently, their labels are product-policy decisions per the sets' own notes.

## 6. Adversarial review (house rule)

Full scoreboard in [STATUS.md](../STATUS.md)'s session-19 entry: 5 lenses → 8 findings → 2 skeptics each (one executing in an isolated worktree, one judging), 21 mid-tier agents. Load-bearing outcomes recorded here:

- **Template priority is a reviewed decision, not an accident (HIGH, double-confirmed, fixed):** first-match-wins originally let a co-occurring 'bron' cue route "Is de bron die je gebruikt wel betrouwbaar of verzin je die?" to the sources template — never answering the fabrication half, which is misleading by omission and contradicted §2's own misroute-harmlessness argument. The order is now missing_values → reliability → freshness → sources → capabilities (safety-relevant answer wins a compound question), and every priority edge is pinned by a dual-cue example in the WINNER's `examples` list, which the order-honesty test enforces.
- **NFKC does not fold ü→u (MEDIUM, double-confirmed, fixed):** the freshness pattern claimed `geüpdatet` coverage it didn't have; now `/[uü]pdat/` with a pinned example.
- **Belt whitelist narrowed (LOW, double-confirmed with executed proof, fixed):** pooling all 8 measures' freshest periods pre-approved a wrong-measure substitution in the offer; the meta belt sweep now whitelists only the measure `exampleQuestionNl` actually resolves.
- **Dead-verifier rule applied (both skeptics died on a structured-output retry cap — same class as session 16):** the finding — the body-binding test recomputes its expectation from the same table, so a body duplicated across two templates passes it — was verified BY THE SESSION by hand: real. Closed with per-template content pins whose fragments live in the test file (independent of meta.ts) plus a pairwise-distinct-bodies assertion; proven by punch-a-hole (a deliberately duplicated body failed the new test; reverted).
- **Split verdict judged no-change (session):** the pipeline test's per-case reason override (`c-b15-smalltalk-abandon` → `meta`) is a reviewed product-policy pin per the labelled set's own note policy; deriving the expectation by running `matchMetaTemplate` inside the test would test the router with itself and silently follow its bugs. The failure mode of the current shape is loud (a new smalltalk-kind case without an override fails visibly), which is the correct direction.
- **One double-refuted:** "the distinct-RefusalReason enumeration test wasn't extended for 'meta'" — refuted; that test pins the refusalKind→reason MAPPING for default (non-meta) questions, where 'meta' is deliberately unreachable.
