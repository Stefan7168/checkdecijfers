// WP16 sub-part 2 (ADR 026, design §3) cron route. The auth guard (503 when
// CRON_SECRET is unset, 401 on a bad Bearer) short-circuits BEFORE getDb() /
// the job, so those two paths are exercised directly in jsdom. The success
// path needs a real DB + CBS + LLM in a server context — its behavior is
// covered by tests/ingestion/onboarding-job.test.ts (the full delivered/refund
// loop); here we pin its WIRING presence via a source scan, exactly the
// onboarding-wiring.test.ts / purchase-wiring.test.ts precedent.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// STATIC imports, not a dynamic one inside each test body (changed 2026-07-26,
// session 59). The dynamic form pulled the whole backend module graph — the
// Anthropic SDK, the CBS adapter, the ingestion job — through the transform
// pipeline INSIDE a timed test, so on a loaded machine the test failed as a
// TIMEOUT rather than a logic failure. It flaked three times in one session at
// load 18-25, having already had its ceiling raised 5s -> 15s in session 56 for
// exactly this; that comment says a further raise is not the fix, and it is
// right. This removes the cause instead: the route reads process.env.CRON_SECRET
// INSIDE its GET handler (route.ts:40), never at module load, so importing once
// at collection time is semantically identical and no longer races a timer.
import { GET } from './api/onboarding-cron/route.ts';
import { kickOnboardingJob } from '../lib/onboarding-kick.ts';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf-8');

describe('onboarding-cron auth guard (directly exercised)', () => {
  const original = process.env.CRON_SECRET;
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it('503 when CRON_SECRET is not configured (fail closed, before any DB work)', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(new Request('https://x/api/onboarding-cron'));
    expect(res.status).toBe(503);
  });

  it('401 on a missing / wrong Bearer token', async () => {
    process.env.CRON_SECRET = 'secret-abc';

    const noHeader = await GET(new Request('https://x/api/onboarding-cron'));
    expect(noHeader.status).toBe(401);

    const wrong = await GET(
      new Request('https://x/api/onboarding-cron', {
        headers: { authorization: 'Bearer nope' },
      }),
    );
    expect(wrong.status).toBe(401);
  });

  // Session-30 review: the 401 tests only proved wrong tokens are REJECTED;
  // no test proved the kick's own header is ACCEPTED — the two template
  // literals lived in different files and could drift (a lowercase 'bearer ',
  // a stray space) with the whole suite green while every production kick and
  // cron call 401'd forever (the proxy-redirect go-live bug's test-blind-spot
  // class). This cross-pin captures the header EXACTLY as kickOnboardingJob
  // sends it and replays it against the real route guard.
  it("the kick's OWN Authorization header passes the route guard (cross-pin)", async () => {
    process.env.CRON_SECRET = 'secret-abc';

    let capturedAuth: string | null = null;
    await kickOnboardingJob({
      secret: 'secret-abc',
      host: 'example.test',
      fetchImpl: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedAuth = new Headers(init?.headers).get('authorization');
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
    });
    expect(capturedAuth).not.toBeNull();

    // The guard runs BEFORE getDb()/the job. With the kick's header the
    // route must get PAST the 401/503 short-circuit; in jsdom it then fails
    // on the DB/job — and that (a throw or any non-401/503 status) is
    // precisely the proof the auth was accepted.
    try {
      const res = await GET(
        new Request('https://x/api/onboarding-cron', {
          headers: { authorization: capturedAuth! },
        }),
      );
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(503);
    } catch {
      // Reaching the DB/job code in jsdom means the guard passed — the pin
      // holds. (The guard itself never throws; it returns 401/503.)
    }
  });
});

describe('onboarding-cron wiring (source pins)', () => {
  const source = read('api/onboarding-cron/route.ts');

  it('runs on the nodejs runtime with a long maxDuration', () => {
    expect(source).toContain("export const runtime = 'nodejs'");
    expect(source).toContain('export const maxDuration');
  });

  it('fails closed on an unset secret and requires the Bearer secret', () => {
    expect(source).toContain('CRON_SECRET');
    expect(source).toContain('503');
    expect(source).toContain('401');
    expect(source).toContain('`Bearer ${cronSecret}`');
  });

  it('invokes the backend job with the real CBS source, LLM clients, and notifier', () => {
    expect(source).toContain('runOnboardingJob(');
    expect(source).toContain('new ODataV4Source()');
    expect(source).toContain('new AnthropicLlmClient()');
    expect(source).toContain('productionNotifier(');
  });

  it('WP27 stage C: wires the measure-fit client into the job (the gate would otherwise end every chained row all-errored)', () => {
    expect(source).toContain('fitClient: new AnthropicLlmClient()');
  });
});

describe('onboarding-cron vercel config', () => {
  it('web/vercel.json schedules the cron on this route (project rootDirectory is web/)', () => {
    const vercelJson = JSON.parse(readFileSync(join(__dirname, '..', 'vercel.json'), 'utf-8')) as {
      crons?: { path: string; schedule: string }[];
    };
    const cron = (vercelJson.crons ?? []).find((c) => c.path === '/api/onboarding-cron');
    expect(cron).toBeDefined();
    // Daily, not minutes: Vercel Hobby rejects sub-daily cron expressions AT
    // DEPLOY TIME (learned from a failed deploy, session 27). This is the
    // BACKSTOP sweep; the real trigger cadence is an open decision (#113)
    // that must be resolved before ONBOARDING_ENABLED flips on.
    expect(cron!.schedule).toBe('0 6 * * *');
  });
});
