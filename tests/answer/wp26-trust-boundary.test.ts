// The WP26 trust boundary: what a CLIENT-HELD pending is and is not allowed to
// decide when it comes back.
//
// These cases come from an adversarial review of the WP26 commits (2026-07-25,
// four independent lenses: money, forgery, deploy-skew, byte-neutrality). Three
// of the four independently landed on the same hole — `rescueOnly` was honoured
// on the client's bare word, with no flag and no shape behind it — so it is
// pinned here first.
import { describe, expect, it } from 'vitest';
import {
  validateClickOptions,
  withValidatedClickOptions,
} from '../../src/answer/respond/validate-pending.ts';
import type { PendingClarification } from '../../src/answer/respond/types.ts';
import type { ClickOption } from '../../src/answer/intent/types.ts';

const CHIP_LABEL = 'Toon het cijfer voor consumentenprijsindex (2026, juni).';

function chip(overrides: Partial<ClickOption> = {}): ClickOption {
  return {
    id: 'rescue-1',
    label: CHIP_LABEL,
    intent: {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
      period: { kind: 'codes', codes: ['2026MM06'] },
      derivation: 'none',
    },
    impliedRecency: false,
    ...overrides,
  } as ClickOption;
}

function rescuePending(overrides: Partial<PendingClarification> = {}): PendingClarification {
  return {
    version: 1,
    question: 'Wat was de inflatie in juni 2026?',
    referenceDate: '2026-07-25',
    axes: ['measure'],
    questionNl: 'Ik kan geen voorspellingen doen.',
    options: [CHIP_LABEL],
    clickOptions: [chip()],
    rescueOnly: true,
    ...overrides,
  } as PendingClarification;
}

describe('withValidatedClickOptions carries only known keys', () => {
  it('drops a key the client invented instead of persisting it', () => {
    // The pending is written verbatim into audit_answers.pending_clarification,
    // so a spread let a client size a junk key to the request-body limit and
    // put it in the database — on a turn that can cost them nothing.
    const forged = {
      ...rescuePending(),
      junk: 'A'.repeat(50_000),
      anotherOne: { nested: true },
    } as unknown as PendingClarification;

    const safe = withValidatedClickOptions(forged);

    expect(Object.keys(safe).sort()).toEqual(
      ['axes', 'clickOptions', 'options', 'questionNl', 'question', 'referenceDate', 'rescueOnly', 'version'].sort(),
    );
    expect(JSON.stringify(safe)).not.toContain('AAAA');
    expect(JSON.stringify(safe)).not.toContain('anotherOne');
  });

  it('carries conversationContext through — an allowlist that forgets a real field is worse than a spread', () => {
    // The first version of the allowlist dropped this, and the drop was
    // SILENT: no throw, no failing test, just a follow-up clarification round
    // losing the referent that gave the elliptical question its meaning
    // (WP15 / ADR 021 — `clarify.ts` reads it to build `previous_intent`).
    // A review caught it by running the function rather than reading it.
    const context = {
      previousIntent: {
        schemaVersion: 1,
        target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
        period: { kind: 'codes', codes: ['2026MM06'] },
        derivation: 'none',
      },
      previousReading: 'inflatie in juni 2026',
    };
    const pending = {
      ...rescuePending({ rescueOnly: undefined, clickOptions: undefined }),
      conversationContext: context,
    } as unknown as PendingClarification;

    const safe = withValidatedClickOptions(pending);

    expect(safe.conversationContext).toEqual(context);
    // And an explicit null — the "no referent" signal — survives as null
    // rather than vanishing, since absent and null are different states here.
    const withNull = withValidatedClickOptions({
      ...pending,
      conversationContext: null,
    } as PendingClarification);
    expect('conversationContext' in withNull).toBe(true);
    expect(withNull.conversationContext).toBeNull();
  });

  it('keeps the two optional keys PRESENT-ONLY, so a flag-off pending is unchanged', () => {
    // Byte-neutrality: re-adding `clickOptions: []` / `rescueOnly: false` would
    // change the stored envelope on every dormant turn.
    const plain: PendingClarification = {
      version: 1,
      question: 'Hoeveel inwoners heeft Utrecht?',
      referenceDate: '2026-07-25',
      axes: ['region'],
      questionNl: 'Welke Utrecht bedoel je?',
      options: ['Utrecht (gemeente)', 'Utrecht (provincie)'],
    };

    const safe = withValidatedClickOptions(plain);

    expect(safe).toEqual(plain);
    expect('clickOptions' in safe).toBe(false);
    expect('rescueOnly' in safe).toBe(false);
  });

  it('still drops a malformed option rather than trusting it', () => {
    // Unchanged behaviour, re-pinned because the rebuild rewrote this function.
    expect(validateClickOptions([{ ...chip(), intent: { kind: 'explicit' } }])).toEqual([]);
    expect(validateClickOptions('not an array')).toEqual([]);
    expect(validateClickOptions([chip()])).toHaveLength(1);
  });
});
