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
   * COUNT as provisional stays run.ts's rule (status !== 'Definitief') —
   * byte-identical in WP30a, adapter-contract material in WP30b. */
  provisionalDisplay: Readonly<Record<string, string>>;
  /** R11: verbatim valueAttribute → owner-approved Dutch null reason.
   * Unknown attributes render "door <displayName> gemarkeerd als '<attr>'" —
   * naming the raw marker rather than guessing a meaning. */
  nullReasonLabels: Readonly<Record<string, string>>;
  /** A6 (field only in WP30a): the catalog-lifecycle statuses that count as
   * "current" for the finder's Regulier-first shortlist quota. recall.ts
   * keeps its literal 'Regulier' until WP30b wires this in with the
   * conformance contract test — wiring it now would touch fixture-load-
   * bearing ranking SQL for zero observable benefit. */
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
