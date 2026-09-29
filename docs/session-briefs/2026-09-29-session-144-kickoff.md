# Session 144 kickoff (written 2026-09-29, end of session 143 — three WP-LOOK slices shipped)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file. Verify every claim against `git log`,
`gh run list --branch main -L 3`, `gh pr list` and prod (`curl https://checkdecijfers.vercel.app/`) before acting on it.

## Where things stand

- **Direction (ADR 063):** ONE product = a sourced chart of official statistics; gate = the owner says "I would share
  this" for (a) chart, (b) popup, (c) homepage. Order after the owner's rethink (#351): (a) → (b) → **(a2) share preview
  image** → (c).
- **(a) the card: DONE** on the owner's ruling (session 143, `df33e9c4`).
- **(b) the popup: round 1 built** (`abd02013`), owner ruling "good enough for now, come back to it later" — NOT signed
  off; another round after (a2)/(c). Residuals: fallback font parity, the empty right column on Grafiek at desktop
  height (left calm on purpose), owner has not asked for changes yet.
- **(a2) the share preview image: round 1 built** (`56c62d96`, CI 36548015000 green incl. deploy). The owner saw the real PNG;
  verdict pending. Residuals: the renderer's text renders in the image tool's fallback face (not Inter); the picture
  shows the spec's own line/bar, not the reader's chosen form; no Download button for that exact PNG; the local harness
  has no `EMBED_TOKEN_SECRET` (serves the neutral card there; the real card is exercised by the vitest rasterisation).
- **Disk:** the fixture-db cache is bounded now (3 snapshots). If space is tight again: RUNBOOK § "The hermetic test
  database cache".
- **Spend:** the $50 monthly roof resets 2026-10-01. The Look needs no AI spend.

## Next

1. **Part (c), the homepage** (`web/components/landing.tsx`): a real chart above the fold; fix the gallery cold start
   (#347: the curated feed's first request took 5.4 s and rendered skeletons — pre-render/pre-warm/cache; measure before
   and after). Design with the design skills; screenshots to the owner at desktop dark + light and phone; owner
   decides. Consider using the new share-preview images as static gallery thumbnails (kills the cold start).
2. Then a second round on (b) and (a2) from the owner's reactions (ask in ONE dialog with the screenshots described).
3. Only after the three sign-offs: the paused list in STATUS.

## How to look at it locally (zero spend, no production)

`preview_start` name `harness` → `http://localhost:3102` → set the cookie from `scripts/dev-harness/session-cookie.json`
via `document.cookie` (RUNBOOK § "Local real-browser harness") → ask "Hoe ontwikkelde de inflatie zich per jaar van 2020
t/m 2024?". For OWNER-facing screenshots use Playwright against the running harness (2× captures; the pane is capped at
~800 px and cannot crop) — see lessons-learned session 143, item 1. The share image: `/embed/<token>/opengraph-image`.

## Standing constraints

Principles (a)/(b)/(c). Verification block + e2e smoke (`cd web && npx playwright test e2e/cbs-copilot.spec.ts
e2e/chart-copilot.spec.ts`) + `/code-review` LOW + green CI before every push; no prompt bytes, no AI spend, no DDL.
Never `gh secret set`, never `spawn_task`. Repo is PUBLIC (competitors are "Competitor G" / "Competitor L"). Owner
present: push directly (#118); autonomous: branch + PR, merged on a plain-English GO. Plain English to the owner; put
everything the owner must read INSIDE the question dialog. ESLint crashes in this checkout (pre-existing, not the gate).

## Tracked, not the focus

Breadth step 6 / `TABLE_LANE_ENABLED` (migrations 037 + 038, recording run after 10-01), regional Part 2, Eurostat E2a
(#313), Pro plan, #245, #275, #328, #330 — paused by ADR 063. #349 white-glove service (parked, owner's call). #350 flake
(watch). ESLint tooling break (fix when convenient; CI does not lint).
