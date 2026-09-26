// ADR 058 (English answers, Task 2): the "glossary" attached to an English
// answer — every distinct CBS name (measure title, region, table title, dim
// label) the result actually uses, paired with its English form from the ONE
// shared name list (src/registry/english-names.ts) and a `translated` flag so
// the reader can tell a real translation from a name that simply reads the
// same in both languages (never silently implied as "not looked up").
//
// This lives in answer/translate/, not in src/registry/english-names.ts,
// because it needs `baseRegionLabel` (src/answer/compose/format.ts) and
// `ValidatedResult` (src/query/index.ts) — pulling either into
// src/registry/english-names.ts would make that file import backend/answer
// code, and english-names.ts must stay a pure table module: web/lib/i18n/
// cbs-words.ts re-exports its converters straight into the web's
// client-side chart bundle (via the web/backend symlink), so nothing in
// english-names.ts's import graph may reach into src/answer/.
import { baseRegionLabel, displayAlternateLabel } from '../compose/format.ts';
import type { ValidatedResult } from '../../query/index.ts';
import {
  hasEnglishName,
  translateDimLabel,
  translateMeasureTitle,
  translatePeriodLabel,
  translateRegion,
  translateTableTitle,
} from '../../registry/english-names.ts';
import { DIM_LABELS, MEASURE_TITLES } from '../../registry/english-names.data.ts';

export interface GlossaryEntry {
  dutch: string;
  english: string;
  kind: 'measure' | 'region' | 'table' | 'dim';
  translated: boolean;
}

/** Every distinct measure title, base region label, table title and dim
 * label the result carries, each paired with its English form. Deduplicated
 * by `kind:dutch` (first occurrence wins, insertion order preserved) — a
 * result with the same measure title on every cell gets exactly one glossary
 * row for it, not one per cell. `translated: false` (hasEnglishName is
 * false) means the shared name list has no entry for this exact string — the row
 * still appears so a caller (e.g. a "translated verbatim, no English name on
 * file" disclosure) can require it to be echoed unchanged. */
export function glossaryForResult(result: ValidatedResult): GlossaryEntry[] {
  const out = new Map<string, GlossaryEntry>();
  const add = (kind: GlossaryEntry['kind'], dutch: string | null | undefined, english: string) => {
    if (!dutch) return;
    const key = `${kind}:${dutch}`;
    // Final-review fold-in 5: `translated` means "the shared name list has an
    // entry", never "the English differs" — 'CPI' → 'CPI' IS a translation.
    if (!out.has(key)) out.set(key, { dutch, english, kind, translated: hasEnglishName(kind, dutch) });
  };
  for (const c of result.cells) {
    add('measure', c.measureTitle, translateMeasureTitle(c.measureTitle));
    if (c.regionLabel) {
      const base = baseRegionLabel(c.regionLabel);
      add('region', base, translateRegion(base));
    }
    for (const label of Object.values(c.dimLabels)) add('dim', label, translateDimLabel(label));
  }
  add('table', result.attribution.tableTitle, translateTableTitle(result.attribution.tableTitle));
  // Session 134 (live B6): the alternates line can name a DIFFERENT CBS name
  // than the cells ('stand per 31 december (Eindstand Voorraad)' next to a
  // 'Beginstand voorraad' result). A listed measure title or dim label found
  // verbatim in it — case-sensitive, whole-word — joins the glossary, so the
  // model is given (and C5 requires) CBS's own English, never a neighbour's.
  for (const alt of result.attribution.alternates ?? []) {
    const label = displayAlternateLabel(alt.label);
    for (const dutch of Object.keys(MEASURE_TITLES)) {
      if (containsExactly(label, dutch)) add('measure', dutch, translateMeasureTitle(dutch));
    }
    for (const dutch of Object.keys(DIM_LABELS)) {
      if (containsExactly(label, dutch)) add('dim', dutch, translateDimLabel(dutch));
    }
  }
  return [...out.values()];
}

function containsExactly(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(text);
}

/** Every distinct `periodLabel` the result's cells carry, in first-seen
 * order, paired with its English form via `translatePeriodLabel`. */
export function periodLabelPairs(result: ValidatedResult): { dutch: string; english: string }[] {
  const seen = new Set<string>();
  const out: { dutch: string; english: string }[] = [];
  for (const c of result.cells) {
    if (seen.has(c.periodLabel)) continue;
    seen.add(c.periodLabel);
    out.push({ dutch: c.periodLabel, english: translatePeriodLabel(c.periodLabel) });
  }
  return out;
}
