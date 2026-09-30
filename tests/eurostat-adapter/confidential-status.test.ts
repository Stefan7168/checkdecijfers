// #357, study step 0 defect 3: Eurostat folds a confidentiality code into a cell's status behind '|' ("|C").
// The parser splits it: a confidential cell is stored like a CBS secret cell (value null, a registered reason),
// never as the raw "|C" string and never with a number. Hermetic, on the recorded shape in
// tests/fixtures/eurostat-errors/confidential-monthly.json (hand-built to the study's capture shape).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EUROSTAT_CONFIDENTIAL,
  EUROSTAT_DEFINITIVE_STATUS,
  parseJsonStatDataset,
  splitEurostatStatus,
} from '../../src/eurostat-adapter/jsonstat.ts';
import { isProvisionalStatus, SOURCES } from '../../src/sources/registry.ts';

const FIXTURE = JSON.parse(
  readFileSync(new URL('../fixtures/eurostat-errors/confidential-monthly.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const CONFORMANCE = JSON.parse(
  readFileSync(new URL('../fixtures/eurostat/conformance.json', import.meta.url), 'utf8'),
) as { declaredPeriodStatuses: string[]; declaredValueAttributes: string[] };
const EUROSTAT = SOURCES['eurostat']!;

function withStatus(status: unknown, value: unknown): unknown {
  return { ...FIXTURE, status, value };
}

describe('splitEurostatStatus', () => {
  it('splits the observation flag from the confidentiality code', () => {
    expect(splitEurostatStatus(null, 't')).toEqual({ flag: null, confidential: false });
    expect(splitEurostatStatus('p', 't')).toEqual({ flag: 'p', confidential: false });
    expect(splitEurostatStatus('|C', 't')).toEqual({ flag: null, confidential: true });
    expect(splitEurostatStatus('b|C', 't')).toEqual({ flag: 'b', confidential: true });
    expect(splitEurostatStatus('|N', 't').confidential).toBe(true);
    expect(splitEurostatStatus('|P', 't').confidential).toBe(true);
    expect(splitEurostatStatus('p|F', 't')).toEqual({ flag: 'p', confidential: false });
    expect(splitEurostatStatus('p|', 't')).toEqual({ flag: 'p', confidential: false });
    expect(splitEurostatStatus('c', 't')).toEqual({ flag: 'c', confidential: true });
  });

  it('refuses a confidentiality code it does not know (never guesses whether the value may be shown)', () => {
    expect(() => splitEurostatStatus('|Q', 'eurostat:x')).toThrow(/confidentiality code 'Q'.*does not know/);
  });
});

describe('a confidential cell in a parsed dataset', () => {
  const parsed = parseJsonStatDataset(FIXTURE, 'eurostat:sts_inpr_m');
  const byPeriod = (period: string) => parsed.rows.find((r) => r.coordinates.time === period)!;

  it('is kept as a cell with no value, flagged c, the same way for "|C" and "b|C"', () => {
    for (const period of ['2024MM02', '2024MM03']) {
      const row = byPeriod(period);
      expect(row.value).toBeNull();
      expect(row.valueAttribute).toBe(EUROSTAT_CONFIDENTIAL);
      expect(row.status).toBe(EUROSTAT_CONFIDENTIAL);
    }
  });

  it('never stores the raw "|C" string anywhere', () => {
    const json = JSON.stringify(parsed.rows);
    expect(json).not.toContain('|C');
    expect(parsed.rows.some((r) => r.status?.includes('|') || r.valueAttribute.includes('|'))).toBe(false);
  });

  it('leaves the other cells as they were: a plain value is published, a "p" value is provisional', () => {
    expect(byPeriod('2024MM01')).toMatchObject({ value: 100.1, status: EUROSTAT_DEFINITIVE_STATUS, valueAttribute: 'None' });
    expect(byPeriod('2024MM04')).toMatchObject({ value: 101.3, status: 'p', valueAttribute: 'p' });
  });

  it('states its reason (R11) and is never definitive', () => {
    const row = byPeriod('2024MM02');
    expect(EUROSTAT.nullReasonLabels[row.valueAttribute]).toBe('door Eurostat niet gepubliceerd (vertrouwelijk)');
    expect(isProvisionalStatus(EUROSTAT, row.status!)).toBe(true);
  });

  it('uses only statuses and value attributes the Eurostat manifest declares (conformance F3)', () => {
    for (const row of parsed.rows) {
      expect(CONFORMANCE.declaredPeriodStatuses).toContain(row.status);
      expect(CONFORMANCE.declaredValueAttributes).toContain(row.valueAttribute);
    }
  });
});

describe('a withheld value is never published', () => {
  it('a number that arrives next to "|C" is dropped, not stored', () => {
    const parsed = parseJsonStatDataset(withStatus({ '1': '|C' }, { '0': 100.1, '1': 999.9 }), 'eurostat:sts_inpr_m');
    const row = parsed.rows.find((r) => r.coordinates.time === '2024MM02')!;
    expect(row.value).toBeNull();
    expect(row.status).toBe('c');
    expect(JSON.stringify(parsed.rows)).not.toContain('999.9');
  });

  it('the bare flag "c" is handled the same way as "|C"', () => {
    const parsed = parseJsonStatDataset(withStatus({ '1': 'c' }, { '0': 100.1, '1': 999.9 }), 'eurostat:sts_inpr_m');
    const row = parsed.rows.find((r) => r.coordinates.time === '2024MM02')!;
    expect(row).toMatchObject({ value: null, status: 'c', valueAttribute: 'c' });
  });

  it('a wholly confidential slice (every cell only in status, value empty) is data: four null cells, no error', () => {
    const parsed = parseJsonStatDataset(withStatus({ '0': '|C', '1': '|C', '2': '|C', '3': '|C' }, {}), 'eurostat:sts_inpr_m');
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows.every((r) => r.value === null && r.status === 'c')).toBe(true);
  });

  it('a flag-free confidentiality marker ("|F") keeps the value and stays published', () => {
    const parsed = parseJsonStatDataset(withStatus({ '0': '|F' }, { '0': 100.1 }), 'eurostat:sts_inpr_m');
    expect(parsed.rows.find((r) => r.coordinates.time === '2024MM01')).toMatchObject({
      value: 100.1,
      status: EUROSTAT_DEFINITIVE_STATUS,
    });
  });

  it('an unknown confidentiality code fails the parse loudly', () => {
    expect(() => parseJsonStatDataset(withStatus({ '1': '|Q' }, { '0': 100.1 }), 'eurostat:sts_inpr_m')).toThrow(
      /confidentiality code 'Q'/,
    );
  });
});
