// The CBS chart co-pilot's label→key mapping (session 114, co-pilot phase
// 3). PURE. Selection-only sibling of src/attachments/copilot/map.ts.
//
// The model answers in the vocabulary it was SHOWN: series labels, period
// labels, style enum values, template ids. Nothing it wrote is trusted as a
// key: every command stored here is built by DETERMINISTIC LOOKUP against
// the spec the reader is actually looking at. A label that does not resolve
// becomes a refusal naming the control that CAN do it, never a guess at the
// nearest match.
import type { CopilotCommand, CopilotRefusal } from '../../attachments/types.ts';
import type { ChartSpec } from '../types.ts';
import { stripDigits, unplottedDigits } from './text-guard.ts';
import { TEMPLATE_IDS, type CbsCopilotCapabilities, type CbsCopilotOutput } from './types.ts';

/** Same caps web/lib's chart-commands.ts enforces on dispatch — applied
 * here too so a stored command is never one the client will drop. */
const TITLE_MAX = 120;
const CAPTION_MAX = 280;
const NOTE_MAX = 280;
/** A refused request is a label for the reader, not a transcript. */
const REQUEST_MAX = 80;

const FONT_FAMILY_NAME = /^[A-Za-z0-9 ]{1,40}$/;

function cap(text: string): string {
  return text.slice(0, REQUEST_MAX);
}

interface Mapped {
  commands: CopilotCommand[];
  refused: CopilotRefusal[];
}

/** Text a title/caption/note may carry: trimmed, capped, and refused
 * outright when it names a number that is not on the chart. */
function guardText(
  text: string,
  max: number,
  spec: ChartSpec,
  control: CopilotRefusal['control'],
  out: Mapped,
): string | null {
  const trimmed = text.trim().slice(0, max);
  if (trimmed.length === 0) {
    out.refused.push({ request: '', reason: 'invalid', control });
    return null;
  }
  if (unplottedDigits(trimmed, spec).length > 0) {
    out.refused.push({ request: cap(trimmed), reason: 'unplotted_number', control: 'none' });
    return null;
  }
  return trimmed;
}

/**
 * Maps one validated CbsCopilotOutput onto the commands the chart's
 * chat-edit log stores. `noteIdSuffix` disambiguates the note ids this
 * reply mints (two chat notes on the SAME point would otherwise share the
 * id `chat-${resultId}-0`); tests pass a fixed suffix.
 */
export function mapCbsCopilotOutput(
  output: CbsCopilotOutput,
  spec: ChartSpec,
  capabilities: CbsCopilotCapabilities,
  noteIdSuffix: string = Date.now().toString(36),
): Mapped {
  const out: Mapped = { commands: [], refused: [] };
  let noteCount = 0;

  const seriesIndex = new Map<string, number>();
  spec.series.forEach((series, index) => {
    if (!seriesIndex.has(series.label)) seriesIndex.set(series.label, index);
  });

  // Every period code, ascending — the same order chart.tsx's own
  // `allPeriodCodes` uses (localeCompare over the CBS period-code space),
  // and a label→code lookup over EVERY point of EVERY series (a period
  // may be missing from one series but present on another — a chart that
  // still has SOME data at that period should still resolve it).
  const periodCodeByLabel = new Map<string, string>();
  for (const series of spec.series) {
    for (const point of series.points) {
      if (!periodCodeByLabel.has(point.periodLabel)) periodCodeByLabel.set(point.periodLabel, point.periodCode);
    }
  }

  for (const command of output.view) {
    switch (command.kind) {
      // Refused when the form is not one this card currently offers
      // (capabilities.forms, browser-supplied and enum-checked upstream).
      case 'setForm':
        if ((capabilities.forms as readonly string[]).includes(command.form)) {
          out.commands.push({ kind: 'setForm', form: command.form });
        } else {
          out.refused.push({ request: cap(`form: ${command.form}`), reason: 'not_available', control: 'form' });
        }
        break;

      // Labels → the `s${index}` keys chart.tsx's reducer uses. One
      // unknown label refuses the WHOLE command: a partially applied
      // hide/highlight would silently mean something else than what was
      // asked.
      case 'setSeriesView': {
        const unknown = [...command.hiddenLabels, ...(command.highlightedLabel === null ? [] : [command.highlightedLabel])].find(
          (label) => !seriesIndex.has(label),
        );
        if (unknown !== undefined) {
          out.refused.push({ request: cap(`series: ${unknown}`), reason: 'not_on_this_chart', control: 'form' });
          break;
        }
        out.commands.push({
          kind: 'setSeriesView',
          hiddenKeys: command.hiddenLabels.map((label) => `s${seriesIndex.get(label)!}`),
          highlightedKey: command.highlightedLabel === null ? null : `s${seriesIndex.get(command.highlightedLabel)!}`,
        });
        break;
      }

      // Both labels null clears the zoom — no capability check needed,
      // clearing is always available. Otherwise both labels must resolve
      // to a real period, `capabilities.zoom` must say the card offers the
      // Vanaf/Tot control, and the resolved codes are swapped into
      // ascending order (localeCompare, the same order allPeriodCodes
      // uses) when the model named them reversed.
      case 'setPeriodRange': {
        if (command.fromLabel === null && command.toLabel === null) {
          out.commands.push({ kind: 'setPeriodRange', range: null });
          break;
        }
        const fromCode = command.fromLabel === null ? undefined : periodCodeByLabel.get(command.fromLabel);
        const toCode = command.toLabel === null ? undefined : periodCodeByLabel.get(command.toLabel);
        if (fromCode === undefined || toCode === undefined) {
          out.refused.push({
            request: cap(`period: ${command.fromLabel ?? '?'}–${command.toLabel ?? '?'}`),
            reason: 'not_available',
            control: 'form',
          });
          break;
        }
        if (!capabilities.zoom) {
          out.refused.push({
            request: cap(`period: ${command.fromLabel ?? '?'}–${command.toLabel ?? '?'}`),
            reason: 'not_available',
            control: 'form',
          });
          break;
        }
        const [a, b] = fromCode.localeCompare(toCode) <= 0 ? [fromCode, toCode] : [toCode, fromCode];
        out.commands.push({ kind: 'setPeriodRange', range: [a, b] });
        break;
      }

      // null strips a key the model did not set — the patch's own schema
      // has no optionals, so every key is present and nullable. An empty
      // resulting patch is dropped silently.
      case 'setPresentation': {
        const patch: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(command.patch)) {
          if (key === 'seriesColors') continue;
          if (value === null) continue;
          // Mirrors web/lib/chart-presentation.ts's FONT_FAMILY_NAME (the
          // own-data map's rule): an off-pattern font name would be dropped
          // silently by `sanitizeOverrides` on dispatch — an "applied" chip
          // that changes nothing.
          if (key === 'fontFamily' && !(typeof value === 'string' && FONT_FAMILY_NAME.test(value))) continue;
          patch[key] = value;
        }
        const colors: Record<number, string> = {};
        const hexPattern = /^#[0-9a-f]{6}$/i;
        for (const { seriesLabel, hex } of command.patch.seriesColors) {
          const index = seriesIndex.get(seriesLabel);
          if (index === undefined || !hexPattern.test(hex)) continue;
          colors[index] = hex.toLowerCase();
        }
        if (Object.keys(colors).length > 0) patch.seriesColors = colors;
        if (Object.keys(patch).length === 0) break;
        out.commands.push({ kind: 'setPresentation', patch });
        break;
      }

      case 'applyTemplate':
        if ((TEMPLATE_IDS as readonly string[]).includes(command.templateId)) {
          out.commands.push({ kind: 'applyTemplate', templateId: command.templateId });
        } else {
          out.refused.push({ request: cap(`template: ${command.templateId}`), reason: 'not_available', control: 'style' });
        }
        break;

      case 'resetPresentation':
        out.commands.push({ kind: 'resetPresentation' });
        break;

      // null clears the reader's own title/caption, a legitimate edit that
      // carries no text to guard.
      case 'setTitle': {
        if (command.title === null) {
          out.commands.push({ kind: 'setTitle', title: null });
          break;
        }
        const title = guardText(command.title, TITLE_MAX, spec, 'none', out);
        if (title !== null) out.commands.push({ kind: 'setTitle', title });
        break;
      }

      case 'setCaption': {
        if (command.caption === null) {
          out.commands.push({ kind: 'setCaption', caption: null });
          break;
        }
        const caption = guardText(command.caption, CAPTION_MAX, spec, 'none', out);
        if (caption !== null) out.commands.push({ kind: 'setCaption', caption });
        break;
      }

      // The note anchors to a REAL point, found by (series label, period
      // label). `resultId` is the point's own traceability handle, so
      // replaying the same stored command can never move the note.
      case 'addNote': {
        const point = spec.series
          .find((series) => series.label === command.seriesLabel)
          ?.points.find((p) => p.periodLabel === command.periodLabel);
        if (point === undefined) {
          out.refused.push({
            request: cap(`note: ${command.seriesLabel} @ ${command.periodLabel}`),
            reason: 'not_on_this_chart',
            control: 'notes',
          });
          break;
        }
        const text = guardText(command.text, NOTE_MAX, spec, 'notes', out);
        if (text === null) break;
        out.commands.push({
          kind: 'addNote',
          note: {
            id: `chat-${point.resultId}-${noteCount++}${noteIdSuffix}`,
            resultId: point.resultId,
            periodLabel: command.periodLabel,
            seriesLabel: command.seriesLabel,
            text,
          },
        });
        break;
      }
    }
  }

  // The model's own refusals, after our mapping's. `request` is
  // model-authored and reaches the screen, so it owes the reader the same
  // digit guard as a title/caption/note — but a refusal can't itself be
  // refused, so an unplotted number is stripped and the sentence kept.
  for (const item of output.refused) {
    const request = unplottedDigits(item.request, spec).length > 0 ? stripDigits(item.request) : item.request;
    out.refused.push({ request: cap(request), reason: item.reason, control: item.control });
  }

  return out;
}
