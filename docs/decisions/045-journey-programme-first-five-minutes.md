# ADR 045 — The Journey programme: the five minutes around the answer (phases 0, 1, 3, 4, 5)

**Status:** accepted in design, 2026-09-12 (session 97, autonomous — the owner's session-96 kickoff pre-resolved the
plan's 12 decisions as working defaults the owner vetoes by exception; the money path, R3, is explicitly NOT built).
Built on branch `journey-programme`, one PR for the owner's review ([#118](../open-questions.md)(b)).

## Context

The experience improvement plan ([session-briefs/2026-09-11-experience-improvement-plan.md](../session-briefs/2026-09-11-experience-improvement-plan.md),
adopted in [08-build-plan.md § Journey programme](../08-build-plan.md), [#238](../open-questions.md)) found that the
answer card is good and the container around it — arrival, orientation, money, paperwork, phone — was never walked
end to end as a stranger. Every recommendation is deterministic: no AI call, no new library, no schema change. This
ADR records the decisions that REVISE an earlier owner decision, so the next session does not "fix" them back.

## Decisions

1. **The usage report reads what already exists** (`npm run usage:report`, `src/usage/report.ts`): weekly aggregates over
   the ledger, audit, trial, feedback and thread tables. **Aggregates only — never question text, never an e-mail, never a
   user id**; the test suite pins that on the JSON output. Trial→signup conversion is reported as "not measurable": the
   trial's visitor id has no join key to an account by design (ADR 036 D2), and no new personal-data link is added to get
   the number. On-demand-fetch spend is reported NET of refunds.
2. **Chip captions follow the message kind** (R2.1): a clarification's options say "Kies een optie", a refusal's retry
   chip says "Probeer in plaats daarvan", an answer's follow-ups keep "Suggesties voor een vervolgvraag".
3. **A clarification's options send on one click** (R7) — this revises the [#75](../open-questions.md) fill-don't-send
   convention for ONE message kind. The price is already on the clarification line, so the "user sees the cost first"
   intent holds. Each clarification message carries its own carrier snapshot; the click sends the byte-identical label
   against THAT round (never the live one), a send latch prevents double sends, and a resumed clarification (no
   carrier) falls back to fill-don't-send. Answer follow-ups and refusal retry chips keep fill-don't-send.
4. **The four inert composer chips collapse into one disabled "Eigen data (binnenkort)"** (R8) until attachments are
   on — then only the live "Bestand uploaden" shows. This knowingly reverses the session-86 demo-link and session-90
   sheet/database chip requests (decision 10, working default); the demo URL-row handler stays in the file, unreachable.
5. **The low-balance warning lives on the pre-send price line** (R2.3): amber and "Genoeg voor nog één vraag" when
   `simple ≤ balance < 2 × simple` — the [#69](../open-questions.md) rule, moved from the never-rendered dashboard
   panel to where the reader already looks. The client compares the server's two numbers; it computes nothing ([#68](../open-questions.md)).
6. **The insufficient-credits message is its own message kind** with a real link to `/credits` and the smallest pack that
   covers the shortfall, read from the server's active-pack list (never hardcoded).
7. **Honest waiting** (R11): after 8 real seconds of `busy` one line — "Dit duurt iets langer dan gewoonlijk; we
   controleren het antwoord nog." No fake stages, no progress bar; streaming stays undecided ([#211](../open-questions.md)).
8. **After a purchase the workspace polls instead of asking for a refresh** (R2.4): `router.refresh()` every 3 s for at
   most 10 ticks, hidden-tab aware, listener removed at the bound; the banner says the balance appears once Stripe
   confirms — the webhook still decides.
9. **The credits page states what a pack buys** (R10): "≈ N gewone vragen" and the € per question computed SERVER-side
   from the pack's own price/credits and the live simple price; "Credits verlopen nooit. Geen abonnement."; the signup
   explainer under the balance. Euro formatting follows the page language.
10. **Coverage as a collapsed disclosure** (R4, `web/lib/coverage-disclosure.ts`): "Welke bronnen zijn ingebouwd?" under
    the price line and as "Dit weten we nu" on the landing — active tables from OUR registry, the MEASURED sync date,
    the concepts, one example question per table built from the registry's everyday term + the measure's freshest loaded
    period (the inflation frame refusals.ts already proves; an article-free "Wat zijn de cijfers over {term} in {periode}?"
    for the rest — Dutch articles are not in the registry). Eurostat appears as "binnenkort" and is never claimed to
    answer anything (principle c). Cached 30 min, stale-over-nothing. The composer stays bare otherwise (session 87).
11. **The Style panel opens on Sjablonen only for an untweaked chart with no saved account default** (R5.2; ADR
    [043](043-chart-templates.md) decision 6 revisited by judgment, the counter still blind); anonymous visitors see one
    honest "Log in voor AI-verwoorde inzichten" line in the Insights panel (R5.3); the landing gains the Ontdek caption
    and a fourth step "Publiceer" (R5.1/R5.4, decision 8).
12. **Two trust pages as drafts** (R6): `/werkwijze` (the public-claim sentence, the steps, "voorlopig", refusals, what the
    claim does not cover) and `/privacy` (what is stored, retention 2 years / 90 days trial, self-service deletion, the
    LLM provider, Stripe, the session cookie AND the trial visitor cookie + hashed IP AND the aggregate usage counter —
    the first draft overclaimed "no analytics" and was corrected in review). Both carry a visible draft note until the
    owner (and ideally a legal read) approves; footer links exist from this branch on (ADR 033 D6: no dead links).
13. **Phone header** (R9.2, [#214](../open-questions.md)): below `sm`, "Credits kopen" and "Geschiedenis" move into
    the existing Account menu; wordmark, balance and NL/EN stay.

## Not decided here (owner)

R3 confirm-before-fetch (money path, decision 4), the larger signup grant (decision 5), applying migration 028, the
audit re-run (real spend), the trust-page wording sign-off, and the whole positioning thread ([#237](../open-questions.md)).

## Consequences

Two conventions now have one exception each and the docs that state them were updated in the same change ([#75](../open-questions.md)
→ decision 3; the session-86/90 chips → decision 4). The privacy page is the first public statement of what the product
stores; every future cookie, counter or store MUST update it in the same change (same rule as the system map).

## As built

**MERGED + LIVE 2026-09-12 (session 99, owner present): PR #14, squash `677c5fb` on `main`, `gate` green.** Owner steps still open after the merge: apply migrations 028 + 029 (`npm run db:migrate`), run `npm run usage:report` once, read/fill in `/werkwijze` + `/privacy` (contact e-mail; draft note comes off after), decide R3 (phase 2 — not built). The phone journey follow-up (R9.1, PR #19, `189d36b`) and the public face (ADR 046, PR #18, `ac14392`) merged the same session.
