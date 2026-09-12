# Local real-browser harness

Run the whole web app locally — logged-out AND logged-in, questions included — with **no production
database, no Supabase project and no LLM spend**. Built in session 98 (2026-09-12) because a remote
container has none of the secrets, and a real-browser pass must not touch production. Full procedure and
the gotchas: [docs/RUNBOOK.md](../../docs/RUNBOOK.md) § "Local real-browser harness".

| File | What it is |
|---|---|
| `pglite-preload.mjs` | `--import` preload: restores the hermetic CBS fixture snapshot (the CI database) into PGlite and hands it to `web/lib/db.ts`'s dev seam `global.__checkdecijfersDb`. Applies pricing defaults and the signup grant for the harness user. |
| `auth-stub.mjs` | A Supabase-Auth stand-in on :9911 — JWKS + `/auth/v1/user` for ONE fixed user; writes the `@supabase/ssr` session cookie to `session-cookie.json`. |
| `llm-stub.mjs` | An Anthropic-API stand-in on :9912 that replays `tests/fixtures/llm/**` — the benchmark questions answer end to end, nothing else does. |
| `env.sh` | The env the dev server needs (`source` it, then `npx next dev -p 3102` from `web/`). |
| `shot.mjs` / `ask.mjs` | Playwright helpers: a screenshot of any page (grows the viewport to the app's inner scroll container; prints `scrollWidth` + console errors) and "ask one question, screenshot the answer". |

```bash
node scripts/dev-harness/auth-stub.mjs &  node scripts/dev-harness/llm-stub.mjs &
cd web && source ../scripts/dev-harness/env.sh && npx next dev -p 3102
# another shell (playwright + chromium must be installed; point the two env vars at them):
export PLAYWRIGHT_MODULE=/opt/node22/lib/node_modules/playwright/index.mjs CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
COOKIES=scripts/dev-harness/session-cookie.json node scripts/dev-harness/shot.mjs http://localhost:3102/ out.png 375 dark nl
COOKIES=scripts/dev-harness/session-cookie.json node scripts/dev-harness/ask.mjs http://localhost:3102 "Hoe ontwikkelde de inflatie zich per jaar van 2020 t/m 2024?" answer.png 375
```

Never commit `session-cookie.json` (gitignored) or any `.next/` output; `next dev` also rewrites `web/CLAUDE.md`'s
agent-rules block — `git checkout -- web/CLAUDE.md` before committing.
