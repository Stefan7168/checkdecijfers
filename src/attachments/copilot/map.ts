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
import { goalLineValueInMessage, stripDigits, unplottedDigits } from './text-guard.ts';
import { TEMPLATE_IDS, type CopilotCapabilities, type CopilotOutput } from './types.ts';

/** The same caps web/lib's chart-commands.ts enforces on dispatch — applied
 * here too so a stored command is never one the client will drop. */
const TITLE_MAX = 120;
const CAPTION_MAX = 280;
const NOTE_MAX = 280;
const ERA_LABEL_MAX = 60;
const GOAL_LINE_LABEL_MAX = 60;
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
 * data chip — deterministic text, never the model's own prose. `message` is
 * the reader's raw request, threaded through since this tier's own wiring
 * of the CBS co-pilot phase 6 primitives: only addGoalLine reads it, to
 * check that the value the model wrote is one the reader actually typed
 * (text-guard.ts's goalLineValueInMessage) — every other command kind
 * ignores it. `capabilities` gates addDerivedOverlay: the SAME
 * `form === 'line' || form === 'area'` test web/lib/chart-capabilities.ts's
 * `ownDataCapabilities` computes, checked FIRST, before any series/x-label
 * lookup, so a bar/table chart's chat is refused outright instead of
 * silently storing a command that renders nothing.
 *
 * `noteIdSuffix` disambiguates the note ids this reply mints (final review,
 * session 113): two chat notes on the SAME point used to share the id
 * `chat-${rowRef}`, and the second was silently deduped by `applyCommand`
 * while its chip claimed "applied". Tests pass a fixed suffix. The SAME
 * suffix now disambiguates era shadings, derived overlays and goal lines
 * too, via one shared `extraCount` counter kept apart from `noteCount` so
 * addNote's own id scheme stays exactly what it was.
 */
export function mapCopilotOutput(
  output: CopilotOutput,
  chart: UserChartSpec,
  current: ClientChartInstruction,
  summary: string,
  message: string,
  capabilities: CopilotCapabilities,
  noteIdSuffix: string = Date.now().toString(36),
): Mapped {
  const out: Mapped = { commands: [], refused: [] };
  let noteCount = 0;
  // One counter for every id-minting command kind this tier's own co-pilot
  // phase 6 wiring adds (era shadings, derived overlays, goal lines) — kept
  // apart from noteCount so addNote's id scheme stays exactly what it was.
  let extraCount = 0;

  // Every x label, first-seen wins — a label→key lookup over EVERY point of
  // EVERY series (a label may be missing from one series but present on
  // another), mirroring the CBS tier's own periodCodeByLabel.
  const xKeyByLabel = new Map<string, string>();
  for (const series of chart.series) {
    for (const point of series.points) {
      if (!xKeyByLabel.has(point.xLabel)) xKeyByLabel.set(point.xLabel, point.xKey);
    }
  }

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

      // Own-data wiring of the CBS tier's co-pilot phase 6 primitives
      // (session 122, further continuation): the two below were left out
      // of the original own-data-parity pass on the wrong assumption that
      // "the panel already dispatches these generically" meant the CHAT
      // doorway could reach them too — it could not, since neither had ever
      // been added to THIS tier's own schema/map/prompt (open-questions
      // #311's own residual note, closed here). Same label→key lookup as
      // setSeriesView, and one unknown label refuses the WHOLE command for
      // the same reason. A label named in BOTH lists is refused as well:
      // chart-commands.ts's validateCommand drops a key that is hidden and
      // dimmed at once, and a stored command must never be one the client
      // will drop.
      //
      // #309 (mirrors the CBS tier's own fix, src/chart/copilot/map.ts):
      // the model was only ever shown the vocabulary to answer THIS
      // request — never which series the reader already hid or dimmed by
      // clicking the legend — so its hiddenLabels/dimmedLabels can only
      // ever speak for the series it names. Storing them as-is would be a
      // wholesale replace of the chart's WHOLE hidden/dimmed set, silently
      // un-hiding/un-dimming everything the reader set that the chat did
      // not mention. MERGE instead: a key the reader currently holds
      // hidden or dimmed and this command does not name keeps its own
      // state; a key the command DOES name moves to what it asked for,
      // overriding any prior state of its own. One command still reaches
      // the client either way, so the undo history stays one invertible
      // entry (chart-commands.ts's own before/after inversion needs no
      // change for this).
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
        const hiddenKeys = command.hiddenLabels.map((label) => `s${seriesIndex.get(label)!}`);
        const dimmedKeys = command.dimmedLabels.map((label) => `s${seriesIndex.get(label)!}`);
        const mentioned = new Set([...hiddenKeys, ...dimmedKeys]);
        // Stale/malformed current-state keys (an older client, a race with
        // a chart that has since changed) are dropped rather than trusted —
        // a key the client would refuse the whole command over is worse
        // than one silently ignored here.
        const validKeys = new Set(chart.series.map((_, index) => `s${index}`));
        const keepCurrent = (keys: string[] | undefined): string[] =>
          (keys ?? []).filter((key) => validKeys.has(key) && !mentioned.has(key));
        const mergedHidden = new Set([...keepCurrent(capabilities.currentHiddenKeys), ...hiddenKeys]);
        const mergedDimmed = new Set([...keepCurrent(capabilities.currentDimmedKeys), ...dimmedKeys]);
        out.commands.push({
          kind: 'setDimmed',
          hiddenKeys: [...mergedHidden],
          dimmedKeys: [...mergedDimmed],
        });
        break;
      }

      // Both labels null clears the reader's own headline choice — always
      // available, nothing to look up. Otherwise the point is found exactly
      // as addNote finds its anchor, by (series label, x label), and the
      // command carries that point's own rowRef — the same handle addNote's
      // anchor uses, so a replay can never move it to another cell. A point
      // that does not resolve sends the reader to the notes editor, mirroring
      // the CBS tier's own treatment of this case.
      case 'setHeadlineOverride': {
        if (command.seriesLabel === null && command.xLabel === null) {
          out.commands.push({ kind: 'setHeadlineOverride', resultId: null });
          break;
        }
        if (command.seriesLabel === null || command.xLabel === null) {
          out.refused.push({
            request: cap(`headline: ${command.seriesLabel ?? '?'} @ ${command.xLabel ?? '?'}`),
            reason: 'not_on_this_chart',
            control: 'notes',
          });
          break;
        }
        const headlinePoint = chart.series
          .find((series) => series.label === command.seriesLabel)
          ?.points.find((p) => p.xLabel === command.xLabel);
        if (headlinePoint === undefined) {
          out.refused.push({
            request: cap(`headline: ${command.seriesLabel} @ ${command.xLabel}`),
            reason: 'not_on_this_chart',
            control: 'notes',
          });
          break;
        }
        out.commands.push({ kind: 'setHeadlineOverride', resultId: headlinePoint.rowRef });
        break;
      }

      // Both labels must resolve to a real x value, CHART-WIDE (the
      // xKeyByLabel lookup built above — an era shades the whole chart, not
      // one series, unlike addDerivedOverlay's per-series lookup below), and
      // the resolved keys are swapped into ascending order —
      // chart-commands.ts's validateCommand drops an era whose codes are
      // reversed, and a stored command must never be one the client will
      // drop. The typed label owes the reader the same digit guard as a
      // title/caption/note. The id is minted here, per era: the client
      // reducer keeps only the FIRST era it sees under a given id.
      case 'addEraShading': {
        const fromKey = xKeyByLabel.get(command.fromLabel);
        const toKey = xKeyByLabel.get(command.toLabel);
        if (fromKey === undefined || toKey === undefined) {
          // Mirrors the CBS tier's own fix (final review, #310-adjacent):
          // the era-shading control lives beside Notes, not Form — matches
          // the applied chip's own icon/opens (web/lib/chart-copilot-reply.ts).
          out.refused.push({ request: cap(`era: ${command.fromLabel}–${command.toLabel}`), reason: 'not_available', control: 'notes' });
          break;
        }
        const label = guardText(command.label, ERA_LABEL_MAX, chart, 'none', out);
        if (label === null) break;
        const [a, b] = fromKey.localeCompare(toKey) <= 0 ? [fromKey, toKey] : [toKey, fromKey];
        out.commands.push({
          kind: 'addEraShading',
          era: { id: `chat-era-${extraCount++}${noteIdSuffix}`, fromPeriodCode: a, toPeriodCode: b, label },
        });
        break;
      }

      // The panel's difference/mean overlay, reached by NAME instead of by
      // click: `difference` needs two named x values on the SAME series,
      // `mean` averages every point of the named series. The series is
      // found by label and the points by x label ON THAT SERIES — not the
      // chart-wide xKeyByLabel, which could resolve an x value this series
      // lacks to another series' key. The guards mirror what the client
      // (chart-commands.ts's validateCommand: exactly 2 ids / at least 2)
      // would otherwise refuse after the fact — a stored command must never
      // be one it drops. Like the CBS tier, chat averages EVERY point of
      // the named series: naming the series is the reader's own
      // disambiguation. (#309 gave this mapping access to the reader's
      // current hidden/dimmed keys via capabilities, but only setDimmed's
      // own merge reads them — the mean deliberately stays unwindowed, per
      // the prompt's own wording above.) The command carries rowRefs only —
      // never a value.
      case 'addDerivedOverlay': {
        // The SAME gate the CBS tier's own difference/mean controls use
        // (form === 'line' || form === 'area') — without it, asking for an
        // overlay on a bar/table chart would store a command that renders
        // nothing and cannot be removed. Checked first, before the
        // series/x-label lookups below.
        if (!capabilities.overlays) {
          out.refused.push({ request: cap(`overlay: ${command.seriesLabel}`), reason: 'not_available', control: 'form' });
          break;
        }
        const seriesPoints = chart.series.find((series) => series.label === command.seriesLabel)?.points;
        if (seriesPoints === undefined) {
          out.refused.push({ request: cap(`overlay: ${command.seriesLabel}`), reason: 'not_on_this_chart', control: 'form' });
          break;
        }
        if (command.calcKind === 'difference') {
          if (command.fromLabel === null || command.toLabel === null) {
            out.refused.push({ request: cap('overlay: difference'), reason: 'not_available', control: 'form' });
            break;
          }
          const fromPoint = seriesPoints.find((p) => p.xLabel === command.fromLabel);
          const toPoint = seriesPoints.find((p) => p.xLabel === command.toLabel);
          if (fromPoint === undefined || toPoint === undefined) {
            out.refused.push({ request: cap(`overlay: ${command.fromLabel}–${command.toLabel}`), reason: 'not_on_this_chart', control: 'form' });
            break;
          }
          // Both points resolve but are the same one: a degenerate
          // combination, not a missing point — `invalid`, mirroring the
          // CBS tier's own treatment of this case.
          if (fromPoint.rowRef === toPoint.rowRef) {
            out.refused.push({ request: cap(`overlay: ${command.fromLabel}–${command.toLabel}`), reason: 'invalid', control: 'form' });
            break;
          }
          out.commands.push({
            kind: 'addDerivedOverlay',
            overlay: { id: `chat-overlay-${extraCount++}${noteIdSuffix}`, calcKind: 'difference', resultIds: [fromPoint.rowRef, toPoint.rowRef] },
          });
        } else {
          const resultIds = seriesPoints.map((p) => p.rowRef);
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
      // where the reader types the number personally. The label owes the
      // reader the same digit guard as a title/caption/note, capped at the
      // client's own limit (chart-commands.ts's validateCommand would drop
      // a longer or empty one), and the id is minted here per line: the
      // client reducer keeps only the FIRST goal line it sees under a
      // given id.
      case 'addGoalLine': {
        if (!goalLineValueInMessage(command.value, message)) {
          // Mirrors the CBS tier's own fix: the goal-line control lives
          // beside Notes, not Form — matches the applied chip's own
          // icon/opens (web/lib/chart-copilot-reply.ts).
          out.refused.push({ request: cap(`goal line: ${command.value}`), reason: 'not_available', control: 'notes' });
          break;
        }
        const label = guardText(command.label, GOAL_LINE_LABEL_MAX, chart, 'none', out);
        if (label === null) break;
        out.commands.push({ kind: 'addGoalLine', goalLine: { id: `chat-goal-${extraCount++}${noteIdSuffix}`, value: command.value, label } });
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
