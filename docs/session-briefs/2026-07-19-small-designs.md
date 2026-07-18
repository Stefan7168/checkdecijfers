# Three small designs — #138 regional refusal chip, #121 template-rung fail-closed, 85792NED named regions

**Written by the Fable overnight design marathon (2026-07-18→19), phase 6.** Three short, self-contained design notes;
each names its owner question (if any) and its build cost. Code claims verified against the repo this night.

---

## (a) #138 — the regional period-refusal chip: the honest code→label source + the chip form

> **✅ BUILT + LIVE 2026-07-18 (session 55 continued, commit `f2d015a`) — exactly as designed below; measured
> record in the [#138 row](../open-questions.md).** Kept for the design rationale.

**The gap (v1, #134(a)):** a period refusal on a region-carrying question ("werkloosheid in Amsterdam in 2050") gets
NO retry chip today, because a refusal carries no cells and naming a region from its bare code would be a guess
(`suggestions.ts:298-322` bails on `intent.regions.length > 0` — drop-never-guess).

**The honest source exists and is already built — it just isn't wired to the refusal path.**
`regionTermsFor(db, canonicalKey, codes)` (`src/answer/context/build.ts:59-98`, WP15) labels a specific set of region
codes via canonical key → table → GeoDimension → **`dimension_labels`** — a pure metadata mirror of CBS's own code
list, populated at registration from the code-list endpoint, structurally incapable of touching a cell value. It
already fails closed ("a partial region list would be a WRONG referent"): any unlabeled code → `null`. That is
exactly the "registry/codes-RegioS, nooit cellen" source the #138 row calls for.

**Design:**
- `buildRefusalSuggestions` gains a second injected closure (mirroring the existing `ServabilityCheck` injection —
  `suggestions.ts` itself keeps its never-sees-db confinement): `labelRegions: (codes) => …` wired to
  `regionTermsFor` at the call site (`respond.ts:174`).
- Chip generation: same period-retry chips as v1, now phrased WITH the labeled region ("Probeer 2024 voor
  Amsterdam"); every chip still gated through `echoServability` before render (house rule). If `labelRegions`
  returns null → v1 behavior byte-identical (no region chip, whole-bailout).
- Refactor note: `KIND_CODE_PREFIX` (`resolve.ts:40-45`) and `KIND_BY_PREFIX` (`context/build.ts:26-30`) are already
  near-duplicates — extract the shared helper instead of adding a third copy.
- **No owner question.** Zero prompt bytes, zero pricing, deterministic; a small standalone WP (~half a session,
  tests: labeled-chip render, unlabeled-code bailout, servability-gate, confinement test that suggestions.ts still
  never receives db).

## (b) #121 — the template rung: enforce or alert? (the owner question, sharpened, with a recommendation)

**The recorded issue:** `assemble()` attaches `validateAnswerBody()` to every answer but the template rung is served
regardless of the verdict; the recorded `ok:false` is read only by offline audit re-validation ("only mattered where
nobody looked" — the consumentenvertrouwen incident: negative value + 34-char unit slipped both validator blind
spots, PR #15 fixed those). The row's two options, now with the trade-offs made concrete:

1. **Fail-closed:** template body fails its own validator → refuse. Costs answer-rate on every FUTURE validator
   blind spot — and note what a template `ok:false` actually means: the template renders values straight from
   cells/derivations (incapable of fabricating, proven per shape), so a failing verdict on a template body indicates
   a VALIDATOR blind spot, not a lying answer. Fail-closed here refuses structurally-correct answers to punish our
   own checker's gaps.
2. **Serve + alert (recommended):** serve the template answer, fire an **admin alert** (the #144 `alerts.ts`
   precedent: email to ADMIN_ALERT_EMAIL + console.error floor) and stamp a distinct marker on the audit row so R8
   knows the verdict was known-failing at serve time. The blind spot becomes loud the first time it fires, the user
   still gets the correct-by-construction number, and R8's re-validation heals stored rows when the validator is
   fixed (reconstruct re-runs the CURRENT validator — the PR-15 pattern).

**Adjacent finding (not in the row — found this night, should ship with EITHER option):** the template rung can
**throw** — `renderTemplateBody` uses non-null assertions (`cells[0]!`, `byId.get(...)!`,
`template.ts:81-146`) and its call site (`compose.ts:143-148`) sits OUTSIDE the try/catch that guards the LLM
attempts. A template exception today propagates uncaught (no rung below, no handler up the chain) and surfaces as an
internal error. Fix regardless of the owner choice: wrap the template rung; on throw → an honest `internal` refusal
(the true floor of the ladder), + the same admin alert. **Owner question is exactly one line: option 1 or option 2
(recommendation: 2).** Decide before WP30c multiplies the shape surface (the row's own trigger). ~Half a session,
zero LLM spend; tests: seeded validator-blind-spot template serve+alert (or refuse), template-throw → internal
refusal, R8 marker round-trip.

## (c) 85792NED — named-region questions on a plain-dimension region table

**The measured situation:** `85792NED` (prijsindex koopwoningen, 2020=100) carries 21 regions (NL01 + 4 landsdelen +
12 provincies + Amsterdam/Den Haag/Rotterdam/Utrecht) but CBS types `RegioS` as a PLAIN `Dimension`, not
`GeoDimension` — so `resolveRegions` routes any named region into `region_on_national_measure`, whose clarify text
*"Die cijfers heb ik alleen voor heel Nederland"* is **factually wrong for this table** (the provincial/city index
cells exist and are ingested; only the frozen CC23/CC24 explicit-intent keys can reach them). The staged brief's
three options, assessed:

1. **Per-region keys (×21).** Rejected: pollutes the canonical vocabulary 21-fold, every future change pays the
   #164 re-record tax, and it scales to no other table.
2. **A dims-resolution layer for named-region-on-plain-dimension.** Right idea, needs bounding — a GENERIC "any
   plain dimension might be regional" inference is a guess (principle c).
3. **Redirect gemeente asks to 83625NED** (real GeoDimension, 745 gemeenten — but only JJ grain and only the
   average-PRICE level, not the index).

**Recommendation: a bounded (2) + (3) as the honest fallback.**
- **Bounded (2):** a curated per-table registry marker — `regionDimensionOverride: 'RegioS'` on the
  `house_price_index_regional` entry — that tells `resolveRegions` to treat that one dimension as geo-shaped. The
  existing machinery then works unchanged: the codes ARE standard region codes (GM/PV/LD/NL), `dimension_labels`
  already holds their labels from registration, the prefix-kind map already understands them. Curated, per-table,
  measured — not inference. "Prijsindex in Utrecht" resolves to GM0344; "in Drenthe" to its PV code.
- **(3) as fallback:** a named gemeente OUTSIDE the 21 (say Eindhoven) exits to a clarification that names both
  honest readings — *"De prijsindex heb ik alleen landelijk, per provincie en voor de vier grote steden. Voor
  Eindhoven heb ik wél de gemiddelde verkoopprijs (jaarcijfer)"* — a rule-4-shaped two-reading clarification that
  becomes one-click under WP26 Mechanism A. Never a silent cross-table swap: index (2020=100) and price level (€)
  are different answers to different questions.
- **Costs, stated honestly:** routing region terms for this key requires adding it to `REGIONAL_KEYS` — which lives
  in `prompt.ts` → **prompt bytes change → a #164 one-batch re-record** (~€2/ronde budget). Schedule this fix
  together with the NEXT vocab batch (e.g. a WP30c vocabulary addition or another coverage table), never as a lone
  change. Until then the standing behavior (national answer with the R7 transparent-default line) is safe but the
  `region_on_national_measure` clarify text stays slightly dishonest for this one table — if a quick interim fix is
  wanted, a text-only nuance of that clarify line for override-marked tables is deterministic and free.
- **Owner question:** bless the bounded-override direction (2)+(3), or prefer living with the national default until
  a real user hits it. The build is ~1 session riding a vocab-batch window; tests: override resolution for all 4
  code kinds, out-of-coverage gemeente → the two-reading clarification, CC23/CC24 unchanged, no other table affected
  (the override is per-table opt-in).
