// Task 3a (docs/session-briefs plan "regional statistics part 1"): a strict,
// fail-closed reader of CBS's PROSE period notes, for tables (70072ned is the
// first) where CBS states `Status: null` on every period and instead states
// provisionality in the Perioden code list's `Description` free text
// ("Uitkomsten zijn voorlopig over: ..." / "... nader voorlopig over: ...").
// R11 needs a status per served cell; principle (c) says refuse rather than
// guess, so every rule below is a loud `{ ok: false, summary }` naming the
// period and the offending text, never a silent default.
//
// Pure unit tests only — no fixture, no db. The real end-to-end exercise
// against the 70072ned fixture is Task 3's job (only seed entry that will
// carry a `periodNoteStatus` config).
import { describe, expect, it } from 'vitest';
import {
  normalizeHeading,
  parsePeriodNotes,
  type PeriodNoteStatusConfig,
} from '../../src/ingestion/period-note-status.ts';
import { checkPeriodParsing } from '../../src/ingestion/validate.ts';
import type { CbsCode, CbsObservationRow } from '../../src/cbs-adapter/types.ts';

function periodCode(code: string, description?: string, status: string | null = null): CbsCode {
  return {
    code,
    title: code,
    dimensionGroup: null,
    status,
    index: null,
    ...(description !== undefined ? { description } : {}),
  };
}

// --- normalizeHeading -------------------------------------------------------

describe('normalizeHeading', () => {
  it('trims and lowercases a plain heading', () => {
    expect(normalizeHeading('Nabijheid voorzieningen')).toBe('nabijheid voorzieningen');
  });

  it('keeps an internal dash (not a bullet marker) untouched', () => {
    expect(normalizeHeading('Wonen - Gemiddelde WOZ waarde van woningen')).toBe(
      'wonen - gemiddelde woz waarde van woningen',
    );
  });

  it('strips a leading bullet dash and the whitespace after it, and a trailing semicolon (old-style lines)', () => {
    expect(normalizeHeading('- uitkeringsontvangers;')).toBe('uitkeringsontvangers');
  });

  it('strips a leading bullet dash and a trailing period (old-style lines)', () => {
    expect(normalizeHeading('- afval van huishoudens.')).toBe('afval van huishoudens');
  });

  it('collapses internal whitespace runs to a single space', () => {
    expect(normalizeHeading('Onderwijs   naar    woonregio -  Leerlingen')).toBe(
      'onderwijs naar woonregio - leerlingen',
    );
  });
});

// --- parsePeriodNotes: rule 7 (real 2025 note text) + defaults --------------

const REAL_2025_NOTE =
  'Uitkomsten zijn voorlopig over:\r\nNabijheid voorzieningen\r\nBedrijfsvestigingen\r\nWonen - Gemiddelde WOZ waarde van woningen\r\nSociale zekerheid\r\nOnderwijs naar schoolregio\r\nOnderwijs naar woonregio - Leerlingen\r\n\r\nUitkomsten zijn nader voorlopig over:\r\nWonen - Voorraad woningen\r\nMilieu en bodemgebruik - Afval van huishoudens\r\n';

const REAL_2025_CONFIG: PeriodNoteStatusConfig = {
  headings: {
    'nabijheid voorzieningen': ['X092783', 'D000025'],
    bedrijfsvestigingen: ['M000200_2'],
    'wonen - gemiddelde woz waarde van woningen': ['M003039'],
    'sociale zekerheid': ['X033647'],
    'onderwijs naar schoolregio': [],
    'onderwijs naar woonregio - leerlingen': [],
    'wonen - voorraad woningen': ['1014800'],
    'milieu en bodemgebruik - afval van huishoudens': [],
  },
};

const REAL_2025_SERVED = ['X092783', 'D000025', 'M000200_2', 'M003039', 'X033647', '1014800', 'M000100'];

describe('parsePeriodNotes — rule 7 (status assignment) against the real 2025 note text', () => {
  it('gives Voorlopig for every measure under the voorlopig section', () => {
    const result = parsePeriodNotes([periodCode('2025JJ00', REAL_2025_NOTE)], REAL_2025_CONFIG, REAL_2025_SERVED);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.summary);
    expect(result.statusOf('2025JJ00', 'X092783')).toBe('Voorlopig');
    expect(result.statusOf('2025JJ00', 'D000025')).toBe('Voorlopig');
    expect(result.statusOf('2025JJ00', 'M000200_2')).toBe('Voorlopig');
    expect(result.statusOf('2025JJ00', 'M003039')).toBe('Voorlopig');
    expect(result.statusOf('2025JJ00', 'X033647')).toBe('Voorlopig');
  });

  it('gives NaderVoorlopig for every measure under the nader voorlopig section', () => {
    const result = parsePeriodNotes([periodCode('2025JJ00', REAL_2025_NOTE)], REAL_2025_CONFIG, REAL_2025_SERVED);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.summary);
    expect(result.statusOf('2025JJ00', '1014800')).toBe('NaderVoorlopig');
  });

  it('defaults an uncovered served measure to Definitief (CBS\'s stated default)', () => {
    const result = parsePeriodNotes([periodCode('2025JJ00', REAL_2025_NOTE)], REAL_2025_CONFIG, REAL_2025_SERVED);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.summary);
    expect(result.statusOf('2025JJ00', 'M000100')).toBe('Definitief');
  });

  it('defaults every measure to Definitief for a period with an empty/absent description', () => {
    const result = parsePeriodNotes(
      [periodCode('2024JJ00'), periodCode('2023JJ00', '')],
      REAL_2025_CONFIG,
      REAL_2025_SERVED,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.summary);
    expect(result.statusOf('2024JJ00', 'M000100')).toBe('Definitief');
    expect(result.statusOf('2024JJ00', 'X092783')).toBe('Definitief');
    expect(result.statusOf('2023JJ00', 'X092783')).toBe('Definitief');
  });
});

// --- rule 1: unknown section header -----------------------------------------

describe('parsePeriodNotes — rule 1 (unknown section header)', () => {
  it('fails on a line ending in ":" that is not one of the two recognised section headers', () => {
    const note = 'Uitkomsten zijn ergens anders over:\r\nFoo\r\n';
    const result = parsePeriodNotes([periodCode('2025JJ00', note)], { headings: { foo: [] } }, ['M1']);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.summary).toContain('2025JJ00');
  });
});

// --- rule 2: content before the first section header ------------------------

describe('parsePeriodNotes — rule 2 (content before the first header)', () => {
  it('fails when a non-empty line precedes any recognised section header', () => {
    const note = 'Some prose\r\nUitkomsten zijn voorlopig over:\r\nFoo\r\n';
    const result = parsePeriodNotes([periodCode('2025JJ00', note)], { headings: { foo: [] } }, ['M1']);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.summary).toContain('2025JJ00');
  });
});

// --- rule 3: heading not in config.headings ---------------------------------

describe('parsePeriodNotes — rule 3 (unreviewed heading)', () => {
  it('fails naming the offending (normalized) topic when it is not in config.headings', () => {
    const note = 'Uitkomsten zijn voorlopig over:\r\nSome nieuw onderwerp\r\n';
    const result = parsePeriodNotes([periodCode('2025JJ00', note)], { headings: {} }, ['M1']);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.summary).toContain('some nieuw onderwerp');
    expect(result.summary).toContain('2025JJ00');
  });
});

// --- rule 4: same served measure covered by both sections -------------------

describe('parsePeriodNotes — rule 4 (measure covered by both sections)', () => {
  it('fails when the same served measure is covered by both the voorlopig and nader voorlopig sections in one period', () => {
    const note =
      'Uitkomsten zijn voorlopig over:\r\nFoo\r\n\r\nUitkomsten zijn nader voorlopig over:\r\nBar\r\n';
    const config: PeriodNoteStatusConfig = { headings: { foo: ['M1'], bar: ['M1'] } };
    const result = parsePeriodNotes([periodCode('2025JJ00', note)], config, ['M1']);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.summary).toContain('M1');
    expect(result.summary).toContain('2025JJ00');
  });
});

// --- rule 5: config names a code not in servedCodes -------------------------

describe('parsePeriodNotes — rule 5 (config error: unserved code)', () => {
  it('fails up front, before any period is inspected, when a heading names a code outside servedCodes', () => {
    const config: PeriodNoteStatusConfig = { headings: { foo: ['NOTSERVED'] } };
    const result = parsePeriodNotes([], config, ['M1']);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.summary).toContain('NOTSERVED');
  });
});

// --- rule 6: a period already carrying a machine status ---------------------

describe('parsePeriodNotes — rule 6 (machine status already present)', () => {
  it('fails naming the period when its machine status is non-null', () => {
    const note = 'Uitkomsten zijn voorlopig over:\r\nFoo\r\n';
    const config: PeriodNoteStatusConfig = { headings: { foo: ['M1'] } };
    const result = parsePeriodNotes([periodCode('2025JJ00', note, 'Definitief')], config, ['M1']);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.summary).toContain('2025JJ00');
  });
});

// --- checkPeriodParsing: the statusless-period rule, per #251 per-cell status
// (validate.ts change this task makes) -------------------------------------

function row(measure: string, period: string, status?: string): CbsObservationRow {
  const base: CbsObservationRow = {
    measure,
    coordinates: { Perioden: period },
    value: 1,
    valueAttribute: 'None',
    stringValue: null,
  };
  return status !== undefined ? { ...base, status } : base;
}

describe('checkPeriodParsing — a statusless period is acceptable iff every row carries a per-cell status', () => {
  it('passes when every row of a statusless period carries a non-empty per-cell status', () => {
    const rows = [row('M1', '2025JJ00', 'Voorlopig'), row('M2', '2025JJ00', 'Definitief')];
    const codes = [periodCode('2025JJ00', undefined, null)];
    expect(checkPeriodParsing(rows, 'Perioden', codes)).toEqual({ ok: true });
  });

  it('fails with the existing summary when at least one row of a statusless period carries no per-cell status', () => {
    const rows = [row('M1', '2025JJ00', 'Voorlopig'), row('M2', '2025JJ00')];
    const codes = [periodCode('2025JJ00', undefined, null)];
    const result = checkPeriodParsing(rows, 'Perioden', codes);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.stage).toBe('period_parsing');
    expect(result.summary).toContain('carry no publication status');
    expect(result.summary).toContain('2025JJ00');
  });
});
