# #111 problem dossier — finder stock-vs-flow precision (pre-design, session 30)

**Status: problem-shape dossier ONLY. The design step has NOT started** — the owner asked to
coordinate the model tier first (a Fable candidate). This document is the design step's input:
what is verified about the failure, where the levers are, and what the design must decide.

## The failure, verified against the code (2026-07-07)

*"Hoeveel mensen zaten er in 2023 in de bijstand?"* → finder confidently picked `85615NED`
(*Personen met bijstand; (her)instromers en uitstromers* — a FLOW table: entries/exits per
quarter) → delivery found no stock/count measure → `unanswerable` → 100 credits refunded.
Owner verdict (binding): simple questions MUST answer, and the fix must be **general, not
per-topic static** ("het moet gewoon slimmer worden aangepakt").

Three code-level facts bound the design space:

1. **The stock-vs-flow intent is discarded BEFORE the finder runs.** The live seam passes
   `context.raw.unmatchedMeasureTerm` — the parser's extracted topic term ("bijstand") — as
   the finder's whole input (`src/answer/intent/policy.ts:133` → `findTable(db, topic, …)`,
   `src/catalog/find.ts:31`). The question's shape ("hoeveel mensen **zaten er in**" = a
   stock/level ask) never reaches Stage 1 or Stage 2. A rerank-prompt fix alone therefore
   cannot solve #111: the signal it needs is not in its input.

2. **The rerank sees no table SHAPE.** `serializeShortlist` (`src/catalog/rerank-prompt.ts`)
   renders per candidate: `table_id`, `status`, `dataset_type`, `title`, and a 240-char
   condensed `summary`. No measure names, no dimensions. For `85615NED` the title/summary
   words ("personen met bijstand") match the topic **better** than a kerncijfers table —
   topic-word overlap is the exact signal that misleads here. Stock-vs-flow lives in the
   table's **measure list** ("aantal personen" vs "instroom"/"uitstroom"), which is not in
   `cbs_catalog` (migration 011 mirrors the Datasets LISTING only; measure codes need a
   per-table metadata call).

3. **Fit is only tested AFTER the debit.** `triggerOnboarding` debits 100 credits
   synchronously at the trigger turn; the job later fetches, onboards, and only DELIVERY
   discovers there is no fitting measure — refund. There is no "does this table actually
   contain a measure that answers this question?" check anywhere before money moves, and no
   try-next-candidate: the finder's `alternativeIds` are recorded but never used on failure.

## The two levers (#111's own framing, sharpened)

**(a) Shape-aware reranking** — the rerank must see, per candidate, enough of the table's
shape (measure titles at minimum; ideally dimension kinds) AND the question's shape intent
(stock/level vs flow/change vs rate), so "meet in-/uitstroom" vs "meet aantal personen" is
visible and scorable. Two sub-problems: getting shape data per candidate, and getting the
question (or a parsed shape-intent) to the finder.

**(b) Pre-fetch fit gate** — before the 100-credit debit (or at least before it becomes
final), verify the picked table has a measure that plausibly answers the question; on
failure, try the next candidate (the rerank already emits `alternativeIds`) before giving up.

## Design decisions the design step must make

1. **Where does per-table measure metadata come from?** Options with known trade-offs:
   - *Enrich `cbs_catalog` at refresh*: principle-(b) clean (bulk mirror), but = one metadata
     call per table × 4,858 tables per refresh (`catalog:refresh` already takes ~19 min
     WITHOUT this; would multiply). Could be scoped: enrich lazily, only tables that ever
     enter a shortlist (cache-on-first-need — still a live call the first time).
   - *Fetch metadata for the ~20 shortlist tables at rerank time*: cheap per question (20
     calls), but live CBS calls in the REQUEST path — a principle-(b) exception that needs
     the owner (the WP16 fetch itself is already an owner-decided exception, but it is
     ASYNC/post-acknowledgment; this one would be synchronous pre-answer).
   - *Fit-check inside the ASYNC job instead* (see 2) — no request-path calls at all.
2. **Where does the fit gate sit relative to the debit?** Options:
   - *Check inside the job, refund-and-try-next-candidate on misfit*: no request-path CBS
     calls; debit timing unchanged (still charged up front, auto-refunded on total failure);
     the user experience becomes "slightly slower but answers" instead of "refund".
   - *Check at trigger time before debiting*: no wrong charge ever happens, but pulls CBS
     metadata into the synchronous turn (principle-b tension + latency).
3. **What carries the question's shape intent?** The parser already emits
   `unmatchedMeasureTerm`; the raw question text is available at the seam. Options: pass the
   full question to the rerank (cheapest, no schema change — the rerank prompt then owns the
   inference), or have the intent parser emit a small structured shape hint (stock | flow |
   rate | unknown) calibrated like the rest of R7. The first is less machinery; the second is
   measurable/calibratable.
4. **Escalation ladder**: ADR 025 pinned `TABLE_RERANK_MODEL='claude-haiku-4-5'` with a
   recorded Haiku→Sonnet→Fable ladder gated on measured misses. Shape-aware reranking is a
   harder judgment than title multiple-choice — the design should say whether the ladder
   moves BEFORE evidence (my read: no — re-measure on the labelled set + bijstand-class cases
   first, escalate on a measured miss, same as ADR 025 decided).
5. **Measurement**: `benchmark/tablefinder-labelled-set.json` + `npm run tablefinder:record`
   exist (sub-part 1). The design must add stock-vs-flow discriminating cases (bijstand is
   case #1) BEFORE code, so the fix is measured, not vibes (#104 pattern; also the still-open
   "no disclose-expected case" gap rides along).

## Constraints that bind the design

- Principle (c): a LOW-confidence shape match must keep degrading to disclose/refuse — the
  fix must never buy answer-rate with wrong-table risk. The hard allowlist + confident/
  disclose/none routing stay.
- Principle (b): any new live-CBS call path is an owner decision, stated explicitly.
- Owner steer: general capability, NOT per-topic aliases. (The 2 alias hints from session 25
  were Stage-1 RECALL fixes — acceptable precedent for recall, not for shape.)
- Money: every failure path must keep refunding in full (migration 013's widened trigger).
- The delivery-side residual (#111(b): geo/sub-coordinate tables refuse-and-refund) is a
  SEPARATE lever — widening `onboarding-vocab.ts` registration — and stays out of the finder
  design's scope unless the design finds them coupled.

## Model-tier question for the owner (blocking the design step)

The design spans intent parsing, catalog/ingestion architecture, a money-path gate, and a
principle-(b) exception decision — the widest-scope design since WP16 sub-part 2 (which got
Fable). Recommendation: **Fable for the one design step** (produce the frozen design doc, ADR
draft, and the labelled-set additions), then cheap tiers for implementation legwork per the
delegation rule. Alternative: attempt the design on the mid tier and have Fable only REVIEW
it — cheaper, but this is the kind of cross-cutting trade-off space where the review-only
pattern historically misses framing errors. Owner decides.
