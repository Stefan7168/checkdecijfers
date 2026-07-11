// WP30b (ADR 030 amendment A6): the catalog-lifecycle "current" predicate as
// SQL, built from the source registry — the finder's Regulier-first shortlist
// quota (recall.ts) consults each row's OWN source for which catalog statuses
// count as current, instead of hardcoding CBS's 'Regulier'.
//
// The per-row source key is derived from the table id exactly like
// sourceKeyForTableId (src/sources/registry.ts): prefix before the FIRST ':'
// when one exists, else 'cbs' (ADR 030 D4). The two derivations MUST stay
// identical — pinned by tests/catalog/current-status.test.ts, which runs this
// SQL and the TS helper over the same edge ids. Deploy-order-safe by
// construction: it reads only table_id + status, never migration 016's source
// column, so it works the same before and after that migration is applied.
//
// Fail-safe direction: an id whose derived key is not in the registry falls to
// `else false` — never fabricated "current". (Contrast: display paths fall
// back to the cbs entry per A1; fetch seams throw — see
// src/sources/adapters.ts.)
import { SOURCES, type SourceInfo } from '../sources/registry.ts';

export interface IsCurrentPredicate {
  /** SQL boolean expression over cbs_catalog's table_id + status columns. */
  sql: string;
  /** text[] parameters, one per registered source, in the sql's $-order. */
  params: string[][];
}

/**
 * Builds the is-current SQL predicate. `firstParamIndex` is the 1-based index
 * of the FIRST placeholder this predicate may use (the caller owns all lower
 * indexes); params are returned in matching order so no index collision is
 * possible.
 */
export function buildIsCurrentPredicate(
  sources: Readonly<Record<string, SourceInfo>> = SOURCES,
  firstParamIndex = 1,
): IsCurrentPredicate {
  const keys = Object.keys(sources).sort();
  const params: string[][] = [];
  const whens = keys.map((key, i) => {
    params.push([...sources[key]!.currentCatalogStatuses]);
    return `when '${sqlLiteral(key)}' then coalesce(status, '') = any($${firstParamIndex + i}::text[])`;
  });
  const sql =
    `case (case when position(':' in table_id) > 0 then split_part(table_id, ':', 1) else 'cbs' end)\n` +
    `      ${whens.join('\n      ')}\n` +
    `      else false\n    end`;
  return { sql, params };
}

/** Source keys are compile-time registry constants, but quote defensively so
 * a malformed future key can never break out of its SQL string literal. */
function sqlLiteral(key: string): string {
  return key.replaceAll("'", "''");
}
