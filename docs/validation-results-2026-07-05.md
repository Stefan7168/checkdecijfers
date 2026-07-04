# Validation-pass results & architecture-decision memo — 2026-07-05 (overnight session)

**What this is:** the measured results of running all 38 owner-authored validation questions ([validation-questions.md](validation-questions.md)) against the real pipeline, and the architecture-decision memo they feed into Phase 1 planning ([STATUS.md](STATUS.md) "Next up"). Analysis in English per convention; question texts stay in the owner's Dutch.

**How it was run (2026-07-04, late evening):** `npm run validation:run` ([scripts/run-validation-pass.ts](../scripts/run-validation-pass.ts), added this session) — the WP11 live-benchmark pattern (ADR [017](decisions/017-live-benchmark-run.md)): the real audited entry point `answerQuestionAudited`, the live Supabase database, real Anthropic calls, one flow per question, sequential, no retries. Reference date **2026-07-04** (Europe/Amsterdam — mirrors the deployed app's clock, not the benchmark's pinned one, because this pass validates real-world behaviour, not a frozen key). Clarifications were recorded **as the outcome** — no reply rounds (the one-round reply merge was already measured live 7/7, zero flips ×3, in WP9; re-measuring it would double spend for no new signal).

**Provenance:** audit rows **36–73** in the live `audit_answers` (kept, same policy as ADR 017 decision 3; [open-questions #44](open-questions.md) — tagging — is now more relevant, see below). Per-question dump: `benchmark/validation-run.json` (gitignored, regenerable only by re-spending; this memo is the committed record).

**Spend, measured from the run's own audit rows:** Haiku 4.5: 38 calls, 174,296 in / 4,194 out; Sonnet 5: 3 calls, 4,374 in / 149 out ≈ **$0.21 ≈ €0.18** (Sonnet 5 introductory pricing basis, same as WP11). Within the predicted €0.20–0.40. Latency — two measurement layers, deliberately both stated (this session's review caught the first draft citing one without naming it): as recorded on the audit rows' `latency_ms` (the R8 pipeline measurement, taken *before* the audit insert): median 2,570 ms / max 10,903 ms; script wall-clock around the whole audited call (what `benchmark/validation-run.json` records, *includes* the audit insert): median 2,783.5 ms / max 11,148 ms. Refusals/clarifications are Haiku-only, hence the low medians.

## Headline results

| Measure | Result |
|---|---|
| Fabricated numbers | **0 of 38 — machine-verified**: `reconstructionReport` re-run over all 38 stored audit rows (rows 36–73), 38/38 reconstruct clean — every numeric token in every response traces to stored results/derivations or structural attribution fields. **Re-runnable by anyone with the database credentials: `npm run audit:verify -- 36 73`** ([scripts/verify-audit-rows.ts](../scripts/verify-audit-rows.ts), added after this session's review flagged the claim as artifact-less; zero LLM cost, read-only) |
| Outcomes | 2 answers · 11 clarifications · 25 refusals (8 scope, 11 smalltalk, 1 each causal/compound/forecast/outside-slice, **2 internal errors**) |
| Correct-and-honest | **36 of 38.** The 2 exceptions (V01, V28 — same bug) produced an honest catch-all refusal with zero data values, but via an *error path*, not a designed outcome — a real Phase 0 bug, **fixed + test-pinned the same night** (see Finding F1) |
| Predictions ([validation-questions.md](validation-questions.md)) | Broadly confirmed. Two genuine surprises: the "sinds {jaar}" bug (predicted answer, got error), and Category 2's regional probes resolving to *honest limits* rather than answers (the predicted-possible outcome the file called "the key Phase-1 signal") |

## Per-question outcomes (compact; full envelopes in audit rows 36–73)

| # | Question (abbrev.) | Outcome | Correct & honest? |
|---|---|---|---|
| V01 | werkloosheid sinds 2015 | refusal/**internal** | ✗ error path — **bug F1, fixed same night** |
| V02 | inflatie nu vs 5 jaar geleden | clarify (echo: "meest recente cijfer") | ✓ honest; comparison half silently dropped from the echo (signal 4) |
| V03 | inwoners op dit moment | **answer**: 18.130.208 op 1-1-2026, Definitief, 03759ned | ✓ |
| V04 | gemiddeld inkomen per huishouden | **answer**: 60,2 (× 1 000 euro), 2024, *voorlopig*, 83932NED | ✓ — via the R3 ladder's template fallback (Finding F5); factor unit kept per #42 |
| V05 | bevolking Amsterdam 2010–2020 | refusal/outside_loaded_slice, offers "vanaf 2019" | ✓ — population municipal slice starts 2019 (signal 2) |
| V06 | werkloosheid Noord-Brabant sinds 2015 | clarify (echo: "landelijk") | ✓ honest; unemployment loaded national-only (signal 2) |
| V07 | bijstandsontvangers Rotterdam 2023 | clarify (B15-shape, loaded-topic options) | ✓ designed behaviour (predicted "refuse"; clarify-with-loaded-options is the docs/05 row) |
| V08 | woningvoorraad Utrecht/Groningen/Limburg | clarify: "alleen voor heel Nederland" | ✓ — housing stock loaded national-only (signal 2) |
| V09 | impact migratie op woningmarkt | refusal/causal, offers woningvoorraad stats | ✓ |
| V10 | migratieachtergrond + bijstand | clarify (B15-shape) | ✓ |
| V11 | veiligheid/criminaliteit naar herkomst | refusal/scope, names the 8 loaded topics | ✓ |
| V12 | onderwijs in de Rijksbegroting | refusal/scope | ✓ single-source honesty |
| V13 | jeugdwerkloosheid A'dam vs Den Haag | refusal/scope | ✓ (no youth-age dimension loaded) |
| V14 | hoogste woningprijs-provincie + verandering | refusal/**compound** | ✓ honest split |
| V15 | bijstand Randstad vs rest | clarify (B15-shape) | ✓; "Randstad" never resolved as a region (signal 3) |
| V16 | bevolkingsgroei NL vs EU-lidstaat | refusal/scope | ✓ |
| V17 | alle CBS-data over alles | refusal/smalltalk (product explanation) | ✓ acceptable |
| V18 | alle cijfers over 'geluk' | refusal/scope | ✓ |
| V19 | migratiecijfers 'Gotham City' | clarify (B15-shape) | ✓ — no fabricated region; but note (review catch): the measure axis failed first, so **the region resolver never saw "Gotham City"** — the unknown-region path itself is pinned hermetically (the `Atlantis` → `region_unknown` test in [tests/answer/intent-resolve.test.ts](../tests/answer/intent-resolve.test.ts)), not by this live probe |
| V20 | inwoners in 2050 | refusal/forecast, offers realized 2026 | ✓ |
| V21 | werkloosheid per dag in 2023 | clarify (echo: "in 2023") | ✓ honest, but the impossible "per dag" grain is silently dropped, never named (Finding F2 family) |
| V22 | alle gemeenten sinds 1970 | clarify (echo) | ✓ honest, no crash; but the echoed option ("alle gemeenten vanaf 1970") does **not resolve** in loaded data (Finding F2) |
| V23 | inflatie-tijdreeks vanaf 1960, maandcijfers | clarify (echo) | same as V22 (Finding F2) |
| V24 | 3 measures × alle regio's in één grafiek | refusal/scope | ✓ |
| V25–V27 | beleidsdocument / Rijksoverheid-stukken / CBS-methodologie | refusal/smalltalk ×3 | ✓ — **no hallucinated documents or methodology** |
| V28 | werkloosheid sinds 2010 | refusal/**internal** | ✗ same bug as V01 — fixed |
| V29 | "En hoe zit dat voor jongeren?" | refusal/smalltalk | ✓ as predicted: no referent (signal 1) |
| V30 | "En alleen in de Randstad?" | refusal/scope | ✓ (signals 1+3) |
| V31 | "Kun je dit in een grafiek zetten?" | refusal/smalltalk | ✓ (signal 1) |
| V32 | woningmarkt verbeterd of verslechterd? | clarify (echo: "ontwikkeling koopwoningprijzen") | ✓ good: redirects opinion to a descriptive series, no value judgment |
| V33 | trends migratie en veiligheid | refusal/scope | ✓ |
| V34 | verhaal bij grafiek bijstand/herkomst | refusal/smalltalk | ✓ |
| V35–V38 | deze grafiek/deze cijfers/ontbrekende waarden/andere bronnen | refusal/smalltalk ×4 | ✓ as predicted: no referent without memory (signals 1+5); UX is blunt (F3) |

## The architecture memo — six signals, in decision order

### 1. Multi-turn conversation memory — the biggest fork. Recommendation: **make it a Phase 1 must-have.**

Confirmed exactly as predicted: every follow-up-shaped question (V29–V31, V35–V38 — 7 of 38, plus V02's implicit comparison) dead-ends in a generic template because each question parses independently; only the one-round clarification carries state (ADR 015). In a real chat session this is the dominant interaction pattern — journalists will ask "en voor jongeren?" constantly. **Design constraint that keeps the anti-fabrication guarantees intact:** thread *structured* context (the previous turn's resolved intent — which IS the stored query plan, ADR 016 — as a merge candidate), exactly the mechanism the clarify-reply merge already proved (WP9: reply parsed *merged* with pending partial intent). The LLM still never sees data; every number still comes from the deterministic query layer. What it must NOT be: raw chat-history text pasted into prompts (reopens the R2/prompt-injection surface WP7 deliberately closed, open-questions #41). Tracked as [open-questions #57](open-questions.md); scoped into the Phase 1 planning discussion, sized as its own work package, not a side effect of the auth/billing WP.

### 2. Regional coverage of the ingested slice — measured, and thin. Recommendation: **expand deliberately with the Phase 1 table growth, after the #33 storage decision.**

The pass measured (not guessed) the current slice boundaries: **population** municipal data exists but only **from 2019** (V05 refused 2010–2020 honestly, offering "vanaf 2019"); **unemployment** and **housing stock** are loaded **national-only** (V06, V08). Every regional limit was communicated honestly — the architecture handles the gap correctly; the *data* is what's missing. This is the owner's call at Phase 1 table growth (roadmap: ~25–50 tables): regional slices multiply row counts, and the database already sits at 230 MB of the 500 MB free tier with the full-CPI table as the main cost ([open-questions #33](open-questions.md)) — so the CPI re-slice / paid-tier decision should come **before** regional expansion, not after.

### 3. Composite regions ("Randstad", "rest van Nederland") — confirmed unsupported. Recommendation: **defer past Phase 1.**

Both Randstad questions (V15, V30) exited via other honest paths (unloaded topic; scope). No CBS region code exists for these; supporting them means a *registered composite derivation* (sum/average over member regions with CC BY "bewerking" marking, R5) — real machinery. Only 2 of 38 questions needed it; revisit when refusal telemetry (audit records make this measurable) shows demand.

### 4. One-measure / one-varying-axis contract ([#38](open-questions.md)) — held, with one schema gap found. Recommendation: **keep the contract; extend the period schema (escalation E2).**

The contract itself produced honest outcomes everywhere it was hit (V14 compound split, V24 multi-measure scope refusal, V13 scope). But the pass found a *representational* gap next to it: **PeriodSpec cannot express an open-ended range** ("sinds 2015"), and since the prompt is deliberately date-free (ADR 012), the model *cannot* emit a correct end year — it emitted `fromYear == toYear` at confidence 0.92, twice, deterministically (V01, V28). Also observed once: "nu vs 5 jaar geleden" (V02) has no two-disjoint-periods representation, so the comparison half dropped out of the echo. Fixing the refusal-path bug was done tonight (F1); making these questions *answer* needs the schema extension — escalated, not done (E2).

### 5. Single source, no document layer — confirmed clean. Recommendation: **no action.**

All Category 3/7 questions refused or clarified honestly; zero hallucinated documents, sources, or methodology (V25–V27, V38). The single-source limit is communicated by naming the 8 loaded topics.

### 6. Guard robustness — strong, with two real findings. Recommendation: **fix F1 (done); design-review F2 in Phase 1.**

- **0/38 fabricated numbers, machine-verified** via `reconstructionReport` over the stored rows.
- **The R3 fail-closed ladder engaged live and won** (F5, V04): Sonnet's phrasing failed the validator twice (two compose calls recorded on audit row 39), and the deterministic template served the final answer — correct value, unit, and R11 marking. This is the first *unplanned* live engagement of the full ladder.
- **No fabricated region for the fake municipality** (V19) — though the live probe never reached the region resolver (measure failed first); the unknown-region guard itself is pinned by the hermetic `region_unknown` test, not by this pass.
- Forecast (V20), causal (V09), compound (V14), scope (×8), slice (V05) all refused with the right reason and honest offers.
- The two gaps: F1 (fixed) and F2 (below).

## Findings

**F1 — "sinds {jaar}" errored instead of clarifying (V01, V28). Fixed + test-pinned this session.** Root cause under signal 4 above. Fix (deterministic, zero LLM involvement, no schema/prompt/fixture change): `resolveCandidate` now exits to a **period clarification** whenever a multi-period derivation (`series`/`difference`) sits on a structurally single-period selection, with a range option **clamped at both ends to the loaded slice's published years** ("2015 tot en met 2025"; "sinds 1970" on a slice starting 2019 offers "2019 tot en met …") so the offer always resolves in loaded data — ask, never guess (R7/principle c, docs/05). Covers the adjacent reachable shapes too (`latest`+series, single year+series/difference). Pinned by 7 resolver tests, a policy-template test, and an envelope-level test replaying V01's exact live parse through `respondToQuestion`. The *full* fix — actually answering "sinds 2015" — is escalation E2.

**F2 — low-confidence "echo" clarifications can offer options that don't resolve in loaded data (V22, V23; grain variant V21).** The R7 rule-3 path (single reading below the 0.9 answer threshold → "Bedoel je {reading}?") uses the model's own reading as the sole option. For V22/V23 that echoed "alle gemeenten … vanaf 1970" / "van 1960 tot heden" — ranges far outside the loaded slice — deviating from the docs/05 letter ("concrete, *actually available* options"). If the user confirms, the next round ends in an honest refusal (one-round cap, no numbers anywhere) — so this is a **UX/promise softness, not a fabrication risk**. A clean fix needs a resolvability dry-run (or coverage clamp) on echoed readings before offering them — a real design item, not an overnight patch. Tracked as [open-questions #56](open-questions.md).

**F3 — the smalltalk/meta template is honest but blunt.** 11 of 38 questions got the identical two-sentence product explanation. For genuinely meta questions (V37 "hoe ga je om met ontbrekende waarden?", V38 "welke bronnen…") a small set of dedicated deterministic templates (product-behaviour answers, still zero LLM, zero numbers) would answer truthfully instead of deflecting. Cheap Phase 1 polish; fits the answer-card design session (#29).

**F4 — factor-unit readability observed in the wild (V04):** "60,2 (× 1 000 euro)" is exactly [open-questions #42](open-questions.md)'s concern. Evidence for resolving #42 via a registered `scale_expansion` derivation in Phase 1.

**F5 — positive: the R3→regenerate→template ladder worked unprompted in production conditions** (V04, audit row 39: two compose calls, `source: template`, correct final answer). The fail-closed design carried a live fabrication-shaped failure without the user ever seeing it.

## Escalations (owner decisions, with recommendations — none executed overnight)

- **E1 — Phase 1 WP brief:** drafted into [08-build-plan.md](08-build-plan.md) as a proposal (per the overnight mandate); needs owner approval before any build. Includes the KvK/#54 external blocker note.
- **E2 — PeriodSpec open-ended-range extension** (`since_year`, or `toYear: null`): the *real* fix for "sinds X" — these questions should ultimately **answer** with a series, not clarify. It changes the WP6 LLM contract (`INTENT_SCHEMA_VERSION`, prompt, all 45 intent fixtures re-recorded, thresholds re-checked per ADR 012's procedure, ~€0.50–1.50 live spend). Deliberately NOT done overnight: contract changes + live re-records sit outside the autonomous mandate (and the V02 "nu vs N jaar geleden" shape should be considered in the same revision). **Recommendation: approve for the next interactive session, alongside a labelled-set extension covering "sinds X", "afgelopen N jaar", "nu vs N jaar geleden".** Tracked as [open-questions #55](open-questions.md).
- **E3 — F2's echo-option resolvability** ([#56](open-questions.md)): decide between a coverage dry-run before offering, clamping echoed ranges to the loaded slice, or accepting the current honest-but-soft behaviour.
- **E4 — conversation memory as a Phase 1 work package** ([#57](open-questions.md)): the memo's headline recommendation (signal 1). Not in the current Phase 1 "Adds" list — adding it is a roadmap change only the owner can make.
- Also live-relevant now: [#44](open-questions.md) (benchmark/validation rows are accumulating untagged in the production `audit_answers` — 38 more tonight, rows 36–73).

## Review

Per the WP12 lesson, the session's diff (runner + F1 fix + this memo) went through the adversarial multi-lens review before being called done: 5 lenses → 8 findings → each judged by two skeptics (one executing in an isolated worktree, one judging against the project's own recorded rules; 21 mid-tier agents, top-tier session model judging). **3 confirmed, all fixed in the same commits:** this memo's first draft cited audit-row latency figures against the dump without naming the layer (HIGH — the exact figure-vs-artifact class the WP11 review already caught once in STATUS); the "38/38 reconstruct clean" claim had no repo artifact backing it (now re-runnable: `npm run audit:verify -- 36 73`); and the V19 row overclaimed ("no silent region match" was vacuously true — the region resolver was never reached). **4 contested, judged by the session:** the offered range's interior-gap servability (accepted and *fixed* — `openEndedRangeOptions` now counts the window's published years and offers nothing on a gap, with a rollback-isolated gap test); the two latency layers undocumented in the runner (documented); the circular option-whitelist in the envelope belt-check (no change — pre-existing recorded convention; the real pin is the resolver test computing its expectation from independent DB reads); the V24 curly-apostrophe transcription (fixed in the runner; the live run sent the curly variant — outcome unaffected). **1 refuted with citations:** "Sonnet 3 calls not derivable from the dump" — the audit rows' `llmCalls` layer records all three, which is exactly where the figure came from.

## What was deliberately NOT done

- No reply rounds to the 11 clarifications (cost; no new architectural signal expected — the merge path is WP9-proven).
- No schema/prompt changes, no fixture re-records, no re-calibration (E2 explains why).
- No fix for F2/F3 (design decisions, not overnight patches).
- No touching of billing/auth/credits beyond the WP brief proposal (explicit escalation line).
