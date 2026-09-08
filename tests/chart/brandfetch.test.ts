// src/chart/brandfetch.ts — Brandfetch Brand API client (WP218 phase 3, Task
// 1). No database, no network: `fetchBrand` is exercised entirely through a
// stubbed `fetchImpl`. The load-bearing properties under test: normalizeDomain
// rejects anything that isn't a plain hostname, parseBrandPayload is
// TOLERANT (unknown → 'other'/'custom', bad hex dropped, missing arrays →
// []), pickBrandColours/pickBrandFont apply their fixed priority ladders, and
// fetchBrand NEVER throws — for any HTTP status, a rejecting fetch, a
// synchronously-throwing fetchImpl, or an aborted timeout.
import { describe, expect, it, vi } from 'vitest';
import {
  BRANDFETCH_ENDPOINT,
  FREE_MAIL_DOMAINS,
  fetchBrand,
  isFreeMailDomain,
  normalizeDomain,
  parseBrandPayload,
  pickBrandColours,
  pickBrandFont,
  type BrandInfo,
} from '../../src/chart/brandfetch.ts';

describe('normalizeDomain', () => {
  const cases: { input: string; expected: string | null }[] = [
    // the brief's own worked example
    { input: 'https://WWW.Example.nl/x', expected: 'example.nl' },
    { input: 'example.nl', expected: 'example.nl' },
    { input: 'HTTP://Example.COM:8080/path?q=1#frag', expected: 'example.com' },
    { input: 'www.sub.example.co.uk', expected: 'sub.example.co.uk' },
    { input: '', expected: null },
    { input: 'exa mple.nl', expected: null }, // internal space
    { input: 'localhost', expected: null },
    { input: 'localhost:3000', expected: null },
    { input: '192.168.1.1', expected: null }, // IPv4 literal
    { input: '[::1]', expected: null }, // bracketed IPv6 literal
    { input: '[::1]:8080', expected: null }, // bracketed IPv6 literal + port
    { input: '::1', expected: null }, // unbracketed IPv6-ish, also no dot
    { input: 'example', expected: null }, // no dot
    { input: `${'a'.repeat(251)}.nl`, expected: null }, // > 253 chars
    { input: 'exa_mple.nl', expected: null }, // disallowed character
    { input: '-example.nl', expected: null }, // leading hyphen
    { input: 'example-.nl', expected: null }, // trailing hyphen on a label
    { input: 'example..nl', expected: null }, // empty label (double dot)
    { input: '.example.nl', expected: null }, // leading dot
    { input: 'example.nl.', expected: null }, // trailing dot
  ];

  for (const { input, expected } of cases) {
    it(`${JSON.stringify(input.length > 40 ? input.slice(0, 40) + '…' : input)} → ${JSON.stringify(expected)}`, () => {
      expect(normalizeDomain(input)).toBe(expected);
    });
  }
});

describe('FREE_MAIL_DOMAINS / isFreeMailDomain', () => {
  it('contains the brief\'s full list verbatim (24 entries)', () => {
    expect(FREE_MAIL_DOMAINS).toEqual([
      'gmail.com',
      'googlemail.com',
      'hotmail.com',
      'hotmail.nl',
      'outlook.com',
      'live.nl',
      'live.com',
      'yahoo.com',
      'yahoo.nl',
      'icloud.com',
      'me.com',
      'ziggo.nl',
      'kpnmail.nl',
      'kpnplanet.nl',
      'home.nl',
      'casema.nl',
      'hetnet.nl',
      'planet.nl',
      'xs4all.nl',
      'protonmail.com',
      'proton.me',
      'mail.com',
      'gmx.com',
      'gmx.net',
    ]);
  });

  it('recognizes a free-mail domain, case-insensitively', () => {
    expect(isFreeMailDomain('gmail.com')).toBe(true);
    expect(isFreeMailDomain('GMAIL.com')).toBe(true);
    expect(isFreeMailDomain('protonmail.com')).toBe(true);
    expect(isFreeMailDomain('gmx.net')).toBe(true);
  });

  it('rejects a company domain', () => {
    expect(isFreeMailDomain('acme.nl')).toBe(false);
    expect(isFreeMailDomain('checkdecijfers.nl')).toBe(false);
  });
});

describe('parseBrandPayload', () => {
  // Field names copied from the research file's confirmed schema
  // (colors[].hex/type/brightness, fonts[].name/type/origin/originId/weights).
  const realisticPayload = {
    id: 'brand_123',
    name: 'Acme BV',
    domain: 'acme.nl',
    claimed: false,
    colors: [
      { hex: '#2557D6', type: 'brand', brightness: 84 },
      { hex: '#FF6600', type: 'accent', brightness: 120 },
      { hex: '#abc', type: 'not-a-real-type', brightness: 200 }, // unknown type + short hex
    ],
    fonts: [
      { name: 'Inter', type: 'title', origin: 'google', originId: 'Inter', weights: [] },
      { name: 'Helvetica', type: 'body', origin: 'system', originId: null, weights: [] },
    ],
  };

  it('parses a realistic payload into typed BrandInfo', () => {
    const brand = parseBrandPayload(realisticPayload, 'acme.nl');
    expect(brand).toEqual<BrandInfo>({
      name: 'Acme BV',
      domain: 'acme.nl',
      colors: [
        { hex: '#2557d6', type: 'brand' },
        { hex: '#ff6600', type: 'accent' },
        { hex: '#aabbcc', type: 'other' },
      ],
      fonts: [
        { family: 'Inter', role: 'title', origin: 'google' },
        { family: 'Helvetica', role: 'body', origin: 'system' },
      ],
    });
  });

  it('uses the passed domain argument, not any domain field in the payload', () => {
    const brand = parseBrandPayload(realisticPayload, 'requested-domain.nl');
    expect(brand?.domain).toBe('requested-domain.nl');
  });

  it.each([
    ['not an object', 'a plain string'],
    [42, 'a number'],
    [null, 'null'],
    [undefined, 'undefined'],
    [[], 'an array'],
    [{}, 'an object with no name'],
    [{ name: '' }, 'an empty name'],
    [{ name: 123 }, 'a non-string name'],
  ])('returns null for junk: %s (%s)', (junk, _label) => {
    expect(parseBrandPayload(junk, 'example.nl')).toBeNull();
  });

  it('drops a colour entry with an unparsable hex', () => {
    const brand = parseBrandPayload(
      { name: 'X', colors: [{ hex: 'not-a-color', type: 'brand' }, { hex: '#111', type: 'accent' }] },
      'x.nl',
    );
    expect(brand?.colors).toEqual([{ hex: '#111111', type: 'accent' }]);
  });

  it('defaults missing colors/fonts arrays to []', () => {
    const brand = parseBrandPayload({ name: 'X' }, 'x.nl');
    expect(brand).toEqual<BrandInfo>({ name: 'X', domain: 'x.nl', colors: [], fonts: [] });
  });

  it('treats a non-array colors/fonts field as missing (→ [])', () => {
    const brand = parseBrandPayload({ name: 'X', colors: 'oops', fonts: 42 }, 'x.nl');
    expect(brand).toEqual<BrandInfo>({ name: 'X', domain: 'x.nl', colors: [], fonts: [] });
  });

  it('drops a font entry with no usable name', () => {
    const brand = parseBrandPayload(
      { name: 'X', fonts: [{ type: 'title', origin: 'google' }, { name: '  ', type: 'body' }] },
      'x.nl',
    );
    expect(brand?.fonts).toEqual([]);
  });

  it('maps an unknown font origin to custom (skippable, never a crash)', () => {
    const brand = parseBrandPayload(
      { name: 'X', fonts: [{ name: 'MysteryFont', type: 'body', origin: 'something-else' }] },
      'x.nl',
    );
    expect(brand?.fonts).toEqual([{ family: 'MysteryFont', role: 'body', origin: 'custom' }]);
  });

  it('maps an unknown font type (role) to other', () => {
    const brand = parseBrandPayload(
      { name: 'X', fonts: [{ name: 'MysteryFont', type: 'subtitle', origin: 'google' }] },
      'x.nl',
    );
    expect(brand?.fonts).toEqual([{ family: 'MysteryFont', role: 'other', origin: 'google' }]);
  });
});

describe('pickBrandColours', () => {
  function brandWithColors(colors: BrandInfo['colors']): BrandInfo {
    return { name: 'X', domain: 'x.nl', colors, fonts: [] };
  }

  it('orders brand → accent → dark → light → other, regardless of input order', () => {
    const brand = brandWithColors([
      { hex: '#111111', type: 'other' },
      { hex: '#222222', type: 'light' },
      { hex: '#333333', type: 'dark' },
      { hex: '#444444', type: 'accent' },
      { hex: '#555555', type: 'brand' },
    ]);
    expect(pickBrandColours(brand)).toEqual(['#555555', '#444444', '#333333', '#222222', '#111111']);
  });

  it('de-duplicates by hex across types', () => {
    const brand = brandWithColors([
      { hex: '#abcabc', type: 'brand' },
      { hex: '#abcabc', type: 'accent' },
      { hex: '#defdef', type: 'accent' },
    ]);
    expect(pickBrandColours(brand)).toEqual(['#abcabc', '#defdef']);
  });

  it('caps the result at 8 colours', () => {
    const colors: BrandInfo['colors'] = Array.from({ length: 10 }, (_, i) => ({
      hex: `#${String(i).padStart(6, '0')}`,
      type: 'other' as const,
    }));
    const picked = pickBrandColours(brandWithColors(colors));
    expect(picked).toHaveLength(8);
    expect(picked).toEqual(colors.slice(0, 8).map((c) => c.hex));
  });

  it('returns [] for a brand with no colours', () => {
    expect(pickBrandColours(brandWithColors([]))).toEqual([]);
  });
});

describe('pickBrandFont', () => {
  function brandWithFonts(fonts: BrandInfo['fonts']): BrandInfo {
    return { name: 'X', domain: 'x.nl', colors: [], fonts };
  }

  it('prefers body-google first', () => {
    const brand = brandWithFonts([
      { family: 'TitleFont', role: 'title', origin: 'google' },
      { family: 'BodyFont', role: 'body', origin: 'google' },
      { family: 'SystemBody', role: 'body', origin: 'system' },
    ]);
    expect(pickBrandFont(brand)).toEqual({ family: 'BodyFont', origin: 'google' });
  });

  it('falls back to title-google when no body-google is present', () => {
    const brand = brandWithFonts([
      { family: 'TitleFont', role: 'title', origin: 'google' },
      { family: 'SystemBody', role: 'body', origin: 'system' },
    ]);
    expect(pickBrandFont(brand)).toEqual({ family: 'TitleFont', origin: 'google' });
  });

  it('falls back to body-system when no google fonts are present', () => {
    const brand = brandWithFonts([
      { family: 'SystemTitle', role: 'title', origin: 'system' },
      { family: 'SystemBody', role: 'body', origin: 'system' },
    ]);
    expect(pickBrandFont(brand)).toEqual({ family: 'SystemBody', origin: 'system' });
  });

  it('falls back to title-system as the last rung', () => {
    const brand = brandWithFonts([{ family: 'SystemTitle', role: 'title', origin: 'system' }]);
    expect(pickBrandFont(brand)).toEqual({ family: 'SystemTitle', origin: 'system' });
  });

  it('returns null when nothing matches the ladder', () => {
    expect(pickBrandFont(brandWithFonts([]))).toBeNull();
  });

  it('skips a custom-origin font entirely, even for body role', () => {
    const brand = brandWithFonts([{ family: 'CustomFont', role: 'body', origin: 'custom' }]);
    expect(pickBrandFont(brand)).toBeNull();
  });

  it('skips a font whose family name fails the allowed-characters check', () => {
    const brand = brandWithFonts([
      { family: 'Comic Sans!!', role: 'body', origin: 'google' }, // invalid: '!' not allowed
      { family: 'Valid Font', role: 'title', origin: 'google' },
    ]);
    // body-google's only candidate is invalid, so the ladder proceeds to
    // title-google rather than returning the invalid name.
    expect(pickBrandFont(brand)).toEqual({ family: 'Valid Font', origin: 'google' });
  });
});

describe('fetchBrand', () => {
  const apiKey = 'test-api-key-123';

  function jsonFetch(status: number, body: unknown) {
    return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
  }

  it('200 → parses and returns ok:true, calling fetchImpl with the right URL + headers', async () => {
    const payload = { name: 'Acme BV', colors: [], fonts: [] };
    const mock = jsonFetch(200, payload);

    const result = await fetchBrand('https://www.Acme.nl', {
      apiKey,
      fetchImpl: mock as unknown as typeof fetch,
    });

    expect(result).toEqual({
      ok: true,
      brand: { name: 'Acme BV', domain: 'acme.nl', colors: [], fonts: [] },
    });
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe(`${BRANDFETCH_ENDPOINT}acme.nl`);
    expect(init).toMatchObject({
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
  });

  it('200 with an unparsable body → unavailable', async () => {
    const mock = jsonFetch(200, { no: 'name field here' });
    const result = await fetchBrand('example.nl', { apiKey, fetchImpl: mock as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('200 with a body that is not valid JSON at all → unavailable, never throws', async () => {
    const mock = vi.fn(async () => new Response('this is not json{{{', { status: 200 }));
    await expect(
      fetchBrand('example.nl', { apiKey, fetchImpl: mock as unknown as typeof fetch }),
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('404 → not_found', async () => {
    const mock = jsonFetch(404, { message: 'Not Found' });
    const result = await fetchBrand('example.nl', { apiKey, fetchImpl: mock as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('401 → unauthorized', async () => {
    const mock = jsonFetch(401, { message: 'Unauthorized' });
    const result = await fetchBrand('example.nl', { apiKey, fetchImpl: mock as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('403 → unauthorized', async () => {
    const mock = jsonFetch(403, { message: 'Forbidden' });
    const result = await fetchBrand('example.nl', { apiKey, fetchImpl: mock as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('429 → rate_limited', async () => {
    const mock = jsonFetch(429, { message: 'quota exceeded' });
    const result = await fetchBrand('example.nl', { apiKey, fetchImpl: mock as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, reason: 'rate_limited' });
  });

  it('500 → unavailable', async () => {
    const mock = jsonFetch(500, { message: 'server error' });
    const result = await fetchBrand('example.nl', { apiKey, fetchImpl: mock as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('a rejecting fetchImpl → unavailable, never throws', async () => {
    const mock = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(
      fetchBrand('example.nl', { apiKey, fetchImpl: mock as unknown as typeof fetch }),
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('a SYNCHRONOUSLY-throwing fetchImpl → unavailable, never throws', async () => {
    const mock = vi.fn(() => {
      throw new Error('boom, thrown before any promise exists');
    });
    await expect(
      fetchBrand('example.nl', { apiKey, fetchImpl: mock as unknown as typeof fetch }),
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('an aborted timeout → unavailable, never throws or hangs', async () => {
    const hangingFetch = ((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }) as unknown as typeof fetch;

    const result = await fetchBrand('example.nl', { apiKey, fetchImpl: hangingFetch, timeoutMs: 10 });
    expect(result).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('an invalid domain short-circuits before ever calling fetchImpl', async () => {
    const mock = vi.fn();
    const result = await fetchBrand('not a domain', { apiKey, fetchImpl: mock as unknown as typeof fetch });
    expect(result).toEqual({ ok: false, reason: 'invalid_domain' });
    expect(mock).not.toHaveBeenCalled();
  });
});
