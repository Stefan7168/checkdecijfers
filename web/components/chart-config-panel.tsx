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
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal, X } from 'lucide-react';
import {
  COLOR_REFUSE_BELOW,
  contrastRatio,
  FONT_OPTIONS,
  FRAME_GRADIENT_PRESETS,
  frameBackdrops,
  HEX_COLOR,
  isFramePristine,
  judgeColor,
  judgeColorAgainst,
  normalizeHex,
  type PresentationKey,
  type PresentationOverrides,
  type ResolvedPresentation,
} from '../lib/chart-presentation.ts';
import { t, type Lang, type MessageKey } from '../lib/i18n/messages.ts';
import { cn } from '../lib/utils.ts';
import { Button } from './ui/button.tsx';
import { Input } from './ui/input.tsx';

/** Kept as a re-export (not a fresh alias) so the one existing external
 * mention (chart-presentation.ts's LOCK_REASONS comment) and any future
 * import keep resolving to the SAME type the catalogue itself uses. */
export type PanelLang = Lang;

// WP218 phase 4 (#219), Task 4: PANEL_COPY folded into the shared catalogue
// under `chart.panel.*` (messages.ts) — this file now only ASSEMBLES the
// per-render copy object from `t(lang, …)` calls, never holds its own
// hardcoded nl/en text. `lang` keeps its existing plain-prop shape (chart.tsx
// now passes it the resolved CHART language, not always 'nl' — the whole
// point of Task 4 — but the panel itself is unchanged: still a dumb
// component that only ever reads the language it's given).
function buildPanelCopy(lang: Lang) {
  return {
    trigger: t(lang, 'chart.panel.trigger'),
    regionLabel: t(lang, 'chart.panel.regionLabel'),
    close: t(lang, 'chart.panel.close'),
    tabsLabel: t(lang, 'chart.panel.tabsLabel'),
    tabChart: t(lang, 'chart.panel.tabChart'),
    tabColors: t(lang, 'chart.panel.tabColors'),
    tabFont: t(lang, 'chart.panel.tabFont'),
    tabFrame: t(lang, 'chart.panel.tabFrame'),
    reset: t(lang, 'chart.panel.reset'),
    /** Kleuren tab. `colourOf`/`hexSuffix`/`pickSuffix` assemble into the
     * per-row accessible names: "{colourOf} {label} {hexSuffix}" for the hex
     * box, "{colourOf} {label} {pickSuffix}" for the native colour picker —
     * kept as separate atoms (not two pre-joined templates) so a future
     * label wording change can't accidentally desync the two names. */
    colourOf: t(lang, 'chart.panel.colourOf'),
    hexSuffix: t(lang, 'chart.panel.hexSuffix'),
    pickSuffix: t(lang, 'chart.panel.pickSuffix'),
    resetColors: t(lang, 'chart.panel.resetColors'),
    warnLight: t(lang, 'chart.panel.warnLight'),
    warnDark: t(lang, 'chart.panel.warnDark'),
    warnBoth: t(lang, 'chart.panel.warnBoth'),
    /** Lettertype tab. */
    font: t(lang, 'chart.panel.font'),
    fontDefault: t(lang, 'chart.panel.fontDefault'),
    /** WP218 phase 2 (owner C): the account-default footer row and its
     * `role="status"` outcome line, plus the pristine-and-has-a-default hint
     * shown above the Grafiek tab's controls. Only rendered when the
     * `account` prop is present (a signed-in visitor). */
    accountSave: t(lang, 'chart.panel.accountSave'),
    accountForget: t(lang, 'chart.panel.accountForget'),
    accountSaved: t(lang, 'chart.panel.accountSaved'),
    accountForgotten: t(lang, 'chart.panel.accountForgotten'),
    accountUnavailable: t(lang, 'chart.panel.accountUnavailable'),
    accountError: t(lang, 'chart.panel.accountError'),
    accountHint: t(lang, 'chart.panel.accountHint'),
    /** WP218 phase 3 (owner B): the "Merkkleuren" (brand colours) block.
     * `brandApplied` keeps its raw `{name}` placeholder — filled at the use
     * site via `.replace('{name}', …)`, unchanged from before this task. */
    brandHeading: t(lang, 'chart.panel.brandHeading'),
    brandIntro: t(lang, 'chart.panel.brandIntro'),
    brandApply: t(lang, 'chart.panel.brandApply'),
    brandWebsiteLabel: t(lang, 'chart.panel.brandWebsiteLabel'),
    brandWebsitePlaceholder: t(lang, 'chart.panel.brandWebsitePlaceholder'),
    brandApplied: t(lang, 'chart.panel.brandApplied'),
    brandFontSkipped: t(lang, 'chart.panel.brandFontSkipped'),
    brandUnavailable: t(lang, 'chart.panel.brandUnavailable'),
    brandNotFound: t(lang, 'chart.panel.brandNotFound'),
    brandInvalidDomain: t(lang, 'chart.panel.brandInvalidDomain'),
    brandTryLater: t(lang, 'chart.panel.brandTryLater'),
    brandMonthlyCap: t(lang, 'chart.panel.brandMonthlyCap'),
    brandError: t(lang, 'chart.panel.brandError'),
    /** WP218 phase 4: the new "Taal van de grafiek" select. `languageNl`/
     * `languageEn` are the languages' own self-names — identical in both
     * languages (proper nouns), still catalogued rather than hardcoded. */
    languageLabel: t(lang, 'chart.panel.languageLabel'),
    languageNl: t(lang, 'chart.panel.languageNl'),
    languageEn: t(lang, 'chart.panel.languageEn'),
    /** WP218 phase 5 (chart-types plan, Task 3): the collapsed "why no pie
     * or stacked chart" note, now in the region's common footer row (moved
     * there by the Option A layout below) rather than inside the Grafiek
     * tabpanel — it and Standaard are properties of the whole panel, like
     * the account row already was. */
    whyNotTitle: t(lang, 'chart.panel.whyNotTitle'),
    whyNotBody: t(lang, 'chart.panel.whyNotBody'),
    /** Owner decision (option A, compact grid): the group label above the
     * three "on/off" toggles (Aslijnen/Waarden/Y-as vanaf nul), now shortened
     * since "Tonen" already says what the group does. */
    showGroup: t(lang, 'chart.panel.showGroup'),
    /** Task 5 (design §C2): the Frame tab — background (None/Colour/
     * Gradient/Own image), padding/corners/shadow/inset/aspect ratio. */
    frameBackground: t(lang, 'chart.panel.frameBackground'),
    frameBgNone: t(lang, 'chart.panel.frameBgNone'),
    frameBgSolid: t(lang, 'chart.panel.frameBgSolid'),
    frameBgGradient: t(lang, 'chart.panel.frameBgGradient'),
    frameBgImage: t(lang, 'chart.panel.frameBgImage'),
    frameGradientPreset: t(lang, 'chart.panel.frameGradientPreset'),
    frameGradientDawn: t(lang, 'chart.panel.frameGradientDawn'),
    frameGradientOcean: t(lang, 'chart.panel.frameGradientOcean'),
    frameGradientForest: t(lang, 'chart.panel.frameGradientForest'),
    frameGradientBerry: t(lang, 'chart.panel.frameGradientBerry'),
    frameGradientSlate: t(lang, 'chart.panel.frameGradientSlate'),
    frameGradientSand: t(lang, 'chart.panel.frameGradientSand'),
    frameFrom: t(lang, 'chart.panel.frameFrom'),
    frameTo: t(lang, 'chart.panel.frameTo'),
    framePadding: t(lang, 'chart.panel.framePadding'),
    frameCorners: t(lang, 'chart.panel.frameCorners'),
    frameShadow: t(lang, 'chart.panel.frameShadow'),
    frameInset: t(lang, 'chart.panel.frameInset'),
    frameAspect: t(lang, 'chart.panel.frameAspect'),
    sizeNone: t(lang, 'chart.panel.sizeNone'),
    sizeSmall: t(lang, 'chart.panel.sizeSmall'),
    sizeMedium: t(lang, 'chart.panel.sizeMedium'),
    sizeLarge: t(lang, 'chart.panel.sizeLarge'),
    cornersSquare: t(lang, 'chart.panel.cornersSquare'),
    cornersRounded: t(lang, 'chart.panel.cornersRounded'),
    cornersVeryRounded: t(lang, 'chart.panel.cornersVeryRounded'),
    shadowSoft: t(lang, 'chart.panel.shadowSoft'),
    shadowStrong: t(lang, 'chart.panel.shadowStrong'),
    aspectAuto: t(lang, 'chart.panel.aspectAuto'),
    aspectWide: t(lang, 'chart.panel.aspectWide'),
    aspectPortrait: t(lang, 'chart.panel.aspectPortrait'),
    aspectSquare: t(lang, 'chart.panel.aspectSquare'),
    aspectSocial: t(lang, 'chart.panel.aspectSocial'),
    frameImagePick: t(lang, 'chart.panel.frameImagePick'),
    frameImageRemove: t(lang, 'chart.panel.frameImageRemove'),
    frameImageTooLarge: t(lang, 'chart.panel.frameImageTooLarge'),
    frameImageBadType: t(lang, 'chart.panel.frameImageBadType'),
    frameImageNotSaved: t(lang, 'chart.panel.frameImageNotSaved'),
    frameReset: t(lang, 'chart.panel.frameReset'),
    frameBgRefused: t(lang, 'chart.panel.frameBgRefused'),
  };
}
type PanelCopy = ReturnType<typeof buildPanelCopy>;

type TabKey = 'chart' | 'colors' | 'font' | 'frame';
const TAB_ORDER: readonly TabKey[] = ['chart', 'colors', 'font', 'frame'];

type RadioKey = 'lineWidth' | 'markers' | 'grid' | 'xLabels';
interface RadioGroupDef {
  key: RadioKey;
  label: string;
  options: { value: string; label: string }[];
}

// Each option's catalogue key, spelled out (not template-composed) so a typo
// is a compile error against the real `MessageKey` union rather than a
// silent runtime miss.
const RADIO_GROUPS: readonly { key: RadioKey; groupLabelKey: MessageKey; options: readonly { value: string; labelKey: MessageKey }[] }[] = [
  {
    key: 'lineWidth',
    groupLabelKey: 'chart.panel.lineWidth',
    options: [
      { value: 'thin', labelKey: 'chart.panel.lineWidthOption.thin' },
      { value: 'normal', labelKey: 'chart.panel.lineWidthOption.normal' },
      { value: 'thick', labelKey: 'chart.panel.lineWidthOption.thick' },
      { value: 'extraThick', labelKey: 'chart.panel.lineWidthOption.extraThick' },
    ],
  },
  {
    key: 'markers',
    groupLabelKey: 'chart.panel.markers',
    options: [
      { value: 'all', labelKey: 'chart.panel.markersOption.all' },
      { value: 'provisionalOnly', labelKey: 'chart.panel.markersOption.provisionalOnly' },
    ],
  },
  {
    key: 'grid',
    groupLabelKey: 'chart.panel.grid',
    options: [
      { value: 'both', labelKey: 'chart.panel.gridOption.both' },
      { value: 'horizontal', labelKey: 'chart.panel.gridOption.horizontal' },
      { value: 'none', labelKey: 'chart.panel.gridOption.none' },
    ],
  },
  {
    key: 'xLabels',
    groupLabelKey: 'chart.panel.xLabels',
    options: [
      { value: 'flat', labelKey: 'chart.panel.xLabelsOption.flat' },
      { value: 'tilted', labelKey: 'chart.panel.xLabelsOption.tilted' },
    ],
  },
];

function buildRadioGroups(lang: Lang): RadioGroupDef[] {
  return RADIO_GROUPS.map(({ key, groupLabelKey, options }) => ({
    key,
    label: t(lang, groupLabelKey),
    options: options.map(({ value, labelKey }) => ({ value, label: t(lang, labelKey) })),
  }));
}

// Task 5 (design §C2): the Frame tab's five plain radiogroups — padding,
// corners, shadow, inset, aspect ratio. `frameAspect`'s VALUES are the
// digit-carrying ratio strings the resolver itself uses ('16:9' etc.) — they
// only ever reach the DOM as a `value` attribute (never rendered text), so
// the panel's digit-free-text invariant holds; every LABEL below is a plain
// word (Breedbeeld/Widescreen, and so on).
type FrameRadioKey = 'framePadding' | 'frameCorners' | 'frameShadow' | 'frameInset' | 'frameAspect';
interface FrameRadioGroupDef {
  key: FrameRadioKey;
  label: string;
  options: { value: string; label: string }[];
}

const FRAME_RADIO_GROUPS: readonly { key: FrameRadioKey; groupLabelKey: MessageKey; options: readonly { value: string; labelKey: MessageKey }[] }[] = [
  {
    key: 'framePadding',
    groupLabelKey: 'chart.panel.framePadding',
    options: [
      { value: 'none', labelKey: 'chart.panel.sizeNone' },
      { value: 'small', labelKey: 'chart.panel.sizeSmall' },
      { value: 'medium', labelKey: 'chart.panel.sizeMedium' },
      { value: 'large', labelKey: 'chart.panel.sizeLarge' },
    ],
  },
  {
    key: 'frameCorners',
    groupLabelKey: 'chart.panel.frameCorners',
    options: [
      { value: 'square', labelKey: 'chart.panel.cornersSquare' },
      { value: 'rounded', labelKey: 'chart.panel.cornersRounded' },
      { value: 'veryRounded', labelKey: 'chart.panel.cornersVeryRounded' },
    ],
  },
  {
    key: 'frameShadow',
    groupLabelKey: 'chart.panel.frameShadow',
    options: [
      { value: 'none', labelKey: 'chart.panel.sizeNone' },
      { value: 'soft', labelKey: 'chart.panel.shadowSoft' },
      { value: 'strong', labelKey: 'chart.panel.shadowStrong' },
    ],
  },
  {
    key: 'frameInset',
    groupLabelKey: 'chart.panel.frameInset',
    options: [
      { value: 'none', labelKey: 'chart.panel.sizeNone' },
      { value: 'small', labelKey: 'chart.panel.sizeSmall' },
      { value: 'large', labelKey: 'chart.panel.sizeLarge' },
    ],
  },
  {
    key: 'frameAspect',
    groupLabelKey: 'chart.panel.frameAspect',
    options: [
      { value: 'auto', labelKey: 'chart.panel.aspectAuto' },
      { value: '16:9', labelKey: 'chart.panel.aspectWide' },
      { value: '4:5', labelKey: 'chart.panel.aspectPortrait' },
      { value: '1:1', labelKey: 'chart.panel.aspectSquare' },
      { value: '1.91:1', labelKey: 'chart.panel.aspectSocial' },
    ],
  },
];

function buildFrameRadioGroups(lang: Lang): FrameRadioGroupDef[] {
  return FRAME_RADIO_GROUPS.map(({ key, groupLabelKey, options }) => ({
    key,
    label: t(lang, groupLabelKey),
    options: options.map(({ value, labelKey }) => ({ value, label: t(lang, labelKey) })),
  }));
}

/** A plain, never-locked radiogroup row for the Frame tab — the same
 * label+pills Fragment shape as the Grafiek tab's own rows (`GRID_CLASS`),
 * minus the lock/reason machinery those need and this tab's keys never do
 * (chart-presentation.ts's resolver applies no locks to any frame key). */
function frameRadioRow(idPrefix: string, group: FrameRadioGroupDef, current: string, onPick: (value: string) => void): ReactNode {
  const groupLabelId = `${idPrefix}-style-label-${group.key}`;
  return (
    <Fragment key={group.key}>
      <span id={groupLabelId} className="text-xs text-muted-foreground pt-1">
        {group.label}
      </span>
      <div role="radiogroup" aria-labelledby={groupLabelId} onKeyDown={onRadioGroupKeyDown} className="flex flex-wrap gap-1.5">
        {group.options.map((opt) => {
          const checked = current === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => onPick(opt.value)}
              className={pillClass(checked)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </Fragment>
  );
}

/** The swatch-free hex-textbox + native colour-picker pair shared by the
 * Kleuren tab's per-series rows and the Frame tab's background colour/
 * gradient fields — extracted so the two never duplicate this markup.
 * Purely presentational/controlled: every value and every commit is the
 * caller's, this component owns no state of its own. */
function ColorField({
  textValue,
  pickerValue,
  onTextChange,
  onBlur,
  onKeyDown,
  onPickerChange,
  ariaLabelHex,
  ariaLabelPicker,
  ariaDescribedBy,
  className,
}: {
  textValue: string;
  pickerValue: string;
  onTextChange: (value: string) => void;
  onBlur: (value: string) => void;
  onKeyDown?: (value: string, key: string) => void;
  onPickerChange: (value: string) => void;
  ariaLabelHex: string;
  ariaLabelPicker: string;
  ariaDescribedBy?: string;
  className?: string;
}): ReactNode {
  return (
    <>
      <Input
        type="text"
        inputMode="text"
        aria-label={ariaLabelHex}
        aria-describedby={ariaDescribedBy}
        value={textValue}
        onChange={(e) => onTextChange(e.target.value)}
        onBlur={(e) => onBlur(e.target.value)}
        onKeyDown={(e) => onKeyDown?.(e.currentTarget.value, e.key)}
        className={className ?? 'w-24'}
      />
      <input
        type="color"
        aria-label={ariaLabelPicker}
        value={pickerValue}
        onChange={(e) => onPickerChange(e.target.value)}
      />
    </>
  );
}

/** A Frame-tab hex field: unlike the Kleuren tab's rows (which need a live
 * per-keystroke draft so a warning can update as the reader types), this one
 * only needs to show what's typed and commit a normalised hex on blur/Enter
 * — so it owns a tiny local text buffer, discarded and reseeded from `value`
 * whenever the caller keys it by that same value (a successful commit, a
 * gradient preset pick, or a Reset all remount it with the new committed
 * text; an in-progress invalid edit that never committed is simply dropped,
 * matching the Kleuren tab's own "garbage snaps back silently" behaviour). */
function FrameHexField({
  value,
  onCommit,
  ariaLabelHex,
  ariaLabelPicker,
}: {
  value: string;
  onCommit: (hex: string) => void;
  ariaLabelHex: string;
  ariaLabelPicker: string;
}): ReactNode {
  const [text, setText] = useState(value);
  function commit(raw: string): void {
    const hex = normalizeHex(raw);
    if (hex === null) {
      setText(value);
      return;
    }
    onCommit(hex);
  }
  return (
    <ColorField
      textValue={text}
      pickerValue={value}
      onTextChange={setText}
      onBlur={commit}
      onKeyDown={(v, key) => {
        if (key === 'Enter') commit(v);
      }}
      onPickerChange={commit}
      ariaLabelHex={ariaLabelHex}
      ariaLabelPicker={ariaLabelPicker}
    />
  );
}

type ToggleKey = 'axisLines' | 'valueLabels' | 'zeroBaseline';
interface ToggleDef {
  key: ToggleKey;
  label: string;
  onValue: string;
  offValue: string;
}

function buildToggles(lang: Lang): ToggleDef[] {
  return [
    { key: 'axisLines', label: t(lang, 'chart.panel.axisLines'), onValue: 'shown', offValue: 'hidden' },
    { key: 'valueLabels', label: t(lang, 'chart.panel.valueLabels'), onValue: 'shown', offValue: 'hidden' },
    { key: 'zeroBaseline', label: t(lang, 'chart.panel.zeroBaseline'), onValue: 'zero', offValue: 'auto' },
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

function warningText(copy: PanelCopy, warning: 'light' | 'dark' | 'both' | null): string | null {
  if (warning === 'light') return copy.warnLight;
  if (warning === 'dark') return copy.warnDark;
  if (warning === 'both') return copy.warnBoth;
  return null;
}

function warningFor(hex: string): 'light' | 'dark' | 'both' | null {
  const verdict = judgeColor(hex);
  return verdict.ok ? verdict.warning : null;
}

/** A Kleuren-row local record, valid only "for" the effective colour it was
 * captured against — the review fix's re-sync mechanism (finding #1).
 * `committed` distinguishes a live, uncommitted keystroke (may look like a
 * well-formed hex by coincidence, e.g. the user typed "#0088fe" themselves)
 * from the normalised hex of an actual successful commit — only the latter
 * is eligible to stand in for `series.color` when judging the warning or
 * guarding against a duplicate commit (finding #2). */
interface ColorDraft {
  text: string;
  forColor: string;
  committed: boolean;
}
interface ColorAlert {
  reason: string;
  forColor: string;
}

/** React's documented "adjust state when a prop changes" pattern, applied to
 * a whole per-key map at once: drop every entry whose `forColor` no longer
 * matches the row's CURRENT effective colour (looked up by `series.key` in
 * `colorByKey`) — including a key that has disappeared entirely (a spec
 * swap). Compared during render, not in a `useEffect`; returns `null` when
 * nothing needs dropping so the caller can skip the `setState` call. */
function reconcileColorState<T extends { forColor: string }>(
  store: Record<string, T>,
  colorByKey: ReadonlyMap<string, string>,
): Record<string, T> | null {
  let changed = false;
  const next: Record<string, T> = {};
  for (const key of Object.keys(store)) {
    const entry = store[key]!;
    if (colorByKey.get(key) === entry.forColor) {
      next[key] = entry;
    } else {
      changed = true;
    }
  }
  return changed ? next : null;
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

/** WP218 phase 2 (owner C): the outcome the panel needs to show a status
 * line for — `onSave`/`onForget` do the actual server round trip (chart.tsx
 * owns the client-only pieces: applying the sanitised effective values to
 * `useChartStyle()`'s local state and firing the usage-counter event on
 * success) and hand back only which digit-free line to display. */
export interface ChartConfigPanelAccount {
  /** Whether the signed-in account currently has a saved default — governs
   * whether "Vergeet mijn standaard" is offered at all, and (with
   * `resolved.pristine`) whether the "Mijn standaard is actief." hint shows. */
  hasDefault: boolean;
  /** `'savedImageDropped'` (Task 5, design §C2): the effective frame
   * background was `{ kind: 'image' }` — a data URL never rides along with
   * the saved default (`chart.panel.frameImageNotSaved` says so on the
   * status line) — everything else about the save still succeeded exactly
   * like a plain `'saved'`. */
  onSave: () => Promise<'saved' | 'savedImageDropped' | 'unavailable' | 'error'>;
  onForget: () => Promise<'forgotten' | 'error'>;
}

/** WP218 phase 3 (owner decision B): "Pas merkkleuren toe" in the Kleuren
 * tab. `lookup` is the ONLY thing this dumb panel knows about Brandfetch —
 * chart.tsx supplies the real `lookupBrand` Server Action exactly when
 * `useChartStyle().signedIn`, mirroring `account` above.
 *
 * `BrandLookupOutcome` is declared locally (not imported from
 * `../app/chart-style-actions.ts`'s `LookupBrandResponse`) on purpose: this
 * file never imports a `'use server'` module, matching `ChartConfigPanelAccount`
 * above, whose `onSave`/`onForget` return types are hand-written string
 * unions rather than re-exports of the real Server Action's return type.
 * TypeScript's structural typing makes the two shapes interchangeable at the
 * chart.tsx call site without either file needing to import the other. */
export type BrandLookupOutcome =
  | {
      ok: true;
      brand: {
        name: string;
        domain: string;
        colors: string[];
        font: { family: string; origin: 'google' | 'system' } | null;
        fetchedAt: string;
        cached: boolean;
      };
    }
  | {
      ok: false;
      reason:
        | 'unauthenticated'
        | 'unavailable'
        | 'need_website'
        | 'invalid_domain'
        | 'not_found'
        | 'rate_limited'
        | 'daily_cap'
        | 'monthly_cap'
        | 'error';
    };

export interface ChartConfigPanelBrand {
  lookup: (website?: string) => Promise<BrandLookupOutcome>;
}

type BrandFailureReason = Extract<BrandLookupOutcome, { ok: false }>['reason'];

/** What chart.tsx needs from a successful apply to later hand to
 * `saveMyChartStyle`'s `brandApplied` argument on the next "Bewaar als mijn
 * standaard" — applying a brand and saving it as the account default are
 * deliberately separate, later, actions (see `lookupBrand`'s own header). */
export interface AppliedBrand {
  domain: string;
  name: string;
  fetchedAt: string;
}

export interface ChartConfigPanelProps {
  resolved: ResolvedPresentation;
  seriesMeta: { key: string; label: string; color: string }[];
  onChange: (patch: PresentationOverrides) => void;
  onReset: () => void;
  idPrefix: string;
  lang?: PanelLang;
  /** Review fix (chart-panel-layout, option A): the previous version of this
   * refactor tried to keep one mounted instance's trigger inside the
   * Weergave tablist row via `createPortal` into a `triggerSlot` DOM node —
   * verified in a real browser, the portaled node never actually moved into
   * that row and the trigger was inert (`aria-expanded` never changed on
   * click), so the panel could not be opened at all in production. Fixed by
   * lifting the open/closed boolean itself to the caller (chart.tsx's
   * `styleOpen`) and splitting the trigger into its own `ChartConfigTrigger`
   * component below, which the caller renders directly inside the tablist
   * row — no portal, no placeholder node. This component is now fully
   * controlled: it never decides whether the region is open, only what's
   * inside it once it is. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The trigger's own DOM id — the caller builds it once and hands the
   * same string to both `ChartConfigTrigger` and here, since the only thing
   * this component needs it for is refocusing the trigger when Escape
   * closes the region. */
  triggerId: string;
  /** WP218 phase 2 (owner C): present only for a signed-in visitor
   * (chart.tsx passes it exactly when `useChartStyle().signedIn`) — absent
   * for Ontdek/trial, which renders no account-default row at all. */
  account?: ChartConfigPanelAccount;
  /** WP218 phase 3 (owner B): present only for a signed-in visitor, same gate
   * as `account` — absent for Ontdek/trial, which renders no Merkkleuren
   * block at all. */
  brand?: ChartConfigPanelBrand;
  /** Fired once, on a successful apply, with just enough to identify which
   * brand it was — chart.tsx remembers it and hands it to `saveMyChartStyle`
   * as `brandApplied` on the next account-default save. */
  onBrandApplied?: (applied: AppliedBrand) => void;
  /** Task 5 (design §C2): the Frame tab's "Own image" background — a data
   * URL (or `null`), chart.tsx's own state (Task 3), not part of `pres`/
   * `resolvePresentation`'s account-default machinery. Optional/defaulted so
   * every existing test render call (none of which touch the Frame tab)
   * keeps compiling unchanged, mirroring `account`/`brand` above. */
  frameImage?: string | null;
  onFrameImage?: (dataUrl: string | null) => void;
}

/** The "Opmaak"/"Style" trigger button — split out of `ChartConfigPanel` by
 * the review fix above so the caller can render it directly wherever it
 * belongs (chart.tsx: the Weergave tablist row) with no portal involved. A
 * plain controlled button: `open` drives `aria-expanded`, `onToggle` is the
 * caller's own toggle handler (also where the caller fires its
 * once-per-open `panel_open` usage-counter event — this component has no
 * opinion on that). `controlsId` must be the exact same string
 * `ChartConfigPanel` builds its region's `id` from (`${idPrefix}-style`) so
 * `aria-controls` actually resolves to it. */
export interface ChartConfigTriggerProps {
  open: boolean;
  onToggle: () => void;
  controlsId: string;
  triggerId: string;
  lang?: PanelLang;
}

export function ChartConfigTrigger({
  open,
  onToggle,
  controlsId,
  triggerId,
  lang = 'nl',
}: ChartConfigTriggerProps): ReactNode {
  return (
    <Button
      id={triggerId}
      type="button"
      variant="ghost"
      size="sm"
      aria-expanded={open}
      aria-controls={controlsId}
      onClick={onToggle}
    >
      <SlidersHorizontal aria-hidden="true" />
      {t(lang, 'chart.panel.trigger')}
    </Button>
  );
}

export function ChartConfigPanel({
  resolved,
  seriesMeta,
  onChange,
  onReset,
  idPrefix,
  lang = 'nl',
  open,
  onOpenChange,
  triggerId,
  account,
  brand,
  onBrandApplied,
  frameImage = null,
  onFrameImage = () => {},
}: ChartConfigPanelProps): ReactNode {
  const copy = buildPanelCopy(lang);
  const [activeTab, setActiveTab] = useState<TabKey>('chart');
  // WP218 phase 2: shared by both account-row buttons — a save/forget round
  // trip disables both while pending (never two in flight for the same
  // panel instance) and the outcome status line persists until the next
  // attempt, matching the Kleuren tab's own "state survives until something
  // changes it" pattern rather than auto-clearing on a timer.
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountStatus, setAccountStatus] = useState<
    'saved' | 'savedImageDropped' | 'forgotten' | 'unavailable' | 'error' | null
  >(null);

  async function handleAccountSave(): Promise<void> {
    if (!account) return;
    setAccountBusy(true);
    try {
      setAccountStatus(await account.onSave());
    } finally {
      setAccountBusy(false);
    }
  }

  async function handleAccountForget(): Promise<void> {
    if (!account) return;
    setAccountBusy(true);
    try {
      setAccountStatus(await account.onForget());
    } finally {
      setAccountBusy(false);
    }
  }

  function accountStatusText(status: 'saved' | 'savedImageDropped' | 'forgotten' | 'unavailable' | 'error'): string {
    if (status === 'saved') return copy.accountSaved;
    // Task 5 (design §C2): the image itself never rides along with the
    // saved default — appended (not swapped in), so the reader still sees
    // "Opgeslagen." plus this one extra sentence, never just the caveat.
    if (status === 'savedImageDropped') return `${copy.accountSaved} ${copy.frameImageNotSaved}`;
    if (status === 'forgotten') return copy.accountForgotten;
    if (status === 'unavailable') return copy.accountUnavailable;
    return copy.accountError;
  }

  // WP218 phase 3 (owner decision B): "Pas merkkleuren toe" — a single round
  // trip that both fetches a brand's colours/font (`brand.lookup`) and
  // applies them, so this state only needs to track what the account block
  // above didn't: the `need_website` follow-up input and its typed value,
  // and the one outcome (applied, or a failure reason) to show as the
  // status line below.
  const [brandBusy, setBrandBusy] = useState(false);
  const [brandNeedsWebsite, setBrandNeedsWebsite] = useState(false);
  const [brandWebsite, setBrandWebsite] = useState('');
  const [brandOutcome, setBrandOutcome] = useState<
    { kind: 'applied'; name: string; fontSkipped: boolean } | { kind: 'failure'; reason: BrandFailureReason } | null
  >(null);

  async function handleApplyBrand(): Promise<void> {
    if (!brand) return;
    setBrandBusy(true);
    try {
      const result = await brand.lookup(brandNeedsWebsite ? brandWebsite : undefined);
      if (!result.ok) {
        if (result.reason === 'need_website') {
          // Not a failure: the routine outcome for a free-mail login. Reveal
          // the website box and say nothing else (P3 task-4 review).
          setBrandNeedsWebsite(true);
          setBrandOutcome(null);
          return;
        }
        setBrandOutcome({ kind: 'failure', reason: result.reason });
        return;
      }
      setBrandNeedsWebsite(false);
      const { colors, font, name, domain, fetchedAt } = result.brand;
      // Bounded by seriesMeta.length, not just colors.length: an index with
      // no matching series on THIS chart would otherwise sit unused in a
      // saved account default and silently colour an unrelated series on a
      // later chart that happens to have more series than this one did.
      const accepted: Record<number, string> = {};
      const limit = Math.min(colors.length, seriesMeta.length);
      for (let i = 0; i < limit; i++) {
        const hex = colors[i]!;
        if (judgeColorAgainst(hex, frameBackdrops(resolved.values)).ok) accepted[i] = hex;
      }
      // One onChange call for the whole apply — seriesColors here is the
      // COMPLETE new colour scheme (like Standaardkleuren's `{}`), not
      // merged with whatever per-series edits were already showing: this is
      // an explicit, deliberate "apply the brand's own palette" action.
      const patch: PresentationOverrides = { seriesColors: accepted };
      if (font !== null) patch.fontFamily = font.family; // omit when null — never clear an existing choice
      onChange(patch);
      setBrandOutcome({ kind: 'applied', name, fontSkipped: font === null });
      onBrandApplied?.({ domain, name, fetchedAt });
    } finally {
      setBrandBusy(false);
    }
  }

  function brandFailureText(reason: BrandFailureReason): string {
    if (reason === 'not_found') return copy.brandNotFound;
    if (reason === 'invalid_domain') return copy.brandInvalidDomain;
    if (reason === 'rate_limited' || reason === 'daily_cap') return copy.brandTryLater;
    if (reason === 'monthly_cap') return copy.brandMonthlyCap;
    if (reason === 'error') return copy.brandError;
    // 'unavailable' and 'unauthenticated' — the latter should never actually
    // reach this panel (chart.tsx only offers `brand` when signed in), but a
    // dumb component still needs SOME digit-free line for it defensively.
    return copy.brandUnavailable;
  }

  const chartTabRef = useRef<HTMLButtonElement>(null);
  const colorsTabRef = useRef<HTMLButtonElement>(null);
  const fontTabRef = useRef<HTMLButtonElement>(null);
  const frameTabRef = useRef<HTMLButtonElement>(null);
  const tabRefs: Record<TabKey, typeof chartTabRef> = {
    chart: chartTabRef,
    colors: colorsTabRef,
    font: fontTabRef,
    frame: frameTabRef,
  };

  // Task 5 (design §C2): the Frame tab's "Own image" refusal lines — which
  // of the two (too large / wrong type) to show, or neither. Local, not
  // derived from `frameImage`: a refusal never changes `frameImage` at all
  // (nothing valid was ever offered), so there is nothing in the props to
  // re-derive this from.
  const [frameImageAlert, setFrameImageAlert] = useState<'tooLarge' | 'badType' | null>(null);
  const frameFileInputRef = useRef<HTMLInputElement>(null);

  // Final-review fix (Fix 5): a frame background (solid, gradient) or
  // turning the inset card OFF can hide a series entirely — refuse up
  // front, before ever calling onChange, rather than silently applying it
  // and letting chart.tsx drop the series colour override afterwards. Every
  // EFFECTIVE series colour (seriesMeta[i].color, palette-derived included)
  // is checked against every candidate backdrop for the WOULD-BE values —
  // `frameBackdrops` already resolves exactly what "the backdrop" means for
  // a given inset/background combination.
  const [frameBgRefused, setFrameBgRefused] = useState(false);

  function tryFrameChange(patch: PresentationOverrides): void {
    const nextValues = { ...resolved.values, ...patch };
    const backdrops = frameBackdrops(nextValues);
    const hidesASeries = seriesMeta.some((series) =>
      backdrops.some((backdrop) => contrastRatio(series.color, backdrop) < COLOR_REFUSE_BELOW),
    );
    if (hidesASeries) {
      setFrameBgRefused(true);
      return;
    }
    setFrameBgRefused(false);
    onChange(patch);
  }

  const FRAME_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
  const FRAME_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

  function handleFrameFile(file: File): void {
    if (file.size > FRAME_IMAGE_MAX_BYTES) {
      setFrameImageAlert('tooLarge');
      return;
    }
    if (!FRAME_IMAGE_TYPES.includes(file.type)) {
      setFrameImageAlert('badType');
      return;
    }
    setFrameImageAlert(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onFrameImage(reader.result);
        onChange({ frameBackground: { kind: 'image' } });
      }
    };
    reader.readAsDataURL(file);
  }

  function handleFrameImageRemove(): void {
    setFrameImageAlert(null);
    onFrameImage(null);
    onChange({ frameBackground: 'none' });
  }

  function handleFrameReset(): void {
    setFrameImageAlert(null);
    onChange({
      frameBackground: 'none',
      framePadding: 'none',
      frameCorners: 'square',
      frameShadow: 'none',
      frameInset: 'none',
      frameAspect: 'auto',
    });
    onFrameImage(null);
  }

  function pickFrameBackgroundKind(kind: 'none' | 'solid' | 'gradient' | 'image'): void {
    const bg = resolved.values.frameBackground;
    // Round 2: switching the background KIND is never itself a refusable
    // change (only a specific colour/gradient/image can hide a series), so
    // any stale refusal from before is cleared here too.
    setFrameBgRefused(false);
    if (kind === 'none') {
      onChange({ frameBackground: 'none' });
      return;
    }
    if (kind === 'solid') {
      const hex = bg !== 'none' && bg.kind === 'solid' ? bg.hex : '#ffffff';
      onChange({ frameBackground: { kind: 'solid', hex } });
      return;
    }
    if (kind === 'gradient') {
      const preset = bg !== 'none' && bg.kind === 'gradient' ? { from: bg.from, to: bg.to } : FRAME_GRADIENT_PRESETS[0]!;
      onChange({ frameBackground: { kind: 'gradient', from: preset.from, to: preset.to } });
      return;
    }
    onChange({ frameBackground: { kind: 'image' } });
  }

  // Kleuren tab: a local edit buffer per series KEY (not index — an index
  // can point at a different series after a spec swap). `seriesMeta[i]
  // .color` (the already-resolved effective colour) is the only source of
  // truth for the WARNING (always re-derived via judgeColor, never stored)
  // and for whether a draft/alert is still live: each entry remembers the
  // effective colour it was captured against (`forColor`) and is dropped —
  // via React's "adjust state when a prop changes" pattern, compared during
  // render below, no effect — the moment that colour changes from outside
  // (Standaardkleuren, Standaard reset, a spec swap on the same mounted
  // chart). Review findings on the first cut of this tab (index-keyed state
  // that never re-synced) — see chart-config-panel.test.tsx's "Kleuren tab"
  // re-sync tests.
  const [colorDrafts, setColorDrafts] = useState<Record<string, ColorDraft>>({});
  const [colorAlerts, setColorAlerts] = useState<Record<string, ColorAlert>>({});
  const currentColors = resolved.values.seriesColors;

  const colorByKey = new Map(seriesMeta.map((s) => [s.key, s.color] as const));
  const reconciledDrafts = reconcileColorState(colorDrafts, colorByKey);
  if (reconciledDrafts) setColorDrafts(reconciledDrafts);
  const reconciledAlerts = reconcileColorState(colorAlerts, colorByKey);
  if (reconciledAlerts) setColorAlerts(reconciledAlerts);
  const liveDrafts = reconciledDrafts ?? colorDrafts;
  const liveAlerts = reconciledAlerts ?? colorAlerts;

  /** Whatever `judgeColor` should judge for this row right now: the fresh
   * draft's own (already-normalised) hex once it's a settled COMMIT, else
   * the effective colour — reconciliation above already guarantees any
   * draft present here has `forColor === effectiveColor`, so only the
   * `committed` + well-formed check remains (uncommitted live typing must
   * never stand in for a real colour, even if it happens to look like one). */
  function settledColorFor(key: string, effectiveColor: string): string {
    const draft = liveDrafts[key];
    return draft !== undefined && draft.committed && HEX_COLOR.test(draft.text) ? draft.text : effectiveColor;
  }

  function commitColor(key: string, index: number, effectiveColor: string, rawValue: string): void {
    const hex = normalizeHex(rawValue);
    if (hex === null) {
      // Garbage: snap back without a word — nothing valid was ever offered.
      setColorDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
      setColorAlerts((a) => {
        const next = { ...a };
        delete next[key];
        return next;
      });
      return;
    }
    // Enter followed by blur re-submits the same, already-effective hex —
    // treat it as already handled rather than emitting a duplicate patch.
    if (hex === settledColorFor(key, effectiveColor)) {
      setColorAlerts((a) => {
        const next = { ...a };
        delete next[key];
        return next;
      });
      return;
    }
    const verdict = judgeColorAgainst(hex, frameBackdrops(resolved.values));
    if (!verdict.ok) {
      setColorDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
      setColorAlerts((a) => ({ ...a, [key]: { reason: verdict.reason, forColor: effectiveColor } }));
      return;
    }
    setColorAlerts((a) => {
      const next = { ...a };
      delete next[key];
      return next;
    });
    setColorDrafts((d) => ({ ...d, [key]: { text: hex, forColor: effectiveColor, committed: true } }));
    onChange({ seriesColors: { ...currentColors, [index]: hex } });
  }

  const regionId = `${idPrefix}-style`;
  const headingId = `${idPrefix}-style-heading`;
  const tabId = (key: TabKey) => `${idPrefix}-style-tab-${key}`;
  const panelId = (key: TabKey) => `${idPrefix}-style-panel-${key}`;

  function closeAndRefocus(): void {
    onOpenChange(false);
    document.getElementById(triggerId)?.focus();
  }

  function onRegionKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      // The portaled dialog is still a React-tree child of ChartView: stop
      // the synthetic event here so no ancestor (the story region, the page)
      // ever sees this Escape as its own.
      event.stopPropagation();
      closeAndRefocus();
    }
  }

  // Task 6 (floating Style panel): the dialog receives focus itself when it
  // opens (never trapped — Tab can still leave it, matching "no focus trap"
  // in the brief), so a keyboard user landing here after activating the
  // trigger doesn't have to hunt for it.
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  function selectTab(next: TabKey): void {
    setActiveTab(next);
    // Round 2: a stale frame-background refusal from a previous tab must
    // not keep showing once the user has moved on to something else.
    setFrameBgRefused(false);
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

  const radioGroups = buildRadioGroups(lang);
  const toggles = buildToggles(lang);
  const frameRadioGroups = buildFrameRadioGroups(lang);
  const frameGradientLabels: Record<(typeof FRAME_GRADIENT_PRESETS)[number]['id'], string> = {
    dawn: copy.frameGradientDawn,
    ocean: copy.frameGradientOcean,
    forest: copy.frameGradientForest,
    berry: copy.frameGradientBerry,
    slate: copy.frameGradientSlate,
    sand: copy.frameGradientSand,
  };

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

  // Owner decision (option A, compact grid): the two-column layout for the
  // Grafiek tab's option groups — a fixed-width label column, a wrapping
  // pills column. `sm:` keeps a single stacked column on narrow viewports
  // (the label column would otherwise crush the pills). Declared once here
  // (not inlined per group) so the grid and its row column-count can never
  // drift apart between the radio groups and the "Tonen" toggle row below.
  const GRID_CLASS = 'grid w-full grid-cols-1 sm:grid-cols-[112px_minmax(0,1fr)] gap-x-3 gap-y-2 items-start';
  const visibleToggles = toggles.filter((toggle) => resolved.applicable.has(toggle.key));
  const showGroupLabelId = `${idPrefix}-style-label-show`;

  // Task 6 (floating Style panel): the panel is now a floating, non-modal
  // dialog beside the chart, not an inline region under it — `role="dialog"`
  // (never `aria-modal`: no outside-click close, no focus trap, the chart
  // stays fully interactive behind it) and `createPortal`ed into
  // `document.body` so its fixed positioning isn't clipped by an ancestor's
  // `overflow`/`transform`. Owner call: `aria-labelledby` keeps pointing at
  // `copy.regionLabel` ("Opmaak van de grafiek"/"Chart style"), not the new
  // `chart.panel.dialogLabel` string the brief sketched — every existing
  // test queries `getByRole('region'|'dialog', { name: 'Opmaak van de
  // grafiek' })`, and there is no product reason for the two accessible
  // names to differ, so keeping the established one avoids a needless
  // string split. Below `lg`, the dialog becomes a bottom sheet instead of
  // the right-side floating box — a deliberate deviation from spec §C1's
  // "small chart preview on top" for phones, chosen to avoid mounting a
  // second chart instance; recorded in the docs task.
  const dialogContent = open ? (
    <section
      ref={dialogRef}
      id={regionId}
      role="dialog"
      aria-labelledby={headingId}
      tabIndex={-1}
      onKeyDown={onRegionKeyDown}
      className="fixed inset-x-0 bottom-0 z-40 max-h-[60vh] overflow-y-auto rounded-t-lg border-t border-border bg-card p-3 text-xs shadow-lg lg:inset-x-auto lg:bottom-auto lg:right-4 lg:top-20 lg:w-[22rem] lg:max-h-[calc(100vh-6rem)] lg:rounded-lg lg:border"
    >
      <h2 id={headingId} className="sr-only">
        {copy.regionLabel}
      </h2>
      {/* Layout refactor (owner: option A): the region's header row is now
        * common to every tab — the Grafiek/Kleuren/Lettertype tablist on the
        * left, "Taal van de grafiek" and a Close button on the right (its
        * own visible <label> dropped; the select already carried an
        * identical `aria-label`, so removing the label line loses no
        * accessible name). Previously the language select lived inside the
        * Grafiek tabpanel only. */}
      <div className="flex items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label={copy.tabsLabel}
          onKeyDown={onTabsKeyDown}
          className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
        >
          {tabButton('chart', copy.tabChart)}
          {tabButton('colors', copy.tabColors)}
          {tabButton('font', copy.tabFont)}
          {tabButton('frame', copy.tabFrame)}
        </div>
        {/* WP218 phase 4 (#219, design §4), owner ask (2026-09-09): the select
          * preselects the chart's CURRENT language — `resolved.values.language
          * ?? lang`, i.e. the per-chart override if one is set, else the
          * resolved language the chart is actually showing right now (`lang`,
          * which chart.tsx already computes as `pres.language ?? appLang`).
          * Every pick is an explicit per-chart choice (`{ language: value }`);
          * `null` — "follow the app" — remains the untouched default a chart
          * starts with, it's just never produced by this control any more.
          * Always applicable/never locked (chart-presentation.ts), so this
          * renders identically on every form, table included. */}
        <select
          id={`${idPrefix}-style-language`}
          aria-label={copy.languageLabel}
          value={resolved.values.language ?? lang}
          onChange={(e) => onChange({ language: e.target.value as Lang })}
          className="rounded-md border border-border bg-background px-1.5 py-0.5 text-foreground"
        >
          <option value="nl">{copy.languageNl}</option>
          <option value="en">{copy.languageEn}</option>
        </select>
        <Button type="button" variant="ghost" size="sm" aria-label={copy.close} onClick={closeAndRefocus}>
          <X aria-hidden="true" />
        </Button>
      </div>

      {activeTab === 'chart' ? (
        <div
          id={panelId('chart')}
          role="tabpanel"
          aria-labelledby={tabId('chart')}
          className="mt-3 flex flex-col items-start gap-3"
        >
          {/* WP218 phase 2 (owner C): only when the account default is
            * actually what's on screen — a non-pristine panel means the
            * reader's own per-chart tweaks are showing, not the saved
            * default, so the hint would misrepresent what's rendered. */}
          {account?.hasDefault && resolved.pristine ? (
            <p className="w-full text-muted-foreground">{copy.accountHint}</p>
          ) : null}
          {/* Owner decision (option A, compact grid): one row per group
            * (Lijndikte/Punten/Rasterlijnen/Labels op de x-as), then a single
            * "Tonen" row for the three on/off toggles — a flat list of
            * label+value pairs as DIRECT children of one grid container
            * (each pair wrapped in a keyed Fragment, which contributes no
            * element of its own to the DOM) so the grid's own two-column
            * auto-placement lines every label up against its own value,
            * across groups, without a wrapper div per row breaking that. */}
          <div className={GRID_CLASS}>
            {radioGroups.map((group) => {
              if (!resolved.applicable.has(group.key)) return null;
              const reason = resolved.locks[group.key];
              const locked = reason !== undefined;
              const groupLabelId = `${idPrefix}-style-label-${group.key}`;
              const reasonId = locked ? `${idPrefix}-style-reason-${group.key}` : undefined;
              const current = resolved.values[group.key] as string;
              return (
                <Fragment key={group.key}>
                  <span id={groupLabelId} className="text-xs text-muted-foreground pt-1">
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
                  {/* A locked control's reason: `position: absolute` (Tailwind's
                    * `sr-only`) takes it out of grid flow entirely, so this
                    * third Fragment child never becomes a spurious third
                    * column. */}
                  {locked ? (
                    <span id={reasonId} className="sr-only">
                      {reason}
                    </span>
                  ) : null}
                </Fragment>
              );
            })}

            {visibleToggles.length > 0 ? (
              <Fragment key="show-group">
                <span id={showGroupLabelId} className="text-xs text-muted-foreground pt-1">
                  {copy.showGroup}
                </span>
                <div role="group" aria-labelledby={showGroupLabelId} className="flex flex-wrap gap-1.5">
                  {visibleToggles.map((toggle) => {
                    const reason = resolved.locks[toggle.key];
                    const locked = reason !== undefined;
                    const reasonId = locked ? `${idPrefix}-style-reason-${toggle.key}` : undefined;
                    const pressed = resolved.values[toggle.key] === toggle.onValue;
                    return (
                      <button
                        key={toggle.key}
                        type="button"
                        aria-pressed={pressed}
                        aria-describedby={reasonId}
                        disabled={locked}
                        onClick={() => emit(toggle.key, pressed ? toggle.offValue : toggle.onValue)}
                        className={pillClass(pressed)}
                      >
                        {toggle.label}
                      </button>
                    );
                  })}
                </div>
                {visibleToggles.map((toggle) => {
                  const reason = resolved.locks[toggle.key];
                  if (reason === undefined) return null;
                  return (
                    <span key={toggle.key} id={`${idPrefix}-style-reason-${toggle.key}`} className="sr-only">
                      {reason}
                    </span>
                  );
                })}
              </Fragment>
            ) : null}
          </div>
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
                const draft = liveDrafts[series.key];
                const displayText = draft !== undefined ? draft.text : series.color;
                // Warn only about a colour the reader CHOSE: the stock palette's own
                // weak entries (e.g. the yellow on white) are the owner's accepted
                // session-87 trade-off, not something to nag about untouched.
                const settled = settledColorFor(series.key, series.color);
                const chosen = resolved.values.seriesColors[index] !== undefined || settled !== series.color;
                const warning = chosen ? warningFor(settled) : null;
                const alertEntry = liveAlerts[series.key];
                const alert = alertEntry !== undefined ? alertEntry.reason : null;
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
                    <ColorField
                      ariaLabelHex={`${copy.colourOf} ${series.label} ${copy.hexSuffix}`}
                      ariaLabelPicker={`${copy.colourOf} ${series.label} ${copy.pickSuffix}`}
                      ariaDescribedBy={alert ? alertId : warning ? warnId : undefined}
                      textValue={displayText}
                      pickerValue={series.color}
                      onTextChange={(v) =>
                        setColorDrafts((d) => ({
                          ...d,
                          [series.key]: { text: v, forColor: series.color, committed: false },
                        }))
                      }
                      onBlur={(v) => commitColor(series.key, index, series.color, v)}
                      onKeyDown={(v, key) => {
                        if (key === 'Enter') commitColor(series.key, index, series.color, v);
                      }}
                      onPickerChange={(v) => commitColor(series.key, index, series.color, v)}
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

              {/* WP218 phase 3 (owner B): under the series rows, gated on
                * `brand` the same way the account footer is gated on
                * `account` — absent entirely for Ontdek/trial. */}
              {brand ? (
                <div className="mt-1 flex w-full flex-col items-start gap-2 border-t border-border pt-3">
                  <span className="font-medium text-foreground">{copy.brandHeading}</span>
                  <p className="text-muted-foreground">{copy.brandIntro}</p>
                  {brandNeedsWebsite ? (
                    <Input
                      type="text"
                      inputMode="text"
                      aria-label={copy.brandWebsiteLabel}
                      placeholder={copy.brandWebsitePlaceholder}
                      value={brandWebsite}
                      onChange={(e) => setBrandWebsite(e.target.value)}
                      className="w-48"
                    />
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={brandBusy}
                    onClick={() => void handleApplyBrand()}
                  >
                    {copy.brandApply}
                  </Button>
                  {brandOutcome ? (
                    brandOutcome.kind === 'applied' ? (
                      <>
                        <p role="status" className="w-full text-muted-foreground">
                          {copy.brandApplied.replace('{name}', brandOutcome.name)}
                        </p>
                        {brandOutcome.fontSkipped ? (
                          <p className="w-full text-muted-foreground">{copy.brandFontSkipped}</p>
                        ) : null}
                      </>
                    ) : (
                      <p role="status" className="w-full text-muted-foreground">
                        {brandFailureText(brandOutcome.reason)}
                      </p>
                    )
                  ) : null}
                </div>
              ) : null}
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
          {/* Table form (design §C2): `fontFamily` is outside `applicable`
            * there (same gate the Grafiek/Kleuren tabs already use) — the
            * Frame tab is the one control set table form actually offers. */}
          {resolved.applicable.has('fontFamily') ? (
            <>
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
                {/* Final-review fix: an applied brand font (phase 3's
                  * `pickBrandFont`) can be any family outside the seven
                  * curated FONT_OPTIONS — without this, `value` above
                  * matches none of the options and the select silently
                  * renders blank, so touching it (even without changing
                  * anything) looked like it discarded the brand font. */}
                {resolved.values.fontFamily !== null &&
                !FONT_OPTIONS.some((f) => f.family === resolved.values.fontFamily) ? (
                  <option value={resolved.values.fontFamily}>{resolved.values.fontFamily}</option>
                ) : null}
              </select>
            </>
          ) : null}
        </div>
      ) : null}

      {/* Final-review fix: the Frame tab is NOT applicable in table form —
        * table form has no frame and no Style panel at all, exactly like
        * every other tab here. Gated on `applicable` for consistency with
        * the rest of the panel, even though in practice chart.tsx never
        * mounts this panel at all in table form. */}
      {activeTab === 'frame' && resolved.applicable.has('frameBackground') ? (
        <div
          id={panelId('frame')}
          role="tabpanel"
          aria-labelledby={tabId('frame')}
          className="mt-3 flex flex-col items-start gap-3"
        >
          <div className={GRID_CLASS}>
            {(() => {
              const bg = resolved.values.frameBackground;
              const bgKind = bg === 'none' ? 'none' : bg.kind;
              const bgGroupLabelId = `${idPrefix}-style-label-frameBackground`;
              return (
                <Fragment key="frameBackground">
                  <span id={bgGroupLabelId} className="text-xs text-muted-foreground pt-1">
                    {copy.frameBackground}
                  </span>
                  <div
                    role="radiogroup"
                    aria-labelledby={bgGroupLabelId}
                    onKeyDown={onRadioGroupKeyDown}
                    className="flex flex-wrap gap-1.5"
                  >
                    {(
                      [
                        ['none', copy.frameBgNone],
                        ['solid', copy.frameBgSolid],
                        ['gradient', copy.frameBgGradient],
                        ['image', copy.frameBgImage],
                      ] as const
                    ).map(([kind, label]) => {
                      const checked = bgKind === kind;
                      return (
                        <button
                          key={kind}
                          type="button"
                          role="radio"
                          aria-checked={checked}
                          tabIndex={checked ? 0 : -1}
                          onClick={() => pickFrameBackgroundKind(kind)}
                          className={pillClass(checked)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  <span aria-hidden />
                  <div className="flex w-full flex-wrap items-center gap-2">
                    {bgKind === 'solid' && bg !== 'none' && bg.kind === 'solid' ? (
                      <FrameHexField
                        key={bg.hex}
                        value={bg.hex}
                        onCommit={(hex) => tryFrameChange({ frameBackground: { kind: 'solid', hex } })}
                        ariaLabelHex={`${copy.frameBackground} (hex)`}
                        ariaLabelPicker={copy.frameBackground}
                      />
                    ) : null}
                    {bgKind === 'gradient' && bg !== 'none' && bg.kind === 'gradient' ? (
                      <div className="flex w-full flex-col gap-2">
                        <div role="group" aria-label={copy.frameGradientPreset} className="flex flex-wrap gap-1.5">
                          {FRAME_GRADIENT_PRESETS.map((preset) => {
                            const wouldBackdrops = frameBackdrops({
                              ...resolved.values,
                              frameBackground: { kind: 'gradient', from: preset.from, to: preset.to },
                            });
                            const refused = seriesMeta.some((series) =>
                              wouldBackdrops.some((backdrop) => contrastRatio(series.color, backdrop) < COLOR_REFUSE_BELOW),
                            );
                            const describedById = refused ? `${idPrefix}-frame-preset-refused-${preset.id}` : undefined;
                            return (
                              <Fragment key={preset.id}>
                                <button
                                  type="button"
                                  aria-label={frameGradientLabels[preset.id]}
                                  aria-pressed={bg.from === preset.from && bg.to === preset.to}
                                  disabled={refused}
                                  title={refused ? copy.frameBgRefused : undefined}
                                  aria-describedby={describedById}
                                  onClick={() => tryFrameChange({ frameBackground: { kind: 'gradient', from: preset.from, to: preset.to } })}
                                  style={{ backgroundImage: `linear-gradient(135deg, ${preset.from}, ${preset.to})` }}
                                  className={cn('size-6 rounded-md border border-border', refused && 'cursor-not-allowed opacity-40')}
                                />
                                {refused ? (
                                  <span id={describedById} hidden>
                                    {copy.frameBgRefused}
                                  </span>
                                ) : null}
                              </Fragment>
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-muted-foreground">{copy.frameFrom}</span>
                          <FrameHexField
                            key={`from-${bg.from}`}
                            value={bg.from}
                            onCommit={(hex) => tryFrameChange({ frameBackground: { kind: 'gradient', from: hex, to: bg.to } })}
                            ariaLabelHex={`${copy.frameFrom} (hex)`}
                            ariaLabelPicker={copy.frameFrom}
                          />
                          <span className="text-xs text-muted-foreground">{copy.frameTo}</span>
                          <FrameHexField
                            key={`to-${bg.to}`}
                            value={bg.to}
                            onCommit={(hex) => tryFrameChange({ frameBackground: { kind: 'gradient', from: bg.from, to: hex } })}
                            ariaLabelHex={`${copy.frameTo} (hex)`}
                            ariaLabelPicker={copy.frameTo}
                          />
                        </div>
                      </div>
                    ) : null}
                    {bgKind === 'image' ? (
                      <div className="flex w-full flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            ref={frameFileInputRef}
                            type="file"
                            tabIndex={-1}
                            accept="image/png,image/jpeg,image/webp"
                            aria-label={copy.frameImagePick}
                            className="sr-only"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (file) handleFrameFile(file);
                            }}
                          />
                          <Button type="button" variant="outline" size="xs" onClick={() => frameFileInputRef.current?.click()}>
                            {copy.frameImagePick}
                          </Button>
                          {frameImage !== null ? (
                            <Button type="button" variant="outline" size="xs" onClick={handleFrameImageRemove}>
                              {copy.frameImageRemove}
                            </Button>
                          ) : null}
                        </div>
                        {frameImageAlert === 'tooLarge' ? (
                          <p role="alert" className="w-full text-destructive">
                            {copy.frameImageTooLarge}
                          </p>
                        ) : null}
                        {frameImageAlert === 'badType' ? (
                          <p role="alert" className="w-full text-destructive">
                            {copy.frameImageBadType}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </Fragment>
              );
            })()}

            {frameRadioGroups.map((group) =>
              frameRadioRow(idPrefix, group, resolved.values[group.key] as string, (value) => {
                // Final-review fix (Fix 5): only turning the inset card OFF
                // needs the contrast guard — turning it ON changes the
                // backdrop to the card colours, which the resolver's own
                // colour guard already keeps series legible against.
                if (group.key === 'frameInset' && value === 'none') {
                  tryFrameChange({ frameInset: 'none' });
                  return;
                }
                emit(group.key, value);
              }),
            )}
            {frameBgRefused ? (
              <p role="alert" className="w-full text-destructive">
                {copy.frameBgRefused}
              </p>
            ) : null}
          </div>

          <div className="mt-1 flex items-center justify-between gap-2 border-t border-border pt-3 w-full">
            <span />
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={isFramePristine(resolved.values) && frameImage === null}
              onClick={handleFrameReset}
            >
              {copy.frameReset}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Review fix: this footer (the "why not pie" note + the full
        * "Standaard" reset) renders only on the Grafiek tab now — on Kleuren
        * it used to sit beside "Standaardkleuren", showing two resets side
        * by side. `resolved.pristine` still reflects EVERY tab's overrides
        * (Standaard, when shown, still resets all of them), this only
        * changes which tab the button itself is visible on. */}
      {activeTab === 'chart' ? (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
          {/* WP218 phase 5 (chart-types plan, Task 3): one collapsed note
            * explaining why pie/donut, stacked, scatter and sorted-by-value
            * forms are never offered — collapsed by default so it doesn't
            * compete with the controls above, plain <details>/<summary> rather
            * than a JS-driven disclosure (cheapest mechanism first: the
            * browser already does open/close). */}
          <details className="text-xs text-muted-foreground">
            <summary>{copy.whyNotTitle}</summary>
            <p>{copy.whyNotBody}</p>
          </details>
          <Button type="button" variant="outline" size="xs" disabled={resolved.pristine} onClick={onReset}>
            {copy.reset}
          </Button>
        </div>
      ) : null}

      {/* WP218 phase 2 (owner C): a footer row visible regardless of the
        * active tab (unlike the tabpanel bodies above) — the account
        * default is a property of the whole panel, not any one tab.
        * Absent entirely for a signed-out/trial visitor (no `account`
        * prop at all — chart.tsx never passes one then). */}
      {account ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button type="button" variant="outline" size="xs" disabled={accountBusy} onClick={() => void handleAccountSave()}>
            {copy.accountSave}
          </Button>
          {account.hasDefault ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={accountBusy}
              onClick={() => void handleAccountForget()}
            >
              {copy.accountForget}
            </Button>
          ) : null}
          {accountStatus ? (
            <p role="status" className="w-full text-muted-foreground">
              {accountStatusText(accountStatus)}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  ) : null;

  return dialogContent && typeof document !== 'undefined' ? createPortal(dialogContent, document.body) : null;
}
