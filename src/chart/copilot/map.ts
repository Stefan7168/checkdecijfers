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
import { goalLineValueInMessage, stripDigits, unplottedDigits } from './text-guard.ts';
import { TEMPLATE_IDS, type CbsCopilotCapabilities, type CbsCopilotOutput } from './types.ts';

/** Same caps web/lib's chart-commands.ts enforces on dispatch — applied
 * here too so a stored command is never one the client will drop. */
const TITLE_MAX = 120;
const CAPTION_MAX = 280;
const NOTE_MAX = 280;
const ERA_LABEL_MAX = 60;
const GOAL_LINE_LABEL_MAX = 60;
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
 * chat-edit log stores. `message` is the reader's raw request, threaded
 * through since co-pilot phase 6: only addGoalLine reads it, to check that
 * the value the model wrote is one the reader actually typed. `noteIdSuffix`
 * disambiguates the ids this reply mints — notes (two chat notes on the
 * SAME point would otherwise share the id `chat-${resultId}-0`), era
 * shadings, overlays and goal lines alike; tests pass a fixed suffix.
 */
export function mapCbsCopilotOutput(
  output: CbsCopilotOutput,
  spec: ChartSpec,
  message: string,
  capabilities: CbsCopilotCapabilities,
  noteIdSuffix: string = Date.now().toString(36),
): Mapped {
  const out: Mapped = { commands: [], refused: [] };
  let noteCount = 0;
  // One counter for every id-minting command kind co-pilot phase 6 adds
  // (era shadings, derived overlays, goal lines) — kept apart from
  // noteCount so addNote's id scheme stays exactly what it was.
  let extraCount = 0;

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

      // Same label → `s${index}` lookup as setSeriesView, and one unknown
      // label refuses the WHOLE command for the same reason. A label named
      // in BOTH lists is refused as well: chart-commands.ts's
      // validateCommand drops a key that is hidden and dimmed at once, and
      // a stored command must never be one the client will drop.
      case 'setDimmed': {
        const unknown = [...command.hiddenLabels, ...command.dimmedLabels].find((label) => !seriesIndex.has(label));
        if (unknown !== undefined) {
          out.refused.push({ request: cap(`series: ${unknown}`), reason: 'not_on_this_chart', control: 'form' });
          break;
        }
        const both = command.hiddenLabels.find((label) => command.dimmedLabels.includes(label));
        if (both !== undefined) {
          out.refused.push({ request: cap(`series: ${both}`), reason: 'invalid', control: 'form' });
          break;
        }
        out.commands.push({
          kind: 'setDimmed',
          hiddenKeys: command.hiddenLabels.map((label) => `s${seriesIndex.get(label)!}`),
          dimmedKeys: command.dimmedLabels.map((label) => `s${seriesIndex.get(label)!}`),
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

      // Both labels must resolve to a real period (the same label→code
      // lookup setPeriodRange uses) and the resolved codes are swapped into
      // ascending order the same way — chart-commands.ts's validateCommand
      // drops an era whose codes are reversed, and a stored command must
      // never be one the client will drop. The typed label owes the reader
      // the same digit guard as a title/caption/note. The id is minted
      // here, per era: the client reducer keeps only the FIRST era it sees
      // under a given id.
      case 'addEraShading': {
        const fromCode = periodCodeByLabel.get(command.fromLabel);
        const toCode = periodCodeByLabel.get(command.toLabel);
        if (fromCode === undefined || toCode === undefined) {
          // Final review (fix wave): the era-shading control lives beside
          // Notes, not Form — matches the applied chip's own icon/opens.
          out.refused.push({ request: cap(`era: ${command.fromLabel}–${command.toLabel}`), reason: 'not_available', control: 'notes' });
          break;
        }
        const label = guardText(command.label, ERA_LABEL_MAX, spec, 'none', out);
        if (label === null) break;
        const [a, b] = fromCode.localeCompare(toCode) <= 0 ? [fromCode, toCode] : [toCode, fromCode];
        out.commands.push({
          kind: 'addEraShading',
          era: { id: `chat-era-${extraCount++}${noteIdSuffix}`, fromPeriodCode: a, toPeriodCode: b, label },
        });
        break;
      }

      // The panel's two derived-overlay controls, reached by NAME instead of
      // by click: `difference` is its two-point picker (chart.tsx's
      // onPointClick, which insists both points share a region — one named
      // series is always one region), `mean` its "average this series"
      // button. The series is found by label and the points by period label
      // ON THAT SERIES — not the chart-wide periodCodeByLabel, which could
      // resolve a period this series lacks to another series' code. The
      // guards mirror what the client (chart-commands.ts's validateCommand:
      // exactly 2 ids / at least 2) and the server (src/query/derivations.ts:
      // two distinct periods) would otherwise refuse after the fact — a
      // stored command must never be one they drop. Deliberately unlike the
      // panel's mean button, chat averages EVERY point of the named series
      // whether hidden or zoomed out of view: naming the series is the
      // reader's own disambiguation, and this mapping has no view state to
      // window by. The command carries resultIds only — never a value.
      case 'addDerivedOverlay': {
        // Final review (fix wave, #310): the SAME gate chart.tsx puts on its
        // own difference/mean buttons (line/area only) — without it, asking
        // for an overlay on a bar/pie/stacked chart stored a command that
        // rendered nothing and could not be removed. Checked first, before
        // the series/period lookups below: a form that cannot draw an
        // overlay at all refuses the whole request outright.
        if (!capabilities.overlays) {
          out.refused.push({ request: cap(`overlay: ${command.seriesLabel}`), reason: 'not_available', control: 'form' });
          break;
        }
        const seriesPoints = spec.series.find((series) => series.label === command.seriesLabel)?.points;
        if (seriesPoints === undefined) {
          out.refused.push({ request: cap(`overlay: ${command.seriesLabel}`), reason: 'not_on_this_chart', control: 'form' });
          break;
        }
        if (command.calcKind === 'difference') {
          if (command.fromLabel === null || command.toLabel === null) {
            out.refused.push({ request: cap('overlay: difference'), reason: 'not_available', control: 'form' });
            break;
          }
          const fromPoint = seriesPoints.find((p) => p.periodLabel === command.fromLabel);
          const toPoint = seriesPoints.find((p) => p.periodLabel === command.toLabel);
          if (fromPoint === undefined || toPoint === undefined) {
            out.refused.push({ request: cap(`overlay: ${command.fromLabel}–${command.toLabel}`), reason: 'not_on_this_chart', control: 'form' });
            break;
          }
          // Both points resolve but are the same one: a degenerate
          // combination, not a missing point — `invalid`, exactly as
          // setDimmed refuses a label named as both hidden and dimmed.
          if (fromPoint.resultId === toPoint.resultId) {
            out.refused.push({ request: cap(`overlay: ${command.fromLabel}–${command.toLabel}`), reason: 'invalid', control: 'form' });
            break;
          }
          out.commands.push({
            kind: 'addDerivedOverlay',
            overlay: { id: `chat-overlay-${extraCount++}${noteIdSuffix}`, calcKind: 'difference', resultIds: [fromPoint.resultId, toPoint.resultId] },
          });
        } else {
          const resultIds = seriesPoints.map((p) => p.resultId);
          if (resultIds.length < 2) {
            out.refused.push({ request: cap(`overlay: ${command.seriesLabel}`), reason: 'not_on_this_chart', control: 'form' });
            break;
          }
          out.commands.push({
            kind: 'addDerivedOverlay',
            overlay: { id: `chat-overlay-${extraCount++}${noteIdSuffix}`, calcKind: 'mean', resultIds },
          });
        }
        break;
      }

      // The ONE bare number this tier ever stores from the model. A goal
      // line is a reader-set target, deliberately NOT a plotted value, so
      // the chart is the wrong reference set: the value is judged against
      // the reader's own raw MESSAGE instead (text-guard.ts's
      // goalLineValueInMessage — it must EQUAL a number the reader
      // spelled, under the Dutch or the English reading of the
      // separators; the same digits with a moved decimal or a different
      // sign do not count). A value the reader never typed is one the
      // model produced itself: refused outright, naming the panel control
      // where the reader types the number personally. The label owes the reader the same digit
      // guard as a title/caption/note, capped at the client's own limit
      // (chart-commands.ts's validateCommand would drop a longer or empty
      // one), and the id is minted here per line: the client reducer keeps
      // only the FIRST goal line it sees under a given id.
      case 'addGoalLine': {
        if (!goalLineValueInMessage(command.value, message)) {
          // Final review (fix wave): the goal-line control lives beside
          // Notes, not Form — matches the applied chip's own icon/opens.
          out.refused.push({ request: cap(`goal line: ${command.value}`), reason: 'not_available', control: 'notes' });
          break;
        }
        const label = guardText(command.label, GOAL_LINE_LABEL_MAX, spec, 'none', out);
        if (label === null) break;
        out.commands.push({ kind: 'addGoalLine', goalLine: { id: `chat-goal-${extraCount++}${noteIdSuffix}`, value: command.value, label } });
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

      // Both labels null clears the reader's own headline choice — always
      // available, nothing to look up. Otherwise the point is found exactly
      // as addNote finds its anchor, by (series label, period label), and
      // the command carries that point's own `resultId` — the handle the
      // point-click editor (chart-notes.tsx) stores when the reader picks a
      // headline there, so a replay can never move it to another cell. A
      // point that does not resolve sends the reader to that editor.
      case 'setHeadlineOverride': {
        if (command.seriesLabel === null && command.periodLabel === null) {
          out.commands.push({ kind: 'setHeadlineOverride', resultId: null });
          break;
        }
        if (command.seriesLabel === null || command.periodLabel === null) {
          out.refused.push({
            request: cap(`headline: ${command.seriesLabel ?? '?'} @ ${command.periodLabel ?? '?'}`),
            reason: 'not_on_this_chart',
            control: 'notes',
          });
          break;
        }
        const point = spec.series
          .find((series) => series.label === command.seriesLabel)
          ?.points.find((p) => p.periodLabel === command.periodLabel);
        if (point === undefined) {
          out.refused.push({
            request: cap(`headline: ${command.seriesLabel} @ ${command.periodLabel}`),
            reason: 'not_on_this_chart',
            control: 'notes',
          });
          break;
        }
        out.commands.push({ kind: 'setHeadlineOverride', resultId: point.resultId });
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
