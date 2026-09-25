# Security + privacy review: own-data chart publishing (ADR 057)

Scope: local `main` @ e2b10204. Read-only review. Probes were run through one throwaway
`web/lib/zzsec_publish.test.ts` (4 tests, run under heavy.sh, all passed). The file is now deleted and
`git status` is clean. The run was cut short by the coordinator's out-of-memory stop, so nothing more was
executed after that. Every finding below says whether it was **execute-verified** or is **code-read only**.

**Totals: Critical 0 · Important 4 · Minor 3**

---

## I-1 (Important, P1 leak, execute-verified): a hidden series' values can be recovered from the `rowRef` kept in its blanked slot

**Evidence**
- `web/lib/own-chart-publication.ts:238`: a blanked point keeps its original `rowRef`:
  `.map((p) => ({ rowRef: p.rowRef, xKey, xLabel, value: null, formattedValue: null, sourceText: '' }))`.
- Aggregate rowRefs list every member row: `src/attachments/execute.ts:228-229`
  (`agg:${fn}:${refs.join('+')}`). For `count`, the value *is* the number of members
  (`execute.ts:248-250`, `value = group.members.length`). For `share_of_total`, the rowRef carries
  `|total:${n}` (`execute.ts:348`).
- The pruned spec is passed as a prop to the client component `UserChartView` (`page.tsx:178-186`,
  `user-chart.tsx:37 'use client'`). That puts it verbatim in the RSC flight payload.

**Probe (PROBE 1).** Complaints counted per year by department, with the department "HR" hidden
(`toggleSeries s0`). The public payload's hidden slot contained:
```
{"label":"","points":[{"rowRef":"agg:count:r1:c0+r2:c0+r3:c0","xKey":"2020",...,"value":null},
                      {"rowRef":"agg:count:r5:c0+r6:c0+r7:c0+r8:c0+r9:c0","xKey":"2021",...,"value":null}]}
```
Splitting on `+` gives back HR's exact hidden values (3 and 5).

**Failing scenario.** A journalist publishes "incidents per year by team", hides one team for source
protection, and embeds it. Anyone who opens view-source or the RSC payload can read the hidden team's exact
counts. For `sum`/`mean`/`min`/`max` the same field reveals each hidden group's size and exactly which file
rows belong to the hidden segment. The same exposure applies to *visible* aggregate points, where it is also
sensitive. Example: "mean salary per department". The rowRef reveals n = 1 for a department, so the plotted
mean is one identifiable person's salary. The author never sees n, and ADR 057 does not list it as
published.

**Suggested fix.** In `pruneForPublic`, replace every blanked point's `rowRef` with a synthetic opaque id,
e.g. `h${i}:${j}`. Better, re-key all points to opaque public ids (`p0`, `p1`, …) and remap
`notes[].resultId`, `derivedOverlayRequests[].resultIds`, `headlineOverrideResultId` and the overlays'
`rowRef` through the same map. On the client, `rowRef` is only an identity key (`user-chart.tsx:1427`).
Then add a P1 test asserting that no `agg:`/`der:`/`r\d+:c\d+` string appears in the public JSON.

---

## I-2 (Important, P1 leak, execute-verified): with "sort by value", the order of a hidden slot's points is the hidden series' value ranking

**Evidence.**
- `sortPoints` sorts all series' points together by value, with nulls last (`execute.ts:464-471`).
- `chart.ts` then groups by first appearance (`chart.ts:~92-98`), so each series keeps its value order.
- `pruneForPublic` filters the blanked points but never reorders them (`own-chart-publication.ts:236-238`).

**Probe (PROBE 2).** Bar chart, series by segment, sorted by value descending, with VIP hidden. VIP's values
were 2019 = 10, 2020 = 900, 2021 = 300. The hidden slot's point order in the payload was
`2020, 2021, 2019`, which is VIP's exact ranking. Nulls-last would also reveal which categories the hidden
series has no number for.

**Code-read only (not executed):** the x-axis order may also follow this. The comment at
`own-chart-publication.ts:223-224` says buildRows takes the union of every series' x keys. If a hidden `s0`
is iterated first, the visible axis order itself follows the hidden ranking.

**Suggested fix.** In `pruneForPublic`, sort each blanked slot's surviving points into the visible x order
(the order of `visibleXKeys` as first seen across the visible series). Fix this together with I-1.

---

## I-3 (Important, deletion/GDPR, code-read only): neither account-level deletion nor the 2-year retention purge ever runs, so published links outlive both

**Evidence**
- `deleteUserDatasets` and `purgeExpiredDatasets` (`src/attachments/retention.ts:122,196`) have **no
  production callers**. `grep -rl` over the repo (excluding node_modules/.git/.next) finds them only in
  `tests/attachments/*.test.ts`, docs, and a stale worktree copy.
- The monthly GDPR cron (`web/app/api/gdpr-purge-cron/route.ts`) injects only the audit, trial and
  chart-style legs. `scripts/gdpr-purge.ts` has no reference to datasets or attachments.
- The self-service "delete my question history" action (`web/app/actions.ts:1026-1045`) redacts audit rows
  and the chart style only. It never touches `user_datasets`, `dataset_turns` or `published_user_charts`.
- ADR 057 point 6 (`docs/decisions/057-own-data-publish.md:37-38`) and spec §3.7 say "file deletion,
  account deletion and the 2-year retention purge all kill the link". Only file/thread deletion
  (`deleteOneDataset` via `dataset-actions.ts:362` and `actions.ts:1130`) is actually wired.
- Also: `published_user_charts.user_id` has an FK to `auth.users` with no `ON DELETE`
  (`migrations/036:45-46`). Deleting an auth user directly would fail rather than cascade (same pattern as
  the other user tables).

**Failing scenario.** A user publishes a chart, then uses "delete my history" or stops using the product.
The public link, and the author text and cell-derived values it serves, stays live indefinitely. The
underlying dataset is also never purged. The unwired dataset retention is an older gap, but publishing turns
it from "data kept too long" into "data kept too long *and publicly served*".

**Suggested fix.**
1. Add `purgeExpiredDatasets` as an injected leg of the cron route and `scripts/gdpr-purge.ts`, the same
   way as the chart-styles leg.
2. Decide, and state in the ADR, whether the account-level delete should also call `deleteUserDatasets`.
   If it should not, add an explicit "unpublish all my charts" action.
3. Correct ADR 057 point 6 and spec §3.7 to match what is actually wired.

---

## I-4 (Important, abuse/cost, execute-verified): the anonymous route does unbounded, uncached work, and a valid crafted log multiplies it about 300×

**Evidence**
- The page is `force-dynamic` with no cache (`page.tsx:70`). Every view:
  - loads the full dataset, including `cells` (up to a 4 MB file / 10k rows × 50 columns, `limits.ts`);
  - replays the log and renders again for the drift guard;
  - runs one `deriveChartOverlay` per kept overlay (`own-chart-publication.ts:294-297`). Each call runs a
    full `executeInstruction` over all rows (`derive-overlay.ts:137,170`).
- `buildPublishedChart` parses log entries one at a time (`own-chart-publication.ts:83,135-149`). This
  bypasses `commandLogSchema`'s `.max(200)` (`chart-commands.ts:530`). The only bound is the 64 KB JSON
  size check at publish time (`own-chart-publish-actions.ts:127`).
- There is no rate limit for `/embed/` in `web/proxy.ts`.

**Probe (PROBE 4).** Dataset of 10,000 rows. Chart = 20 filtered points. The log was
`addDerivedOverlay mean` commands packed up to the 64 KB cap: **377 commands** (> 200), with **0 dropped**,
so publish accepts it.
- Timing on this laptop: build 17 ms, prune plus overlays **593 ms**, versus **2 ms** for an empty log on
  the same dataset. Payload was 52 KB.
- The cost scales with rows × overlays, so a wider or larger file costs more per view.

**Failing scenario.**
- Crafted: any signed-in user crafts such a log with devtools (the server action takes an arbitrary array),
  publishes it, and then hammers `/embed/own/<id>`, or embeds it on a high-traffic page. Each anonymous hit
  costs about 0.6 s+ of function CPU plus a multi-MB DB read, with no auth and no cache.
- Ordinary use: even a normal published chart embedded on a busy news page reloads the full dataset on
  every view.

**Suggested fix (cheapest first).**
- (a) Cap the log at publish *and* read time by reusing `commandLogSchema`/`parseCommandLog` for the whole
  array, and cap overlay requests (e.g. ≤ 20).
- (b) In `pruneForPublic`, compute `allResolvedPoints(dataset, instruction)` once and resolve every overlay
  from that map, not per overlay.
- (c) Better: store the pruned public payload on the publication row at publish time. The page then only
  checks that the row, the turn and the dataset status are still valid. That is a cheap query that does
  not load `cells`. This also drops the per-view replay and drift renders.
- (d) Consider a Vercel firewall rate limit on `/embed/own/*`.

---

## M-1 (Minor, P1-adjacent, execute-verified): a note's `seriesLabel` is copied from an earlier chart and can show a cell value that is not on the public chart

**Evidence.**
- `addNote` checks only `resultId` and the note text (`chart-commands.ts:398-399`). `seriesLabel` and
  `periodLabel` are stored as given.
- `setInstruction` keeps notes on purpose (`chart-commands.ts:210-217`).
- `pruneForPublic` filters notes by `resultId` only (`own-chart-publication.ts:318`).

**Probe (PROBE 3).**
- Chart A was split by Klant; a note was added on `r1:c3` with seriesLabel "Minister X".
- `setInstruction` then switched to series by Regio. The public series labels were `Noord, Zuid`.
- The public payload still had `notes:[{"resultId":"r1:c3","seriesLabel":"Minister X",...}]`. It is
  rendered as "Minister X · 2020: …" (`chart-notes.tsx:122`).

**Why only Minor.** The author's own card shows the same stale label, so what the author sees is what gets
published. But the label is cell-derived (not author text), and it comes from a column that is not plotted,
which spec §4 says the public payload must not contain.

**Suggested fix.** In `pruneForPublic`, rebuild each kept note's `seriesLabel`/`periodLabel` from the final
spec's point with that `resultId`, or drop the stored copies. Better still, fix it at the source: have the
card derive them at render time.

## M-2 (Minor, code-read only): the 50-publications-per-user limit can be exceeded by concurrent publishes

**Evidence.** `own-chart-publish-actions.ts:141-160` reads `getPublicationForTurn` and `countPublications`,
then calls `upsertPublication` later. There is no transaction and no lock. N parallel publishes of different
turns at count 49 all pass. The impact is small (a resource cap, not access control).

**Suggested fix.** Do the count and the insert in one statement, e.g.
`insert … select … where (select count(*) …) < 50`, or take `pg_advisory_xact_lock(hashtext(user_id))`
inside a transaction.

## M-3 (Minor, privacy, code-read only): public embeds send visitors' IPs to Google Fonts when the author picked a Google font

**Evidence.**
- In public mode the card still runs the font effect: `user-chart.tsx:1376-1382` calls `ensureFontLoaded`
  for any `fontFamily`. It even builds a `source: 'google'` option for arbitrary regex-valid names.
- That injects a `<link href="https://fonts.googleapis.com/css2?family=…">` (`web/lib/font-loader.ts:9-29`).

**Failing scenario.** An embed on a third-party (e.g. German or Dutch) news site makes every reader's browser
contact Google without consent. This is the pattern the 2022 LG München ruling found unlawful.

**Suggested fix.** Self-host the few allowed fonts, or ignore `fontFamily` in public mode.

---

## Checked, no issue found

- **Authorization / IDOR.**
  - `publishOwnChart` compares `turn.userId` against the session user (`actions:113`), because
    `getDatasetTurnById` is not user-scoped. `getDataset` is user-scoped, and its `id` is cross-checked.
  - `unpublishOwnChart` and `getOwnChartPublication` bind `user_id` in SQL (`publications.ts:117-133`).
    Another user's turnId gives null/false and never leaks a link.
  - The public page checks that the turn's owner and dataset match the row (`page.tsx:133`).
- **publicId.** 128-bit `randomBytes(16)` base64url. It is shape-checked before any DB query, and both
  "missing" and "refused" render the same not-available page. Enumeration is not feasible.
- **Injection.**
  - Title, caption, notes, goal and era labels and the source line are all rendered as React text.
  - No `dangerouslySetInnerHTML` on the card path (the only `innerHTML` is in the PDF export,
    `chart-download.tsx:875`, which is hidden in public mode, `user-chart.tsx:3165`).
  - The source line has control and bidi characters stripped (`publication-source-line.ts:27`).
  - No author-supplied URLs are rendered.
  - `fontFamily` must match `^[A-Za-z0-9 ]{1,40}$`; colours must match `^#[0-9a-f]{6}$`.
  - The frozen `style` is sanitised twice (`chart-style-sanitize.ts`, then `sanitizeOverrides` in the card).
  - `frameBackground: {kind:'image'}` carries no URL. The image is local client state only
    (`chart-frame.tsx:27-37`), so it is null on the public page and cannot point at attacker or private
    storage.
- **Headers.**
  - `/embed/:path+` gets `frame-ancestors *`; everything else gets DENY (`next.config.ts:75-89`).
  - `/embed/` is on the proxy's public-prefix allowlist.
  - The page sets noindex metadata (`page.tsx:77`).
  - `embed/error.tsx` never renders `error.message`/`digest`.
  - `?lang=` is validated with `isLang`; `?theme=` is handled by the proxy with an allowlist.
  - The resize script checks `e.source`.
- **File/thread deletion.** `deleteOneDataset` → `redactTurnsForDatasets` hard-deletes publications in the
  same transaction (`retention.ts:80`). The page also refuses non-`ready` datasets and null instructions on
  every request. See I-3 for the paths that are *not* wired.
- **Other P1 fields.**
  - The file name, source host, content hash, `cells`, `profile`, the command log and `instruction`
    (including filter values) do not reach the payload.
  - `yHeaders` blanking by label holds.
  - Overlays, notes and the headline pointing at hidden points are dropped (this is covered by existing
    tests).

## Side observation (outside this review's scope)

PROBE 1's chart had series by department plus `aggregate: count`. **Both** series came out labelled "Count of
rows". `chart.ts` uses `aggregateLabel(fn, yColumn.header)` whenever `aggregate` is set, even when
`seriesBy` is set, so the seriesBy value disappears from the legend. That looks like a correctness bug in
the own-data chart builder, separate from publishing.
