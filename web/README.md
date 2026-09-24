One route is intentionally public with no session: `/embed/[token]` serves a shared, read-only chart page for third-party embedding (ADR [041](../docs/decisions/041-public-embed-pages.md)) — see `docs/RUNBOOK.md`'s Embed go-live section for its env vars.

`/embed/own/[publicId]` is its own-data twin: a reader's chart made from their own uploaded file, published as a saved, revocable, pruned snapshot rather than a signed token (ADR [057](../docs/decisions/057-own-data-publish.md)). Built, but dark behind `OWN_DATA_PUBLISH_ENABLED` — see `docs/RUNBOOK.md`'s "Own-data publishing (ADR 057) — switching it on" section.

`/bevolking-3d-demo` is a standalone, login-gated, noindexed, unlinked DEMO over entirely fictional data — a 3D municipality map, not part of the product (ADR [049](../docs/decisions/049-3d-municipality-map-demo.md)); `three`/`@types/three` is the one owner-approved library exception, reachable only through that route's own dynamic import.

`/eurostat-explorer` is another internal, flag-gated tool (`EUROSTAT_EXPLORER_ENABLED`, ADR [048](../docs/decisions/048-eurostat-data-source.md)) for browsing the Eurostat adapter's own tables — not part of the public product either, and off by default.

This is a [Next.js](https://nextjs.org) (App Router) project, originally bootstrapped with `create-next-app`. It is a fully independent npm project — its own `package-lock.json`, not an npm workspace member (ADR [018](../docs/decisions/018-chat-ui-and-deploy.md)) — and reaches the backend source with zero duplication via `web/backend`, a committed symlink to `../src`.

## Getting started

From `web/`:

```bash
npm install
npm run dev        # next dev, http://localhost:3000
```

Or from the repo root, without `cd`-ing into `web/`: `npm run web:dev` (also `web:build`,
`web:test`, `web:typecheck`, `web:ci` — see root `package.json`). `.claude/launch.json` also
defines `web` (dev server, port 3000) and `web-prod` (`next start` over a real build, port 3001) as
named configurations for Claude Code's own browser-preview tooling.

The web app needs a real Supabase project + Postgres database and `ANTHROPIC_API_KEY` to run
end-to-end (see `docs/RUNBOOK.md` for the secrets list) — there is no seeded local database by
default.

## Running it with no database and no LLM spend

For UI work or a real-browser audit pass, [scripts/dev-harness/](../scripts/dev-harness/README.md)
runs the entire logged-in product — questions included — against a hermetic CBS fixture snapshot in
PGlite, with stand-ins for Supabase Auth and the Anthropic API. No production database, no Supabase
project, no LLM spend, no secrets. Full recipe and gotchas: `docs/RUNBOOK.md` § "Local real-browser
harness".

## Testing and typechecking

From `web/` (or via the root `web:test`/`web:typecheck` aliases from the repo root):

```bash
npm test             # vitest run (jsdom component tests, no network)
npx playwright test  # end-to-end smoke in a real browser (starts the dev harness itself)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # next build (also what CI runs before deploy)
```

`npx playwright test` runs `e2e/` — five short tests that drive the real app in a real browser
through the dev harness above (landing, an answered benchmark question with its chart and proof
panel, the same answer re-opened from storage, a region-set answer, a refusal). It brings the whole
harness up and down itself, so there is nothing to start first; if a harness is already running it
reuses it. Details and gotchas: `docs/RUNBOOK.md` § "CI e2e smoke".

CI (`.github/workflows/ci.yml`) runs this app's own typecheck + test suite + that e2e smoke in its own `web` job,
alongside a `backend` job for the rest of the repo; a separate `deploy` job (`needs: [backend,
web]`) is the only thing that ever deploys — Vercel's git integration is deliberately NOT connected
(ADR 018), so pushing to `main` alone does not trigger a Vercel deploy.

## Learn more about Next.js

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)
