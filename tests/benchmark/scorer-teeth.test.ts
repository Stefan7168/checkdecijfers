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
// #216 (session 110) — the B20 live-freshness-conditional tests build ONE
// real 'answer' AuditRecord through the actual deterministic pipeline
// (respondToIntent + buildAuditRow, templateOnly: true so no LLM call and no
// fixture is needed), over the SAME real ingested fixture database every
// other query/respond test uses. Nothing here touches src/answer/intent/**
// or tests/fixtures/llm/ — the intent is a hand-built stub (the same pattern
// tests/answer/respond-staleness.test.ts already uses), never an LLM parse.
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { respondToIntent } from '../../src/answer/respond/index.ts';
import type { ParseOutcome } from '../../src/answer/intent/types.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import { buildAuditRow } from '../../src/answer/audit/write.ts';
import type { AuditContext } from '../../src/answer/audit/write.ts';
import type { AuditRecord } from '../../src/answer/audit/types.ts';

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

// #216 (session 110): the LIVE B20 expectation is DATA-CONDITIONAL, derived
// from the run's own recorded evidence — see the scorer's B20 branch. These
// pins exercise both branches ONLY on the live path (dump.mode === 'live');
// tests above already pin that the hermetic path (dump.mode !== 'live') is
// untouched — its B20 record is never 'answer', so the new branch never
// triggers there.
describe('scorer teeth — B20 live-freshness conditional (#216)', () => {
  let db: Db;
  let closeDb: () => Promise<void>;
  // A genuine, reconstructable 'answer' AuditRecord for the CPI canonical
  // measure at 2026MM06 — the real ingested fixture's freshest loaded month
  // (the same cell the frozen key's B20.freshestAvailable pins). Built via
  // the real deterministic pipeline (respondToIntent, templateOnly: true —
  // no LLM call, no fixture needed), so R8 reconstruction genuinely holds.
  let coveredAnswerRecord: AuditRecord;

  class UnreachableLlmClient implements LlmClient {
    async complete(): Promise<LlmResponse> {
      throw new Error('templateOnly: true must never reach the LLM');
    }
  }

  /** Mirrors tests/answer/respond-staleness.test.ts's stubIntentOutcome — a
   * hand-built 'intent' ParseOutcome, never an LLM parse. impliedRecency:
   * false keeps this well clear of the staleness branch (respondToIntent's
   * OTHER recency-driven fork), which is not what this suite is testing. */
  function stubCpiIntentOutcome(periodCode: string): Extract<ParseOutcome, { kind: 'intent' }> {
    return {
      kind: 'intent',
      question: `Wat was de inflatie in ${periodCode}?`,
      raw: {
        version: 3,
        kind: 'data_query',
        candidates: [],
        unmatchedMeasureTerm: null,
        nearestCanonicalKeys: [],
        note: null,
      },
      model: 'stub',
      usage: { inputTokens: 0, outputTokens: 0 },
      intent: {
        schemaVersion: 1,
        target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
        period: { kind: 'codes', codes: [periodCode] },
        derivation: 'none',
      },
      confidence: 0.97,
      impliedRecency: false,
      ranked: [],
    };
  }

  beforeAll(async () => {
    ({ db, close: closeDb } = await createIngestedDb());
    const parse = stubCpiIntentOutcome('2026MM06');
    const response = await respondToIntent(db, parse.question, parse, {
      answerClient: new UnreachableLlmClient(),
      referenceDate: '2026-07-15',
      templateOnly: true,
    });
    if (response.kind !== 'answer') {
      throw new Error(`setup: expected a real answer for 2026MM06, got ${response.kind}`);
    }
    const context: AuditContext = {
      referenceDate: '2026-07-15',
      userId: null,
      sourceTag: 'benchmark',
      requestId: null,
      replyText: null,
      pendingClarification: null,
      conversationContext: null,
      llmCalls: [],
      latencyMs: 1,
    };
    const row = buildAuditRow(response, context);
    coveredAnswerRecord = { id: -1, createdAt: '2026-07-15T00:00:00.000Z', ...row };
  }, 300_000);

  afterAll(async () => {
    await closeDb();
  });

  /** Swaps the B20 record in a clone of the base hermetic dump, keeping its
   * existing auditId (so dump.tasks needs no change) — the same surgical,
   * single-task mutation the rest of this file uses. */
  function b20Variant(name: string, mode: string, referenceDate: string, replacement: (existing: Record<string, any>) => Record<string, any>) {
    return variant(name, (dump) => {
      dump.mode = mode;
      dump.referenceDate = referenceDate;
      const run = dump.tasks.find((t: Record<string, any>) => t.id === 'B20');
      const idx = dump.records.findIndex((r: Record<string, any>) => r.id === run.auditId);
      dump.records[idx] = { ...replacement(dump.records[idx]), id: run.auditId };
    });
  }

  it('covered period + a real answer (attributed to exactly that month, no fabrication) PASSES', () => {
    // referenceDate 2026-07-15 -> "vorige maand" resolves to 2026MM06 —
    // exactly the period coveredAnswerRecord is attributed to.
    const path = b20Variant('b20-live-covered-answer.json', 'live', '2026-07-15', () => coveredAnswerRecord);
    const { status, out } = score(path);
    expect(out).toContain('PASS  B20 (refuse) [covered -> answer expected]');
    expect(out).toContain('GATE VERDICT: PASS');
    expect(status).toBe(0);
  });

  it('a covered/advanced freshness offer on a REFUSAL still fails (the new branch never swallows a real mismatch)', () => {
    // The stored refusal is kind:'refusal', so the new branch never applies —
    // the existing freshness-offer-vs-frozen-key check runs unchanged. Bumping
    // the offer past the frozen key's pinned month (as live drift genuinely
    // would) must still fail: "covered" is never a free pass for a refusal.
    const path = b20Variant('b20-live-refusal-advanced-offer.json', 'live', '2026-08-15', (existing) => {
      const copy = structuredClone(existing);
      copy.response.freshness.freshestAvailable.periodCode = '2026MM07';
      return copy;
    });
    const { status, out } = score(path);
    expect(out).toContain('freshness offer 2026MM07 != key 2026MM06');
    expect(out).toContain('refusal/clarify: 5/6');
    expect(out).toContain('GATE VERDICT: FAIL');
    expect(status).toBe(1);
  });

  it('not covered + the correct refusal still PASSES under live mode, unchanged', () => {
    // The base dump's own real B20 refusal record, untouched — only dump.mode
    // flips to 'live'. Confirms the new branch leaves the ordinary passing
    // refusal case exactly as it scores hermetically.
    const path = b20Variant('b20-live-refusal-untouched.json', 'live', '2026-08-15', (existing) => existing);
    const { status, out } = score(path);
    expect(out).toContain('PASS  B20 (refuse) [not covered -> refusal expected]');
    expect(out).toContain('refusal/clarify: 6/6');
    expect(out).toContain('GATE VERDICT: PASS');
    expect(status).toBe(0);
  });

  it('an answer attributed to the WRONG (uncovered) period FAILS', () => {
    // Same real answer record as the covered-pass test, but scored against
    // referenceDate 2026-08-15 -> expected previous month is 2026MM07, while
    // the record is attributed to 2026MM06 — a genuine period mismatch.
    const path = b20Variant('b20-live-uncovered-answer.json', 'live', '2026-08-15', () => coveredAnswerRecord);
    const { status, out } = score(path);
    expect(out).toContain('attributed period 2026MM06 != resolved previous month 2026MM07');
    expect(out).toContain('refusal/clarify: 5/6');
    expect(out).toContain('GATE VERDICT: FAIL');
    expect(status).toBe(1);
  });
});
