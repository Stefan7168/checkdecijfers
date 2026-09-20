# Session 121 kickoff — checkdecijfers.nl / graphmaker.studio

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it,
including this file). Verify everything below against `git log`/`gh run list` before trusting it.

## The short version

Session 120 (2026-09-20) closed all three of session 119's "All, use subagents" follow-ups
(Minors, house styles, scatter), plus caught and fixed a real CI break and a real owner-reported
bug along the way. `main` @ `aca6a7ad`, CI green (`gh run view 35503056717`). Nothing is broken,
nothing is blocking. There is **no mandated next task** — this is an "ask the owner" kickoff, not
a "start on X" one.

## What session 120 actually did (verify with `git log --oneline -12`)

1. **Minors (#300–#305)** — built via a Fable-tier subagent, reviewed, pushed `a7054518`.
   #300/#302/#304/#305 shipped; #303 stays informational by design (no code fix intended).
   **#301 (`pieHole` chat-reachable) was built, verified correct, then reverted before push** — it
   changes the co-pilot's LLM structured-output schema hash, breaking all 10 recorded fixtures.
   Blocked on real LLM spend (Anthropic workspace usage cap, lifts **2026-10-01**). The diff is
   fully isolated and ready to re-apply once fixtures can be re-recorded — see open-questions #301.
2. **House styles (#275)** — five confirmed and built: Salmon Editorial, Studio Grey, Broadsheet,
   Autumn Letter, Brutalist Ink (`bf47bfa8`), entirely from existing `ChartPresentation` keys, no
   schema change. **The sixth piece — a homepage "themes" gallery row — was designed in chat (reuse
   the existing `consumentenvertrouwen` curated chart + the `GalleryCard`/`ChartView` pattern
   already mounted 3× on the landing page) but the owner said "I have to think about better
   options" and asked to hold.** Not approved, not built — don't assume that sketch stands; ask
   fresh or re-propose if this comes up again.
3. **A real CI catch:** the house-styles push also widened `TEMPLATE_IDS` (for chat-reachability by
   name) — broke 4 real-browser Playwright e2e tests, because `capabilities.templates` is embedded
   in the co-pilot's LLM prompt and shifts the request hash, same class of bug as #301. No vitest
   suite caught it, only the real Playwright run did. Reverted (`35513e4f`), verified locally with
   the actual e2e suite before repushing. **New standing lesson, read it before touching any
   allowlist/enum near the chart co-pilot:** `[[feedback_llm_prompt_embedded_lists_hash_risk]]` (a
   memory file) — grep `prompt.ts`/`schema.ts` for the field first, and verify with real e2e, not
   just vitest fixtures, before widening anything that might reach an LLM prompt.
4. **A real owner-reported bug, found and fixed same session:** the Style popup's Templates grid
   made Broadsheet and Autumn Letter look boundary-less in light theme ("clearly overflowing," in
   the owner's words). Root cause: the thumbnail's frame stroke used the app's own THEME border
   token, never checked against an arbitrary template's own paper colour — fixed with a fixed,
   non-theme stroke (`aca6a7ad`). See ADR 043 decision 11 and `docs/lessons-learned.md` session 120
   point 3 for the generalizable lesson (a design-time contrast gate that checks ONE relationship
   — series colour vs. paper — can still miss a real bug in an adjacent one — paper vs. app chrome).
5. **Scatter (#296) — investigated in depth, then deliberately HELD, not built.** The owner
   delegated the build-or-hold call ("You decide as a UX expert"). The real finding: the bottleneck
   is the QUERY layer (every query is one-measure-by-construction, ADR 011's one-varying-axis
   rule), not just the chart-spec point shape — a materially bigger, multi-session lift than the
   original "widen `ChartPoint`" framing suggested. A cheaper "two-period" variant would be
   redundant with the already-shipped slope chart. Held per the project's own
   cheapest-mechanism-first/escalate-on-evidence rule. Revisit trigger: real usage evidence (a
   logged request/refusal pattern), not just the original competitor-gap observation.

## What's actually next — genuinely open, ask the owner

No task is mandated. Live candidates, in no particular order:

- **A fresh design for the homepage "themes" row.** The owner wants better options than the
  session-120 sketch (reuse `GalleryCard`/`ChartView` on the `consumentenvertrouwen` chart). Don't
  re-propose the same thing without asking what specifically they want different — could be layout,
  interactivity, a different example chart, or something else entirely. This needs its own
  brainstorming pass (bounded — it's still an extension of the existing landing page and template
  mechanism, not a new subsystem).
- **Re-apply #301 (`pieHole` chat-reachable) and `TEMPLATE_IDS`'s five house-style entries** once
  the Anthropic workspace usage cap lifts (**2026-10-01**, about 10 days from this kickoff's own
  date) and the LLM fixtures can be re-recorded (`npm run chart-copilot:fixtures` +
  `npm run attachments:fixtures`, owner-supervised real spend). The diffs for both are documented
  in open-questions #301 and #275, ready to re-apply near-verbatim.
- **The long-pending owner steps**, unchanged for many sessions now, all blocked on the same
  Anthropic usage cap until 2026-10-01: `registry:apply`, DOI backfill, a live benchmark run,
  region-set query Task 9, audit row 22, and the two `:record` scripts.
- **A fresh priority** the owner has in mind that isn't tracked here yet — just ask.

## Binding constraints and owner steers (carried forward, still true unless a new session hears otherwise)

- Cheapest mechanism first; plain full-sentence English for the owner; no shorthand.
- Git: owner-present → push to `main` after the full verification block; autonomous → branch + PR
  (`#118`). Migrations file-only; live DDL, real LLM spend, env flags stay owner-supervised. The
  repo is public: "Competitor G" only, never the real name.
- Tier rule: session model thinks; implementers on a cheaper tier (Fable has been the standing
  steer across recent sessions — confirm it still stands if this session starts with no visible
  steer, since it's role-based, not a hardcoded default).
- Before widening any allowlist/enum in `src/attachments/copilot/` or `src/chart/copilot/`, read
  `[[feedback_llm_prompt_embedded_lists_hash_risk]]` first.
- No number is ever drawn that isn't a real fetched cell's own value, or pure arithmetic over
  already-verified reals — the one invariant every phase of this feature is built around.
- Before invoking a creative/design task (a new feature, a UI change, a visual choice), the
  `superpowers:brainstorming` skill is a hard gate — present a short design and get an explicit yes
  before writing any code, even for something that feels obviously bounded.
- Before proposing a fix for ANY bug, run `superpowers:systematic-debugging` — reproduce first,
  don't guess. Session 120's own overflow-bug fix is a good worked example: several rounds of
  "I can't reproduce this" before a screenshot and a specific pointer from the owner narrowed it
  down, and the real root cause only became clear after measuring the live DOM directly rather than
  guessing from a photo.

## Tracked, not the focus

`#289`–`#295` (earlier phase residuals); rebrand to graphmaker.studio (`#7`); the usual
owner-steps backlog listed above.
