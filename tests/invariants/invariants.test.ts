// Invariant test suite — will hold the R1-R11 anti-hallucination tests from
// docs/05-data-rules.md. Each todo below is a named obligation: it turns into a real
// test in the work package that builds the code it checks (answer composition,
// audit records, chart specs). A green run of this suite currently proves ONLY the
// doc-consistency checks at the bottom — the todos are visible debt, not passes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('anti-hallucination invariants (docs/05-data-rules.md)', () => {
  it.todo('R1: every numeric token in a rendered answer traces to a result ID or registered derivation in the audit record');
  it.todo('R2: the answer-phrasing prompt serializes only ValidatedResult[] + attribution metadata, nothing else');
  it.todo('R3: numbers in LLM output match result objects verbatim; Dutch number/scale words rejected unless derivation-backed; fail-closed to template');
  it.todo('R4: every answer displays table ID(s), title, last-sync date, covered period');
  it.todo('R5: derived values computed by registered functions only, marked as derived, listing source cells');
  it.todo('R6: chart specs built deterministically from validated results; renderer cannot compute or omit');
  it.todo('R7: ranked candidate intents with confidence; ambiguity above cutoff exits to clarification, never a best guess');
  it.todo('R8: audit record (incl. final answer text + chart spec) written and reconstructable before the answer is shown');
  it.todo('R9: values semantically bound to their dimension coordinates; direction/comparison words match registered derivations; correct-prose fixtures must pass');
  it.todo('R10: displayed unit matches result-object unit metadata (factor-1000 and %-vs-procentpunt guards)');
  it.todo('R11: provisional (voorlopig) figures marked; null-with-reason cells state their CBS reason');
});

describe('doc consistency (keeps this scaffold honest)', () => {
  const dataRules = readFileSync(new URL('../../docs/05-data-rules.md', import.meta.url), 'utf8');

  it('docs/05-data-rules.md still defines all eleven invariants R1..R11', () => {
    for (let i = 1; i <= 11; i++) {
      expect(dataRules, `invariant R${i} missing from docs`).toMatch(new RegExp(`\\*\\*R${i}\\*\\*`));
    }
  });

  it('the todo list above covers every invariant the doc defines (no R12 slipped in unnoticed)', () => {
    expect(dataRules).not.toMatch(/\*\*R12\*\*/);
  });
});
