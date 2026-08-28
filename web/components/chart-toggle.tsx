'use client';
// #170(4) — the narrow-scope definition toggle (open-questions #170 item 4;
// design note: docs/session-briefs/2026-07-18-parked-ideas-architecture-
// sketches.md §4). Two PRE-BUILT, independently server-validated chart specs
// (src/chart/curated.ts's CuratedChart.toggle) — this component only ever
// swaps which one is passed to ChartView. No new query, no client-side
// computation of any value: the toggle is pure UI state, so R6's guarantee
// (specs are deterministic verbatim projections built by code from
// validated results) is unaffected by which of the two is on screen.
//
// Deliberately NOT the general Phase-2 definition-switching mechanism
// (open-questions #46) — one hardcoded pair per chart, styled after the
// existing segmented-button pattern in feedback-buttons.tsx.
import { useState } from 'react';
import type { ChartSpec, CuratedChartToggle } from '../backend/chart/index.ts';
import { ChartView } from './chart.tsx';

function buttonClass(active: boolean): string {
  return (
    'rounded-full border px-2 py-0.5 text-xs ' +
    (active
      ? 'border-line-strong bg-paper-sunken text-ink'
      : 'border-line-strong text-ink-soft hover:bg-paper-sunken')
  );
}

export function ChartWithToggle({ spec, toggle }: { spec: ChartSpec; toggle: CuratedChartToggle }) {
  const [alternate, setAlternate] = useState(false);
  return (
    <div>
      <div role="group" aria-label="Definitie wisselen" className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={!alternate}
          onClick={() => setAlternate(false)}
          className={buttonClass(!alternate)}
        >
          {toggle.primaryLabel}
        </button>
        <button
          type="button"
          aria-pressed={alternate}
          onClick={() => setAlternate(true)}
          className={buttonClass(alternate)}
        >
          {toggle.alternateLabel}
        </button>
      </div>
      <ChartView spec={alternate ? toggle.alternateSpec : spec} />
    </div>
  );
}
