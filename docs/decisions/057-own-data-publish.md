# ADR 057 — Publishing an own-data chart: a saved, revocable, pruned snapshot

**Status:** accepted 2026-09-24 (session 127, owner present, decided in chat). Design:
[superpowers/specs/2026-09-24-own-data-publish-design.md](../superpowers/specs/2026-09-24-own-data-publish-design.md).
**BUILT (session 127, 2026-09-24), dark behind `OWN_DATA_PUBLISH_ENABLED` — see the as-built note below.
Owner steps (migration 036, the flag, a live check) are still pending; see
[RUNBOOK.md](../RUNBOOK.md)'s "Own-data publishing (ADR 057) — switching it on". Session 128
(2026-09-25) closed two of the original "known v1 differences" (the look now freezes at publish
time; `?lang=` now wins for the chart too) — migration 036 is STILL file-only, edited in place to add
the new `style` column (no owner-facing change to the rollout steps above).**

## Context

Own-data parity ([#318](../open-questions.md)) left one large gap: a CBS chart can be published as a public
link/embed (ADR [041](041-public-embed-pages.md)), a chart made from an uploaded file cannot. The owner decided
(2026-09-24) that users may publish own-data charts, opt-in per chart, and that own data and CBS data still never
share one chart (ADR [037](037-user-data-attachments.md) stands; B2 waits for evidence).

Own data differs from CBS data in the ways that matter here: it is personal (GDPR, #189), the author may have
hidden some of it on screen, the on-screen chart can differ from the first-made chart (data commands re-render
it, ADR [056](056-chart-copilot.md)), and file names can be revealing.

## Decision

1. **A saved publish record** (`published_user_charts`, migration 036) holds the frozen chart command log, the
   author's optional source line (≤120 chars) and a random 22-character `public_id`. One live publication per
   chart per author; updating keeps the link; unpublish hard-deletes the row (the link dies at once).
2. **What is published is exactly what the author sees.** The publish action replays the log server-side and
   refuses if any command would be dropped.
3. **Pruning before serialization (new invariant P1):** hidden series (blanked in place, with the notes and
   calculations tied to them), the file name, the source URL host, the content hash, the raw cells and the profile never reach a visitor's
   browser.
4. **Re-derived on every request** from the immutable stored cells (U12) through the same builders the card
   uses (`renderInstructionForDataset`, `deriveChartOverlay`) — no new code computes a
   number, so U1/U5/U6 hold by reuse.
5. **Rendered by the own-data card in a read-only `publicMode`**, never by `ChartView` (ADR 037 D11).
6. **Deletion:** the shared `redactTurnsForDatasets` leg hard-deletes publications in the same transaction, and
   the page also checks the dataset's status on every request. **Correction (session 128, 2026-09-25):** only
   FILE/thread deletion (`deleteOneDataset`) is wired in production and kills the link today. Account-level
   deletion and the 2-year dataset retention purge would go through the same leg, but `deleteUserDatasets` and
   `purgeExpiredDatasets` have no production caller yet — tracked as [#322](../open-questions.md) I-3, NOT yet
   built, and required before the flag is switched on.
   **Update (session 129, 2026-09-25): WIRED** — the monthly purge (cron + `scripts/gdpr-purge.ts`) now runs `purgeExpiredDatasets` as its uploaded-dataset leg (full redaction at the audit leg's two-year cutoff, file bytes at 90 days), and "delete my question history" now calls `deleteUserDatasets` (not fail-soft: a failure shows the reader a failed delete). [#322](../open-questions.md) I-3 closed.
7. Free, no AI, noindex, max 50 live publications per author, behind `OWN_DATA_PUBLISH_ENABLED` (fails closed).
   Route `/embed/own/[publicId]` reuses the `/embed/` proxy prefix, framing headers and layout signal.

## Alternatives considered

- **ADR 041's stateless signed token over the dataset turn id** (no migration — the cheapest mechanism, and the
  first one considered per the cheapest-first rule). Rejected by the owner: it can only publish the chart as
  first made (ignoring later data commands and hidden series, so it could expose data the author hid), and the
  only takedown is deleting the whole file. Fine for public CBS data; not for personal data.
- **Signed token carrying the view state in the URL.** Avoids a table, but URLs become huge and still can't be
  revoked per chart. Rejected.
- **Show the file name as the source.** Most transparent, but leaks names like `klanten_vertrouwelijk.xlsx`.
  Rejected in favour of an author-typed line with a neutral default.
- **A public gallery of user charts.** Needs moderation; out of scope until there is demand.

## Consequences

- A live-DDL step (migration 036) and an env flag flip, both owner-supervised.
- A second public surface that hosts author-written text (titles, notes, source line) on our domain — noindex,
  plain text only, no rendered links; abuse is a revisit trigger.
- The own-data card gains a read-only mode that later features (e.g. a stage/story mode) can reuse.

## As built (session 127, 2026-09-24)

Built via `superpowers:subagent-driven-development`, 6 tasks (migration + store, server-side replay + pruning,
server actions, read-only card mode, the public route, the publish dialog + flag plumbing) plus a final
whole-branch review and two fix waves, all on branch `own-data-publish` (worktree
`/Users/amity/Documents/cdc-own-data-publish`), base `598d0f10`:

```
550d817a feat: migration 036 + publications store + retention leg
4be0cfc0 feat: server-side replay + P1 pruning
61a5cbd9 fix: fix round 1 for Task 2 — C1/C2/I3/M6
4ebebb38 fix: fix round 2 for Task 2 — C1, by label not position
60913593 feat: publish/unpublish server actions
2fb2b0f5 fix: move normalizeSourceLine out of the 'use server' file
1eeb9736 feat: read-only publicView mode on the own-data card
84582e8c fix: fix round 1 for Task 4 — I1/R7/R8
a194e101 feat: public route /embed/own/[publicId]
45b75bfd feat: publish dialog + flag plumbing
3b7d9c21 fix: final-review privacy/fidelity fixes A1-A7
4606c5d2 test: end-to-end P1 test with the real card (final review D)
99eceb7b fix: final-review robustness/copy fixes B2-B5, C2
302c38f3 fix: re-review follow-ups m1-m3
```

**Files:** migration `migrations/036_published_user_charts.sql`; store `src/attachments/publications.ts`;
server-side replay + pruning `web/lib/own-chart-publication.ts`; the sealed/verified publish log
`web/lib/own-chart-publish-log.ts`; the source-line normalizer (pulled out of the server-action file so a
`'use server'` file never exports a plain sync function) `web/lib/publication-source-line.ts`; server actions
`web/app/own-chart-publish-actions.ts`; the public route `web/app/embed/own/[publicId]/page.tsx`; the publish
dialog `web/components/own-chart-publish-dialog.tsx`; the card's read-only mode and public-mode form-fallback
logic, in the existing `web/components/user-chart.tsx`; i18n strings in `web/lib/i18n/messages.ts`.

**Measured web test suite (final commit `302c38f3`):** 158 test files, 2,951 tests, all passing, one
foreground `npx vitest run` from `web/`. `npm run web:typecheck` and `npm run typecheck` both clean. The
backend suite count is measured at merge time — see [STATUS.md](../STATUS.md), not restated here to avoid a
stale number.

**A privacy-critical review chain, not a straight build.** The final whole-branch review (base `598d0f10`,
tip `45b75bfd`) found one Critical and two Important gaps a more surface-level pass would have missed, because
each one only shows up when the pruning is checked against the REAL pipeline rather than against hand-built
fixtures: a hidden series' own category name could still leak through a blanked slot's kept `xKey`/`xLabel`
(closed by ruling R11 — see the spec's §3.5 as-built note); the public page still rendered a chart when the
stored log no longer fully replayed against today's code (closed by ruling R12, fail closed); and the 200-entry
undo-history cap could silently trim what got published, and the unsealed transient part of an edit was never
sent at all (closed together by rulings R13/R14, a client-side replay-and-compare check before the server is
ever called — see the spec's §3.2 as-built note). The fix wave that closed these also introduced two new
fallback-to-table gaps in the pie and heatmap forms (a hidden slice at its own category, and a heatmap with only
one of two series visible), caught by a re-review and closed in one small follow-up (ruling R17, commit
`302c38f3`).

**Known v1 differences from "an exact frozen snapshot," each a deliberate, documented trade — not bugs:**
- **Session 128 (2026-09-25) update — both bullets below are RESOLVED, not open differences any more.**
  Two orchestrator rulings closed them in the same session: (1) **the look is now frozen at publish time.** A
  nullable `style` column (migration 036) holds the author's account chart style AS IT WAS when they clicked
  Publish (or last clicked "Update published version") — resolved and re-validated server-side by
  `publishOwnChart` (`resolveAuthorStyleForPublish`, own-chart-publish-actions.ts, reusing the exact allow-list
  `saveMyChartStyle` validates against, moved into the shared `web/lib/chart-style-sanitize.ts` for this reuse),
  never read from the client. The public page (`web/app/embed/own/[publicId]/page.tsx`) no longer calls
  `getUserChartStyle` AT ALL — it reads `row.style` straight off the row it already loaded. An author who
  changes their account default no longer sees it silently ripple into charts they already published; a style
  load failure at publish time stores `null` (the same fail-soft "no default look" posture the page used to
  apply at request time, now applied once, at write time, and logged the same way). (2) **`?lang=` now wins for
  the chart too.** The CBS-tier embed (`web/app/embed/[token]/page.tsx`) turned out to have no equivalent
  precedence to mirror — its `ChartSpec` carries no language field at all (see that file's own `lang` comment:
  every string `buildChartSpec` produces is unconditionally Dutch), so there was nothing there to copy. Instead,
  own-data's own card (`UserChartView`'s `chartLang`, user-chart.tsx) now takes an explicit `explicitLang: Lang |
  null` on `UserChartPublicView` — the page's own validated `?lang=`, or null when absent/invalid — and applies
  it BEFORE the frozen style's `language`: `explicitLang ?? pres.language ?? 'nl'` in public mode, the exact
  reverse of the `pres.language ?? appLang` order that let an account style silently outrank an explicit
  `?lang=` before this session. Authenticated/edit mode is unchanged (`pres.language ?? appLang`, `appLang` from
  the ambient `useLang()`). See the spec's own §3.1 table and RUNBOOK's "Own-data publishing" section for the
  as-built column and behaviour.
- **The small-multiples toggle is not saved,** so a public page always shows one chart, never the small-multiples
  grid, even if the author had it turned on while editing (same as the CBS-tier embed: it is view-only local
  state, not a stored chart command).
- **Verified-whole is not shown publicly in v1** (§3.5): a published pie/stacked/100%-stacked chart always shows
  the honest "not checked" note, never the reader-designated-total verdict the author may see on their own
  screen.
- **The code-drift guard (`firstRenderMatchesEnvelope`) covers only the chart AS FIRST MADE**, not every later
  data command replayed on top of it. A data command added after the first render is validated against
  TODAY'S code when the log is replayed (and the whole page fails closed if any command is dropped, ruling R12),
  but is not independently re-checked for the kind of series-identity drift the first-render guard catches.
- **One extra deterministic render per public page view.** The drift guard re-renders the turn's first
  instruction purely to compare series labels against the stored envelope; this doubles the render work for the
  first chart on every visitor request. Not measured to matter at today's traffic; a revisit trigger if it ever
  does.

### Security-review fix wave (session 128, 2026-09-25)

An independent adversarial security + privacy review
([superpowers/specs/2026-09-25-own-data-publish-security-review.md](../superpowers/specs/2026-09-25-own-data-publish-security-review.md),
[#322](../open-questions.md)) proved two P1 leaks in the pruning above by executed probes, plus unbounded
anonymous work and three smaller gaps. Fixed in `web/lib/own-chart-publication.ts` (plus the publish action, the
card and one split in `src/attachments/derive-overlay.ts`); the feature was dark throughout, so nothing was ever
exposed:
- **I-1 — internal row references removed from the payload.** A blanked point kept its `rowRef`, and an
  aggregate rowRef lists its member rows (`agg:count:r1:c0+r2:c0+r3:c0`), so a hidden count was readable from the
  RSC payload — and a visible aggregate point revealed its group size n (a mean over n = 1 is one person's value).
  Every public point now carries an opaque id (`p0`, `p1`, …) and every reference (note `resultId` and note `id`,
  overlay `resultIds`, the headline override, the resolved overlay's own handle) is remapped through the same map.
  The card only uses a rowRef as an identity key, so nothing it draws changes. `sourceText` is blanked on every
  public point (unused by the card; on a derived point it is the unplotted operand's raw text).
- **I-2 — a hidden slot carries no information.** It is one blank point per visible category, in visible order,
  instead of the hidden series' own points in their own (with sort-by-value: ranked) order.
- **M-1 — note labels** are rebuilt from the final public spec, so a label from an earlier chart (a customer name
  before a `setInstruction`) never reaches the payload.
- **I-4 a/b — bounded work.** The whole log goes through the capped command schema (max 200) at publish (the
  action now also stores the PARSED log) and on every read — the old entry-by-entry parse bypassed the cap (a
  crafted 64 KB log of 377 overlay commands was accepted). The per-entry tolerance was dropped: a malformed entry
  now refuses the log (`invalid`/not-available) instead of counting as "dropped" — equally fail-closed, and a real
  card never writes one. More than 20 derived overlays (`PUBLIC_OVERLAY_MAX`) refuses the chart the same way,
  and every overlay is resolved from ONE `allResolvedPoints` map per request (`overlayFromResolvedPoints`, the
  unchanged body `deriveChartOverlay` now delegates to — no new arithmetic, principle (a)).
- **M-3 — no third-party font on the public page.** Public mode ignores the frozen style's (and the log's)
  `fontFamily` and uses the default font stack, so an embed never makes an anonymous visitor's browser contact
  Google Fonts (the 2022 LG München pattern). Self-hosting the curated fonts would bring the choice back; not
  built (cheapest mechanism first).

**Still open (#322):** ~~I-3~~ (wired session 129 — see decision 6's update) and M-2 (the 50-publication cap is a count-then-insert race, accepted as #320). Not built from I-4: storing the
pruned payload at publish time (the review's (c)) and a firewall rate limit on `/embed/own/*` (d); a crafted log
of up to 200 distinct `setInstruction` commands still costs one render each per view, bounded by the cap.

## Revisit triggers

Demand for the "parts add up to the total" verdict on public pages (v1 shows the honest "not checked" note) →
a publication-scoped check restricted to published points. 
Abuse reports or evidence of spam/phishing via published text → report link + takedown script. Demand for a user
gallery → its own design. Evidence users want own data next to CBS data → ADR 037's B2 revisit.
