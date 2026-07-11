// Shared checks for a composed benchmark answer — used by both the hermetic
// end-to-end suite (tests/answer/compose-pipeline.test.ts, replayed fixtures)
// and the live eval (scripts/answer-eval.ts), so CI and the live run judge
// answers by literally the same rules. The expected VALUES come from the
// frozen answer key (benchmark/answer-key.json) — never from this file.
import { readFileSync } from 'node:fs';
import { formatValueNl } from '../../src/answer/compose/index.ts';
import type { ComposedAnswer } from '../../src/answer/compose/index.ts';

export interface AnswerKey {
  tasks: Record<string, KeyEntry>;
}

interface KeyEntry {
  /** Source-registry key (WP30a, ADR 030): provenance metadata, default
   * 'cbs'. Not read by the scorer — it exists so WP30c tasks over a second
   * source declare theirs. */
  source?: string;
  shape: string;
  table: string;
  /** B10-style comparative expectation, e.g. "Amsterdam > Rotterdam". */
  direction?: string;
  decimals?: number;
  value?: number;
  unit?: string;
  status?: string;
  points?: { period: string; value: number }[];
  cells?: { region: { code: string; label: string }; value: number; decimals?: number }[];
  sources?: { period?: string; region?: { code: string; label: string }; value: number }[];
  computedValue?: number;
  winner?: { code: string; label: string };
  note?: string;
}

export function loadAnswerKey(): AnswerKey {
  return JSON.parse(
    readFileSync(new URL('../../benchmark/answer-key.json', import.meta.url), 'utf8'),
  ) as AnswerKey;
}

function baseLabel(label: string): string {
  return label.replace(/\s*\(.*\)\s*$/, '').trim();
}

/** Every string that must literally appear in the rendered answer text for
 * this task to count as answered with the frozen key's numbers. */
export function expectedStrings(taskId: string, key: KeyEntry): string[] {
  const decimals = key.decimals ?? 0;
  switch (key.shape) {
    case 'single':
      return [formatValueNl(key.value!, decimals)];
    case 'series':
      return key.points!.map((p) => formatValueNl(p.value, decimals));
    case 'comparison':
      return key.cells!.flatMap((c) => [formatValueNl(c.value, c.decimals ?? 0), baseLabel(c.region.label)]);
    case 'derived': {
      const expected = [formatValueNl(key.computedValue!, decimals)];
      if (key.winner) expected.push(baseLabel(key.winner.label));
      // For an explicit difference, the source cells must be visible too —
      // the benchmark's B13 expectation names both stand-values.
      if (!key.winner && key.sources) {
        expected.push(...key.sources.map((s) => formatValueNl(s.value, decimals)));
      }
      return expected;
    }
    default:
      throw new Error(`no expectation rule for key shape '${key.shape}' (${taskId})`);
  }
}

/** All problems with a composed answer, [] when it fully passes. */
export function checkComposedAnswer(taskId: string, key: KeyEntry, answer: ComposedAnswer): string[] {
  const problems: string[] = [];
  if (!answer.validation.ok) {
    problems.push(...answer.validation.problems.map((p) => `validator: ${p}`));
  }
  for (const expected of expectedStrings(taskId, key)) {
    if (!answer.text.replace(/[‘’]/g, "'").includes(expected.replace(/[‘’]/g, "'"))) {
      problems.push(`expected '${expected}' (frozen key) in the answer text`);
    }
  }
  if (!answer.attributionLine.includes(key.table)) {
    problems.push(`attribution must name table ${key.table}`);
  }
  if (key.status && key.status !== 'Definitief' && !/voorlopig/i.test(answer.text)) {
    problems.push(`key value is ${key.status} — the answer must carry the voorlopig marking (R11)`);
  }
  // The key's comparative expectation ('Amsterdam > Rotterdam'): the winner
  // side must at least be named — the validator's own R9 comparison check
  // guards the claim's direction; this keeps the key field load-bearing.
  if (key.direction) {
    const winner = key.direction.split('>')[0]!.trim();
    if (winner && !answer.text.includes(winner)) {
      problems.push(`key direction '${key.direction}': the answer must name ${winner}`);
    }
  }
  return problems;
}
