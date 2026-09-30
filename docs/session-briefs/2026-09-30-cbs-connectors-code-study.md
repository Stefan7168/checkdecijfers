# Five open-source CBS / Eurostat connectors — code study and what to reuse (2026-09-30, session 151, owner-requested)

**Why.** After the research in [2026-09-30-architecture-and-value-research.md](2026-09-30-architecture-and-value-research.md)
the owner asked for a deep read of the connectors that let Claude or ChatGPT reach CBS, a comparison with our code, and
what we can reuse. Row: [open-questions #357](../open-questions.md). Method: three cheap-tier agents read the source
through the GitHub API (nothing cloned, installed or run; no hosted endpoint called); the session re-checked the claims
it relies on against the source and against our own code. **No code was copied and none should be** — the list below is
techniques to re-implement (two of the projects carry Apache-2.0 attribution duties if code is copied).

## 1. The five projects

| Project | What it is | Size / state (GitHub, 2026-09-30) |
|---|---|---|
| [dstotijn/mcp-cbs-cijfers-open-data](https://github.com/dstotijn/mcp-cbs-cijfers-open-data) | Go, 7 tools over CBS's newer data service | 9 stars, 6 commits, last change March 2025, no tests, two real bugs in the data tool |
| [bewijs/cbs-mcp](https://github.com/bewijs/cbs-mcp) | A one-commit fork of the above: bugs fixed, 95 tests added | 2 stars, last change September 2025. The "label→code mapping, rate-limit, cache" in its GitHub description are **not in the code** |
| [pipeworx-io/mcp-cbs-nl](https://github.com/pipeworx-io/mcp-cbs-nl) | TypeScript, 5 tools over CBS's older data service; generated from a template | 0 stars, no tests, about 240 of 906 lines are CBS logic |
| [WAINUTAI/NL-GOV-MCP](https://github.com/WAINUTAI/NL-GOV-MCP) | TypeScript, 75 tools over 46 Dutch and EU sources; CBS is 3 of them | 17 stars, about 95 commits since March 2026, 446 tests, none checks a number |
| [cyanheads/eurostat-mcp-server](https://github.com/cyanheads/eurostat-mcp-server) | TypeScript, 6 tools over Eurostat; the most carefully built of the five | 7 stars, 98 commits since May 2026, about 667 tests on captured live responses |

**What they all are:** a thin pipe. The assistant gets tools to search tables, list a table's dimensions and fetch rows;
every decision — which table, which region code, which period code, which definition, what the unit means — is left to
the model. None keeps a database; they call the source on every request and cache for minutes to hours.

## 2. Compared with us

| Capability | The connectors | Us (checked in code) |
|---|---|---|
| Finding the table | Title substring match, no ranking; three of four do not filter out discontinued tables; NL-GOV-MCP's Eurostat "search" is a hard-coded list of four datasets | Dutch full-text search over our mirror of the catalogue, synonym hints, current tables first, a rerank step (`src/catalog/`) |
| Place and period → CBS codes | Not done in any of them (left to the model) | Done in code (region resolver, period spec, `places.ts`) |
| Units, "x 1 000", provisional vs final | Not handled in any CBS connector; the Eurostat one decodes status flags | Handled and tested (data rules R10, R11) |
| Which definition ("unemployment") | Whatever the model picks | Pinned and stated (`src/registry/defaults.ts`) |
| Source trail | NL-GOV-MCP: the request address and the time of the call. No dataset date, unit, status or licence | Every number to a stored cell, with CBS's own date, and an audit row |
| Accuracy checks | None has a test that asserts a number | 20-task benchmark with a frozen key, zero invented numbers as a gate |
| Chart | None | The product |
| Storage | None (so no reproducible answer, no record of CBS revisions) | Stored, checked cells |
| Timeouts, breaker, parallel-call limit | Yes in NL-GOV-MCP and the Eurostat one | **No timeout on any CBS or Eurostat call**; three retries; no breaker |
| Reach | 46 sources / all of Eurostat | 20 CBS tables + 4 Eurostat datasets (any-table lane built, switched off) |

**Judgment.** On correctness we are well ahead of all five; there is no answer logic worth taking. They are ahead on
reach and on the plumbing that makes calling the source on every question safe — exactly what ADR
[065](../decisions/065-retire-whole-table-copies-one-route.md)'s one route needs.

## 3. What to reuse (techniques, in order of value)

**For the one route (ADR 065 step 2 — design input):**

1. **A time limit on every call to CBS and Eurostat.** `src/cbs-adapter/odata-v4.ts` and the Eurostat adapter call
   `fetch` with no limit; a hung connection can use the whole 240-second job budget. The connectors use 10–30 seconds.
2. **A breaker and a cap on parallel calls per source** (NL-GOV-MCP `http.ts`: three failures pause that source for five
   minutes; at most three calls in flight). Needed once every first-time question triggers a fetch.
3. **One daily catalogue call as the change detector.** CBS's table list carries `ObservationsModified` and
   `ObservationCount` for every table in a single request (verified live today; our catalogue fetch deliberately drops
   them). Comparing that with each stored slice's CBS date lets a daily job refresh exactly the stored cells whose table
   changed — the automatic replacement for the hand refresh, the freshness report and the e-mail alert. The count also
   replaces our separate size call.

**For the Eurostat adapter:**

4. **Keep "data end" and the value count from Eurostat's catalogue file.** We already download that file and keep only
   "last update". A dataset whose "data end" stops moving is frozen — this would have caught `prc_hicp_manr` (session
   150). It is the kickoff's open "Eurostat freshness check", with a better signal than the response's `updated` field.
5. **Check that Eurostat returned every value we asked for, and that a period is a real one.** Eurostat silently drops
   an unknown filter value and silently rolls an impossible period into the next one (`2020-13` → `2021-01`); the
   Eurostat connector compares what it sent with what came back and validates periods first.
6. **Read valid codes from Eurostat's own "content constraint"** instead of hand-registering them.

**Small hardening:**

7. Escape quotes in filter values (`sliceToFilter` inserts codes as-is; low risk because codes are checked against
   stored lists first, and one line to fix).
8. Turn CBS's HTML/XML error pages into one plain sentence before logging or refusing.

**Already have, nothing to take:** table search, place/period resolution, units and status, period-over-period change
(ADR 052), dry runs, typed refusals, place-name variants.

## 4. Other things learned

- **All five run with no database against CBS's live service** — evidence that fetch-on-question is workable. What they
  lose by not storing (reproducible answers, noticing revisions, one stated definition) is what our store adds.
- **NL-GOV-MCP's source list is a map of Dutch open data reachable by API** (RIVM, DNB, Kiesraad, DUO, RDW, police
  figures, municipal finance, KNMI and more) — input for "which source after CBS and Eurostat", not a plan.
- **If we ever offer our own connector** (#356, recorded, not planned): the Eurostat project is the model — workflow
  instructions at server level, a "next step" hint in every result, typed errors that say what to do.
- **Unverified caution from one project's code comments:** CBS's older data service refuses traffic coming from
  Cloudflare's network. Relevant only if our server-side code ever moves there.
- CBS's newer service has exactly one catalogue (`CBS`, 4,888 datasets, checked today); police and municipal-finance
  data sit on a sister service with the older interface our adapter does not speak.

## 5. Not read

The shared framework under the Eurostat project (its retry defaults), most non-CBS connectors of NL-GOV-MCP, and any
live behaviour of the hosted demos.
