// Breadth step 5, Task 2 — planTableLane: the table lane's ONE tagged outcome
// (plan docs/superpowers/plans/2026-09-29-breadth-step-5-table-lane-wiring.md,
// Task 2; open-questions #339 (6)).
//
// Turns a question + ONE CBS table's live schema into exactly one of:
//   refuse — a typed reason (principle c: missing/ambiguous/unservable is
//            never guessed),
//   ask    — one button question (a breakdown or a region), with the FULL
//            member count,
//   fetch  — the slice to ensure (SliceRequest) + the explicit-target
//            StructuredIntent the query layer runs over the stored cells.
// It is the safety core of the lane: every gate the table parser, the bridge
// and the breakdown resolver expose — the confidence threshold, 'geen', the
// periodGrainUnavailable FLAG (places throw, the grain only flags), region
// classes, 'anders' — is applied HERE, in one fixed order, so no caller can
// forget one. Each step's failure is the plan's outcome; later steps never
// run.
//
// 2026-10-01 (#340, #342 (b)): a region class is no longer refused outright —
// step 10 resolves it over the table's ONE GeoDimension with the curated
// rules and the query layer's own roster rule, and the intent carries it as
// `regionSet` (one period only). The periods now_vs_ago, date_range and
// relative resolve with the curated rules (periods.ts), and the derivation
// follows the curated normalization (step 11b, period-rules.ts) instead of
// the model's raw hint. change_over_year stays refused (periods.ts).
//
// Principle (a): the LLM (tableParse) only ever chooses codes from the
// table's own lists; every code in the result is re-checked against the
// table's full code lists (bridge, resolver, region + period resolvers). No
// number is produced or read here. Principle (b): no CBS contact and no db —
// the caller (the job) fetched `table` and does the slice fetch afterwards.
//
// Binding rulings (plan Global Constraints, verbatim):
//   - "`measureCode === null` ('geen') is refused BEFORE `namedFromParse` is
//     ever called."
//   - "`periodGrainUnavailable === true` is a refusal, not a warning."
//   - "`confidence < DEFAULT_TABLE_PARSE_CONFIG.acceptThreshold` is a refusal
//     (reason `table_lane_unsure`), never a guess."
//   - "An `anders` choice becomes a question for that dimension's FULL member
//     list, never the total."
//   - "A typed reply to a breakdown question is matched against ALL members of
//     that dimension from `dimension_labels` (normalized exact title match, or
//     exact code); no match → the same question again, free; never a nearest
//     match." (Task 5 does the matching; this module re-checks every stored
//     choice against the code lists and THROWS on a mismatch — a caller bug.)
//
// "Nederland" on a national-only table (Settled design choice 5): the table
// parser's validator refuses ANY named place on a table without a region
// dimension or region-coded member (TableParseRegionUnavailableError) — so the
// absorption rule could never be reached after it. On exactly that table
// shape, and only for "Nederland"/"heel Nederland" terms, the SAME model
// output is re-validated without those terms (`absorbNationalTerms`); every
// other check runs unchanged, any other place still refuses, and the dropped
// terms go on to resolveTableRegions, which applies the "Caribisch" title
// guard and records "Regio: Nederland (landelijke tabel)". The parser module
// itself is untouched (prompt + validator bytes unchanged).
import { SLICE_MAX_CELLS, type SliceRequest } from '../../ingestion/slice-cache.ts';
import {
  classifyDimension,
  dimensionLabel,
  resolveBreakdowns,
  toQuestion,
  type BreakdownDimension,
  type BreakdownQuestion,
  type DimensionClass,
  type StatedDefault,
} from '../../query/breakdowns.ts';
import { contiguousPeriodCodes } from '../../query/resolve.ts';
import { INTENT_SCHEMA_VERSION, type IntentPeriod, type StructuredIntent } from '../../query/types.ts';
import type { LlmClient, LlmRequest, LlmResponse } from '../llm/client.ts';
import { requestHash } from '../llm/client.ts';
import type { RegionTerm } from '../intent/types.ts';
import {
  buildTableParseSchema,
  EUROSTAT_FREQ_BY_GRAIN,
  EUROSTAT_FREQ_DIMENSION,
  TableParseIneligibleTableError,
  totalRuleFor,
  type TableParseSchema,
} from '../table-parse/input.ts';
import {
  DEFAULT_TABLE_PARSE_CONFIG,
  TableParseRegionUnavailableError,
  TableParseValidationError,
  tableParse,
  tableParsePrefilterText,
  validateTableParseOutput,
  type TableParseAudit,
  type TableParseResult,
} from '../table-parse/parse.ts';
import { namedFromParse } from '../table-parse/bridge.ts';
import { REGION_MEMBER_CODE } from '../table-parse/places.ts';
import { normalizeDerivation } from '../intent/period-rules.ts';
import { resolveTablePeriod, trailingPeriods } from './periods.ts';
import { parsePeriodCode } from '../../ingestion/periods.ts';
import {
  isNationalTerm,
  resolveTableRegionClass,
  resolveTableRegions,
  type TableRegionClassResolution,
  type TableRegionResolution,
} from './regions.ts';
import type { TableLaneChoice, TableLaneTable } from './types.ts';
import type { TableLaneSelection } from './selection-note.ts';

export { selectionNote, type TableLaneSelection } from './selection-note.ts';

export type TableLaneRefusalReason =
  | 'table_lane_ineligible' // TableParseIneligibleTableError, or registerSchemaOnly refused (Task 4)
  | 'table_lane_no_measure' // parse 'geen'
  | 'table_lane_unsure' // confidence below threshold, or TableParseValidationError / AmbiguousMeasure
  | 'table_lane_period_unsupported'
  | 'table_lane_period_grain' // periodGrainUnavailable, or the resolver finds the grain absent
  | 'table_lane_period_missing'
  | 'table_lane_region_class'
  | 'region_unknown'
  | 'region_unavailable' // TableParseRegionUnavailableError, the Caribisch/geo+coded-member rules
  | 'table_lane_too_large' // slice > SLICE_MAX_CELLS
  | 'table_lane_single_period' // a series/difference over one period (2026-10-01)
  | 'cbs_unreachable' // Task 4 only
  | 'table_lane_failed'; // Task 4 only (give-up)

export type TableLanePlan =
  /** `parse` is null on the step-1/2 refusals (no validated result);
   * `parseAudit` is null only when no model call happened (step 1) — Ruling R6. */
  | {
      kind: 'refuse';
      reason: TableLaneRefusalReason;
      detail: string;
      latestPeriodCode?: string;
      parse: TableParseResult | null;
      parseAudit: TableParseAudit | null;
    }
  | { kind: 'ask'; question: BreakdownQuestion; parse: TableParseResult; parseAudit: TableParseAudit; offered: TableParseSchema }
  | {
      kind: 'fetch';
      slice: SliceRequest;
      intent: StructuredIntent;
      selection: TableLaneSelection;
      parse: TableParseResult;
      parseAudit: TableParseAudit;
      offered: TableParseSchema;
    };

export type { TableLaneTable } from './types.ts';

/** Wraps the caller's client so the one response is still at hand when the
 * validator throws — the step-2 refusals keep its audit (Ruling R6) and the
 * "Nederland" re-validation needs it. */
function recordingClient(client: LlmClient): { client: LlmClient; last: () => { request: LlmRequest; response: LlmResponse } | null } {
  let last: { request: LlmRequest; response: LlmResponse } | null = null;
  return {
    client: {
      async complete(request: LlmRequest): Promise<LlmResponse> {
        const response = await client.complete(request);
        last = { request, response };
        return response;
      },
    },
    last: () => last,
  };
}

/** The audit of the one recorded call — field for field what tableParse
 * itself returns (parse.ts). Ruling R6: kept on EVERY outcome where a model
 * call happened, step-2 refusals included. */
function auditOf(call: { request: LlmRequest; response: LlmResponse } | null): TableParseAudit | null {
  if (call === null) return null;
  return {
    requestHash: requestHash(call.request),
    model: call.response.model,
    usage: call.response.usage,
    outputText: call.response.outputText,
  };
}

/**
 * Settled design choice 5, parser side (see the module doc): re-validates the
 * model's own output with its "Nederland"/"heel Nederland" region terms
 * removed. Returns null — the caller then refuses `region_unavailable` as
 * before — when there is no such term to remove, or the output still fails
 * validation without them (another place, a region class). The returned
 * result carries the model's FULL region list back (so resolveTableRegions
 * sees the absorbed terms and applies the Caribisch guard), and the audit is
 * the one real call's (raw output unchanged).
 */
function absorbNationalTerms(
  error: TableParseRegionUnavailableError,
  offered: TableParseSchema,
  call: { request: LlmRequest; response: LlmResponse } | null,
): { result: TableParseResult; audit: TableParseAudit } | null {
  if (call === null || call.response.outputText !== error.outputText) return null;
  let data: { regions?: unknown };
  try {
    data = JSON.parse(error.outputText) as { regions?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(data.regions)) return null;
  const regions = data.regions as RegionTerm[];
  const kept = regions.filter((t) => !isNationalTerm(t));
  if (kept.length === regions.length) return null;
  let result: TableParseResult;
  try {
    result = validateTableParseOutput(JSON.stringify({ ...data, regions: kept }), offered);
  } catch (e) {
    if (e instanceof TableParseValidationError) return null;
    throw e;
  }
  return { result: { ...result, regions }, audit: auditOf(call)! };
}

export async function planTableLane(input: {
  question: string;
  /** The previous table-lane question in the same conversation (a follow-up
   * — Task 7): it reaches the parser's user turn (prompt version 3) and the
   * member pre-filter. Null ⇒ the version-2 request, byte-identical. */
  previousQuestion: string | null;
  table: TableLaneTable;
  /** Reader answers from earlier button rounds. */
  choices: TableLaneChoice[];
  /** YYYY-MM-DD. */
  referenceDate: string;
  client: LlmClient;
}): Promise<TableLanePlan> {
  const { question, previousQuestion, table, choices, referenceDate } = input;
  const { schema, codeLists } = table;

  const refuse = (
    reason: TableLaneRefusalReason,
    detail: string,
    parse: TableParseResult | null,
    parseAudit: TableParseAudit | null,
    latestPeriodCode?: string,
  ): TableLanePlan => ({
    kind: 'refuse',
    reason,
    detail,
    ...(latestPeriodCode !== undefined ? { latestPeriodCode } : {}),
    parse,
    parseAudit,
  });

  // --- 1. The table's closed menu -----------------------------------------------
  let offered: TableParseSchema;
  try {
    // Task 7: a follow-up's pre-filter also reads the previous question, so a
    // member only that question named stays in the menu the model may carry
    // over (tableParsePrefilterText returns `question` itself when null).
    offered = buildTableParseSchema(schema, codeLists, tableParsePrefilterText(question, previousQuestion));
  } catch (e) {
    if (e instanceof TableParseIneligibleTableError) return refuse('table_lane_ineligible', e.message, null, null);
    throw e;
  }

  // Full (never pre-filtered) dimensions — every code list exists (step 1
  // refuses a missing one).
  // Session 153 (Eurostat study step 4): a Eurostat table's totals follow
  // Eurostat's convention; a CBS table carries no marker (byte-identical).
  const totalRule = totalRuleFor(schema.tableId);
  const fullDims: BreakdownDimension[] = schema.dimensions.map((d) => ({
    name: d.name,
    title: d.title,
    kind: d.kind,
    members: codeLists[d.name]!.map((c) => ({ code: c.code, title: c.title })),
    ...(totalRule !== undefined ? { totalRule } : {}),
  }));
  const classOf = new Map<string, DimensionClass>(fullDims.map((d) => [d.name, classifyDimension(d)]));
  const timeDim = fullDims.find((d) => classOf.get(d.name) === 'time')!;
  const regionDims = fullDims.filter((d) => classOf.get(d.name) === 'geo' || classOf.get(d.name) === 'geo_like');
  const regionDimNames = new Set(regionDims.map((d) => d.name));
  const hasRegionCodedBreakdownMember = fullDims.some(
    (d) =>
      (classOf.get(d.name) === 'breakdown' || classOf.get(d.name) === 'margins') &&
      d.members.some((m) => REGION_MEMBER_CODE.test(m.code)),
  );
  const nationalOnly = regionDims.length === 0 && !hasRegionCodedBreakdownMember;

  // --- 2. The table-scoped parse ------------------------------------------------
  const recorder = recordingClient(input.client);
  let result: TableParseResult;
  let parseAudit: TableParseAudit;
  try {
    const outcome = await tableParse(question, offered, { client: recorder.client, previousQuestion });
    result = outcome.result;
    parseAudit = outcome.audit;
  } catch (e) {
    if (e instanceof TableParseRegionUnavailableError) {
      const absorbed = nationalOnly ? absorbNationalTerms(e, offered, recorder.last()) : null;
      if (absorbed === null) return refuse('region_unavailable', e.message, null, auditOf(recorder.last()));
      result = absorbed.result;
      parseAudit = absorbed.audit;
    } else if (e instanceof TableParseValidationError) {
      // Includes TableParseAmbiguousMeasureError.
      return refuse('table_lane_unsure', e.message, null, auditOf(recorder.last()));
    } else {
      throw e; // Task 4 treats it as a retryable failure.
    }
  }

  // --- 3. 'geen' — BEFORE the confidence check and namedFromParse ------------------
  // Session 153: a 'geen' parse reports a LOW confidence (it is the model's
  // confidence in a match, and there is none), so checking confidence first
  // turned every honest "this table has no such figure" into the vaguer
  // "not sure which figure you mean". Both refuse; this one says why.
  if (result.measureCode === null) {
    return refuse('table_lane_no_measure', 'no measure in this table answers the question', result, parseAudit);
  }

  const measureCode = result.measureCode;

  // --- 5. Period grain: a refusal, not a warning ------------------------------------
  if (result.periodGrainUnavailable) {
    return refuse(
      'table_lane_period_grain',
      `the question's period precision is not published by this table (has: ${offered.periodGrains.join(', ') || 'none'})`,
      result,
      parseAudit,
    );
  }

  // --- 5b. Period availability, then confidence --------------------------------------
  // Session 153: the deterministic period refusals (period not in the table,
  // a period shape it cannot serve) win over the confidence gate, the same
  // way 'geen' does — "CBS has no 2030 figure" says why, "not sure what you
  // mean" does not. resolveTablePeriod reads only the parsed period and the
  // table's own time codes, so it can run here; step 11 reuses its result.
  let period = resolveTablePeriod(result.period, codeLists[timeDim.name]!, referenceDate);
  if (!period.ok) return refuse(period.reason, period.detail, result, parseAudit, period.latestPeriodCode);

  // --- 5c. Confidence ---------------------------------------------------------------------
  if (result.confidence < DEFAULT_TABLE_PARSE_CONFIG.acceptThreshold) {
    return refuse(
      'table_lane_unsure',
      `parse confidence ${result.confidence} is below ${DEFAULT_TABLE_PARSE_CONFIG.acceptThreshold}`,
      result,
      parseAudit,
    );
  }

  // --- 6. Region classes: resolved at step 10 (#340, 2026-10-01) ------------------------
  // A class ("per provincie", "welke gemeente in Utrecht …") is no longer
  // refused here: step 10 resolves it with the curated rules over this
  // table's own dimension groups (regions.ts resolveTableRegionClass).

  // --- 7. Reader choices from earlier button rounds -------------------------------------
  const offeredNames = new Set(offered.breakdowns.map((b) => b.name));
  const breakdowns = { ...result.breakdowns };
  const extraNamed: Record<string, string> = {};
  const readerNamed: Record<string, string> = {};
  const regionChoices: TableLaneChoice[] = [];
  for (const choice of choices) {
    const dim = fullDims.find((d) => d.name === choice.dimension);
    if (!dim) {
      throw new Error(`planTableLane: choice for '${choice.dimension}', which is not a dimension of table '${schema.tableId}'`);
    }
    if (!dim.members.some((m) => m.code === choice.code)) {
      throw new Error(
        `planTableLane: choice '${choice.code}' is not a member of '${choice.dimension}' on table '${schema.tableId}' — ` +
          'choices are validated against the full member list before they are stored',
      );
    }
    const cls = classOf.get(dim.name)!;
    if (cls === 'time') {
      throw new Error(`planTableLane: choice for the time dimension '${dim.name}' — periods are never a button choice`);
    }
    if (regionDimNames.has(dim.name)) {
      regionChoices.push(choice);
    } else if (offeredNames.has(dim.name)) {
      breakdowns[dim.name] = { kind: 'member', code: choice.code };
      // Session 153: the reader's own click is named as-is — the bridge's
      // "a total pick is left to the resolver" rule is for the MODEL's
      // picks only; applying it to a clicked "Totaal leeftijd" asked the
      // same question again.
      readerNamed[dim.name] = choice.code;
    } else {
      // A non-offered plain dimension (margins) the resolver asked about.
      extraNamed[dim.name] = choice.code;
    }
  }
  const parseWithChoices: TableParseResult = { ...result, breakdowns };

  // --- 8. Bridge: 'anders' → a question over the FULL member list ---------------------
  const bridged = namedFromParse(parseWithChoices, offered, fullDims);
  if (!bridged.ok) {
    const dim = fullDims.find((d) => d.name === bridged.askDimension)!;
    return { kind: 'ask', question: toQuestion(dim), parse: result, parseAudit, offered };
  }
  const named: Record<string, string> = { ...bridged.named, ...extraNamed, ...readerNamed };
  // Session 153 (Eurostat study step 4): a Eurostat `freq` follows the resolved
  // period's grain; a table that does not publish that frequency is refused,
  // never answered from a different one.
  const freqDim = totalRule === 'eurostat' ? fullDims.find((d) => d.name === EUROSTAT_FREQ_DIMENSION) : undefined;
  if (freqDim !== undefined) {
    const grain = parsePeriodCode(period.codes[0]!)?.grain;
    const wanted = grain !== undefined ? EUROSTAT_FREQ_BY_GRAIN[grain] : undefined;
    if (wanted === undefined || !freqDim.members.some((m) => m.code === wanted)) {
      return refuse(
        'table_lane_period_grain',
        `the question's period grain (${grain ?? 'unknown'}) has no '${EUROSTAT_FREQ_DIMENSION}' code in this Eurostat table`,
        result,
        parseAudit,
      );
    }
    named[freqDim.name] = wanted;
  }

  // --- 9. Breakdown resolver: CBS's own unique total, or ask ----------------------------
  const resolved = resolveBreakdowns(fullDims, named);
  if (!resolved.ok) return { kind: 'ask', question: resolved.question, parse: result, parseAudit, offered };
  for (const dimName of resolved.callerDimensions) {
    if (dimName !== timeDim.name && !regionDimNames.has(dimName)) {
      throw new Error(`planTableLane: resolver left '${dimName}' to the caller, which is neither the time nor a region dimension`);
    }
  }

  // --- 10. Regions ------------------------------------------------------------------------
  // A region class first (#340): the class becomes the query layer's
  // additive `regionSet`, its CBS roster the slice's region members; named
  // places next to a class win (the curated rule) and fall through to the
  // plain place resolver below.
  let regionClass: Extract<TableRegionClassResolution, { kind: 'class' }> | null = null;
  if (result.regionScope !== null) {
    const cls = await resolveTableRegionClass({
      scope: result.regionScope,
      terms: result.regions,
      table,
      regionDims,
      hasRegionCodedBreakdownMember,
      choices: regionChoices,
    });
    if (cls.kind === 'ask') return { kind: 'ask', question: cls.question, parse: result, parseAudit, offered };
    if (cls.kind === 'refuse') return refuse(cls.reason, cls.detail, result, parseAudit);
    if (cls.kind === 'class') regionClass = cls;
  }
  const regions: TableRegionResolution =
    regionClass !== null
      ? { ok: true, coordinates: { [regionClass.dimension]: regionClass.codes }, defaults: [], named: [] }
      : resolveTableRegions({
          terms: result.regions,
          regionScope: null,
          table,
          regionDims,
          hasRegionCodedBreakdownMember,
          choices: regionChoices,
        });
  if (!regions.ok) {
    if ('question' in regions) return { kind: 'ask', question: regions.question, parse: result, parseAudit, offered };
    return refuse(regions.reason, regions.detail, result, parseAudit);
  }
  // resolveIntent reads ONE GeoDimension (src/query/resolve.ts); a second one
  // could never carry its coordinate in the intent. Checked here, with the
  // other region checks, so no later step's reason (e.g. too_large) shadows it.
  const geoDims = regionDims.filter((d) => classOf.get(d.name) === 'geo');
  if (geoDims.length > 1) {
    return refuse('region_unavailable', `table '${schema.tableId}' has ${geoDims.length} GeoDimensions`, result, parseAudit);
  }

  // --- 11. Period (resolved at step 5b) ---------------------------------------------------
  if (regionClass !== null && period.codes.length !== 1) {
    // The query layer answers a class for ONE period (ADR 054's one varying
    // axis); refused here, before any fetch, rather than after one.
    return refuse(
      'table_lane_region_class',
      `the region class '${regionClass.scope.kind}' is answered for one period at a time; the question spans ${period.codes.length}`,
      result,
      parseAudit,
    );
  }

  // --- 11b. Derivation: the curated rules (src/answer/intent/period-rules.ts) --------------
  // The period spec outranks the model's hint (a range/since/last_n is a
  // series, a multi-month date range too); a date range that collapsed to ONE
  // period code at this table's grain keeps the model's own hint (the
  // curated collapse rule); a series or difference over a single period can
  // never execute — refused before any fetch (principle c).
  let derivation = normalizeDerivation(result.period, result.derivation);
  if (result.period.kind === 'date_range' && derivation !== result.derivation && period.codes.length < 2) {
    derivation = result.derivation;
  }
  // Session 153 (owner, comparing with ChatGPT's trend table): a plain
  // "how many" that names NO period (the period was defaulted to the latest)
  // shows the latest figure WITH the periods before it — a series ending at
  // the latest (TREND_CONTEXT_PERIODS), drawn as a line chart, every value a
  // CBS cell. A question that names a period keeps exactly that period; a
  // comparison of several places or a region class stays one period.
  const oneCoordinateEach = Object.values(regions.coordinates).every((c) => c.length <= 1);
  if (derivation === 'none' && period.defaulted !== null && period.codes.length === 1 && regionClass === null && oneCoordinateEach) {
    const trend = trailingPeriods(codeLists[timeDim.name]!, period.codes[0]!);
    if (trend.length >= 2) {
      const titleOf = (code: string) => codeLists[timeDim.name]!.find((c) => c.code === code)?.title ?? code;
      period = {
        ...period,
        codes: trend,
        defaulted: { code: period.defaulted.code, label: `${titleOf(trend[0]!)} t/m ${titleOf(trend[trend.length - 1]!)}` },
      };
      derivation = 'series';
    }
  }
  if ((derivation === 'series' || derivation === 'difference') && period.codes.length < 2) {
    return refuse(
      'table_lane_single_period',
      `derivation '${derivation}' needs more than one period, but the question resolves to ${period.codes.join(', ')} only`,
      result,
      parseAudit,
      period.codes[0],
    );
  }

  // --- 12. The slice ----------------------------------------------------------------------
  const members: Record<string, string[]> = {};
  for (const d of fullDims) {
    if (d.name === timeDim.name) continue;
    const codes = regionDimNames.has(d.name)
      ? regions.coordinates[d.name]
      : resolved.coordinates[d.name] !== undefined
        ? [resolved.coordinates[d.name]!]
        : undefined;
    if (codes === undefined || codes.length === 0) {
      throw new Error(`planTableLane: no coordinate for dimension '${d.name}' after resolution — internal inconsistency`);
    }
    members[d.name] = codes;
  }
  const slice: SliceRequest = { measures: [measureCode], members, periods: period.codes };
  let cells = slice.measures.length * slice.periods.length;
  for (const codes of Object.values(members)) cells *= codes.length;
  if (cells > SLICE_MAX_CELLS) {
    return refuse(
      'table_lane_too_large',
      `the question needs ${cells} cells; at most ${SLICE_MAX_CELLS} can be fetched per question`,
      result,
      parseAudit,
    );
  }

  // --- 13. The explicit-target intent -------------------------------------------------------
  // resolveIntent (src/query/resolve.ts) maps `regions` onto the table's
  // GeoDimension only (expected_dimensions kind 'GeoDimension'); every plain
  // Dimension — breakdowns, margins AND a geo-like region dimension — is a
  // `target.dims` coordinate (one code each).
  const dims: Record<string, string> = {};
  for (const d of fullDims) {
    const cls = classOf.get(d.name)!;
    if (cls === 'time' || cls === 'geo') continue;
    const codes = members[d.name]!;
    if (codes.length !== 1) {
      throw new Error(`planTableLane: plain dimension '${d.name}' has ${codes.length} coordinates — one expected`);
    }
    dims[d.name] = codes[0]!;
  }
  // A class travels as `regionSet` ONLY (the query layer re-reads the same
  // roster from the table's stored CBS dimension groups and refuses an intent
  // naming both); named places travel as `regions`.
  const regionCodes = regionClass === null && geoDims.length === 1 ? members[geoDims[0]!.name]! : [];
  const intentPeriod: IntentPeriod =
    period.codes.length >= 2 && contiguousPeriodCodes(period.codes)
      ? { kind: 'range', from: period.codes[0]!, to: period.codes[period.codes.length - 1]! }
      : { kind: 'codes', codes: period.codes };
  const intent: StructuredIntent = {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: { kind: 'explicit', tableId: schema.tableId, measure: measureCode, dims },
    ...(regionCodes.length > 0 ? { regions: regionCodes } : {}),
    ...(regionClass !== null ? { regionSet: regionClass.scope } : {}),
    period: intentPeriod,
    derivation,
  };

  // --- Selection: every fixed coordinate, named vs. defaulted, in table order ---------------
  const order = new Map(fullDims.map((d, i) => [d.name, i]));
  const byTableOrder = (a: StatedDefault, b: StatedDefault) => order.get(a.dimension)! - order.get(b.dimension)!;
  const namedSelection: StatedDefault[] = Object.entries(named).map(([dimName, code]) => {
    const d = fullDims.find((x) => x.name === dimName)!;
    return { dimension: d.name, dimensionTitle: dimensionLabel(d), code, memberTitle: d.members.find((m) => m.code === code)!.title };
  });
  namedSelection.push(...regions.named);
  namedSelection.sort(byTableOrder);
  const defaults: StatedDefault[] = [...resolved.defaults, ...regions.defaults].sort(byTableOrder);
  if (period.defaulted) {
    defaults.push({
      dimension: timeDim.name,
      dimensionTitle: dimensionLabel(timeDim),
      code: period.defaulted.code,
      memberTitle: period.defaulted.label,
    });
  }
  const selection: TableLaneSelection = {
    named: namedSelection,
    defaults,
    ...(regions.nationalTable ? { nationalTable: true as const } : {}),
  };

  return { kind: 'fetch', slice, intent, selection, parse: result, parseAudit, offered };
}
