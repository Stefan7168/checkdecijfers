// #170(2): GET /llms.txt — the honest, registry-generated self-description
// for LLMs and crawlers. Thin adapter over web/lib/llms-txt.ts (the
// onboarding-cron route precedent): node runtime because the coverage read
// goes through pg + the pinned Supabase CA; force-dynamic so `next build`
// never tries to prerender a DB read at build time — freshness comes from
// the lib's own TTL cache, surfaced to shared caches via Cache-Control.
//
// Note (coordination, not this route's call): web/app/robots.ts still
// carries the Phase-0 blanket disallow, so robots-respecting crawlers won't
// fetch this until that posture is relaxed at public launch. Direct fetches
// (how LLM agents typically read llms.txt) work today.
import { loadLlmsTxtBody } from '../../lib/llms-txt.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const body = await loadLlmsTxtBody();
  if (body === null) {
    // Never a silently empty coverage list — a crawler would cache
    // "covers nothing" as truth. 503 + Retry-After is the honest signal.
    return new Response('Tijdelijk niet beschikbaar. / Temporarily unavailable.\n', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '600' },
    });
  }
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=1800',
    },
  });
}
