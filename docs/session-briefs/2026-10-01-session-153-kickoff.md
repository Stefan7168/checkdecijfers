# Session 153 kickoff (written 2026-10-01, end of session 152)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block (**"THE PLOT"** first) → this file → the plan it points to. Verify every
claim against `git log`, `gh run list --branch main -L 5` and prod (`curl -sI https://checkdecijfers.vercel.app/`) before acting.
This file **supersedes** [2026-09-30-session-150-kickoff.md](2026-09-30-session-150-kickoff.md) and the session-148/149 briefs.

## The plot (owner, 2026-09-30 — binding)

The product is a **layer**: a question comes in, the layer finds the right table anywhere in CBS or Eurostat, fetches only
what it needs, checks it, answers. Not curated copies kept fresh. Twice in session 152 the session drifted into tending
single tables (pinning one welfare table; refreshing + converting four Eurostat datasets) and the owner stopped it
("you completely lost the plot"). Before proposing ANY work, apply CLAUDE.md's test: does this make the general route
better, or does it hand-tend one table? Only the first is on-plan.

## What session 152 did (verified 2026-10-01)

- **All 17 curated CBS tables now live on slice storage in production**, each proven identical to CBS before and after
  (0 differences; `86141NED` 616,714 cells); the daily warm job refreshes them (a manual run: all 17 `complete`, 0 refetched).
  Live read-only probe through the real query path served every curated measure.
- Two unused WP16 tables evicted from production (`83694NED`, `85615NED`) with the new targeted `tables:evict --table`.
  `37789ksz` stays until the CBS table lane is switched on, then is evicted (step in the recording plan).
- Eurostat connector deep study ([2026-09-30-eurostat-mcp-deep-study.md](2026-09-30-eurostat-mcp-deep-study.md)): borrow his
  portal plumbing, keep our answer rules. Built (all DARK, no AI, no schema): Eurostat slice plumbing, call limits +
  permanent-error classes + confidentiality split, the SDMX structure reader (30/30 sampled datasets read, 28/30 fit),
  observed decimals + a licence rule over every geography dimension, combined-flag notes (owner rule "join the notes"),
  Eurostat rows in the finder behind `EUROSTAT_FINDER_ENABLED` (English recall 10/12 in the shortlist, **Dutch 0/12**).
- CBS table lane: the **table-lane benchmark (ADR 062 step 6)** — 23 frozen tasks over 8 non-curated tables, key re-read
  from CBS (16/16), hermetic runner + scorer, canned self-check 14/14 + 9/9 + 0 invented; its fixtures are recorded by the
  SAME `tableparse:record` run. Region classes, now-vs-then, date ranges and "vorig jaar" now answered deterministically.
  A real flip blocker it found (unit "miljard kg CO2-equivalent" failing the number-word check) is fixed.
- Zero AI spend. No DDL. Open found issue: `audit:verify` shows 41 historical rows failing since the rebrand (#359).

## The single next priority: switch on the CBS any-table route

**When:** after the spend roof resets — 2026-10-01 00:00 UTC (= 02:00 CEST, 07:00 on this machine's +07 clock). Owner present.

1. **Decide first (owner, before recording — prompt bytes are recorded): add B1–B3 + B4 ([#360](../open-questions.md))?**
   Recommendation: yes, all. Exact additions (PERIODE block of the table-parse prompt, after the now_vs_ago line):
   - B1: `- "gestegen/gedaald/veranderd sinds vorig jaar" (of vorige maand, vorig kwartaal), "ten opzichte van vorig jaar" → {"kind":"now_vs_ago","unit":"year","amount":1}: een vergelijking van nu met de periode ervoor. Alleen "vorig jaar" zonder vergelijking blijft {"kind":"relative",...}.`
     Cases: 85669NED "Is de uitstoot van broeikasgassen gestegen sinds vorig jaar?" → now_vs_ago; 80590ned "Is de werkloosheid
     gestegen ten opzichte van vorige maand?" → now_vs_ago; control 85669NED "Hoeveel broeikasgas werd er vorig jaar uitgestoten?" → relative.
   - B2: `- "nu vergeleken met JJJJ", "ten opzichte van JJJJ" → {"kind":"since","year":JJJJ,"quarter":null,"month":null}.`
     Case: 85669NED "Hoeveel broeikasgas werd er nu uitgestoten vergeleken met 2015?" → since.
   - B3: `- "van JJJJ tot JJJJ", "tussen JJJJ en JJJJ" of "JJJJ-JJJJ" met alleen jaartallen → {"kind":"year_range",...}, beide jaren inbegrepen.`
     Case: 85669NED "Hoe ontwikkelde de uitstoot zich van 2015 tot 2020?" → year_range.
   - B4 (labelled cases only): 03759ned "Hoeveel inwoners had elke provincie op 1 januari 2024?"; 03759ned "Welke gemeente in
     Utrecht had op 1 januari 2023 de meeste inwoners?"; 84521NED "In welke provincie waren er in 2022 de meeste
     ziekenhuisopnamen?"; one case each for "5 jaar geleden", an explicit date range, "vorig jaar". ~3k input tokens each.
   Bump `TABLE_PARSE_PROMPT_VERSION` with the change; hermetic suites + `tableparse:eval -- --dry-run` before recording.
2. Run [2026-10-01-recording-run-plan.md](2026-10-01-recording-run-plan.md) **part A only** (B and C stay on hold). One record run
   now covers 39 calibration cases + 23 table-lane benchmark requests (~189k input tokens, ~$0.19; with the stability re-run
   ~$0.39 — plus B1–B4 if added). Cheap tier only.
3. `npm run tablelane:bench:run` (replay) + `npm run tablelane:bench:score` — gate: ≥ 12/14 answers, 9/9 refuse/ask, 0 invented.
   Risks named by the harness author: L19 ("waarom", no causal rule in the parser prompt) and L11 ("Schiphol" parsed as a place).
4. Owner GO → set `gate.enforcedInCi` true, flip `TABLE_LANE_ENABLED` (owner-supervised env flip), then evict `37789ksz`
   (`npm run tables:evict -- --table 37789ksz`, dry run then `--apply`).

## After that: the Eurostat route (study §5.4)

The Dutch-question gap is the next measured blocker: Dutch topics share no words with Eurostat's English titles (0/12).
Next: translate the finder's topic to English before searching Eurostat (measure, then build), then study step 4 (the
table reader over a Eurostat dataset's own lists — a recording run), step 5 (wire into the table lane dark + ≥ 5 Eurostat
benchmark tasks). Open before any generic Eurostat registration: EA21 review, mixed-grain datasets, the rerank prompt must
learn `current`/`possibly_frozen` (moves CBS replays), the frozen rule over-flags slow annual datasets (#357).
The four whole-table Eurostat datasets are NOT converted or refreshed by hand; they go once the Eurostat route answers.

## Tracked, not the focus

- [#359](../open-questions.md): 41 audit rows fail reconstruction since the rebrand — confirm on one row, pin as one documented
  divergence (#133 policy), never loosen the check.
- The whole-table sync path can be deleted only after `37789ksz` is evicted, the four Eurostat datasets are gone, and
  `70072ned` is handled by the route (#358).
- Launch deferred twice (#352): do not raise before 2026-10-27. DNS for graphmaker.studio still the owner's step.

## Standing constraints

Principles (a)/(b)/(c); full verification block (`scripts/verify-block.sh <dir> <log> [--e2e]`, solo on the 8 GB machine)
+ `/code-review` LOW + green CI before any code push; AI spend, env-flag flips and live DDL only with the owner present;
never `gh secret set`, never `spawn_task`; `git checkout -- web/CLAUDE.md` before every commit; plain English, everything the
owner must read goes INSIDE the question dialog. Agents: pre-approved to fan out; brief them with THE PLOT; agent
worktrees start from `origin/main` — push or name a local branch to merge first; grep for conflict markers after any
scripted merge; never a raw pipe character inside an open-questions table cell.
