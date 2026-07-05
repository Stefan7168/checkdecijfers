# Experience-audit results — 2026-07-05 (session 23)

**What this is:** the headline results of the session-23 **experience audit** — 110 audience-grounded Dutch questions run through the **real live pipeline** (`npm run audit:experience`, `scripts/run-experience-audit.ts`; same audited entry point as the deployed UI, real Anthropic calls, live Supabase, live clock). Unlike the frozen 20-task benchmark (which gates correctness on a known-good set), this deliberately probes real-user experience across 10 segments (core, messy phrasing, region-default, edge-of-coverage, follow-ups, comparisons/rankings, out-of-coverage, claim-check, interpretation, meta). Battery: [`benchmark/experience-audit-questions.json`](../benchmark/experience-audit-questions.json). Raw per-question dump: `benchmark/experience-audit-run.json` (gitignored — regenerable by re-spending). This memo is the committed record.

**Purpose:** quantify *what makes the product "feel off"* (the owner's words) and split it by which lever fixes it — the clarify-policy (WP26), missing data (WP16 + new sources), phrasing, or conversation memory. It is the input for priority **#3** (answer-quality optimization); a full per-question grade is done when #3 is picked up.

## Headline (turn-1 outcomes, measured)

| Outcome | Count (of 110) |
|---|---|
| Answered | 40 |
| Clarification | 32 |
| Refusal | 38 |

- **20 of the 56 answerable questions did not just answer** on turn 1 (they clarified or, worse, refused) — the "asks-too-much / friction" signal.
- **All 14 out-of-coverage questions hit the wall** (10 scope-refusals, 4 clarifications) — the coverage wall.

**Read:** the coverage wall (priorities #1/#2) is a *bigger* lever than the clarify-policy (#3) alone — which is exactly why the owner reprioritized data coverage to the front (session 23; see [STATUS.md](STATUS.md) TOP PRIORITY STACK).

## The 20 answerable-but-not-answered, by cause (preliminary)

- **No region named on a nationally-available measure → needless clarification** (e.g. *"wat is het besteedbaar inkomen van een huishouden"*). → **WP26 Mechanism B (B-region default)** fixes exactly this.
- **Superlative/peak over regions or periods → clarification** (e.g. *"Welke provincie heeft de meeste inwoners"*, *"In welke maand van 2024 was de inflatie het hoogst"*). → a **capability gap** (max-over-regions needs ≥2 named; max-over-periods = [#97b](open-questions.md), not built).
- **Messy/colloquial phrasing tripping the parse** — one answerable question even *refused* (*"wat was het inkomen van gezinnen vorig jaar gemiddeld, in duizenden euro's ofzo"*). → **parse robustness**; a real quality bug worth a closer look under #3.
- A few are edge-of-coverage borderline (correct to clarify).

## The 38 refusals

~14 are the deliberate out-of-coverage probes (bijstand, criminaliteit, onderwijs, migratie, zorg, klimaat, …) — **correct refusals today, and the direct target of WP16 (on-demand fetch) + new data sources.** The remainder are honest interpretation/forecast/meta refusals (correct behaviour). **0 fabricated numbers** across the run (the anti-hallucination core held).

## What this tells the plan

1. **Most of the "feels off" is coverage, not phrasing** — validates priorities #1 (WP16 on-demand fetch) and #2 (new sources).
2. **A real, WP26-shaped chunk of friction is the needless region clarification** — the B-region default is well-targeted.
3. **Two capability gaps** surface repeatedly: max-over-periods ([#97b](open-questions.md)) and messy-phrasing parse robustness — candidates for the #3 backlog.
