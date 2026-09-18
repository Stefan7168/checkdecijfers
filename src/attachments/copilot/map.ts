// The co-pilot's label→key mapping (session 113, co-pilot phase 2). PURE.
//
// The model answers in the vocabulary it was SHOWN: series labels, x
// labels, style enum values, template ids. Nothing it wrote is trusted as a
// key: every command stored here is built by DETERMINISTIC LOOKUP against
// the chart that was actually executed (the chart AFTER the new
// instruction — copilot/respond.ts executes before mapping). A label that
// does not resolve becomes a refusal naming the control that CAN do it,
// never a guess at the nearest match.
import { toClientInstruction, type ClientChartInstruction, type CopilotCommand, type CopilotRefusal, type UserChartSpec } from '../types.ts';
import { stripDigits, unplottedDigits } from './text-guard.ts';
import { TEMPLATE_IDS, type CopilotOutput } from './types.ts';

/** The same caps web/lib's chart-commands.ts enforces on dispatch — applied
 * here too so a stored command is never one the client will drop. */
const TITLE_MAX = 120;
const CAPTION_MAX = 280;
const NOTE_MAX = 280;
/** A refused request is a label for the reader, not a transcript. */
const REQUEST_MAX = 80;

const HEX = /^#[0-9a-f]{6}$/i;
/** Mirrors web/lib/chart-presentation.ts's FONT_FAMILY_NAME exactly — the
 * ONE model-authored string that would otherwise reach a stored command
 * unchecked. Without this, an off-pattern font name is dropped silently by
 * `sanitizeOverrides` on dispatch, i.e. an "applied" chip that changes
 * nothing (review round 1). Same treatment as a malformed hex: drop the
 * key, and drop the patch when that empties it. */
const FONT_FAMILY_NAME = /^[A-Za-z0-9 ]{1,40}$/;

function cap(text: string): string {
  return text.slice(0, REQUEST_MAX);
}

/** Structural deep equality — NOT JSON.stringify: the two sides come from
 * different places (the model's parsed JSON vs. the browser's held state),
 * so nested key ORDER differs freely and a string compare would report a
 * difference that isn't one, emitting a redundant setInstruction. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && deepEqual(left[key], right[key]));
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
  chart: UserChartSpec,
  control: CopilotRefusal['control'],
  out: Mapped,
): string | null {
  const trimmed = text.trim().slice(0, max);
  if (trimmed.length === 0) {
    out.refused.push({ request: '', reason: 'invalid', control });
    return null;
  }
  if (unplottedDigits(trimmed, chart).length > 0) {
    out.refused.push({ request: cap(trimmed), reason: 'unplotted_number', control: 'none' });
    return null;
  }
  return trimmed;
}

/**
 * Maps one validated CopilotOutput onto the commands the chat turn stores.
 * `summary` is the plain-language description of the new instruction
 * (Task 6's summarizeInstruction, injected by respond.ts) shown on the
 * data chip — deterministic text, never the model's own prose.
 *
 * `noteIdSuffix` disambiguates the note ids this reply mints (final review,
 * session 113): two chat notes on the SAME point used to share the id
 * `chat-${rowRef}`, and the second was silently deduped by `applyCommand`
 * while its chip claimed "applied". Tests pass a fixed suffix.
 */
export function mapCopilotOutput(
  output: CopilotOutput,
  chart: UserChartSpec,
  current: ClientChartInstruction,
  summary: string,
  noteIdSuffix: string = Date.now().toString(36),
): Mapped {
  const out: Mapped = { commands: [], refused: [] };
  let noteCount = 0;

  // Rule 1: the data change comes FIRST — every view command below is
  // expressed against the chart that instruction produces.
  if (output.instruction !== null) {
    const next = toClientInstruction(output.instruction);
    if (!deepEqual(next, current)) {
      out.commands.push({ kind: 'setInstruction', instruction: next, summary });
    }
  }

  const seriesIndex = new Map<string, number>();
  chart.series.forEach((series, index) => {
    if (!seriesIndex.has(series.label)) seriesIndex.set(series.label, index);
  });

  for (const command of output.view) {
    switch (command.kind) {
      // Rule 2: the client validates the form against the spec kind.
      case 'setForm':
        out.commands.push({ kind: 'setForm', form: command.form });
        break;

      // Rule 3: labels → the `s${index}` keys web/lib's reducer uses. One
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

      // Rule 4: null = "the model did not set this key", so it is stripped.
      // One consequence, deliberate: `fontFamily: null` (back to the page
      // font) cannot be expressed through the chat, because it is
      // indistinguishable from "not changing the font" in a schema with no
      // optionals. resetPresentation, or the Style panel, does that.
      // Series colours become an index-keyed map (the shape
      // ChartPresentation.seriesColors declares). An unknown label or a
      // malformed hex is dropped, not refused — a colour the model guessed
      // for a series that isn't there is noise, not a request. An empty
      // resulting patch is dropped silently for the same reason.
      case 'setPresentation': {
        const patch: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(command.patch)) {
          if (key === 'seriesColors') continue;
          if (value === null) continue;
          if (key === 'fontFamily' && !(typeof value === 'string' && FONT_FAMILY_NAME.test(value))) continue;
          patch[key] = value;
        }
        const colors: Record<number, string> = {};
        for (const { seriesLabel, hex } of command.patch.seriesColors) {
          const index = seriesIndex.get(seriesLabel);
          if (index === undefined || !HEX.test(hex)) continue;
          colors[index] = hex.toLowerCase();
        }
        if (Object.keys(colors).length > 0) patch.seriesColors = colors;
        if (Object.keys(patch).length === 0) break;
        out.commands.push({ kind: 'setPresentation', patch });
        break;
      }

      // Rule 5.
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

      // Rule 6: null clears the reader's own title/caption (back to the
      // spec's), which is a legitimate edit and carries no text to guard.
      case 'setTitle': {
        if (command.title === null) {
          out.commands.push({ kind: 'setTitle', title: null });
          break;
        }
        const title = guardText(command.title, TITLE_MAX, chart, 'none', out);
        if (title !== null) out.commands.push({ kind: 'setTitle', title });
        break;
      }

      case 'setCaption': {
        if (command.caption === null) {
          out.commands.push({ kind: 'setCaption', caption: null });
          break;
        }
        const caption = guardText(command.caption, CAPTION_MAX, chart, 'none', out);
        if (caption !== null) out.commands.push({ kind: 'setCaption', caption });
        break;
      }

      // Rule 7: the note anchors to a REAL point, found by (series label, x
      // label). `resultId` — the anchor — is the point's rowRef, so replaying
      // the same stored command can never move the note. The `id` adds this
      // reply's suffix and the note's index within the reply, so two notes on
      // one point are two notes (see noteIdSuffix above).
      case 'addNote': {
        const point = chart.series
          .find((series) => series.label === command.seriesLabel)
          ?.points.find((p) => p.xLabel === command.xLabel);
        if (point === undefined) {
          out.refused.push({
            request: cap(`note: ${command.seriesLabel} @ ${command.xLabel}`),
            reason: 'not_on_this_chart',
            control: 'notes',
          });
          break;
        }
        const text = guardText(command.text, NOTE_MAX, chart, 'notes', out);
        if (text === null) break;
        out.commands.push({
          kind: 'addNote',
          note: {
            id: `chat-${point.rowRef}-${noteCount++}${noteIdSuffix}`,
            resultId: point.rowRef,
            periodLabel: command.xLabel,
            seriesLabel: command.seriesLabel,
            text,
          },
        });
        break;
      }
    }
  }

  // Rule 8: the model's own refusals, after our mapping's. The `request`
  // text is model-authored and DOES reach the screen (chart-copilot-reply's
  // refusalLine, replayed by dataset-chat), so it owes the reader the same
  // digit guard as a title/caption/note — but a refusal can't itself be
  // refused, so an unplotted number is stripped and the sentence kept
  // (final review, session 113).
  for (const item of output.refused) {
    const request = unplottedDigits(item.request, chart).length > 0 ? stripDigits(item.request) : item.request;
    out.refused.push({ request: cap(request), reason: item.reason, control: item.control });
  }

  return out;
}
