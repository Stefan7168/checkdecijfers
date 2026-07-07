# ADR 029 — Follow-up suggestion chips under an answer (#73, owner request 2026-07-08)

**Status:** accepted (design frozen session 30). Build not started — execute brief:
[session-briefs/2026-07-08-follow-up-chips-brief.md](../session-briefs/2026-07-08-follow-up-chips-brief.md) (WP29).

## Context

Owner request (2026-07-08, verbatim intent): after an answer, show new example questions that FIT
the question just asked — same topic and/or deepening questions — to give users ideas and provoke
more questions. This is brainstorm idea **#73**, owner-approved earlier and **deliberately deferred**
by session 22 with a recorded condition: *deterministic templates alone cannot promise a SERVABLE
suggestion — an unservable chip invites a paid dead-end* (the #77/#97 pattern). The missing
primitive has since been designed: ADR [024](024-answer-first-defaults-and-clickable-options.md)'s
Mechanism A (pre-verified clickable options over the `echoServability` dry-run), and the roadmap's
drill-down-buttons row already says *"same UI mechanism as clarification options — build once."*
This ADR turns #73 into a buildable WP consistent with both.

## Decisions

**D1 — Chips are generated DETERMINISTICALLY from the answered intent + the registry; no LLM
anywhere.** Four bounded generators, fixed priority, cap 3 shown:
1. **Adjacent period** — same intent, period shifted to the nearest loaded neighbor ("En in 2023?").
2. **Trend/deepening** — the measure's loaded multi-year window as a series question ("Hoe
   ontwikkelde dit zich van 2019 tot 2024?") — only when ≥3 periods are loaded.
3. **Region variant** (regional measures only) — compare with the national figure or a G4 city
   ("Vergelijk met heel Nederland").
4. **Same topic** — another canonical measure on the SAME table ("Hoeveel huishoudens waren er?").
Chip copy is a deterministic Dutch template over registry labels — a QUESTION, never a data claim
(principle a untouched: no number, no fact in a chip).

**D2 — Every chip is servability-gated before display** (the exact #73 deferral condition, and
R7's own rule that offered options must resolve in loaded data): each candidate's
`StructuredIntent` must pass the `echoServability` dry-run (`src/query/dry-run.ts`, the #56
primitive); unservable candidates are silently dropped; zero survivors → no chip block at all. A
shown chip can therefore never invite the paid dead-end that deferred #73.

**D3 — v1 click behavior: FILL the input, never send** — the proven #75/#82 convention: clicking
puts the chip's question text in the input box, the existing pre-send cost line shows what it will
cost, the user presses send, and the turn runs through the completely normal (gated, audited)
pipeline. No new money entry point, no new backend route, independent of WP26's build.
**v2 (upgrade seam, deliberately designed-in): when WP26 ships Mechanism A**, the same chips swap
their click handler to the pre-resolved-intent path (no LLM re-parse; the
`resolveClarificationOption` sibling), because generation (D1) + gating (D2) are identical in both
— only the handler differs. *Residual v1 risk, accepted + recorded:* between chip display and
submit the normal LLM parse could read the filled text differently (e.g. clarify instead of
answer); mitigated by generating fully-explicit question text (measure, region, period all named —
the shape that parses confidently, per the #75/#97a precedent) and priced at worst as one ordinary
clarification round, which v2 eliminates structurally.

**D4 — Suggestions are a STRUCTURAL envelope field, not answer text.** `AnswerResponse` gains
`suggestions: string[]` (the servability-surviving chip texts), assembled post-compose like
`chart`/`stalenessWarning` — the R8-audited `text` string is byte-untouched, no prompt bytes change
anywhere, fixtures and the benchmark are unaffected by construction. Rendering: live chat only
(`chat.tsx`, under the answer, #84 styling conventions). The async dashboard/onboarded surface
waits for #117/#74.

## Alternatives rejected

1. **LLM-generated suggestions** — cannot promise servability (the recorded #73 blocker), adds
   prompt bytes + per-answer spend + an injection surface, and violates the "suggestions are
   product copy, deterministically generated" line every existing chip (#75, #97a) holds.
2. **Curated static suggestion lists per measure** — the owner's own #111 steer forbids per-topic
   static fixes; doesn't scale past the seed tables and goes stale with onboarded ones.
3. **Direct-answer-on-click in v1 (build Mechanism A now, inside this WP)** — couples WP29 to
   WP26's not-yet-started build and adds a new charged entry point in the same change; the
   fill-don't-send v1 delivers the owner's goal (ideas, provocation) with zero new money surface,
   and the v2 swap is one handler.

## Revisit triggers

- WP26 Mechanism A ships → do the v2 handler swap (remove the re-parse risk).
- Measured: a filled chip question that produced a clarification round (audit rows show it) →
  tighten that generator's template or drop it.
- Onboarded-answer surface (#117/#74 dashboard work) → extend chips there with the same generators.
