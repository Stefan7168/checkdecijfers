'use client';
// The chart legend — lifted VERBATIM out of web/components/chart.tsx in
// co-pilot phase 2 (session 113 Task 5) so both cards use the same one: the
// CBS card (chart.tsx) and the own-data card (user-chart.tsx). Markup, aria
// and `data-command-kind` are unchanged by the move; chart.tsx now imports
// it. Its own history is in the doc comment below.
import { t, type Lang } from '../lib/i18n/messages.ts';

/** The three fields the legend reads off a series — structurally `SeriesMeta`
 * (chart.tsx), declared locally so this leaf carries no import edge back
 * into the 4,600-line card that also imports it. */
export interface LegendSeries {
  key: string;
  label: string;
  color: string;
}

/** #197 idea 6: a real interactive legend, replacing Recharts' decorative
 * default. One button per series toggles it in/out of the chart; hidden
 * series stay listed (dimmed) so they can be brought back. Client-side
 * presentation only — never touches the spec or the audit record
 * (open-questions #46(b)).
 *
 * Task 5 (#212 series highlight): a second, independent button per series —
 * "Markeer X" — dims every OTHER series (strokeOpacity/fillOpacity on the
 * Line/Bar elements below) without hiding them. Independent of the hide
 * toggle: a highlighted series can still be hidden. Hiding the currently
 * highlighted series clears the highlight too (chartViewReducer's
 * 'toggleSeries' case) — otherwise every OTHER visible series would stay
 * dimmed with nothing actually highlighted on screen, a confusing dead state
 * a review caught after this landed. The highlight button is disabled while
 * its own series is hidden, since "highlight a series that isn't drawn" has
 * nothing to dim relative to. */
export function SeriesLegend({
  seriesMeta,
  hiddenKeys,
  highlightedKey,
  onToggle,
  onHighlight,
  lang,
  disabled = false,
  disabledReasonId,
}: {
  seriesMeta: LegendSeries[];
  hiddenKeys: Set<string>;
  highlightedKey: string | null;
  onToggle: (key: string) => void;
  onHighlight: (key: string | null) => void;
  lang: Lang;
  // Story mode (session 92 review fix): while the story is open, the chart
  // must keep showing exactly what the active step's caption describes —
  // hiding or highlighting a series out from under a live caption would
  // contradict it. `disabled` locks both buttons per series; `disabledReasonId`
  // points at the one shared `${domId}-story-lock` span rendered near the
  // panel, so every locked control shares the same reason via
  // aria-describedby instead of duplicating the string per button.
  disabled?: boolean;
  disabledReasonId?: string;
}) {
  const lockedTitle = disabled ? t(lang, 'chart.story.controlsLocked') : undefined;
  return (
    <div
      role="group"
      aria-label={t(lang, 'chart.seriesGroupLabel')}
      data-command-kind="setSeriesView"
      className="mt-2 flex flex-wrap gap-x-3 gap-y-1"
    >
      {seriesMeta.map((s) => {
        const hidden = hiddenKeys.has(s.key);
        const highlighted = highlightedKey === s.key;
        return (
          <span key={s.key} className="inline-flex items-center gap-1">
            <button
              type="button"
              /* Pressed = shown (the toggle's "on" state), not "is hidden" --
               * the accessible name is just the series label ("Nederland"), so
               * aria-pressed={hidden} would announce "pressed" exactly when
               * the series is OFF. Matches the fix already applied once
               * elsewhere in this codebase for the same mistake (see
               * chart-toggle.tsx). */
              aria-pressed={!hidden}
              data-command-kind="toggleSeries"
              disabled={disabled}
              onClick={() => onToggle(s.key)}
              title={lockedTitle}
              aria-describedby={disabled ? disabledReasonId : undefined}
              // ADR 042: the series (hide/show) button is a chip — rounded-
              // full, bordered — so the legend reads as a set of toggleable
              // tags rather than plain text links. The highlight button
              // right below keeps its quiet text style; only this one
              // becomes a chip.
              className={
                'inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ' +
                (hidden ? 'border-border text-muted-foreground line-through' : 'border-border bg-background text-foreground hover:bg-muted')
              }
            >
              <span
                aria-hidden="true"
                style={{ backgroundColor: hidden ? 'var(--muted-foreground)' : s.color }}
                className="inline-block h-2.5 w-2.5 rounded-full"
              />
              {s.label}
            </button>
            <button
              type="button"
              aria-pressed={highlighted}
              data-command-kind="setHighlight"
              disabled={hidden || disabled}
              onClick={() => onHighlight(highlighted ? null : s.key)}
              /* A locked legend takes priority over the plain highlight-title
               * (kept only while NOT locked, per the review fix's own note
               * that a control already carrying a `title` keeps the lock
               * reason in aria-describedby and sets `title` only while
               * locked). */
              title={disabled ? lockedTitle : t(lang, 'chart.highlightTitle', { label: s.label })}
              aria-describedby={disabled ? disabledReasonId : undefined}
              className={
                'min-h-6 rounded-md px-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 ' +
                (highlighted ? 'text-foreground font-semibold' : 'text-muted-foreground')
              }
            >
              {t(lang, 'chart.highlightButton', { label: s.label })}
            </button>
          </span>
        );
      })}
    </div>
  );
}
