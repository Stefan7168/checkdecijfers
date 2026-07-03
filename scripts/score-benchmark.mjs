// Benchmark scorer — the third leg of the CI gate (CLAUDE.md; docs/03-mvp-scope.md).
//
// Since WP10 this is the real thing: it scores AUDIT RECORDS (benchmark/
// audit-run.json, produced by `npm run benchmark:run` — the hermetic audited
// pipeline over replayed fixtures) against the frozen answer key, mechanically,
// per docs/02-user-scenarios.md (Scoring). Every check below reads ONLY the
// dump + the frozen key + deterministic src helpers — never live pipeline
// objects, so "benchmark scoring reads the audit records" (R8) is the actual
// data flow.
//
// Two layers, both honest:
//  1. Structural validation of benchmark/tasks.json + the frozen key
//     (pre-WP10 behavior, kept — it guards the benchmark definition itself).
//  2. Scoring, when the dump exists. Without a dump: locally this prints how
//     to produce one and exits 0 (structure-only mode); in CI (CI=true) a
//     missing dump is a FAILURE — the gate must never silently degrade.
//
// Gate (docs/03): >= 12/14 answerable, 6/6 refusal/clarify, ZERO fabricated
// numbers. Reported but not gate-failing (docs/02): median latency (labeled
// hermetic — replayed fixtures measure pipeline overhead, not user-perceived
// latency; WP11's live run measures that), clarification count on B1-B14,
// template-fallback count, the un-disambiguated B3/B5 check.
//
// Note for live runs (WP11+): when a key cell was superseded by a CBS
// correction, the sync's correction log is the only authorized explanation
// (docs/02) — hermetic runs replay frozen fixtures, so any mismatch here is a
// pipeline bug, never a correction.
import { readFileSync, existsSync } from 'node:fs';
// Deterministic src/test helpers (type-stripped TS imports — same rules CI's
// vitest suites apply, so the scorer and the tests can never judge by
// different formatting or tokenization).
import {
  checkComposedAnswer,
  loadAnswerKey,
} from '../tests/helpers/answer-expectations.ts';
import { reconstructionReport } from '../src/answer/audit/reconstruct.ts';
import {
  findNumericTokens,
  normalizeForScan,
  numbersInText,
  periodCodeNumbers,
} from '../src/answer/compose/format.ts';
import { scanBody } from '../src/answer/compose/validate.ts';
import { CANONICAL_MEASURES } from '../src/registry/defaults.ts';

const fail = (msg) => { console.error(`SCORER FAIL: ${msg}`); process.exit(1); };

const tasksPath = new URL('../benchmark/tasks.json', import.meta.url);
const keyPath = new URL('../benchmark/answer-key.json', import.meta.url);
const dumpPath = new URL('../benchmark/audit-run.json', import.meta.url);
const { frozen, tasks } = JSON.parse(readFileSync(tasksPath, 'utf8'));

// ---------------------------------------------------------------------------
// Layer 1 — structural checks: the task set must exactly mirror docs/02.
// ---------------------------------------------------------------------------
if (tasks.length !== 20) fail(`expected 20 tasks, found ${tasks.length}`);
const ids = tasks.map((t) => t.id);
const expectedIds = Array.from({ length: 20 }, (_, i) => `B${i + 1}`);
if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) fail(`task IDs must be exactly B1..B20 in order, got: ${ids.join(', ')}`);
const answerable = tasks.filter((t) => t.type === 'answerable');
const clarify = tasks.filter((t) => t.type === 'clarify');
const refuse = tasks.filter((t) => t.type === 'refuse');
if (answerable.length !== 14) fail(`expected 14 answerable tasks (B1-B14), found ${answerable.length}`);
if (clarify.length !== 2 || refuse.length !== 4) fail(`expected 2 clarify + 4 refuse tasks (B15-B20), found ${clarify.length}+${refuse.length}`);
for (const t of tasks) if (!t.question?.trim()) fail(`${t.id} has an empty question`);
if (!tasks.find((t) => t.id === 'B13')?.derived || !tasks.find((t) => t.id === 'B14')?.derived) fail('B13 and B14 must be marked derived');

// Freeze-state consistency: the frozen flag and the key file may never disagree.
const keyExists = existsSync(keyPath);
if (frozen && !keyExists) fail('tasks.json says frozen=true but benchmark/answer-key.json does not exist');
if (!frozen && keyExists) fail('benchmark/answer-key.json exists but tasks.json says frozen=false — freeze explicitly or remove the key');
if (!frozen) {
  console.log('benchmark scorer: SKELETON MODE — answer key not yet frozen.');
  process.exit(0);
}

const key = loadAnswerKey();
const REQUIRED_BY_SHAPE = {
  single: ['table', 'measure', 'value', 'unit', 'status'],
  series: ['table', 'measure', 'points'],
  comparison: ['table', 'measure', 'cells'],
  derived: ['derived', 'sources', 'formula', 'computedValue'],
};
for (const t of answerable) {
  const entry = key.tasks?.[t.id];
  if (!entry) fail(`frozen key is missing an entry for answerable task ${t.id}`);
  const required = REQUIRED_BY_SHAPE[entry.shape];
  if (!required) fail(`${t.id}: unknown or missing "shape" (${entry.shape})`);
  for (const field of required) {
    if (entry[field] === undefined) fail(`${t.id}: entry (shape=${entry.shape}) is missing required field "${field}"`);
  }
}
if (!key.tasks?.B20) fail('frozen key is missing the B20 freshness reference');

// ---------------------------------------------------------------------------
// Layer 2 — scoring audit records against the frozen key.
// ---------------------------------------------------------------------------
if (!existsSync(dumpPath)) {
  if (process.env.CI) {
    fail('no benchmark/audit-run.json in CI — the "Benchmark run" step must produce it before scoring (the gate may not silently degrade to structure-only).');
  }
  console.log('benchmark scorer: structural validation PASS. No audit-run dump found —');
  console.log('produce one with `npm run benchmark:run` (hermetic, no API key) and re-score.');
  process.exit(0);
}

const dump = JSON.parse(readFileSync(dumpPath, 'utf8'));
const recordById = new Map(dump.records.map((r) => [r.id, r]));
const runById = new Map(dump.tasks.map((t) => [t.id, t]));

function recordFor(taskId, auditId) {
  const record = recordById.get(auditId);
  if (!record) fail(`${taskId}: audit record ${auditId} referenced by the run is not in the dump`);
  return record;
}

/** Numbers that structured sources back for refusal/clarification texts —
 * mirrors the WP9 belt-check whitelist (tests/answer/respond-pipeline.test.ts):
 * registry labels, this response's own option strings, its freshness payload,
 * and every canonical measure's freshest period (dumped by the runner from
 * the same database the pipeline ran against). Never the text itself. */
function nonAnswerWhitelist(record) {
  const allowed = new Set();
  for (const m of CANONICAL_MEASURES) {
    for (const n of numbersInText(m.definitionLabel)) allowed.add(n);
    for (const term of m.everydayTerms) for (const n of numbersInText(term)) allowed.add(n);
  }
  for (const code of Object.values(dump.canonicalFreshestPeriods ?? {})) {
    for (const n of periodCodeNumbers(code)) allowed.add(n);
  }
  const response = record.response;
  if (response.kind === 'clarification') {
    for (const opt of response.options) for (const n of numbersInText(opt)) allowed.add(n);
  }
  if (response.kind === 'refusal' && response.freshness) {
    for (const code of [response.freshness.freshestAvailable?.periodCode, response.freshness.freshestDefinitief?.periodCode]) {
      if (code) for (const n of periodCodeNumbers(code)) allowed.add(n);
    }
  }
  return allowed;
}

/** Unbacked numeric tokens — the fabricated-number count's raw material.
 * Answers: scanBody's own classification (kind 'unbacked') over the stored
 * body + stored result — R1's scan run from the record. Non-answers: every
 * numeric token not in the structured whitelist. */
function unbackedTokens(record) {
  const response = record.response;
  if (response.kind === 'answer') {
    return scanBody(normalizeForScan(response.answer.body), response.result)
      .filter((t) => t.kind === 'unbacked')
      .map((t) => t.token);
  }
  const allowed = nonAnswerWhitelist(record);
  return findNumericTokens(normalizeForScan(record.finalText))
    .filter((t) => !allowed.has(t.value))
    .map((t) => t.token);
}

/** Data-level check, independent of prose: the frozen key's values must be
 * present VERBATIM among the stored result cells / derivations at the key's
 * coordinates (docs/02: "the number(s) match the key"). */
function keyValuesInStoredResult(taskId, entry, record) {
  const problems = [];
  const result = record.response.result;
  const cellMatch = (period, value, regionCode) =>
    result.cells.some(
      (c) => c.periodCode === (period ?? c.periodCode) && c.value === value && (regionCode === undefined || c.regionCode === regionCode),
    );
  switch (entry.shape) {
    case 'single':
      if (!cellMatch(entry.period, entry.value)) problems.push(`key value ${entry.value} @ ${entry.period} not among stored cells`);
      break;
    case 'series':
      for (const p of entry.points) {
        if (!cellMatch(p.period, p.value)) problems.push(`key point ${p.period}=${p.value} not among stored cells`);
      }
      break;
    case 'comparison':
      for (const c of entry.cells) {
        if (!cellMatch(undefined, c.value, c.region.code)) problems.push(`key cell ${c.region.code}=${c.value} not among stored cells`);
      }
      break;
    case 'derived': {
      const explicit = result.derivations.find((d) => d.explicit);
      if (!explicit) problems.push('no explicit derivation stored');
      else if (explicit.value !== entry.computedValue) problems.push(`stored derivation value ${explicit.value} != key computedValue ${entry.computedValue}`);
      for (const s of entry.sources ?? []) {
        if (!cellMatch(s.period, s.value, s.region?.code)) problems.push(`key source ${s.value} not among stored cells`);
      }
      if (record.response.answer.markingLine === null) problems.push('derived answer must carry the CC BY marking line (R5)');
      break;
    }
    default:
      problems.push(`unknown key shape ${entry.shape}`);
  }
  return problems;
}

/** Chart check for tasks docs/02 marks chart:true — every key point must be a
 * spec point, verbatim (R6 + frozen key). */
function chartMatchesKey(entry, record) {
  const problems = [];
  const chart = record.response.chart;
  if (!chart) return ['expected a chart, none emitted'];
  const points = chart.series.flatMap((s) => s.points);
  for (const p of entry.points) {
    if (!points.some((sp) => sp.periodCode === p.period && sp.value === p.value)) {
      problems.push(`key point ${p.period}=${p.value} missing from chart spec`);
    }
  }
  return problems;
}

const taskResults = [];
let fabricated = 0;

function scoreRecordCommon(taskId, record) {
  const problems = [];
  const reconstruction = reconstructionReport(record);
  if (!reconstruction.ok) problems.push(...reconstruction.problems.map((p) => `R8: ${p}`));
  const unbacked = unbackedTokens(record);
  if (unbacked.length > 0) {
    fabricated += unbacked.length;
    problems.push(`unbacked numeric token(s): ${unbacked.join(', ')}`);
  }
  return problems;
}

for (const task of tasks) {
  const run = runById.get(task.id);
  if (!run) fail(`${task.id}: not present in the benchmark run dump`);
  const record = recordFor(task.id, run.auditId);
  const problems = [];

  if (task.type === 'answerable') {
    if (record.kind !== 'answer') {
      problems.push(`expected an answer, got ${record.kind}`);
    } else {
      problems.push(...checkComposedAnswer(task.id, key.tasks[task.id], record.response.answer));
      problems.push(...keyValuesInStoredResult(task.id, key.tasks[task.id], record));
      if (task.chart) problems.push(...chartMatchesKey(key.tasks[task.id], record));
      problems.push(...scoreRecordCommon(task.id, record));
    }
  } else if (task.type === 'clarify') {
    if (record.kind !== 'clarification') {
      problems.push(`expected a clarification, got ${record.kind}`);
    } else {
      const questionMarks = (record.finalText.match(/\?/g) ?? []).length;
      if (questionMarks !== 1) problems.push(`exactly one compact question required, found ${questionMarks} '?'`);
      if (record.response.options.length === 0) problems.push('clarification offers no options');
      problems.push(...scoreRecordCommon(task.id, record));
      // Post-clarification answer (docs/02: scored on it, one round max).
      if (!run.replyAuditId) {
        problems.push('no reply round recorded');
      } else {
        const replyRecord = recordFor(`${task.id}-reply`, run.replyAuditId);
        if (replyRecord.kind !== 'answer') {
          problems.push(`post-clarification: expected an answer, got ${replyRecord.kind}`);
        } else {
          if (replyRecord.replyText === null || replyRecord.pendingClarification === null) {
            problems.push('reply row must record reply_text + pending_clarification (ADR 015)');
          }
          problems.push(
            ...checkComposedAnswer(run.scoreAgainst, key.tasks[run.scoreAgainst], replyRecord.response.answer)
              .map((p) => `post-clarification (${run.scoreAgainst}): ${p}`),
          );
          problems.push(...scoreRecordCommon(`${task.id}-reply`, replyRecord));
        }
      }
    }
  } else {
    // refuse tasks: correct reason (docs/02 pass criterion — checked against
    // the typed field, never by parsing prose) + no numbers.
    if (record.kind !== 'refusal') {
      problems.push(`expected a refusal, got ${record.kind}`);
    } else {
      if (record.refusalReason !== task.reason) {
        problems.push(`refusal reason '${record.refusalReason}' != expected '${task.reason}'`);
      }
      if (task.id === 'B20') {
        const b20 = key.tasks.B20;
        const freshness = record.response.freshness;
        if (freshness?.freshestAvailable?.periodCode !== b20.freshestAvailable.period) {
          problems.push(`freshness offer ${freshness?.freshestAvailable?.periodCode} != key ${b20.freshestAvailable.period}`);
        }
        // Value-leak check, in the honest mechanical form (adversarial-review
        // fix, 2026-07-03 — raw String(v) substring matching over the whole
        // envelope both false-positived on numeric collisions and missed
        // Dutch-formatted values like '2,9'): (a) the USER-FACING text may
        // not contain the key's values as numeric tokens in any locale
        // formatting; (b) the structured freshness payload may not carry a
        // value field at all — a freshness offer is period + status only
        // (open-questions #37).
        const keyValues = [b20.freshestAvailable.value, b20.freshestDefinitief.value];
        const leaked = findNumericTokens(normalizeForScan(record.finalText))
          .filter((t) => keyValues.includes(t.value));
        for (const t of leaked) problems.push(`key value leaked into the refusal text as '${t.token}'`);
        for (const offer of [freshness?.freshestAvailable, freshness?.freshestDefinitief]) {
          if (offer && Object.keys(offer).some((k) => k === 'value')) {
            problems.push('freshness payload carries a value field — offers are period + status only');
          }
        }
      }
      problems.push(...scoreRecordCommon(task.id, record));
    }
  }

  taskResults.push({ id: task.id, type: task.type, pass: problems.length === 0, problems });
}

// Informational: the un-disambiguated B3/B5 variants (never gate-failing).
const undisambiguated = [];
for (const [variantId, baseId] of [['B3-undisambiguated', 'B3'], ['B5-undisambiguated', 'B5']]) {
  const run = runById.get(variantId);
  if (!run) { undisambiguated.push({ id: variantId, pass: false, note: 'not in dump' }); continue; }
  const record = recordFor(variantId, run.auditId);
  const pass = record.kind === 'answer' && checkComposedAnswer(baseId, key.tasks[baseId], record.response.answer).length === 0;
  undisambiguated.push({ id: variantId, pass, note: record.kind !== 'answer' ? `resolved to ${record.kind}` : 'canonical default, no clarification' });
}

// Informational counters.
const firstTurnRecords = tasks.map((t) => recordFor(t.id, runById.get(t.id).auditId));
const clarificationCountB1toB14 = tasks
  .filter((t) => t.type === 'answerable')
  .filter((t) => recordFor(t.id, runById.get(t.id).auditId).kind === 'clarification').length;
const templateFallbacks = dump.records.filter((r) => r.answerSource === 'template').length;
const latencies = firstTurnRecords.map((r) => r.latencyMs).sort((a, b) => a - b);
const medianLatency = latencies.length % 2 === 1
  ? latencies[(latencies.length - 1) / 2]
  : Math.round((latencies[latencies.length / 2 - 1] + latencies[latencies.length / 2]) / 2);

// ---------------------------------------------------------------------------
// Verdict (docs/03 gate: >=12/14 answerable, 6/6 refusal+clarify, 0 fabricated)
// ---------------------------------------------------------------------------
const answerablePass = taskResults.filter((t) => t.type === 'answerable' && t.pass).length;
const refusalPass = taskResults.filter((t) => t.type !== 'answerable' && t.pass).length;
const gate = answerablePass >= 12 && refusalPass === 6 && fabricated === 0;

console.log(`benchmark scorer: scoring ${dump.records.length} audit records (${dump.mode}, generated ${dump.generatedAt})`);
console.log('');
for (const t of taskResults) {
  console.log(`  ${t.pass ? 'PASS' : 'FAIL'}  ${t.id} (${t.type})${t.problems.length ? `\n        - ${t.problems.join('\n        - ')}` : ''}`);
}
console.log('');
console.log(`  answerable: ${answerablePass}/14 (gate: >=12)`);
console.log(`  refusal/clarify: ${refusalPass}/6 (gate: 6/6)`);
console.log(`  fabricated numbers: ${fabricated} (gate: 0)`);
console.log(`  median response: ${medianLatency} ms  [${dump.mode} — pipeline overhead only; live latency lands with WP11]`);
console.log(`  informational: clarifications on B1-B14: ${clarificationCountB1toB14}; template fallbacks: ${templateFallbacks}`);
for (const u of undisambiguated) console.log(`  informational: ${u.id}: ${u.pass ? 'PASS' : 'FAIL'} (${u.note})`);
console.log('');
console.log(`  GATE VERDICT: ${gate ? 'PASS' : 'FAIL'}`);
if (!gate) process.exit(1);
