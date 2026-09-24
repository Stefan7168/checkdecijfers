# Own-data publish (ADR 057) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a signed-in user can publish a chart made from their own uploaded file as a public, read-only,
revocable page at `/embed/own/[publicId]`, showing exactly what they see minus hidden series, never the file name.

**Architecture:** a new table `published_user_charts` (migration 036) stores the frozen chart command log + an
optional source line under a random public id. The public page re-derives the chart on every request from the
immutable stored cells by replaying the log through the SAME pure building blocks the card uses
(`replayLog`, `renderInstructionForDataset`, `deriveChartOverlay`), prunes it (`pruneForPublic`), and renders
the existing own-data card (`UserChartView`) in a new read-only `publicView` mode. Everything ships dark behind
`OWN_DATA_PUBLISH_ENABLED`.

**Tech Stack:** Next.js 16 App Router (server components + server actions), React 19, TypeScript, Postgres
(PGlite in tests, ADR 009), vitest + jsdom + Testing Library.

**Spec:** [docs/superpowers/specs/2026-09-24-own-data-publish-design.md](../specs/2026-09-24-own-data-publish-design.md)
(read it first; §3.5 pruning is the privacy core). Decision: [ADR 057](../../decisions/057-own-data-publish.md).

## Global Constraints

- Invariants at stake (docs/05-data-rules.md): U1, U4 (badge + disclaimer always rendered; no CBS
  attribution/licence), U5, U6 (every visible digit is a spec string — the source line counts as a spec string),
  U8/U12, ADR 037 D11 (an own-data chart is NEVER rendered by `ChartView`), GDPR deletion/retention (#189), and the
  new **P1**: the public payload contains no hidden series label/value/source text, no file name
  (`provenance.displayName`), no `sourceUrlHost`, no `contentSha256`, no `cells`, no `profile`, no command log.
- No AI call anywhere. No new number is computed by new code — only existing builders.
- `src/` must never import from `web/`. `web/lib/chart-history.ts` / `web/lib/chart-commands.ts` are pure and
  server-importable (no `'use client'`).
- Migration file only: `migrations/036_published_user_charts.sql`. Never apply it to the live DB (owner step).
  Every reader of the table is deploy-order-safe when the table is absent (the `chart_edits` precedent:
  probe with `to_regclass`, never catch an error inside a transaction).
- Feature flag: `process.env.OWN_DATA_PUBLISH_ENABLED === '1'`, fails closed. Never put it in a local `.env`.
- Limits: source line ≤ 120 characters (after trim); ≤ 50 publications per user; log JSON ≤ `CHART_EDITS_MAX_JSON`
  (65 536, `src/chart/edits-store.ts`).
- Public id: 16 random bytes, base64url → exactly 22 chars matching `/^[A-Za-z0-9_-]{22}$/`.
- UI strings: English convention, but every string goes through `web/lib/i18n/messages.ts` with BOTH `nl` and `en`
  entries (test `web/lib/i18n/messages.test.ts` enforces key parity and digit parity — a digit in the nl text must
  appear in the en text too).
- One vitest process at a time on this machine: before running tests, wait until `pgrep -f "[n]ode.*vitest"`
  prints nothing. Run tests in the FOREGROUND, never backgrounded.
- Do NOT push, open a PR, merge, apply migrations, set env vars or spend on LLM calls. Commit on the task branch only.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Responsibility | Task |
| --- | --- | --- |
| `migrations/036_published_user_charts.sql` | the table | 1 |
| `src/attachments/publications.ts` | store: ids, CRUD, count, retention delete | 1 |
| `src/attachments/retention.ts` (modify) | call `deletePublicationsForTurns` in `redactTurnsForDatasets` | 1 |
| `tests/attachments/publications.test.ts` | store + retention tests | 1 |
| `web/lib/user-chart-command-spec.ts` | `toCommandSpec` + `instructionKey`, moved out of `user-chart.tsx` | 2 |
| `web/lib/own-chart-publication.ts` | `buildPublishedChart` (replay) + `pruneForPublic` + public types | 2 |
| `web/lib/own-chart-publication.test.ts` | replay + P1 pruning tests | 2 |
| `web/app/own-chart-publish-actions.ts` | `publishOwnChart`, `unpublishOwnChart`, `getOwnChartPublication` | 3 |
| `web/app/own-chart-publish-actions.test.ts` | action tests | 3 |
| `web/components/user-chart.tsx` (modify) | `publicView` read-only mode | 4 |
| `web/components/user-chart.test.tsx` (modify) | public-mode tests | 4 |
| `web/app/embed/own/[publicId]/page.tsx` | the public route | 5 |
| `web/app/embed/own/[publicId]/page.test.tsx` | route tests | 5 |
| `web/proxy.test.ts` (modify) | `/embed/own/…` is public + gets embed headers | 5 |
| `web/components/own-chart-publish-dialog.tsx` | Publish button + dialog | 6 |
| `web/components/own-chart-publish-dialog.test.tsx` | dialog tests | 6 |
| flag plumbing (modify): `web/app/workspace/page.tsx`, `web/components/workspace.tsx`, the component chain down to `web/components/dataset-chat.tsx` and `web/components/visual-dock.tsx`, `UserChartEditContext` | show the button only when on | 6 |
| `web/lib/i18n/messages.ts` (modify) | `ownChart.publish.*`, `ownChart.public.*` keys | 4, 5, 6 |
| docs (modify) | 05-data-rules P1, ADR 057 as-built, 04-architecture row, RUNBOOK, STATUS, 08-build-plan, open-questions #318 | 7 |

---

### Task 1: Migration 036 + publications store + retention leg

**Files:**
- Create: `migrations/036_published_user_charts.sql`, `src/attachments/publications.ts`, `tests/attachments/publications.test.ts`
- Modify: `src/attachments/retention.ts` (inside `redactTurnsForDatasets`, next to the `deleteChartEditsForTurns` call)

**Interfaces — Produces:**
```ts
export const PUBLIC_ID_PATTERN: RegExp;                       // /^[A-Za-z0-9_-]{22}$/
export const MAX_PUBLICATIONS_PER_USER = 50;
export const PUBLICATION_SOURCE_LINE_MAX = 120;
export interface PublicationRow {
  id: number; publicId: string; userId: string; datasetId: number; datasetTurnId: number;
  log: unknown[]; sourceLine: string | null; createdAt: string; updatedAt: string;
}
export function newPublicId(): string;
export function isPublicIdShape(s: unknown): s is string;
export async function publicationsTablePresent(db: Db): Promise<boolean>;
export async function upsertPublication(db: Db, input: {
  userId: string; datasetId: number; datasetTurnId: number; log: unknown[]; sourceLine: string | null;
}): Promise<{ publicId: string } | null>;           // null when the table is absent
export async function getPublicationByPublicId(db: Db, publicId: string): Promise<PublicationRow | null>;
export async function getPublicationForTurn(db: Db, userId: string, turnId: number): Promise<PublicationRow | null>;
export async function deletePublicationForTurn(db: Db, userId: string, turnId: number): Promise<boolean>;
export async function countPublications(db: Db, userId: string): Promise<number>;
export async function deletePublicationsForTurns(db: Db, turnIds: number[]): Promise<number>;
```
Every function returns the "absent" value (`null` / `false` / `0`) when the table is absent — probe first with
`publicationsTablePresent`, never catch a SQL error (a caught error inside `withTransaction` leaves it aborted).

- [ ] **Step 1: Write the migration** `migrations/036_published_user_charts.sql`

```sql
-- 036 — published_user_charts: a reader's own-data chart made public (ADR 057,
-- session 127). One row = one live publication of one dataset-turn chart by its
-- author. ⚠ FILE-ONLY until the owner-supervised `npm run db:migrate`; every
-- reader (src/attachments/publications.ts) probes for the table first, so the
-- code is deploy-order-safe. Unpublish and every redaction path HARD-DELETE the
-- row (it holds author text — the log's titles/notes and the source line — and
-- nothing any other table needs). Plain Postgres only (ADR 009).
create table published_user_charts (
  id bigint generated always as identity primary key,
  public_id text not null unique check (public_id ~ '^[A-Za-z0-9_-]{22}$'),
  user_id uuid not null,
  dataset_id bigint not null references user_datasets(id),
  dataset_turn_id bigint not null references dataset_turns(id),
  log jsonb not null,
  source_line text check (source_line is null or char_length(source_line) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index published_user_charts_turn_user on published_user_charts (dataset_turn_id, user_id);
create index published_user_charts_by_user on published_user_charts (user_id);

-- Guarded FK to auth.users — migration 026's exact pattern (itself 019's/005's).
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users') then
    execute 'alter table published_user_charts add constraint published_user_charts_user_id_fkey
             foreign key (user_id) references auth.users(id)';
  end if;
end $$;
```

- [ ] **Step 2: Write the failing tests** `tests/attachments/publications.test.ts`. Reuse the seeding pattern from
`tests/attachments/retention.test.ts` (copy its `MINIMAL_PROFILE`, `seedDataset`, `seedThread`, `seedTurn` helpers
verbatim — read that file first). Tests:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  countPublications, deletePublicationForTurn, deletePublicationsForTurns, getPublicationByPublicId,
  getPublicationForTurn, isPublicIdShape, newPublicId, publicationsTablePresent, upsertPublication,
} from '../../src/attachments/publications.ts';
import { deleteOneDataset, deleteUserDatasets, purgeExpiredDatasets } from '../../src/attachments/retention.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { resetTestDb } from '../helpers/reset-db.ts';
// + the copied seed helpers

describe('public ids', () => {
  it('are 22 base64url chars and unique', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newPublicId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(isPublicIdShape(id)).toBe(true);
  });
  it('rejects every other shape', () => {
    for (const bad of ['', 'abc', 'a'.repeat(21), 'a'.repeat(23), 'a'.repeat(21) + '/', 42, null, undefined]) {
      expect(isPublicIdShape(bad)).toBe(false);
    }
  });
});

describe('publications store', () => {
  it('insert then update keeps the same public id and replaces log + source line', async () => { /* seed user, dataset, thread, turn;
    const a = await upsertPublication(db, { userId, datasetId, datasetTurnId: turnId, log: [], sourceLine: 'Bron A' });
    const b = await upsertPublication(db, { userId, datasetId, datasetTurnId: turnId, log: [{ kind: 'setTitle', title: 'X' }], sourceLine: null });
    expect(b!.publicId).toBe(a!.publicId);
    const row = await getPublicationByPublicId(db, a!.publicId);
    expect(row!.log).toEqual([{ kind: 'setTitle', title: 'X' }]); expect(row!.sourceLine).toBeNull(); */ });
  it('getPublicationForTurn is scoped by user', async () => { /* another user's id → null */ });
  it('deletePublicationForTurn removes the row and is user-scoped', async () => { /* other user → false, row still there; owner → true, then getPublicationByPublicId → null */ });
  it('countPublications counts only this user', async () => { /* two users */ });
  it('the DB rejects a source line over 120 chars', async () => {
    await expect(upsertPublication(db, { ...base, sourceLine: 'x'.repeat(121) })).rejects.toThrow();
  });
});

describe('retention kills publications (GDPR)', () => {
  it('deleteOneDataset hard-deletes the dataset\'s publications', async () => { /* publish, deleteOneDataset, getPublicationByPublicId → null */ });
  it('deleteUserDatasets hard-deletes every publication of the user', async () => { /* two datasets */ });
  it('purgeExpiredDatasets hard-deletes publications of expired datasets only', async () => {
    /* backdate one dataset: update user_datasets set created_at = now() - interval '3 years' where id = $1;
       call purgeExpiredDatasets(db, twoYearsBefore(new Date()), fileBytesCutoff(new Date()));
       expired one's publication gone, fresh one's still there */ });
});

describe('table absent (deploy-order safety)', () => {
  it('every reader returns its absent value and the retention leg still works', async () => {
    await db.query('drop table published_user_charts');
    expect(await publicationsTablePresent(db)).toBe(false);
    expect(await upsertPublication(db, base)).toBeNull();
    expect(await getPublicationByPublicId(db, newPublicId())).toBeNull();
    expect(await getPublicationForTurn(db, userId, turnId)).toBeNull();
    expect(await deletePublicationForTurn(db, userId, turnId)).toBe(false);
    expect(await countPublications(db, userId)).toBe(0);
    expect(await deletePublicationsForTurns(db, [turnId])).toBe(0);
    await expect(deleteOneDataset(db, userId, datasetId)).resolves.toBe(true);
  });
});
```
Write every `/* … */` body as real code (seed with the copied helpers). Use a fresh `createTestDb()` (not the shared
one) for the drop-table test so the drop cannot leak into other tests.

- [ ] **Step 3: Run to verify they fail** — `npx vitest run tests/attachments/publications.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement** `src/attachments/publications.ts`

```ts
// ADR 057 (session 127): the store for published own-data charts. Every
// function probes for the table first and returns its "absent" value when
// migration 036 has not been applied yet — the chart_edits deploy-order
// precedent (src/chart/edits-store.ts). Never catch a SQL error here: callers
// run some of these inside withTransaction, where a caught error leaves the
// transaction aborted.
import { randomBytes } from 'node:crypto';
import type { Db } from '../db/types.ts';

export const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const MAX_PUBLICATIONS_PER_USER = 50;
export const PUBLICATION_SOURCE_LINE_MAX = 120;

export interface PublicationRow {
  id: number;
  publicId: string;
  userId: string;
  datasetId: number;
  datasetTurnId: number;
  log: unknown[];
  sourceLine: string | null;
  createdAt: string;
  updatedAt: string;
}

export function newPublicId(): string {
  return randomBytes(16).toString('base64url');
}

export function isPublicIdShape(s: unknown): s is string {
  return typeof s === 'string' && PUBLIC_ID_PATTERN.test(s);
}

export async function publicationsTablePresent(db: Db): Promise<boolean> {
  const { rows } = await db.query(`select to_regclass('public.published_user_charts') as t`);
  return rows[0]?.t != null;
}

function iso(v: unknown): string {
  return typeof v === 'string' ? v : new Date(v as Date).toISOString();
}

function toRow(r: Record<string, unknown>): PublicationRow {
  return {
    id: Number(r.id),
    publicId: r.public_id as string,
    userId: r.user_id as string,
    datasetId: Number(r.dataset_id),
    datasetTurnId: Number(r.dataset_turn_id),
    log: Array.isArray(r.log) ? (r.log as unknown[]) : [],
    sourceLine: (r.source_line as string | null) ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

const COLUMNS = 'id, public_id, user_id, dataset_id, dataset_turn_id, log, source_line, created_at, updated_at';

export async function upsertPublication(
  db: Db,
  input: { userId: string; datasetId: number; datasetTurnId: number; log: unknown[]; sourceLine: string | null },
): Promise<{ publicId: string } | null> {
  if (!(await publicationsTablePresent(db))) return null;
  const { rows } = await db.query(
    `insert into published_user_charts (public_id, user_id, dataset_id, dataset_turn_id, log, source_line)
     values ($1, $2::uuid, $3, $4, $5::jsonb, $6)
     on conflict (dataset_turn_id, user_id) do update
       set log = excluded.log, source_line = excluded.source_line, updated_at = now()
     returning public_id`,
    [newPublicId(), input.userId, input.datasetId, input.datasetTurnId, JSON.stringify(input.log), input.sourceLine],
  );
  return { publicId: rows[0]!.public_id as string };
}

export async function getPublicationByPublicId(db: Db, publicId: string): Promise<PublicationRow | null> {
  if (!isPublicIdShape(publicId)) return null;
  if (!(await publicationsTablePresent(db))) return null;
  const { rows } = await db.query(`select ${COLUMNS} from published_user_charts where public_id = $1`, [publicId]);
  return rows.length === 0 ? null : toRow(rows[0] as Record<string, unknown>);
}

export async function getPublicationForTurn(db: Db, userId: string, turnId: number): Promise<PublicationRow | null> {
  if (!(await publicationsTablePresent(db))) return null;
  const { rows } = await db.query(
    `select ${COLUMNS} from published_user_charts where dataset_turn_id = $1 and user_id = $2::uuid`,
    [turnId, userId],
  );
  return rows.length === 0 ? null : toRow(rows[0] as Record<string, unknown>);
}

export async function deletePublicationForTurn(db: Db, userId: string, turnId: number): Promise<boolean> {
  if (!(await publicationsTablePresent(db))) return false;
  const { rows } = await db.query(
    `delete from published_user_charts where dataset_turn_id = $1 and user_id = $2::uuid returning id`,
    [turnId, userId],
  );
  return rows.length > 0;
}

export async function countPublications(db: Db, userId: string): Promise<number> {
  if (!(await publicationsTablePresent(db))) return 0;
  const { rows } = await db.query(`select count(*)::int as n from published_user_charts where user_id = $1::uuid`, [userId]);
  return Number(rows[0]!.n);
}

/** The GDPR leg: called by retention.ts's redactTurnsForDatasets inside the
 * SAME transaction as the turn redaction, so file deletion, account deletion
 * and the 2-year purge all kill the public link. */
export async function deletePublicationsForTurns(db: Db, turnIds: number[]): Promise<number> {
  if (turnIds.length === 0) return 0;
  if (!(await publicationsTablePresent(db))) return 0;
  const { rows } = await db.query(
    `delete from published_user_charts where dataset_turn_id = any($1::bigint[]) returning id`,
    [turnIds],
  );
  return rows.length;
}
```
If the `$2::uuid` casts collide with a text-typed parameter elsewhere in the same statement ("inconsistent types
deduced"), follow `src/chart/edits-store.ts`'s `upsertTurnEdits` comment on explicit casts.

- [ ] **Step 5: Wire retention.** In `src/attachments/retention.ts`'s `redactTurnsForDatasets`, directly after the
existing `await deleteChartEditsForTurns(tx, …)` call, add (same id list):

```ts
  // ADR 057 (session 127): a published own-data chart dies with its turn —
  // hard-deleted in the SAME transaction (it holds author text and nothing
  // any other table needs), so deletion and the retention purge kill the link.
  await deletePublicationsForTurns(
    tx,
    rows.map((r) => (r as { id: number }).id),
  );
```
and import `deletePublicationsForTurns` from `./publications.ts`.

- [ ] **Step 6: Run** `npx vitest run tests/attachments/publications.test.ts tests/attachments/retention.test.ts tests/db` → all PASS
(`tests/db` includes the migration-number collision check).

- [ ] **Step 7: Commit** — `git add migrations/036_published_user_charts.sql src/attachments/publications.ts src/attachments/retention.ts tests/attachments/publications.test.ts && git commit -m "feat(own-data publish): migration 036 + publications store + retention leg (ADR 057)"`

---

### Task 2: Server-side replay + P1 pruning (`web/lib/own-chart-publication.ts`)

**Files:**
- Create: `web/lib/user-chart-command-spec.ts`, `web/lib/own-chart-publication.ts`, `web/lib/own-chart-publication.test.ts`
- Modify: `web/components/user-chart.tsx` — delete its private `toCommandSpec` (≈line 245) and `instructionKey`
  (≈line 269) and import them from `web/lib/user-chart-command-spec.ts` instead (a pure move, no behaviour change;
  keep their doc comments with them).

**Interfaces — Consumes:** `renderInstructionForDataset` (`web/backend/attachments/render.ts`),
`deriveChartOverlay` + `ResolvedOverlay` (`web/backend/attachments/derive-overlay.ts`),
`validateInstructionObject` + `InstructionValidationError` (`web/backend/attachments/instruct/schema.ts`),
`upgradeInstruction`, `toClientInstruction`, types `UserDataset`, `UserChartSpec`, `DatasetTurnRecord`,
`ClientChartInstruction` (`web/backend/attachments/types.ts`), `replayLog` (`web/lib/chart-history.ts`),
`initialDocState`, `ChartDocState`, `ChartCommand`, `CommandContext` (`web/lib/chart-commands.ts`),
`defaultFormFor` (`web/lib/chart-view-state.ts`).

**Interfaces — Produces:**
```ts
// web/lib/user-chart-command-spec.ts
export function toCommandSpec(spec: UserChartSpec): CommandContext['spec'];
export function instructionKey(instruction: ClientChartInstruction | null): string;

// web/lib/own-chart-publication.ts
export interface PublicChartState {          // JSON-safe (no Set) — crosses the server→client boundary
  form: ChartForm;
  hiddenKeys: string[];
  dimmedKeys: string[];
  highlightedKey: string | null;
  presentation: PresentationOverrides;
  notes: ChartNote[];
  title: string | null;
  caption: string | null;
  goalLines: GoalLine[];
  eraShadings: EraShading[];
  headlineOverrideResultId: string | null;
  derivedOverlayRequests: DerivedOverlayRequest[];
}
export interface PublicOwnChart {
  spec: UserChartSpec;                        // pruned; provenance scrubbed (see pruneForPublic)
  state: PublicChartState;
  overlays: Record<string, ResolvedOverlay>;  // keyed by DerivedOverlayRequest.id
  sourceLine: string | null;
}
export type BuildPublishedChartResult =
  | { ok: true; state: ChartDocState; spec: UserChartSpec; dataset: UserDataset; dropped: number }
  | { ok: false; reason: 'not_chart' | 'invalid_log' | 'render_failed' };
export function buildPublishedChart(dataset: UserDataset, turn: DatasetTurnRecord, log: unknown): BuildPublishedChartResult;
export function pruneForPublic(built: Extract<BuildPublishedChartResult, { ok: true }>, sourceLine: string | null): PublicOwnChart;
```

- [ ] **Step 1: Move `toCommandSpec`/`instructionKey`** into `web/lib/user-chart-command-spec.ts` (verbatim bodies,
typed imports from `../backend/attachments/types.ts` and `./chart-commands.ts`), import them in `user-chart.tsx`.
Run `npx vitest run web/components/user-chart.test.tsx` from the repo root → PASS (pure move).

- [ ] **Step 2: Write the failing tests** `web/lib/own-chart-publication.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { buildDatasetProfile } from '../backend/attachments/ingest/profile.ts';
import type { DatasetTurnRecord, UserDataset } from '../backend/attachments/types.ts';
import { buildPublishedChart, pruneForPublic } from './own-chart-publication.ts';

const CELLS = [
  ['Jaar', 'Klant', 'Omzet'],
  ['2020', 'Geheim BV', '120,5'],
  ['2020', 'Open NV', '80,0'],
  ['2021', 'Geheim BV', '150,0'],
  ['2021', 'Open NV', '90,0'],
];
const dataset: UserDataset = {
  id: 42, userId: 'u1', sourceKind: 'file_csv', displayName: 'klanten_vertrouwelijk.csv',
  sourceUrl: 'https://intranet.example.com/x.csv', cells: CELLS, profile: buildDatasetProfile(CELLS),
  status: 'ready', contentSha256: 'deadbeefcafe', createdAt: '2026-09-06T00:00:00Z',
};
const instruction = {
  version: 2, kind: 'line', x: 'c0', y: ['c2'], seriesBy: 'c1', filters: [], sort: null, limit: null,
  aggregate: null, derived: null, unsupported: null, reading: '', confidence: 1,
};
const turn = { id: 7, userId: 'u1', datasetId: 42, kind: 'chart', chartEmitted: true, instruction } as unknown as DatasetTurnRecord;

describe('buildPublishedChart', () => {
  it('an empty log rebuilds the chart as first made', () => {
    const r = buildPublishedChart(dataset, turn, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dropped).toBe(0);
    expect(r.spec.series.map((s) => s.label)).toEqual(['Geheim BV', 'Open NV']);
  });
  it('replays view commands (title, hide a series)', () => {
    const r = buildPublishedChart(dataset, turn, [{ kind: 'setTitle', title: 'Omzet' }, { kind: 'toggleSeries', key: 's0' }]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.state.title).toBe('Omzet');
    expect([...r.state.hiddenKeys]).toEqual(['s0']);
  });
  it('counts a command that does not validate as dropped (never silently different)', () => {
    const r = buildPublishedChart(dataset, turn, [{ kind: 'toggleSeries', key: 's9' }]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toBe(1);
  });
  it('counts garbage entries as dropped', () => {
    const r = buildPublishedChart(dataset, turn, [null, 42, 'x', { nokind: true }]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toBe(4);
  });
  it('a non-array log is invalid_log', () => {
    expect(buildPublishedChart(dataset, turn, { kind: 'setTitle' })).toEqual({ ok: false, reason: 'invalid_log' });
  });
  it('a turn without an instruction is not_chart', () => {
    expect(buildPublishedChart(dataset, { ...turn, instruction: null }, [])).toEqual({ ok: false, reason: 'not_chart' });
  });
  it('follows a setInstruction data command to the new spec', () => {
    const next = { ...instruction, seriesBy: null } as Record<string, unknown>;
    delete next.reading; delete next.confidence;
    const r = buildPublishedChart(dataset, turn, [{ kind: 'setInstruction', instruction: next, summary: 'één lijn' }]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toBe(0);
    expect(r.spec.series).toHaveLength(1);
  });
});

describe('pruneForPublic — invariant P1', () => {
  const built = buildPublishedChart(dataset, turn, [
    { kind: 'toggleSeries', key: 's0' },
    { kind: 'addNote', note: { id: 'n1', resultId: 'r1:c2', periodLabel: '2020', seriesLabel: 'Geheim BV', text: 'piek' } },
    { kind: 'setTitle', title: 'Omzet per klant' },
  ]);
  if (!built.ok) throw new Error('expected ok');
  const pub = pruneForPublic(built, 'Bron: eigen administratie');
  const json = JSON.stringify(pub);

  it('never contains a hidden series label, value or source text', () => {
    expect(json).not.toContain('Geheim BV');
    expect(json).not.toContain('120,5');
    expect(json).not.toContain('150,0');
    expect(json).not.toContain('120.5');
  });
  it('keeps the hidden series slot so keys and colours do not shift', () => {
    expect(pub.spec.series).toHaveLength(2);
    expect(pub.spec.series[0]!.label).toBe('');
    expect(pub.spec.series[0]!.points.every((p) => p.value === null && p.formattedValue === null && p.sourceText === '')).toBe(true);
    expect(pub.spec.series[1]!.label).toBe('Open NV');
    expect(pub.state.hiddenKeys).toEqual(['s0']);
  });
  it('drops a note anchored to a hidden point', () => {
    expect(pub.state.notes).toEqual([]);
  });
  it('never contains the file name, source url, content hash, cells, profile or the command log', () => {
    for (const secret of ['klanten_vertrouwelijk', 'intranet.example.com', 'deadbeefcafe', '"cells"', '"profile"', 'toggleSeries', 'addNote']) {
      expect(json).not.toContain(secret);
    }
  });
  it('keeps the author text and the source line', () => {
    expect(pub.state.title).toBe('Omzet per klant');
    expect(pub.sourceLine).toBe('Bron: eigen administratie');
  });
  it('clears the verified-whole designation and period range (v1)', () => {
    expect(JSON.stringify(pub.state)).not.toContain('wholeReferenceRowRef');
    expect(JSON.stringify(pub.state)).not.toContain('periodRange');
  });
});
```
Before relying on them, check the exact rowRef format against `src/attachments/execute.ts` (`r{row}:c{col}`, row 0
is the header) and that `toggleSeries`/`addNote` command shapes match `web/lib/chart-commands.ts` lines 44-90;
adjust the test data (not the assertions' intent) if a shape differs. Add one overlay case: a
`{ kind: 'addDerivedOverlay', overlay: { id: 'o1', calcKind: 'difference', resultIds: [<hidden rowRef>, <visible rowRef>] } }`
must be absent from `pub.state.derivedOverlayRequests` and `pub.overlays`; an overlay over two visible points must
be present in both with a numeric `value`.

- [ ] **Step 3: Run to verify they fail** — `npx vitest run web/lib/own-chart-publication.test.ts` (from repo root; if
the root vitest config does not include `web/`, run `cd web && npx vitest run lib/own-chart-publication.test.ts`) → FAIL.

- [ ] **Step 4: Implement** `web/lib/own-chart-publication.ts` (no `'use client'`):

```ts
// ADR 057 (session 127): rebuild a published own-data chart on the server and
// prune it for an anonymous visitor. Rebuilding uses ONLY the building blocks
// the card itself uses (replayLog + validateCommand, renderInstructionForDataset,
// deriveChartOverlay) — no new code computes a number, so U1/U5/U6 hold by
// reuse. pruneForPublic is the single enforcement point of invariant P1
// (docs/05-data-rules.md): read the spec §3.5 before changing it.
import { deriveChartOverlay, type ResolvedOverlay } from '../backend/attachments/derive-overlay.ts';
import { InstructionValidationError, validateInstructionObject } from '../backend/attachments/instruct/schema.ts';
import { renderInstructionForDataset } from '../backend/attachments/render.ts';
import {
  toClientInstruction, upgradeInstruction,
  type ClientChartInstruction, type DatasetTurnRecord, type UserChartSpec, type UserDataset,
} from '../backend/attachments/types.ts';
import { replayLog } from './chart-history.ts';
import { initialDocState, type ChartCommand, type ChartDocState, type CommandContext, /* + GoalLine, EraShading, DerivedOverlayRequest */ } from './chart-commands.ts';
import { defaultFormFor, type ChartForm } from './chart-view-state.ts';
import { instructionKey, toCommandSpec } from './user-chart-command-spec.ts';
// + ChartNote (type-only from '../components/chart-notes.tsx'), PresentationOverrides (from its module)

// (types PublicChartState / PublicOwnChart / BuildPublishedChartResult exactly as in "Produces")

function isCommandShaped(x: unknown): x is ChartCommand {
  return x !== null && typeof x === 'object' && !Array.isArray(x) && typeof (x as { kind?: unknown }).kind === 'string';
}

/** Mirrors web/app/dataset-derivation-actions.ts's private toValidatableInstruction
 * (fills the server-only fields a ClientChartInstruction never carries). */
function toValidatableInstruction(raw: unknown): unknown { /* copy that function's body verbatim */ }

export function buildPublishedChart(dataset: UserDataset, turn: DatasetTurnRecord, log: unknown): BuildPublishedChartResult {
  if (turn.kind !== 'chart' || !turn.chartEmitted || turn.instruction === null) return { ok: false, reason: 'not_chart' };
  if (!Array.isArray(log)) return { ok: false, reason: 'invalid_log' };

  const first = renderInstructionForDataset(dataset, turn.instruction);
  if (first.kind !== 'ok') return { ok: false, reason: 'render_failed' };
  const firstInstruction = toClientInstruction(turn.instruction);

  const cache = new Map<string, UserChartSpec>([[instructionKey(firstInstruction), first.chart]]);
  let garbage = 0;
  const commands: ChartCommand[] = [];
  for (const entry of log) {
    if (!isCommandShaped(entry)) { garbage++; continue; }
    commands.push(entry);
    if (entry.kind === 'setInstruction') {
      const key = instructionKey(entry.instruction);
      if (!cache.has(key)) {
        const outcome = renderInstructionForDataset(dataset, entry.instruction);
        if (outcome.kind === 'ok') cache.set(key, outcome.chart);
      }
    }
  }

  // Same initial state + ctx the card builds (user-chart.tsx ≈1123-1215).
  const initial = initialDocState(defaultFormFor(toCommandSpec(first.chart)), {}, firstInstruction);
  const ctx = (state: ChartDocState): CommandContext => ({
    spec: toCommandSpec(cache.get(instructionKey(state.instruction)) ?? first.chart),
    alternatesCount: 0,
    profile: dataset.profile,
  });
  const { state, dropped } = replayLog(initial, commands, ctx);
  const spec = cache.get(instructionKey(state.instruction));
  if (spec === undefined) return { ok: false, reason: 'render_failed' };
  return { ok: true, state, spec, dataset, dropped: dropped + garbage };
}

export function pruneForPublic(built: Extract<BuildPublishedChartResult, { ok: true }>, sourceLine: string | null): PublicOwnChart {
  const { state, spec, dataset } = built;
  const hidden = new Set(state.hiddenKeys);
  const blankedRefs = new Set<string>();
  const series = spec.series.map((s, i) => {
    if (!hidden.has(`s${i}`)) return s;
    for (const p of s.points) blankedRefs.add(p.rowRef);
    return {
      label: '',
      points: s.points.map((p) => ({ rowRef: p.rowRef, xKey: p.xKey, xLabel: p.xLabel, value: null, formattedValue: null, sourceText: '' })),
    };
  });
  const prunedSpec: UserChartSpec = {
    ...spec,
    series,
    provenance: { ...spec.provenance, datasetId: 0, displayName: '', sourceUrlHost: null, contentSha256: '' },
  };
  const overlayRequests = state.derivedOverlayRequests.filter((r) => r.resultIds.every((id) => !blankedRefs.has(id)));
  const overlays: Record<string, ResolvedOverlay> = {};
  if (state.instruction !== null) {
    let instruction: ReturnType<typeof validateInstructionObject> | null = null;
    try {
      instruction = validateInstructionObject(toValidatableInstruction(upgradeInstruction(state.instruction)), dataset.profile);
    } catch (e) {
      if (!(e instanceof InstructionValidationError)) throw e;
    }
    if (instruction !== null) {
      for (const r of overlayRequests) {
        try {
          overlays[r.id] = deriveChartOverlay(dataset, instruction, { calcKind: r.calcKind, resultIds: r.resultIds });
        } catch {
          // A refused overlay is simply not drawn on the public page (the author's
          // card shows the refusal text; the public page never shows error copy).
        }
      }
    }
  }
  return {
    spec: prunedSpec,
    state: {
      form: state.form,
      hiddenKeys: [...state.hiddenKeys],
      dimmedKeys: [...state.dimmedKeys],
      highlightedKey: state.highlightedKey !== null && hidden.has(state.highlightedKey) ? null : state.highlightedKey,
      presentation: state.presentation,
      notes: state.notes.filter((n) => !blankedRefs.has(n.resultId)),
      title: state.title,
      caption: state.caption,
      goalLines: state.goalLines,
      eraShadings: state.eraShadings,
      headlineOverrideResultId:
        state.headlineOverrideResultId !== null && blankedRefs.has(state.headlineOverrideResultId) ? null : state.headlineOverrideResultId,
      derivedOverlayRequests: overlayRequests,
    },
    overlays,
    sourceLine,
  };
}
```
`deriveChartOverlay` throws only `OverlaySelectionError` / `NoRowsError` / `TooManyPointsError` for bad input; the
blanket `catch` above is acceptable because a public page must never 500 over one overlay — but re-read
`derive-overlay.ts` and narrow the catch to those three classes if they are exported (preferred). Fix the imports
to the real module paths (grep `export interface GoalLine`, `export type PresentationOverrides`).

- [ ] **Step 5: Run** `npx vitest run web/lib/own-chart-publication.test.ts web/components/user-chart.test.tsx` → PASS.
Then `npm run web:typecheck` → exit 0.

- [ ] **Step 6: Commit** — `git commit -m "feat(own-data publish): server-side replay + P1 pruning (ADR 057)"` (add the 4 files).

---

### Task 3: Server actions (`web/app/own-chart-publish-actions.ts`)

**Files:** Create `web/app/own-chart-publish-actions.ts`, `web/app/own-chart-publish-actions.test.ts`.

**Interfaces — Consumes:** Task 1 store, Task 2 `buildPublishedChart`, `getDatasetTurnById`
(`web/backend/attachments/read.ts`), `getDataset` (`web/backend/attachments/store.ts`), `currentUserId`
(`web/lib/current-user.ts`), `getDb` (`web/lib/db.ts`), `reportError` (`web/lib/error-report.ts`),
`CHART_EDITS_MAX_JSON` (`web/backend/chart/edits-store.ts`).

**Interfaces — Produces:**
```ts
export type PublishFailure = 'disabled' | 'unauthenticated' | 'forbidden' | 'invalid' | 'changed' | 'limit' | 'unavailable' | 'error';
export type PublishOwnChartResult = { ok: true; publicId: string } | { ok: false; reason: PublishFailure };
export async function publishOwnChart(turnId: number, log: unknown, sourceLine: unknown): Promise<PublishOwnChartResult>;
export async function unpublishOwnChart(turnId: number): Promise<{ ok: boolean }>;
export async function getOwnChartPublication(turnId: number): Promise<{ publicId: string; sourceLine: string | null } | null>;
export function normalizeSourceLine(raw: unknown): { ok: true; value: string | null } | { ok: false };
```

- [ ] **Step 1: Write the failing tests.** Mock the modules exactly the way `web/app/embed-actions.test.ts` does
(read it first; `vi.mock` of `../lib/current-user.ts`, `../lib/db.ts`, and here also
`../backend/attachments/read.ts`, `../backend/attachments/store.ts`, `../backend/attachments/publications.ts`,
`../lib/own-chart-publication.ts`). Cases, one `it` each:
  1. flag unset → `{ ok:false, reason:'disabled' }` and `currentUserId` never called (`vi.stubEnv('OWN_DATA_PUBLISH_ENABLED', '')`; `'1'` elsewhere).
  2. signed out → `unauthenticated`.
  3. turn missing, turn of another user, turn `kind !== 'chart'` or `!chartEmitted`, dataset null or `status !== 'ready'` → `forbidden` (one `it.each`).
  4. log JSON longer than `CHART_EDITS_MAX_JSON` → `invalid`; `buildPublishedChart` not called.
  5. `buildPublishedChart` returns `ok:false` → `invalid`; returns `dropped: 1` → `changed`; `upsertPublication` not called.
  6. source line: `'  Bron  '` → stored `'Bron'`; `''`/`'   '`/`null`/`undefined` → stored `null`; 121 chars → `invalid`;
     `'a\u0000b\u0007c'` → stored `'abc'`; a number → `invalid`. (Test `normalizeSourceLine` directly too.)
  7. `countPublications` = 50 and no existing publication for this turn → `limit`; = 50 WITH an existing one → allowed (update).
  8. `upsertPublication` returns null (table absent) → `unavailable`.
  9. happy path → `{ ok:true, publicId }` and `upsertPublication` called with `{ userId, datasetId, datasetTurnId, log, sourceLine }`.
  10. a thrown DB error → `error` and `reportError` called.
  11. `unpublishOwnChart`: flag off / signed out → `{ ok:false }`; otherwise calls `deletePublicationForTurn(db, userId, turnId)` and returns its boolean.
  12. `getOwnChartPublication`: flag off / signed out → null; otherwise `{ publicId, sourceLine }` from `getPublicationForTurn`.
  13. a non-positive-integer `turnId` (0, -1, 1.5, NaN) → `forbidden` / `{ok:false}` / null, never a DB call.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.** Header comment explains: own tiny `'use server'` file (the `embed-actions.ts`
rationale — keep the DB graph out of the client bundle); fails closed; ownership is by `user_id` parameter;
`changed` means the log would not replay exactly (spec §3.2 step 3). Order of checks = the test order above.
`normalizeSourceLine`: non-string & non-nullish → fail; strip `[\u0000-\u001F\u007F]`; trim; `''` → null;
`> PUBLICATION_SOURCE_LINE_MAX` → fail. The limit check: `existing = await getPublicationForTurn(...)`; if
`existing === null && await countPublications(db, userId) >= MAX_PUBLICATIONS_PER_USER` → `limit`.
Wrap the DB part in `try { … } catch (e) { await reportError('publishOwnChart', e, { userId, extra: { turnId } }); return { ok:false, reason:'error' }; }`.

- [ ] **Step 4: Run** the test file → PASS; `npm run web:typecheck` → 0.

- [ ] **Step 5: Commit** — `feat(own-data publish): publish/unpublish server actions (ADR 057)`.

---

### Task 4: `UserChartView` read-only `publicView` mode

**Files:** Modify `web/components/user-chart.tsx`, `web/components/user-chart.test.tsx`, `web/lib/i18n/messages.ts`.

**Interfaces — Consumes:** `PublicOwnChart`, `PublicChartState` (Task 2).
**Produces:** `UserChartView({ spec, edit, publicView })` where
```ts
export interface UserChartPublicView {
  state: PublicChartState;
  overlays: Record<string, ResolvedOverlay>;
  sourceLine: string | null;
  /** The author's account default look (sanitised by the card like the context value), or null. */
  accountStyle: unknown;
}
```
`publicView` and `edit` are mutually exclusive (the public page never passes `edit`).

Requirements (each gets a test in `user-chart.test.tsx`, a new `describe('publicView (ADR 057)')` block; build the
spec for the tests with the existing test file's own spec helpers):
1. Initial state = `publicView.state` converted back to a `ChartDocState` (`hiddenKeys`/`dimmedKeys` → `Set`,
   `periodRange: null`, `selectedReading: null`, `instruction: null`, `wholeReferenceRowRef: null`). No
   `useChartEdits` persistence (it is already off without `edit`; assert no server action mock is called).
2. Resolved overlays come from `publicView.overlays` (a `Map` built from the record); the derivation effect does
   not run (it already bails without `datasetId`; keep it that way and assert `requestDatasetDerivation` is never called).
3. NOT rendered: form tabs (no `role="tablist"`), `ChartHistoryActions`, `ChartConfigTrigger`/`ChartConfigPanel`,
   `ChartDataTrigger`/`ChartDataPanel`, `ChartCopilotInput`, the small-multiples toggle, `DownloadCsvButton`,
   `ChartDownloadMenu`, the Publish button (Task 6), and every editable affordance (`ChartEditableText` renders
   read-only text; the legend does not toggle — clicking a legend item changes nothing).
4. The legend lists NO hidden series (their labels are `''` anyway — do not render an empty legend chip).
5. The provenance line does NOT show the file name: in public mode render
   `t(chartLang, 'ownChart.public.sourceLine', { source })` where `source` = `publicView.sourceLine` or, when null,
   `t(chartLang, 'ownChart.public.sourceDefault')`. `USER_DATA_BADGE` and `spec.disclaimerLine` still render (U4).
   The source line is bound as a spec string: wrap it in an element with `data-label-for="source-line"` like the
   other bound strings in this file (grep `data-label-for` for the convention).
6. Account style: `const effectiveAccountStyle = publicView ? sanitizeOverrides(publicView.accountStyle) : accountStyle`
   (use the same sanitiser `web/lib/chart-style-context.tsx` uses; export it from there if it is private) — the
   presentation resolver then uses it exactly like the signed-in path.
7. U6 digit test: `expectDigitsTraceToSpec(container, spec, [sourceLine])` passes for a public render whose source
   line contains digits (`'Jaarverslag 2025'`), and the file name is NOT in the allowed list for this test (pass a
   spec whose `provenance.displayName` is `''`).
8. A hidden series' former label and values never appear in `container.textContent` (render with the Task 2
   `pruneForPublic` output of a chart with `s0` hidden).

New i18n keys (both `nl` and `en`):
```ts
'ownChart.public.sourceLine': 'Bron: {source}',                      // en: 'Source: {source}'
'ownChart.public.sourceDefault': 'gegevens aangeleverd door de maker', // en: 'data supplied by the author'
```

- [ ] Step 1: write the 8 failing tests. - [ ] Step 2: run → FAIL. - [ ] Step 3: implement (thread a single
`publicMode = publicView !== undefined` boolean through `UserChartCard`; gate each mount point listed in the
fact sheet: form tabs ≈2399-2432, `ChartHistoryActions` ≈2377, `ChartConfigTrigger` ≈2379, `ChartDataTrigger`
≈2389, small-multiples toggle ≈2491-2514, `ChartCopilotInput` ≈2665, `ChartDataPanel` ≈2695, `ChartConfigPanel`
≈2707, `DownloadCsvButton` ≈2791, `ChartDownloadMenu` ≈2801, provenance line ≈1432/2782). - [ ] Step 4: run
`npx vitest run web/components/user-chart.test.tsx web/lib/i18n` → PASS; `npm run web:typecheck` → 0.
- [ ] Step 5: commit `feat(own-data publish): read-only publicView mode on the own-data card (ADR 057)`.

---

### Task 5: The public route `/embed/own/[publicId]`

**Files:** Create `web/app/embed/own/[publicId]/page.tsx`, `web/app/embed/own/[publicId]/page.test.tsx`;
modify `web/proxy.test.ts`, `web/lib/i18n/messages.ts`; check `web/next.config.ts` (the `/embed/:path+` header
rule must cover `/embed/own/x` — it does by pattern; add an assertion to its existing test if one exists, grep
`frame-ancestors` under `web/`).

**Interfaces — Consumes:** Task 1 `getPublicationByPublicId`, `isPublicIdShape`; Task 2 `buildPublishedChart`,
`pruneForPublic`; Task 4 `UserChartView` with `publicView`; `getDatasetTurnById`; `getDataset(db, row.userId, row.datasetId)`;
`getUserChartStyle` + `chartStylesTablePresent` (`web/backend/chart/user-styles.ts` — read `UserChartStyleRow` for
the field that holds the overrides); `EmbedResize` from `web/app/embed/[token]/embed-resize.tsx`; `isLang`.

Behaviour (mirror `web/app/embed/[token]/page.tsx` structure and comments; read it first):
- `export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';`
  `export const metadata: Metadata = { robots: { index: false, follow: false } };`
- flag not `'1'` → `notFound()`. `!isPublicIdShape(publicId)` → `notFound()`.
- row null, turn null, `turn.userId !== row.userId`, dataset null or not `ready`, `buildPublishedChart` not ok →
  the not-available page (same markup as the CBS route, `<EmbedResize />` + digit-free message via i18n key
  `ownChart.public.unavailable`: nl `'Deze grafiek is niet meer beschikbaar.'`, en `'This chart is no longer available.'`).
- else render `<EmbedResize />`, `<UserChartView spec={pub.spec} publicView={{ state, overlays, sourceLine, accountStyle }} />`
  and a footer: `t(lang,'ownChart.public.footer')` (nl `'Gemaakt met checkdecijfers — gegevens van de maker, niet door ons gecontroleerd'`,
  en `'Made with checkdecijfers — the author’s own data, not checked by us'`) linking to `APP_URL` (`rel="noopener"`, `target="_blank"`).
  `lang` = `?lang=` if `isLang`, else `'nl'`.
- Never import or call a server action from this file.

Tests (`page.test.tsx`, mocking like the CBS route test):
1. flag off → `notFound` called, no DB call. 2. malformed id → `notFound`. 3. row missing → not-available text, no
chart. 4. dataset redacted (`status:'redacted'`) → not-available. 5. turn belongs to another user → not-available.
6. happy path → the chart renders (mock `UserChartView` to a stub that records its props) with the pruned spec;
assert the recorded props JSON does not contain the dataset's `displayName` nor a hidden series label (use the real
`pruneForPublic`, mock only DB readers). 7. `metadata.robots` is `{ index:false, follow:false }`. 8. the footer link
points at `APP_URL`.

`web/proxy.test.ts` additions: `isPublicPath('/embed/own/AAAAAAAAAAAAAAAAAAAAAA')` is `true`;
`embedRequestHeaders('/embed/own/x', new URLSearchParams('lang=en&theme=dark'))` equals
`{ 'x-embed-route':'1', 'x-embed-lang':'en', 'x-embed-theme':'dark' }`.

- [ ] Steps: failing tests → run (FAIL) → implement → run page + proxy + i18n tests (PASS) → `npm run web:typecheck`
→ commit `feat(own-data publish): public route /embed/own/[publicId] (ADR 057)`.

---

### Task 6: Publish button + dialog + flag plumbing

**Files:** Create `web/components/own-chart-publish-dialog.tsx`, `web/components/own-chart-publish-dialog.test.tsx`;
modify `UserChartEditContext` in `web/components/user-chart.tsx` (add `publishEnabled?: boolean`),
`web/app/workspace/page.tsx`, `web/components/workspace.tsx` and every component between it and
`web/components/dataset-chat.tsx` / `web/components/visual-dock.tsx` that builds a `UserChartEditContext`
(trace how the `attachments` prop reaches `dataset-chat.tsx` and follow the same path), `web/lib/i18n/messages.ts`.

**Interfaces — Consumes:** Task 3 actions; `serializeHistory` (`web/lib/chart-history.ts`); `APP_URL` +
`EMBED_DEFAULT_HEIGHT_PX` (exported from `web/components/chart-embed-dialog.tsx`); the shadcn `dialog` primitive
that `chart-embed-dialog.tsx` uses (same import path).
**Produces:**
```ts
export function OwnChartPublishButton(props: { turnId: number; lang: Lang; getLog: () => unknown[] }): JSX.Element;
export function buildOwnEmbedUrl(publicId: string, opts: { lang: Lang; theme: 'light' | 'dark' | 'auto' }): string; // `${APP_URL}/embed/own/${publicId}?lang=…&theme=…`
export function buildOwnEmbedCode(publicId: string, opts: { lang: Lang; theme: 'light' | 'dark' | 'auto' }, title: string): string;
```
`buildOwnEmbedCode` = the CBS `buildEmbedCode` iframe shape with `data-checkdecijfers-embed="${publicId}"` plus the
same resize script — export `buildEmbedResizeScript` from `chart-embed-dialog.tsx` and reuse it (do not copy it).
Escape `title` for an HTML attribute (`&`, `"`, `<`, `>`).

Flag plumbing: `web/app/workspace/page.tsx` reads `process.env.OWN_DATA_PUBLISH_ENABLED === '1'` and passes
`ownDataPublish={{ enabled: true }}` only when on (the `attachments` presence pattern); it ends up as
`edit.publishEnabled === true` on `UserChartEditContext`. The card renders `<OwnChartPublishButton>` next to
`DownloadCsvButton` only when `edit?.publishEnabled === true && !publicMode`, with
`getLog={() => serializeHistory(history)}` (the card's own history from `useChartHistory`).

Dialog behaviour (i18n keys `ownChart.publish.*`, both languages — write the English as below and a faithful Dutch):
- trigger `'Publish'`; title `'Publish this chart'`.
- on open: `getOwnChartPublication(turnId)`; while loading a neutral line.
- disclosure paragraph: `'Anyone with the link can see this chart. Hidden series, and notes or calculations tied to them, are left out. The file name is never shown. The page says the numbers come from your own file and were not checked by us.'`
- source-line input, `maxLength={120}`, label `'Source line (optional)'`, placeholder `'e.g. Source: our own sales records'`, helper `'Up to 120 characters. Left empty, the page says “data supplied by the author”.'`
- language (NL/EN) and colour (light/dark/auto) selects, like the CBS dialog.
- not published → button `'Publish'`; published → link field + `'Copy link'`, embed code + `'Copy code'`,
  buttons `'Update published version'` and `'Unpublish'`.
- `Unpublish` asks for confirmation inline (`'Unpublish? The link stops working immediately. Publishing again later gives a new link.'` + `'Yes, unpublish'` / `'Cancel'`).
- failures → one line each: `disabled`/`unavailable` `'Publishing is not available right now.'`; `limit`
  `'You have reached the limit of 50 published charts. Unpublish one first.'`; `changed`
  `'This chart could not be published exactly as shown. Try again after your last change is saved.'`;
  `invalid` `'The source line is too long or this chart cannot be published.'`; `forbidden`/`unauthenticated`/`error`
  `'Something went wrong. Please try again.'`
- digits: the `50` and `120` must appear in both nl and en strings (digit-parity test).

Tests (`own-chart-publish-dialog.test.tsx`, mock the three actions): opens and shows "not published" state; publish
sends `getLog()` and the trimmed source line and then shows link + code containing `/embed/own/<id>`; published state
shows Update + Unpublish; Unpublish needs the confirm click and then calls `unpublishOwnChart`; each failure reason
shows its line; the embed code escapes a title containing `"` and `<`; `buildOwnEmbedUrl` puts lang and theme in the query.
In `user-chart.test.tsx`: the Publish button renders only when `edit.publishEnabled === true`, and never in public mode.

- [ ] Steps: failing tests → FAIL → implement → run the dialog, user-chart, i18n, workspace/dataset-chat tests →
PASS → `npm run web:typecheck` → commit `feat(own-data publish): publish dialog + flag plumbing (ADR 057)`.

---

### Task 7: Docs to measured state

**Files:** `docs/05-data-rules.md`, `docs/decisions/057-own-data-publish.md`, `docs/04-architecture.md`,
`docs/RUNBOOK.md`, `docs/open-questions.md` (#318), `docs/08-build-plan.md`, `docs/STATUS.md`, `web/README.md` if it lists routes.

- [ ] Add row **P1** directly after U12 in the U-table of `05-data-rules.md`:
`| **P1** | A published own-data chart's public payload contains no hidden series label/value/source text (blanked in place), nothing anchored to a blanked point, no file name, source URL host, content hash, cells, profile or command log (ADR 057). | R-new (public surface) | web/lib/own-chart-publication.test.ts "pruneForPublic — invariant P1" + the public route's props test. |`
- [ ] ADR 057: replace "Not yet built" with an as-built note (files, commit SHAs from `git log`, tests, measured suite counts).
- [ ] `04-architecture.md`: a capability row for own-data publishing (files + status "BUILT, dark behind flag").
- [ ] `RUNBOOK.md`: section "Own-data publishing (ADR 057) — switching it on": apply migration 036 (`npm run db:migrate`,
owner-supervised), set `OWN_DATA_PUBLISH_ENABLED=1` in Vercel (Production), redeploy, live check (publish a chart →
open the link in a private window → hidden series absent → Unpublish → link shows "no longer available"); rollback =
unset + redeploy (rows stay; pages show not-available). Owner takedown of an abusive page:
`delete from published_user_charts where public_id = '<id>';` via the Supabase SQL editor.
- [ ] #318, 08-build-plan, STATUS: B1 built + dark, owner steps listed. Grep `docs/` for "B1" / "publish an own-data" old framing and fix.
- [ ] `npx vitest run tests/docs` → PASS; commit `docs(own-data publish): P1, ADR 057 as-built, runbook, status`.

---

## Final verification (session, not a subagent)

`nohup scripts/verify-block.sh <worktree> <log> & disown` → all `exit=0`, benchmark 14/14 + 6/6 + 0 fabricated,
`next build` compiles; `/code-review` LOW over the full diff (after `git add -N` of new files); fix findings; then
merge to `main` (owner present) and confirm green CI incl. deploy.
