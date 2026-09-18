// Co-pilot phase 2 (session 113, Task 8) — the client's own gate on a stored
// co-pilot reply. PURE: no React, no server call.
//
// The server already mapped the model's labels onto keys by lookup against
// the chart it executed (src/attachments/copilot/map.ts). This is the SECOND
// and authoritative check, and it exists because the two sides can disagree:
// the browser holds its own view state, and it is `validateCommand` — against
// the spec the card is about to draw — that decides whether a command may
// apply. Anything that does not survive is COUNTED and reported, never
// silently dropped and never dispatched.
import { makeCommand, parseCommandLog, validateCommand, type ChartCommandParams, type CommandContext } from './chart-commands.ts';
import { describeCommand } from '../components/chart-history-menu.tsx';
import { t, type Lang, type MessageKey } from './i18n/messages.ts';
import type { CopilotCommand, CopilotRefusal } from '../backend/attachments/types.ts';

/** The panel-row icon a command belongs to — the same eight surfaces the
 * Style/Data panels and the history menu already use, so a chip reads as
 * "this is the control that changed". */
export type ChipIcon = 'data' | 'form' | 'series' | 'style' | 'template' | 'title' | 'caption' | 'note';

/** Which doorway a chip click opens. Derived from the icon, never stored
 * beside it: one mapping, so a chip in the card and the same chip replayed
 * in the thread can never point somewhere different. */
export type ChipOpens = 'data' | 'style' | 'form' | 'notes' | 'none';

export interface AppliedChip {
  command: ChartCommandParams;
  label: string;
  icon: ChipIcon;
  opens: ChipOpens;
}

export function opensForIcon(icon: ChipIcon): ChipOpens {
  switch (icon) {
    case 'data':
      return 'data';
    case 'form':
      return 'form';
    case 'style':
    case 'template':
      return 'style';
    case 'note':
      return 'notes';
    // A series hide/highlight and a title/caption edit are visible ON the
    // card itself — there is no panel to open for them.
    case 'series':
    case 'title':
    case 'caption':
      return 'none';
  }
}

function iconFor(kind: ChartCommandParams['kind']): ChipIcon {
  switch (kind) {
    case 'setInstruction':
      return 'data';
    case 'setForm':
      return 'form';
    case 'toggleSeries':
    case 'setHighlight':
    case 'setSeriesView':
      return 'series';
    case 'applyTemplate':
      return 'template';
    case 'setTitle':
      return 'title';
    case 'setCaption':
      return 'caption';
    case 'addNote':
    case 'removeNote':
      return 'note';
    // setPresentation/replacePresentation/resetPresentation, plus the two
    // kinds the chat cannot emit at all (setPeriodRange, setReading) — all of
    // them are Style-panel business.
    default:
      return 'style';
  }
}

/** A stored CopilotCommand, shape-parsed through the SAME schema a saved
 * command log goes through (`parseCommandLog`, which also re-sanitises a
 * presentation patch) — one at a time, so one malformed entry cannot take the
 * whole reply with it. Null = the shape is not a command at all. */
function parseOne(command: CopilotCommand): ChartCommandParams | null {
  const parsed = parseCommandLog([{ ...command, id: 'x', at: '1970-01-01T00:00:00.000Z', source: 'chat' }]);
  if (parsed === null || parsed.length !== 1) return null;
  // Back to bare params: the card mints its own id/at/source on dispatch.
  const { id: _id, at: _at, source: _source, ...params } = parsed[0]!;
  return params as ChartCommandParams;
}

function labelFor(params: ChartCommandParams, lang: Lang): string {
  return describeCommand(makeCommand(params, 'chat'), lang);
}

/**
 * The reply, accepted. `dropped` is how many stored commands this chart
 * could not take — surfaced to the reader as one plain line, because a
 * silently lost item is exactly the kind of "it said it did something"
 * confusion this tier must not produce.
 */
export function acceptReply(
  commands: CopilotCommand[],
  ctx: CommandContext,
  lang: Lang,
): { applied: AppliedChip[]; dropped: number } {
  const applied: AppliedChip[] = [];
  let dropped = 0;
  for (const command of commands) {
    const params = parseOne(command);
    if (params === null || !validateCommand(params, ctx)) {
      dropped += 1;
      continue;
    }
    const icon = iconFor(params.kind);
    applied.push({ command: params, label: labelFor(params, lang), icon, opens: opensForIcon(icon) });
  }
  return { applied, dropped };
}

/** The same labels for a REPLAYED edit message in the thread, where there is
 * no chart context to validate against (the target card replays its own
 * stored log). Shape-parse only — an entry that is not a command is skipped
 * rather than labelled "undefined". */
export function replayChips(commands: CopilotCommand[], lang: Lang): { label: string; icon: ChipIcon }[] {
  const chips: { label: string; icon: ChipIcon }[] = [];
  for (const command of commands) {
    const params = parseOne(command);
    if (params === null) continue;
    chips.push({ label: labelFor(params, lang), icon: iconFor(params.kind) });
  }
  return chips;
}

const REFUSAL_REASONS: readonly CopilotRefusal['reason'][] = [
  'not_available',
  'not_on_this_chart',
  'needs_click',
  'unplotted_number',
  'invalid',
];
const REFUSAL_CONTROLS: readonly CopilotRefusal['control'][] = ['notes', 'style', 'data', 'form', 'none'];

/**
 * One refusal, as one line: the request echoed as plain text, the reason,
 * and the control that CAN do it. Never "ask for this feature" — every
 * refusal ends in a click the reader can make (or, for `control: 'none'`,
 * in nothing at all, because there is no control to point at).
 */
export function refusalLine(item: CopilotRefusal, lang: Lang): string {
  // A refusal is read out of a STORED envelope, so the two enums are pinned
  // to the sets that have a message here — an older or newer row's unknown
  // value degrades to the generic line, never to the word "undefined".
  const reason = REFUSAL_REASONS.includes(item.reason) ? item.reason : 'invalid';
  const control = REFUSAL_CONTROLS.includes(item.control) ? item.control : 'none';
  const reasonText = t(lang, `chart.copilot.reason.${reason}` as MessageKey);
  const hint = t(lang, `chart.copilot.hint.${control}` as MessageKey);
  const request = item.request.trim();
  const sentence = `${request.length > 0 ? `${request}: ` : ''}${reasonText}.`;
  return hint.length > 0 ? `${sentence} ${hint}` : sentence;
}
