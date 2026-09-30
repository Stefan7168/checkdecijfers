// ADR 065 step 8: the warm-job route (/api/warm-job) and the daily kick in /api/onboarding-cron. The auth guard
// (503 when CRON_SECRET is unset, 401 on a bad Bearer) short-circuits BEFORE getDb() / the job, so those paths are
// exercised directly — the table-lane-route.test.ts precedent. The job's decisions (chain counter, chaining, budget,
// summary, run flow) are unit-tested in lib/warm-job.test.ts and the alert in tests/audit/warm-failure-alert.test.ts;
// here the WIRING is pinned by source scans. Static imports (a dynamic import inside a timed test flakes under load).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GET } from './api/warm-job/route.ts';
import { kickWarmJob } from '../lib/warm-job.ts';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf-8');

describe('warm-job auth guard (directly exercised)', () => {
  const original = process.env.CRON_SECRET;
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it('503 when CRON_SECRET is not configured (fail closed, before any DB work)', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(new Request('https://x/api/warm-job'));
    expect(res.status).toBe(503);
  });

  it('401 on a missing / wrong Bearer token — also when a chain counter is supplied', async () => {
    process.env.CRON_SECRET = 'secret-abc';
    expect((await GET(new Request('https://x/api/warm-job'))).status).toBe(401);
    expect((await GET(new Request('https://x/api/warm-job?chain=3'))).status).toBe(401);
    const wrong = await GET(new Request('https://x/api/warm-job', { headers: { authorization: 'Bearer nope' } }));
    expect(wrong.status).toBe(401);
  });

  it("the kick's OWN Authorization header passes the route guard (cross-pin), for the daily and the chained kick", async () => {
    process.env.CRON_SECRET = 'secret-abc';
    for (const chain of [0, 2]) {
      let capturedAuth: string | null = null;
      let capturedUrl: string | null = null;
      await kickWarmJob(chain, {
        secret: 'secret-abc',
        host: 'example.test',
        fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
          capturedUrl = String(input);
          capturedAuth = new Headers(init?.headers).get('authorization');
          return new Response('{}', { status: 200 });
        }) as typeof fetch,
      });
      expect(capturedUrl).toBe(chain === 0 ? 'https://example.test/api/warm-job' : 'https://example.test/api/warm-job?chain=2');
      expect(capturedAuth).not.toBeNull();
      // Past the guard the route reaches getDb()/the job, which fails in jsdom — a throw or any non-401/503 status
      // proves the auth was accepted.
      try {
        const res = await GET(new Request(capturedUrl!, { headers: { authorization: capturedAuth! } }));
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(503);
      } catch {
        // reached the DB/job code: the guard passed
      }
    }
  });
});

describe('warm-job route wiring (source pins)', () => {
  const source = read('api/warm-job/route.ts');

  it('runs on the nodejs runtime with maxDuration 300', () => {
    expect(source).toContain("export const runtime = 'nodejs'");
    expect(source).toContain('export const maxDuration = 300');
  });

  it('fails closed on an unset secret and requires the Bearer secret, like the other job routes', () => {
    expect(source).toContain('CRON_SECRET');
    expect(source).toContain('503');
    expect(source).toContain('401');
    expect(source).toContain('`Bearer ${cronSecret}`');
    // the guard comes before any database or CBS work
    expect(source.indexOf('`Bearer ${cronSecret}`')).toBeLessThan(source.indexOf('getDb()'));
    expect(source.indexOf('`Bearer ${cronSecret}`')).toBeLessThan(source.indexOf('new ODataV4Source('));
  });

  it('builds its CBS source with short per-attempt limits and a hard stop, not the adapter defaults', () => {
    expect(source).toContain('metadataTimeoutMs: WARM_METADATA_TIMEOUT_MS');
    expect(source).toContain('observationsTimeoutMs: WARM_OBSERVATIONS_TIMEOUT_MS');
    expect(source).toContain('withHardStop(');
    expect(source).toContain('startedAt + WARM_HARD_STOP_MS');
    expect(source).not.toContain('new ODataV4Source()');
  });

  it('builds its Eurostat source (#358 item 4) with the same hard stop and the short observations limit', () => {
    const eurostat = source.slice(source.indexOf('new StatisticsApiSource('));
    expect(eurostat).toContain('withHardStop(');
    expect(eurostat).toContain('startedAt + WARM_HARD_STOP_MS');
    expect(eurostat).toContain('timeoutMs: WARM_OBSERVATIONS_TIMEOUT_MS');
    expect(source.indexOf('`Bearer ${cronSecret}`')).toBeLessThan(source.indexOf('new StatisticsApiSource('));
  });

  it('reads the chain counter through the validating parser and runs warmPinnedTables through runWarmJob', () => {
    expect(source).toContain("parseChain(new URL(request.url).searchParams.get('chain'))");
    expect(source).toContain('warmPinnedTables(db, source, { deadline, sources: { eurostat } })');
    expect(source).toContain('runWarmJob(');
    expect(source).toContain('kickNext: (next) => kickWarmJob(next)');
    expect(source).toContain('alert: warmFailureAlert(db)');
  });

  it('returns only the job outcome (per-table summary) — the response never touches result rows', () => {
    expect(source).toContain('Response.json(outcome');
    expect(source).not.toMatch(/\.rows\b|failure\.summary/);
  });

  it('a database failure is a logged 500 without the failure text of any table', () => {
    expect(source).toContain("new Response('warm job error', { status: 500 })");
  });
});

describe('web/vercel.json is unchanged: the daily cron kick is the only trigger', () => {
  it('has no cron entry for the warm job', () => {
    const vercelJson = JSON.parse(readFileSync(join(__dirname, '..', 'vercel.json'), 'utf-8')) as {
      crons?: { path: string }[];
    };
    expect((vercelJson.crons ?? []).map((c) => c.path)).toEqual(['/api/onboarding-cron', '/api/gdpr-purge-cron']);
  });
});

describe('the daily kick in onboarding-cron', () => {
  const cron = read('api/onboarding-cron/route.ts');

  it('kicks the warm job through the shared fail-soft helper', () => {
    expect(cron).toContain("import { kickWarmJob } from '../../../lib/warm-job.ts'");
    expect(cron).toContain('kickWarmJob()');
  });

  it('starts the kick right after the auth guard, before the existing steps, so it cannot lengthen or fail them', () => {
    const guard = cron.indexOf('`Bearer ${cronSecret}`');
    const kick = cron.indexOf('kickWarmJob()');
    const firstStep = cron.indexOf('await runOnboardingJob(');
    expect(guard).toBeGreaterThan(-1);
    expect(kick).toBeGreaterThan(guard);
    expect(kick).toBeLessThan(firstStep);
  });

  it('does not await the job: the kick is started as a promise and settled only at the end, before the 200', () => {
    expect(cron).not.toContain('await kickWarmJob(');
    expect(cron).toContain('const warmKick = kickWarmJob()');
    const settle = cron.indexOf('await warmKick');
    const responseJson = cron.indexOf('Response.json(summary');
    expect(settle).toBeGreaterThan(cron.indexOf('new-CBS-data check failed'));
    expect(settle).toBeLessThan(responseJson);
  });

  it('the kick is fail-soft: its own guard means it can never turn the cron result into an error', () => {
    const settle = cron.indexOf('await warmKick');
    const block = cron.slice(cron.lastIndexOf('try {', settle), settle + 200);
    expect(block).toContain('warm-job kick');
    expect(block).toContain('catch');
  });
});
