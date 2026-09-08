# WP218 Phase 2 + 6 — Account Default + Usage Counter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user save the chart style they have set as their account default (read on every chart, per-chart tweaks still start fresh) and forget it again; add an anonymous usage counter for the style panel; both behind ONE additive migration that stays file-only until the owner's supervised apply.

**Architecture:** A new server-side store `src/chart/user-styles.ts` (one JSON row per user in `user_chart_styles`, plus the `chart_style_usage` counter table) with a GDPR retention leg injected into the existing purge job exactly like the trial leg. The web app reads the row server-side on the workspace page and hands it down through a small React context; `ChartView` composes `base = stock + account default` and passes it to the existing resolver; the panel gets an account row (save / forget). Every read and write is deploy-order safe: a missing table (migration not yet applied) reads as "no default" / "saving not possible", never an error page. The counter is a fire-and-forget server action behind an injectable sink so tests and server renders never touch it. Owner decisions C (account persistence, a supervised DB change with a retention leg) and F (a simple anonymous counter) on open-questions #218; #220.

**Tech Stack:** Postgres (Supabase prod, PGlite hermetic tests via `tests/helpers/pglite-db.ts`, which applies every `migrations/NNN_*.sql`), Next.js 16 server actions, React 19 context, Vitest.

## Global Constraints

- **Migration 028 is FILE-ONLY until the owner applies it** (`npm run db:migrate`, owner present — the migration 026/027 precedent). Nothing in the shipped code path may throw when the tables are absent: every store function detects the missing table (Postgres error code `42P01` / `to_regclass(...) is null` — reuse whichever pattern the trial-bookkeeping leg in `src/billing` uses for `trial_questions`) and degrades: reads → `null`, writes → `{ ok: false, reason: 'unavailable' }`, counter → silent no-op, purge leg → `{ skipped: 'table-absent' }`.
- **Personal data rules (RUNBOOK, ADR 033's own rule):** `user_chart_styles` is user-keyed personal data from the first commit that creates it. It joins the single-enforcement-point retention machinery (`src/answer/audit/retention-job.ts`) in THIS plan: (a) self-service "Vergeet mijn standaard" deletes the row; (b) the account-level `deleteMyQuestionHistory` (the "Verwijder mijn geschiedenis" button) also deletes it; (c) the monthly purge deletes rows whose `updated_at` is older than two years (`twoYearsBefore(now)` from `src/answer/audit/retention.ts`). **Assumption (mirror in open-questions #218):** two years since the last save is the retention window for a preference row — a user can simply save again.
- **No GRANT/RLS statements in the migration** — migration 003's `rls_auto_enable` locks every new table automatically (same note as migrations 011/012/017/018/019/026); the guarded `auth.users` FK uses migration 026's exact `do $$ … $$` pattern, no cascade. Plain Postgres only (runs identically on Supabase and PGlite).
- **Allow-list on every boundary:** the server action sanitizes the incoming style with `sanitizeOverrides` (web) BEFORE saving and caps the JSON at 4 000 characters; `ChartView` sanitizes again on READ (a stored value may predate a schema change). The store in `src/` stores/returns `Record<string, unknown>` and enforces only the size cap — `src/` never imports from `web/` (the `web/backend → ../src` symlink is one-way).
- **Counter privacy:** `chart_style_usage(event, day, count)` holds no user id, no IP, nothing per person; `event` is a closed enum validated in the server action (`panel_open`, `option_changed`, `default_saved`, `default_forgotten`); anonymous callers (homepage, trial) count too — the panel appears everywhere (owner G).
- **Per-chart tweaks still start fresh (owner E):** the account default is the BASE the resolver receives; `state.presentation` (per chart) sits on top and is still cleared on a spec swap; `Standaard` resets per-chart overrides back to the account default.
- All new panel copy digit-free, in `PANEL_COPY` nl + en. Tokens not colours. Tests co-located in `web/`, under `tests/` for `src/`. Web suite green after every task; backend suites `npm run test:chart` and `npm run test:audit` green after the tasks that touch them (run them solo — never alongside a subagent, never the whole root `npm test`, which is OOM-killed on this machine; the full root suite runs once at the end of the branch).
- Commits on branch `wp218-chart-styling`, conventional prefixes, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; commit only, never push.

---

## File map

| File | Responsibility |
|---|---|
| `migrations/028_user_chart_styles.sql` (new) | `user_chart_styles` + `chart_style_usage`, guarded FK, indexes, header comment (file-only note). |
| `src/chart/user-styles.ts` (new) + `tests/chart/user-styles.test.ts` | Store: `getUserChartStyle`, `saveUserChartStyle`, `deleteUserChartStyle`, `recordChartStyleEvent`, retention `chartStyleRetentionCutoff`/`countPurgeableChartStyles`/`purgeExpiredChartStyles`, `USER_CHART_STYLE_MAX_JSON = 4000`, `CHART_STYLE_EVENTS`. Missing-table detection. |
| `src/chart/index.ts` (modify) | Re-export the store's public names (check that a barrel exists; if not, import from the file directly). |
| `src/answer/audit/retention-job.ts` (modify) + `tests/audit/retention-job.test.ts` | A second injected leg `chartStyles` (same `{ cutoff, count, purge }` shape as `trial`), summary + `describeRetentionPurge` line + `RetentionPurgePartialError.leg` union. |
| `web/app/api/gdpr-purge-cron/route.ts`, `scripts/gdpr-purge.ts` (modify) | Inject `CHART_STYLES_LEG` next to `TRIAL_LEG` (both composition roots, same functions). |
| `web/app/actions.ts` (modify) + `web/app/actions-chart-style.test.ts` (new) | `saveMyChartStyle(raw)`, `forgetMyChartStyle()`; `deleteMyQuestionHistory` also deletes the style row (fail-soft on absent table). |
| `web/app/usage-actions.ts` (new) + test | `'use server'` `countChartStyleEvent(event)` — enum-validated, fail-soft, no auth required. |
| `web/lib/chart-usage-client.ts` (new) + test | `trackChartStyleEvent(event)` with an injectable sink (`setChartUsageSink`); default no-op. |
| `web/components/chart-usage-tracker.tsx` (new) | Client component mounted once in `app/layout.tsx` that registers the real sink (the server action). |
| `web/lib/chart-style-context.tsx` (new) + test | `ChartStyleProvider({ initial, children })`, `useChartStyle()` → `{ accountStyle, setAccountStyle, signedIn }` (no provider → `{ accountStyle: null, signedIn: false }`). |
| `web/app/page.tsx`, `web/components/workspace.tsx` (modify) | Read the row server-side in the WORKSPACE branch, pass `chartStyle` → `Workspace` wraps its tree in `ChartStyleProvider`. |
| `web/components/chart.tsx` (modify) | `base = withAccountDefault(accountStyle)`; counter hooks (`onOpen` → `panel_open`, each `setPresentation` → `option_changed`); account callbacks to the panel. |
| `web/lib/chart-presentation.ts` (modify) | `withAccountDefault(account: unknown): ChartPresentation` = `{ ...STOCK, ...sanitizeOverrides(account), seriesColors merged }`. |
| `web/components/chart-config-panel.tsx` (modify) + test | Account row: `Bewaar als mijn standaard` / `Vergeet mijn standaard` / status line; hint `Mijn standaard is actief.` |
| Docs (last task) | RUNBOOK supervised step for 028; ADR 039 addendum; 05-data-rules GDPR scope; 08-build-plan phases 2+6; open-questions #218 (assumption) + #220; `docs/RUNBOOK.md` secrets table unchanged (no new secret). |

---

### Task 1: Migration 028 + the store (`src/chart/user-styles.ts`)

**Files:** create `migrations/028_user_chart_styles.sql`, `src/chart/user-styles.ts`, `tests/chart/user-styles.test.ts`.

**Interfaces produced:**

```ts
export const USER_CHART_STYLE_MAX_JSON = 4000;
export const CHART_STYLE_EVENTS = ['panel_open', 'option_changed', 'default_saved', 'default_forgotten'] as const;
export type ChartStyleEvent = (typeof CHART_STYLE_EVENTS)[number];
export interface UserChartStyleRow { style: Record<string, unknown>; brand: Record<string, unknown> | null; updatedAt: string }
export async function getUserChartStyle(db: Db, userId: string): Promise<UserChartStyleRow | null>;       // null when no row OR table absent
export async function saveUserChartStyle(db: Db, userId: string, style: Record<string, unknown>): Promise<{ ok: true } | { ok: false; reason: 'unavailable' | 'too-large' }>; // upsert; brand column untouched
export async function deleteUserChartStyle(db: Db, userId: string): Promise<boolean>;                    // true if a row went; false when none/absent table
export async function recordChartStyleEvent(db: Db, event: ChartStyleEvent, day: Date): Promise<void>;  // upsert count+1; silent no-op when absent
export function chartStyleRetentionCutoff(now: Date): Date;                                              // twoYearsBefore(now)
export async function countPurgeableChartStyles(db: Db, cutoff: Date): Promise<{ userId: string }[]>;    // [] when absent — SAME shape as purge (the leg's count/purge pair)
export async function purgeExpiredChartStyles(db: Db, cutoff: Date): Promise<{ userId: string }[]>;
export async function chartStylesTablePresent(db: Db): Promise<boolean>;                                 // to_regclass
```

Migration content:

```sql
-- 028 — user_chart_styles + chart_style_usage (WP218 phases 2 + 6, ADR 039).
-- ⚠ FILE-ONLY until the owner-supervised apply (migrations 016/017/019/026
-- precedent). Deploy-order-safe: every reader/writer in src/chart/user-styles.ts
-- treats an absent table as "no default" / "not possible right now".
-- user_chart_styles is PERSONAL DATA from this commit on (ADR 033's rule): it
-- joins the retention job in the same change (retention-job.ts chartStyles leg,
-- self-service delete, account-level wipe). No GRANT/RLS here: migration 003's
-- rls_auto_enable locks every later table (same note as 011/012/017/018/019/026).
-- Plain Postgres only — identical on Supabase and PGlite (ADR 009).
create table user_chart_styles (
  user_id uuid primary key,
  style jsonb not null,
  brand jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users') then
    execute 'alter table user_chart_styles add constraint user_chart_styles_user_id_fkey
             foreign key (user_id) references auth.users(id)';
  end if;
end $$;
create index user_chart_styles_by_updated on user_chart_styles (updated_at);

-- Anonymous usage counter (open-questions #220): event × day × count. No user
-- id, no IP, nothing per person — a tally, not a log.
create table chart_style_usage (
  event text not null check (event ~ '^[a-z_]{1,40}$'),
  day date not null,
  count integer not null default 0 check (count >= 0),
  primary key (event, day)
);
```

Tests (hermetic `createTestDb()` from `tests/helpers/pglite-db.ts`, `randomUUID()` user ids): get → null; save → get returns the style with `updatedAt`; save again overwrites and bumps `updated_at`; `too-large` when the JSON exceeds the cap (nothing written); delete → true then false; `recordChartStyleEvent` twice same day → count 2, different day → separate row; `purgeExpiredChartStyles(cutoff)` deletes only rows older than the cutoff (set `updated_at` directly with an UPDATE in the test) and `countPurgeableChartStyles` reports the same rows beforehand; absent table: run `drop table user_chart_styles` in a fresh test DB, then get → null, save → `unavailable`, delete → false, count/purge → `[]`, `chartStylesTablePresent` → false, `recordChartStyleEvent` after `drop table chart_style_usage` → resolves without throwing.

Steps: write tests (RED: module missing) → migration + module → `npm run test:chart` green → commit `feat(chart): user chart styles store + usage counter table (migration 028, file-only) (WP218 phases 2+6)`.

---

### Task 2: Retention leg + composition roots + account-level wipe

**Files:** modify `src/answer/audit/retention-job.ts`, `tests/audit/retention-job.test.ts`, `web/app/api/gdpr-purge-cron/route.ts`, `scripts/gdpr-purge.ts`, `web/app/actions.ts` (+ its test file for `deleteMyQuestionHistory` — find it with `grep -rn deleteMyQuestionHistory web/app/*.test.ts`).

**Design:** generalise the injected-leg type: `export interface InjectedRetentionLeg { cutoff(now: Date): Date; count(db: Db, cutoff: Date): Promise<unknown[]>; purge(db: Db, cutoff: Date): Promise<unknown[]> }` (keep `TrialRetentionLeg` as an alias so nothing else changes), add `chartStyles: InjectedRetentionLeg | null` to `RetentionPurgeOptions`, a `chartStyles` entry in `RetentionPurgeSummary` with the same `{ cutoff, rows } | { skipped: 'not-configured' | 'table-absent' }` shape as `trial`, run it AFTER the error_log leg with the same partial-error discipline (widen `RetentionPurgePartialError.leg` to `'trial' | 'errorLog' | 'chartStyles'` and its message text), and one more `describeRetentionPurge` line (`chart-style cutoff …: N user_chart_styles row(s) …` / `note: chart-style leg not configured` / `note: user_chart_styles absent (migration 028 not applied) — chart-style leg skipped.`). Both composition roots inject `CHART_STYLES_LEG = { cutoff: chartStyleRetentionCutoff, count: countPurgeableChartStyles, purge: purgeExpiredChartStyles }` from `../../../backend/chart/user-styles.ts` (route) / `../src/chart/user-styles.ts` (script). "table-absent" detection: the leg's `count`/`purge` return `[]` when absent — so the job must ask `chartStylesTablePresent(db)`-style explicitly; give the leg an optional `present?(db): Promise<boolean>` used to produce `{ skipped: 'table-absent' }` (the trial leg has its own mechanism — read it and mirror it rather than invent a third).

`deleteMyQuestionHistory` in `web/app/actions.ts`: after `deleteUserQuestionHistory`, call `deleteUserChartStyle(getDb(), userId)` (fail-soft: it already returns false on an absent table; wrap in try/catch that logs via the existing `reportError` helper and continues — the history deletion must never be reported as failed because a preference row could not be removed).

Tests: `retention-job.test.ts` — a configured chartStyles leg counts in dry run and purges on apply, a `null` leg reports `not-configured`, an absent table reports `table-absent`, a throwing chartStyles leg after a committed audit leg raises `RetentionPurgePartialError` with `leg === 'chartStyles'`, `describeRetentionPurge` includes the new line. `actions` test — `deleteMyQuestionHistory` calls the style delete with the user id and still returns the count when the style delete throws.

Commit `feat(gdpr): chart-style retention leg in the purge job + account-level wipe (WP218 phase 2)`. Run `npm run test:audit` and `npm run test:chart` solo, and `cd web && npm test`.

---

### Task 3: Usage counter — server action, client sink, tracker, chart hooks

**Files:** create `web/app/usage-actions.ts`, `web/app/usage-actions.test.ts`, `web/lib/chart-usage-client.ts`, `web/lib/chart-usage-client.test.ts`, `web/components/chart-usage-tracker.tsx`; modify `web/app/layout.tsx`, `web/components/chart.tsx`, `web/components/chart.test.tsx`.

- `usage-actions.ts` (`'use server'`): `export async function countChartStyleEvent(raw: unknown): Promise<void>` — if `raw` is not in `CHART_STYLE_EVENTS` return; `try { await recordChartStyleEvent(getDb(), raw, new Date()) } catch (e) { reportError('countChartStyleEvent', e) }` (find the `reportError` helper used by other actions and reuse it). No auth check — anonymous callers count. Keep this file's import graph tiny (db + the store) so client bundles importing the action reference stay light.
- `chart-usage-client.ts`: `type Sink = (event: ChartStyleEvent) => void | Promise<void>`; `let sink: Sink | null = null`; `export function setChartUsageSink(next: Sink | null)`; `export function trackChartStyleEvent(event)` → `if (!sink) return; try { void Promise.resolve(sink(event)).catch(() => {}) } catch {}`. Tests: no sink → no throw; sink called with the event; a rejecting sink does not surface.
- `chart-usage-tracker.tsx` (`'use client'`): `useEffect(() => { setChartUsageSink((e) => countChartStyleEvent(e)); return () => setChartUsageSink(null); }, [])`, renders null. Mount `<ChartUsageTracker />` inside `ThemeProvider` in `app/layout.tsx`.
- `chart.tsx`: `onOpen={() => trackChartStyleEvent('panel_open')}`; in the panel's `onChange` handler also `trackChartStyleEvent('option_changed')`. Test (chart.test.tsx): register a spy sink with `setChartUsageSink` in the test, open the panel → `panel_open` once; click `Dik` → `option_changed` once; unregister in `afterEach`.

Commit `feat(chart): anonymous style-panel usage counter — server action, injectable client sink, layout tracker (WP218 phase 6)`.

---

### Task 4: Account default — context, page read, actions, resolver base, panel row

**Files:** create `web/lib/chart-style-context.tsx` + test, `web/app/actions-chart-style.test.ts`; modify `web/lib/chart-presentation.ts` (+ test), `web/app/actions.ts`, `web/app/page.tsx`, `web/components/workspace.tsx` (+ test), `web/components/chart.tsx` (+ test), `web/components/chart-config-panel.tsx` (+ test).

- `withAccountDefault(account: unknown): ChartPresentation` in chart-presentation.ts: `const clean = sanitizeOverrides(account); return { ...STOCK_PRESENTATION, ...clean, seriesColors: { ...(clean.seriesColors ?? {}) } }` — test: junk → STOCK; a valid partial → merged.
- Context: `ChartStyleProvider({ initial: unknown | null, children })` stores `accountStyle: PresentationOverrides | null` (sanitized once, `null` when nothing valid) with `setAccountStyle`; `useChartStyle()` without a provider → `{ accountStyle: null, setAccountStyle: () => {}, signedIn: false }`, with → `signedIn: true`.
- Actions: `saveMyChartStyle(raw: unknown): Promise<{ ok: true } | { ok: false; reason: 'unauthenticated' | 'unavailable' | 'too-large' | 'error' }>` — `currentUserId()`; `sanitizeOverrides(raw)`; `saveUserChartStyle(getDb(), userId, clean)`; catch → `reportError` + `{ ok: false, reason: 'error' }`; also `trackChartStyleEvent`? No — the CLIENT tracks `default_saved` after a successful save (keeps actions single-purpose). `forgetMyChartStyle(): Promise<{ ok: boolean }>` → `deleteUserChartStyle`. Tests mock `../lib/current-user.ts`, `../lib/db.ts` and the store module (the pattern in `web/app/actions-threads.test.ts`).
- `page.tsx` WORKSPACE branch: `getUserChartStyle(db, userId)` added to the `Promise.all` (wrap so a throw becomes `null`); pass `chartStyle={row?.style ?? null}` to `Workspace`; `Workspace` gets `chartStyle?: unknown` and wraps its returned tree in `<ChartStyleProvider initial={chartStyle ?? null}>`. `workspace.test.tsx`: renders with and without the prop.
- `chart.tsx`: `const { accountStyle, signedIn, setAccountStyle } = useChartStyle(); const base = withAccountDefault(accountStyle);` → `resolvePresentation(ctx, state.presentation, base)`. Panel gets `account={signedIn ? { hasDefault: accountStyle !== null, onSave: async () => { const r = await saveMyChartStyle(resolved.values); if (r.ok) { setAccountStyle(resolved.values); trackChartStyleEvent('default_saved'); } return r.ok ? 'saved' : r.reason === 'unavailable' ? 'unavailable' : 'error'; }, onForget: async () => { const r = await forgetMyChartStyle(); if (r.ok) { setAccountStyle(null); trackChartStyleEvent('default_forgotten'); } return r.ok ? 'forgotten' : 'error'; } } : undefined}`. Importing `../app/actions.ts` into chart.tsx pulls the backend graph into chart.test.tsx — instead put the two actions in `web/app/chart-style-actions.ts` (`'use server'`, tiny import graph like usage-actions) and mock that module in chart.test.tsx.
- Panel: `account?: { hasDefault: boolean; onSave(): Promise<'saved' | 'unavailable' | 'error'>; onForget(): Promise<'forgotten' | 'error'> }`. When present, a footer row inside the region: button `Bewaar als mijn standaard` (busy-disabled while pending), button `Vergeet mijn standaard` (only when `hasDefault`), a `role="status"` line with `Opgeslagen.` / `Vergeten.` / `Opslaan is op dit moment niet mogelijk.` / `Er ging iets mis. Probeer het later opnieuw.`; above the Grafiek controls, when `hasDefault` and `resolved.pristine`, the hint `Mijn standaard is actief.` (en: `Save as my default`, `Forget my default`, `Saved.`, `Forgotten.`, `Saving is not possible right now.`, `Something went wrong. Try again later.`, `My default is active.`). No account prop → no row (Ontdek/trial).
- chart.test.tsx: wrap in `ChartStyleProvider initial={{ lineWidth: 'thick' }}` → the line renders at 3 px with the panel pristine and showing `Dik` + the hint; clicking `Dun` then `Standaard` returns to 3 px (the account default, not stock); a spec swap keeps the account default (base) while clearing per-chart tweaks; without a provider → stock and no account row; save flow: mocked action resolves `{ ok: true }` → status `Opgeslagen.` and the sink receives `default_saved`.

Commit `feat(chart): account default for chart styling — save/forget, server read, resolver base (WP218 phase 2, owner C)`.

---

### Task 5: Docs

- `docs/RUNBOOK.md`: new section "Supervised live step — migration 028 user_chart_styles + chart_style_usage (⏳ NOT YET RUN)" in the WP202 section's style: steps (1) `npm run db:migrate` (additive; can ride the same invocation as 026/027 if those are still pending), (2) verify the guarded FK `user_chart_styles_user_id_fkey` + RLS/grants posture, (3) smoke: save a default in the panel → row present; forget → row gone; `npm run gdpr:purge` dry-run mentions the chart-style leg; (4) counter: `select * from chart_style_usage order by day desc limit 20;`. Rollback: nothing to unset — with the tables present the feature is live; dropping them returns every path to "no default".
- `docs/05-data-rules.md`: GDPR scope list gains `user_chart_styles` (self-service + account wipe + 2-year purge leg) and states `chart_style_usage` holds no personal data.
- `docs/decisions/039-chart-presentation-panel.md` addendum: phases 2 + 6 as built (the base/overrides composition, the leg, the sink).
- `docs/08-build-plan.md` § WP218: phases 2 and 6 ✅ built (file-only migration, owner step pending), commit list.
- `docs/open-questions.md`: #218 add the retention-window assumption; #220 built note.
- Commit `docs(chart): WP218 phases 2+6 recorded — RUNBOOK supervised step for migration 028, GDPR scope, ADR 039 addendum`.

## Self-review

Coverage: owner C (account save, DB, supervised, retention leg, self-service delete) ✔ T1/T2/T4; owner F/#220 counter ✔ T1/T3; E preserved ✔ T4 tests; deploy-order safety ✔ every task; no `web/` import from `src/` ✔; docs ✔ T5. Names consistent: `getUserChartStyle`, `saveUserChartStyle`, `deleteUserChartStyle`, `recordChartStyleEvent`, `chartStyleRetentionCutoff`, `countPurgeableChartStyles`, `purgeExpiredChartStyles`, `chartStylesTablePresent`, `withAccountDefault`, `useChartStyle`, `ChartStyleProvider`, `trackChartStyleEvent`, `setChartUsageSink`, `countChartStyleEvent`, `saveMyChartStyle`, `forgetMyChartStyle`.
