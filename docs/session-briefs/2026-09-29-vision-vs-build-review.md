# Vision vs. what we built — an honest review (2026-09-29, session 141)

Written for the owner before a vision interview. Facts were checked against the docs, the code and the live site today. Judgments are marked as such.

## 1. The short version

- **We have built three products on top of each other and never finished one.** A journalist fact-check chat (July), a "sourced chart, embedded forever" tool (September), and the start of a general chart maker (graphmaker.studio, mid-September). Each new direction was added; nothing was removed.
- **The size of the build is out of proportion to what anyone has seen.** About 1,900 commits, about 163,000 lines of code, 63 architecture decisions, 220 open questions, in three months. Two accounts exist (you and a test account). No outside person has ever used it.
- **"Beautiful charts" was never a work package with a finish line.** We built 13 templates, 8 fonts, 11 chart forms, a style panel and a chat co-pilot for editing. We never built one great default that looks good without touching anything. That is why it still looks unfinished despite all the work.
- **There is no launch gate anywhere in the docs.** The roadmap says "dates are deliberately absent; phases advance on their gates". The gates are all engineering gates (benchmark scores, flags). None of them is "a stranger used it and came back".

## 2. What the live site looks like today (checked in the browser)

**Homepage.** A text-only hero ("Chat with the Netherlands' official statistics"), three buttons, a trial box. No chart is visible above the fold. The product is about charts, and the first screen shows none.

**Gallery (our showcase).** On a cold visit the page shows grey placeholder boxes and the text "Loading the gallery — reload in a moment". The first request took over 5 seconds; only the third visit rendered the cards. A first-time visitor sees an empty gallery.

**A chart card, once loaded.** Each card contains, top to bottom: a question title, a measure name, edit/undo/redo/history icons, an "Insights" button, a unit line, one big number, a one-line summary, a row of 11 chart-form tabs (Line, Area, Bar, Horizontal bar, Table, Dumbbell, Slope, Heatmap, Pie, Stacked, Stacked %), two period dropdowns, the chart, an Insights panel, a definition line, an "Add a caption" link, a "Your goal lines (not CBS data)" box with a disclaimer, a "Mark period ranges (not CBS data)" box with a disclaimer, a three-line source paragraph, a sync badge and a Download link.

The chart itself is roughly a quarter of the card. Everything else is controls and disclaimers. The chart is a thin single line with large circle markers on a dark card with a blue gradient frame. It is legible and correct, but it is not something a person would want to put in an article as-is.

**Competitor G (the AI graph maker you referenced).** Big whitespace, one headline, one bold number in colour, the chart is the hero at 70 to 80 percent of the card, soft palettes, rounded frames, gradient fills, three example cards visible at once. Nothing to configure before it looks good. Its promise is "from messy data to beautiful graphs in a click".

**My judgment on the visual gap.** The gap is not the chart library or the palette. It is that we show the reader every capability the engine has (11 forms, goal lines, period ranges, insights, derivations) instead of one finished result. Competitor G hides everything until you ask for it. We built breadth of options where the product needed one opinionated default.

## 3. Vision as written vs. vision as built

| Date | Direction added | Still in the code? | Ever used by an outsider? |
|---|---|---|---|
| 2026-07-02 | Journalist fact-check chat over CBS, per-question credits | Yes, the core | No |
| 2026-07-04 | Billing and accounts before any "would you pay" signal | Yes, live (test-mode Stripe) | No |
| 2026-07-06 | On-demand fetch of any CBS table for 100 credits | Yes, live | Used 3 times, by you |
| 2026-07-12 | Web search add-on (unofficial sources) | Yes, live | No |
| 2026-09-05 | Upload your own CSV and chat with it | Yes, live | No |
| 2026-09-06 | "Your data visualized" rebrand, English interface | Partly (English yes, tagline no) | No |
| 2026-09-07 | Chart editing: templates, style panel, co-pilot | Yes, live | No |
| 2026-09-10 | Pro subscription at €19.99 with live embeds | Built, switched off | No |
| 2026-09-11 | Story mode, then Present mode, then a 3D map demo | Present mode yes; 3D demo hidden behind login | No |
| 2026-09-11 | Positioning against LocalFocus and Flourish: "the chart stays current, embedded, forever" | In the docs and the README, not on the homepage | No |
| 2026-09-14 | Eurostat as second source, "EU knowledge base" | Built, switched off, one table | No |
| 2026-09-17 | graphmaker.studio domain bought, "later a general chart maker" | A domain and a plan | No |
| 2026-09-17 | Chart co-pilot made top priority | Yes, live | No |
| 2026-09-25 | Full English answers | Yes, live | No |
| 2026-09-28 | "Any CBS table" breadth lane | Built, switched off | No |

The docs also contradict each other today on: who the target user is (journalists vs. "anyone who must publish an official figure"), whether we are in Phase 0 or Phase 1, whether there is a subscription, whether the name is checkdecijfers.nl or graphmaker.studio, and whether the promise is "CBS cell" or "official sources".

## 4. Features that no longer earn their place (my judgment, facts noted)

- **3D municipality map demo.** About 1,000 lines, fictional numbers, hidden behind login, unlinked. Serves nothing on the current path.
- **System overview page.** A public page explaining how the app is built. Developer-facing.
- **Eurostat explorer and adapter.** About 2,300 lines, switched off, one table, not answerable in chat.
- **Pro subscription and live embeds.** Built, never switched on, the Stripe price object was never created. Built before we knew whether anyone wants the free version.
- **Brand colours from a website.** 500 lines, never enabled.
- **Web search add-on.** Puts unofficial sources next to an "official statistics only" promise.
- **Two of everything.** Two chart components (4,800 and 2,300 lines), two co-pilots, an old dashboard kept as fallback next to the new workspace.
- **Goal lines and period ranges with disclaimers.** Each chart card carries two boxes saying "not CBS data". They are honest, but they make every chart look like a legal form.
- **13 templates and 8 fonts.** Options instead of a default. A user with no design eye gets 104 combinations and no guidance.
- **11 chart forms as tabs on every chart.** Most are wrong for most data; the tabs show the reader our menu instead of our answer.

What does earn its place, clearly: the deterministic answer engine, the source-and-date trail, the refusal behaviour, the credits ledger, the on-demand table fetch, own-data upload, the English interface.

## 5. Why this keeps happening (root causes, not blame)

1. **No launch gate.** Without a date or a "ten strangers used it" gate, every session picks the next most interesting engineering item. Ninety sessions of that is how you get 163,000 lines and no users.
2. **The next-priority question is answered by the docs, not by a user.** The build plan has always had a "next WP". It has never had "what did the last outsider say".
3. **Beauty was treated as options, not as a finish line.** The done-definition for the chart look was "a template system exists", not "a chart you would be proud to paste into an article, untouched".
4. **Additive decisions.** Each pivot was recorded as an ADR and built. None of them removed the previous direction. Three positioning statements now coexist.
5. **Sessions optimise for the benchmark and for correctness, and they are good at it.** The product is honest and correct. Nobody was ever asked to make it desirable.

## 6. What I recommend we decide in the interview

Not a menu of features. Five decisions, each of which removes something:

1. **One sentence, one user.** Who is the person and what do they get in 60 seconds? Everything not on that path is frozen.
2. **A launch gate with a date.** For example: ten named strangers use it in the week of X, and we decide the next feature from what they say.
3. **The look is a work package with a finish line.** One default chart, one homepage, judged against Competitor G side by side, done when you say "I would share this".
4. **A freeze list.** Which built features get hidden or removed from the live product now (not deleted from the code yet).
5. **The stop rule.** What we stop building until the gate passes, no matter how tempting.

## 7. Facts for reference

| Item | Value | Source |
|---|---|---|
| Commits | 1,908 (2026-07-02 to 2026-09-29) | git |
| Source lines incl. tests | about 163,000 | wc on src, web/app, web/components, web/lib |
| Chart UI code, excluding tests | about 33,000 lines in 108 files | wc |
| Architecture decisions | 63 | docs/decisions |
| Open questions | 220 open, 125 archived | docs/open-questions.md |
| Accounts | 2 (owner + test) | sanity-check brief 2026-09-28 |
| CBS tables loaded | 21 of 4,858 in the catalog | ADR 062 |
| Features behind flags, switched off | Pro plan, Eurostat (2 flags), table lane, brand colours | RUNBOOK |
| Cold-start time of the gallery | 5.4 s first request today, cards only on the third | curl today |
