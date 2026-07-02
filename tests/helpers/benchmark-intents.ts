// The docs/02 benchmark phrasings and their hand-authored structured intents
// — extracted from tests/query/benchmark-intents.test.ts when WP6 landed, so
// the WP5 query tests (which prove these intents reproduce the frozen answer
// key) and the WP6 parser tests (which prove the parser EMITS these intents)
// target literally the same objects. Nothing numeric lives here; values stay
// in benchmark/answer-key.json (the honesty rule).
import type { StructuredIntent } from '../../src/query/index.ts';

export interface AnswerableBenchmarkTask {
  question: string;
  intent: StructuredIntent;
}

/** B1–B14: answerable tasks — question phrasing exactly as in docs/02, intent
 * hand-authored from it (WP5) and the WP6 parser's target output. */
export const ANSWERABLE_TASKS: Record<string, AnswerableBenchmarkTask> = {
  B1: {
    question: 'Hoeveel inwoners had Nederland op 1 januari 2025?',
    intent: { schemaVersion: 1, target: { kind: 'canonical', key: 'population_on_1_january' }, regions: ['NL01'], period: { kind: 'codes', codes: ['2025JJ00'] }, derivation: 'none' },
  },
  B2: {
    question: 'Hoeveel inwoners had de gemeente Utrecht op 1 januari 2024?',
    intent: { schemaVersion: 1, target: { kind: 'canonical', key: 'population_on_1_january' }, regions: ['GM0344'], period: { kind: 'codes', codes: ['2024JJ00'] }, derivation: 'none' },
  },
  B3: {
    question: 'Wat was de inflatie (CPI, jaargemiddelde) in 2024?',
    intent: { schemaVersion: 1, target: { kind: 'canonical', key: 'cpi_yearly_inflation' }, period: { kind: 'codes', codes: ['2024JJ00'] }, derivation: 'none' },
  },
  B4: {
    question: 'Hoe ontwikkelde de inflatie zich per jaar van 2020 t/m 2024?',
    intent: { schemaVersion: 1, target: { kind: 'canonical', key: 'cpi_yearly_inflation' }, period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' }, derivation: 'series' },
  },
  B5: {
    question: 'Wat was het werkloosheidspercentage in het vierde kwartaal van 2025?',
    intent: { schemaVersion: 1, target: { kind: 'canonical', key: 'unemployment_rate_seasonally_adjusted' }, period: { kind: 'codes', codes: ['2025KW04'] }, derivation: 'none' },
  },
  B6: {
    question: 'Hoeveel woningen telde Nederland in 2024?',
    intent: { schemaVersion: 1, target: { kind: 'canonical', key: 'housing_stock_start_of_year' }, period: { kind: 'codes', codes: ['2024JJ00'] }, derivation: 'none' },
  },
  B7: {
    question: 'Wat was de gemiddelde verkoopprijs van bestaande koopwoningen in 2024?',
    intent: { schemaVersion: 1, target: { kind: 'canonical', key: 'average_existing_home_sale_price' }, period: { kind: 'codes', codes: ['2024JJ00'] }, derivation: 'none' },
  },
  B8: {
    question: 'Hoe ontwikkelde de gemiddelde koopwoningprijs zich van 2019 t/m 2024?',
    intent: { schemaVersion: 1, target: { kind: 'canonical', key: 'average_existing_home_sale_price' }, period: { kind: 'range', from: '2019JJ00', to: '2024JJ00' }, derivation: 'series' },
  },
  B9: {
    question: 'Hoeveel faillissementen werden er in 2025 uitgesproken?',
    intent: { schemaVersion: 1, target: { kind: 'canonical', key: 'bankruptcies_businesses' }, period: { kind: 'codes', codes: ['2025JJ00'] }, derivation: 'none' },
  },
  B10: {
    question: 'Vergelijk het aantal inwoners van Amsterdam en Rotterdam op 1 januari 2024.',
    intent: { schemaVersion: 1, target: { kind: 'canonical', key: 'population_on_1_january' }, regions: ['GM0363', 'GM0599'], period: { kind: 'codes', codes: ['2024JJ00'] }, derivation: 'none' },
  },
  B11: {
    question: 'Hoeveel elektriciteit uit zonnestroom werd er in 2024 opgewekt?',
    intent: { schemaVersion: 1, target: { kind: 'canonical', key: 'solar_electricity_production' }, period: { kind: 'codes', codes: ['2024JJ00'] }, derivation: 'none' },
  },
  B12: {
    question: 'Wat was het gemiddelde besteedbaar inkomen van huishoudens in 2023?',
    intent: { schemaVersion: 1, target: { kind: 'canonical', key: 'average_disposable_household_income' }, period: { kind: 'codes', codes: ['2023JJ00'] }, derivation: 'none' },
  },
  B13: {
    question: 'Groeide de bevolking van Nederland in 2024, en met hoeveel?',
    intent: { schemaVersion: 1, target: { kind: 'canonical', key: 'population_on_1_january' }, regions: ['NL01'], period: { kind: 'codes', codes: ['2024JJ00', '2025JJ00'] }, derivation: 'difference' },
  },
  B14: {
    question: 'Welke van de G4-gemeenten had de meeste inwoners op 1 januari 2025?',
    intent: { schemaVersion: 1, target: { kind: 'canonical', key: 'population_on_1_january' }, regions: ['GM0363', 'GM0599', 'GM0518', 'GM0344'], period: { kind: 'codes', codes: ['2025JJ00'] }, derivation: 'max' },
  },
};

/** B15–B20: refusal/clarification task phrasings (docs/02). Their expected
 * BEHAVIOR lives in the tests; only the phrasing is shared here. */
export const REFUSAL_TASK_QUESTIONS: Record<string, string> = {
  B15: 'Hoeveel mensen zitten in de bijstand?',
  B16: 'Wat is de gemiddelde huizenprijs in mijn buurt?',
  B17: 'Hoeveel asielzoekers kwamen er vorige maand binnen?',
  B18: 'Wat wordt de inflatie in 2027?',
  B19: 'Is de criminaliteit gestegen door immigratie?',
  B20: 'Wat was de inflatie van vorige maand?',
};

/** The docs/02 "un-disambiguated phrasing check": B3 and B5 without their
 * disambiguators must resolve to the canonical default WITHOUT clarifying —
 * catches a pipeline that games the gate by clarifying everything. */
export const UNDISAMBIGUATED_VARIANTS: Record<string, AnswerableBenchmarkTask> = {
  'B3-undisambiguated': {
    question: 'Wat was de inflatie in 2024?',
    intent: ANSWERABLE_TASKS.B3!.intent,
  },
  'B5-undisambiguated': {
    question: 'Hoe hoog was de werkloosheid in het vierde kwartaal van 2025?',
    intent: ANSWERABLE_TASKS.B5!.intent,
  },
};
