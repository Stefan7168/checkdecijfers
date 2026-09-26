import { describe, expect, it } from 'vitest';
import type { LlmClient, LlmRequest } from '../../../src/answer/llm/client.ts';
import {
  buildMeaningCheckRequest,
  MEANING_CHECK_MODEL,
  MEANING_CHECK_SYSTEM_PROMPT,
  meaningCheckScopeProblems,
  meaningItems,
  runMeaningCheck,
  validateMeaningCheckOutput,
} from '../../../src/answer/translate/meaning-check.ts';
import type { TranslationItems } from '../../../src/answer/translate/check.ts';
import { meaningClient } from '../../helpers/meaning-check-stub.ts';

const NL: TranslationItems = {
  body: 'In ⟦Pa⟧ steeg de werkloosheid naar ⟦Na⟧.',
  chips: ['Hoe was het in ⟦Pb⟧?', 'En in Utrecht?'],
  definition: 'Werklozen als deel van de beroepsbevolking.',
  alternates: ['Seizoengecorrigeerd'],
};
const EN: TranslationItems = {
  body: 'In ⟦Pa⟧ unemployment rose to ⟦Na⟧.',
  chips: ['What was it in ⟦Pb⟧?', 'And in Utrecht?'],
  definition: 'Unemployed people as a share of the labour force.',
  alternates: ['Seasonally adjusted'],
};

describe('meaningItems', () => {
  it('pairs every item under a digit-free id, in body/chips/definition/alternates order', () => {
    const items = meaningItems(NL, EN);
    expect(items.map((i) => i.id)).toEqual(['body', 'chip-a', 'chip-b', 'definition', 'alternate-a']);
    expect(items[1]).toEqual({ id: 'chip-a', dutch: NL.chips[0], english: EN.chips[0] });
    expect(items.every((i) => !/\p{N}/u.test(i.id))).toBe(true);
  });

  it('omits the definition when it is null on both sides', () => {
    const items = meaningItems({ ...NL, definition: null }, { ...EN, definition: null });
    expect(items.map((i) => i.id)).not.toContain('definition');
  });

  it('letter ids continue past z (aa, ab, …)', () => {
    const many = Array.from({ length: 28 }, () => 'x');
    const ids = meaningItems({ ...NL, chips: many }, { ...EN, chips: many }).map((i) => i.id);
    expect(ids).toContain('chip-z');
    expect(ids).toContain('chip-aa');
    expect(ids).toContain('chip-ab');
  });
});

describe('the request (payload whitelist)', () => {
  it('the measured-not-shipped Haiku path (eval --model=haiku) keeps temperature 0 and no thinking field', () => {
    const req = buildMeaningCheckRequest(meaningItems(NL, EN), { model: 'claude-haiku-4-5' });
    expect(req.temperature).toBe(0);
    expect(req.thinking).toBeUndefined();
  });

  it('carries only {items:[{id,dutch,english}]}, no digit anywhere, the shipped Sonnet 5 with thinking disabled', () => {
    const req = buildMeaningCheckRequest(meaningItems(NL, EN));
    expect(req.model).toBe(MEANING_CHECK_MODEL);
    expect(MEANING_CHECK_MODEL).toBe('claude-sonnet-5');
    expect(req.temperature).toBeUndefined();
    expect(req.thinking).toBe('disabled');
    expect(req.system).toBe(MEANING_CHECK_SYSTEM_PROMPT);
    const payload = JSON.parse(req.question) as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['items']);
    for (const item of payload.items as Record<string, unknown>[]) {
      expect(Object.keys(item).sort()).toEqual(['dutch', 'english', 'id']);
    }
    expect(/\p{N}/u.test(req.system)).toBe(false);
    expect(/\p{N}/u.test(req.question.replace(/⟦[NPCG][a-z]+⟧/g, ''))).toBe(false);
  });

  it('a non-Haiku model omits temperature and disables thinking (Sonnet 5 rejects temperature)', () => {
    const req = buildMeaningCheckRequest(meaningItems(NL, EN), { model: 'claude-sonnet-5' });
    expect(req.model).toBe('claude-sonnet-5');
    expect(req.temperature).toBeUndefined();
    expect(req.thinking).toBe('disabled');
  });
});

describe('validateMeaningCheckOutput (the hard contract)', () => {
  const ids = ['body', 'chip-a'];
  const ok = (items: unknown) => JSON.stringify({ items });
  it('accepts exactly one verdict per id', () => {
    const v = validateMeaningCheckOutput(ok([{ id: 'body', sameMeaning: true, differences: [] }, { id: 'chip-a', sameMeaning: false, differences: ['x'] }]), ids);
    expect(v).toHaveLength(2);
  });
  it.each([
    ['not JSON', 'nope{'],
    ['a missing id', ok([{ id: 'body', sameMeaning: true, differences: [] }])],
    ['an invented id', ok([{ id: 'body', sameMeaning: true, differences: [] }, { id: 'chip-z', sameMeaning: true, differences: [] }])],
    ['a duplicated id', ok([{ id: 'body', sameMeaning: true, differences: [] }, { id: 'body', sameMeaning: true, differences: [] }])],
    ['an extra key', ok([{ id: 'body', sameMeaning: true, differences: [], note: 'x' }, { id: 'chip-a', sameMeaning: true, differences: [] }])],
    ['a non-boolean verdict', ok([{ id: 'body', sameMeaning: 'yes', differences: [] }, { id: 'chip-a', sameMeaning: true, differences: [] }])],
  ])('rejects %s', (_label, text) => {
    expect(() => validateMeaningCheckOutput(text, ids)).toThrow();
  });
});

describe('runMeaningCheck', () => {
  it("all same ⇒ status 'same', no problems", async () => {
    const out = await runMeaningCheck(NL, EN, meaningClient(() => true));
    expect(out.record.status).toBe('same');
    expect(out.record.verdicts).toHaveLength(5);
    expect(out.problems).toEqual([]);
  });

  it("one item differs ⇒ status 'different', one C12 problem naming that item", async () => {
    const out = await runMeaningCheck(NL, EN, meaningClient((id) => id !== 'chip-b'));
    expect(out.record.status).toBe('different');
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]).toMatch(/^C12: chip-b meaning differs \(direction reversed\)$/);
  });

  it("a client error ⇒ status 'error', no problems, error recorded", async () => {
    const client: LlmClient = { complete: async () => { throw new Error('outage'); } };
    const out = await runMeaningCheck(NL, EN, client);
    expect(out.record.status).toBe('error');
    expect(out.record.error).toContain('outage');
    expect(out.record.verdicts).toBeNull();
    expect(out.problems).toEqual([]);
  });

  it("a padded/partial verdict list ⇒ status 'error', never a pass", async () => {
    const client: LlmClient = {
      complete: async (req: LlmRequest) => ({ outputText: JSON.stringify({ items: [{ id: 'body', sameMeaning: true, differences: [] }] }), model: req.model, stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }),
    };
    const out = await runMeaningCheck(NL, EN, client);
    expect(out.record.status).toBe('error');
  });

  it("a digit in an item ⇒ status 'error' and NO call is made", async () => {
    const client = meaningClient(() => true);
    const out = await runMeaningCheck(NL, { ...EN, body: 'In 2024 it rose.' }, client);
    expect(out.record.status).toBe('error');
    expect(client.requests).toHaveLength(0);
  });
});

describe('meaningCheckScopeProblems (R8 scope)', () => {
  const ids = ['body', 'chip-a'];
  const good = { status: 'same', model: 'm', promptVersion: 1, verdicts: ids.map((id) => ({ id, sameMeaning: true, differences: [] })), error: null, latencyMs: 1 };
  it('a consistent record passes', () => {
    expect(meaningCheckScopeProblems(good, ids)).toEqual([]);
  });
  it.each([
    ['missing', undefined],
    ['status different', { ...good, status: 'different' }],
    ['status error', { ...good, status: 'error', verdicts: null }],
    ['a verdict dropped', { ...good, verdicts: good.verdicts.slice(1) }],
    ['a verdict duplicated', { ...good, verdicts: [good.verdicts[0], good.verdicts[0]] }],
    ['a verdict says different', { ...good, verdicts: [good.verdicts[0], { ...good.verdicts[1], sameMeaning: false }] }],
    ['verdicts not an array', { ...good, verdicts: 'x' }],
  ])('%s ⇒ a problem', (_label, stored) => {
    expect(meaningCheckScopeProblems(stored, ids).length).toBeGreaterThan(0);
  });
});
