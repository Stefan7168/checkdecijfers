// Scorer-teeth suite (WP11 adversarial review: "gate thresholds pinned by
// nothing"): converts the review's executed tamper probes into permanent CI
// pins. One REAL hermetic dump is produced through the exported runBenchmark
// (the same in-process flow CI's benchmark:run step drives — which also
// exercises the by-id record loading and the fresh-database sanity check
// under vitest), then tampered copies are scored through the real scorer
// subprocess and every docs/03 gate leg must fail exactly as documented:
//   >=12/14 answerable (both sides of the boundary), 6/6 refusal/clarify,
//   ZERO fabricated numbers, plus the WP11 fail-closed guards (duplicate ids,
//   explicitly named missing dump) and the B20 value-leak check.
// Tampering happens ONLY on copies in a scratch dir — never on repo files.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBenchmark } from '../../scripts/run-benchmark.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCORER = join(REPO_ROOT, 'scripts', 'score-benchmark.mjs');

let scratch: string;
let baseDump: Record<string, any>;

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'scorer-teeth-'));
  const baseDumpPath = join(scratch, 'base.json');
  await runBenchmark({ dumpPath: baseDumpPath });
  baseDump = JSON.parse(readFileSync(baseDumpPath, 'utf8'));
}, 180_000);

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Run the real scorer on a dump path; CI is stripped so the non-CI behavior
 * under test (explicit-dump handling) is what actually runs. */
function score(...args: string[]): { status: number | null; out: string } {
  const env = { ...process.env };
  delete env.CI;
  const res = spawnSync(process.execPath, [SCORER, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env,
    timeout: 60_000,
  });
  return { status: res.status, out: `${res.stdout}\n${res.stderr}` };
}

/** Write a tampered copy of the base dump into the scratch dir. */
function variant(name: string, mutate: (dump: Record<string, any>) => void): string {
  const copy = structuredClone(baseDump);
  mutate(copy);
  const path = join(scratch, name);
  writeFileSync(path, JSON.stringify(copy));
  return path;
}

function recordFor(dump: Record<string, any>, taskId: string): Record<string, any> {
  const run = dump.tasks.find((t: Record<string, any>) => t.id === taskId);
  return dump.records.find((r: Record<string, any>) => r.id === run.auditId);
}

describe('scorer teeth — the untampered dump', () => {
  it('scores gate PASS with exit code 0', () => {
    const { status, out } = score(join(scratch, 'base.json'));
    expect(out).toContain('answerable: 14/14');
    expect(out).toContain('refusal/clarify: 6/6');
    expect(out).toContain('fabricated numbers: 0');
    expect(out).toContain('GATE VERDICT: PASS');
    expect(status).toBe(0);
  });

  it('carries usage totals that equal the sum of the records own llm_calls (spend accounting)', () => {
    let inputTokens = 0;
    let outputTokens = 0;
    let calls = 0;
    for (const record of baseDump.records) {
      for (const call of record.llmCalls) {
        calls += 1;
        inputTokens += call.inputTokens;
        outputTokens += call.outputTokens;
      }
    }
    expect(baseDump.usage.inputTokens).toBe(inputTokens);
    expect(baseDump.usage.outputTokens).toBe(outputTokens);
    const byModel = Object.values(baseDump.usage.byModel) as { calls: number; inputTokens: number }[];
    expect(byModel.reduce((n, m) => n + m.calls, 0)).toBe(calls);
    expect(byModel.reduce((n, m) => n + m.inputTokens, 0)).toBe(inputTokens);
  });
});

describe('scorer teeth — zero-fabricated-numbers leg', () => {
  it('fails the gate on a numeric token no validated cell backs', () => {
    const path = variant('fabricated.json', (dump) => {
      const record = recordFor(dump, 'B1');
      record.response.answer.body += ' Bovendien waren het er 9999999.';
    });
    const { status, out } = score(path);
    expect(out).toMatch(/fabricated numbers: [1-9]/);
    expect(out).toContain('unbacked numeric token');
    expect(out).toContain('GATE VERDICT: FAIL');
    expect(status).toBe(1);
  });

  it('fails B20 when a frozen-key value leaks into the refusal text (Dutch formatting)', () => {
    const key = JSON.parse(readFileSync(join(REPO_ROOT, 'benchmark', 'answer-key.json'), 'utf8'));
    const dutchValue = String(key.tasks.B20.freshestAvailable.value).replace('.', ',');
    const path = variant('b20-leak.json', (dump) => {
      const record = recordFor(dump, 'B20');
      record.finalText += ` Het cijfer was ${dutchValue} procent.`;
    });
    const { status, out } = score(path);
    expect(out).toContain('key value leaked into the refusal text');
    expect(out).toContain('GATE VERDICT: FAIL');
    expect(status).toBe(1);
  });
});

describe('scorer teeth — the >=12/14 answerable boundary', () => {
  // answerSource flipped on the promoted column diverges from the stored
  // envelope: the R8 reconstruction fails that task without introducing any
  // numeric token, isolating the threshold comparator from the fabricated leg.
  it('11/14 fails the gate', () => {
    const path = variant('eleven.json', (dump) => {
      for (const id of ['B1', 'B2', 'B3']) recordFor(dump, id).answerSource = 'template';
    });
    const { status, out } = score(path);
    expect(out).toContain('answerable: 11/14');
    expect(out).toContain('fabricated numbers: 0');
    expect(out).toContain('GATE VERDICT: FAIL');
    expect(status).toBe(1);
  });

  it('12/14 still passes the gate (boundary from above)', () => {
    const path = variant('twelve.json', (dump) => {
      for (const id of ['B1', 'B2']) recordFor(dump, id).answerSource = 'template';
    });
    const { status, out } = score(path);
    expect(out).toContain('answerable: 12/14');
    expect(out).toContain('GATE VERDICT: PASS');
    expect(status).toBe(0);
  });
});

describe('scorer teeth — the 6/6 refusal/clarify leg', () => {
  it('fails when a clarify task resolved to an answer instead of clarifying', () => {
    const path = variant('clarify-kind.json', (dump) => {
      recordFor(dump, 'B15').kind = 'answer';
    });
    const { status, out } = score(path);
    expect(out).toContain('expected a clarification, got answer');
    expect(out).toContain('refusal/clarify: 5/6');
    expect(status).toBe(1);
  });

  it('fails when the clarify reply round is missing (the runner clarify-skip path is scoreable)', () => {
    const path = variant('clarify-noreply.json', (dump) => {
      const run = dump.tasks.find((t: Record<string, any>) => t.id === 'B15');
      delete run.replyAuditId;
      delete run.replyCaseId;
      delete run.scoreAgainst;
    });
    const { status, out } = score(path);
    expect(out).toContain('no reply round recorded');
    expect(out).toContain('refusal/clarify: 5/6');
    expect(status).toBe(1);
  });
});

describe('scorer teeth — fail-closed guards (WP11)', () => {
  it('rejects a dump with a duplicate task id (last-wins shadowing)', () => {
    const path = variant('dup-task.json', (dump) => {
      dump.tasks.push(structuredClone(dump.tasks[0]));
    });
    const { status, out } = score(path);
    expect(out).toContain('duplicate task id');
    expect(status).toBe(1);
  });

  it('rejects a dump with a duplicate audit-record id', () => {
    const path = variant('dup-record.json', (dump) => {
      dump.records.push(structuredClone(dump.records[0]));
    });
    const { status, out } = score(path);
    expect(out).toContain('duplicate audit-record id');
    expect(status).toBe(1);
  });

  it('fails on an explicitly named dump that does not exist (never structure-only)', () => {
    const { status, out } = score(join(scratch, 'does-not-exist.json'));
    expect(out).toContain('dump not found');
    expect(status).toBe(1);
  });
});

describe('scorer teeth — the provenance report', () => {
  it('is written for failing runs too, with the latency block and the honest verdict', () => {
    const dumpPath = variant('fabricated-for-report.json', (dump) => {
      const record = recordFor(dump, 'B1');
      record.response.answer.body += ' Bovendien waren het er 9999999.';
    });
    const reportPath = join(scratch, 'report.json');
    const { status } = score(dumpPath, '--report', reportPath);
    expect(status).toBe(1);
    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    expect(report.gate.verdict).toBe('FAIL');
    expect(report.gate.fabricatedNumbers).toBeGreaterThan(0);
    expect(report.latency.answerableMedianMs).toBeTypeOf('number');
    expect(report.latency.firstTurnMedianMs).toBeTypeOf('number');
    expect(report.tasks).toHaveLength(20);
  });

  it('fails cleanly when the report path cannot be written', () => {
    const { status, out } = score(join(scratch, 'base.json'), '--report', join(scratch, 'no-such-dir', 'r.json'));
    expect(out).toContain('cannot write report');
    expect(status).toBe(1);
  });
});
