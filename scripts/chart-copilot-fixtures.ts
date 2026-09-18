// The CBS/Eurostat tier's LLM fixtures (session 114, co-pilot phase 3, Task 4).
//
//   npm run chart-copilot:fixtures  offline: writes the HAND-AUTHORED
//                                    fixtures under their real request hash.
//                                    No key, no network, no spend.
//   npm run chart-copilot:record    live: calls the real model once per case
//                                    through RecordingLlmClient and prints the
//                                    diff against the hand-authored output.
//                                    SPENDS REAL TOKENS — owner-supervised.
//
// Mirrors scripts/attachments-fixtures.ts exactly (see that file's header for
// why a generator instead of hand-written JSON — the llm-stub matches on the
// exact serialized `question`, so only the real request builder can produce
// byte-identical bytes). This tier's request needs no dataset/profile at
// all: `buildCbsCopilotRequest` takes the chart's own ChartSpec, so
// `buildCaseRequest` here is a one-line call.
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
import { buildCbsCopilotRequest } from '../src/chart/copilot/parse.ts';
import { sanitizeCbsCapabilities } from '../src/chart/copilot/types.ts';
import { CASES, type CbsCopilotCase } from '../tests/fixtures/chart-copilot/cases.ts';

export const FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/llm/chart-copilot', import.meta.url));

/**
 * One case's request, built exactly as the running server builds it (the
 * server action calls buildCbsCopilotRequest via respond.ts/parse.ts with
 * the client-sent spec, sanitized capabilities, and the reader's message).
 */
export function buildCaseRequest(kase: CbsCopilotCase): LlmRequest {
  return buildCbsCopilotRequest(kase.spec, sanitizeCbsCapabilities(kase.capabilities), kase.message);
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
      question: kase.label,
      label: kase.label,
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
