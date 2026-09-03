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
import { isRescuePending, isStrippedCarrier } from '../../src/answer/respond/respond.ts';
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

// #73 v2 review round 2 (PR #122): the boundary, not respond.ts's shape check,
// is the deployed gate on a carrier's shape. isRescuePending's pairwise label
// binding still holds for a DIRECT caller (tests/answer/rescue-chip.test.ts),
// but on the deployed path the boundary re-aligns a carrier's `options` to its
// surviving chips first — so what reaches respondToClarificationReply is either
// a well-formed carrier or the stripped one. Pinned here so the two claims stay
// scoped honestly.
describe("a carrier's options are re-aligned to its chips — the deployed gate", () => {
  it('a bare forged rescueOnly WITH options and no chips becomes the STRIPPED carrier (fresh-question routing), never a merge shape', () => {
    const safe = withValidatedClickOptions(rescuePending({ clickOptions: undefined }));
    expect(safe.options).toEqual([]);
    expect(Object.hasOwn(safe, 'clickOptions')).toBe(false);
    expect(safe.rescueOnly).toBe(true);
    expect(isStrippedCarrier(safe)).toBe(true);
    expect(isRescuePending(safe)).toBe(false);
  });

  it("mis-paired option labels are repaired to the chips' own labels — the pairwise binding is enforced by the boundary", () => {
    const safe = withValidatedClickOptions(rescuePending({ options: ['Iets heel anders.'] }));
    expect(safe.options).toEqual([CHIP_LABEL]);
    expect(safe.clickOptions?.map((o) => o.label)).toEqual([CHIP_LABEL]);
    expect(isRescuePending(safe)).toBe(true);
    expect(isStrippedCarrier(safe)).toBe(false);
  });

  it("a real clarification's options are never touched — a typed reply merges against them by design", () => {
    const real = rescuePending({ rescueOnly: undefined, options: ['Utrecht (gemeente)', 'Utrecht (provincie)'], clickOptions: undefined });
    const safe = withValidatedClickOptions(real);
    expect(safe.options).toEqual(['Utrecht (gemeente)', 'Utrecht (provincie)']);
    expect(Object.hasOwn(safe, 'rescueOnly')).toBe(false);
    expect(isStrippedCarrier(safe)).toBe(false);
  });
});
