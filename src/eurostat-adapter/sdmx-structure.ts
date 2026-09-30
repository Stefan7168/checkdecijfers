// Eurostat structure reader (#357 study step 1; ADR 048 addendum "structure reader"): learns a dataset's
// layout from Eurostat's own SDMX 2.1 structure messages WITHOUT downloading a single observation —
// dimensions and their labels, the codes that actually occur, the GEO level of every geo code, the time span
// and the last-update date. Technique credited to cyanheads/eurostat-mcp-server (read, not copied; study doc
// section 1.2).
//
// Two messages, both verified live 2026-09-30 on une_rt_q, tipsbd30, prc_hicp_minr and namq_10_gdp (captured
// in tests/fixtures/eurostat-structure/):
//  - `dataflow/ESTAT/{CODE}/1.0?references=descendants&detail=referencepartial`: the dataflow (title,
//    annotations incl. UPDATE_DATA / OBS_PERIOD_OVERALL_*), its CURRENT data structure (dimensions in key
//    order), the concept names (dimension labels) and the PARTIAL code lists (only codes this dataset uses,
//    with English names and, on GEO, a LEVEL annotation: 0 = country, 1-3 = NUTS 1-3, AGG = aggregate).
//  - `contentconstraint/ESTAT/{CODE}/1.0`: the codes that actually occur, per dimension, incl. TIME_PERIOD.
//    Per dimension only — it never says whether one COMBINATION exists (that is known only after a fetch).
//
// Everything here is pure (no I/O). Unknown or malformed structure throws `EurostatStructureError`; a dataset
// that reads cleanly but does not fit today's rules gets a typed refusal (`EurostatLayoutRefusal`) — never a
// mapping by guesswork (principle c).
import type { CbsCode, CbsDimension, CbsMeasure, CbsTableSchema } from '../cbs-adapter/types.ts';
import {
  EU_EFTA_LICENSED_AGGREGATE_CODES,
  EU_EFTA_LICENSED_COUNTRY_CODES,
  EUROSTAT_DEFINITIVE_STATUS,
  mapEurostatPeriod,
} from './jsonstat.ts';
import { UnsupportedGrainError } from './types.ts';
import { childrenOf, onlyChild, optionalChild, parseXml, requiredAttribute, type XmlElement } from './xml.ts';

const NS_MESSAGE = 'http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message';
const NS_STRUCTURE = 'http://www.sdmx.org/resources/sdmxml/schemas/v2_1/structure';
const NS_COMMON = 'http://www.sdmx.org/resources/sdmxml/schemas/v2_1/common';

/** SDMX's time dimension id; our waist (and JSON-stat) call it `time`. */
const SDMX_TIME_ID = 'TIME_PERIOD';

export class EurostatStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EurostatStructureError';
  }
}

export type GeoLevel = 'country' | 'nuts1' | 'nuts2' | 'nuts3' | 'aggregate';

const LEVELS: Record<string, GeoLevel> = { '0': 'country', '1': 'nuts1', '2': 'nuts2', '3': 'nuts3', AGG: 'aggregate' };

export interface StructureCode {
  code: string;
  /** The English name; the code itself when Eurostat gives none (the JSON-stat path's rule — never invented). */
  label: string;
  /** The raw `LEVEL` annotation, when the code carries one (GEO only in practice). */
  levelAnnotation: string | null;
}

export interface StructureDimension {
  /** Our name: SDMX id, except `TIME_PERIOD` -> `time` (the JSON-stat and waist name). */
  name: string;
  position: number;
  isTime: boolean;
  /** The concept's English name ('' when none). */
  label: string;
  /** The codes that occur (content constraint), in the code list's order; time codes verbatim, no labels. */
  codes: StructureCode[];
}

export interface EurostatStructure {
  /** The dataset code as Eurostat spells it (upper case, e.g. `UNE_RT_Q`). */
  datasetCode: string;
  title: string;
  dataStructure: { id: string; version: string };
  /** In key order (the data structure's `position`). */
  dimensions: StructureDimension[];
  /** Selected dataflow annotations, verbatim; null when absent. */
  annotations: {
    updateData: string | null;
    updateStructure: string | null;
    obsCount: number | null;
    oldestPeriod: string | null;
    latestPeriod: string | null;
    plannedDissemination: string | null;
  };
}

// ---------------------------------------------------------------------------
// SDMX-ML helpers
// ---------------------------------------------------------------------------

function englishName(el: XmlElement): string | null {
  for (const n of childrenOf(el, NS_COMMON, 'Name')) {
    if (n.attributes['xml:lang'] === 'en') return n.text.trim();
  }
  return null;
}

function annotationsOf(el: XmlElement, context: string): { type: string; title: string | null }[] {
  const block = optionalChild(el, NS_COMMON, 'Annotations', context);
  if (block === null) return [];
  return childrenOf(block, NS_COMMON, 'Annotation').map((a) => ({
    type: optionalChild(a, NS_COMMON, 'AnnotationType', context)?.text.trim() ?? '',
    title: optionalChild(a, NS_COMMON, 'AnnotationTitle', context)?.text.trim() ?? null,
  }));
}

/** The one annotation of this type; absent -> null; two with different titles -> malformed. */
function annotationTitle(anns: { type: string; title: string | null }[], type: string, context: string): string | null {
  const titles = [...new Set(anns.filter((a) => a.type === type).map((a) => a.title))];
  if (titles.length > 1) throw new EurostatStructureError(`${context}: conflicting ${type} annotations (${titles.join(', ')})`);
  const t = titles[0];
  return t === undefined || t === null || t.length === 0 ? null : t;
}

function refOf(el: XmlElement, context: string): XmlElement {
  // SDMX-ML 2.1's `Ref` is unqualified (no namespace) — anything else is a shape we have not verified.
  return onlyChild(el, null, 'Ref', context);
}

function structureRoot(xml: string, what: string): XmlElement {
  const root = parseXml(xml);
  if (root.ns !== NS_MESSAGE || root.name !== 'Structure') {
    throw new EurostatStructureError(`${what}: expected an SDMX 2.1 <message:Structure>, got <${root.name}> (${root.ns ?? 'no namespace'})`);
  }
  return onlyChild(root, NS_MESSAGE, 'Structures', what);
}

/** Wraps the navigation helpers' plain Errors so every structural failure is one typed error. */
function asStructureError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof EurostatStructureError) throw err;
    throw new EurostatStructureError(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// The two messages
// ---------------------------------------------------------------------------

interface DataflowMessage {
  id: string;
  title: string;
  annotations: EurostatStructure['annotations'];
  dataStructure: { id: string; version: string };
  dimensions: { id: string; position: number; isTime: boolean; label: string; codelist: { id: string; version: string } | null }[];
  codelists: Map<string, Map<string, StructureCode>>;
}

function readDataflowMessage(xml: string, expectedCode: string): DataflowMessage {
  const ctx = `Eurostat dataflow ${expectedCode}`;
  const structures = structureRoot(xml, ctx);

  const flows = childrenOf(onlyChild(structures, NS_STRUCTURE, 'Dataflows', ctx), NS_STRUCTURE, 'Dataflow');
  if (flows.length !== 1) throw new EurostatStructureError(`${ctx}: expected exactly one Dataflow, found ${flows.length}`);
  const flow = flows[0]!;
  const id = requiredAttribute(flow, 'id', ctx);
  if (id.toUpperCase() !== expectedCode.toUpperCase()) {
    throw new EurostatStructureError(`${ctx}: the message describes dataflow '${id}', not '${expectedCode}'`);
  }
  const title = englishName(flow);
  if (!title) throw new EurostatStructureError(`${ctx}: the dataflow has no English name`);

  const anns = annotationsOf(flow, ctx);
  const obsCountRaw = annotationTitle(anns, 'OBS_COUNT', ctx);
  if (obsCountRaw !== null && !/^\d+$/.test(obsCountRaw)) {
    throw new EurostatStructureError(`${ctx}: OBS_COUNT '${obsCountRaw}' is not a count`);
  }
  const annotations: EurostatStructure['annotations'] = {
    updateData: annotationTitle(anns, 'UPDATE_DATA', ctx),
    updateStructure: annotationTitle(anns, 'UPDATE_STRUCTURE', ctx),
    obsCount: obsCountRaw === null ? null : Number(obsCountRaw),
    oldestPeriod: annotationTitle(anns, 'OBS_PERIOD_OVERALL_OLDEST', ctx),
    latestPeriod: annotationTitle(anns, 'OBS_PERIOD_OVERALL_LATEST', ctx),
    plannedDissemination: annotationTitle(anns, 'DISSEMINATION_TIMESTAMP_PLANNED', ctx),
  };

  const dsdRef = refOf(onlyChild(flow, NS_STRUCTURE, 'Structure', ctx), ctx);
  const dataStructure = { id: requiredAttribute(dsdRef, 'id', ctx), version: requiredAttribute(dsdRef, 'version', ctx) };
  const dsds = childrenOf(onlyChild(structures, NS_STRUCTURE, 'DataStructures', ctx), NS_STRUCTURE, 'DataStructure').filter(
    (d) => d.attributes.id === dataStructure.id && d.attributes.version === dataStructure.version,
  );
  if (dsds.length !== 1) {
    throw new EurostatStructureError(
      `${ctx}: expected the referenced data structure ${dataStructure.id}(${dataStructure.version}) once, found ${dsds.length}`,
    );
  }
  const components = onlyChild(dsds[0]!, NS_STRUCTURE, 'DataStructureComponents', ctx);
  const dimList = onlyChild(components, NS_STRUCTURE, 'DimensionList', ctx);

  // Concept names (dimension labels), by concept id; an id in two schemes is ambiguous.
  const conceptNames = new Map<string, string>();
  const conceptsBlock = optionalChild(structures, NS_STRUCTURE, 'Concepts', ctx);
  for (const scheme of conceptsBlock ? childrenOf(conceptsBlock, NS_STRUCTURE, 'ConceptScheme') : []) {
    for (const concept of childrenOf(scheme, NS_STRUCTURE, 'Concept')) {
      const cid = requiredAttribute(concept, 'id', ctx);
      if (conceptNames.has(cid)) throw new EurostatStructureError(`${ctx}: concept '${cid}' is defined twice`);
      conceptNames.set(cid, englishName(concept) ?? '');
    }
  }

  const dimensions: DataflowMessage['dimensions'] = [];
  for (const d of dimList.children) {
    if (d.ns !== NS_STRUCTURE || (d.name !== 'Dimension' && d.name !== 'TimeDimension')) {
      // A MeasureDimension (SDMX 2.1 cross-sectional) or anything else is a shape we have not verified.
      throw new EurostatStructureError(`${ctx}: unsupported component <${d.name}> in the dimension list`);
    }
    const did = requiredAttribute(d, 'id', ctx);
    const posRaw = requiredAttribute(d, 'position', ctx);
    if (!/^\d+$/.test(posRaw)) throw new EurostatStructureError(`${ctx}: dimension '${did}' has position '${posRaw}'`);
    const isTime = d.name === 'TimeDimension';
    if (isTime !== (did === SDMX_TIME_ID)) {
      throw new EurostatStructureError(`${ctx}: dimension '${did}' is ${isTime ? '' : 'not '}the time dimension — unexpected`);
    }
    const conceptId = requiredAttribute(refOf(onlyChild(d, NS_STRUCTURE, 'ConceptIdentity', ctx), ctx), 'id', ctx);
    const localRep = optionalChild(d, NS_STRUCTURE, 'LocalRepresentation', ctx);
    const enumeration = localRep ? optionalChild(localRep, NS_STRUCTURE, 'Enumeration', ctx) : null;
    let codelist: { id: string; version: string } | null = null;
    if (enumeration) {
      const ref = refOf(enumeration, ctx);
      codelist = { id: requiredAttribute(ref, 'id', ctx), version: requiredAttribute(ref, 'version', ctx) };
    } else if (!isTime) {
      throw new EurostatStructureError(`${ctx}: dimension '${did}' has no code list`);
    }
    dimensions.push({ id: did, position: Number(posRaw), isTime, label: conceptNames.get(conceptId) ?? '', codelist });
  }
  dimensions.sort((a, b) => a.position - b.position);
  if (new Set(dimensions.map((d) => d.id)).size !== dimensions.length) {
    throw new EurostatStructureError(`${ctx}: a dimension id appears twice`);
  }

  const codelists = new Map<string, Map<string, StructureCode>>();
  const codelistsBlock = optionalChild(structures, NS_STRUCTURE, 'Codelists', ctx);
  for (const cl of codelistsBlock ? childrenOf(codelistsBlock, NS_STRUCTURE, 'Codelist') : []) {
    const key = `${requiredAttribute(cl, 'id', ctx)}(${requiredAttribute(cl, 'version', ctx)})`;
    if (codelists.has(key)) throw new EurostatStructureError(`${ctx}: code list ${key} appears twice`);
    const codes = new Map<string, StructureCode>();
    for (const c of childrenOf(cl, NS_STRUCTURE, 'Code')) {
      const code = requiredAttribute(c, 'id', ctx);
      if (codes.has(code)) throw new EurostatStructureError(`${ctx}: code '${code}' appears twice in ${key}`);
      codes.set(code, {
        code,
        label: englishName(c) || code,
        levelAnnotation: annotationTitle(annotationsOf(c, ctx), 'LEVEL', `${ctx} code ${code}`),
      });
    }
    codelists.set(key, codes);
  }

  return { id, title, annotations, dataStructure, dimensions, codelists };
}

/** The content constraint: per dimension id, the values that occur (union over include-regions, first-seen
 * order). */
function readConstraintMessage(xml: string, expectedCode: string): Map<string, string[]> {
  const ctx = `Eurostat content constraint ${expectedCode}`;
  const structures = structureRoot(xml, ctx);
  const constraints = childrenOf(onlyChild(structures, NS_STRUCTURE, 'Constraints', ctx), NS_STRUCTURE, 'ContentConstraint');
  if (constraints.length !== 1) {
    throw new EurostatStructureError(`${ctx}: expected exactly one ContentConstraint, found ${constraints.length}`);
  }
  const constraint = constraints[0]!;
  if (constraint.attributes.type !== 'Actual') {
    throw new EurostatStructureError(`${ctx}: constraint type '${constraint.attributes.type ?? ''}' is not 'Actual'`);
  }
  const attachment = onlyChild(constraint, NS_STRUCTURE, 'ConstraintAttachment', ctx);
  const flowRef = refOf(onlyChild(attachment, NS_STRUCTURE, 'Dataflow', ctx), ctx);
  if (requiredAttribute(flowRef, 'id', ctx).toUpperCase() !== expectedCode.toUpperCase()) {
    throw new EurostatStructureError(`${ctx}: the constraint is attached to '${flowRef.attributes.id}', not '${expectedCode}'`);
  }

  const values = new Map<string, string[]>();
  const regions = childrenOf(constraint, NS_STRUCTURE, 'CubeRegion');
  if (regions.length === 0) throw new EurostatStructureError(`${ctx}: no CubeRegion`);
  for (const region of regions) {
    // An exclusion region would subtract values; we only read inclusion (the only kind measured).
    if ((region.attributes.include ?? 'true') !== 'true') {
      throw new EurostatStructureError(`${ctx}: an excluding CubeRegion is not read`);
    }
    for (const child of region.children) {
      if (child.ns !== NS_COMMON || child.name !== 'KeyValue') {
        throw new EurostatStructureError(`${ctx}: unsupported <${child.name}> in a CubeRegion`);
      }
      const dim = requiredAttribute(child, 'id', ctx);
      const list = values.get(dim) ?? [];
      for (const v of child.children) {
        if (v.ns !== NS_COMMON || v.name !== 'Value') {
          throw new EurostatStructureError(`${ctx}: unsupported <${v.name}> for '${dim}' (only explicit values are read)`);
        }
        const text = v.text.trim();
        if (text.length === 0) throw new EurostatStructureError(`${ctx}: an empty value for '${dim}'`);
        if (!list.includes(text)) list.push(text);
      }
      values.set(dim, list);
    }
  }
  return values;
}

/**
 * Reads a dataset's structure from its two SDMX-ML messages. `datasetCode` is the bare code (either case).
 * Throws `EurostatStructureError` (or `XmlParseError`) for anything malformed or unverified: a dimension the
 * constraint says nothing about, a constraint value with no code in the code list, a constraint dimension
 * the structure does not have, an empty dimension.
 */
export function readEurostatStructure(datasetCode: string, dataflowXml: string, constraintXml: string): EurostatStructure {
  return asStructureError(() => {
    const flow = readDataflowMessage(dataflowXml, datasetCode);
    const occurring = readConstraintMessage(constraintXml, datasetCode);
    const ctx = `Eurostat structure ${flow.id}`;

    for (const dim of occurring.keys()) {
      if (!flow.dimensions.some((d) => d.id === dim)) {
        throw new EurostatStructureError(`${ctx}: the constraint names dimension '${dim}', which the structure lacks`);
      }
    }

    const dimensions: StructureDimension[] = flow.dimensions.map((d) => {
      const values = occurring.get(d.id);
      if (values === undefined || values.length === 0) {
        throw new EurostatStructureError(`${ctx}: the constraint lists no values for dimension '${d.id}'`);
      }
      if (d.isTime) {
        return { name: 'time', position: d.position, isTime: true, label: d.label, codes: values.map((v) => ({ code: v, label: v, levelAnnotation: null })) };
      }
      const list = flow.codelists.get(`${d.codelist!.id}(${d.codelist!.version})`);
      if (list === undefined) {
        throw new EurostatStructureError(`${ctx}: code list ${d.codelist!.id}(${d.codelist!.version}) of '${d.id}' is not in the message`);
      }
      const missing = values.filter((v) => !list.has(v));
      if (missing.length > 0) {
        throw new EurostatStructureError(`${ctx}: '${d.id}' value(s) ${missing.slice(0, 5).join(', ')} are not in its code list`);
      }
      const occurs = new Set(values);
      const codes = [...list.values()].filter((c) => occurs.has(c.code));
      return { name: d.id, position: d.position, isTime: false, label: d.label, codes };
    });
    if (dimensions.some((d) => d.name === 'time' && !d.isTime)) {
      throw new EurostatStructureError(`${ctx}: a non-time dimension is named 'time'`);
    }

    return { datasetCode: flow.id, title: flow.title, dataStructure: flow.dataStructure, dimensions, annotations: flow.annotations };
  });
}

// ---------------------------------------------------------------------------
// Geo levels + the licence rule
// ---------------------------------------------------------------------------

/** Eurostat's own level for a geo code (the GEO code list's LEVEL annotation); null when absent or unknown. */
export function geoLevelOf(code: StructureCode): GeoLevel | null {
  return code.levelAnnotation === null ? null : (LEVELS[code.levelAnnotation] ?? null);
}

export type GeoExclusion = 'no_level' | 'not_licensed' | 'level_disagrees';

/**
 * ADR 048 D6's licence exclusion, as a code rule ON TOP of Eurostat's levels: a geo code is kept only when
 * Eurostat says it is a country and it is an EU/EFTA country, or Eurostat says it is an aggregate and it is
 * one of the reviewed EU/EFTA aggregates. A code without a level is never guessed; a licensed code whose level
 * disagrees with its list (a "country" Eurostat calls an aggregate) is excluded for review.
 */
export function licensedGeo(code: string, level: GeoLevel | null): { ok: true } | { ok: false; why: GeoExclusion } {
  if (level === null) return { ok: false, why: 'no_level' };
  const listedCountry = EU_EFTA_LICENSED_COUNTRY_CODES.has(code);
  const listedAggregate = EU_EFTA_LICENSED_AGGREGATE_CODES.has(code);
  if (!listedCountry && !listedAggregate) return { ok: false, why: 'not_licensed' };
  if ((listedCountry && level !== 'country') || (listedAggregate && level !== 'aggregate')) {
    return { ok: false, why: 'level_disagrees' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Fit gate + layout (today's rules, generic)
// ---------------------------------------------------------------------------

export type EurostatLayoutRefusalReason =
  | 'no_unit_dimension'
  | 'no_time_dimension'
  | 'unsupported_grain'
  | 'time_span_mismatch'
  | 'no_update_date'
  | 'no_licensed_geo'
  | 'decimals_unknown';

export interface EurostatLayoutRefusal {
  ok: false;
  reason: EurostatLayoutRefusalReason;
  summary: string;
}

export interface EurostatFit {
  ok: true;
  unitCodes: string[];
  /** Every time code mapped into the internal grammar, native -> internal. */
  periods: Map<string, string>;
  geo: {
    /** Level of every geo code the dataset uses (null = no/unknown LEVEL annotation). */
    levels: Record<string, GeoLevel | null>;
    licensed: string[];
    excluded: { code: string; why: GeoExclusion }[];
  } | null;
}

const SUPPORTED_FREQ = new Set(['A', 'Q', 'M']);

function refusal(reason: EurostatLayoutRefusalReason, summary: string): EurostatLayoutRefusal {
  return { ok: false, reason, summary };
}

/**
 * Does this dataset fit today's rules? (ADR 048 D6.) One measure per `unit` code, so a `unit` dimension is
 * required; a time dimension whose every period maps to A/Q/M (and a `freq` dimension, when present, holding
 * only A/Q/M); the constraint's time span agreeing with Eurostat's own OBS_PERIOD_OVERALL_* annotations
 * (the study's Assumption A1: checked, not trusted); an update date; and, when there is a `geo` dimension,
 * at least one licensed geo code. Pure; no decimals needed — the crawl uses this directly.
 */
export function fitEurostatStructure(tableId: string, structure: EurostatStructure): EurostatFit | EurostatLayoutRefusal {
  const dim = (name: string) => structure.dimensions.find((d) => d.name === name);

  const unit = dim('unit');
  if (!unit) {
    return refusal(
      'no_unit_dimension',
      `Eurostat dataset '${tableId}' has no 'unit' dimension — one measure per unit code is the rule, and a dataset ` +
        `without one is refused rather than mapped by guesswork (it has: ${structure.dimensions.map((d) => d.name).join(', ')}).`,
    );
  }
  const time = dim('time');
  if (!time) return refusal('no_time_dimension', `Eurostat dataset '${tableId}' has no time dimension.`);

  const freq = dim('freq');
  const badFreq = freq?.codes.filter((c) => !SUPPORTED_FREQ.has(c.code)).map((c) => c.code) ?? [];
  if (badFreq.length > 0) {
    return refusal(
      'unsupported_grain',
      `Eurostat dataset '${tableId}' publishes frequency ${badFreq.join(', ')}; only annual, quarterly and monthly are mapped (ADR 048 D6).`,
    );
  }
  const periods = new Map<string, string>();
  for (const c of time.codes) {
    try {
      periods.set(c.code, mapEurostatPeriod(c.code));
    } catch (err) {
      if (err instanceof UnsupportedGrainError) {
        return refusal('unsupported_grain', `Eurostat dataset '${tableId}': ${err.message}`);
      }
      throw err;
    }
  }

  // A1: the constraint's own time list must hold Eurostat's stated oldest and latest period, and (one grain)
  // end there. A disagreement means one of the two is stale — refused, never picked between.
  const native = time.codes.map((c) => c.code);
  const { oldestPeriod, latestPeriod } = structure.annotations;
  for (const [label, p] of [['oldest', oldestPeriod], ['latest', latestPeriod]] as const) {
    if (p !== null && !periods.has(p)) {
      return refusal(
        'time_span_mismatch',
        `Eurostat dataset '${tableId}': the ${label} period Eurostat states (${p}) is not in the content constraint's time list.`,
      );
    }
  }
  const grains = new Set([...periods.values()].map((p) => p.slice(4, 6)));
  if (grains.size === 1) {
    const sorted = [...native].sort((a, b) => periods.get(a)!.localeCompare(periods.get(b)!));
    if ((latestPeriod !== null && sorted.at(-1) !== latestPeriod) || (oldestPeriod !== null && sorted[0] !== oldestPeriod)) {
      return refusal(
        'time_span_mismatch',
        `Eurostat dataset '${tableId}': the content constraint runs ${sorted[0]}..${sorted.at(-1)}, Eurostat states ` +
          `${oldestPeriod ?? '?'}..${latestPeriod ?? '?'}.`,
      );
    }
  }

  if (structure.annotations.updateData === null) {
    return refusal('no_update_date', `Eurostat dataset '${tableId}' states no UPDATE_DATA date — staleness could never be told.`);
  }

  let geo: EurostatFit['geo'] = null;
  const geoDim = dim('geo');
  if (geoDim) {
    const levels: Record<string, GeoLevel | null> = {};
    const licensed: string[] = [];
    const excluded: { code: string; why: GeoExclusion }[] = [];
    for (const c of geoDim.codes) {
      const level = geoLevelOf(c);
      levels[c.code] = level;
      const verdict = licensedGeo(c.code, level);
      if (verdict.ok) licensed.push(c.code);
      else excluded.push({ code: c.code, why: verdict.why });
    }
    if (licensed.length === 0) {
      return refusal('no_licensed_geo', `Eurostat dataset '${tableId}' has no licensed (EU/EFTA) geo code.`);
    }
    geo = { levels, licensed, excluded };
  }

  return { ok: true, unitCodes: unit.codes.map((c) => c.code), periods, geo };
}

/** Per unit code, the number of decimals to register. No Eurostat structure message states it (verified: the
 * primary measure is a bare `Double`), so it must come from observed data; `undefined` refuses. */
export type EurostatDecimalsFor = (unitCode: string) => number | undefined;

export interface EurostatLayout {
  ok: true;
  schema: CbsTableSchema;
  codeLists: Record<string, CbsCode[]>;
  fit: EurostatFit;
}

function nativeIdFrom(tableId: string): string {
  const colon = tableId.indexOf(':');
  return colon >= 0 ? tableId.slice(colon + 1) : tableId;
}

/**
 * The waist's schema and code lists for a Eurostat dataset, from its structure alone — the same shapes the
 * JSON-stat path (`parseJsonStatDataset`) builds from a download: dimension names and kinds, the concept
 * label as title, `<code>|<unit>` measures titled "dataset title — unit label", `modified` = UPDATE_DATA
 * (the JSON-stat `updated` field carries the same value), time codes mapped with the published status, and
 * only licensed geo codes. The code lists are the WHOLE dataset's (every code that occurs), not a scope's.
 */
export function eurostatLayoutFromStructure(
  tableId: string,
  structure: EurostatStructure,
  decimalsFor: EurostatDecimalsFor,
): EurostatLayout | EurostatLayoutRefusal {
  const fit = fitEurostatStructure(tableId, structure);
  if (!fit.ok) return fit;
  const nativeCode = nativeIdFrom(tableId);
  if (nativeCode.toUpperCase() !== structure.datasetCode.toUpperCase()) {
    throw new EurostatStructureError(`Eurostat structure is for '${structure.datasetCode}', not '${tableId}'`);
  }

  const unitDim = structure.dimensions.find((d) => d.name === 'unit')!;
  const measures: CbsMeasure[] = [];
  for (const u of unitDim.codes) {
    const decimals = decimalsFor(u.code);
    if (decimals === undefined || !Number.isInteger(decimals) || decimals < 0) {
      return refusal(
        'decimals_unknown',
        `Eurostat dataset '${tableId}': no known number of decimals for unit '${u.code}' — Eurostat's structure does not ` +
          'state it, and a guess could round a published figure.',
      );
    }
    measures.push({
      code: `${nativeCode}|${u.code}`,
      title: `${structure.title} — ${u.label}`,
      unit: u.label,
      decimals,
      description: '',
      dataType: '',
      groupPath: [],
    });
  }

  const coordinateDims = structure.dimensions.filter((d) => d.name !== 'unit');
  const dimensions: CbsDimension[] = coordinateDims.map((d) => ({
    name: d.name,
    kind: d.isTime ? 'TimeDimension' : d.name === 'geo' ? 'GeoDimension' : 'Dimension',
    title: d.label,
  }));

  const licensedGeoCodes = new Set(fit.geo?.licensed ?? []);
  const codeLists: Record<string, CbsCode[]> = {};
  for (const d of coordinateDims) {
    if (d.isTime) {
      const ordered = [...d.codes].sort((a, b) => fit.periods.get(a.code)!.localeCompare(fit.periods.get(b.code)!));
      codeLists[d.name] = ordered.map((c, i) => ({
        code: fit.periods.get(c.code)!,
        title: c.code,
        dimensionGroup: null,
        status: EUROSTAT_DEFINITIVE_STATUS,
        index: i,
      }));
    } else {
      const kept = d.name === 'geo' ? d.codes.filter((c) => licensedGeoCodes.has(c.code)) : d.codes;
      codeLists[d.name] = kept.map((c, i) => ({ code: c.code, title: c.label, dimensionGroup: null, status: null, index: i }));
    }
  }

  const schema: CbsTableSchema = {
    tableId,
    title: structure.title,
    dimensions,
    measures,
    modified: structure.annotations.updateData,
  };
  return { ok: true, schema, codeLists, fit };
}

/** Thrown by the adapter's structure-layout mode when a dataset does not fit (the typed refusal, loud). */
export class EurostatLayoutRefusalError extends Error {
  readonly reason: EurostatLayoutRefusalReason;
  constructor(refused: EurostatLayoutRefusal) {
    super(refused.summary);
    this.name = 'EurostatLayoutRefusalError';
    this.reason = refused.reason;
  }
}
