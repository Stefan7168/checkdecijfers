// Guards the machine-readable benchmark (benchmark/tasks.json) against drifting
// from its source of truth, docs/02-user-scenarios.md. Real scoring is the job of
// scripts/score-benchmark.mjs once the answer key freezes and the pipeline exists.
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface BenchmarkTask {
  id: string;
  type: 'answerable' | 'clarify' | 'refuse';
  question: string;
  expect: string;
  derived?: string;
  chart?: boolean;
  reason?: string;
}

const file = JSON.parse(
  readFileSync(new URL('../../benchmark/tasks.json', import.meta.url), 'utf8'),
) as { schemaVersion: number; frozen: boolean; tasks: BenchmarkTask[] };

describe('benchmark task set mirrors docs/02-user-scenarios.md', () => {
  it('contains exactly B1..B20 in order', () => {
    expect(file.tasks.map((t) => t.id)).toEqual(
      Array.from({ length: 20 }, (_, i) => `B${i + 1}`),
    );
  });

  it('has 14 answerable tasks and 6 refusal/clarification tasks', () => {
    const byType = Object.groupBy(file.tasks, (t) => t.type);
    expect(byType.answerable).toHaveLength(14);
    expect((byType.clarify ?? []).length + (byType.refuse ?? []).length).toBe(6);
    expect(byType.clarify?.map((t) => t.id)).toEqual(['B15', 'B16']);
    expect(byType.refuse?.map((t) => t.id)).toEqual(['B17', 'B18', 'B19', 'B20']);
  });

  it('marks the derived tasks (B13 difference, B14 max) and the chart tasks (B4, B8)', () => {
    const task = (id: string) => file.tasks.find((t) => t.id === id)!;
    expect(task('B13').derived).toBe('difference');
    expect(task('B14').derived).toBe('max');
    expect(task('B4').chart).toBe(true);
    expect(task('B8').chart).toBe(true);
  });

  it('gives every refusal task a specific reason category (scope/forecast/causal/freshness)', () => {
    const reasons = file.tasks.filter((t) => t.type === 'refuse').map((t) => t.reason);
    expect(reasons).toEqual(['scope', 'forecast', 'causal', 'freshness']);
  });

  it('keeps the frozen flag consistent with the answer-key file', () => {
    const keyExists = existsSync(new URL('../../benchmark/answer-key.json', import.meta.url));
    expect(file.frozen).toBe(keyExists);
  });

  it('every task has non-empty Dutch question text', () => {
    for (const t of file.tasks) expect(t.question.trim().length, t.id).toBeGreaterThan(10);
  });
});
