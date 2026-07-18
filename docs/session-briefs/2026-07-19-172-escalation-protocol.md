# #172 escalation-WP protocol — finder model + threshold co-calibration (and the structural fix that comes first)

**Written by the Fable overnight design marathon (2026-07-18→19), phase 3.** Input: the measured s54 record (ADR
[025](../decisions/025-cbs-catalog-table-discovery.md) as-built note, `src/catalog/rerank.ts` comment block, the
session-54 archive entry, `benchmark/tablefinder-calibration-report.json` history). This is the protocol a supervised
session executes; it makes no decision the measurements haven't already made.

**The measured problem, restated in one paragraph.** On a byte-identical prompt, Haiku now stably (4/4) drops
`37789ksz` — the only v1-deliverable bijstand-stock table — from the cap-3 candidate chain (pick `85585NED`, alts
`[82015NED, 85692NED]`); the ADR-027 fit gate rejects all three and the s31-proven live class regresses to honest
refuse+refund. The ladder fired; Sonnet was measured properly after the params trap (`temperature: 0` API-errors on
Sonnet 5 — the fail-safe masked it as 9/11 disclose): richer chains (`37789ksz` back) but a MUDDY confidence
distribution — correct must-confident picks 0.60–0.88 overlapping should-disclose 0.60–0.62 against the
Haiku-calibrated 0.8 floor. No clean threshold exists → reverted. Meanwhile `chainContains: '37789ksz'` was weakened
to `notPick: '85615NED'` with a restore instruction.

**The reframe this protocol adds (from the recorded s31 lesson, lessons-learned):** *"when the deciding fact isn't in
the model's input, no tier escalation helps"* — deliverability (dims/grain) is invisible in the title+summary the
rerank sees. The chain is an LLM-whim ordering over a search space the system already holds deterministically (the
Stage-1 FTS shortlist). So the WP tries the STRUCTURAL fix first and treats a model swap as the escalation, not the
opening move.

---

## Step 0 — structural fix candidate: walk the shortlist, not just the model chain (measure first, €0 to design)

Today the ADR-027 fit gate walks exactly the model chain (pick + ≤3 alts). Proposal: after exhausting the model
chain, continue the walk into the **remaining Stage-1 FTS shortlist entries in deterministic FTS-rank order**, capped
at a total of ~6 walked candidates. The model chain stays a prioritization hint; chain membership stops being a
single-model judgment; the class becomes drift-proof (any future model dropping a deliverable alt no longer kills
delivery). Cost: up to 3 extra cheap-tier fit-gate calls per onboarding — a rare, already-100-credit path; latency
bounded by the existing per-candidate probe time.

**Verify before building (one hermetic query, no spend):** that `37789ksz` IS in the Stage-1 FTS shortlist for the
bijstand-stock query (`findTable`'s recall stage over the committed `_catalog.json` / live mirror). If yes → step 0
alone recovers the regressed class and the model-swap question decouples from the regression (do step 0, then decide
whether Sonnet is still worth it purely on chain/confidence quality). If no → FTS recall is the real gap (fix recall
terms, an alias-lane fix, before any rerank work — the s25 precedent).

**Assertion restore under step 0:** the labelled-set expectation becomes system-level — `walkContains: '37789ksz'`
(pick + alts + shortlist-extension, cap 6) — restoring the teeth the s54 weakening removed, without pinning one
model's alt-list whims. `notPick: '85615NED'` stays.

### Step 0 verification — ✅ MEASURED 2026-07-18 (first post-Fable session, hermetic + live read-only, €0 LLM)

Run via a one-off script over `recallCandidates(db, 'bijstand')` (the exact topic `findTable` passes to Stage 1),
on both the committed 83-row fixture (PGlite) and the live 4,858-row `cbs_catalog` mirror (read-only SELECT; mirror
last refreshed 2026-07-05):

- **Membership: YES on both legs.** Hermetic: position 14 of 14. **Live mirror: position 22 of 24** (rank 0.0760,
  second-lowest Regulier rank in the shortlist). So **FTS recall is NOT the gap** — the recall-terms/alias-lane
  branch of this protocol is ruled out, and Stage-2 has always seen `37789ksz` in its prompt (consistent with s31
  Haiku and s54 Sonnet both being able to place it in alternatives).
- **BUT the cap-6 rank-ordered walk as sketched above would NOT reach it.** The returned shortlist is merged by raw
  FTS rank; after the s54 model chain (85585NED + 82015NED + 85692NED) the next entries in FTS-rank order are
  ~15 higher-ranked Regulier tables (85615NED 0.2993, 85617NED 0.2432, 82020NED 0.1672, 80794ned + five
  gemeentefonds tables + 03763 + 81066ned + wijken-en-buurten tables at 0.1216–0.1368) before `37789ksz` at 0.0760.
  A rank-ordered walk capped at 6 total stops long before it.
- **Design consequence for the build session:** step 0 still stands (the structural fix beats a model swap — the
  deciding fact lives in the fit gate, not the rerank), but the walk parameter must change: either walk the FULL
  remaining Regulier shortlist through the ADR-027 fit gate (worst case here ~15–17 extra probes on a rare,
  already-100-credit path — bound it and measure the latency), or make the walk order deliverability-aware rather
  than FTS-rank-ordered. The `walkContains: '37789ksz'` assertion should be pinned against whichever walk actually
  ships (cap 6 would pin a walk that provably misses it — don't).

## Step 1 — the profile concept: model + params + threshold are ONE calibrated unit

`TABLE_RERANK_MODEL` + `temperature: 0` + `highConfidence: 0.8` stop being three independent constants. A
**RerankProfile** = `{ model, params, highConfidence, calibrationReportRef }`; only a profile with a measured,
committed calibration report may be selected; switching profiles is switching ALL fields at once. This encodes the s54
lesson ("escalation is a one-line change" did not survive) structurally.

**Params matrix (per model family — never assume across families):**

| Family | Params | Basis |
|---|---|---|
| Haiku 4.5 (current) | `temperature: 0` | proven config, deterministic-ish, 11/11 |
| Sonnet 5 | omit `temperature`, `thinking: 'disabled'` | Sonnet 5 rejects temperature 0 (measured s54); the compose-caller pattern (`src/answer/compose/prompt.ts`) |
| Sonnet 5 (variant) | `thinking` enabled | measure ONLY if the disabled variant fails the separation gate in step 3 — costs latency + nondeterminism |
| Fable / any newer family as API model | read the API contract at measure time; params are part of the profile | the temperature-0 trap generalizes: never port params across families |

**Eval-tooling fix that rides along (the masking trap):** `tablefinder-eval` must distinguish
`disclose (model judgment)` from `disclose (fail-safe: pick/confidence null after an error)` and report them
separately — the s54 first attempt looked like 9/11 model-disclose while every call had API-errored. A fail-safe
disclose in a calibration run is a RED result, not a pass.

## Step 2 — labelled-set extension: more chain cases, harvested not invented

The current set has 11 cases but only ONE true chain case (`bijstand-stock`). Extend to ~15–17 with 4–6 chain cases
whose deliverable table hides behind a natural-but-undeliverable top pick. **Harvest procedure (measured, not
guessed):** run the finder (hermetic recall + live rerank once) over the s23 audit's edge/out-of-coverage questions
that the coverage sprint has since brought in scope, plus the s52/s54 live-question log; keep cases where the
deliverable table ≠ the natural pick; pin each with `walkContains` + `notPick` and a note naming the deliverability
fact that makes it a chain case. Every new case follows the s54 convention (clearly-past periods in phrasings; the
finder set is topic-only but keep topic phrasing stable).

## Step 3 — the measurement protocol per profile

1. **Record rounds:** full labelled set ×4 same-day (`tablefinder:record` then ×3 `tablefinder:eval` live) — 4
   matches the 4/4 drift measurement; ×3 is too few to claim stability for a threshold move.
2. **Stability requirement:** zero outcome-class flips (confident/disclose/none) across all 4 rounds on every case;
   `walkContains`/`notPick`/`tableId` expectations pass 4/4. Confidence values may wobble WITHIN a class.
3. **The separation gap — the go/no-go number:** per round, compute `gap = min(confidence of correct must-confident
   picks) − max(confidence of should-disclose picks)`. **A profile is adoptable only if gap ≥ 0.05 in EVERY round**
   (worst round, not the mean — s54's Sonnet measured gap ≤ 0 (0.60 vs 0.62): correctly a no-go). The threshold is
   then set at the gap midpoint rounded to 0.05, replacing 0.8 for that profile — with the same failure-safe direction
   (below threshold → disclose, never a wrong table).
4. **System-level leg:** one live end-to-end smoke of the regressed class through the real onboarding path (the
   bijstand question must deliver again, the s31 "88s" class), plus `find-replay` re-record for the hermetic gate.
5. **Report:** per-case confidence table ×4, the gap per round, latency per call, tokens per call — committed to
   `benchmark/tablefinder-calibration-report.json` history like every prior round.

## Step 4 — go-criteria and the ladder's order

- **Adopt Sonnet** only if: step 0 is insufficient OR chain quality still matters after it, AND Sonnet
  (`thinking: 'disabled'`) passes step 3 (gap ≥ 0.05 every round, zero flips, chain/walk assertions 4/4, live smoke
  delivers). If the disabled variant fails ONLY on the gap, measure the thinking-enabled variant once before giving
  up.
- **Try Fable as an API model** (post-switch it remains available as `claude-fable-5` even though sessions run
  Opus/Sonnet) only behind a Sonnet no-go, and only if the miss is a judgment miss — re-ask the s31 question first:
  *"can any model see the deciding fact from this input?"* If the answer is no, fix the input (step 0 / recall /
  shortlist serialization), not the tier. Cost/benefit stated honestly: the finder is a low-volume path so per-call
  price is negligible; the REAL costs are a full step-3 calibration (€, below) and pinning a production behavior to
  the newest tier right after a family transition (drift/deprecation exposure — the exact failure mode #172 is).
- **Restore step (whichever branch):** `walkContains: '37789ksz'` (or `chainContains` if step 0 is rejected) returns
  to `benchmark/tablefinder-labelled-set.json` as a gate-blocking assertion, and the weakening note is removed. This
  is the WP's definition-of-done tripwire — the WP is not done while the assertion is soft.
- **Drift canary (operational, rides the monthly maintenance session):** one live `tablefinder:eval` (~cents) per
  month; a new outcome-class flip on a byte-identical prompt = the #172 detection path, now scheduled instead of
  accidental. RUNBOOK addition at build time.

## Spend budget for the owner (estimates, capped)

| Item | Estimate |
|---|---|
| Step 0 verification + build | €0 LLM (hermetic) + fit-gate calls only on live smoke |
| Step 2 harvest (one live rerank pass over ~20 candidate questions) | ~€0.20–0.50 |
| Step 3 Haiku re-baseline (extended set ×4) | ~€0.50–1 |
| Step 3 Sonnet profile (extended set ×4) | ~€1–2 |
| (conditional) thinking-variant or Fable profile | ~€1–3 |
| Live end-to-end smokes (onboarding path, 100-credit flow on a test account) | ~€0.50 |
| **Plan / hard cap** | **plan ~€5, cap €10** (s54 lesson: loops multiply; every extra loop is evidence-driven or it stops) |

Supervised, owner-present (live spend + live onboarding smoke). Not overnight-able. Estimated one session including
the step-0 build if the shortlist verification says yes.

## What this WP does NOT do

No prompt-byte changes to the rerank system prompt (the drift was measured on byte-identical bytes — the prompt is
not the suspect); no `DEFAULT_FIND_TABLE_CONFIG` change outside a profile adoption; no touching the intent-side
fixtures (separate hash domain); no automatic model swap without the full step-3 record — the s54 revert stands until
a profile measurably clears the bar.
