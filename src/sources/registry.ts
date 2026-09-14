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
  /** WP30c/E1 (ADR 048 D3(b)/(c) integration fix, found in this brief's
   * whole-branch pass, not by either adversarial review round): whether this
   * source may appear as a selectable chip in the LIVE chat UI (WP129+130,
   * `web/components/chat.tsx`'s `Object.keys(SOURCES).map(...)`). That chip
   * row iterates every REGISTERED source with no other gate — a new registry
   * entry alone, with zero other code touched, would surface a brand-new
   * source (and PRE-select it, matching the WP129 default-all-on behavior)
   * to every real user, which is exactly the "never announced before it
   * answers" rule D3 exists to enforce. `false` here is therefore load-
   * bearing, not decorative: it is the ONLY thing keeping a registered-but-
   * dormant source out of the public chat UI. Flip to `true` only in the
   * source's own owner-signed E2/public sweep (D3(d)), in the same change
   * that makes it actually answerable. */
  chatSelectable: boolean;
}

/** The one registered source. Phase-0/1 ids are bare CBS ids; future sources
 * register '<sourcekey>:<native-id>' per ADR 030 D4. */
export const CBS_SOURCE_KEY = 'cbs' as const;

/** WP30c/E1 (ADR 048 D4): Eurostat ids are '<eurostat>:<code>'. */
export const EUROSTAT_SOURCE_KEY = 'eurostat' as const;

/** D4/registry-owned (never the caller's job): strips a '<key>:' prefix to
 * recover the native id Eurostat's own data-browser expects. Deliberately
 * generic over the first colon rather than hardcoding 'eurostat:' — matches
 * sourceKeyForTableId's own derivation below, so a deep link never drifts
 * from the id-parsing rule the rest of the registry already enforces. */
function nativeIdFrom(tableId: string): string {
  const colon = tableId.indexOf(':');
  return colon >= 0 ? tableId.slice(colon + 1) : tableId;
}

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
    chatSelectable: true,
  },
  // WP30c/E1 (ADR 048 D6/D7, this brief's Task 2; Amendment B1 folded in):
  // second source, registered but E1-inert for everything Constraint 0 or
  // the pipeline.ts per-period status shape blocks — see the two field-level
  // comments below before changing either.
  [EUROSTAT_SOURCE_KEY]: {
    key: EUROSTAT_SOURCE_KEY,
    displayName: 'Eurostat',
    attributionLabel: 'Eurostat',
    license: 'CC BY 4.0',
    // Links the dataset's stable data-browser TABLE view (D6), mirroring the
    // CBS choice to link the table rather than an unstable cell deep-link.
    // nativeIdFrom strips the 'eurostat:' identity prefix internally — per
    // D4 this is the registry's own job, never the caller's.
    deepLink: (tableId: string) => `https://ec.europa.eu/eurostat/databrowser/view/${nativeIdFrom(tableId)}/default/table`,
    // ADR 048 D6's verbatim observation-flag list, mapped to Dutch suffixes
    // matching the CBS entries' register above. Amendment 11: owner sign-off
    // on the exact wording is still OPEN (see docs/open-questions.md) —
    // routine, not a build blocker, since this is display-only (R11).
    //
    // Per Amendment B1: this map is INERT in E1. Nothing today can key into
    // it per-cell — pipeline.ts's `status` column is derived only from a
    // per-PERIOD-code lookup (the CBS shape; see isProvisionalStatus below
    // and definitiveStatuses' own comment), so no Eurostat cell's per-cell
    // flag ever reaches this lookup yet. Kept only as forward documentation
    // for when a real per-cell status mechanism exists (a scoped pipeline.ts
    // change, tracked as a residual in the WP30c/E1 brief).
    provisionalDisplay: {
      p: ' (voorlopig cijfer)',
      e: ' (schatting)',
      s: ' (schatting door Eurostat)',
      f: ' (prognose)',
      b: ' (methodebreuk)',
      c: ' (vertrouwelijk)',
      d: ' (afwijkende definitie)',
      u: ' (lage betrouwbaarheid)',
      n: ' (niet significant)',
    },
    // Amendment B1 (HIGH, confirmed): deliberately EMPTY, NOT `['']` as D6's
    // literal text says. D6 assumed the unflagged state ('') reaches
    // isProvisionalStatus as a per-cell status, but pipeline.ts's `status`
    // column has no per-cell path at all — only periodStatusByCode's
    // per-PERIOD-code lookup (the CBS shape). An empty list makes
    // isProvisionalStatus return true UNCONDITIONALLY for every Eurostat
    // cell, regardless of what periodStatusByCode produces: every cell
    // renders provisional. This is the safe fail-direction (principle c) —
    // over-cautious, never under — and needs no pipeline.ts change. Real
    // per-cell provisional propagation is a follow-up, scoped pipeline.ts
    // change (tracked as a residual in the WP30c/E1 brief), required before
    // any Eurostat cell may honestly render as definitive.
    definitiveStatuses: [],
    // D6's null-reason flags (R11), Dutch wording matching the CBS entries'
    // register above (owner sign-off open, same Amendment 11 as above).
    nullReasonLabels: {
      ':': 'door Eurostat (nog) niet beschikbaar gesteld',
      c: 'door Eurostat niet gepubliceerd (vertrouwelijk)',
      z: 'niet van toepassing volgens Eurostat',
    },
    // TODO(WP30c/E1 Constraint 0): Eurostat's Catalogue API "current"
    // lifecycle status is genuinely unknown without a live catalog call,
    // which this session cannot make. Left EMPTY rather than guessed.
    // Verified this degrades gracefully, not silently wrong: in
    // src/catalog/current-status.ts, buildIsCurrentPredicate's generated
    // SQL is `coalesce(status, '') = any($n::text[])` against this exact
    // array — an empty array makes `= any(...)` false for every row, same
    // as the `else false` fallback the same file uses for an unregistered
    // source key. Every Eurostat catalog row is "not current" until the
    // owner's first live catalog capture fills this in.
    currentCatalogStatuses: [],
    // D3(b)/(c) (this brief's integration fix): NEVER true in E1 — this is
    // the sole gate keeping "Eurostat data" out of the live chat chip row
    // (see the field's own doc comment above). Flips only in E2's
    // owner-signed sweep, in the same change that makes Eurostat answerable.
    chatSelectable: false,
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
