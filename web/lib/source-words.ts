// Session 153 (#357 step 5): the words a table-lane bubble uses for a table's source — "CBS-tabel" /
// "Eurostat-tabel", "bij het CBS" / "bij Eurostat". A Eurostat table was announced as a "CBS-tabel". An unknown
// table (no id yet) reads as CBS, the only source a reader can reach while the Eurostat finder is off.
import { CBS_SOURCE_KEY, resolveSourceForTable } from '../backend/sources/registry.ts';
import type { Lang } from './i18n/messages.ts';

export function sourceWords(
  tableId: string | null | undefined,
  lang: Lang,
): { table: string; from: string; id: string } {
  const source = resolveSourceForTable(tableId ?? '');
  const cbs = source.key === CBS_SOURCE_KEY;
  // The id as the reader knows it: a Eurostat dataset code without our 'eurostat:' prefix; a CBS id unchanged.
  const colon = (tableId ?? '').indexOf(':');
  const id = colon >= 0 ? (tableId ?? '').slice(colon + 1) : (tableId ?? '');
  if (lang === 'en') return { table: `${source.displayName} table`, from: source.displayName, id };
  return { table: `${source.displayName}-tabel`, from: cbs ? 'het CBS' : source.displayName, id };
}
