import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPanelStorage } from './panel-storage.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getPanelStorage', () => {
  it('returns the real localStorage when it is available (the normal browser/jsdom case)', () => {
    expect(getPanelStorage()).toBe(localStorage);
  });

  it('falls back to a no-op storage when localStorage is unavailable (the SSR case)', () => {
    // Simulates Next.js server-rendering this 'use client' component: no
    // bare `localStorage` global exists in that Node environment. Using
    // `vi.stubGlobal` (rather than deleting a jsdom-provided property)
    // rebinds the global cleanly and is restored by `vi.unstubAllGlobals`.
    vi.stubGlobal('localStorage', undefined);
    const storage = getPanelStorage();
    expect(() => storage.getItem('x')).not.toThrow();
    expect(storage.getItem('x')).toBeNull();
    expect(() => storage.setItem('x', 'y')).not.toThrow();
  });
});
