# WP26 execute-brief — end the paid dead-end (answer-first defaults + clickable clarify options)

**Written by the Fable overnight design marathon (2026-07-18→19), phase 1 of
[2026-07-18-fable-design-marathon-overnight.md](2026-07-18-fable-design-marathon-overnight.md).**
Authority chain: ADR [024](../decisions/024-answer-first-defaults-and-clickable-options.md) carries the decided design
(owner read back + settled the safelist, session 23); [08-build-plan.md](../08-build-plan.md) §WP26 is the buildable
summary; **this brief is the execute-ready plan** — corpus grounding, exact seams, calibration protocol, test plan,
rollout. Everything here is measured against the repo as of commit `36ddbd8` (2026-07-18); every code claim carries a
file reference a build session can re-verify with one grep. Two NEW judgment calls are made below and flagged for owner
read-back (§8): the Mechanism-A take-path variant (A2 vs ADR 024's A1) and the WP26c rescue-chip scope.

**What does NOT move (binding, from ADR 024 + the overnight rules):** zero prompt bytes (`prompt.ts`/`schema.ts`/
`parse.ts` untouched → NO #164 re-record), zero pricing/ledger changes (#101 stays deferred), `region_ambiguous` and the
rule-3/rule-4 classes keep clarifying, B15/B16 keep their expected outcomes, no live DDL (§4 confirms none is needed).

---

## 1. Corpus grounding — which question classes lose an answer today, measured

Source: the session-23 experience audit (110 live questions through the production code path;
[experience-audit-results-2026-07-05.md](../experience-audit-results-2026-07-05.md), raw per-question record in
`benchmark/experience-audit-run.json`) + the s52 trial smoke (status-archive s52 entry) + the s54 relabels
(`benchmark/followup-cases.json`). Totals: **40 answer / 32 clarification / 38 refusal**; of the **56** questions the
battery marked answerable-today, **20 did not just answer** on turn 1 — measured split (computed from the raw run;
the prose memo never states it): **10 clarified, 10 refused.** By class:

| Class (of the 20) | n | Outcome | WP26 mechanism that addresses it |
|---|---|---|---|
| No region named, nationally-available measure (A030) | 1 | clarify | **Mechanism B-region** (answers directly) |
| Superlative/peak/multi-entity comparisons (A059–A061, A063, A064) | 5 | 3 clarify / 2 refuse | **Mechanism A** (the remaining clarify terminates on a click); the max-over-periods/regions *capability* gap is #97b, NOT WP26 |
| Messy/colloquial phrasing (A016, A018–A020) | 4 | 3 clarify / 1 refuse | **Mechanism A** (clarify → one-click); the lone refusal (A018, `freshness`) is a parse-robustness bug outside WP26 |
| Claim-check phrasings (A087, A090, A094) | 3 | clarify | **Mechanism A** (terminate on a click) |
| Meta-trust (A103–A105, A107–A110) | 7 | refuse (meta/smalltalk templates) | **NOT WP26.** These are ADR-022 template-quality items (#103 lane). Named here so nobody expects WP26 to move them. |

Honest reading of the lever: WP26's mechanisms directly touch **~13 of the 20** (all 10 clarifications terminate on a
click or disappear into a default; 2–3 of the refusals are kind-misfires — see WP26c). The meta-trust block (7) is a
different, real quality gap that needs its own template pass, not defaults. **B-region's measured turn-1 win is small
today (1/20) because only two registered tables are truly geo (§5); its value is structural** — it deletes the whole
missing-region clarify class for every current and future geo table (incl. WP16-onboarded ones), and the trial surface
makes every needless clarification expensive (below).

**The trial-conversion stake (s52, measured live):** both casual smoke phrasings on the anonymous trial drew honest
conservative refusals — *"Wat was de inflatie in juni 2026?"* → `forecast` (a **misfire**: past-tense question about an
already-published month; see §6) and *"Wat is het consumentenvertrouwen?"* → `meta` template (a **misfire**: a bare
data question read as a capabilities question). A trial visitor has 2 free questions; today both can land on refusals.
WP26 (with sub-part C) is the direct lever on that funnel.

**The s54 relabels — evidence the conservatism is drifting INTO the corpus:** `f-v29-age-breakdown` (relabelled
clarification→`out_of_scope` refusal) and `f-merge-topic-switch-national` (confident merge→measure clarification), both
annotated *"WP26-adjacent conservatism, accepted and tracked"* in `benchmark/followup-cases.json`. Both are honest
outcomes individually; together with s52 they show the honest-but-conservative share growing as vocabulary grows. WP26
is the designed counterweight (answer first where a structural default exists; make the rest terminate on one click).

## 2. The safelist — read-back doc (owner approves this aloud, per entry)

The rule it instantiates (ADR 024 decision 2, R7's third branch): *a default may replace a clarification only when it
is a canonical, structurally-determined reading — (a) servability-checked through the real query layer before use,
(b) disclosed in-sentence by deterministic code, (c) paired with a working correction path. Never a confidence-scored
pick among competing readings.*

**Voor te lezen aan de owner — de safelist, letterlijk (Nederlands, zoals de gebruiker het ziet):**

1. **B-region.** *Als je geen gemeente of provincie noemt bij een cijfer dat ook landelijk bestaat, krijg je direct het
   landelijke cijfer, met de zin: "Dit is het landelijke cijfer voor heel Nederland." En een knop: "Liever een gemeente
   of provincie? Noem de naam."* — R7-transparantie: het NL-totaal is een bestaande, specifieke rij (geen keuze tussen
   kandidaten); de aanname staat als vaste zin ín het antwoord, door code samengesteld, en de correctieknop werkt
   gegarandeerd. Valt de NL-rij weg (dry-run faalt), dan wordt er gewoon weer doorgevraagd — nooit een verzonnen
   landelijk cijfer.
2. **B-period (owner-besluit sessie 23: de TREND, niet één getal).** *Als je vraag helemaal geen periode noemt, krijg
   je het recente verloop — een aaneengesloten reeks t/m het nieuwste gepubliceerde cijfer, als lijngrafiek — met de
   zin: "Dit is het verloop over de afgelopen jaren, t/m {laatste periode}." En knoppen: "alleen het laatste cijfer" /
   "een andere periode."* — R7-transparantie: het venster is een gedisclosede, corrigeerbare aanname; elke waarde in de
   reeks is een letterlijke CBS-cel; een reeks met gaten wordt nooit getoond (bestaande completeness-discipline).
   Venster: de laatste ~10 jaar op de grofste beschikbare korrel, of de hele geladen reeks als die korter is; degradeert
   naar één (nieuwste) cijfer als er maar één periode geladen is.
3. **Wat blijft doorvragen (expliciet NIET defaulten), nu wél met klikbare knoppen:** Utrecht-gevallen
   (gemeente-of-provincie — twee verschillende echte cijfers), lage parser-zekerheid over één lezing, twee wezenlijk
   verschillende lezingen, onbekende termen, en alles buiten de geladen data. Precies de bestaande "nooit gokken"-lijn
   (principe c) — die verschuift niet.

Elke default is dus: een structureel bepaalde lezing + vooraf bewezen servable + hardop gedisclosed + één-klik
corrigeerbaar. Niets anders komt op de lijst zonder nieuwe owner-read-back.

## 3. Mechanism A — the data structure, the take-path decision, the UI

**As-built gap (measured):** `PendingClarification.options` is `string[]` — display strings only
(`src/answer/respond/types.ts:130-152`); at the exact spot the options are born, `policy.ts` rules 3/4 HOLD resolved
`RankedCandidate.intent` objects and discard them, copying only `.reading`. `echoServability`
(`src/query/dry-run.ts:81`) already proves an intent answerable with a no-cells-by-construction return type and is
already injected at all three decide() call sites (first turn, follow-up, reply). The chips UI pattern exists twice
(`chat.tsx` #75 examples + #73 suggestions), both "fill the input, never auto-send". Clarification options render today
as plain text inside the message body — no chip UI, nothing clickable.

**Option payload (refinement over ADR 024's "intent OR axis-patch" — store full intents only):** at OFFER time the
producing code (policy rules 3/4, `resolveRegions` branches, the #56 echo) either already has a full resolved
`StructuredIntent` or can build one by applying the axis value to the candidate it holds — so build the complete intent
THEN, dry-run it THEN, and store it on the option. No patch application at click time, no partial-intent plumbing.

```ts
// additive, optional — old stored rows stay valid (tolerant zod), no version bump needed
interface ClickOption {
  id: string;               // stable within the pending (e.g. 'opt-1')
  label: string;            // byte-equal to the options[] entry it decorates
  intent: StructuredIntent; // fully resolved, dry-run-verified at offer time
}
// PendingClarification gains: clickOptions?: ClickOption[]
```
Options with no servable intent (e.g. *"noem de naam"* free-text prompts) simply get no `ClickOption` and render as
today. **Persistence: NO DDL.** The pending state is already stored verbatim in `audit_answers.pending_clarification`
**jsonb** (migration 004) — the enriched object rides along. ADR 024's flagged assumption ("may need an additive
column → live migration") is hereby resolved: **not needed.**

**The take-path — the one real fork in this WP (owner read-back item 1):**

- **A1 (ADR 024 decision 4 as written):** new Server Action `resolveClarificationOption(pendingId, optionId)`;
  `pendingId` = the clarification's `audit_answers.id` (already written for clarification rows,
  `respond-audited.ts:112`, but deliberately NOT surfaced to the client today — `chat.tsx:504` narrows `auditId` to
  answers only, which would change). Server loads the row, checks ownership, takes the option's intent from the
  SERVER-stored copy. Smallest attack surface (client sends two ids, nothing else), cleanest R8 story.
- **A2 (recommended):** **no new entry point.** `replyToClarification` gains a deterministic first rung: if the reply
  text byte-matches a stored `ClickOption.label`, take its stored intent directly — no LLM re-parse. Chips follow the
  #75 convention literally (click fills the input; user presses Verstuur and sees the cost line) and the send then hits
  the deterministic rung. Free text that matches no label falls through to today's LLM merge unchanged.
  Why recommended: (i) it satisfies the marathon brief's *"geen nieuw betaald entry-point"* and the #75 convention
  verbatim; (ii) it also rescues TYPED replies that happen to equal an offered option — the measured "Beiden"-class
  dead-ends where users retype the option; (iii) one fewer surface to guard/bill/audit; (iv) the click-can-never-
  dead-end guarantee is identical (deterministic match → pre-verified intent). Trade-off vs A1: the enriched pending
  (with intents) is client-held on the reply turn, so the s47 `guardPending` belt must grow zod-validation of
  `clickOptions[].intent` (full `StructuredIntent` schema) before use — an attacker-shaped intent can only ever become
  a normally-billed, fully-validated query of OTHER real data (same power as typing a different question), but
  validate + dry-run at take anyway, and the audit row records what actually ran (R8 teeth unchanged).
  **If the owner prefers ADR-024-as-written, build A1 — everything else in this brief is identical.** Either way the
  ADR gets a one-line as-built amendment in the same change.

**Composition of a clicked/matched resolution — zero LLM, template rung:** per ADR 024 ("no LLM call at all") the
matched intent goes query → validate → **the ADR-013 template rung** for the body (proven always-valid,
`types.ts:117-119`), normal envelope, normal audit row. Deliberate consequence: a clicked answer reads plainer than an
LLM-phrased one; that is the honest trade for a structurally dead-end-free, injection-free, provider-outage-proof path.
Data may have moved between offer and click (a sync in between): the take re-runs the REAL query; if it now refuses,
the normal gate refunds to 0 — rare and honest, pin it with a test.

**UI (`chat.tsx`):** render `clickOptions` as chips under a clarification message, exact `EXAMPLE_QUESTIONS` markup
(`rounded-full border … px-3 py-1 text-xs`), `onClick={() => setInput(label)}` per #75. Options without intents stay
plain text. The correction chips on defaulted answers (§4) reuse the #73 suggestions surface as-is.

**Billing: untouched.** A matched reply still flows `chargeAndRun` → resolves to `kind:'answer'` → clarify 10 + answer
20 over the two turns, exactly today's happy path; the win is that the second turn can no longer dead-end. (#101
sweeteners stay open for the owner; the ledger trigger `clarification ≤ simple` in migration 008 is the constraint if
(ii) is ever picked.)

## 4. Mechanism B — the two seams, the assumptionLine, the flags

**B-region (seam: `src/query/resolve.ts:342-374`).** Today `regionMissing` on a GeoDimension table exits
`needs_clarification` ("these must be chosen, never defaulted silently"). New behavior behind the flag: when
`regionMissing` AND the table's canonical NL-level row exists (the `NL01` convention `freshestForCanonical` already
uses, `run.ts:242`), pin the region to that code, set `regionDefaulted: true` on the result, and proceed — the query
run itself IS the servability check (no row → fall through to today's clarification, never a fabricated national
figure; pin that fallback with a fixture where the NL row is absent). The clarification text for the fallback already
carries the right option labels (the s54 B16 fix). **Scope check (measured):** exactly two registered tables are truly
geo — `03759ned` (population, NL/PV/GM slices) and `83625NED` (home sale price by gemeente); `85792NED` fixed RegioS
`NL01` via `default_coordinates` so it already answers nationally by construction. Build step 1 is a one-off dry-run
over both geo tables' canonical coordinates to VERIFY the NL row exists (ADR 024's marked assumption) — for `83625NED`
specifically do not assume; if its NL aggregate is absent, B-region simply keeps clarifying there and the brief's
honest answer is "B-region ships for population now, and for every future geo table with an NL row."

**B-period (seam: `src/answer/intent/resolve.ts:672-673`).** Today `case 'none'` → `periodFailure('period_missing')` →
rule-2 clarification. New behavior behind the flag: resolve `none` to a **last-N-shaped range** ending at
`latestPeriod()` at the coarsest grain (the existing `last_n` machinery, `resolve.ts:479-527`, incl. its
n=1 degeneration), set `periodDefaulted: true`. Everything downstream already exists and is gate-proven: range
enumeration (`query/resolve.ts:202-218`), per-cell completeness (`run.ts:285-291` — a holey window refuses, satisfying
the "gap-free" owner requirement structurally), `shape:'series'` → line chart (B4/B8 machinery). Window: **10 years
equivalent at the chosen grain, or the full loaded range if shorter** — a named constant, not a magic number.
`latest` (present tense) is untouched — it already serves the freshest single value and is the majority path.

**The `assumptionLine` (both defaults disclose through it):** a new required field on `ComposedAnswer`
(`compose/types.ts`), built by a pure `buildAssumptionLine(result)` in `format.ts` beside `buildDefinitionLine`
(fixed Dutch strings keyed on `regionDefaulted`/`periodDefaulted`), assembled in `assemble()` (`compose.ts:58-61`),
**outside the LLM-scanned body** (R1's structural exemption, `validate.ts` header), and **re-derived byte-identically
at audit time** in `reconstruct.ts` beside the attribution re-derivation — the exact enforcement pattern R4 uses.
`regionDefaulted`/`periodDefaulted` travel on the validated result and into the audit row so R8 reconstructs without
re-deciding policy.

**Flags (dormant-by-design, #53/#144 pattern):** two independent env flags so the owner can go-live and roll back per
mechanism — proposal `CLARIFY_CLICK_ENABLED` (A) and `ANSWER_FIRST_ENABLED` (B), checked before any behavior change,
unset = byte-identical to today (pin flag-off neutrality with tests like #144 did). Correction-chips-on-defaults ride
flag B (they only exist on defaulted answers).

## 5. Invariants and docs to amend in the same change

R7's row + the "Ambiguous intent"/"Still ambiguous after one round" failure-table rows in
[05-data-rules.md](../05-data-rules.md) gain the third branch **in the code change, not before** (ADR 024 status line).
R1/R3/R9/R10: a defaulted answer shows only verbatim cells; the assumptionLine is deterministic non-numeric text; trend
direction prose stays derivation-bound. R8: clicked/matched answers and both default flags reconstruct from the row
alone. #38: defaults never create cross-product intents. ADR 024 gets the as-built amendments (A2-or-A1 outcome; the
jsonb no-DDL finding; full-intents-only option payload). [08-build-plan.md](../08-build-plan.md) WP26 section +
open-questions #66/#72 marked built; #101 rows untouched.

## 6. WP26c — the forecast-guard decision (the marathon brief demands one) + its meta twin

**Finding (measured, agent-verified):** the forecast guard is **purely parse-side** — the deliberately date-free prompt
asks the LLM to judge "a year that can only be a forecast" with no knowledge of today's date and no check against what
is actually published. s54 measured 2026-periods flipping to `forecast_request` intermittently (3 of 9 new labelled
cases; the labelled-set convention now routes AROUND it with past-period phrasings). The refusal builder
(`refusals.ts:101-118`) never re-checks the DB. The s52 smoke refusal (*"Wat WAS de inflatie in juni 2026?"* — June CPI
published early July) is this misfire hitting a real paying surface. Its sibling: *"Wat is het consumentenvertrouwen?"*
→ `meta`, same family (kind-misclassification of a bare data question).

**Decision: in WP26 scope as severable sub-part C — not a prompt fix, not a standalone WP.** Rationale: (i) a prompt
fix violates WP26's zero-byte invariant AND the overnight/model-switch constraints, and prompt-side date awareness was
deliberately rejected (prompt-cache/fixture stability, `prompt.ts:6-9`) — that decision stands; (ii) a deterministic
rescue needs exactly the machinery WP26 builds (pre-verified chips + the LLM-free take-path), so standalone sequencing
would duplicate work; (iii) it is cleanly severable if the build session runs long.

**Design (all deterministic, zero prompt bytes):** when the parse returns `forecast_request`, run the ADR-023
deterministic date parser over the question text; if it finds an **absolute** period AND the raw parse's
`nearestCanonicalKeys` (already produced for the courtesy offer) yields exactly one strong registry match AND that
period is ≤ the freshest published period for it (`freshestForCanonical`) AND the composed intent passes the dry-run →
attach ONE rescue `ClickOption` to the (unchanged, still-honest) forecast refusal: *"Juni 2026 is al gepubliceerd —
toon het cijfer."* Same shape on the `meta`/`smalltalk` templates when the text contains exactly one strong measure
term: *"Toon het laatste cijfer voor {measure}."* The refusal/template text itself does not change; the chip is the
escape hatch; no match → today's behavior byte-identical. The classification itself stays untouched and unpinned
(labelled routing cases keep the s54 past-period convention — you cannot pin an unstable parse, so WP26c is tested
hermetically GIVEN a captured misfire fixture, plus one live-recorded 2026-phrasing fixture to replay whatever the
model did that day). **Read-back item 2:** confirm the owner wants the rescue chip on refusal surfaces (it makes a
refusal clickable — a new interaction on a surface that today is terminal).

## 7. Calibration protocol + spend (the s54 lessons applied)

**What #164 does NOT do here: nothing.** Zero prompt bytes → all ~93 replay fixtures stay valid; no re-record of the
existing sets. LLM spend in this WP is **targeted new-case records + live verification only**:

1. **Labelled-set extensions** (each recorded with `--only`, sub-euro per batch): (a) intent set: 2–3 genuinely
   period-less phrasings (expect `none` → the resolver flip is deterministic, but the PARSE must still emit `none`
   stably) + 1–2 bare no-region geo phrasings (A030 shape); (b) followup set: one clicked-option-label reply case
   proving the deterministic rung (hermetic — no LLM in the path at all, so this is a plain test, not a recorded case);
   (c) WP26c: one live-captured 2026-phrasing fixture (replay whatever kind the model emitted) + hermetic rescue tests
   over a hand-written `forecast_request` raw parse. **Convention respected:** no labelled ROUTING case may pin a
   2026-period expectation (s54 lesson — bistable).
2. **Frozen pins that must NOT move** (the go/no-go blockers): B15 + B16 expected outcomes (multi-axis clarify /
   region_unknown clarify with the s54 option labels); the s54 relabels exactly as labelled (`f-v29` refusal,
   `f-merge-topic-switch-national` clarification, `r-autos` clarification, `dr-kw-only` MM); intent replay 72/72
   hermetic ×3 (free); followup 23/23, clarify 7/7, tablefinder 11/11 replays; the 14/14 + 6/6 + 0-fabricated
   benchmark gate; the 10 s54 spot-check values.
3. **Record/eval rounds — budget honestly (s54: ~€2/full round, loops multiply):** expected shape is 1 targeted
   `--only` record batch (~€0.20–0.50) + `intent:eval -- --repeat=3` on the NEW cases live (~€1–2) + go-live smoke
   (~€0.50, incl. re-running both s52 phrasings and an A030 phrasing on the live surface). **Plan €5, cap the session
   at €10** — far under the €25 Anthropic cap; if a round-loop starts (a new case flips), apply the s54 rule: label the
   stable majority side with a bistability note, do not chase a preferred outcome through re-records.
4. **Go/no-go for the flag flip (owner present):** all §7.2 pins green; new benchmark cases (§8) pass hermetically and
   once live; flag-off byte-neutrality tests green; `audit:verify` over the new-case audit rows exits 0; both s52
   phrasings measurably improved live (consumentenvertrouwen answers or carries a rescue chip; juni-2026 carries the
   rescue chip when fired as forecast). Any pin move = no-go, revert the flag, diagnose.

## 8. Test plan, build shape, rollout

**New frozen-key benchmark cases (ADR 024 §5, concretized):** (i) geo-no-region → national answer + assumptionLine +
correction chip; (ii) clicked/matched rule-4 option → the picked reading's answer, template body, reconstructed from
the audit row with zero LLM; (iii) `none`-period → gap-free trend + line chart + both correction chips, degrading to
single-value on a one-period table; (iv) NL-row-absent geo → still clarifies (the no-default pin); (v) offer-then-sync
drift → click re-query refuses honestly + refunds. B15/B16 extended, not replaced. Flag-off: byte-neutrality suite
proving unset flags reproduce today's envelopes byte-identically (the #144 pattern).

**Build shape:** hermetic build first (all of the above runs on PGlite + replay fixtures, €0); **go-live is
owner-supervised** (env flags + live smoke + the §2 read-back happen in-chat) even though no DDL is needed. Per #118:
owner-present session pushes directly with the full verification block (typechecks, all suites, benchmark 14/14 + 6/6 +
0 fabricated, real `next build`, `audit:verify` — this WP touches the validator-adjacent compose path — and the
automatic `/code-review` LOW pass); an autonomous build would need branch + PR + owner review. Recommended order
inside the WP: **A (with A2 rung) → B-region → B-period → C**, each landing with its tests before the next starts, C
explicitly droppable.

**Owner read-back at go-live (the two new calls made by this brief):**
1. Take-path A2 (deterministic label-match inside `replyToClarification`, no new entry point) versus ADR-024-as-written
   A1 (`resolveClarificationOption` Server Action). Recommendation: A2, reasons in §3.
2. WP26c rescue chips on refusal/template surfaces: in scope as designed (severable), or deferred.
Plus the §2 safelist read aloud, unchanged from session 23's settlement.

**Assumption:** `83625NED` has an NL-level aggregate row at its canonical coordinate — **verify at build step 1 via
the dry-run; do not assume** (mirrored in open-questions #72 row). If absent, B-region ships for `03759ned` only and
falls back to clarify on `83625NED` (behavior identical to today there).
