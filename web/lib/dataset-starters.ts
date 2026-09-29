// Starter questions for a freshly imported table — no AI, no cost: they are
// built from the profile's own column headers and types, then handed to the
// composer (fill, never send) like every other suggestion chip. The reader
// still presses Send, and the normal own-data pipeline validates the question.
import type { ColumnProfile, DatasetProfile } from '../backend/attachments/types.ts';

export type StarterKind = 'overTime' | 'overTimeBy' | 'topBars' | 'compare' | 'breakdown';

export interface Starter {
  kind: StarterKind;
  /** Column headers, verbatim from the file, in the order the template names them. */
  params: Record<string, string>;
}

const MAX_STARTERS = 4;

function isMeasure(c: ColumnProfile): boolean {
  // Only a number column that can be plotted; a year is a period, not a measure.
  return c.type === 'number' && c.numberFormat !== 'ambiguous';
}

/** Categorical columns with a sensible number of groups to compare. */
function isCategory(c: ColumnProfile): boolean {
  return c.type === 'text' && c.distinct !== undefined && !c.distinctTruncated && c.distinct.length >= 2 && c.distinct.length <= 8;
}

export function starterQuestions(profile: DatasetProfile): Starter[] {
  const measures = profile.columns.filter(isMeasure);
  const periods = profile.columns.filter((c) => c.type === 'date' || c.type === 'year');
  const categories = profile.columns.filter(isCategory);
  const manyGroups = profile.columns.filter(
    (c) => c.type === 'text' && c.distinct !== undefined && (c.distinctTruncated === true || c.distinct.length > 8),
  );
  const out: Starter[] = [];
  const first = measures[0];
  if (!first) return out;

  const period = periods[0];
  const category = categories[0];
  if (period && category) out.push({ kind: 'overTimeBy', params: { y: first.header, x: period.header, by: category.header } });
  else if (period) out.push({ kind: 'overTime', params: { y: first.header, x: period.header } });

  const groupColumn = category ?? manyGroups[0];
  if (groupColumn) out.push({ kind: 'topBars', params: { y: first.header, by: groupColumn.header } });

  const second = measures[1];
  if (second && period) out.push({ kind: 'compare', params: { y: first.header, y2: second.header, x: period.header } });

  if (category && manyGroups[0] && manyGroups[0].id !== category.id) {
    out.push({ kind: 'breakdown', params: { y: first.header, by: manyGroups[0].header } });
  }
  return out.slice(0, MAX_STARTERS);
}
