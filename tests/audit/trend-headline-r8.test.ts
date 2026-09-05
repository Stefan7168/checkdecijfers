// C2 (whole-branch review, #197): extends the ADR 014 optional-v1-field R8
// tolerance to the chart spec's new `trendHeadline` field, narrowly. Modeled
// on tests/audit/source-r8.test.ts's WP30a boundary pattern: a NEW row must
// reconstruct cleanly; a row simulating pre-#197 storage (no trendHeadline
// key in the stored attribution at all) must ALSO reconstruct cleanly (the
// fix under test — reconstruct.ts strips the rebuilt spec's trendHeadline
// before comparing when the stored spec never had one); and a row whose
// stored trendHeadline VALUE is corrupted (key present, wrong string) must
// still fail loudly — the tolerance must not widen to cover a genuine
// divergence.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReplayLlmClient } from '../../src/answer/llm/client.ts';
import {
  answerQuestionAudited,
  loadAuditRecord,
  reconstructionReport,
} from '../../src/answer/audit/index.ts';
import type { AuditRecord } from '../../src/answer/audit/index.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { ANSWERABLE_TASKS } from '../helpers/benchmark-intents.ts';
import { loadLabelledSet } from '../helpers/intent-expectations.ts';

const INTENT_FIXTURES = fileURLToPath(new URL('../fixtures/llm/intent', import.meta.url));
const ANSWER_FIXTURES = fileURLToPath(new URL('../fixtures/llm/answer', import.meta.url));
const REFERENCE_DATE = loadLabelledSet().referenceDate;

// B4: series + chart, single national region (docs/02; also used by
// source-r8.test.ts as a chart-bearing probe) — confirmed BY RUNNING this
// suite (not assumed) to register a `direction` derivation and produce a
// chart whose attribution.trendHeadline is set.
const TASK_ID = 'B4' as const;

describe('R8 across the #197 trend-headline boundary (ADR 014 tolerance scoped to trendHeadline)', () => {
  it('a fresh row reconstructs; a pre-#197 row (no trendHeadline key) also reconstructs; a corrupted trendHeadline VALUE still fails loudly', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const audited = await answerQuestionAudited(db, ANSWERABLE_TASKS[TASK_ID]!.question, {
        intentClient: new ReplayLlmClient(INTENT_FIXTURES),
        answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
        referenceDate: REFERENCE_DATE,
      });
      if (audited.response.kind !== 'answer') throw new Error(`${TASK_ID}: expected an answer`);

      // Confirms this fixture actually exercises the boundary under test —
      // a registered direction derivation, and a chart with a set headline —
      // rather than silently testing nothing.
      const direction = audited.response.result.derivations.find((d) => d.kind === 'direction');
      expect(direction).toBeDefined();
      expect(audited.response.chart).not.toBeNull();
      expect(audited.response.chart?.attribution.trendHeadline).toEqual(expect.any(String));

      // 1. The fresh row reconstructs cleanly (the ordinary, non-tolerance path).
      const record = await loadAuditRecord(db, audited.auditId!);
      expect(reconstructionReport(record as AuditRecord).problems).toEqual([]);

      // 2. A pre-#197 stored row — the stored chart spec's attribution has NO
      // trendHeadline key at all, exactly what every row stored before this
      // branch shipped looks like — must ALSO reconstruct. Rebuilding from the
      // same unchanged result now produces a trendHeadline; the fix strips it
      // from the rebuilt side before comparing. Mirrors source-r8.test.ts's
      // `delete (old.response.result.attribution as {...}).source` pattern.
      const preBranch = JSON.parse(JSON.stringify(record)) as AuditRecord;
      if (preBranch.response.kind !== 'answer') throw new Error('unreachable');
      if (preBranch.response.chart === null) throw new Error('unreachable: expected a chart');
      expect('trendHeadline' in preBranch.response.chart.attribution).toBe(true);
      delete preBranch.response.chart.attribution.trendHeadline;
      expect(reconstructionReport(preBranch).problems).toEqual([]);

      // 3. A stored row whose trendHeadline VALUE is corrupted (key present,
      // value wrong) must still fail loudly — the tolerance is scoped to an
      // ABSENT key, never to a present-but-wrong one.
      const corrupted = JSON.parse(JSON.stringify(record)) as AuditRecord;
      if (corrupted.response.kind !== 'answer') throw new Error('unreachable');
      if (corrupted.response.chart === null) throw new Error('unreachable: expected a chart');
      corrupted.response.chart.attribution.trendHeadline = 'Dit is een verzonnen, onjuiste trendzin.';
      const corruptedReport = reconstructionReport(corrupted);
      expect(corruptedReport.problems).not.toEqual([]);
      expect(corruptedReport.problems.some((p) => p.includes('chart spec does not re-derive'))).toBe(true);
    } finally {
      await close();
    }
  }, 180_000);
});
