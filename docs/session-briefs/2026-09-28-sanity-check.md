# Product sanity check — 2026-09-28 (session 138, owner-requested)

**Trigger.** Mid-session the owner said the regional-statistics work ("picking topics from CBS data") felt too niche and
asked for "a complete sanity check on what this web app should actually do". The session measured the facts below
(read-only queries against production and the docs) and recommended three moves; **the owner chose move 2 — breadth:
make any CBS table answerable quickly — as the next priority.** Row: [open-questions #335](../open-questions.md).

## What the product is for (unchanged — docs/01-product-vision.md, ADR 047)

Someone who must publish an official figure fast asks in plain Dutch and gets the right CBS number, a publishable chart
and a defensible source line — or an honest "this does not exist". Every number traceable to a CBS cell.

## Measured facts (2026-09-28)

- **Usage:** `audit_answers` holds 336 rows since 2026-07-02 from **2 accounts** (the owner + a test account): 150
  answers, 112 refusals, 74 clarifications; by tag 180 validation, 72 benchmark, 76 user, 5 anonymous trial, 3 onboarding
  deliveries. **No external user has ever used the product;** the public domain is still parked (by design, pre-launch).
- **Coverage:** **21 of 4,858** CBS catalog tables are loaded (0.4%). Hand-curating figures (26 canonical measures; 12
  more built this session for one table) cannot close that gap.
- **The breadth mechanism exists but is gated:** on-demand onboarding (WP16) fetches, validates and answers from a
  table we don't hold — but costs the user 100 credits and delivers asynchronously by e-mail. Used **3 times** (3
  delivered, 1 unanswerable).
- **Refusals by reason:** scope 26, smalltalk 19, internal 17, causal 10, forecast 9, still_ambiguous 6,
  onboarding_pending 5, meta 5, not_published 5, …
- **The owner's own refused asks:** an interactive map of Zuid-Holland house-price rises; Dordrecht's population by age.
- **Where recent effort went:** most of sessions ~100–138 improved depth on the curated set (chart co-pilot, English
  answers, the two-measure scatter, regional figures).

## Recommendation given (in order) and the owner's choice

1. Put the product in front of ~10 freelance/regional journalists with free credits and watch what they ask.
2. **Breadth, not depth — CHOSEN:** make "fetch a missing CBS table" the normal path: fast, in the same conversation,
   no 100-credit penalty, so most of the 4,858 tables become answerable under the same checks.
3. Stop hand-picking figures and chart polish for now; regional statistics Part 2 stays parked on branch
   `regional-stats-part2` (built + reviewed; only the paid re-record, merge and prod load remain — ADR 061).

Moves 1 and 3 were not rejected; the owner picked 2 as the next thing to build. Move 1 remains a standing
recommendation (a real-user launch) to revisit once breadth lands.
