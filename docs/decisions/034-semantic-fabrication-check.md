# ADR 034 — The semantic fabrication check: an additive, reject-only second LLM pass over residual-prone answer bodies (#144)

**Status:** accepted, 2026-07-16 (session 46) — **built flag-dormant; the go-live (fixture recording + calibration + flag flip) is an owner-supervised RUNBOOK step.** The fail-open-vs-fail-closed choice on checker errors is an **OPEN OWNER DECISION** (§5), configured at flag-flip time.

**Relates to:** open-questions [#144](../open-questions.md) (the design brief:
[session-briefs/2026-07-16-144-semantic-check-brief.md](../session-briefs/2026-07-16-144-semantic-check-brief.md)), ADR [013](013-answer-composition.md) §6 (both hardening addenda — the two proven deterministic ceilings), ADR [012](012-intent-parsing-llm-harness.md) (harness + record/replay), ADR [016](016-audit-records.md) (R8), ADR [004](004-llm-usage.md) (LLM role confinement — this ADR adds the third confined role).

## Context

After #140 v3 and #141 the deterministic anti-fabrication validator has exactly TWO known, bounded residuals, both **measured** to sit at the deterministic ceiling (ADR 013 §6): a fabricated number that equals one of the answer's own descriptor-coordinate numbers next to that descriptor's word ("bestaat al 65 jaar" vs the legit echo "personen van 45 tot 65 jaar"), and a fabricated integer equal to a covered-period year behind a temporal marker and before an un-listed noun ("na 2024 pogingen"). In both, the fabrication is word-for-word identical to a legit phrasing, and the stricter rule that would catch it measurably broke legit stored answers (4 R8 regressions, #140). No deterministic text rule closes them; the public claim ("every number traceable to an official CBS cell") says we close them anyway.

## Decision 1 — An additive, reject-only LLM checker, gated on a deterministic suspect scan

A second, separate LLM pass runs AFTER the deterministic validator passes a body, and **only** when that body actually leaned on a residual-prone exemption:

- `scanBody` (validate.ts) now marks each exempted token `soft` when its exemption is one of the two ceiling legs (§2). The accept/reject behavior of the validator is **byte-identical** — `soft` is additive information.
- `findSuspectTokens` (semantic-check.ts) lists the soft tokens with the sentence each sits in — a **pure function of (body, result)**, which is what makes the stored verdict's scope re-derivable for R8 (§4).
- Zero suspects → **no LLM call** (`skipped_no_suspects`, recorded). Suspects → one cheap-tier call judging EACH suspect: time-reference/descriptor-echo (`fabricated=false`) or a quantity of its own (`fabricated=true`). Any `fabricated=true` ⇒ the body takes the **same R3 fail-closed ladder rung** a deterministic failure would (one regeneration, then template).
- **Reject-only, structurally:** the checker can only remove a body the validator already passed. It never approves a number into an answer (a cleared suspect was already deterministically exempted), never sees raw cells, and never sees the user's question (the R2 discipline; payload whitelist pinned by test). Principle (a) holds: the LLM still cannot put a number INTO an answer.

The checker prompt biases doubt toward rejection (principle c): a false positive costs one regeneration; a tolerated fabrication breaks the core promise. Both the false-positive rate on legit residual-shaped phrasings AND the false-negative rate on seeded residual fabrications are **flag-flip blockers**, measured by the eval (§6).

**Wired paths:** live chat turns (question + clarification reply, `web/app/actions.ts`) and the onboarding delivery re-run (`onboarding-cron/route.ts`) — every user-visible answer path. Benchmark/tests/CLI pass no checker → byte-identical pre-#144 behavior.

## Decision 2 — The soft scope is corpus-measured, not reasoned (and the measurement changed the design)

The brief assumed "most answers skip the call". Measured against every stored benchmark answer body (18), the naive definition (every metadata echo + every temporal-marker-before period) triggered on **100%** of bodies — "Op 1 januari 2025 telde…" and "bedroeg in 2024 3,3%" all matched. The shipped scope narrows it with two **domain-grounded** refinements, after which the measured trigger rate on the same corpus is **0%** while both residual shapes still trigger:

1. **Date-form metadata echoes are hard** — an echo whose matched anchor is a month name AND whose body-side month is followed by a **year or punctuation/end** ("op 1 januari 2025 telde", "per 1 januari."): that full form has no quantity reading in Dutch. The v1 rule checked only the single word touching the number — the adversarial review **confirmed a CRITICAL bypass** (executed): a fabricated count riding a month-name **compound noun** ("nog 31 januari-meldingen extra", "1 januari overzicht") was hard-classified and the checker never fired. Closed (`DATE_FORM_AFTER`): a letter word or hyphen-glued continuation after the month keeps the echo soft. Bracket coordinates, income classes and index bases stay soft (the real #140 class).
2. **Period years: only marker + un-screened continuation is soft.** A year with no letter-word after it ("in 2024 3,3%", "tussen 2024 en 2025.") leaves no noun for a count to bind to — hard. A year followed by a word from `SAFE_YEAR_CONTINUATIONS` (validate.ts) — the closed set extracted from all 78 real corpus texts, every entry a verb/connector/adverb with **no counted-noun reading** — is hard. Anything else ("na 2024 **pogingen**", but also unscreened verbs like 'bleef') stays soft and triggers the call.

**Safety asymmetry that permits the safe list** (vs the #142 allowlist lesson): an entry here never changes the deterministic verdict — it only decides whether the additive checker double-checks. A wrong entry degrades one answer to today's exact live posture (validated, unchecked); it can never accept a rejected number. The list grows only from measured eval misses.

## Decision 3 — Model: cheap tier by role

`SEMANTIC_CHECK_MODEL = 'claude-haiku-4-5'` (named constant, temperature 0, structured output; one zod schema is the single source of truth for the output_config schema and the call-site validation, mirroring intent/rerank). Judging "time reference vs quantity" for pre-listed tokens is a closed comparison task — the same tier as intent parsing and the catalog rerank, per the delegation cost-tier rule and the ADR 025 precedent ("safer structurally than by model size"). Escalation ladder: Haiku → Sonnet → top tier, gated on a measured eval miss. The output contract is hard at the call site: exactly one verdict per suspect (id-set check) — a partial/padded verdict list is a checker ERROR, never a clearance.

## Decision 4 — R8: the verdict is recorded, never re-derived; its SCOPE is re-derived

An LLM verdict has no deterministic ground truth inside the record — re-running the LLM at reconstruct time would make R8 non-deterministic and unrunnable offline. Policy (extends ADR 016; mirrors how `llm_calls` are recorded-not-rederived):

- The verdict rides the envelope as `ComposedAnswer.semanticCheck` (schema-versioned: status, mode, model, suspects, verdicts, error, latency) — stored verbatim in the `response` jsonb like every envelope field; **no DDL**. The key is serialized only when the checker gate ran (feature on, LLM body): pre-#144 rows, flag-off rows and template bodies carry no key, and readers use `?? null` (A1).
- `reconstructionReport` re-derives what IS deterministic: the suspect list must re-derive from the stored body + result **byte-exactly**; the status must be consistent with that scope (`skipped_no_suspects` ⇔ zero suspects; `ok` ⇒ verdicts cover the suspects exactly once); a served body can never carry a `fabricated=true` verdict; a served `error` status requires `fail_open` mode; a template body never carries a verdict. Tamper tests prove every check can fail. The verdict's *content* (the fabricated booleans, reasons, model id, latency) is telemetry-grade capture, deliberately not reconstruction material.
- So the checker runs on the **final spliced body** (`applyUnitExpansions` first — deterministic and idempotent via its double-render belt), i.e. the exact string stored as `answer.body`.
- Checker token counts land in `llm_calls` with the new role `'semantic_check'` (jsonb, no DDL), tracked by the same `LlmCallTracker`.

## Decision 5 — Fail-open vs fail-closed on checker ERRORS: an owner decision, configured at the flag flip

When the checker CALL itself fails (API outage, malformed output — never a judgment), two honest postures exist. **Both are implemented**; `SEMANTIC_CHECK_FAILMODE` selects one, and the choice is the owner's, made at the supervised flag flip:

- **fail_open (recommended in the brief):** serve the answer — it already passed the FULL deterministic validator; the checker is defense-in-depth. An Anthropic outage does not degrade every residual-shaped answer to a template. The skip is recorded on the audit row (`status: 'error'`, honest and queryable).
- **fail_closed:** treat the error as a rejection → regeneration, then template. Maximal core-promise posture: no answer ships whose residual-prone tokens went unjudged — at the cost that a checker outage turns residual-shaped answers into template answers (correct but uglier; note the regeneration rung ALSO needs the checker, so a hard outage lands on the template).

The trade-off is availability-vs-belt on a live money-path product; per the #140 lesson ("a genuine safety-vs-quality tradeoff on the core promise is the OWNER's call"), this ADR deliberately does not decide it.

## Decision 6 — Hermetic CI now, live calibration in the supervised step (the ADR 012 split)

- **On the gate today:** the deterministic 90% — soft-leg classification, suspect extraction, payload whitelist, output-contract validation, ladder policy (reject→regenerate→template; fail_open serves; fail_closed rejects; no-suspects makes zero calls), R8 shape checks with tamper tests, and the labelled set's structural guards (every case passes the deterministic validator AND carries ≥1 suspect — a case failing either measures nothing).
- **The labelled set** (`tests/helpers/semantic-check-cases.ts`): seeded residual-class fabrications (expected `fabricated` — FN measurement) + legit residual-shaped phrasings (expected `clear` — FP measurement). Labels are product-policy judgments (ADR 012 rule).
- **The live half** (`npm run semantic-check:eval` / `semantic-check:record`, report `benchmark/semantic-check-eval-report.json` with append-only history): records the replay fixtures (`tests/fixtures/llm/semantic-check/`), measures FP/FN/stability (`--repeat=3` house standard). A checker ERROR never counts as a judgment in the eval (a missing fixture must not "pass" a fabricated case through fail-closed rejection). **Real spend, small (~7 Haiku calls/run) — owner-supervised step**, which also adds the CI replay leg and flips the env flags (RUNBOOK).

## Adversarial review (2026-07-16, recorded so it isn't re-litigated)

Five read-only lenses (soft-gate bypass hunt, reject-only/ladder integrity, R8 integrity, flag-off byte-neutrality, checker robustness) on the mid tier, every finding judged by two independent skeptics with executed repros, plus a **serialized** mutation-teeth probe against committed state (26 agents total). Outcomes:

- **1 CRITICAL confirmed + closed:** the date-form compound-noun bypass (Decision 2.1 above) — the session-45 pattern held exactly: the bypass hid in the carve-out, not in the rule. Closed + pinned (`tests/answer/semantic-check.test.ts` regression pair, labelled-set case F4-month-compound-count + the C5 no-year FP guard).
- **2 refuted-but-adopted hardenings** (free — no fixtures were recorded yet): `maxTokens` now scales with the suspect count (a truncated verdict list under fail_closed would needlessly template a valid answer), and the prompt's treat-as-data rule now names the `suspects[].sentence`/`descriptors` fields, not only `body`.
- **Refuted, judged not defects:** the R8 semanticCheck block only runs for `kind==='answer'` (a forged junk key on a non-answer envelope is inert — nothing reads it, same as any unknown key); duplicate same-value suspects within ONE sentence share their judgment context (reject-only means either verdict rejecting suffices; tracked by labelled-set case C4).
- **Flag-off byte-neutrality: 0 findings** — proven by running the OLD (parent-commit) validator extracted via `git show` against identical probes: token classifications and verdicts identical, `soft` purely additive.
- **Mutation probe: 5/5 targeted mutations RED** (soft-leg kill, date-form kill, reject-ignore, R8-check kill, id-set-check kill) — the new tests have teeth; tree restored clean.

## Alternatives considered

1. **Option (b) from the brief — a composer-emitted per-number claim map, verified deterministically.** Rejected: the claim map carries no more semantics than the text ("45 jaar" would claim the same metadata binding either way — the exact ceiling again), and it changes the phrasing prompt: a full fixture re-record (~€2, ADR 023's measured floor) for no closed residual.
2. **Always-on checker (no suspect gate).** Simpler, and the per-answer cost (~€0.001 Haiku) fits ADR 004's envelope — but it adds ~0.3–0.5s latency to EVERY answer, puts an LLM verdict on bodies that contain nothing an LLM could judge better than the validator already did, and widens the FP surface to all prose. The measured 0%-trigger scope keeps the checker where the ceiling actually is. Revisit trigger below.
3. **A separate audit column / table for the verdict.** Rejected: needs a migration (live DDL) and breaks "the envelope is the record" (ADR 016 decision 1) for no query need; promoted columns exist for measurement, and the verdict is queryable via the jsonb envelope.
4. **Re-running the checker at R8 reconstruct time.** Rejected outright: reconstruction must run from the row alone, offline, deterministically (ADR 016 decision 4) — an LLM call there breaks all three.
5. **Top-tier model for the checker.** Rejected per the ADR 025 precedent: the task is a closed judgment over pre-listed tokens with a schema-forced output — structure, not model size, carries the safety; the eval's measured miss rate is the escalation trigger.

## Revisit triggers

- A measured FP on a legit stored body in the eval or live (validator-calibration standard, ADR 013 §6) → tune prompt/examples first, then model tier; a measured FN on a seeded residual → same, treated as a blocker.
- `SAFE_YEAR_CONTINUATIONS` misses appearing in live prose (checker fires often on legit bodies) → extend the list from the measured corpus, per the #141 method.
- A THIRD residual class proven at the deterministic ceiling → widen the soft scope, not the prompt's job list.
- Anthropic deprecates `claude-haiku-4-5` → swap the constant, re-record, re-run the eval (one command each).
- Latency or spend from checker calls becomes user-visible (dashboard/latency medians) → re-scope or batch; the always-on alternative's cost math is above.
