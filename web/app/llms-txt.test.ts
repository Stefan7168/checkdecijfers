// #170(2): the /llms.txt route — thin adapter over web/lib/llms-txt.ts; the
// route test pins status/headers for both postures (body present → 200
// text/plain; never-built → honest 503 + Retry-After, so a crawler retries
// instead of caching an empty coverage claim).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadLlmsTxtBody } = vi.hoisted(() => ({ loadLlmsTxtBody: vi.fn() }));
vi.mock('../lib/llms-txt.ts', () => ({ loadLlmsTxtBody }));

describe('GET /llms.txt', () => {
  beforeEach(() => {
    loadLlmsTxtBody.mockReset();
  });

  it('200 text/plain with the generated body', async () => {
    loadLlmsTxtBody.mockResolvedValue('# Check de Cijfers\n\n- CBS 86141NED — titel\n');
    const { GET } = await import('./llms.txt/route.ts');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('cache-control')).toContain('max-age=1800');
    expect(await res.text()).toContain('CBS 86141NED');
  });

  it('503 + Retry-After when no coverage build has ever succeeded', async () => {
    loadLlmsTxtBody.mockResolvedValue(null);
    const { GET } = await import('./llms.txt/route.ts');
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('600');
  });
});
