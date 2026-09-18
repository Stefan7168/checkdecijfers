// The own-data tier's LLM fixtures (session 113, co-pilot phase 2, Task 9).
//
//   npm run attachments:fixtures    offline: writes the HAND-AUTHORED
//                                   fixtures under their real request hash.
//                                   No key, no network, no spend.
//   npm run attachments:record      live: calls the real model once per case
//                                   through RecordingLlmClient and prints the
//                                   diff against the hand-authored output.
//                                   SPENDS REAL TOKENS — owner-supervised.
//
// Why a generator instead of hand-written JSON: the llm-stub
// (scripts/dev-harness/llm-stub.mjs) matches a request on (model, system,
// question), and the `question` for this tier is a SERIALIZED payload —
// profile columns, the held instruction, the chart's labels, the
// capabilities. Those bytes can only be produced by the real builders
// (instruct/parse.ts, copilot/parse.ts), which is exactly what this script
// calls. A prompt edit therefore changes the hash, the fixture goes missing,
// and tests/attachments/fixtures.test.ts fails loudly instead of the browser
// proof quietly replaying a stale answer.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AnthropicLlmClient,
  RecordingLlmClient,
  requestHash,
  stableStringify,
  type LlmRequest,
  type RecordedFixture,
} from '../src/answer/llm/client.ts';
import { buildUserChartSpec } from '../src/attachments/chart.ts';
import { buildCopilotRequest } from '../src/attachments/copilot/parse.ts';
import { sanitizeCapabilities } from '../src/attachments/copilot/types.ts';
import { parseCsv } from '../src/attachments/ingest/csv.ts';
import { buildDatasetProfile } from '../src/attachments/ingest/profile.ts';
import { buildDatasetInstructRequest } from '../src/attachments/instruct/parse.ts';
import { validateInstructionObject } from '../src/attachments/instruct/schema.ts';
import {
  reviveClientInstruction,
  toClientInstruction,
  upgradeInstruction,
  type ClientChartInstruction,
  type UserChartSpec,
  type UserDataset,
} from '../src/attachments/types.ts';
import { CASES, type AttachmentCase } from '../tests/fixtures/attachments/cases.ts';

export const FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/llm/attachments', import.meta.url));
const CSV_DIR = fileURLToPath(new URL('../tests/fixtures/attachments', import.meta.url));

/** The uploaded file, as the ingest path would have stored it: the real
 * parser, the real profile builder. Every other field is inert — nothing in
 * the request builders reads them. */
function loadDataset(csv: string): UserDataset {
  const cells = parseCsv(readFileSync(resolve(CSV_DIR, csv), 'utf8')).cells;
  return {
    id: 1,
    userId: '11111111-1111-4111-8111-111111111111',
    sourceKind: 'file_csv',
    displayName: csv,
    sourceUrl: null,
    cells,
    profile: buildDatasetProfile(cells),
    status: 'ready',
    contentSha256: 'fixture',
    createdAt: '2026-09-18T00:00:00.000Z',
  };
}

/** copilot/respond.ts's own `chartLabels`, duplicated here because it is
 * private to that module — the labels are the ONLY thing about the chart the
 * prompt carries. */
function chartLabels(chart: UserChartSpec): { seriesLabels: string[]; xLabels: string[] } {
  const xLabels: string[] = [];
  for (const series of chart.series) {
    for (const point of series.points) {
      if (!xLabels.includes(point.xLabel)) xLabels.push(point.xLabel);
    }
  }
  return { seriesLabels: chart.series.map((s) => s.label), xLabels };
}

/**
 * One case's request, built exactly as the running server builds it — the
 * whole point of this file. For a co-pilot case that means walking
 * copilot/respond.ts's own flow: revalidate the held instruction against the
 * profile, execute the chart, enum-check the capabilities, and only then
 * serialize. Doing any of that differently would change the bytes and orphan
 * the fixture.
 */
export function buildCaseRequest(kase: AttachmentCase): LlmRequest {
  const dataset = loadDataset(kase.csv);
  if (kase.kind === 'instruct') {
    return buildDatasetInstructRequest(dataset.profile, kase.previous, kase.question);
  }
  const validated = validateInstructionObject(
    reviveClientInstruction(upgradeInstruction(kase.current) as ClientChartInstruction),
    dataset.profile,
  );
  const chart = buildUserChartSpec(dataset, validated);
  return buildCopilotRequest(
    dataset.profile,
    toClientInstruction(validated),
    chartLabels(chart),
    sanitizeCapabilities(kase.capabilities),
    kase.message,
  );
}

function fixturePath(hash: string): string {
  return resolve(FIXTURES_DIR, `${hash}.json`);
}

/** The recorder's own label hook: the case whose serialized question this
 * is, so a recorded file says which case it belongs to. */
function labelFor(question: string): string | null {
  for (const kase of CASES) {
    if (buildCaseRequest(kase).question === question) return kase.label;
  }
  return null;
}

function writeOffline(): void {
  let written = 0;
  for (const kase of CASES) {
    const request = buildCaseRequest(kase);
    const hash = requestHash(request);
    const file = fixturePath(hash);
    const existing = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as RecordedFixture) : null;
    const fixture: RecordedFixture = {
      requestHash: hash,
      // Human orientation only (the hash is the key) — the case's own name
      // reads better here than a 2 KB serialized payload.
      question: kase.label,
      label: kase.label,
      // Kept when nothing else changed, so re-running this script is a no-op
      // in git rather than a timestamp churn on four files.
      recordedAt: existing?.recordedAt ?? new Date().toISOString(),
      request,
      response: {
        outputText: JSON.stringify(kase.output),
        model: request.model,
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    };
    const text = `${JSON.stringify(fixture, null, 2)}\n`;
    if (existing !== null && readFileSync(file, 'utf8') === text) {
      console.log(`unchanged  ${kase.label}  ${hash}`);
      continue;
    }
    writeFileSync(file, text);
    written += 1;
    console.log(`written    ${kase.label}  ${hash}`);
  }
  console.log(`\n${CASES.length} case(s), ${written} file(s) written to ${FIXTURES_DIR}`);
}

async function record(): Promise<void> {
  const client = new RecordingLlmClient(new AnthropicLlmClient(), FIXTURES_DIR, labelFor);
  let mismatches = 0;
  for (const kase of CASES) {
    const response = await client.complete(buildCaseRequest(kase));
    const expected = stableStringify(kase.output);
    let actual: string;
    try {
      actual = stableStringify(JSON.parse(response.outputText));
    } catch {
      actual = `<not JSON> ${response.outputText}`;
    }
    if (actual === expected) {
      console.log(`match      ${kase.label}`);
      continue;
    }
    mismatches += 1;
    console.log(`DIFFERS    ${kase.label}`);
    console.log(`  hand-authored: ${expected}`);
    console.log(`  recorded:      ${actual}`);
  }
  console.log(
    `\n${CASES.length} case(s), ${mismatches} differ from the hand-authored output. ` +
      'The recorded files are now in place; revert them and fix cases.ts if the ' +
      'hand-authored answer is the one this tier should be tested against.',
  );
  if (mismatches > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--record')) await record();
  else writeOffline();
}
