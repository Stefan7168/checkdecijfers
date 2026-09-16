# Journalist Chart Headline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a journalist get an AI-drafted, honesty-safe headline sentence for a chart, edit it freely, and have it persist and appear everywhere that chart is shown or exported (chat card, PNG/SVG download, public embed).

**Architecture:** A new `chart_headlines` table (one row per `audit_answers` row) holds the current headline text. Drafting reuses the existing Insights digit-free AI-phrasing mechanism (`src/chart/insights.ts` + `src/chart/insights-phrase.ts`) so a fabricated number stays structurally impossible; once a human edits the draft, the text is stored and shown as-is (no re-validation — an explicit, scoped exception, the owner's call). Writes are guarded by an in-SQL ownership check (mirrors `answer_feedback`); reads split into an authenticated "my own chart" path (chat) and a public path gated by the embed page's existing signed token (no separate auth needed there). The new table joins the GDPR retention job the same way `answer_feedback` already does.

**Tech Stack:** TypeScript, Postgres (via the `Db` interface, `src/db/types.ts`), Next.js Server Actions, Vitest + PGlite for hermetic DB tests, Zod for the phrasing schema, React (chart.tsx client component).

**Spec:** [docs/superpowers/specs/2026-09-16-chart-journalist-headline-design.md](../specs/2026-09-16-chart-journalist-headline-design.md)

## Global Constraints

- **FILE-ONLY migration** — `migrations/031_chart_headlines.sql` ships in this plan but is NOT applied to any live database by this plan; the owner applies it in a supervised step (RUNBOOK precedent: migrations 016/017/019/026/028/030). Every reader/writer function must degrade gracefully (return null / false / no-op) when the table doesn't exist yet, checked via `to_regclass`, never a try/catch around the whole body (that would mask real errors) — mirror `src/chart/user-styles.ts`'s stated contract and `src/answer/audit/feedback.ts`'s pre-migration test.
- **Headline text cap:** 140 characters (`CHART_HEADLINE_MAX_LENGTH`), enforced server-side before any SQL write. This is a UI/layout bound (assumption, flagged in [open-questions #259](../../open-questions.md)), not a honesty check.
- **No re-validation of edited text** — once a human saves an edited headline, it is stored and shown verbatim. This is a deliberate, scoped exception (owner decision) to the product's digit-scan discipline, for this one field only. Do not extend any digit-scan/R1 machinery to cover it.
- **Ownership guard lives in SQL**, not application code, for every write (mirrors `upsertAnswerFeedback`, `src/answer/audit/feedback.ts`).
- **Zero prompt-byte changes to the core answer pipeline** — this feature only adds a NEW LLM call path (the headline draft), reusing `PHRASING_MODEL` and the existing Insights prompt mechanism; it must never touch `src/answer/compose/prompt.ts` or re-key any existing LLM fixture.
- **Full verification block before every push** (root + web `npm ci`, typecheck, all backend suites, the web suite, `benchmark:run`+`benchmark:score` = 14/14 + 6/6 + 0 fabricated, a real `next build`) plus a LOW-effort `/code-review` pass — per CLAUDE.md, run after each task's own tests pass, not just once at the end.
- **Follow existing file-placement precedent exactly**: chart-related server actions that `chart.tsx` calls get their own tiny file (`web/app/chart-headline-actions.ts`, mirroring `chart-insights-actions.ts` / `chart-style-actions.ts`), never added to the large `web/app/actions.ts`.

---

## Task 1: Migration + GDPR retention integration

**Files:**
- Create: `migrations/031_chart_headlines.sql`
- Modify: `src/answer/audit/retention.ts`
- Test: `tests/audit/retention-chart-headlines.test.ts`

**Interfaces:**
- Produces: table `chart_headlines(audit_answer_id bigint primary key references audit_answers(id), headline text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`.
- Produces: `redactMatchingRows` (in `retention.ts`) gains a new optional parameter, `headlineDelete?: { sql: string; params: unknown[] }`, handled exactly like the existing `feedbackDelete` parameter (same `to_regclass('public.chart_headlines')` guard, run in the same transaction, before the redaction update).
- Consumes: nothing from later tasks.

- [ ] **Step 1: Write the migration file**

```sql
-- 031 — chart_headlines (session 105, journalist chart-headline feature,
-- docs/superpowers/specs/2026-09-16-chart-journalist-headline-design.md).
-- One row per audit_answers row: the current AI-drafted-then-journalist-
-- edited headline sentence for that chart. NOT re-validated against the
-- data once edited — a deliberate, scoped exception to this product's
-- digit-scan discipline (owner decision, recorded in the spec above).
--
-- ⚠ FILE-ONLY until the owner-supervised apply (migrations 016/017/019/026/
-- 028/030 precedent). Deploy-order-safe: every reader/writer in
-- src/chart/headline-store.ts treats an absent table as "no headline yet" /
-- "not possible right now", never throws from a missing-table condition
-- outside an explicit pre-migration test.
--
-- chart_headlines is PERSONAL DATA from this commit on (mirrors migration
-- 028's user_chart_styles rule): it joins the retention job in the SAME
-- change (retention.ts's redactMatchingRows headlineDelete leg below).
-- No GRANT/RLS here: migration 003's rls_auto_enable locks every later
-- table automatically (same note as 011/012/017/018/019/026/028).
--
-- Plain Postgres only — identical on Supabase and PGlite (ADR 009).

create table chart_headlines (
  audit_answer_id bigint primary key references audit_answers(id),
  headline text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 2: Read `src/answer/audit/retention.ts` in full to find the exact current shape of `FeedbackDelete`, `redactMatchingRows`, and its three call sites**

Run: `grep -n "FeedbackDelete\|feedbackDelete\|redactMatchingRows\|answer_feedback" src/answer/audit/retention.ts`

Confirm against this plan's own research (already verified this session): the interface `FeedbackDelete { sql: string; params: unknown[] }`, the guard block inside `redactMatchingRows` right before its `select id, kind from audit_answers ... for update` query, and three exported functions that build a `feedbackDelete` object: `deleteUserQuestionHistory`, `deleteThreadQuestionHistory`, `purgeExpiredQuestionHistory`. Also find `countPurgeableQuestionHistory` — the dry-run counterpart — confirm it does NOT need a headline-specific change (it counts `audit_answers` rows only, never touches `answer_feedback`, so no parallel change needed there; verify this by reading it before skipping it).

- [ ] **Step 3: Add the `headlineDelete` parameter to `redactMatchingRows`**

Modify `redactMatchingRows`'s signature and the guarded-delete block:

```ts
interface HeadlineDelete {
  sql: string;
  params: unknown[];
}

async function redactMatchingRows(
  db: Db,
  whereClause: string,
  params: unknown[],
  feedbackDelete?: FeedbackDelete,
  pendingRedaction?: PendingRedaction,
  headlineDelete?: HeadlineDelete,
): Promise<RedactedRow[]> {
  return db.withTransaction(async (tx) => {
    if (feedbackDelete) {
      const { rows: reg } = await tx.query(`select to_regclass('public.answer_feedback') as t`);
      if (reg[0]?.t != null) {
        await tx.query(feedbackDelete.sql, feedbackDelete.params);
      }
    }
    if (headlineDelete) {
      const { rows: reg } = await tx.query(`select to_regclass('public.chart_headlines') as t`);
      if (reg[0]?.t != null) {
        await tx.query(headlineDelete.sql, headlineDelete.params);
      }
    }
    // ... rest of the existing function body, UNCHANGED ...
```

Add the `HeadlineDelete` interface next to the existing `FeedbackDelete` interface (same file, same style/placement — directly above `redactMatchingRows`).

- [ ] **Step 4: Wire a `headlineDelete` argument into each of the three call sites**

In `deleteUserQuestionHistory` (whole-history self-service delete), add as the new 6th positional argument:

```ts
{
  sql: `delete from chart_headlines where audit_answer_id in
        (select id from audit_answers where user_id = $1)`,
  params: [userId],
},
```

In `deleteThreadQuestionHistory` (per-thread delete), add:

```ts
{
  sql: `delete from chart_headlines where audit_answer_id in
        (select id from audit_answers where user_id = $1 and thread_id = $2)`,
  params: [userId, threadId],
},
```

In `purgeExpiredQuestionHistory` (time-based purge), add:

```ts
{
  sql: `delete from chart_headlines where audit_answer_id in
        (select id from audit_answers where ${AUDIT_PURGE_WHERE})`,
  params: [cutoffIso, anonIso],
},
```

Each call site passes its existing `feedbackDelete` and `pendingRedaction` arguments unchanged, positionally, then the new `headlineDelete` object as the 6th argument to `redactMatchingRows(...)`.

- [ ] **Step 5: Write the retention test**

```ts
// tests/audit/retention-chart-headlines.test.ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  deleteUserQuestionHistory,
  deleteThreadQuestionHistory,
  purgeExpiredQuestionHistory,
} from '../../src/answer/audit/retention.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

async function insertAuditRow(
  db: Db,
  opts: { userId: string; threadId?: number | null; createdAt?: string },
): Promise<number> {
  const { rows } = await db.query(
    `insert into audit_answers
       (schema_version, user_id, thread_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms, chart_emitted, created_at)
     values (1, $1, $2, 'user', 'answer', 'q', '2026-01-01', '{}'::jsonb, 'a', '{}'::jsonb, 100, true, coalesce($3::timestamptz, now()))
     returning id`,
    [opts.userId, opts.threadId ?? null, opts.createdAt ?? null],
  );
  return Number(rows[0]!.id);
}

async function insertHeadline(db: Db, auditId: number, headline: string): Promise<void> {
  await db.query(`insert into chart_headlines (audit_answer_id, headline) values ($1, $2)`, [auditId, headline]);
}

async function headlineRows(db: Db): Promise<Array<Record<string, unknown>>> {
  const { rows } = await db.query(`select audit_answer_id, headline from chart_headlines order by audit_answer_id`);
  return rows;
}

describe('chart_headlines GDPR interplay', () => {
  it('deleteUserQuestionHistory hard-deletes only the caller’s headlines', async () => {
    await withDb(async (db) => {
      const user1 = randomUUID();
      const user2 = randomUUID();
      const mine = await insertAuditRow(db, { userId: user1 });
      const theirs = await insertAuditRow(db, { userId: user2 });
      await insertHeadline(db, mine, 'Mijn kop');
      await insertHeadline(db, theirs, 'Hun kop');

      await deleteUserQuestionHistory(db, user1);

      const rows = await headlineRows(db);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.audit_answer_id)).toBe(theirs);
    });
  });

  it('deleteThreadQuestionHistory only deletes the named thread’s headline', async () => {
    await withDb(async (db) => {
      const user1 = randomUUID();
      const inThread = await insertAuditRow(db, { userId: user1, threadId: 1 });
      const otherThread = await insertAuditRow(db, { userId: user1, threadId: 2 });
      await insertHeadline(db, inThread, 'In thread 1');
      await insertHeadline(db, otherThread, 'In thread 2');

      await deleteThreadQuestionHistory(db, user1, 1);

      const rows = await headlineRows(db);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.audit_answer_id)).toBe(otherThread);
    });
  });

  it('the 2-year purge deletes headlines attached to purged answers and leaves fresh ones', async () => {
    await withDb(async (db) => {
      const old = await insertAuditRow(db, { userId: 'user-1', createdAt: '2020-01-01T00:00:00Z' });
      const fresh = await insertAuditRow(db, { userId: 'user-1' });
      await insertHeadline(db, old, 'Oude kop');
      await insertHeadline(db, fresh, 'Verse kop');

      await purgeExpiredQuestionHistory(db, new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T00:00:00Z'));

      const rows = await headlineRows(db);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.audit_answer_id)).toBe(fresh);
    });
  });

  it('pre-migration window: redaction still works when chart_headlines does not exist', async () => {
    await withDb(async (db) => {
      const user1 = randomUUID();
      const mine = await insertAuditRow(db, { userId: user1 });
      await db.query('drop table chart_headlines');
      const redacted = await deleteUserQuestionHistory(db, user1);
      expect(redacted.map((r) => r.id)).toContain(mine);
    });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run tests/audit/retention-chart-headlines.test.ts`
Expected: FAIL — `chart_headlines` does not exist (the migration hasn't been applied to the test DB yet) and/or `redactMatchingRows` doesn't accept a 6th argument yet.

- [ ] **Step 7: Confirm the test DB harness applies file-only migrations**

Run: `grep -n "migrations" tests/helpers/pglite-db.ts`

Confirm `createTestDb` runs every `.sql` file in `migrations/` against the ephemeral PGlite instance (this is how every other FILE-ONLY migration's tests already pass in CI before the owner's real-DB apply — e.g. `answer_feedback`'s own tests above). If it does not auto-discover new files, this step's job is to report that finding rather than guess a fix — but the established precedent (migrations 016 through 030 all follow this exact pattern with no special-casing) means it should already work once the file exists.

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/audit/retention-chart-headlines.test.ts`
Expected: PASS (all 4 cases)

- [ ] **Step 9: Run the existing `answer_feedback` retention tests to confirm no regression**

Run: `npx vitest run tests/audit/feedback.test.ts`
Expected: PASS (unchanged — the new parameter is optional and additive)

- [ ] **Step 10: Commit**

```bash
git add migrations/031_chart_headlines.sql src/answer/audit/retention.ts tests/audit/retention-chart-headlines.test.ts
git commit -m "feat: chart_headlines table + GDPR retention integration"
```

---

## Task 2: Headline store (read/write with ownership guard)

**Files:**
- Create: `src/chart/headline-store.ts`
- Test: `tests/chart/headline-store.test.ts`

**Interfaces:**
- Consumes: `Db` (`src/db/types.ts`: `query(text, params?): Promise<{rows}>`, `withTransaction`).
- Produces:
  - `export const CHART_HEADLINE_MAX_LENGTH = 140;`
  - `export function normalizeHeadlineText(raw: string | null | undefined): string | null;`
  - `export async function upsertChartHeadline(db: Db, input: { auditAnswerId: number; userId: string; headline: string }): Promise<boolean>;`
  - `export async function getOwnChartHeadline(db: Db, auditAnswerId: number, userId: string): Promise<string | null>;`
  - `export async function getChartHeadlinePublic(db: Db, auditAnswerId: number): Promise<string | null>;`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/chart/headline-store.test.ts
import { describe, expect, it } from 'vitest';
import {
  CHART_HEADLINE_MAX_LENGTH,
  getChartHeadlinePublic,
  getOwnChartHeadline,
  normalizeHeadlineText,
  upsertChartHeadline,
} from '../../src/chart/headline-store.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

async function insertAuditRow(
  db: Db,
  opts: { userId: string | null; kind?: string; chartEmitted?: boolean; sourceTag?: string },
): Promise<number> {
  const { rows } = await db.query(
    `insert into audit_answers
       (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text, prompt_versions, latency_ms, chart_emitted)
     values (1, $1, $2, $3, 'q', '2026-01-01', '{}'::jsonb, 'a', '{}'::jsonb, 100, $4)
     returning id`,
    [opts.userId, opts.sourceTag ?? 'user', opts.kind ?? 'answer', opts.chartEmitted ?? true],
  );
  return Number(rows[0]!.id);
}

describe('normalizeHeadlineText', () => {
  it('trims, nulls empties, caps at the max length', () => {
    expect(normalizeHeadlineText(undefined)).toBeNull();
    expect(normalizeHeadlineText(null)).toBeNull();
    expect(normalizeHeadlineText('   ')).toBeNull();
    expect(normalizeHeadlineText('  Werkloosheid daalt  ')).toBe('Werkloosheid daalt');
    expect(normalizeHeadlineText('x'.repeat(CHART_HEADLINE_MAX_LENGTH + 50))).toHaveLength(CHART_HEADLINE_MAX_LENGTH);
  });
});

describe('upsertChartHeadline — the guarded write', () => {
  it('writes the caller’s headline on their own chart-bearing answer, and upserts on edit', async () => {
    await withDb(async (db) => {
      const auditId = await insertAuditRow(db, { userId: 'user-1' });
      expect(await upsertChartHeadline(db, { auditAnswerId: auditId, userId: 'user-1', headline: 'Eerste versie' })).toBe(true);
      expect(await upsertChartHeadline(db, { auditAnswerId: auditId, userId: 'user-1', headline: 'Bewerkte versie' })).toBe(true);
      expect(await getOwnChartHeadline(db, auditId, 'user-1')).toBe('Bewerkte versie');
      const { rows } = await db.query('select count(*)::int as n from chart_headlines');
      expect(rows[0]!.n).toBe(1);
    });
  });

  it("ownership guard: another user's chart is untouchable", async () => {
    await withDb(async (db) => {
      const auditId = await insertAuditRow(db, { userId: 'user-1' });
      expect(await upsertChartHeadline(db, { auditAnswerId: auditId, userId: 'user-2', headline: 'Poging' })).toBe(false);
      expect(await getOwnChartHeadline(db, auditId, 'user-2')).toBeNull();
    });
  });

  it('kind guard: refusals and clarifications never take a headline', async () => {
    await withDb(async (db) => {
      const refusal = await insertAuditRow(db, { userId: 'user-1', kind: 'refusal', chartEmitted: false });
      expect(await upsertChartHeadline(db, { auditAnswerId: refusal, userId: 'user-1', headline: 'Nee' })).toBe(false);
    });
  });

  it('chart guard: an answer with no chart never takes a headline', async () => {
    await withDb(async (db) => {
      const chartless = await insertAuditRow(db, { userId: 'user-1', chartEmitted: false });
      expect(await upsertChartHeadline(db, { auditAnswerId: chartless, userId: 'user-1', headline: 'Nee' })).toBe(false);
    });
  });

  it('anonymous rows (null user_id) can never take a headline', async () => {
    await withDb(async (db) => {
      const anon = await insertAuditRow(db, { userId: null });
      expect(await upsertChartHeadline(db, { auditAnswerId: anon, userId: 'user-1', headline: 'Nee' })).toBe(false);
    });
  });

  it('nonexistent audit id → soft false', async () => {
    await withDb(async (db) => {
      expect(await upsertChartHeadline(db, { auditAnswerId: 999999, userId: 'user-1', headline: 'Nee' })).toBe(false);
    });
  });
});

describe('getOwnChartHeadline', () => {
  it('returns null for a chart with no headline yet, and null for a non-owner', async () => {
    await withDb(async (db) => {
      const auditId = await insertAuditRow(db, { userId: 'user-1' });
      expect(await getOwnChartHeadline(db, auditId, 'user-1')).toBeNull();
      await upsertChartHeadline(db, { auditAnswerId: auditId, userId: 'user-1', headline: 'Kop' });
      expect(await getOwnChartHeadline(db, auditId, 'user-2')).toBeNull();
    });
  });
});

describe('getChartHeadlinePublic', () => {
  it('returns the headline with no ownership check (embed-page use: the signed token already proved access)', async () => {
    await withDb(async (db) => {
      const auditId = await insertAuditRow(db, { userId: 'user-1' });
      expect(await getChartHeadlinePublic(db, auditId)).toBeNull();
      await upsertChartHeadline(db, { auditAnswerId: auditId, userId: 'user-1', headline: 'Publieke kop' });
      expect(await getChartHeadlinePublic(db, auditId)).toBe('Publieke kop');
    });
  });
});

describe('pre-migration window', () => {
  it('every function degrades gracefully when chart_headlines does not exist', async () => {
    await withDb(async (db) => {
      const auditId = await insertAuditRow(db, { userId: 'user-1' });
      await db.query('drop table chart_headlines');
      expect(await upsertChartHeadline(db, { auditAnswerId: auditId, userId: 'user-1', headline: 'Kop' })).toBe(false);
      expect(await getOwnChartHeadline(db, auditId, 'user-1')).toBeNull();
      expect(await getChartHeadlinePublic(db, auditId)).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/chart/headline-store.test.ts`
Expected: FAIL — `src/chart/headline-store.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/chart/headline-store.ts
// Journalist chart-headline store (session 105,
// docs/superpowers/specs/2026-09-16-chart-journalist-headline-design.md).
// FILE-ONLY until the owner-supervised apply of migration 031 — every
// function here degrades gracefully (checked via to_regclass, never a
// try/catch masking real errors) when the table doesn't exist yet, mirroring
// src/chart/user-styles.ts's stated contract.
//
// The write's ownership + kind + chart-presence guard lives IN the SQL
// itself (mirrors src/answer/audit/feedback.ts's upsertAnswerFeedback): a
// row can only come into existence from a select over the caller's OWN,
// USER-tagged, chart-bearing ANSWER row. Zero rows returned = the guard did
// not match — reported as a soft `false`, never an error.
import type { Db } from '../db/types.ts';

export const CHART_HEADLINE_MAX_LENGTH = 140;

export function normalizeHeadlineText(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, CHART_HEADLINE_MAX_LENGTH);
}

async function tableExists(db: Db): Promise<boolean> {
  const { rows } = await db.query(`select to_regclass('public.chart_headlines') as t`);
  return rows[0]?.t != null;
}

export interface UpsertChartHeadlineInput {
  auditAnswerId: number;
  userId: string;
  headline: string;
}

export async function upsertChartHeadline(db: Db, input: UpsertChartHeadlineInput): Promise<boolean> {
  if (!(await tableExists(db))) return false;
  const { rows } = await db.query(
    `insert into chart_headlines (audit_answer_id, headline)
     select a.id, $2::text
       from audit_answers a
      where a.id = $1
        and a.user_id = $3
        and a.kind = 'answer'
        and a.chart_emitted
     on conflict (audit_answer_id) do update
       set headline = excluded.headline, updated_at = now()
     returning audit_answer_id`,
    [input.auditAnswerId, input.headline, input.userId],
  );
  return rows.length > 0;
}

export async function getOwnChartHeadline(db: Db, auditAnswerId: number, userId: string): Promise<string | null> {
  if (!(await tableExists(db))) return null;
  const { rows } = await db.query(
    `select h.headline
       from chart_headlines h
       join audit_answers a on a.id = h.audit_answer_id
      where h.audit_answer_id = $1
        and a.user_id = $2`,
    [auditAnswerId, userId],
  );
  return rows.length > 0 ? (rows[0]!.headline as string) : null;
}

/** No ownership check — used only from the public /embed/[token] route,
 * whose signed token (verifyEmbedToken) has already proven the caller may
 * see this specific audit row's chart. */
export async function getChartHeadlinePublic(db: Db, auditAnswerId: number): Promise<string | null> {
  if (!(await tableExists(db))) return null;
  const { rows } = await db.query(`select headline from chart_headlines where audit_answer_id = $1`, [auditAnswerId]);
  return rows.length > 0 ? (rows[0]!.headline as string) : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/chart/headline-store.test.ts`
Expected: PASS (all cases)

- [ ] **Step 5: Commit**

```bash
git add src/chart/headline-store.ts tests/chart/headline-store.test.ts
git commit -m "feat: chart headline store with SQL-guarded ownership"
```

---

## Task 3: Headline drafting (reuses the Insights honesty mechanism)

**Files:**
- Create: `src/chart/headline-phrase.ts`
- Test: `tests/chart/headline-phrase.test.ts`

**Interfaces:**
- Consumes: `scoreFindings(spec)` and `ScoredFinding` (`src/chart/insights.ts`); `composeInsights(findings, options)` and `ComposeInsightsOptions`/`LlmUsage` (`src/chart/insights-phrase.ts`).
- Produces: `export async function draftHeadline(spec: ChartSpec, options: ComposeInsightsOptions): Promise<DraftHeadlineResult>;` where
  ```ts
  export type DraftHeadlineResult =
    | { ok: true; headline: string }
    | { ok: false; reason: 'no_findings' | 'phrasing_failed' };
  ```

**Design note:** rather than inventing a second LLM prompt/schema, this reuses `composeInsights` directly on the chart's single top-ranked finding (`scoreFindings(spec)[0]`) — the exact same zero-digit slot-filling mechanism, same validation, same fail-closed behavior. This is MORE reuse than the spec's original framing ("mirrors the mechanism") anticipated, and is a strict simplification: no new prompt, no new Zod schema, no new retry ladder to maintain.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/chart/headline-phrase.test.ts
import { describe, expect, it, vi } from 'vitest';
import { draftHeadline } from '../../src/chart/headline-phrase.ts';
import type { ChartSpec } from '../../src/chart/types.ts';

const SPEC: ChartSpec = {
  kind: 'line',
  title: 'Werkloosheidspercentage',
  unit: '%',
  series: [
    {
      key: 's0',
      label: 'Werkloosheidspercentage',
      points: [
        { resultId: 'r1', periodCode: '2026MM01', periodLabel: 'januari 2026', value: 3.1, formattedValue: '3,1', provisional: false },
        { resultId: 'r2', periodCode: '2026MM02', periodLabel: 'februari 2026', value: 4.2, formattedValue: '4,2', provisional: false },
      ],
    },
  ],
} as unknown as ChartSpec;

const EMPTY_SPEC: ChartSpec = { ...SPEC, series: [{ ...SPEC.series[0]!, points: [] }] } as unknown as ChartSpec;

describe('draftHeadline', () => {
  it('returns ok:false, reason: no_findings for a spec with no findings', async () => {
    const result = await draftHeadline(EMPTY_SPEC, { client: { call: vi.fn() } as never });
    expect(result).toEqual({ ok: false, reason: 'no_findings' });
  });

  it('drafts a headline from the single top finding’s AI phrase', async () => {
    const fakeClient = {
      call: vi.fn().mockResolvedValue({
        content: JSON.stringify({ insights: [{ id: expect.any(String) as unknown as string, text: 'Sterke stijging naar {waarde-jumpUp-s0-2026MM02} in {periode-jumpUp-s0-2026MM02}' }] }),
        usage: { inputTokens: 10, outputTokens: 10 },
      }),
    };
    const result = await draftHeadline(SPEC, { client: fakeClient as never });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.headline).toContain('4,2');
      expect(result.headline).toContain('februari 2026');
    }
  });

  it('returns ok:false, reason: phrasing_failed when the AI phrase never validates', async () => {
    const fakeClient = {
      call: vi.fn().mockResolvedValue({
        content: JSON.stringify({ insights: [] }),
        usage: { inputTokens: 10, outputTokens: 10 },
      }),
    };
    const result = await draftHeadline(SPEC, { client: fakeClient as never });
    expect(result).toEqual({ ok: false, reason: 'phrasing_failed' });
  });
});
```

**Note for the implementer:** the exact shape of the fake `LlmClient`'s `call` response (property names `content`/`usage` vs. something else) MUST be checked against the real `LlmCallOptions`/`LlmRequest` types in `src/answer/llm/client.ts` and against how `tests/chart/insights-phrase.test.ts` (if it exists) mocks the client — grep for it first (`grep -rn "insights-phrase" tests/`) and copy that exact mocking pattern rather than guessing the response shape, since `composeInsights` is being called through unchanged here.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/chart/headline-phrase.test.ts`
Expected: FAIL — `src/chart/headline-phrase.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/chart/headline-phrase.ts
// Journalist chart-headline drafting (session 105,
// docs/superpowers/specs/2026-09-16-chart-journalist-headline-design.md).
// Deliberately NOT a new LLM mechanism: this is a thin wrapper around the
// SAME digit-free slot-filling mechanism ADR 041 already proved for Insights
// (src/chart/insights-phrase.ts's composeInsights) — a fabricated number
// stays structurally unrepresentable here for exactly the same reason it
// does there. Only the chart's single top-ranked finding (scoreFindings's
// own ranking, unchanged) is phrased, since a headline is one sentence
// about the chart's most notable point, not a per-finding list.
import { scoreFindings } from './insights.ts';
import { composeInsights, type ComposeInsightsOptions } from './insights-phrase.ts';
import type { ChartSpec } from './types.ts';

export type DraftHeadlineResult =
  | { ok: true; headline: string }
  | { ok: false; reason: 'no_findings' | 'phrasing_failed' };

export async function draftHeadline(spec: ChartSpec, options: ComposeInsightsOptions): Promise<DraftHeadlineResult> {
  const findings = scoreFindings(spec);
  if (findings.length === 0) return { ok: false, reason: 'no_findings' };

  const top = findings[0]!;
  const result = await composeInsights([top], options);
  const phrase = result.phrased.get(top.id);
  if (phrase === undefined) return { ok: false, reason: 'phrasing_failed' };
  return { ok: true, headline: phrase };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/chart/headline-phrase.test.ts`
Expected: PASS

If the mock shape from Step 1 was wrong (the real `LlmClient`/`composeInsights` interface differs), fix the test's mock to match the real interface found in Step 1's grep, then re-run.

- [ ] **Step 5: Commit**

```bash
git add src/chart/headline-phrase.ts tests/chart/headline-phrase.test.ts
git commit -m "feat: headline drafting via the existing Insights phrasing mechanism"
```

---

## Task 4: Server actions

**Files:**
- Create: `web/app/chart-headline-actions.ts`
- Test: `web/app/chart-headline-actions.test.ts`

**Interfaces:**
- Consumes: `draftHeadline` (Task 3), `upsertChartHeadline`/`getOwnChartHeadline`/`normalizeHeadlineText`/`CHART_HEADLINE_MAX_LENGTH` (Task 2), `currentUserId` (`web/lib/current-user.ts`), `getDb` (`web/lib/db.ts`), `chartSpecSchema` (`web/backend/chart/schema.ts`, per the `web/backend` symlink to `src`), `AnthropicLlmClient` (`web/backend/answer/llm/client.ts`), `reportError` (`web/lib/error-report.ts`).
- Produces:
  ```ts
  export type DraftChartHeadlineResponse =
    | { ok: true; headline: string }
    | { ok: false; reason: 'unauthenticated' | 'invalid_spec' | 'no_findings' | 'error' };
  export async function draftChartHeadline(rawSpec: unknown): Promise<DraftChartHeadlineResponse>;

  export type SaveChartHeadlineResponse = { ok: boolean };
  export async function saveChartHeadline(rawAuditId: unknown, rawHeadline: unknown): Promise<SaveChartHeadlineResponse>;

  export type FetchChartHeadlineResponse = { ok: true; headline: string | null } | { ok: false };
  export async function fetchChartHeadline(rawAuditId: unknown): Promise<FetchChartHeadlineResponse>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// web/app/chart-headline-actions.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/current-user.ts', () => ({ currentUserId: vi.fn() }));
vi.mock('../lib/db.ts', () => ({ getDb: vi.fn() }));
vi.mock('../backend/chart/headline-phrase.ts', () => ({ draftHeadline: vi.fn() }));
vi.mock('../backend/chart/headline-store.ts', () => ({
  upsertChartHeadline: vi.fn(),
  getOwnChartHeadline: vi.fn(),
  normalizeHeadlineText: (v: unknown) => (typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, 140) : null),
  CHART_HEADLINE_MAX_LENGTH: 140,
}));

import { currentUserId } from '../lib/current-user.ts';
import { draftHeadline } from '../backend/chart/headline-phrase.ts';
import { upsertChartHeadline, getOwnChartHeadline } from '../backend/chart/headline-store.ts';
import { draftChartHeadline, saveChartHeadline, fetchChartHeadline } from './chart-headline-actions.ts';

describe('draftChartHeadline', () => {
  it('returns unauthenticated when no user', async () => {
    vi.mocked(currentUserId).mockResolvedValue(null);
    const result = await draftChartHeadline({ kind: 'line' });
    expect(result).toEqual({ ok: false, reason: 'unauthenticated' });
  });

  it('returns invalid_spec for a malformed spec', async () => {
    vi.mocked(currentUserId).mockResolvedValue('user-1');
    const result = await draftChartHeadline({ not: 'a spec' });
    expect(result).toEqual({ ok: false, reason: 'invalid_spec' });
  });
});

describe('saveChartHeadline', () => {
  it('rejects an unauthenticated caller', async () => {
    vi.mocked(currentUserId).mockResolvedValue(null);
    expect(await saveChartHeadline(1, 'Kop')).toEqual({ ok: false });
  });

  it('rejects a malformed auditId', async () => {
    vi.mocked(currentUserId).mockResolvedValue('user-1');
    expect(await saveChartHeadline('not-a-number', 'Kop')).toEqual({ ok: false });
  });

  it('rejects headline text over the max length', async () => {
    vi.mocked(currentUserId).mockResolvedValue('user-1');
    expect(await saveChartHeadline(1, 'x'.repeat(500))).toEqual({ ok: false });
  });

  it('calls the store with the normalized headline for a valid request', async () => {
    vi.mocked(currentUserId).mockResolvedValue('user-1');
    vi.mocked(upsertChartHeadline).mockResolvedValue(true);
    const result = await saveChartHeadline(1, '  Werkloosheid daalt  ');
    expect(result).toEqual({ ok: true });
    expect(upsertChartHeadline).toHaveBeenCalledWith(expect.anything(), {
      auditAnswerId: 1,
      userId: 'user-1',
      headline: 'Werkloosheid daalt',
    });
  });
});

describe('fetchChartHeadline', () => {
  it('rejects an unauthenticated caller', async () => {
    vi.mocked(currentUserId).mockResolvedValue(null);
    expect(await fetchChartHeadline(1)).toEqual({ ok: false });
  });

  it('returns the stored headline (or null) for the caller’s own chart', async () => {
    vi.mocked(currentUserId).mockResolvedValue('user-1');
    vi.mocked(getOwnChartHeadline).mockResolvedValue('Kop');
    expect(await fetchChartHeadline(1)).toEqual({ ok: true, headline: 'Kop' });
  });
});
```

**Note for the implementer:** confirm the exact mock-friendly module path for backend imports by checking how `web/app/chart-insights-actions.ts` imports `scoreFindings`/`composeInsights` (it uses `'../backend/chart/insights.ts'` per this plan's own Task-3-adjacent research) — the new files this task imports (`headline-phrase.ts`, `headline-store.ts`) live at `src/chart/...` and are reached from `web/app/...` via the SAME `../backend/chart/...` symlink path Insights already uses. Also confirm the existing `web/app/chart-insights-actions.test.ts` (if present) for the actual mocking convention used in this repo (`vi.mock` vs. dependency injection) — copy that pattern exactly rather than the illustrative mocks above if it differs.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run web/app/chart-headline-actions.test.ts`
Expected: FAIL — `web/app/chart-headline-actions.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// web/app/chart-headline-actions.ts
// Journalist chart-headline server actions (session 105,
// docs/superpowers/specs/2026-09-16-chart-journalist-headline-design.md).
// Own tiny file, mirroring chart-insights-actions.ts / chart-style-actions.ts:
// chart.tsx imports only this, never web/app/actions.ts's much larger graph.
'use server';

import { AnthropicLlmClient } from '../backend/answer/llm/client.ts';
import { chartSpecSchema } from '../backend/chart/schema.ts';
import { draftHeadline } from '../backend/chart/headline-phrase.ts';
import {
  CHART_HEADLINE_MAX_LENGTH,
  getOwnChartHeadline,
  normalizeHeadlineText,
  upsertChartHeadline,
} from '../backend/chart/headline-store.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { reportError } from '../lib/error-report.ts';

export type DraftChartHeadlineResponse =
  | { ok: true; headline: string }
  | { ok: false; reason: 'unauthenticated' | 'invalid_spec' | 'no_findings' | 'error' };

export async function draftChartHeadline(rawSpec: unknown): Promise<DraftChartHeadlineResponse> {
  let userId: string | null = null;
  try {
    userId = await currentUserId();
    if (userId === null) return { ok: false, reason: 'unauthenticated' };

    const parsed = chartSpecSchema.safeParse(rawSpec);
    if (!parsed.success) return { ok: false, reason: 'invalid_spec' };

    const result = await draftHeadline(parsed.data, { client: new AnthropicLlmClient() });
    if (!result.ok) return { ok: false, reason: result.reason };
    return { ok: true, headline: result.headline };
  } catch (e) {
    await reportError('draftChartHeadline', e, { userId });
    return { ok: false, reason: 'error' };
  }
}

export interface SaveChartHeadlineResponse {
  ok: boolean;
}

export async function saveChartHeadline(rawAuditId: unknown, rawHeadline: unknown): Promise<SaveChartHeadlineResponse> {
  try {
    const userId = await currentUserId();
    if (userId === null) return { ok: false };
    if (typeof rawAuditId !== 'number' || !Number.isSafeInteger(rawAuditId) || rawAuditId <= 0) {
      return { ok: false };
    }
    if (typeof rawHeadline !== 'string' || rawHeadline.length > CHART_HEADLINE_MAX_LENGTH * 2) {
      // Generous pre-normalize bound so a pasted-with-whitespace string
      // isn't rejected before normalizeHeadlineText gets to trim/cap it;
      // the real cap is enforced below via the normalized value.
      return { ok: false };
    }
    const headline = normalizeHeadlineText(rawHeadline);
    if (headline === null) return { ok: false };

    const ok = await upsertChartHeadline(getDb(), { auditAnswerId: rawAuditId, userId, headline });
    return { ok };
  } catch (e) {
    await reportError('saveChartHeadline', e, {});
    return { ok: false };
  }
}

export type FetchChartHeadlineResponse = { ok: true; headline: string | null } | { ok: false };

export async function fetchChartHeadline(rawAuditId: unknown): Promise<FetchChartHeadlineResponse> {
  try {
    const userId = await currentUserId();
    if (userId === null) return { ok: false };
    if (typeof rawAuditId !== 'number' || !Number.isSafeInteger(rawAuditId) || rawAuditId <= 0) {
      return { ok: false };
    }
    const headline = await getOwnChartHeadline(getDb(), rawAuditId, userId);
    return { ok: true, headline };
  } catch (e) {
    await reportError('fetchChartHeadline', e, {});
    return { ok: false };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run web/app/chart-headline-actions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/app/chart-headline-actions.ts web/app/chart-headline-actions.test.ts
git commit -m "feat: server actions for drafting/saving/fetching chart headlines"
```

---

## Task 5: i18n strings

**Files:**
- Modify: `web/lib/i18n/messages.ts`

**Interfaces:**
- Produces: new `MessageKey`s (both `nl` and `en`, same dotted-key set in both tables — a missing English key is a compile error via `Messages = typeof nl`):
  - `chart.headline.suggest` — button label to draft a headline
  - `chart.headline.edit` — button label to edit an existing headline
  - `chart.headline.placeholder` — text-input placeholder while drafting
  - `chart.headline.save` — save button label
  - `chart.headline.cancel` — cancel button label
  - `chart.headline.drafting` — loading state label
  - `chart.headline.unauthenticated` — shown when draft/save fails auth
  - `chart.headline.error` — generic failure label

- [ ] **Step 1: Add the `nl` entries**

Insert into the `nl` object, near the existing `chart.headline.label` key (the headline-FIGURE key from `chart-headline.ts`, already in this file per Task-research — insert these new sentence-headline keys directly next to it so the two related-but-distinct headline concepts stay visually grouped for a future reader):

```ts
  'chart.headline.suggest': 'Kop voorstellen',
  'chart.headline.edit': 'Kop bewerken',
  'chart.headline.placeholder': 'Typ een kop…',
  'chart.headline.save': 'Opslaan',
  'chart.headline.cancel': 'Annuleren',
  'chart.headline.drafting': 'Bezig met voorstellen…',
  'chart.headline.unauthenticated': 'Log in om een kop toe te voegen.',
  'chart.headline.error': 'Kon de kop niet opslaan.',
```

- [ ] **Step 2: Add the matching `en` entries at the same dotted-key position**

```ts
  'chart.headline.suggest': 'Suggest headline',
  'chart.headline.edit': 'Edit headline',
  'chart.headline.placeholder': 'Type a headline…',
  'chart.headline.save': 'Save',
  'chart.headline.cancel': 'Cancel',
  'chart.headline.drafting': 'Drafting…',
  'chart.headline.unauthenticated': 'Sign in to add a headline.',
  'chart.headline.error': 'Could not save the headline.',
```

- [ ] **Step 3: Typecheck to confirm both tables stay in sync**

Run: `cd web && npx tsc --noEmit`
Expected: no new errors (a key present in `nl` but missing in `en`, or vice versa, fails `Messages = typeof nl` / `MessageKey` checks used by `t()`'s call sites — confirm this is genuinely enforced by re-reading how `MessageKey` is derived, since the earlier research only saw `en` typed AS `Messages`, meaning a missing `en` key IS a compile error but an EXTRA `en` key with no `nl` counterpart may not be caught the same way — if so, double-check by hand that the two key sets match exactly).

- [ ] **Step 4: Commit**

```bash
git add web/lib/i18n/messages.ts
git commit -m "feat: i18n strings for the chart headline UI"
```

---

## Task 6: Chat UI — draft, edit, save, display

**Files:**
- Modify: `web/components/chart.tsx`
- Test: `web/components/chart.test.tsx` (extend the existing file)

**Interfaces:**
- Consumes: `draftChartHeadline`, `saveChartHeadline`, `fetchChartHeadline` (Task 4); `t`, `Lang` (Task 5's keys); existing `embed?: { auditId: number }` prop, existing `signedIn` variable, existing `findings` variable (already computed in `chart.tsx` for Insights — reuse it rather than recomputing `scoreFindings` a second time).
- Produces: a new optional `ChartView` prop, `headlineText?: string | null`, used by the embed page (Task 7) to pass a server-resolved value in; when this prop is `undefined` AND `embed?.auditId` is present (the chat context), `ChartView` manages its own headline state via a lazy fetch-on-mount.

- [ ] **Step 1: Add local state, mirroring the existing `notes` useState pattern**

Near the existing `const [notes, setNotes] = useState<ChartNote[]>([]);` (chart.tsx, confirmed at line 1363 by this plan's research), add:

```tsx
const [chartHeadline, setChartHeadline] = useState<string | null>(headlineText ?? null);
const [headlineEditing, setHeadlineEditing] = useState(false);
const [headlineDraftText, setHeadlineDraftText] = useState('');
const [headlineBusy, setHeadlineBusy] = useState(false);
const [headlineError, setHeadlineError] = useState<string | null>(null);
```

- [ ] **Step 2: Add the lazy-fetch-on-mount effect for the chat context**

Add near the top of the component body, after the existing state declarations:

```tsx
useEffect(() => {
  if (headlineText !== undefined) return; // embed page already resolved it server-side
  if (embed?.auditId === undefined) return;
  let cancelled = false;
  void fetchChartHeadline(embed.auditId).then((result) => {
    if (!cancelled && result.ok) setChartHeadline(result.headline);
  });
  return () => {
    cancelled = true;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per mounted chart, keyed by auditId identity below
}, [embed?.auditId]);
```

**Note for the implementer:** confirm `useEffect` is already imported in `chart.tsx` (near-certain, given the component's size) before adding this — `grep -n "^import.*useEffect" web/components/chart.tsx`.

- [ ] **Step 3: Add the draft/save/cancel handlers**

```tsx
function startHeadlineDraft(): void {
  setHeadlineError(null);
  if (chartHeadline !== null) {
    setHeadlineDraftText(chartHeadline);
    setHeadlineEditing(true);
    return;
  }
  if (!signedIn) {
    setHeadlineError(t(chartLang, 'chart.headline.unauthenticated'));
    return;
  }
  setHeadlineBusy(true);
  void draftChartHeadline(spec).then((result) => {
    setHeadlineBusy(false);
    if (result.ok) {
      setHeadlineDraftText(result.headline);
      setHeadlineEditing(true);
    } else if (result.reason === 'unauthenticated') {
      setHeadlineError(t(chartLang, 'chart.headline.unauthenticated'));
    } else {
      setHeadlineError(t(chartLang, 'chart.headline.error'));
    }
  });
}

function saveHeadlineDraft(): void {
  if (embed?.auditId === undefined) return;
  setHeadlineBusy(true);
  void saveChartHeadline(embed.auditId, headlineDraftText).then((result) => {
    setHeadlineBusy(false);
    if (result.ok) {
      setChartHeadline(headlineDraftText.trim().slice(0, 140));
      setHeadlineEditing(false);
    } else {
      setHeadlineError(t(chartLang, 'chart.headline.error'));
    }
  });
}

function cancelHeadlineDraft(): void {
  setHeadlineEditing(false);
  setHeadlineError(null);
}
```

- [ ] **Step 4: Add the trigger button, next to the existing Story/Style trigger row**

In the same `data-slot="chart-card-actions"` row this plan's research already located (chart.tsx, around the `ChartStoryTrigger`/`ChartConfigTrigger` JSX), add — gated on `embed?.auditId !== undefined` (only chat context; the embed page never shows edit UI) and `findings.length > 0` (mirrors the Insights trigger's own gate: no findings, nothing to draft from):

```tsx
{embed?.auditId !== undefined && findings.length > 0 ? (
  <button
    type="button"
    onClick={startHeadlineDraft}
    disabled={headlineBusy}
    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
  >
    {headlineBusy ? t(chartLang, 'chart.headline.drafting') : t(chartLang, chartHeadline !== null ? 'chart.headline.edit' : 'chart.headline.suggest')}
  </button>
) : null}
```

**Note for the implementer:** the exact Tailwind classes above are a reasonable match to this row's existing sibling buttons but MUST be checked against `ChartStoryTrigger`'s/`ChartConfigTrigger`'s actual rendered classes (read `web/components/chart-story.tsx`'s `ChartStoryTrigger` export) and adjusted to match exactly — visual consistency with the existing row is a real requirement, not a nice-to-have, and copy-pasting a guessed class list would violate it.

- [ ] **Step 5: Add the display + edit-mode JSX**

Near the existing `headlineFigure` display block this plan's research already located (chart.tsx, the `data-testid="headline-figure"` block) — add a SEPARATE block above it (the sentence headline leads; the big-number headline figure follows), reading `chartHeadline`/`headlineEditing` (careful: do not confuse with the existing local variable named `headline` which holds the `headlineFigure` result — this new state is named `chartHeadline` specifically to avoid that collision):

```tsx
{headlineEditing ? (
  <div className="mt-3 flex flex-col gap-2">
    <input
      type="text"
      value={headlineDraftText}
      onChange={(e) => setHeadlineDraftText(e.target.value.slice(0, 140))}
      placeholder={t(chartLang, 'chart.headline.placeholder')}
      maxLength={140}
      className="rounded-md border border-input bg-background px-2 py-1 text-sm"
      autoFocus
    />
    <div className="flex gap-2">
      <button type="button" onClick={saveHeadlineDraft} disabled={headlineBusy} className="text-xs font-medium text-foreground">
        {t(chartLang, 'chart.headline.save')}
      </button>
      <button type="button" onClick={cancelHeadlineDraft} disabled={headlineBusy} className="text-xs text-muted-foreground">
        {t(chartLang, 'chart.headline.cancel')}
      </button>
    </div>
    {headlineError !== null ? <p className="text-xs text-destructive">{headlineError}</p> : null}
  </div>
) : chartHeadline !== null ? (
  <p className="mt-3 text-base font-semibold leading-snug text-foreground" data-testid="chart-headline-text">
    {chartHeadline}
  </p>
) : null}
```

- [ ] **Step 6: Add the imports**

At the top of `chart.tsx`, next to the existing `import { generateInsights } from '../app/chart-insights-actions.ts';`:

```tsx
import { draftChartHeadline, fetchChartHeadline, saveChartHeadline } from '../app/chart-headline-actions.ts';
```

- [ ] **Step 7: Add `headlineText` to the `ChartView` props type**

In the destructured props list and its type (chart.tsx, the exact block this plan's research already quoted in full), add `headlineText` alongside the existing `embed`/`embedMode` props:

```tsx
export function ChartView({
  spec,
  frameless = false,
  embed,
  embedMode = false,
  embedFooter,
  headlineText,
  initialFormOverride,
  stage,
  initialPresentation,
  initialPanel,
}: {
  spec: ChartSpec;
  frameless?: boolean;
  embed?: { auditId: number };
  embedMode?: boolean;
  embedFooter?: string;
  /** A server-resolved headline (embed page). `undefined` (chat context)
   * means "not yet known" — ChartView fetches it lazily via
   * fetchChartHeadline when `embed.auditId` is present. */
  headlineText?: string | null;
  initialFormOverride?: ChartForm;
  stage?: ChartStageMode;
  initialPresentation?: PresentationOverrides;
  initialPanel?: 'story';
}) {
```

- [ ] **Step 8: Write a component test**

`web/components/chart.test.tsx` is already 2,800+ lines (confirmed this session) — per this plan's file-structure guidance, add the new cases in a NEW adjacent file instead of growing the existing one further:

```tsx
// web/components/chart-headline-ui.test.tsx
//
// Mocking/render conventions copied verbatim from chart.test.tsx (confirmed
// this session, not guessed): `vi.hoisted` + `vi.mock` for a Server Action
// module chart.tsx imports directly (mirrors chartInsightsActions there);
// `render(<ChartView spec={...} />)` bare = signedIn false (the
// ChartStyleContext default, web/lib/chart-style-context.tsx:32); wrapping
// in `<ChartStyleProvider initial={{}}>...</ChartStyleProvider>` = signedIn
// true (same file, line 50). `twoSeriesLineSpec()`'s own fixture builder is
// re-declared here rather than imported, since chart.test.tsx does not
// export its fixtures — keep the shape (2 series, several points each) so
// scoreFindings(spec) returns at least one finding.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartStyleProvider } from '../lib/chart-style-context.tsx';
import type { ChartSpec } from '../backend/chart/types.ts';

const chartHeadlineActions = vi.hoisted(() => ({
  draftChartHeadline: vi.fn(),
  saveChartHeadline: vi.fn(),
  fetchChartHeadline: vi.fn().mockResolvedValue({ ok: true, headline: null }),
}));
vi.mock('../app/chart-headline-actions.ts', () => chartHeadlineActions);
const chartInsightsActions = vi.hoisted(() => ({
  generateInsights: vi.fn().mockResolvedValue({ ok: true, phrased: {} }),
}));
vi.mock('../app/chart-insights-actions.ts', () => chartInsightsActions);
const chartStyleActions = vi.hoisted(() => ({
  saveMyChartStyle: vi.fn(),
  forgetMyChartStyle: vi.fn(),
  lookupBrand: vi.fn(),
}));
vi.mock('../app/chart-style-actions.ts', () => chartStyleActions);
const { createEmbedCode } = vi.hoisted(() => ({ createEmbedCode: vi.fn() }));
vi.mock('../app/embed-actions.ts', () => ({ createEmbedCode }));

import { ChartView } from './chart.tsx';

function twoSeriesFindingsSpec(): ChartSpec {
  return {
    kind: 'line',
    title: 'Werkloosheidspercentage',
    unit: '%',
    series: [
      {
        key: 's0',
        label: 'Nederland',
        points: [
          { resultId: 'nl-2024', periodCode: '2024JJ00', periodLabel: '2024', value: 3.1, formattedValue: '3,1', provisional: false },
          { resultId: 'nl-2025', periodCode: '2025JJ00', periodLabel: '2025', value: 5.2, formattedValue: '5,2', provisional: false },
        ],
      },
    ],
  } as unknown as ChartSpec;
}

afterEach(() => {
  cleanup();
  chartHeadlineActions.draftChartHeadline.mockReset();
  chartHeadlineActions.saveChartHeadline.mockReset();
  chartHeadlineActions.fetchChartHeadline.mockReset().mockResolvedValue({ ok: true, headline: null });
});

describe('chart headline — trigger visibility', () => {
  it('shows a "Kop voorstellen" trigger only when embed.auditId is present and findings exist', () => {
    render(<ChartView spec={twoSeriesFindingsSpec()} embed={{ auditId: 1 }} />);
    expect(screen.getByText('Kop voorstellen')).toBeInTheDocument();
  });

  it('shows no trigger without an auditId (e.g. an anonymous/trial chart)', () => {
    render(<ChartView spec={twoSeriesFindingsSpec()} />);
    expect(screen.queryByText('Kop voorstellen')).not.toBeInTheDocument();
  });
});

describe('chart headline — draft, edit, save', () => {
  it('drafts via the mocked action, lets the user edit the draft, and saves it', async () => {
    chartHeadlineActions.draftChartHeadline.mockResolvedValue({ ok: true, headline: 'Werkloosheid stijgt scherp' });
    chartHeadlineActions.saveChartHeadline.mockResolvedValue({ ok: true });
    render(
      <ChartStyleProvider initial={{}}>
        <ChartView spec={twoSeriesFindingsSpec()} embed={{ auditId: 1 }} />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByText('Kop voorstellen'));
    await screen.findByDisplayValue('Werkloosheid stijgt scherp');
    fireEvent.change(screen.getByDisplayValue('Werkloosheid stijgt scherp'), { target: { value: 'Werkloosheid stijgt fors' } });
    fireEvent.click(screen.getByText('Opslaan'));
    await screen.findByTestId('chart-headline-text');
    expect(screen.getByTestId('chart-headline-text')).toHaveTextContent('Werkloosheid stijgt fors');
    expect(chartHeadlineActions.saveChartHeadline).toHaveBeenCalledWith(1, 'Werkloosheid stijgt fors');
  });

  it('shows the unauthenticated message when drafting while signed out', () => {
    render(<ChartView spec={twoSeriesFindingsSpec()} embed={{ auditId: 1 }} />);
    fireEvent.click(screen.getByText('Kop voorstellen'));
    expect(screen.getByText('Log in om een kop toe te voegen.')).toBeInTheDocument();
    expect(chartHeadlineActions.draftChartHeadline).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 9: Run the test to verify it fails, then implement, then verify it passes**

Run: `cd web && npx vitest run components/chart-headline-ui.test.tsx`
Expected: FAIL first (`chart-headline-actions.ts` doesn't exist as an importable mock target / `chart.tsx` has no headline UI yet), then PASS once Steps 1-7's implementation is in place. If any assertion text (button labels, `data-testid`) doesn't match what Steps 3-5 actually rendered, fix the mismatch in whichever side is wrong — the i18n strings from Task 5 are the source of truth for the exact button text.

- [ ] **Step 10: Run the full existing chart.tsx test suite to confirm no regression**

Run: `cd web && npx vitest run components/chart.test.tsx`
Expected: PASS (every prior test, e.g. Story/Insights/Notes, still passes — the new state/props are additive)

- [ ] **Step 11: Commit**

```bash
git add web/components/chart.tsx web/components/chart.test.tsx
git commit -m "feat: draft/edit/save/display a chart headline in the chat UI"
```

---

## Task 7: Embed page display

**Files:**
- Modify: `web/app/embed/[token]/page.tsx`

**Interfaces:**
- Consumes: `getChartHeadlinePublic` (Task 2), `auditId` (already computed in the page from `verifyEmbedToken`), `getDb` (already imported).
- Produces: `<ChartView headlineText={...} .../>` with a resolved `string | null` (never `undefined` — the embed page always knows).

- [ ] **Step 1: Import the store function**

Add to the page's existing import block:

```tsx
import { getChartHeadlinePublic } from '../../../backend/chart/headline-store.ts';
```

- [ ] **Step 2: Fetch the headline alongside the existing audit-record load**

Near where `loadAuditRecord(getDb(), auditId)` already runs (this plan's research confirmed lines 136-140), add:

```tsx
const headlineText = await getChartHeadlinePublic(getDb(), auditId);
```

- [ ] **Step 3: Pass it into the existing `ChartView` call**

Modify the exact call site this plan's research already quoted:

```tsx
const chartView = (
  <ChartView
    spec={finalSpec}
    frameless
    embedMode
    embedFooter={finalFooter}
    initialFormOverride={formOverride}
    headlineText={headlineText}
  />
);
```

- [ ] **Step 4: Extend the embed page's existing test file**

This file mocks every dependency via `vi.hoisted` + `vi.mock` (confirmed this session) — it does NOT hit a real database, so the new test mocks `getChartHeadlinePublic` the same way `loadAuditRecord`/`hasProPlan`/`rerunLive` are already mocked, rather than seeding any row. Add near the top, alongside the existing hoisted mocks:

```tsx
const { getChartHeadlinePublic } = vi.hoisted(() => ({ getChartHeadlinePublic: vi.fn(async () => null as string | null) }));
vi.mock('../../../backend/chart/headline-store.ts', () => ({ getChartHeadlinePublic }));
```

Then add a new `describe` block (using this file's own `answerRecord()`/`chartSpec()`/`params()`/`search()` fixture builders, confirmed present in the file, rather than inventing new ones):

```tsx
describe('/embed/[token] — journalist headline', () => {
  afterEach(() => {
    cleanup();
    getChartHeadlinePublic.mockReset().mockResolvedValue(null);
  });

  it('renders the stored headline when one exists', async () => {
    verifyEmbedToken.mockReturnValue(1);
    loadAuditRecord.mockResolvedValue(answerRecord());
    getChartHeadlinePublic.mockResolvedValue('Werkloosheid stijgt scherp');
    render(await EmbedPage({ params: params('tok'), searchParams: search() }));
    expect(screen.getByText('Werkloosheid stijgt scherp')).toBeInTheDocument();
  });

  it('renders no headline text when none is stored', async () => {
    verifyEmbedToken.mockReturnValue(1);
    loadAuditRecord.mockResolvedValue(answerRecord());
    getChartHeadlinePublic.mockResolvedValue(null);
    render(await EmbedPage({ params: params('tok'), searchParams: search() }));
    expect(screen.queryByTestId('chart-headline-text')).not.toBeInTheDocument();
  });
});
```

**Note for the implementer:** confirm `params()`/`search()`/`answerRecord()`'s exact call signatures against the file itself before use (this session confirmed their names and general shape, at lines 58-129, but not every default field) — adjust the calls above only if they don't compile as shown, the intent (render the page with a valid token and a real-shaped audit record) stays the same either way.

- [ ] **Step 5: Run the test to verify it fails, then passes**

Run: `cd web && npx vitest run "app/embed/[token]/page.test.tsx"`
Expected: FAIL first (`../../../backend/chart/headline-store.ts` mock target doesn't exist as a real module yet / the page doesn't call it), PASS after Steps 1-3 and after Task 2 (`headline-store.ts`) exists.

- [ ] **Step 6: Commit**

```bash
git add "web/app/embed/[token]/page.tsx" "web/app/embed/[token]/page.test.tsx"
git commit -m "feat: show the journalist headline on the public embed page"
```

---

## Task 8: PNG/SVG export

**Files:**
- Modify: `web/components/chart-download.tsx`
- Test: `web/components/chart-download.test.tsx` (extend the existing file)

**Interfaces:**
- Consumes: nothing new from earlier tasks (the headline text the export draws is whatever text is ALREADY on screen in the `ChartView` instance the download menu is attached to — the export never fetches anything itself, matching the existing "serialize what's rendered" guarantee).
- Produces: `attributedSvgMarkup`/`framedSvgMarkup`/`ChartDownloadMenu` all gain an optional `headlineText?: string | null` parameter/prop, threaded through to `buildAttributedClone`.

- [ ] **Step 1: Read the full current `buildAttributedClone`, `framedSvgMarkup`, `attributedSvgMarkup`, and `ChartDownloadMenu` signatures**

Run: `grep -n "^function\|^export function\|^export const" web/components/chart-download.tsx`

Confirm the exact current parameter lists before modifying (this plan's own research captured `buildAttributedClone(svg, attributionText, resolvePaint, paintWhiteBg = true)`, `framedSvgMarkup(svg, attributionText, resolvePaint?, frame?)`, `attributedSvgMarkup(svg, attributionText, resolvePaint?, frame?)`, and `ChartDownloadMenu({ containerRef, attributionText, filenameBase, lang, frame, frameImage })` — re-verify against the live file since chart-card-polish (session 103) may have touched line numbers since this plan was written).

- [ ] **Step 2: Write the failing test**

Add to `web/components/chart-download.test.tsx`, reusing its existing `sampleSvg()` fixture (confirmed this session at line 25) and `framedSvgMarkup`'s real return shape (`{ markup: string; canvasFill: string }`, confirmed against an existing call at line 634 — NOT a bare string):

```tsx
describe('headline in exports', () => {
  it('draws the headline as a title line above the footer, growing totalHeight to make room', () => {
    const withoutHeadline = framedSvgMarkup(sampleSvg(), 'CBS · 2026-01-01');
    const withHeadline = framedSvgMarkup(sampleSvg(), 'CBS · 2026-01-01', undefined, undefined, 'Werkloosheid stijgt scherp');
    expect(withHeadline.markup).toContain('Werkloosheid stijgt scherp');
    expect(withHeadline.markup).toContain('data-headline-line');
    // The headline variant's total height must exceed the no-headline
    // variant's — room was actually added, not just text overlaid on
    // existing space. Both markups carry their outer <svg height="...">
    // attribute; compare those rather than assuming a fixed pixel delta.
    const heightOf = (markup: string): number => Number(markup.match(/^<svg[^>]*\sheight="(\d+(?:\.\d+)?)"/)![1]);
    expect(heightOf(withHeadline.markup)).toBeGreaterThan(heightOf(withoutHeadline.markup));
  });

  it('omits the headline line entirely when headlineText is null/undefined', () => {
    const markup = framedSvgMarkup(sampleSvg(), 'CBS · 2026-01-01', undefined, undefined, null).markup;
    expect(markup).not.toContain('data-headline-line');
  });
});
```

**Note for the implementer:** `framedSvgMarkup`'s 4th parameter is `frame` (an optional `FrameExportInput`) — the new `headlineText` argument is the 5th, added by this task's Step 4. Passing `undefined` for `frame` in the calls above (as several existing tests in this file already do, e.g. line 634's `framedSvgMarkup(sampleSvg(), 'attributie', undefined, frame)` pattern) is correct and matches existing usage.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd web && npx vitest run components/chart-download.test.tsx`
Expected: FAIL — the new 5th parameter doesn't exist on `framedSvgMarkup` yet.

- [ ] **Step 4: Thread `headlineText` through the four functions**

`buildAttributedClone` gains a new parameter and, when `headlineText` is non-null, draws it as its own `<text>` element ABOVE the chart content, growing `totalHeight` by one line's worth (reusing the existing `wrapAttributionText`/`FOOTER_LINE_HEIGHT` machinery, drawn at the TOP margin rather than the bottom) and shifting the chart clone's own translate-Y down by that same amount so nothing overlaps — mirror exactly how `buildFrame`'s `contentY` already shifts content down for frame padding (read that function first, since this is the one place in the file that already solves "reserve space at the top and shift content," and the headline line should reuse the identical technique rather than inventing a second one):

```ts
function buildAttributedClone(
  svg: SVGSVGElement,
  attributionText: string,
  resolvePaint: PaintResolver,
  paintWhiteBg = true,
  headlineText?: string | null,
): { clone: SVGSVGElement; width: number; totalHeight: number } {
  // ... existing body up to where totalHeight/footerLines are computed, UNCHANGED ...

  const HEADLINE_TOP_MARGIN = 32; // one line of headline text + breathing room
  const headlineLines = headlineText ? wrapAttributionText(headlineText, width - FOOTER_TEXT_MARGIN_X * 2) : [];
  const headlineHeight = headlineLines.length > 0 ? HEADLINE_TOP_MARGIN : 0;

  // Shift the existing chart-content group down by headlineHeight before
  // this function's own footer-drawing code runs, using the SAME
  // translate-adjustment technique buildFrame's contentY already uses for
  // its own top padding (read buildFrame first and copy its exact
  // transform-attribute mutation approach here, rather than introducing a
  // second way to shift SVG content).

  if (headlineLines.length > 0) {
    headlineLines.forEach((line, i) => {
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', String(FOOTER_TEXT_MARGIN_X));
      text.setAttribute('y', String(20 + i * FOOTER_LINE_HEIGHT));
      text.setAttribute('font-family', FOOTER_FONT);
      text.setAttribute('font-size', '15');
      text.setAttribute('font-weight', '600');
      text.setAttribute('fill', '#18181b');
      text.setAttribute('data-headline-line', 'true');
      text.textContent = line;
      clone.appendChild(text);
    });
  }

  // ... existing totalHeight/footer-drawing body, UNCHANGED, but totalHeight
  // must now also account for headlineHeight in its own computation ...
}
```

**Note for the implementer:** the snippet above shows the NEW logic precisely, but where exactly to splice it into the existing function body (relative to the current `totalHeight`/`footerLines` computation and the SVG-content-translate step) requires reading the function's full current body first (Step 1) — this is a real content shift into existing, working code, not an append-only change, so get the ordering right: compute `headlineHeight` before `totalHeight`, include it in `totalHeight`, shift chart content down by it, THEN draw the footer (unchanged) and the headline lines.

Thread `headlineText` as a new optional parameter through `framedSvgMarkup`, `attributedSvgMarkup`, and `ChartDownloadMenu`'s props, each simply forwarding it to the next function down the chain, ending at `buildAttributedClone`.

- [ ] **Step 5: Wire `ChartDownloadMenu`'s new prop from `chart.tsx`**

In `chart.tsx`, wherever `<ChartDownloadMenu` is currently rendered (grep `ChartDownloadMenu` in `chart.tsx` to find the call site), add `headlineText={chartHeadline}` (the state from Task 6).

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd web && npx vitest run components/chart-download.test.tsx`
Expected: PASS

- [ ] **Step 7: Run the full chart-download test suite to confirm no regression**

Run: `cd web && npx vitest run components/chart-download.test.tsx`
Expected: PASS (every prior export test — plain PNG, SVG, framed, attribution wrapping — still passes since `headlineText` is optional and defaults to no-op)

- [ ] **Step 8: Commit**

```bash
git add web/components/chart-download.tsx web/components/chart-download.test.tsx web/components/chart.tsx
git commit -m "feat: draw the journalist headline into PNG/SVG exports"
```

---

## Final verification (run once, after all 8 tasks)

- [ ] Root: `npm ci && npm run typecheck && npm test` (all backend suites) — expect green, including the new `tests/audit/retention-chart-headlines.test.ts`, `tests/chart/headline-store.test.ts`, `tests/chart/headline-phrase.test.ts`.
- [ ] Web: `cd web && npm ci && npx tsc --noEmit && npm test` — expect green, including the new/extended chart.tsx, embed page, and chart-download tests.
- [ ] `npm run benchmark:run && npm run benchmark:score` — expect 14/14 answerable, 6/6 refusal, 0 fabricated (this feature touches no answer-pipeline code, so the benchmark should be unaffected — a regression here would mean something leaked into `src/answer/compose/` unexpectedly).
- [ ] `cd web && npx next build` — expect a real, successful build.
- [ ] Run `/code-review` at LOW effort over the full diff (CLAUDE.md's mandatory pre-push gate) — fix or consciously dispatch every confirmed finding.
- [ ] Update `docs/STATUS.md`'s top block, `docs/08-build-plan.md`, and write the ADR this feature's design decisions earn (CLAUDE.md: "every load-bearing technical choice gets an ADR") — done by the implementing/wrap-up session per CLAUDE.md's definition-of-done, not deferred.
- [ ] Confirm migration 031 is applied in the owner-supervised step before this ships live (it is FILE-ONLY until then — deploying the code without the migration must not break prod, per Task 1/2's degrade-gracefully contract; verify this by running the full suite once with `migrations/031_chart_headlines.sql` temporarily removed from the test DB's migration set, confirming no test outside the two new `pre-migration window` cases fails).
