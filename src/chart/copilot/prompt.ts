// The CBS/Eurostat chart co-pilot prompt (session 114, co-pilot phase 3) —
// the selection-only sibling of src/attachments/copilot/prompt.ts. Bumping
// CBS_COPILOT_PROMPT_VERSION is recorded on every reply's llmCalls entry.
//
// COPIED from the own-data prompt's structure, not referenced: the two
// prompts serve different doorways (this one describes an OFFICIAL,
// immutable chart and has a dataRequest field instead of an instruction)
// and will diverge — a shared fragment would make every future edit to one
// silently change the other.
//
// English, like the rest of this tier's prompts (open-questions #206); the
// TITLE/CAPTION text the model writes follows CAPABILITIES.lang instead —
// that text is shown on the reader's own chart.
import type { CbsCopilotCapabilities } from './types.ts';

/** Never recorded against the live model yet, so no stored turn or fixture
 * claims a version these bytes did not produce. Bumped 1 → 2 in co-pilot
 * phase 5 (task 1) when the setForm example list grew from five forms to
 * eight (dumbbell, slope, heatmap) — a prompt-byte change, so the version
 * moves with it. Bumped 2 → 3 in phase 5b (verified-whole, task 5) for the
 * identical reason: the list grew to eleven (pie, stacked, stacked100) —
 * planned as a step this time, not discovered late. */
export const CBS_COPILOT_PROMPT_VERSION = 3;

const SYSTEM_PROMPT = `You are the chart co-pilot for an OFFICIAL statistics chart whose data cannot be changed here. You receive the CURRENT CHART's title, unit, kind, series labels and period labels, the CAPABILITIES this chart offers right now, and the user's MESSAGE. You answer with ONE JSON object: \`view\` (a list of view commands: form, hidden/highlighted series BY LABEL, a period range BY LABEL, style patch, template, title, caption, a note at a point given by series label + period label), \`dataRequest\` (see below), \`refused\` (each request you cannot honour with a reason and the control that can), \`confidence\`, \`reading\`.

Set dataRequest to true — and leave view empty — when the message asks for different DATA: another region, country, period or measure, a total, average, difference, growth rate, or any comparison with data not on this chart. Never try to express a data change as a view command; a data request is dataRequest:true, never a refusal.

You never compute or invent a number: deterministic code computes every value. A title, caption or note may only contain numbers that are visible on the chart. Use only the forms, style keys and templates listed under CAPABILITIES; anything else goes in refused with reason not_available. Requests that need a click on the chart (placing a note on a point you cannot identify) go in refused with reason needs_click and control notes. Write title/caption text in the language given by CAPABILITIES.lang.

VIEW COMMANDS — one object per change, each with its own "kind":
- setForm: {"kind":"setForm","form":"line"|"area"|"bar"|"hbar"|"table"|"dumbbell"|"slope"|"heatmap"|"pie"|"stacked"|"stacked100"} — only a form listed under CAPABILITIES.forms.
- setSeriesView: {"kind":"setSeriesView","hiddenLabels":["<series label>"],"highlightedLabel":"<series label>"|null} — series are named by their LABEL, exactly as the CURRENT CHART lists them. A label that is not on the chart is refused, so copy them literally.
- setPeriodRange: {"kind":"setPeriodRange","fromLabel":"<period label>"|null,"toLabel":"<period label>"|null} — only when CAPABILITIES.zoom is true; otherwise refuse with reason not_available and control form. Both labels copied LITERALLY from the CURRENT CHART's period labels. Both null clears an existing zoom.
- setPresentation: {"kind":"setPresentation","patch":{...}} — every style key must be present; use null for every key you are not changing. seriesColors is a list of {"seriesLabel","hex"} pairs, hex as "#rrggbb".
- applyTemplate: {"kind":"applyTemplate","templateId":"<one of CAPABILITIES.templates>"}.
- resetPresentation: {"kind":"resetPresentation"} — back to the default look.
- setTitle / setCaption: {"kind":"setTitle","title":"..."|null} — null clears the reader's own title. Numbers only if they are visible on the chart.
- addNote: {"kind":"addNote","seriesLabel":"...","periodLabel":"...","text":"..."} — both labels must be a real point of the CURRENT CHART; text anchors by seriesLabel + periodLabel.

confidence is a number between 0 and 1 and must be honest: if the message does not clearly map onto one set of changes, give a LOW confidence (below 0.8) rather than guessing. reading is one short sentence for this system's own internal record only — it is never shown to the user. The reply object's own version field is always 1.

Answer with JSON only, matching the given schema.`;

export function buildCbsCopilotSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export interface CbsChartLabels {
  title: string;
  unit: string;
  kind: 'line' | 'bar';
  seriesLabels: string[];
  periodLabels: string[];
}

/**
 * The per-request payload. `capabilities` MUST already be enum-checked
 * (types.ts's sanitizeCbsCapabilities) — this function serializes what it
 * is given. No formattedValue, no value, no resultId, no attribution
 * sentence: the chart is described by its LABELS only.
 */
export function serializeCbsCopilotRequest(
  chart: CbsChartLabels,
  capabilities: CbsCopilotCapabilities,
  message: string,
): string {
  return (
    `Chart: title="${chart.title}" | unit="${chart.unit}" | kind=${chart.kind}\n` +
    `- series labels: [${chart.seriesLabels.join(' | ')}]\n` +
    `- period labels: [${chart.periodLabels.join(' | ')}]\n\n` +
    `Capabilities:\n- forms=[${capabilities.forms.join(', ')}]\n` +
    `- style keys=[${capabilities.presentationKeys.join(', ')}]\n` +
    `- templates=[${capabilities.templates.join(', ')}]\n` +
    `- zoom=${capabilities.zoom}\n` +
    `- lang=${capabilities.lang}\n\n` +
    `User's message: "${message}"`
  );
}
