> **Naming note:** the competitor studied here is referred to as "Competitor G" throughout; its real name, URLs, people and investors are deliberately withheld because this repository is public. The owner knows which company is meant (owner instruction, 2026-09-18).

# Competitor G research + chart co-pilot decision — merge checklist

**Written 2026-09-17** by a read-only research session that ran in parallel with session 111 (which
owned the repo). This branch adds NEW files only, so it cannot conflict with session 111's work. When
merging into `main`, the person merging must also do the updates below — they touch shared docs and were
deliberately left out of this branch to avoid collisions.

## What this branch contains

1. `docs/session-briefs/2026-09-17-competitor-g-deep-dive.md` — the competitor study of Competitor G (Competitor G's app,
   Competitor G's SDK site, docs, skills repo, npm licences, a 102-agent fact-checked run, and two hands-on passes in the
   owner's Competitor G's app account including five AI-edit tests).
2. `docs/session-briefs/2026-09-17-graphmaker-studio-chart-plan.md` — the first-pass plan (rebrand to
   graphmaker.studio, gap table, phases) plus the owner's steers of the day in its §8.
3. `docs/superpowers/specs/2026-09-17-chart-copilot-design.md` — the spec for chat + direct controls on one
   chart ("Chart co-pilot"), with the owner's three decisions in its §7.

## Owner decisions taken 2026-09-17 (in chat) that shared docs must record

- **Rebrand:** the domain graphmaker.studio is bought. First USP: Dutch (CBS) + European (Eurostat)
  official statistics built in; later a general chart maker. Not the focus right now → update
  [open-questions #7](../open-questions.md) and #207 (name/claim), no ADR yet.
- **Focus now = chart quality, and specifically chat-driven chart editing.** The session-88 deferral of
  #212 ("no LLM instruction schema in v1, wait for usage evidence") is **lifted by the owner** →
  [open-questions #212](../open-questions.md): "decided, scheduled; spec = the chart-copilot design".
- **Two trust tiers:** on the user's OWN data (upload/paste/sheet) full freedom — the AI may filter, sort,
  group, aggregate, derive (fixed set), restyle, annotate, write titles; no honesty caveats to be restated
  for that tier. CBS/Eurostat: selection-only, numbers never through the model. Internet findings never
  become chart data (ADR 032) → note under ADR 037 as an as-built/decision addendum.
- **Derived columns on own data: fixed set** (difference, share of total, % change, ratio, sum/mean/min/
  max/count per group); free arithmetic only later on logged demand.
- **CBS chart edits saved in the ACCOUNT from phase 1** (a `chart_edits` table, numbered migration,
  owner-supervised, GDPR-purge retention leg) — overrides the earlier "per visit first" recommendation.
- **Chart input label: "Pas deze grafiek aan" / "Adjust this chart"** + three deterministic example chips.
- **Themes on the homepage:** the owner likes Competitor G's themes and wants a themes row on the homepage.
  Finding: Competitor G's app only has 12 colour palettes; the real house styles live in their SDK recipes. Plan:
  port six house styles as our own templates (spec §6 "then house styles"), show them on the landing.

## Updates to make at merge time — ✅ ALL DONE 2026-09-18 by session 111 itself after session 110's wrap-up (ADR 056; ADR 037 addendum; #7/#207/#212/#218 updated; #274–#276 added; build-plan WP; 03-mvp-scope row; STATUS + archive; lessons; session-112 kickoff)

- [x] `docs/open-questions.md`: rows #7, #207 (rebrand), #212 (lifted + scheduled), #218 (co-pilot extends
      the style panel), a new row for `chart_edits` persistence + GDPR retention, a new row for the
      homepage themes row.
- [x] New ADR: "Chart co-pilot — one command log, two doorways, two trust tiers" (context, decision,
      alternatives: Competitor G's SDK / chat-only / panel-only, revisit triggers).
- [x] ADR 037 addendum (own-data tier freedom; aggregate/derive allowed; fixed set).
- [x] `docs/08-build-plan.md`: new WP for the co-pilot with the five phases from the spec §5.
- [x] `docs/03-mvp-scope.md` Visualisatie Studio row: chat editing now IN scope (narrow the non-goal again).
- [x] `docs/STATUS.md` top block + `status-archive.md` entry for this research session.
- [x] `docs/lessons-learned.md`: (a) a WebFetch text summary of a marketing site is not "looking at the
      website" — screenshots/hands-on found the real limits; (b) do not burn tokens frame-grabbing
      videos, article screenshots had the same UI; (c) in the built-in browser, a narrow pane changes an
      app's layout and a blind click created a chart in the owner's account — screenshot before clicking
      after any navigation; (d) an emulated 1280px viewport made clicks miss in Competitor G — reset to desktop.
- [x] Memory: the research-session memory file already exists on the machine (see MEMORY.md).

## Hands-on facts worth keeping even if nothing else is read

- Competitor G's chat does data selection, chart type, goal line, title/caption. It cannot change line
  thickness, add annotations or highlights ("I can't change the line thickness directly"). Steps are
  stateless: a later prompt dropped an earlier filter and un-hid series. ⌘Z does nothing for panel/canvas
  edits; undo exists only per chat message and lost the title once.
- Their chart-type suggestion is deterministic (rule-based `evaluate`, no LLM) — our "cheapest mechanism
  first" rule, already validated by a competitor.
- Their SDK is closed source under PolyForm (free < 100 people & < ~$1M revenue); the MIT repo is docs
  only. Do not build on it. Vega-Lite / Observable Plot are the real open-source options if Recharts is
  ever replaced.
- Free tier: 5 charts, badge on exports, colours/logo paid. Plus $16, Business $36 (Sheets refresh, brand
  kits, password links).
