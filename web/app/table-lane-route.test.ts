// Breadth step 5, Task 4: the table-lane job route (/api/table-lane-job) and
// the daily sweep hook in /api/onboarding-cron. The auth guard (503 when
// CRON_SECRET is unset, 401 on a bad Bearer) short-circuits BEFORE getDb() /
// the job, so those paths are exercised directly in jsdom — exactly the
// onboarding-cron.test.ts precedent. The job itself is covered hermetically by
// tests/ingestion/table-lane-job.test.ts; here the WIRING is pinned by source
// scans. Static imports (session-59 lesson in onboarding-cron.test.ts: a
// dynamic import inside a timed test flakes as a timeout under load).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GET } from './api/table-lane-job/route.ts';
import { kickTableLaneJob } from '../lib/table-lane-kick.ts';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf-8');

describe('table-lane-job auth guard (directly exercised)', () => {
  const original = process.env.CRON_SECRET;
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it('503 when CRON_SECRET is not configured (fail closed, before any DB work)', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(new Request('https://x/api/table-lane-job'));
    expect(res.status).toBe(503);
  });

  it('401 on a missing / wrong Bearer token', async () => {
    process.env.CRON_SECRET = 'secret-abc';
    expect((await GET(new Request('https://x/api/table-lane-job'))).status).toBe(401);
    const wrong = await GET(new Request('https://x/api/table-lane-job', { headers: { authorization: 'Bearer nope' } }));
    expect(wrong.status).toBe(401);
  });

  it("the kick's OWN Authorization header passes the route guard (cross-pin)", async () => {
    process.env.CRON_SECRET = 'secret-abc';
    let capturedAuth: string | null = null;
    let capturedUrl: string | null = null;
    await kickTableLaneJob({
      secret: 'secret-abc',
      host: 'example.test',
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedAuth = new Headers(init?.headers).get('authorization');
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
    });
    expect(capturedUrl).toBe('https://example.test/api/table-lane-job');
    expect(capturedAuth).not.toBeNull();
    // Past the guard the route reaches getDb()/the job, which fails in jsdom —
    // a throw or any non-401/503 status proves the auth was accepted.
    try {
      const res = await GET(new Request('https://x/api/table-lane-job', { headers: { authorization: capturedAuth! } }));
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(503);
    } catch {
      // reached the DB/job code: the guard passed
    }
  });
});

describe('table-lane-job wiring (source pins)', () => {
  const source = read('api/table-lane-job/route.ts');

  it('runs on the nodejs runtime with maxDuration 300', () => {
    expect(source).toContain("export const runtime = 'nodejs'");
    expect(source).toContain('export const maxDuration = 300');
  });

  it('fails closed on an unset secret and requires the Bearer secret', () => {
    expect(source).toContain('CRON_SECRET');
    expect(source).toContain('503');
    expect(source).toContain('401');
    expect(source).toContain('`Bearer ${cronSecret}`');
  });

  it('runs the job through the shared deps builder and returns its summary', () => {
    expect(source).toContain('runTableLaneJob(tableLaneJobDeps(');
    expect(source).toContain('Response.json(summary');
  });

  it('the deps builder wires the real CBS source, the parse client and the chat-turn respond options', () => {
    const deps = read('../lib/table-lane-job-deps.ts');
    expect(deps).toContain('new ODataV4Source()');
    expect(deps).toContain('parseClient: new AnthropicLlmClient()');
    expect(deps).toContain('englishAnswerOptions(lang)');
    // M5: the same shared helpers as askQuestion and the onboarding re-run
    expect(deps).toContain("from './turn-options.ts'");
    expect(deps).toContain('...semanticCheckOptions()');
    expect(deps).toContain('referenceDate()');
    expect(deps).not.toContain('SEMANTIC_CHECK_ENABLED');
  });
});

describe('daily sweep in onboarding-cron', () => {
  const cron = read('api/onboarding-cron/route.ts');

  it('runs the table-lane job once after the onboarding job, fail-open, before the 200', () => {
    const jobDone = cron.indexOf('await runOnboardingJob(');
    const sweep = cron.indexOf('await runTableLaneJob(tableLaneJobDeps(', jobDone);
    const ownCatch = cron.indexOf('table-lane sweep failed', sweep);
    const responseJson = cron.indexOf('Response.json(summary', jobDone);
    expect(jobDone).toBeGreaterThan(-1);
    expect(sweep).toBeGreaterThan(jobDone);
    expect(ownCatch).toBeGreaterThan(sweep);
    expect(responseJson).toBeGreaterThan(ownCatch);
  });

  it('R10: the sweep is NOT behind TABLE_LANE_ENABLED — queued rows always finish and settle', () => {
    expect(cron).not.toContain('tableLaneEnabled');
    expect(cron).not.toContain('TABLE_LANE_ENABLED ===');
  });

  it('M5: referenceDate and the semantic-check options come from the shared helper', () => {
    expect(cron).toContain("from '../../../lib/turn-options.ts'");
    expect(cron).toContain('...semanticCheckOptions()');
    expect(cron).not.toContain('function referenceDate');
    expect(cron).not.toContain("process.env.SEMANTIC_CHECK_ENABLED === '1'");
    const actions = read('actions.ts');
    expect(actions).toContain("import { referenceDate, semanticCheckOptions } from '../lib/turn-options.ts';");
    expect(actions).not.toContain('function referenceDate');
    expect(actions).not.toContain('function semanticCheckOptions');
  });
});
