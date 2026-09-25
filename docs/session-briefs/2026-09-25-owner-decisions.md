# Decisions waiting on you — 25 September 2026

*Written session 128 (2026-09-25) from the tracker ([open-questions.md](../open-questions.md)); each item names its tracker row in small print.*

This list only includes things where a session genuinely needs YOUR judgment call before it can move
forward — not things that are simply waiting for the AI provider's usage limit to lift on 1 October, and not
mechanical "flip a switch in production" steps (those are listed briefly at the very end). Ordered so
the things that affect real visitors most come first.

---

## 1. Answers stay in Dutch even when someone reads the site in English

When someone switches the site to English, the buttons and menus follow along, but the actual answer
to their question — the numbers, the explanation, the "prove this" text, the suggested follow-up
questions — is still 100% Dutch. It was a deliberate choice to keep the CBS answer engine untouched
while the English/Dutch switch was being built, but now that the switch is live, an English reader
sees a half-translated product.

**Options:**
- **Keep it as is, and say so.** Cheapest: add a small note on the English version explaining that answers are in Dutch because the source data is Dutch. No engineering work.
- **Translate the standard, computer-built sentences only** (things like "here are all the provinces" or "no data available") into English, since those never go through the AI step — moderate work, no added AI cost.
- **Fully translate every answer**, including the free-form explanation text — this does go through the AI, so it means re-testing that AI step in English and a small ongoing AI cost per English answer.

**Recommendation:** Start with option 2 (translate the standard sentence templates). It's the best value: it fixes the parts that repeat on every answer, costs nothing extra to run, and leaves the harder, costlier full-translation decision for later if English demand justifies it.

**If you don't decide:** answers keep showing in Dutch regardless of the site's language setting.

*(tracker #271)*

**Decided session 131 (2026-09-25): fully translate every answer** (option 3). Needs a design pass before building; real-model testing waits for the 1 October cap reset.

---

## 2. Should a shared chart link actually show what the visitor customized?

When someone styles a chart (colors, zoomed-in date range, hidden lines) and then shares it as an
embeddable snippet for another website, the little preview inside the share dialog shows their
customized version — but the actual embedded chart that ends up on the other website reverts to the
plain default look. We added an honest one-line warning in the share dialog saying this ("your
styling won't carry over"), so nobody is being misled, but the mismatch itself is still there.

**Options:**
- **Keep the honest warning as the whole fix** (built this session, not yet live) — free, no further work, just an occasional "why doesn't it look like the preview" question from a sharer.
- **Make the shared link carry the styling with it**, so what's shared always matches what was previewed — a real, moderate-sized build (the sharable link needs to hold more information safely).
- **Make the shared link freeze the exact chart at the moment it's shared** (styling, zoom, everything) rather than track the current default — a similar-sized build, but a different philosophy: "what you shared is frozen" instead of "what you shared always matches the current settings."

**Recommendation:** Keep the honest warning for now — nobody has asked for pixel-perfect shared charts yet, and both real fixes are non-trivial builds. Revisit if visitors start asking for it.

**If you don't decide:** the warning stays, and shared/embedded charts keep showing the plain default look, not the customized one.

*(tracker #243)*

---

## 3. Chart visual polish — closing the style gap with slicker competitor charts

You reacted that a competitor's report charts "look awesome" next to ours. The investigation found
we use the same underlying charting technology they do — this is purely a matter of visual styling,
not a technology swap. The gaps are real: their bars have rounded tops and a punchier color palette,
their charts animate smoothly on hover, ours don't. Some of our choices are deliberate trade-offs
(our colors are chosen to be readable by colorblind visitors; our charts don't animate because a
downloaded image must never capture a chart mid-animation) — a redesign needs to respect those, not
undo them.

**Options:**
- **Leave it as is.** Free, but the "looks less polished than the competition" feeling persists.
- **A scoped visual refresh**: punchier colors (while staying colorblind-friendly), rounded bar tops, a nicer hover highlight — a real but bounded design + build task, roughly a session's work.
- **A full redesign pass**, revisiting the chart look from scratch — bigger, slower, more likely to introduce new inconsistencies.

**Recommendation:** The scoped refresh (option 2). It targets exactly what looked dated in the comparison without touching the things that are working well or the honesty/export safeguards.

**If you don't decide:** the current chart look stays unchanged.

*(tracker #260)*

**Partly done session 129 (2026-09-25):** bars now have rounded ends (never on the zero line) and the hover card is tidier. The colours are unchanged — a punchier palette is a taste call I left for you (it must stay readable for colour-blind readers).

**Decided session 131 (2026-09-25):** colour-blind safety is no longer a rule for the default colours — the default should be whatever looks best, and people can choose their own colours. Change nothing now.

---

## 4. Dutch words still show up inside English-language charts

Related to item #1 above but narrower: even with the site set to English, chart labels can show Dutch
words like "procentpunt" (percentage point) mixed into otherwise-English chart text. This follows the
same "the data engine's own text stays Dutch" rule as the full-answer text, but on a chart it reads
more jarring because everything else around it is in English.

**Options:**
- **Leave as is** — consistent with how the rest of the Dutch-sourced text works, but visually odd on an English chart.
- **Translate just these chart unit words** (a short, fixed list — "percentage point," "×1000," etc.) — small, cheap fix, no AI cost, since these are fixed labels, not free text.

**Recommendation:** Fix it — this is a short, fixed list of words, so it's a cheap, low-risk cleanup that removes one of the more visible "half-translated" moments on an English chart.

**If you don't decide:** these Dutch unit words keep appearing on English-language charts.

*(tracker #294)*

**Done session 129 (2026-09-25), on the recommendation:** English charts now say "percentage point" and the other translated unit words. Say so if you'd rather keep them Dutch — it's a one-line revert.

---

## 5. Approve the wording for "no data from this European source"

When a European statistics figure (Eurostat) isn't available for a question, the site shows an
explanation of why — the wording was drafted directly from an already-agreed design decision, but you
haven't given it a final look.

**Options:**
- **Approve it as drafted** — no further work, the drafted wording is marked as approved.
- **Request edits** — you flag specific phrases, a session makes a small text change.

**Recommendation:** A quick read-through and a thumbs up (or specific edit requests) — this is pure copy review, not a design decision, and shouldn't need much of your time.

**If you don't decide:** the drafted wording stays as it is, just without your formal sign-off.

*(tracker #250)*

---

## 6. Should a chart-editing request that changes nothing still cost credits?

When someone asks the chat to tweak a chart ("make this a bar chart" or similar) and the AI can't
actually apply the change — say, it doesn't understand the request or nothing qualifies — the person
is still charged the normal 10 credits, because a real AI call was made even though nothing changed
on their chart. A separate, similar case (the AI asking a clarifying question) is already free.

**Options:**
- **Keep charging as today** — simplest, matches "we made the AI call, so it costs the AI-call price," but can feel unfair to someone who got nothing for their credits.
- **Refund automatically when nothing was applied** — fairer from the visitor's side, matches how the clarifying-question case already works; small, contained code change.

**Recommendation:** Refund it — a visitor getting charged for literally nothing happening is the kind of thing that erodes trust in the credit system, and the fix is small.

**If you don't decide:** a failed chart-edit request keeps costing the full 10 credits, same as a successful one.

*(tracker #285)*

**Done session 129 (2026-09-25), on the recommendation:** a chart-edit request that changes nothing is now refunded (own-data: charged like a clarifying question). Say so if you'd rather keep charging — a one-line revert.

---

## 7. Should the population 3D demo page be shareable with people who don't have an account?

The `/bevolking-3d-demo` page currently requires a login, like the rest of the product. If you want to
send this demo link to someone outside — a journalist, a prospective user — they'd hit a login wall
instead of seeing the demo.

**Options:**
- **Keep it login-gated** — consistent with the rest of the product, no marketing reach for this specific page.
- **Make it public** — two small config lines plus a test; then anyone with the link can view it without signing up, useful for outreach/demos.

**Recommendation:** Depends entirely on whether you plan to use this page for outside sharing. If yes, make it public — it's a trivial change. If it's just an internal reference, leave it as is.

**If you don't decide:** the page stays behind the login wall.

*(tracker #256)*

**Decided session 131 (2026-09-25): keep it behind the login.**

---

## 8. A homepage row showing off the different chart "looks" side by side

Five polished visual chart styles (named looks like "Salmon Editorial," "Studio Grey," etc.) are
already built and usable today from the chart styling panel. The idea was to also show them off in
a dedicated row on the homepage, the way you liked a competitor's "themes" gallery. You already
looked at some mockups and asked to hold off and think about better options first — so this remains
open, not because nothing was proposed, but because you weren't satisfied yet.

**Options:**
- **Skip a dedicated homepage row** — the five looks stay just as reachable through the chart styling panel; zero extra work.
- **Revisit with a fresh design pass** — worth doing if you still want a homepage showcase, but needs your input on what "better options" means to you.

**Recommendation:** Whenever you have 15 minutes, describe what felt off about the earlier mockups (too plain? wrong charts used? wrong placement?) so the next design pass isn't guessing.

**If you don't decide:** no homepage showcase row; the five looks remain available only via the chart styling panel.

*(tracker #275)*

**Decided session 131 (2026-09-25): try again later** — you'll say what felt off about the earlier mockups first.

---

## 9. Naming excluded areas by code instead of by name

When a chart shows a group of regions (e.g. "all provinces") but one region had to be left out
because CBS doesn't publish that figure for it, the note explaining the exclusion currently names
that region by its raw CBS code (like "GM0363") rather than its actual place name — most readers
won't recognize what that code means.

**Options:**
- **Leave as is** — the code is a real, checkable identifier, just not friendly to read.
- **Show the actual place name instead** — friendlier, small additional lookup, no honesty trade-off (still fully traceable).

**Recommendation:** Low priority — only worth fixing if a real visitor has actually been confused by this in practice. Not worth doing speculatively.

**If you don't decide:** excluded regions keep showing by their bare CBS code.

*(tracker #266)*

---

## 10. Should the "top and bottom" insight cards repeat something the answer text already says?

When a chart already shows a complete ranking (e.g. "these are all 12 provinces from highest to
lowest") and the written answer above it already states the highest and lowest, the little insight
cards below the chart currently restate the same highest/lowest fact a second time. It's not wrong,
just repetitive.

**Options:**
- **Leave it** — repetition isn't inaccurate, just slightly redundant.
- **Have the insight cards adapt their wording** when the answer text already covers the same ground — a small but real product-writing/engineering task, since nothing currently flags "this ranking was already fully stated above."

**Recommendation:** Low priority — hold until this is actually raised as an annoyance by a real user; not worth building against a guess.

**If you don't decide:** the insight cards keep restating facts the answer text already gave.

*(tracker #268)*

---

## 11. Should the "this total is incomplete" warning also show in downloaded files?

When someone uploads their own spreadsheet and asks for a total that's missing a few numbers, the
site already (as of this week) flags that total on-screen with a small note. That note does not
currently appear if the chart is downloaded as an image/PDF, or when hovering over the number — it
matches how a couple of other existing footnotes already work (they're also screen-only), so this may
be an accepted, consistent pattern rather than an oversight.

**Options:**
- **Leave as is** — consistent with existing behavior elsewhere in the product; downloaded files/hover text stay clean of footnotes.
- **Carry the warning into downloads and hover text too** — more thorough, but a real (small-to-medium) piece of work touching every export path.

**Recommendation:** Leave it, given it matches an existing, already-accepted pattern elsewhere — but worth a deliberate yes/no from you rather than leaving it as an accident.

**If you don't decide:** the incomplete-data warning stays on-screen only, not in downloads.

*(tracker #314)*

**Decided session 131 (2026-09-25): screen only.** Closed.

---

## 12. Three quick questions to unlock faster automated testing

A recent investigation found the biggest remaining lever to speed up the automated testing/build
process further needs three facts only you can supply:

**Options / questions:**
- **Which wait actually bothers you day to day** — the full test run before something ships, or something else?
- **Is this project's code meant to stay public on GitHub, or will it go private eventually?** (Running tests faster in parallel is currently free because the repository is public; it would start costing a small amount per run if it goes private.)
- **How powerful is the machine you build on, and do you usually have other programs running at the same time while tests run?** (Determines how much extra speed parallel testing can safely deliver without overloading the machine.)

**Recommendation:** A two-minute voice answer to these three questions is enough — no need to write anything up.

**If you don't decide:** testing speed stays at its current (already improved) level; the next round of speed-up work stays unscheduled.

*(tracker #245)*

---

## 13. A rare, currently-unreachable display glitch (informational, no action needed)

If a future page ever showed two separate charts' style-editing pop-ups at the same time outside the
normal page layout, the second pop-up could silently make the first one unusable. As far as testing
could confirm, no page in the product does this today — it's a theoretical gap, flagged so it isn't
forgotten, not an active problem.

**Recommendation:** No action needed now. Only worth fixing if a future feature is ever built that could trigger it.

**If you don't decide:** nothing changes; this stays a documented, dormant edge case.

*(tracker #244)*

---

## Things only you can do — no decision needed, just action

These are steps a session cannot take for you (they touch the live production database, cost real
money via the AI provider, or need to wait for the AI provider's usage limit to reset on 1 October).
No judgment call is required — they're just queued up:

- **Eurostat (European data) chat feature** — built and ready, switched off. Once the AI provider's
  usage cap lifts 1 October: record ~10 real test questions, run the two remaining setup commands,
  do a quick read-through of three Dutch topic descriptions, then flip it on in production.
- **"Publish your own chart" feature** — built and ready, switched off. Needs a database update and
  a production setting flipped on, both supervised by you.
- **Several smaller "run this command against the live database" chores** — backfilling a missing
  reference field, applying a registry update, running the full live benchmark test, and a handful of
  AI-response recordings — all blocked until 1 October by the same usage cap, all mechanical once
  unblocked.
- **A safe-to-remove leftover development folder** on your machine from finished work — your call on
  when to clean it up.
