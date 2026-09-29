import { describe, expect, it } from 'vitest';
import { buildDatasetProfile } from '../backend/attachments/ingest/profile.ts';
import { starterQuestions } from './dataset-starters.ts';

describe('starterQuestions', () => {
  it('offers a time chart per group, a ranking, and a two-measure comparison when the columns allow it', () => {
    const rows = [['Maand', 'Regio', 'Omzet', 'Kosten']];
    for (const m of ['2024-01-01', '2024-02-01', '2024-03-01']) for (const r of ['Noord', 'Zuid']) rows.push([m, r, '100,5', '60,5']);
    const kinds = starterQuestions(buildDatasetProfile(rows)).map((s) => s.kind);
    expect(kinds).toEqual(['overTimeBy', 'topBars', 'compare']);
  });
  it('uses the file’s own headers verbatim and never invents a column', () => {
    const rows = [['Datum', 'Waarde'], ['2024-01-01', '1,5'], ['2024-02-01', '2,5']];
    expect(starterQuestions(buildDatasetProfile(rows))).toEqual([{ kind: 'overTime', params: { y: 'Waarde', x: 'Datum' } }]);
  });
  it('offers nothing when there is no plottable number column', () => {
    expect(starterQuestions(buildDatasetProfile([['a', 'b'], ['x', 'y'], ['z', 'w']]))).toEqual([]);
  });
});
