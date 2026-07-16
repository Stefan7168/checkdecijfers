// #144 (ADR 034): the labelled calibration set for the semantic checker.
// Every case is a (body, result) pair that PASSES the full deterministic
// validator AND carries at least one residual-prone suspect — the eval script
// (scripts/semantic-check-eval.ts) enforces both structurally, because a case
// the validator already rejects, or one with no suspects, measures nothing
// about the checker.
//
// expected 'clear'      → a LEGIT residual-shaped phrasing; a rejection here
//                         is a FALSE POSITIVE (a blocker, same standard as
//                         validator calibration — ADR 013 §6).
// expected 'fabricated' → a seeded residual-class fabrication (the #140/#141
//                         ceiling shapes); a clearance here is a FALSE
//                         NEGATIVE (the checker misses the hole it exists to
//                         close — also a blocker for the flag flip).
//
// Labels are product-policy judgments; changing one is a reviewed decision,
// never a way to green a run (the ADR 012 rule). Grow the set from measured
// live behavior in the owner-supervised recording step.
import type { ValidatedResult } from '../../src/query/index.ts';
import { makeCell, makeResult } from './synthetic-results.ts';

export interface SemanticCheckCase {
  id: string;
  /** What the case probes, for the report. */
  note: string;
  expected: 'clear' | 'fabricated';
  body: string;
  result: () => ValidatedResult;
}

function faillissementen(): ValidatedResult {
  return makeResult({
    shape: 'single',
    cells: [makeCell({ periodCode: '2024JJ00', periodLabel: '2024', value: 3226, unit: 'aantal' })],
  });
}

function percentage(): ValidatedResult {
  return makeResult({
    shape: 'single',
    cells: [makeCell({ periodCode: '2024JJ00', periodLabel: '2024', value: 4.0, unit: '%', decimals: 1 })],
  });
}

function bracket(): ValidatedResult {
  const cell = makeCell({ periodCode: '2024JJ00', periodLabel: '2024', value: 3618, unit: 'aantal' });
  // 'personen van …': a bare label starting at the numeral ('45 tot 65 jaar')
  // leaves 45 with no word before it, so its echo can never anchor and the
  // deterministic validator rejects the body outright (fail-closed) — such a
  // body never reaches the checker. The prefixed label is the shape whose
  // echoes DO pass and therefore carries the #140 residual.
  cell.dimLabels = { leeftijd: 'personen van 45 tot 65 jaar' };
  return makeResult({ shape: 'single', cells: [cell] });
}

function jaar2025(): ValidatedResult {
  return makeResult({
    shape: 'single',
    cells: [makeCell({ periodCode: '2025JJ00', periodLabel: '2025', value: 3226, unit: 'aantal' })],
  });
}

export const SEMANTIC_CHECK_CASES: SemanticCheckCase[] = [
  // --- seeded fabrications (the residual shapes the checker exists for) ---
  {
    id: 'F1-year-as-count',
    note: "#141 residual: temporal marker + un-listed noun — '2024' used as a count of attempts",
    expected: 'fabricated',
    body: 'In 2024 werden in totaal 3.226 faillissementen uitgesproken. Het doel werd pas na 2024 pogingen gehaald.',
    result: faillissementen,
  },
  {
    id: 'F2-bracket-as-duration',
    note: "#140 residual: the result's own bracket value '65' reused as a duration beside its own word 'jaar'",
    expected: 'fabricated',
    body: 'In 2024 telde de groep personen van 45 tot 65 jaar 3.618 personen. De regeling bestaat al 65 jaar.',
    result: bracket,
  },
  {
    id: 'F3-year-as-count-sessions',
    note: "#141 residual, second noun outside every list: '2024' as a count of sessions",
    expected: 'fabricated',
    body: 'In 2024 bedroeg het percentage 4,0%. Het lukte pas na 2024 sessies.',
    result: percentage,
  },
  {
    id: 'F4-month-compound-count',
    note: "review-confirmed bypass class: a fabricated count riding a month-name compound ('31 januari-meldingen')",
    expected: 'fabricated',
    body: "Er waren op 31 januari 2024 5.000 auto's. Daarnaast registreerde de dienst nog 31 januari-meldingen extra.",
    result: () =>
      makeResult({
        shape: 'single',
        cells: [
          makeCell({ periodCode: '2024JJ00', periodLabel: '2024', value: 5000, unit: 'aantal', measureTitle: 'Aantal op 31 januari' }),
        ],
      }),
  },
  // --- legit residual-shaped phrasings (the false-positive guard) ---
  {
    id: 'C5-date-echo-without-year',
    note: "legit peildatum echo WITHOUT a trailing year ('per 1 januari telde …') — soft since the compound-bypass fix; must clear",
    expected: 'clear',
    body: 'Per 1 januari telde Nederland in 2024 3.618 inwoners.',
    result: () =>
      makeResult({
        shape: 'single',
        cells: [
          makeCell({ periodCode: '2024JJ00', periodLabel: '2024', value: 3618, unit: 'aantal', measureTitle: 'Bevolking op 1 januari' }),
        ],
      }),
  },
  {
    id: 'C1-unscreened-verb',
    note: "legit temporal year followed by an un-screened word ('volgens') — must clear",
    expected: 'clear',
    body: 'In 2024 werden in totaal 3.226 faillissementen uitgesproken. Het beeld veranderde na 2024 volgens het bureau.',
    result: faillissementen,
  },
  {
    id: 'C2-legit-bracket-echo',
    note: "legit coordinate echo: '65' inside the bracket descriptor '45 tot 65 jaar' — must clear",
    expected: 'clear',
    body: 'In 2024 telde de groep personen van 45 tot 65 jaar 3.618 personen.',
    result: bracket,
  },
  {
    id: 'C3-heel-year-unscreened-verb',
    note: "legit 'in heel 2025' + un-screened verb 'bleef' — must clear",
    expected: 'clear',
    body: 'In heel 2025 bleef het aantal faillissementen 3.226.',
    result: jaar2025,
  },
  {
    id: 'C4-mixed-suspects-all-legit',
    note: 'two legit suspects in one body (bracket echo + temporal year) — must clear both',
    expected: 'clear',
    body: 'In 2024 telde de groep personen van 45 tot 65 jaar 3.618 personen. Dat aantal was na 2024 volgens de prognose anders.',
    result: bracket,
  },
];
