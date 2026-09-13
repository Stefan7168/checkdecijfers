# ADR 047 — Repositioning: "chat your way to an embedded, sourced chart," CBS first, Eurostat second

**Status:** accepted, 2026-09-13 (session 101, owner present). Formalizes a direction the owner already set in chat
on 2026-09-11 (session 96) and 2026-09-12 (session 97 continued) — this ADR does not introduce a new decision, it
writes the already-agreed one down where [CLAUDE.md](../../CLAUDE.md)'s doc-freshness rule requires it: as an ADR,
not only as an [open-questions.md](../open-questions.md) row. [Open-questions #237](../open-questions.md) tracked
this as owed since session 96; this closes that debt.

## Context

[01-product-vision.md](../01-product-vision.md)'s decision log (Q1, interview 2026-07-02) framed the product as
*"the trustworthy answer is the product, studio later"* — chat Q&A first, exports/studio/alerts deliberately
deferred. That framing was correct for Phase 0: it said what NOT to build first. It never said what the product
IS FOR beyond "answer a question about CBS data," and by session 96 that gap had become a real cost — competitive
research ([session-briefs/2026-09-11-competitive-research-localfocus-flourish-eurostat.md](../session-briefs/2026-09-11-competitive-research-localfocus-flourish-eurostat.md))
found LocalFocus (ANP, €530–890/mo, auto-updating embeds, no Q&A) and Flourish (free tier, Assistant + MCP
connector live on every tier since 2026-09) both compete on "the chart stays current, embedded, forever" —
a promise this product had all the pieces for (ADR [041](041-public-embed-pages.md)'s Live embeds) but had never
said out loud, marketed toward, or built a paid tier around.

The owner's response (session 96, in chat, recorded in [open-questions #237](../open-questions.md)): agree with
the competitive brief's recommendations, and set direction — *"chat your way from official-statistics research to
an embedded, sourced chart, over European and Dutch official data, CBS first, Eurostat next, other Dutch sources
(RIVM, Kadaster) after, one source at a time."* The ICP was written the same day into
[01-product-vision.md § Ideal customer profile](../01-product-vision.md), defined by the job (publish an official
figure, with its source, under time pressure, no data team) across four segments in go-to-market order. Session
97 continued (2026-09-12) reconfirmed: live embeds are *"the Pro plan's reason to exist"* ([open-questions
#205](../open-questions.md)).

What was missing until now: the vision's own Q1 framing still read as if the studio/embed surface were a
deferred nice-to-have rather than the product's actual specialization, and the roadmap's Phase 2/3 split still
listed "new data sources" as one undifferentiated Phase-3 row rather than naming Eurostat as the deliberate next
source. A fresh session reading the vision and roadmap in the standard order (CLAUDE.md's reading order) would
reconstruct the OLD framing before ever reaching the open-questions row that corrects it — exactly the "doc that
contradicts a newer decision is a bug" failure mode CLAUDE.md's doc-freshness section exists to prevent.

## Decision

1. **The specialization statement is now first-class, not a buried open-questions row.** *"Chat your way from
   official-statistics research to an embedded, sourced chart"* is the product's stated specialization, sitting
   alongside — not replacing — Q1's original "the trustworthy answer is the product" framing. Q1 said what to
   build first (the hard, risky part, proven before anything else); this statement says what the finished loop is
   FOR (ask → validated chart → embed that stays current). Both are true at once: the chat/validation pipeline is
   still the foundation every later step depends on, and the embed is still downstream of it, never a shortcut
   around it. [01-product-vision.md](../01-product-vision.md) gets an addendum on Q1 recording this, rather than
   a rewrite — the interview record of what Stefan actually said on 2026-07-02 stays intact.
2. **Live embeds are formally the Pro plan's reason to exist**, not one Phase-2 row among several export formats.
   [06-roadmap.md](../06-roadmap.md)'s Phase 2 "Visualisatie Studio" row already carries a superseded-note pointing
   at ADR 041; this ADR makes the pointer bidirectional and states the framing plainly: the free tier's ceiling is
   a frozen, attributed chart; the paid tier's whole pitch is that the same chart keeps itself current. Nothing
   about what's already built changes — `hasProPlan` stays the allowlist gate until a real subscription tier
   ships ([open-questions #205](../open-questions.md)) — this decision is about how the roadmap DESCRIBES what's
   already shipping (ADR 041's session-101 addendum: the visible price + interest-only upgrade click), not a
   change to what's live.
3. **Eurostat is named as source two, sequenced, not merely listed.** [06-roadmap.md](../06-roadmap.md) Phase 3's
   "new data sources" row lists PDOK/Kadaster/RIVM/UWV alongside Eurostat with no ordering. This ADR states the
   ordering the owner actually gave: **Eurostat next, after CBS's current work settles, demand-driven and never
   announced before it answers** (same posture WP16's CBS on-demand onboarding already proved out — refuse and
   grow the catalog on real demand, never pre-build speculatively). RIVM/Kadaster and the rest of Phase 3's source
   list stay exactly where they are, after Eurostat, unordered among themselves. This is a sequencing decision,
   not a scope or timeline commitment — no Eurostat work starts from this ADR alone.
4. **The four-segment ICP and its go-to-market order (already written into [01-product-vision.md § Ideal
   customer profile](../01-product-vision.md), session 96) supersede the vision's older "v1 audience: Dutch
   journalists" paragraph as the CURRENT targeting statement** — that paragraph is not deleted (it is still the
   accurate history of the 2026-07-02 interview decision and the reasoning behind €5–7.50 pricing), but a fresh
   session should read the ICP section as authoritative over it per the same doc-freshness precedence CLAUDE.md
   already establishes for STATUS.md. An explicit forward-pointer is added at the older paragraph rather than
   moving or rewriting it.

## Alternatives considered

- **Leave the direction as an open-questions row only, no ADR.** This is what session 96 through session 101 did
  in practice, and it is exactly the gap CLAUDE.md's doc-freshness rule calls a bug: open-questions.md is a
  tracking list, read on-demand ("as needed" in the reading order), not part of the default fresh-session path.
  A decision load-bearing enough to change what the product says about itself needs to be reachable from the
  standard reading order, which means an ADR (CLAUDE.md: "every load-bearing technical choice gets an ADR" — this
  is a positioning choice, but the "chat your way to an embedded chart" framing is also the thing several already-
  built ADRs, 041/043/044/045/046, were built to serve, so it is load-bearing on real shipped architecture, not
  only on marketing copy).
- **Rewrite Q1 and the "v1 audience" paragraph outright instead of adding pointers.** Rejected: both paragraphs
  are the accurate record of what Stefan actually decided in the 2026-07-02 interview. Silently rewriting history
  to match the current direction would erase the reasoning trail (why journalists first, why credit packs, why
  "studio later") that later decisions still depend on and reference. Addenda preserve both the history and the
  current state, matching the pattern already used throughout this repo (e.g. the English-UI-copy convention in
  CLAUDE.md, which is itself three layers of superseding addenda on one paragraph).
- **Rename or renumber the roadmap phases to match the new specialization** (e.g. an explicit "Phase 2: embeds"
  label). Rejected for now: the phases are already load-bearing pointers from many other docs and ADRs by number;
  renaming them is a bigger, riskier change than this ADR's actual content requires, and nothing about the
  specialization statement demands new phase boundaries — it demands the EXISTING Phase-2 embed work be described
  accurately, which the addenda below do without renumbering anything.

## Consequences

- [01-product-vision.md](../01-product-vision.md): an addendum after Q1 in the decision log states the
  specialization sentence and its relationship to Q1's original framing; a forward-pointer is added to the
  "v1 audience" paragraph directing a reader to the ICP section as current.
- [06-roadmap.md](../06-roadmap.md): Phase 2's Visualisatie Studio row gets a short addendum stating live embeds
  as the Pro plan's central pitch (pointing at ADR 041); Phase 3's data-sources row gets a short addendum naming
  Eurostat as the sequenced next source, demand-driven, after RIVM/Kadaster/etc stay unordered.
- No code, schema, pricing, or flag changes follow from this ADR by itself — it is a documentation correctness
  fix that also records a real decision. The actual Eurostat build, the real Pro subscription tier, and the
  embed-code-per-gallery-card follow-up all remain separately tracked ([open-questions #237](../open-questions.md),
  [#205](../open-questions.md)) and separately gated (a Eurostat build needs its own ADR before code, per the
  WP30 narrow-waist pattern already used for CBS; a real paid Pro tier needs the owner's explicit sign-off on
  price + Stripe structure before any real charge, per CLAUDE.md's money-path rule).
- `docs/open-questions.md` row 237's "not yet an ADR" caveat is resolved — the row is updated to point here.

## Revisit triggers

- The owner explicitly renaming or reordering the roadmap phases — revisit whether the addenda above still read
  correctly against new phase boundaries.
- A real Eurostat build starting — write its own ADR (per the WP30 CBS-adapter narrow-waist pattern) rather than
  extending this one; this ADR only fixes the sequencing statement, not the integration design.
- The real Pro subscription tier shipping — this ADR's Decision 2 should get an "as built" note the same way
  ADR 041 tracks the Live-embed gate's own status, once `hasProPlan` stops being the allowlist.

## As built

Documentation-only change, session 101 (2026-09-13, owner present): this ADR plus the addenda in
[01-product-vision.md](../01-product-vision.md) and [06-roadmap.md](../06-roadmap.md) described above, and
[open-questions #237](../open-questions.md) updated to point here.
