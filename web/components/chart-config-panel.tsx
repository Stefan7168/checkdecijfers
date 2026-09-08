'use client';
// WP218 phase 1 (#218 chart styling): the "Opmaak" (Style) panel — a DUMB
// component over chart-presentation.ts's pure resolver. It never holds its
// own copy of a preferred value: every control's checked/pressed state is
// read straight from `resolved.values` on each render, and a click emits
// `onChange({ [key]: nextValue })` for exactly the one control touched — the
// caller (a reducer, later tasks) folds that into the overrides it re-runs
// through `resolvePresentation`, which is the only place that recomputes the
// effective ChartPresentation. This file never imports Recharts and never
// computes a presentation value itself.
//
// A control whose key is outside `resolved.applicable` (e.g. `lineWidth` on
// a bar chart) is not rendered at all — offering a knob that does nothing
// would be a silent lie. A control whose key IS in `resolved.locks` (e.g.
// `valueLabels` forced on for bar charts) stays visible but disabled, with
// the resolver's own digit-free Dutch reason exposed via `aria-describedby`
// pointing at a visually-hidden span — a plain `title` tooltip alone is
// invisible to a screen reader.
//
// House patterns reused: the hand-rolled tablist + roving-tabindex segment
// buttons from chart.tsx's Lijn/Staaf/Tabel switch (`onFormTabKeyDown`,
// `segmentTab`), the `role="radiogroup"` pill pattern from chart-toggle.tsx,
// `aria-pressed` toggles from chart.tsx's SeriesLegend, and the Escape-closes
// -and-refocuses-the-trigger behaviour from chart-download.tsx's disclosure
// menu (`closeAndRefocus`).
//
// Kleuren/Lettertype tab bodies are empty placeholders here — Task 6 fills
// them (the Colours tab needs `seriesMeta`, unused by this task's Grafiek
// tab but already part of the props contract so Task 6 is additive).
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import {
  FONT_OPTIONS,
  judgeColor,
  normalizeHex,
  type PresentationKey,
  type PresentationOverrides,
  type ResolvedPresentation,
} from '../lib/chart-presentation.ts';
import { cn } from '../lib/utils.ts';
import { Button } from './ui/button.tsx';
import { Input } from './ui/input.tsx';

export type PanelLang = 'nl' | 'en';

interface PanelCopyOptions {
  lineWidth: readonly [string, string, string, string];
  markers: readonly [string, string];
  grid: readonly [string, string, string];
  xLabels: readonly [string, string];
}

interface PanelCopyShape {
  trigger: string;
  regionLabel: string;
  tabsLabel: string;
  tabChart: string;
  tabColors: string;
  tabFont: string;
  lineWidth: string;
  markers: string;
  grid: string;
  xLabels: string;
  axisLines: string;
  valueLabels: string;
  zeroBaseline: string;
  reset: string;
  options: PanelCopyOptions;
  /** Kleuren tab (Task 6). `colourOf`/`hexSuffix`/`pickSuffix` assemble into
   * the per-row accessible names: "{colourOf} {label} {hexSuffix}" for the
   * hex box, "{colourOf} {label} {pickSuffix}" for the native colour picker —
   * kept as separate atoms (not two pre-joined templates) so a future label
   * wording change can't accidentally desync the two names from each other. */
  colourOf: string;
  hexSuffix: string;
  pickSuffix: string;
  resetColors: string;
  warnLight: string;
  warnDark: string;
  warnBoth: string;
  /** Lettertype tab (Task 6). */
  font: string;
  fontDefault: string;
}

export const PANEL_COPY: Record<PanelLang, PanelCopyShape> = {
  nl: {
    trigger: 'Opmaak',
    regionLabel: 'Opmaak van de grafiek',
    tabsLabel: 'Opmaak-onderdelen',
    tabChart: 'Grafiek',
    tabColors: 'Kleuren',
    tabFont: 'Lettertype',
    lineWidth: 'Lijndikte',
    markers: 'Punten',
    grid: 'Rasterlijnen',
    xLabels: 'Labels op de x-as',
    axisLines: 'Aslijnen tonen',
    valueLabels: 'Waarden tonen',
    zeroBaseline: 'Y-as vanaf nul',
    reset: 'Standaard',
    options: {
      lineWidth: ['Dun', 'Normaal', 'Dik', 'Extra dik'],
      markers: ['Alle punten', 'Alleen voorlopige'],
      grid: ['Beide', 'Alleen horizontaal', 'Geen'],
      xLabels: ['Horizontaal', 'Schuin'],
    },
    colourOf: 'Kleur van',
    hexSuffix: '(hex-code)',
    pickSuffix: 'kiezen',
    resetColors: 'Standaardkleuren',
    warnLight: 'Deze kleur is slecht leesbaar in het lichte thema.',
    warnDark: 'Deze kleur is slecht leesbaar in het donkere thema.',
    warnBoth: 'Deze kleur is slecht leesbaar in beide thema’s.',
    font: 'Lettertype',
    fontDefault: 'Standaard',
  },
  en: {
    trigger: 'Style',
    regionLabel: 'Chart style',
    tabsLabel: 'Style sections',
    tabChart: 'Chart',
    tabColors: 'Colours',
    tabFont: 'Font',
    lineWidth: 'Line thickness',
    markers: 'Points',
    grid: 'Gridlines',
    xLabels: 'X-axis labels',
    axisLines: 'Show axis lines',
    valueLabels: 'Show values',
    zeroBaseline: 'Y-axis from zero',
    reset: 'Default',
    options: {
      lineWidth: ['Thin', 'Normal', 'Thick', 'Extra thick'],
      markers: ['All points', 'Provisional only'],
      grid: ['Both', 'Horizontal only', 'None'],
      xLabels: ['Flat', 'Tilted'],
    },
    colourOf: 'Colour of',
    hexSuffix: '(hex code)',
    pickSuffix: 'picker',
    resetColors: 'Default colours',
    warnLight: 'This colour is hard to read in the light theme.',
    warnDark: 'This colour is hard to read in the dark theme.',
    warnBoth: 'This colour is hard to read in both themes.',
    font: 'Font',
    fontDefault: 'Default',
  },
};

type TabKey = 'chart' | 'colors' | 'font';
const TAB_ORDER: readonly TabKey[] = ['chart', 'colors', 'font'];

type RadioKey = 'lineWidth' | 'markers' | 'grid' | 'xLabels';
interface RadioGroupDef {
  key: RadioKey;
  label: string;
  options: { value: string; label: string }[];
}

// Value order matches PANEL_COPY.options[<key>] index for index, so the
// English/Dutch labels line up with the presentation values without a
// separate mapping table.
const RADIO_GROUPS: readonly { key: RadioKey; values: readonly string[] }[] = [
  { key: 'lineWidth', values: ['thin', 'normal', 'thick', 'extraThick'] },
  { key: 'markers', values: ['all', 'provisionalOnly'] },
  { key: 'grid', values: ['both', 'horizontal', 'none'] },
  { key: 'xLabels', values: ['flat', 'tilted'] },
];

function buildRadioGroups(copy: PanelCopyShape): RadioGroupDef[] {
  return RADIO_GROUPS.map(({ key, values }) => ({
    key,
    label: copy[key],
    options: values.map((value, i) => ({ value, label: copy.options[key][i] })),
  }));
}

type ToggleKey = 'axisLines' | 'valueLabels' | 'zeroBaseline';
interface ToggleDef {
  key: ToggleKey;
  label: string;
  onValue: string;
  offValue: string;
}

function buildToggles(copy: PanelCopyShape): ToggleDef[] {
  return [
    { key: 'axisLines', label: copy.axisLines, onValue: 'shown', offValue: 'hidden' },
    { key: 'valueLabels', label: copy.valueLabels, onValue: 'shown', offValue: 'hidden' },
    { key: 'zeroBaseline', label: copy.zeroBaseline, onValue: 'zero', offValue: 'auto' },
  ];
}

// Session-87 shadcn-style segment track (copied verbatim from chart.tsx's
// segmentTab so the two in-app tablists — Lijn/Staaf/Tabel and this one —
// read as one visual system).
function segmentTab(active: boolean): string {
  return cn(
    'min-h-6 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
    active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
  );
}

// The pill style shared by every radio option and toggle button (chart-
// toggle.tsx's buttonClass, extended with a disabled state for locked
// controls).
function pillClass(active: boolean): string {
  return cn(
    'min-h-6 rounded-full border px-2.5 py-1 text-xs',
    active
      ? 'border-transparent bg-secondary text-foreground'
      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
    'disabled:cursor-not-allowed disabled:opacity-40',
  );
}

function warningText(copy: PanelCopyShape, warning: 'light' | 'dark' | 'both' | null): string | null {
  if (warning === 'light') return copy.warnLight;
  if (warning === 'dark') return copy.warnDark;
  if (warning === 'both') return copy.warnBoth;
  return null;
}

const ARROW_KEYS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];

/** Roving-tabindex arrow-key move for a radiogroup built as a plain loop
 * (Task 5's "one loop, not seven copies" requirement) — rather than holding
 * a ref per option, the next pill is found by DOM position within the
 * group that fired the event and both focused and activated, matching the
 * ref-based versions elsewhere (chart.tsx, chart-toggle.tsx) in behaviour. */
function onRadioGroupKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
  if (!ARROW_KEYS.includes(event.key)) return;
  event.preventDefault();
  const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  if (radios.length === 0) return;
  const dir = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
  const currentIdx = radios.indexOf(document.activeElement as HTMLButtonElement);
  const nextIdx = ((currentIdx === -1 ? 0 : currentIdx) + dir + radios.length) % radios.length;
  radios[nextIdx].focus();
  radios[nextIdx].click();
}

export interface ChartConfigPanelProps {
  resolved: ResolvedPresentation;
  seriesMeta: { key: string; label: string; color: string }[];
  onChange: (patch: PresentationOverrides) => void;
  onReset: () => void;
  idPrefix: string;
  lang?: PanelLang;
  /** WP218 phase 6: fired once each time the panel opens; optional and
   * unused by this task (no phase-6 consumer exists yet). */
  onOpen?: () => void;
}

export function ChartConfigPanel({
  resolved,
  seriesMeta,
  onChange,
  onReset,
  idPrefix,
  lang = 'nl',
  onOpen,
}: ChartConfigPanelProps) {
  const copy = PANEL_COPY[lang];
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('chart');
  const chartTabRef = useRef<HTMLButtonElement>(null);
  const colorsTabRef = useRef<HTMLButtonElement>(null);
  const fontTabRef = useRef<HTMLButtonElement>(null);
  const tabRefs: Record<TabKey, typeof chartTabRef> = {
    chart: chartTabRef,
    colors: colorsTabRef,
    font: fontTabRef,
  };

  // Kleuren tab: a local edit buffer per series index. `resolved.values
  // .seriesColors` (via `seriesMeta[i].color`, the already-resolved effective
  // colour) is the source of truth; a draft exists only for text the user is
  // actively typing or that a refused/garbage commit snapped back from. A
  // successful commit still records its normalised hex here rather than
  // clearing it, so the hex box shows the just-picked colour immediately
  // instead of flashing back to the old prop value until the caller's
  // reducer re-resolves and a new `seriesMeta` prop arrives.
  const [colorDrafts, setColorDrafts] = useState<Record<number, string>>({});
  const [colorWarnings, setColorWarnings] = useState<Record<number, 'light' | 'dark' | 'both' | null>>({});
  const [colorAlerts, setColorAlerts] = useState<Record<number, string | null>>({});
  const currentColors = resolved.values.seriesColors;

  function commitColor(index: number, effectiveColor: string, rawValue: string): void {
    const hex = normalizeHex(rawValue);
    if (hex === null) {
      // Garbage: snap back without a word — nothing valid was ever offered.
      setColorDrafts((d) => ({ ...d, [index]: effectiveColor }));
      setColorAlerts((a) => ({ ...a, [index]: null }));
      return;
    }
    const verdict = judgeColor(hex);
    if (!verdict.ok) {
      setColorDrafts((d) => ({ ...d, [index]: effectiveColor }));
      setColorAlerts((a) => ({ ...a, [index]: verdict.reason }));
      return;
    }
    setColorAlerts((a) => ({ ...a, [index]: null }));
    setColorWarnings((w) => ({ ...w, [index]: verdict.warning }));
    setColorDrafts((d) => ({ ...d, [index]: hex }));
    onChange({ seriesColors: { ...currentColors, [index]: hex } });
  }

  const triggerId = `${idPrefix}-style-trigger`;
  const regionId = `${idPrefix}-style`;
  const tabId = (key: TabKey) => `${idPrefix}-style-tab-${key}`;
  const panelId = (key: TabKey) => `${idPrefix}-style-panel-${key}`;

  function toggleOpen(): void {
    setOpen((wasOpen) => {
      if (!wasOpen) onOpen?.();
      return !wasOpen;
    });
  }

  function closeAndRefocus(): void {
    setOpen(false);
    document.getElementById(triggerId)?.focus();
  }

  function onRegionKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndRefocus();
    }
  }

  function selectTab(next: TabKey): void {
    setActiveTab(next);
    tabRefs[next].current?.focus();
  }

  function onTabsKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!ARROW_KEYS.includes(event.key)) return;
    event.preventDefault();
    const dir = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const idx = TAB_ORDER.indexOf(activeTab);
    selectTab(TAB_ORDER[(idx + dir + TAB_ORDER.length) % TAB_ORDER.length]!);
  }

  function emit(key: PresentationKey, value: string): void {
    onChange({ [key]: value } as PresentationOverrides);
  }

  const radioGroups = buildRadioGroups(copy);
  const toggles = buildToggles(copy);

  function tabButton(key: TabKey, label: string): ReactNode {
    return (
      <button
        ref={tabRefs[key]}
        type="button"
        role="tab"
        id={tabId(key)}
        aria-selected={activeTab === key}
        aria-controls={panelId(key)}
        tabIndex={activeTab === key ? 0 : -1}
        onClick={() => selectTab(key)}
        className={segmentTab(activeTab === key)}
      >
        {label}
      </button>
    );
  }

  return (
    <>
      <Button
        id={triggerId}
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={toggleOpen}
      >
        <SlidersHorizontal aria-hidden="true" />
        {copy.trigger}
      </Button>
      {open ? (
        <section
          id={regionId}
          role="region"
          aria-label={copy.regionLabel}
          onKeyDown={onRegionKeyDown}
          className="basis-full mt-2 rounded-lg border border-border bg-muted/40 p-3 text-xs"
        >
          <div
            role="tablist"
            aria-label={copy.tabsLabel}
            onKeyDown={onTabsKeyDown}
            className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
          >
            {tabButton('chart', copy.tabChart)}
            {tabButton('colors', copy.tabColors)}
            {tabButton('font', copy.tabFont)}
          </div>

          {activeTab === 'chart' ? (
            <div
              id={panelId('chart')}
              role="tabpanel"
              aria-labelledby={tabId('chart')}
              className="mt-3 flex flex-col items-start gap-3"
            >
              {radioGroups.map((group) => {
                if (!resolved.applicable.has(group.key)) return null;
                const reason = resolved.locks[group.key];
                const locked = reason !== undefined;
                const groupLabelId = `${idPrefix}-style-label-${group.key}`;
                const reasonId = locked ? `${idPrefix}-style-reason-${group.key}` : undefined;
                const current = resolved.values[group.key] as string;
                return (
                  <div key={group.key}>
                    <span id={groupLabelId} className="mb-1 block font-medium text-foreground">
                      {group.label}
                    </span>
                    <div
                      role="radiogroup"
                      aria-labelledby={groupLabelId}
                      aria-describedby={reasonId}
                      onKeyDown={onRadioGroupKeyDown}
                      className="flex flex-wrap gap-1.5"
                    >
                      {group.options.map((opt) => {
                        const checked = current === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            role="radio"
                            aria-checked={checked}
                            aria-describedby={reasonId}
                            disabled={locked}
                            tabIndex={checked ? 0 : -1}
                            onClick={() => emit(group.key, opt.value)}
                            className={pillClass(checked)}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    {locked ? (
                      <span id={reasonId} className="sr-only">
                        {reason}
                      </span>
                    ) : null}
                  </div>
                );
              })}

              {toggles.map((t) => {
                if (!resolved.applicable.has(t.key)) return null;
                const reason = resolved.locks[t.key];
                const locked = reason !== undefined;
                const reasonId = locked ? `${idPrefix}-style-reason-${t.key}` : undefined;
                const pressed = resolved.values[t.key] === t.onValue;
                return (
                  <div key={t.key}>
                    <button
                      type="button"
                      aria-pressed={pressed}
                      aria-describedby={reasonId}
                      disabled={locked}
                      onClick={() => emit(t.key, pressed ? t.offValue : t.onValue)}
                      className={pillClass(pressed)}
                    >
                      {t.label}
                    </button>
                    {locked ? (
                      <span id={reasonId} className="sr-only">
                        {reason}
                      </span>
                    ) : null}
                  </div>
                );
              })}

              <Button type="button" variant="outline" size="xs" disabled={resolved.pristine} onClick={onReset}>
                {copy.reset}
              </Button>
            </div>
          ) : null}

          {activeTab === 'colors' ? (
            <div
              id={panelId('colors')}
              role="tabpanel"
              aria-labelledby={tabId('colors')}
              className="mt-3 flex flex-col items-start gap-3"
            >
              {resolved.applicable.has('seriesColors') ? (
                <>
                  {seriesMeta.map((series, index) => {
                    const draft = colorDrafts[index] ?? series.color;
                    const warning = colorWarnings[index] ?? null;
                    const alert = colorAlerts[index] ?? null;
                    const warnId = `${idPrefix}-style-color-warn-${index}`;
                    const alertId = `${idPrefix}-style-color-alert-${index}`;
                    return (
                      <div key={series.key} role="group" aria-label={series.label} className="flex flex-wrap items-center gap-2">
                        <span
                          aria-hidden
                          style={{ backgroundColor: series.color }}
                          className="inline-block size-4 rounded-full border border-border"
                        />
                        <span className="font-medium text-foreground">{series.label}</span>
                        <Input
                          type="text"
                          inputMode="text"
                          aria-label={`${copy.colourOf} ${series.label} ${copy.hexSuffix}`}
                          aria-describedby={alert ? alertId : warning ? warnId : undefined}
                          value={draft}
                          onChange={(e) => setColorDrafts((d) => ({ ...d, [index]: e.target.value }))}
                          onBlur={(e) => commitColor(index, series.color, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitColor(index, series.color, e.currentTarget.value);
                          }}
                          className="w-24"
                        />
                        <input
                          type="color"
                          aria-label={`${copy.colourOf} ${series.label} ${copy.pickSuffix}`}
                          value={series.color}
                          onChange={(e) => commitColor(index, series.color, e.target.value)}
                        />
                        {warning ? (
                          <p id={warnId} className="w-full text-muted-foreground">
                            {warningText(copy, warning)}
                          </p>
                        ) : null}
                        {alert ? (
                          <p id={alertId} role="alert" className="w-full text-destructive">
                            {alert}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}

                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={Object.keys(currentColors).length === 0}
                    onClick={() => onChange({ seriesColors: {} })}
                  >
                    {copy.resetColors}
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}

          {activeTab === 'font' ? (
            <div
              id={panelId('font')}
              role="tabpanel"
              aria-labelledby={tabId('font')}
              className="mt-3 flex flex-wrap items-center gap-2"
            >
              <label htmlFor={`${idPrefix}-style-font`}>{copy.font}</label>
              <select
                id={`${idPrefix}-style-font`}
                aria-label={copy.font}
                value={resolved.values.fontFamily ?? ''}
                onChange={(e) => onChange({ fontFamily: e.target.value || null })}
                className="rounded-md border border-border bg-background px-1.5 py-0.5 text-foreground"
              >
                <option value="">{copy.fontDefault}</option>
                {FONT_OPTIONS.map((f) => (
                  <option key={f.family} value={f.family}>
                    {f.family}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
