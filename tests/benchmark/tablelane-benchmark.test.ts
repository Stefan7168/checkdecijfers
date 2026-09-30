// ADR 062 step 6 — the table-lane benchmark's CI guard.
//
// 1. The frozen definition: task file + answer key are well-formed, every
//    table is outside the curated set, every question is held out from the
//    calibration set, and the answer key equals the committed CBS snapshot.
// 2. The canned run (always): the REAL table-lane path over the snapshot with
//    each task's expected parse as the model's output. Proves harness,
//    snapshot and key agree, and that the benchmark's parse requests are
//    exactly the ones the supervised recording run records — so tonight's one
//    recording covers the benchmark.
// 3. The replay run (once tests/fixtures/llm/tableparse/ exists — i.e. after
//    the owner-supervised `tableparse:record` run): the same path over the
//    RECORDED model outputs. A missing fixture fails loudly (never a skip,
//    never a refusal that only looks like one); invented numbers fail always;
//    the full gate fails CI only once the task file says `enforcedInCi`.
//
// Hermetic: PGlite + committed fixtures. No network, no API key, no spend.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RecordingLlmClient, requestHash } from '../../src/answer/llm/client.ts';
import {
  loadLabelledSet,
  caseParseInput,
  benchmarkRequests,
  BENCH_LABEL_PREFIX,
} from '../../scripts/tableparse-eval.ts';
import {
  MissingFixturesError,
  missingBenchFixtures,
  runTableLaneBenchmark,
  TABLEPARSE_FIXTURES_DIR,
} from '../../scripts/run-tablelane-benchmark.ts';
import { definitionProblems, formatScore, scoreTableLaneDump } from '../../scripts/score-tablelane-benchmark.ts';
import {
  CannedParseClient,
  cannedPlans,
  loadTableLaneKey,
  loadTableLaneTasks,
  taskParseRequest,
} from '../../scripts/tablelane-bench-lib.ts';
import { loadCellsFixture, loadSchemaFixture, rowMatches } from '../helpers/tablelane-bench-source.ts';

const file = loadTableLaneTasks();
const key = loadTableLaneKey();

/** Findings the benchmark surfaced on its first (canned) run that are NOT
 * harness bugs — real defects in the product path, pinned so the canned run
 * stays green while they are open and fails the moment one is fixed (then
 * remove the entry). Each: task ids + a pattern every problem must match.
 * Empty since #339 item 14 was fixed: L1–L3 (85669NED, unit "miljard kg
 * CO2-equivalent") tripped the R3 word-form check on the unit's own
 * 'miljard'; the checker now exempts an exact, digit-anchored rendering of
 * the result's registered unit (validate.ts blankRegisteredUnitRenderings). */
const KNOWN_CANNED_FINDINGS: { taskIds: string[]; pattern: RegExp; what: string }[] = [];

describe('table-lane benchmark — frozen definition', () => {
  it('is well-formed (ids, types, key entries, gate, curated-table exclusion)', () => {
    expect(definitionProblems(file, key)).toEqual([]);
    expect(file.frozen).toBe(true);
    expect(file.tasks.filter((t) => t.type === 'answer')).toHaveLength(14);
    expect(file.tasks.filter((t) => t.type !== 'answer').length).toBeGreaterThanOrEqual(6);
  });

  it('holds out every question from the calibration (labelled) set — the threshold is never tuned on it', () => {
    const labelled = loadLabelledSet().cases;
    // Same table + same question text (a bare follow-up like "En in 2020?" may
    // recur on ANOTHER table with another previous question — a different read).
    const labelledQuestions = new Set(labelled.map((c) => `${c.table}|${c.question.trim().toLowerCase()}`));
    const labelledTurns = new Set(labelled.map((c) => caseParseInput(c).request.question));
    for (const t of file.tasks) {
      expect(labelledQuestions.has(`${t.table}|${t.question.trim().toLowerCase()}`), `${t.id} repeats a labelled question`).toBe(false);
      expect(labelledTurns.has(taskParseRequest(t).question), `${t.id} shares a labelled request`).toBe(false);
    }
    // Distinct requests per task, so every fixture has exactly one owner.
    expect(new Set(file.tasks.map((t) => requestHash(taskParseRequest(t)))).size).toBe(file.tasks.length);
  });

  it('pins one CBS version per table: the cell snapshot was taken from the schema fixture\'s CBS version', () => {
    for (const tableId of new Set(file.tasks.map((t) => t.table))) {
      const cells = loadCellsFixture(tableId);
      if (cells === null) continue; // a refusal-only table needs no cells
      expect(cells.cbsModified, tableId).toBe(loadSchemaFixture(tableId).schema.modified);
    }
  });

  it('answer key = the committed CBS snapshot, cell for cell', async () => {
    const plans = await cannedPlans(file);
    for (const [taskId, entry] of Object.entries(key.tasks)) {
      const task = file.tasks.find((t) => t.id === taskId)!;
      const plan = plans.find((p) => p.taskId === taskId && p.round === (task.type === 'ask' ? 'reply' : 'first'))!;
      expect(plan.slice, taskId).not.toBeNull();
      const rows = loadCellsFixture(entry.table)!.slices.flatMap((s) => s.rows).filter((r) => rowMatches(r, plan.slice!));
      const snapshot = rows.map((r) => `${r.measure}|${JSON.stringify(Object.entries(r.coordinates).sort())}|${r.value}`);
      expect(new Set(snapshot).size, taskId).toBe(entry.cells.length);
      for (const cell of entry.cells) {
        const hit = rows.find(
          (r) =>
            r.measure === cell.measure &&
            Object.values(r.coordinates).includes(cell.period) &&
            Object.entries(cell.dims).every(([d, c]) => r.coordinates[d] === c) &&
            (cell.region === null || Object.values(r.coordinates).includes(cell.region)),
        );
        expect(hit?.value, `${taskId} ${cell.period}`).toBe(cell.value);
      }
    }
  });
});

describe('table-lane benchmark — canned run (harness, snapshot and key agree)', () => {
  it('runs every task through the real lane; only the pinned findings fail', async () => {
    const dump = await runTableLaneBenchmark({ mode: 'canned', dumpPath: null });
    const score = scoreTableLaneDump(dump, file, key);
    console.log(formatScore(score));

    // The benchmark asks exactly the requests the recording run records.
    const recorded = new Set(benchmarkRequests().map((b) => requestHash(b.request)));
    expect(new Set(dump.parseRequestHashes)).toEqual(recorded);
    expect(benchmarkRequests().every((b) => b.id.startsWith(BENCH_LABEL_PREFIX))).toBe(true);

    expect(score.inventedNumbers).toBe(0);
    for (const run of dump.tasks) expect(run.uncovered, run.id).toEqual([]);
    const known = new Map(KNOWN_CANNED_FINDINGS.flatMap((f) => f.taskIds.map((id) => [id, f] as const)));
    for (const t of score.tasks) {
      const finding = known.get(t.id);
      if (finding === undefined) {
        expect(t.problems, `${t.id} (${t.outcome})`).toEqual([]);
      } else {
        expect(t.pass, `${t.id} now passes — remove it from KNOWN_CANNED_FINDINGS (${finding.what})`).toBe(false);
        for (const p of t.problems) expect(p, t.id).toMatch(finding.pattern);
      }
    }
  });
});

describe('table-lane benchmark — replay machinery (canned outputs recorded to a temp dir, no spend)', () => {
  it('replays recorded fixtures by request hash, and a missing fixture stops the run with the full list', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tablelane-bench-'));
    try {
      // Record the canned outputs exactly like the supervised run records the
      // model's: same RecordingLlmClient, same request builder.
      const recorder = new RecordingLlmClient(new CannedParseClient(file.tasks), dir);
      for (const { request } of benchmarkRequests()) await recorder.complete(request);
      expect(missingBenchFixtures(file.tasks, dir)).toEqual([]);

      const dump = await runTableLaneBenchmark({ mode: 'replay', dumpPath: null, fixturesDir: dir });
      const score = scoreTableLaneDump(dump, file, key);
      expect(score.inventedNumbers).toBe(0);
      expect(score.refuseAsk.pass).toBe(score.refuseAsk.total);

      const victim = requestHash(taskParseRequest(file.tasks[4]!));
      rmSync(join(dir, `${victim}.json`));
      await expect(runTableLaneBenchmark({ mode: 'replay', dumpPath: null, fixturesDir: dir })).rejects.toThrow(
        MissingFixturesError,
      );
      expect(missingBenchFixtures(file.tasks, dir)).toEqual([{ taskId: file.tasks[4]!.id, requestHash: victim }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const fixturesRecorded = existsSync(TABLEPARSE_FIXTURES_DIR);

describe.skipIf(!fixturesRecorded)(
  'table-lane benchmark — replay of the recorded parser (skipped until tests/fixtures/llm/tableparse/ exists; ' +
    'the owner-supervised `TABLEPARSE_RECORD_OK=1 npm run tableparse:record` creates it)',
  () => {
    it('has a recorded fixture for every benchmark task (a missing one fails, never skips)', () => {
      expect(missingBenchFixtures(file.tasks)).toEqual([]);
    });

    it('scores the recorded run: zero invented numbers always; the full gate once enforcedInCi', async () => {
      let dump;
      try {
        dump = await runTableLaneBenchmark({ mode: 'replay', dumpPath: null });
      } catch (error) {
        if (error instanceof MissingFixturesError) throw new Error(error.message);
        throw error;
      }
      const score = scoreTableLaneDump(dump, file, key);
      console.log(formatScore(score));
      expect(score.inventedNumbers).toBe(0);
      if (file.gate.enforcedInCi) expect(score.gatePass, formatScore(score)).toBe(true);
    });
  },
);
