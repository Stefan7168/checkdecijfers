# Own-data parity B1: publish a chart made from an uploaded file

**Status:** design approved by the owner in chat, 2026-09-24 (session 127). Decision record: ADR
[057](../../decisions/057-own-data-publish.md). Tracker: [open-questions #318](../../open-questions.md).
Parent spec: [own-data parity design](2026-09-23-own-data-parity-design.md) §4 (B1).

## 1. Owner decisions (2026-09-24, in chat, plain-English options)

1. **B1 — may a user publish an own-data chart?** Yes, opt-in per chart (the recommended option).
2. **B2 — own data + CBS in one chart?** Wait for evidence. ADR 037's "never combined for v1" stands.
3. **Mechanism:** a *saved publish record*, not a stateless signed link like the CBS embed (ADR 041). A signed
   link could only ever publish the chart as it was first made (ignoring later data changes and hidden series)
   and could only be taken down by deleting the whole file. That is acceptable for public CBS data. It is not
   acceptable for a person's own data.
4. **Source line:** the author may type one (plain text, at most 120 characters). If they don't, the page says
   "Source: data supplied by the author". **The file name is never shown publicly.**

Not in scope: a public gallery of user charts (the gallery is curated CBS stories; opening it to uploads means
moderation), Live embeds (an uploaded file never changes, U12), downloads on the public page, AI of any kind.

## 2. What the user sees

- **Publish** button on the own-data chart card, next to Download. Shown only when the feature flag is on and the
  reader is signed in (the card only exists for signed-in readers anyway).
- **Publish dialog:** optional source-line field (≤120 chars); language (NL/EN) and colour (light/dark/auto) like
  the CBS embed dialog; a plain disclosure: *anyone with the link can see this chart; hidden series (and notes or
  calculations tied to them) are left out; the page says the numbers come from your own file and were not checked
  by us.* On publish: the link and an `<iframe>` snippet, with copy buttons.
- **Already published:** the dialog shows the existing link, an **Update published version** button (replaces
  the snapshot, same link) and **Unpublish** (the link dies at once; publishing again later gives a NEW link).
- **Public page** `/embed/own/[publicId]`: the same own-data chart card in a read-only mode (no edit panels, no
  co-pilot, no history, no download, no form tabs, no publish button), the existing "own data / unverified"
  badge and disclaimer, the source line, and a small "Made with checkdecijfers" backlink like the CBS embed
  footer. `noindex, nofollow`. A missing, unpublished or deleted chart shows a neutral, digit-free "This chart
  is no longer available" message in both languages.

## 3. How it works

### 3.1 Storage — migration 036 `published_user_charts`

| column | notes |
| --- | --- |
| `id` | bigint identity PK |
| `public_id` | text, unique, not null — 16 random bytes, base64url (22 chars). Unguessable; not derived from any other id. No HMAC secret needed. |
| `user_id` | uuid not null — guarded FK to `auth.users` (migration 019 pattern) |
| `dataset_id` | bigint not null → `user_datasets(id)` |
| `dataset_turn_id` | bigint not null → `dataset_turns(id)` |
| `log` | jsonb not null — the frozen chart command log (same shape as `chart_edits.log`, size-capped by `CHART_EDITS_MAX_JSON`) |
| `source_line` | text null, `check (char_length(source_line) <= 120)` |
| `created_at`, `updated_at` | timestamptz |

Language and colour are URL parameters only (`?lang=`, `?theme=`), exactly as on the CBS embed — not stored.
Unique `(dataset_turn_id, user_id)` — one live publication per chart per author. **Unpublish and every redaction
path hard-delete the row** (it holds nothing any other table needs; the chart_edits precedent in
`redactTurnsForDatasets`). File-only until the owner-supervised `npm run db:migrate`; every reader of the table
is deploy-order-safe (absent table → "not available" / action returns `unavailable`), the `chart_edits`
precedent.

### 3.2 Publishing (server action, own small file like `embed-actions.ts`)

`publishOwnChart(turnId, log, sourceLine)`:
1. Flag `OWN_DATA_PUBLISH_ENABLED === '1'` else `disabled` (fails closed). Signed in, else `unauthenticated`.
2. Load the turn + dataset **as this user** (ownership by `user_id` parameter); turn must be `kind = 'chart'`,
   `chart_emitted`, not redacted; dataset `status = 'ready'`. Else `forbidden`.
3. Validate `log`: JSON size ≤ `CHART_EDITS_MAX_JSON`; replay it server-side (§3.4) and **refuse if any command
   is dropped** — what is stored is exactly what the author sees, never a silently different chart.
4. `sourceLine`: trimmed; empty → null; > 120 chars → `invalid`; control characters stripped.
5. Active publications for this user < 50 (else `limit`). Upsert on `(dataset_turn_id, user_id)`: a first publish
   inserts with a fresh `public_id`; an update keeps the `public_id` and replaces `log`/`source_line`.
6. Returns `{ ok: true, publicId }`.

`unpublishOwnChart(turnId)`: same auth/ownership; hard-deletes the row. `getOwnChartPublication(turnId)`: lets the
dialog show the current state. The client flushes pending edits first by sending its own current serialized log
(`serializeHistory`), so the debounce on `chart_edits` saves can never publish a stale version.

### 3.3 The public route `web/app/embed/own/[publicId]/page.tsx`

Server component, `force-dynamic`, `runtime = 'nodejs'`, noindex. Already covered by the proxy's `/embed/`
public prefix, the `/embed/:path+` framing headers and the embed-route header signal (ADR 041 points 7, 8, 11) —
the plan must still add a route-level test that goes through the proxy allowlist (ADR 041's "the proxy fix"
lesson). Steps: flag check → shape-check `publicId` → load the row → load dataset + turn by the row's `user_id`
→ refuse (not-available page) unless dataset `ready` and turn not redacted → replay (§3.4) → **prune** (§3.5) →
render the read-only card with the pruned spec, the final view state and every server-derived piece
precomputed. No server action is ever callable from this page for an anonymous visitor.

### 3.4 Server-side replay (shared by publish and the public page)

A server-only module in `web/lib/` (it needs `replayLog`, which lives in `web/lib/` and `src/` may not import
`web/`), `web/lib/own-chart-publication.ts`, that takes `(dataset, turn, log)` and returns
`{ state, spec, overlays, dropped }` using the SAME building blocks the card uses through its
server actions: `replayLog` + `validateCommand` (web/lib/chart-history.ts — pure), `renderInstructionForDataset`
for every `setInstruction` in the log, `deriveChartOverlay` for each derived overlay still active in the final
state (after pruning, §3.5). Nothing new computes a number — U1/U5/U6 hold by
reuse, exactly as ADR 041 gets R1/R6/R11 by reusing `ChartView`.

### 3.5 Pruning — the privacy guarantee

Before anything is serialized to the browser, a pure `pruneForPublic` step:
- **Hidden series are blanked in place, not removed.** Series keys are positional (`s0`, `s1`, … —
  `chart-commands.ts` `seriesKeys`) and colours are by index, so removing a series would re-key and re-colour the
  rest. A hidden series keeps its slot but loses its label (→ `''`) and every point's `value`, `formattedValue`,
  `sourceText`, `reason` and `incomplete` (→ null/empty). `rowRef`, `xKey` and `xLabel` stay (the x axis is shared
  with visible series).
- **Anything anchored to a blanked point is dropped:** notes whose `resultId` is a blanked point's rowRef,
  derived overlays whose `resultIds` include one (a difference with a hidden value would reveal it), and a
  `headlineOverrideResultId` pointing at one (→ null).
- **Verified-whole is not shown publicly in v1.** `wholeReferenceRowRef` → null, so a pie/stacked chart shows the
  honest default "not checked" note. Computing the verdict needs either a server call an anonymous visitor could
  aim at hidden cells or a server-side copy of the card's render-time part selection; neither is worth it before
  there is demand (cheapest mechanism first). Revisit trigger in ADR 057.
- **No period pruning is needed:** the own-data card has no period zoom (`periodRange` is never read by
  `user-chart.tsx`); the public state's `periodRange` is set to null.
- The public payload never contains `cells`, `profile`, the file name (`provenance.displayName`),
  `sourceUrlHost`, `contentSha256` or the command log (commands like `addNote` carry series labels). The client
  receives the pruned spec and the final state only; `provenance` is replaced by `capturedAt` + the source line.

A test asserts the serialized public props contain none of a hidden series' label, values or source texts.

### 3.6 Rendering — `UserChart` read-only mode

A `publicMode` prop on the existing card (mirroring `ChartView`'s `embedMode`): no edits hook (`editsKey =
null`), no history actions, no data panel, no co-pilot, no config panel, no download/CSV/publish, no form tabs,
no small-multiples toggle; initial state = the replayed final state; overlay and whole-verification data come
in as props instead of via server actions. The source line is a spec-level string bound like every other
visible string (U6: its digits are spec strings, never free-floating).

### 3.7 Deletion and retention

`redactTurnsForDatasets` (the one shared leg under `deleteOneDataset`, `deleteUserDatasets` and
`purgeExpiredDatasets`) also hard-deletes `published_user_charts` rows for those turns, in the same
transaction, deploy-order-safe when the table is absent. The public page checks dataset status on every request
(`force-dynamic`), so a deleted file's link dies on the very next load even before any row cleanup.

## 4. Invariants at stake

U1, U4 (badge + disclaimer always rendered; no CBS attribution/licence), U5, U6, U8/U12 (public page re-derives
from stored cells + stored log), R8-analog (the publication is reconstructable from its row + the dataset), GDPR
deletion/retention (#189), ADR 037 D11 (no own-data chart is ever rendered by `ChartView`). New: **P1** — the
public payload contains no hidden series, no out-of-range point, no file name and no unplotted column. P1 gets a
row in [05-data-rules.md](../../05-data-rules.md) and a test.

## 5. Rollout

Ships dark on `main` behind `OWN_DATA_PUBLISH_ENABLED`. Owner-supervised: apply migration 036
(`npm run db:migrate`), set `OWN_DATA_PUBLISH_ENABLED=1` in Vercel, redeploy, then a real publish → open the link
signed out → unpublish → link dead. Rollback: unset the flag + redeploy (rows stay, pages show not-available).

## 6. Revisit triggers

Abuse (spam text or phishing hosted on our domain via titles/notes/source line) → a report link + an owner
takedown script. Demand for a public gallery of user charts → its own design with moderation. B2 (mixing with
CBS) → ADR 037's own revisit trigger.
