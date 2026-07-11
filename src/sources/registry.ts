// WP30a (ADR 030 D3 + amendments A1/A2/A6): the SOURCE REGISTRY — the single
// code-level authority for source identity and display. Every surface that
// spells a source's name, attribution label, deep link, provisional suffix or
// null-reason wording resolves it HERE, so the three-independent-spellings
// drift the multi-source audit found can never recur, and adding source #2
// becomes a registry entry + an adapter instead of a copy hunt.
//
// This module is a PURE LEAF (data + one lookup, no imports): it is consumed
// by client-bundled web code (citation, stat-card, chat link) as well as the
// backend, so it must never pull the adapter/module graph in. That is why —
// deviating from the original D3 field list, recorded in the ADR as-built —
// there is NO adapterFactory here: adapter construction stays at the few
// node-only call sites until WP30b/c gives routing a real second target.
//
// A1 (load-bearing): rows stored BEFORE WP30a carry NO `attribution.source`
// key in their frozen audit JSON. resolveSource(undefined) therefore returns
// the 'cbs' entry, and every consumer resolves through it — old rows
// re-derive their display strings byte-identically, forever (R8).

export interface SourceInfo {
  key: string;
  /** Short organization name ('CBS') — chart null-notes, unknown-marker
   * fallbacks ("door CBS gemarkeerd als …"). */
  displayName: string;
  /** The attribution label ('CBS StatLine') — the R4 line, citations, the
   * chat deep-link label, the stat-card footer. */
  attributionLabel: string;
  license: 'CC BY 4.0';
  /** Deep link to the source's own public viewer for a table id, or null
   * when the source has none. The CBS shape links to the TABLE view — cell
   * deep-links are unstable across StatLine portal versions (#86). */
  deepLink: ((tableId: string) => string) | null;
  /** A2: verbatim per-cell status → display suffix. Two-tier for CBS. A
   * provisional cell whose status is absent here renders the generic
   * ' (voorlopig cijfer)' (the pre-WP30a behavior, unchanged); which cells
   * COUNT as provisional is `definitiveStatuses` below via
   * isProvisionalStatus (WP30b — byte-identical to the old
   * status !== 'Definitief' rule for every CBS cell). */
  provisionalDisplay: Readonly<Record<string, string>>;
  /** WP30b (ADR 030 § WP30a as-built item 4 note): the verbatim per-cell
   * statuses that count as DEFINITIVE. Everything else is provisional — the
   * fail-safe direction: a status we cannot vouch for is marked
   * ' (voorlopig cijfer)', never silently presented as definitive
   * (principle c). Consumed by isProvisionalStatus and run.ts's
   * freshest-Definitief freshness query. */
  definitiveStatuses: readonly string[];
  /** R11: verbatim valueAttribute → owner-approved Dutch null reason.
   * Unknown attributes render "door <displayName> gemarkeerd als '<attr>'" —
   * naming the raw marker rather than guessing a meaning. */
  nullReasonLabels: Readonly<Record<string, string>>;
  /** A6: the catalog-lifecycle statuses that count as "current" for the
   * finder's current-first shortlist quota. Consulted per row's source by
   * recall.ts via buildIsCurrentPredicate (src/catalog/current-status.ts) —
   * wired in WP30b, byte-identical to the old 'Regulier' literal for every
   * CBS row (pinned; find-replay's request hashes prove the shortlist never
   * moved). */
  currentCatalogStatuses: readonly string[];
}

/** The one registered source. Phase-0/1 ids are bare CBS ids; future sources
 * register '<sourcekey>:<native-id>' per ADR 030 D4. */
export const CBS_SOURCE_KEY = 'cbs' as const;

export const SOURCES: Readonly<Record<string, SourceInfo>> = {
  [CBS_SOURCE_KEY]: {
    key: CBS_SOURCE_KEY,
    displayName: 'CBS',
    attributionLabel: 'CBS StatLine',
    license: 'CC BY 4.0',
    // The table id rides VERBATIM — casing is load-bearing for CBS ids
    // ('03759ned' is lowercase at CBS itself; ingestion quirk #1).
    deepLink: (tableId: string) => `https://opendata.cbs.nl/statline/#/CBS/nl/dataset/${tableId}/table`,
    provisionalDisplay: {
      Voorlopig: ' (voorlopig cijfer)',
      NaderVoorlopig: ' (nader voorlopig cijfer)',
    },
    definitiveStatuses: ['Definitief'],
    nullReasonLabels: {
      Impossible: 'deze waarde kan volgens CBS niet voorkomen',
      Confidential: 'door CBS niet gepubliceerd (vertrouwelijk)',
      NotAvailable: 'door CBS (nog) niet beschikbaar gesteld',
    },
    currentCatalogStatuses: ['Regulier'],
  },
};

/** THE lookup (A1): absent → the 'cbs' entry (pre-WP30a rows carry no source
 * key); an unknown key ALSO falls back to 'cbs' rather than throwing —
 * display paths must never take an answer down, and no second key can exist
 * before WP30b's conformance contract registers one. */
export function resolveSource(key: string | undefined): SourceInfo {
  return (key !== undefined ? SOURCES[key] : undefined) ?? SOURCES[CBS_SOURCE_KEY]!;
}

/** The ADR 030 D4 rule as code: a table id owns its source identity via its
 * prefix — `'<sourcekey>:<native-id>'` for every non-CBS source, bare legacy
 * ids for CBS. The prefix is everything before the FIRST ':' (a native id may
 * itself contain colons). Pure derivation only — resolution (incl. the A1
 * unknown-key fallback) stays resolveSource's job. Migration 016's CHECK
 * makes this convention a database fact; the WP30b conformance harness (F1)
 * makes it an adapter-contract fact. */
export function sourceKeyForTableId(tableId: string): string {
  // NB a leading ':' derives the EMPTY key (unknown → display falls back to
  // cbs via resolveSource, ranking treats it as not-current, conformance F1
  // rejects it) — deliberately identical to the SQL derivation in
  // src/catalog/current-status.ts, pinned by test.
  const colon = tableId.indexOf(':');
  return colon >= 0 ? tableId.slice(0, colon) : CBS_SOURCE_KEY;
}

/** resolveSource by table id (D4 + A1 in one step). */
export function resolveSourceForTable(tableId: string): SourceInfo {
  return resolveSource(sourceKeyForTableId(tableId));
}

/** WP30b: THE provisional rule — a cell is provisional unless its verbatim
 * status is one the source declares definitive. Fail-safe direction: an
 * unknown/new status is MARKED provisional, never silently definitive
 * (principle c). Byte-identical to the pre-WP30b `status !== 'Definitief'`
 * for every CBS cell. */
export function isProvisionalStatus(info: SourceInfo, status: string): boolean {
  return !info.definitiveStatuses.includes(status);
}
