// Session 110 (perf pass, second attempt — docs/session-briefs/
// 2026-09-13-build-performance-diagnosis.md, "Landing bundle" section):
// components/chart.tsx lazy-loads interaction-only chart UI via
// `next/dynamic({ ssr: false })`. jsdom has no real chunk loader, so
// `next/dynamic` itself is mocked globally here (registered via
// vitest.setup.ts's `setupFiles`, so every test file gets it without
// repeating the mock) to resolve through React.lazy + Suspense instead —
// the SAME kind of async boundary the real dynamic() import creates (a
// promise settling on a later microtask), so a test written as
// `await screen.findByRole(...)` is exercising a real async gap rather than
// being fooled by a mock that hands back the component synchronously.
//
// Adapter note: every dynamic() call in this codebase is written as
// `dynamic(() => import('./x.tsx').then((m) => m.X), { ssr: false, loading })`
// — the loader resolves DIRECTLY to the component function, not to the
// `{ default }`-shaped module namespace React.lazy expects. The
// `.then((mod) => ({ default: mod.default ?? mod }))` wrap below normalizes
// either shape (a bare component, or a real default export) so this one
// mock covers both calling conventions without each call site caring.
import { createElement, lazy, Suspense, type ComponentType } from 'react';
import { vi } from 'vitest';

type ResolvedModule<P> = { default: ComponentType<P> } | ComponentType<P>;
type Loader<P> = () => Promise<ResolvedModule<P>>;
interface DynamicOptions<P> {
  loading?: ComponentType<Record<string, never>>;
}

vi.mock('next/dynamic', () => ({
  default: <P extends object>(loader: Loader<P>, options?: DynamicOptions<P>) => {
    const LazyComponent = lazy(() =>
      loader().then((mod) => ({
        default: (mod as { default?: ComponentType<P> }).default ?? (mod as ComponentType<P>),
      })),
    );
    const fallback = options?.loading ? createElement(options.loading) : null;
    function MockedNextDynamic(props: P) {
      return createElement(Suspense, { fallback }, createElement(LazyComponent, props));
    }
    return MockedNextDynamic;
  },
}));
