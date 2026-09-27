// Session 136 (spec docs/superpowers/specs/2026-09-27-shared-charts-match-design.md):
// what of a reader's own edits may leave the app on a PUBLIC surface — a
// PNG/SVG/PDF download or the public embed page. Pure, no React, safe on the
// server (the embed page prunes before anything is serialised to the anonymous
// visitor's browser) and in the client bundle (chart.tsx's download menu).
//
// The numbers rule (principle (a), R1/R6/R11): in the app a reader-typed title
// or caption is the reader's own words, shown unchecked OUTSIDE the chart image
// (ADR 056's provenance split). On a download or an embed it sits next to
// "Bron: CBS", so it may only go out when every number in it is on the chart —
// the co-pilot's existing digit guard (`unplottedDigits`), judged against the
// Dutch spec AND its English display form, since the reader may have typed
// either spelling ("17.942.942" or "17,942,942").
//
// Notes stay private (ADR 038, owner decision 2026-09-27): note commands never
// leave the server, and the typed label of a goal line / shaded period is
// replaced by a digit-free placeholder (the line and the band still draw).
import { unplottedDigits } from '../backend/chart/copilot/text-guard.ts';
import { toEnglishChartSpec } from '../backend/chart/english.ts';
import type { ChartSpec } from '../backend/chart/types.ts';
import { parseCommandLog, type ChartCommand } from './chart-commands.ts';
import { sanitizeOverrides, type PresentationOverrides } from './chart-presentation.ts';

/** Stands in for a goal-line / shaded-period label on a public surface.
 * Non-empty (validateCommand requires a label) and digit-free; never shown —
 * the lists that print these labels are hidden in embed mode. */
export const PUBLISHED_LABEL_PLACEHOLDER = '·';

/** Commands that never go out: private notes, the alternate-reading choice
 * (an embed republishes the primary answer; the embed dialog is disabled
 * while a reading is selected) and the own-data-only commands, which have no
 * meaning on a CBS chart. */
const DROPPED_KINDS: ReadonlySet<ChartCommand['kind']> = new Set<ChartCommand['kind']>([
  'addNote',
  'removeNote',
  'setReading',
  'setInstruction',
  'addDerivedOverlay',
  'removeDerivedOverlay',
  'setWholeReference',
]);

/** True when `text` carries no number that is missing from `spec` in both its
 * Dutch form and its English display form. */
export function passesNumbersRule(text: string, spec: ChartSpec): boolean {
  const dutch = unplottedDigits(text, spec);
  if (dutch.length === 0) return true;
  // An offender is a run that neither spelling of the chart shows.
  const english = unplottedDigits(text, toEnglishChartSpec(spec));
  return dutch.every((run) => !english.includes(run));
}

/** A reader-typed text for a public surface: the text itself when it passes
 * the numbers rule, otherwise null. Null/blank in → null out. */
export function publishableText(text: string | null, spec: ChartSpec): string | null {
  if (text === null || text.trim() === '') return null;
  return passesNumbersRule(text, spec) ? text : null;
}

/** The embed decides its own language (`?lang=`), so a per-chart language
 * stored in the author's presentation must not override it. */
function withoutLanguage(overrides: PresentationOverrides): PresentationOverrides {
  const { language: _language, ...rest } = overrides;
  return rest;
}

/** The author's saved command log, pruned for the public embed page. `raw` is
 * the stored jsonb (untrusted: re-parsed here). Returns null when there is
 * nothing usable. `spec` is the spec the visitor will actually see (the live
 * re-run's on a `?live=1` embed), so a title quoting a since-revised value
 * falls back to the standard title. */
export function prunePublishedLog(raw: unknown, spec: ChartSpec): ChartCommand[] | null {
  const log = raw === null || raw === undefined ? null : parseCommandLog(raw);
  if (log === null) return null;
  const out: ChartCommand[] = [];
  for (const cmd of log) {
    if (DROPPED_KINDS.has(cmd.kind)) continue;
    switch (cmd.kind) {
      case 'setTitle':
        out.push({ ...cmd, title: publishableText(cmd.title, spec) });
        break;
      case 'setCaption':
        out.push({ ...cmd, caption: publishableText(cmd.caption, spec) });
        break;
      case 'addGoalLine':
        out.push({ ...cmd, goalLine: { ...cmd.goalLine, label: PUBLISHED_LABEL_PLACEHOLDER } });
        break;
      case 'addEraShading':
        out.push({ ...cmd, era: { ...cmd.era, label: PUBLISHED_LABEL_PLACEHOLDER } });
        break;
      case 'setPresentation':
        out.push({ ...cmd, patch: withoutLanguage(cmd.patch) });
        break;
      case 'replacePresentation':
        out.push({ ...cmd, overrides: withoutLanguage(cmd.overrides) });
        break;
      default:
        out.push(cmd);
    }
  }
  return out.length === 0 ? null : out;
}

/** The author's house style for the public embed: sanitised like any other
 * untrusted overrides, minus the language (see `withoutLanguage`). Null when
 * nothing valid is left. */
export function publishedStyle(raw: unknown): PresentationOverrides | null {
  const clean = withoutLanguage(sanitizeOverrides(raw));
  return Object.keys(clean).length === 0 ? null : clean;
}
