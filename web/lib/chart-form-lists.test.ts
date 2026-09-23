// The chart-form vocabulary is spelled out by hand in several places that
// cannot simply import one list: two of them are embedded, byte-for-byte, in
// the two co-pilots' LLM prompts (changing how they are built risks shifting
// recorded fixture hashes — see lessons-learned, the prompt-embedded-list
// hash risk), and the zod enums feed the structured-output JSON schemas sent
// to the model. So they stay hand-written, and THIS test is the cross-check
// the own-data verified-whole build's final review (session 123, #312) found
// missing: every copy must name exactly the same forms, in the same order.
import { describe, expect, it } from 'vitest';
import { CBS_COPILOT_FORMS } from '../backend/chart/copilot/types.ts';
import { cbsViewCommandSchema } from '../backend/chart/copilot/schema.ts';
import { buildCbsCopilotSystemPrompt } from '../backend/chart/copilot/prompt.ts';
import { COPILOT_FORMS } from '../backend/attachments/copilot/types.ts';
import { viewCommandSchema } from '../backend/attachments/copilot/schema.ts';
import { buildCopilotSystemPrompt } from '../backend/attachments/copilot/prompt.ts';
import { parseCommandLog } from './chart-commands.ts';
import { isChartForm, type ChartForm } from './chart-view-state.ts';

const CANONICAL: readonly string[] = CBS_COPILOT_FORMS;

// Compile-time: the ChartForm union and the canonical list name the same set.
type ListForm = (typeof CBS_COPILOT_FORMS)[number];
const unionCoversList: [Exclude<ListForm, ChartForm>] extends [never] ? true : false = true;
const listCoversUnion: [Exclude<ChartForm, ListForm>] extends [never] ? true : false = true;

/** The `form` enum of a discriminated union's `setForm` member. */
function setFormEnum(schema: { options: readonly unknown[] }): readonly string[] {
  const member = schema.options.find(
    (o) => (o as { shape: { kind: { value: string } } }).shape.kind.value === 'setForm',
  ) as { shape: { form: { options: readonly string[] } } } | undefined;
  if (member === undefined) throw new Error('no setForm member');
  return member.shape.form.options;
}

/** The `"a"|"b"|…` alternatives on a prompt's `setForm` line. */
function promptForms(prompt: string): string[] {
  const line = prompt.split('\n').find((l) => l.startsWith('- setForm:'));
  if (line === undefined) throw new Error('no setForm line in the prompt');
  const match = /"form":((?:"[a-z0-9]+"\|?)+)/.exec(line);
  if (match === null) throw new Error(`unparseable setForm line: ${line}`);
  return match[1]!.split('|').map((f) => f.replaceAll('"', ''));
}

describe('chart-form lists stay in step (#312)', () => {
  it('the type-level union and the canonical list match', () => {
    expect(unionCoversList).toBe(true);
    expect(listCoversUnion).toBe(true);
  });

  it('the own-data co-pilot list equals the CBS co-pilot list, in order', () => {
    expect([...COPILOT_FORMS]).toEqual([...CANONICAL]);
  });

  it('both co-pilot schemas offer exactly the canonical forms, in order', () => {
    expect([...setFormEnum(cbsViewCommandSchema)]).toEqual([...CANONICAL]);
    expect([...setFormEnum(viewCommandSchema)]).toEqual([...CANONICAL]);
  });

  it('both co-pilot prompts name exactly the canonical forms, in order', () => {
    expect(promptForms(buildCbsCopilotSystemPrompt())).toEqual([...CANONICAL]);
    expect(promptForms(buildCopilotSystemPrompt())).toEqual([...CANONICAL]);
  });

  it('the stored edit-log schema accepts every canonical form and rejects anything else', () => {
    const log = (form: string) => [{ kind: 'setForm', form, id: 'c1', at: '2026-09-23T00:00:00.000Z', source: 'panel' }];
    for (const form of CANONICAL) expect(parseCommandLog(log(form)), form).not.toBeNull();
    expect(parseCommandLog(log('scatter'))).toBeNull();
  });

  it('isChartForm accepts exactly the canonical forms', () => {
    for (const form of CANONICAL) expect(isChartForm(form), form).toBe(true);
    expect(isChartForm('scatter')).toBe(false);
  });
});
