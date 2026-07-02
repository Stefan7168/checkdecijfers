// Structural + arithmetic checks on the frozen benchmark/answer-key.json (docs/02
// -user-scenarios.md, Scoring). Hermetic: no DB access (CI has none — ADR 009), so
// this cannot re-verify values against the live ingest. It guards against hand-edit
// drift and shape/reference mistakes; the values themselves were verified once,
// directly against the ingested `observations` table, when the key was frozen.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PHASE0_TABLES } from '../../src/ingestion/registry-seed.ts';

const key = JSON.parse(
  readFileSync(new URL('../../benchmark/answer-key.json', import.meta.url), 'utf8'),
) as {
  tasks: Record<string, any>;
};
const { tasks } = JSON.parse(
  readFileSync(new URL('../../benchmark/tasks.json', import.meta.url), 'utf8'),
) as { tasks: { id: string; type: string }[] };

const answerableIds = tasks.filter((t) => t.type === 'answerable').map((t) => t.id);
const registeredTableIds = new Set(PHASE0_TABLES.map((t) => t.id));
const CBS_STATUSES = new Set(['Definitief', 'Voorlopig', 'NaderVoorlopig']);

function tablesReferencedBy(entry: any): string[] {
  if (entry.table) return [entry.table];
  if (entry.cells) return entry.cells.map((c: any) => entry.table).filter(Boolean);
  return [];
}

function statusesIn(entry: any): string[] {
  const out: string[] = [];
  if (entry.status) out.push(entry.status);
  if (entry.points) out.push(...entry.points.map((p: any) => p.status));
  if (entry.cells) out.push(...entry.cells.map((c: any) => c.status));
  if (entry.sources) out.push(...entry.sources.map((s: any) => s.status));
  return out;
}

describe('frozen benchmark answer key (benchmark/answer-key.json)', () => {
  it('has an entry for every answerable task (B1-B14) and the B20 freshness reference', () => {
    for (const id of answerableIds) expect(tasks && key.tasks[id], id).toBeTruthy();
    expect(key.tasks.B20).toBeTruthy();
  });

  it('every entry references a table registered in the Phase 0 set (src/ingestion/registry-seed.ts)', () => {
    for (const [id, entry] of Object.entries(key.tasks)) {
      for (const tableId of tablesReferencedBy(entry)) {
        expect(registeredTableIds.has(tableId), `${id} references unregistered table ${tableId}`).toBe(true);
      }
    }
  });

  it('every CBS status in the key is a valid status code', () => {
    for (const [id, entry] of Object.entries(key.tasks)) {
      for (const status of statusesIn(entry)) {
        expect(CBS_STATUSES.has(status), `${id} has invalid status "${status}"`).toBe(true);
      }
    }
  });

  it('B13 (difference) arithmetic is internally consistent', () => {
    const b13 = key.tasks.B13;
    expect(b13.sources).toHaveLength(2);
    expect(b13.computedValue).toBe(b13.sources[1].value - b13.sources[0].value);
  });

  it('B14 (max) arithmetic is internally consistent and names the correct winner', () => {
    const b14 = key.tasks.B14;
    const max = Math.max(...b14.sources.map((s: any) => s.value));
    expect(b14.computedValue).toBe(max);
    const winnerSource = b14.sources.find((s: any) => s.value === max);
    expect(b14.winner.code).toBe(winnerSource.region.code);
  });

  it('B11 carries the R11 provisional-status marking (solar 2024 is NaderVoorlopig)', () => {
    expect(key.tasks.B11.status).toBe('NaderVoorlopig');
  });

  it('B6 and B12 carry the R10 factor-1,000 unit guard', () => {
    expect(key.tasks.B6.unit).toBe('x 1 000');
    expect(key.tasks.B12.unit).toBe('1 000 euro');
  });

  it('B6 and B9 mark their canonical-default pick as an assumption (registry-internal variant choice, R7)', () => {
    expect(key.tasks.B6.assumption, 'B6 stock-date pin').toBeTruthy();
    expect(key.tasks.B9.assumption, 'B9 bankruptcy-definition pin').toBeTruthy();
  });

  it('B4 and B8 series cover exactly their documented year range with no gaps', () => {
    expect(key.tasks.B4.points.map((p: any) => p.period)).toEqual(
      ['2020JJ00', '2021JJ00', '2022JJ00', '2023JJ00', '2024JJ00'],
    );
    expect(key.tasks.B8.points.map((p: any) => p.period)).toEqual(
      ['2019JJ00', '2020JJ00', '2021JJ00', '2022JJ00', '2023JJ00', '2024JJ00'],
    );
  });
});
