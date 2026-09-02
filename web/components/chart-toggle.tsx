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
//
// #197 (session 69): exposed as a radiogroup — the two options are mutually
// exclusive, which `aria-pressed` (independent toggle buttons) mis-described
// to screen readers ("toggle button, pressed" instead of "1 of 2"). Arrow
// keys move the choice like a native radio group; the pills meet the 24px
// touch-target minimum.
import { useRef, useState, type KeyboardEvent } from 'react';
import type { ChartSpec, CuratedChartToggle } from '../backend/chart/index.ts';
import { ChartView } from './chart.tsx';

function buttonClass(active: boolean): string {
  return (
    'min-h-6 rounded-full border px-2.5 py-1 text-xs ' +
    (active
      ? 'border-line-strong bg-paper-sunken text-ink'
      : 'border-line-strong text-ink-soft hover:bg-paper-sunken')
  );
}

export function ChartWithToggle({ spec, toggle }: { spec: ChartSpec; toggle: CuratedChartToggle }) {
  const [alternate, setAlternate] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const alternateRef = useRef<HTMLButtonElement>(null);

  function select(next: boolean): void {
    setAlternate(next);
    (next ? alternateRef : primaryRef).current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      select(!alternate);
    }
  }

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="Definitie wisselen"
        onKeyDown={onKeyDown}
        className="mb-2 flex flex-wrap items-center gap-2"
      >
        <button
          ref={primaryRef}
          type="button"
          role="radio"
          aria-checked={!alternate}
          tabIndex={alternate ? -1 : 0}
          onClick={() => select(false)}
          className={buttonClass(!alternate)}
        >
          {toggle.primaryLabel}
        </button>
        <button
          ref={alternateRef}
          type="button"
          role="radio"
          aria-checked={alternate}
          tabIndex={alternate ? 0 : -1}
          onClick={() => select(true)}
          className={buttonClass(alternate)}
        >
          {toggle.alternateLabel}
        </button>
      </div>
      <ChartView spec={alternate ? toggle.alternateSpec : spec} />
    </div>
  );
}
