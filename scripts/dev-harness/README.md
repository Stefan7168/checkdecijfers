# Local real-browser harness

Run the whole web app locally — logged-out AND logged-in, questions included — with **no production
database, no Supabase project and no LLM spend**. Built in session 98 (2026-09-12) because a remote
container has none of the secrets, and a real-browser pass must not touch production. Full procedure and
the gotchas: [docs/RUNBOOK.md](../../docs/RUNBOOK.md) § "Local real-browser harness".

| File | What it is |
|---|---|
| `pglite-preload.mjs` | `--import` preload: restores the hermetic CBS fixture snapshot (the CI database) into PGlite and hands it to `web/lib/db.ts`'s dev seam `global.__checkdecijfersDb`. Applies pricing defaults and the signup grant for the harness user. Since session 111 (dev-harness Task 2) it ALSO registers + syncs one small Eurostat fixture table (`eurostat:demo_pjan`, `tests/fixtures/eurostat/demo_pjan`) into that same private db via the real `registerTables`/`syncTable` pipeline — the CBS snapshot itself (`tests/helpers/fixture-snapshot.ts`, shared by all 34 hermetic test files) is untouched; this registration is added AFTER restoring it, in the harness's own db only. |
| `auth-stub.mjs` | A Supabase-Auth stand-in on :9911 — JWKS + `/auth/v1/user` for ONE fixed user; writes the `@supabase/ssr` session cookie to `session-cookie.json`. |
| `llm-stub.mjs` | An Anthropic-API stand-in on :9912 that replays `tests/fixtures/llm/**` — the benchmark questions answer end to end, nothing else does. |
| `env.sh` | The env the dev server needs (`source` it, then `npx next dev -p 3102` from `web/`). |
| `run-next-dev.mjs` | Node-based equivalent of `env.sh` + `next dev`, for driving the harness from `.claude/launch.json`'s `preview_start` (session-101 addition — a `runtimeExecutable: "sh"` entry running `env.sh` hit a sandboxed-shell `getcwd: Operation not permitted`, and `NODE_OPTIONS`'s whitespace-tokenizing broke on a checkout path containing spaces; this sets the same env vars in-process via `node`, matching `scripts/dev-web.mjs`'s known-working pattern). Not needed for the manual recipe below — that still works as documented. |
| `start-all.mjs` | ONE command for all three (auth-stub + llm-stub + `run-next-dev.mjs`), exiting non-zero if any of them dies. Added session 110 so Playwright's `webServer` block can own the harness lifecycle for the CI end-to-end smoke (`web/e2e/`, `web/playwright.config.ts` — run it with `cd web && npx playwright test`; see [docs/RUNBOOK.md](../../docs/RUNBOOK.md) § "CI e2e smoke"). The manual three-shell recipe below is unchanged. |
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

## Two surfaces the LLM stub alone could never reach (session 111, dev-harness Tasks 1–2)

The LLM stub only replays recorded fixture questions, so two real answer shapes had no way to appear in a
harness run: a region-set answer (ADR 054 — "welke provincie heeft de meeste inwoners" over the WHOLE
class, not two named regions) and anything on `/eurostat-explorer` beyond its empty state. Both are now
reachable, fully offline, no real LLM call and no real Eurostat/DataCite call either.

**1. Region-set intent injection (`HARNESS_INTENT_INJECT=1`, set by `env.sh`/`run-next-dev.mjs`).**
`src/answer/respond/harness-intent.ts` lets a question that starts with `!!regionset <name>` or
`!!intent {json}` skip the intent parser entirely and hand `respondToIntent` a hand-authored
`StructuredIntent` — the one way to exercise `regionSet` today, since Task 9 of ADR 054 (the LLM-facing
vocabulary) is deliberately not built. Reachable ONLY when the flag is `1` (never in production); flag off,
the exact same text falls through to the ordinary parser (pinned in
`tests/answer/harness-intent.test.ts`). Two ready-made questions, matching
`tests/query/region-set-run.test.ts`'s own fixtures:

- `!!regionset provincies` — population on 1 January, ALL 12 provinces, 2025 — a COMPLETE class (renders
  the "Dekking:" coverage line stating 12/12, and a superlative in the body since RS1's ranking derivation
  exists for a complete set).
- `!!regionset gemeenten-utrecht` — average home sale price, every gemeente in Utrecht (PV26), 2024 — 26
  applicable cells + 16 not-applicable (abolished gemeenten), still a COMPLETE class.

A raw hand-authored intent also works: `!!intent {"target":{"kind":"canonical","key":"..."},"period":{"kind":"codes","codes":["...JJ00"]},"derivation":"none","regionSet":{"kind":"all_provincies"}}`
(`schemaVersion` is forced to the current value regardless of what the JSON says).

**2. A registered Eurostat table (`EUROSTAT_EXPLORER_ENABLED=1`, set by `env.sh`/`run-next-dev.mjs`).**
`pglite-preload.mjs` registers + syncs `eurostat:demo_pjan` (the smallest fixture under
`tests/fixtures/eurostat/`, 9 rows: 1 unit x 3 geo x 3 years) into the harness's OWN db via the real
`registerTables`/`syncTable` pipeline against a real `EurostatFixtureSource` — the same call
`tests/eurostat-adapter/register-sync.test.ts` pins, the FIRST time that pipeline has run end-to-end
against a non-CBS `CbsSource` (previously only `tests/sources/conformance.test.ts` exercised the adapter,
and that harness never touches a database). The out-of-band DOI-verification call
(`registerTables`'s own `fetchImpl` seam, ADR 048 D7(a)) is stubbed to a synthetic "findable" DataCite
response — no real network call. Visit `http://localhost:3102/eurostat-explorer` (logged in or out — it
is not behind the auth stub) and pick "Population on 1 January" to see the dataset, filters, table+chart,
CSV export and proof panel.

**Verified once (session 111).** Started the real harness (auth-stub + llm-stub + `next dev`, both new flags
on) and confirmed with real HTTP requests: `/eurostat-explorer` (with the auth-stub's session cookie —
every route needs it, `web/proxy.ts`'s allowlist doesn't cover this internal tool) returned HTTP 200 with
"Population on 1 January" in the page (not the empty-state copy). This machine had no Playwright/Chromium
installed (the `PLAYWRIGHT_MODULE`/`CHROMIUM_PATH` paths above assume a cloud sandbox that has them
pre-installed), so the `!!regionset` question could not be clicked through the real chat UI here — installing
a browser was out of scope for that session. Instead, `askQuestion` (`web/app/actions.ts`) was read to
confirm the question string reaches `answerQuestionAudited` → `respondToQuestion` verbatim (only
`guardLength`/`guardRequestId` run first, no trimming or sanitizing that would touch a `!!` prefix), and
`tests/answer/harness-intent.test.ts` exercises that EXACT downstream call — `respondToQuestion` with
`HARNESS_INTENT_INJECT=1` and `!!regionset provincies` — against a real ingested database, asserting a
`region_set` result, a non-null chart and a non-empty `regionSetLine` (the "Dekking:" coverage sentence).
A session with Playwright available should still do the real click-through once; this is the harness's own
gap, not a claim that it was seen in a browser.

Two build-time worktree gotchas hit while starting this harness (Turbopack, not `next dev`'s own runtime —
same root cause as the existing "Turbopack refuses a symlinked `node_modules`" RUNBOOK note, but this
repo's own symlinked `node_modules`/`web/node_modules` in a FRESH worktree hits it twice, once per
symlink): `cp -al <main checkout>/node_modules node_modules` and
`cp -al <main checkout>/web/node_modules web/node_modules` (remove the symlink first) fixes both — seconds,
~no disk, per RUNBOOK's existing note for the `web/` one alone.
