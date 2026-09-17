import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
// Session 110 perf pass: global next/dynamic mock (see the file's own
// header for why) so every test file's dynamic()-wrapped components resolve
// through a real, awaitable async boundary instead of jsdom trying (and
// failing) to fetch a real chunk.
import './test/mock-next-dynamic.ts';

// Same class as vitest.config.ts's own testTimeout history (session 56):
// slow is fine, flaky is not. Testing-library's default `findBy`/`waitFor`
// timeout (1000ms) is tuned for instant, already-loaded content — but the
// FIRST render in this process to open a next/dynamic-wrapped component
// (components/chart.test.tsx's Style/Insights panels, session 110's perf
// pass) pays a real, one-time cost: transforming and evaluating a
// module this size (chart-config-panel.tsx alone is ~1900 lines) under
// vitest, on a loaded machine running other suites in parallel, measurably
// exceeded 1000ms and timed out two of chart.test.tsx's own tests — not a
// logic bug (every later test opening the same panel resolves instantly,
// since the module is now cached) but a cold-start latency the default
// timeout wasn't sized for. Raised once, globally, rather than passing a
// one-off `{ timeout }` to every affected call site.
configure({ asyncUtilTimeout: 5_000 });
