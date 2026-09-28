// Breadth step 4, Task 3 — the table-scoped parser's prompt, output schema,
// hard-allowlist validator and request builder
// (docs/superpowers/plans/2026-09-28-breadth-step-4-table-parser.md, Task 3;
// spec docs/superpowers/specs/2026-09-28-breadth-any-cbs-table-design.md).
//
// Mirrors src/ingestion/onboarding-fit.ts's shape (prompt + zod output schema
// + validator + version constants, all in one module) and reuses the
// curated intent parser's own vocabulary — `periodSpecSchema` and
// `regionTermSchema` from src/answer/intent/schema.ts, `PeriodSpec` /
// `RegionTerm` from src/answer/intent/types.ts — rather than re-declaring it,
// so a period spec or region term this module accepts is, by construction,
// exactly what the deterministic resolvers downstream already know how to
// read (Global Constraints).
//
// Principle (a) / R7, hard allowlist: the model gets ONE table's own closed
// menu (Task 2's TableParseSchema — numeric measures, offered breakdown
// dimensions with their (possibly pre-filtered) members, available period
// grains, whether the table has regions) and may only ever choose FROM that
// menu for measure and breakdowns. `measureCode` must be a real measure code
// or 'geen'; every offered breakdown dimension gets exactly one choice — a
// real, OFFERED member code, 'niet_genoemd' (the question says nothing about
// that dimension), or 'anders' (the question says something about that
// dimension that is not exactly one offered member: not in the offered list
// — e.g. cut by the pre-filter — several members fit, or the question asks
// across members; never repaired into a guess). A chosen measure that
// cannot be told apart from another offered measure (same title, unit and
// description) throws TableParseAmbiguousMeasureError (final-review F4).
// Anything else throws TableParseValidationError — never a partial result
// (principle c).
//
// Regions and the period are the deliberate EXCEPTION to "choose from a
// supplied list": the model must ALWAYS report every place and the exact
// period precision the question names, verbatim, even when the table cannot
// serve them (fix round 1, task review, CRITICAL/IMPORTANT) — the code
// decides servability, never the model by silently omitting what the reader
// asked. On a table WITHOUT a region/geo-like dimension (hasRegions false),
// a named place must be an offered, region-CODED member of some breakdown
// dimension (e.g. 85004NED's region-coded but ordinary `RegioS`), and that
// dimension must then be answered with the matching member or 'anders' —
// only 'anders' when several members match (look-alike places) — never
// 'niet_genoemd' or another member, either of which would silently answer
// about a different population (final-review F1 + follow-up). A place that matches no
// offered member, or a region class (`regionScope`, final-review F3) on such
// a table, throws the distinct `TableParseRegionUnavailableError` subclass
// (never silently dropped, which would read as a national-total answer to a
// question about one place). A 'geen' measure short-circuits all region
// checks (final-review F10: step 5 refuses on geen with the right reason). A
// named period precision the table doesn't publish sets
// `periodGrainUnavailable` (a refusal SIGNAL, not a throw — see
// `requiredGrain`).
import { z } from 'zod';
import type { LlmClient, LlmRequest, LlmUsage } from '../llm/client.ts';
import { requestHash } from '../llm/client.ts';
import { oneOfToAnyOf } from '../llm/json-schema.ts';
import { periodSpecSchema, regionScopeSchema, regionTermSchema } from '../intent/schema.ts';
import type { PeriodSpec, RegionScopeKind, RegionTerm } from '../intent/types.ts';
import type { IntentDerivation, PeriodGrain } from '../../query/types.ts';
import { baseLabel, normalizeRegionName } from '../../sources/region-names.ts';
import type { TableParseBreakdown, TableParseMeasure, TableParseSchema } from './input.ts';

/** Cheap tier (same reasoning as MEASURE_FIT_MODEL/TABLE_RERANK_MODEL): a
 * closed choice over a supplied menu is the easy shape; the principle-(c)
 * risk is contained structurally (the hard allowlist below), not by model
 * size. Escalation ladder Haiku → Sonnet is a one-line change, triggered
 * only by a measured accuracy miss — never speculative. */
export const TABLE_PARSE_MODEL = 'claude-haiku-4-5';

/** Documentation constant — the re-record is forced by the prompt BYTES
 * being hashed, not by this number (mirrors MEASURE_FIT_PROMPT_VERSION).
 * Bumped to 2 (breadth step 4b, Task 2): the prompt now describes measure
 * groups and shows a `groep:` line per measure. */
export const TABLE_PARSE_PROMPT_VERSION = 2;

/** Bumped whenever the output contract shape changes (forces a fixture
 * re-record) — mirrors MEASURE_FIT_SCHEMA_VERSION. Bumped to 2 alongside
 * TABLE_PARSE_PROMPT_VERSION (breadth step 4b, Task 2) — the output schema's
 * `version` literal below moves with it, so a fixture recorded against the
 * old (ungrouped) prompt is rejected rather than silently accepted. */
export const TABLE_PARSE_SCHEMA_VERSION = 2;

/** The literal the model answers when no measure in the table answers the
 * question. Kept out of the measure allowlist check by construction. */
export const TABLE_PARSE_MEASURE_NONE = 'geen';

/** The literal for "the question says nothing about this dimension". */
export const TABLE_PARSE_NOT_NAMED = 'niet_genoemd';

/** The literal for "the question says something about this dimension that
 * is not exactly one OFFERED member" (final-review F3): the named thing is
 * not in the offered list (the deterministic pre-filter can cut a long
 * member list, so the member the reader named may be missing from what the
 * model saw), SEVERAL offered members fit (e.g. "ouderen" over several age
 * bands, or a place name that several members carry), or the question asks
 * ACROSS the members ("welke leeftijdsgroep had de meeste…"). The bridge
 * must turn this into a clarifying question for that dimension, NEVER into
 * the dimension's grand total — a silent total where the reader named a
 * subgroup would be a wrong answer about a different population
 * (principle c). */
export const TABLE_PARSE_OTHER = 'anders';

/** Acceptance threshold. **Assumption:** uncalibrated until the recording
 * run (mirrored in docs/open-questions.md) — kept at 0.8, the same starting
 * point as DEFAULT_MEASURE_FIT_CONFIG, for consistency across the two
 * closed-choice gates until a real measured run says otherwise. */
export const DEFAULT_TABLE_PARSE_CONFIG = {
  acceptThreshold: 0.8,
};

export class TableParseValidationError extends Error {
  readonly outputText: string;

  constructor(message: string, outputText: string) {
    super(message);
    this.name = 'TableParseValidationError';
    this.outputText = outputText;
  }
}

/** Fix round 1 (task review, CRITICAL): a distinct subclass for the one
 * throw that is NOT "the model produced garbage" but "the reader named a
 * real place on a table that has no region/geo-like dimension at all" — the
 * exact shape of a silent wrong-population answer (principle c) if it were
 * ever swallowed. Step 5 catches this subclass specifically to refuse with a
 * precise "this table has no regions" message, distinct from every other
 * (structurally malformed) TableParseValidationError. */
export class TableParseRegionUnavailableError extends TableParseValidationError {
  constructor(message: string, outputText: string) {
    super(message, outputText);
    this.name = 'TableParseRegionUnavailableError';
  }
}

/** Final-review F4: the chosen measure has the same title, unit and
 * (condensed) description as at least one OTHER offered measure — the model
 * saw nothing that tells them apart, so its pick is a coin flip, not a
 * reading of the question. Step 5 refuses (or asks) rather than serve a
 * number for a measure nobody can identify. */
export class TableParseAmbiguousMeasureError extends TableParseValidationError {
  /** Every offered measure code indistinguishable from the chosen one
   * (including the chosen one), in table order. */
  readonly measureCodes: string[];

  constructor(message: string, outputText: string, measureCodes: string[]) {
    super(message, outputText);
    this.name = 'TableParseAmbiguousMeasureError';
    this.measureCodes = measureCodes;
  }
}

/** One breakdown dimension's validated choice. */
export type TableParseBreakdownChoice =
  | { kind: 'member'; code: string }
  | { kind: 'not_named' }
  | { kind: 'other' };

/** The validated result. `measureCode === null` means the model answered
 * 'geen' — no measure in this table answers the question.
 * `periodGrainUnavailable` is a refusal/clarification SIGNAL for step 5
 * (a period whose grain this table does not publish), never a throw —
 * mirroring the query layer's own refuse-don't-guess split between
 * structural violations (throw) and honest scope limits (a typed signal). */
export interface TableParseResult {
  measureCode: string | null;
  breakdowns: Record<string, TableParseBreakdownChoice>;
  period: PeriodSpec;
  periodGrainUnavailable: boolean;
  regions: RegionTerm[];
  /** A class of regions the question asks about ("welke provincie…"), or
   * null. Only ever non-null here on a table that has regions (or on a
   * 'geen' parse, which skips the region checks). */
  regionScope: RegionScopeKind | null;
  derivation: IntentDerivation;
  confidence: number;
  reading: string;
}

// ---------------------------------------------------------------------------
// Output schema — generated from zod, exactly like rawParseJsonSchema /
// measureFitJsonSchema. periodSpecSchema is a discriminated union (zod
// renders it as `oneOf`), so the JSON schema goes through oneOfToAnyOf
// exactly like rawParseJsonSchema does.
// ---------------------------------------------------------------------------

const tableParseBreakdownEntrySchema = z.strictObject({
  /** One of the table's offered breakdown dimension NAMES (checked against
   * the actual offered list in code, not by this schema — the schema only
   * knows a table-independent shape). */
  dimension: z.string(),
  /** A member code copied verbatim from that dimension's OFFERED list,
   * 'niet_genoemd', or 'anders' (checked against the actual offered list in
   * code, same reasoning as `dimension` above). */
  choice: z.string(),
});

const tableParseOutputSchema = z.strictObject({
  version: z.literal(TABLE_PARSE_SCHEMA_VERSION),
  /** A measure code copied verbatim from the table's measure list, or
   * 'geen'. */
  measureCode: z.string(),
  /** Exactly one entry per offered breakdown dimension (checked in code —
   * the schema only bounds the per-entry shape). */
  breakdowns: z.array(tableParseBreakdownEntrySchema),
  period: periodSpecSchema,
  /** Possibly empty, never nullable (controller ruling) — the model states
   * "no regions" by returning []. */
  regions: z.array(regionTermSchema),
  /** The curated parser's own region-class vocabulary (final-review F3),
   * reused rather than re-declared; null = no class. */
  regionScope: regionScopeSchema,
  derivation: z.enum(['none', 'difference', 'max', 'series']),
  /** Confidence 0..1 in the parse, range-checked in code (structured-output
   * schemas carry no numeric min/max). */
  confidence: z.number(),
  /** One short Dutch sentence summarizing the choices — diagnostics only,
   * never rendered to the user. */
  reading: z.string(),
});

export function tableParseJsonSchema(): Record<string, unknown> {
  return oneOfToAnyOf(z.toJSONSchema(tableParseOutputSchema)) as Record<string, unknown>;
}

/** Grain mapping ruling (controller): a period spec whose grain the table
 * does not publish sets `periodGrainUnavailable`. `latest`/`none` never
 * require a grain — they carry no explicit period precision to check. */
function requiredGrain(period: PeriodSpec): PeriodGrain | null {
  switch (period.kind) {
    case 'year':
    case 'year_range':
    case 'change_over_year':
      return 'JJ';
    case 'quarter':
      return 'KW';
    case 'month':
    case 'date_range':
      return 'MM';
    case 'since':
      if (period.month !== null) return 'MM';
      if (period.quarter !== null) return 'KW';
      return 'JJ';
    case 'last_n':
    case 'now_vs_ago':
    case 'relative':
      return period.unit === 'year' ? 'JJ' : period.unit === 'quarter' ? 'KW' : 'MM';
    case 'latest':
    case 'none':
      return null;
  }
}

/** The unit exactly as the prompt displays it (serializeTableParseInput's own
 * "eenheid=" fallback) — used by the fingerprint below so two measures that
 * both show as "onbekend" (both '') are correctly treated as sharing a unit,
 * not compared on the raw (possibly different) underlying string. */
function displayUnit(m: TableParseMeasure): string {
  return m.unit || 'onbekend';
}

/** What the model sees of a measure — its group path (breadth step 4b, Task
 * 2), the serialization's own title, displayed unit and condensed
 * description. Two offered measures with the same fingerprint are
 * indistinguishable to the model (final-review F4): CBS's own measure group
 * is part of that judgment now, since it is part of what the prompt shows —
 * measured against the live 80590ned fixture, its four
 * "Niet-seizoengecorrigeerd" / "x 1000" / empty-description measures each
 * sit in a DIFFERENT CBS measure group ("Beroepsbevolking", "Werkzame
 * beroepsbevolking", "Werkloze beroepsbevolking", "Niet-beroepsbevolking"),
 * so they are no longer indistinguishable once the group is part of the
 * fingerprint. */
function measureFingerprint(m: TableParseMeasure): string {
  return JSON.stringify([m.groupPath, m.title, displayUnit(m), condense(m.description)]);
}

/** Only a member whose CODE carries a CBS region prefix counts as a place
 * for the region checks below (follow-up ruling): a birth-country-like
 * member titled "Nederland" but coded e.g. 1012600 is a population
 * characteristic, not the place Nederland. Measured on the committed
 * fixtures: 85004NED RegioS uses NL/PV/ES/ET codes, 82291NED
 * CaribischNederland uses CN/GM codes; LD/CR/WK/BU complete CBS's own region
 * code families (landsdeel, COROP, wijk, buurt). Deliberately local to this
 * validator — src/query/breakdowns.ts's geo-like classification is not
 * changed. */
const REGION_MEMBER_CODE = /^(NL|PV|GM|LD|CR|WK|BU|CN|ES|ET)\d/;

/** A member title reduced to the place name a reader would write: CBS's
 * trailing disambiguation dropped ("Groningen (PV)" → "Groningen"), then the
 * shared region-name normalization (src/sources/region-names.ts). */
function memberPlaceKey(title: string): string {
  return normalizeRegionName(baseLabel(title));
}

/**
 * Parses + validates the model's output text against ONE table's own closed
 * menu (`input`, from Task 2's buildTableParseSchema). Throws
 * TableParseValidationError — never a partial result — on invalid JSON, a
 * schema violation, confidence outside 0..1, an unknown/invented measure
 * code, an unknown/missing/duplicated breakdown dimension, a member code
 * not in that dimension's OFFERED list (including a real member the
 * pre-filter cut), or — on a table without regions — a named place whose
 * breakdown dimension was answered with 'niet_genoemd' or a non-matching
 * member. Throws the TableParseAmbiguousMeasureError subclass when the
 * chosen measure is indistinguishable from another offered measure. Throws
 * the distinct TableParseRegionUnavailableError subclass when, on a table
 * with no region/geo-like dimension, a named place matches no offered
 * breakdown member or a region class is asked — the reader asked about
 * places this table cannot serve, so step 5 refuses with a precise message
 * rather than a generic malformed-output one. A 'geen' measure skips every
 * region check (step 5 refuses on geen).
 */
export function validateTableParseOutput(
  outputText: string,
  input: TableParseSchema,
): TableParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new TableParseValidationError(
      `table-parse output is not valid JSON: ${(error as Error).message}`,
      outputText,
    );
  }
  const result = tableParseOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new TableParseValidationError(
      `table-parse output violates the schema: ${result.error.message}`,
      outputText,
    );
  }
  const data = result.data;

  if (!Number.isFinite(data.confidence) || data.confidence < 0 || data.confidence > 1) {
    throw new TableParseValidationError(
      `table-parse confidence ${data.confidence} is outside 0..1`,
      outputText,
    );
  }

  // --- measure: hard allowlist ---------------------------------------------
  const measureCodes = input.measures.map((m) => m.code);
  let measureCode: string | null;
  if (data.measureCode === TABLE_PARSE_MEASURE_NONE) {
    measureCode = null;
  } else if (measureCodes.includes(data.measureCode)) {
    measureCode = data.measureCode;
    const chosen = input.measures.find((m) => m.code === measureCode)!;
    const fingerprint = measureFingerprint(chosen);
    const twins = input.measures.filter((m) => measureFingerprint(m) === fingerprint);
    if (twins.length > 1) {
      throw new TableParseAmbiguousMeasureError(
        `table-parse chose measure '${measureCode}', but it has the same title, unit and description as ` +
          `${twins
            .filter((m) => m.code !== measureCode)
            .map((m) => `'${m.code}'`)
            .join(', ')} on table '${input.tableId}' — nothing tells them apart, so the pick is not a reading ` +
          `of the question`,
        outputText,
        twins.map((m) => m.code),
      );
    }
  } else {
    throw new TableParseValidationError(
      `table-parse chose measure code '${data.measureCode}' which is NOT in table ` +
        `'${input.tableId}'s measure list (${measureCodes.join(', ') || '<empty>'}) and is not ` +
        `'${TABLE_PARSE_MEASURE_NONE}' — the model may not invent a measure`,
      outputText,
    );
  }

  // --- breakdowns: exactly one choice per offered dimension ----------------
  const breakdownsByName = new Map(input.breakdowns.map((b) => [b.name, b]));
  const seen = new Set<string>();
  const breakdowns: Record<string, TableParseBreakdownChoice> = {};

  for (const entry of data.breakdowns) {
    const offered = breakdownsByName.get(entry.dimension);
    if (!offered) {
      throw new TableParseValidationError(
        `table-parse named dimension '${entry.dimension}' which is not one of table ` +
          `'${input.tableId}'s offered breakdown dimensions ` +
          `(${[...breakdownsByName.keys()].join(', ') || '<none>'})`,
        outputText,
      );
    }
    if (seen.has(entry.dimension)) {
      throw new TableParseValidationError(
        `table-parse named dimension '${entry.dimension}' more than once — exactly one choice ` +
          `per offered dimension is required`,
        outputText,
      );
    }
    seen.add(entry.dimension);

    if (entry.choice === TABLE_PARSE_NOT_NAMED) {
      breakdowns[entry.dimension] = { kind: 'not_named' };
    } else if (entry.choice === TABLE_PARSE_OTHER) {
      breakdowns[entry.dimension] = { kind: 'other' };
    } else {
      const member = offered.members.find((m) => m.code === entry.choice);
      if (!member) {
        throw new TableParseValidationError(
          `table-parse chose member '${entry.choice}' for dimension '${entry.dimension}', which ` +
            `is not in the OFFERED member list for that dimension ` +
            `(${offered.members.map((m) => m.code).join(', ') || '<empty>'}) and is not ` +
            `'${TABLE_PARSE_NOT_NAMED}'/'${TABLE_PARSE_OTHER}' — a real member the pre-filter cut ` +
            `must be answered as '${TABLE_PARSE_OTHER}', never guessed`,
          outputText,
        );
      }
      breakdowns[entry.dimension] = { kind: 'member', code: member.code };
    }
  }

  const missing = [...breakdownsByName.keys()].filter((name) => !seen.has(name));
  if (missing.length > 0) {
    throw new TableParseValidationError(
      `table-parse is missing a choice for offered dimension(s): ${missing.join(', ')} — every ` +
        `offered dimension requires exactly one choice`,
      outputText,
    );
  }

  // --- period grain availability: a signal, never a throw -------------------
  const grain = requiredGrain(data.period);
  const periodGrainUnavailable = grain !== null && !input.periodGrains.includes(grain);

  const validated: TableParseResult = {
    measureCode,
    breakdowns,
    period: data.period,
    periodGrainUnavailable,
    regions: data.regions,
    regionScope: data.regionScope,
    derivation: data.derivation,
    confidence: data.confidence,
    reading: data.reading,
  };

  // Final-review F10: a 'geen' measure short-circuits the region checks —
  // the question is refused on geen (with that reason) regardless of its
  // places, so a region error here would only mis-state WHY it is refused.
  if (measureCode === null) return validated;

  if (!input.hasRegions) {
    checkRegionsOnRegionlessTable(validated, input, outputText);
  }

  return validated;
}

/**
 * The region checks for a table WITHOUT a region/geo-like dimension. The
 * prompt tells the model to ALWAYS list every place the reader names, even
 * here — so a place is not "the model misbehaved", it is "the reader asked
 * about a place", and the code decides whether this table can serve it:
 *
 * - A region class (`regionScope`) cannot be served → region-unavailable.
 * - Each named place must match (memberPlaceKey) at least one OFFERED,
 *   REGION-CODED (REGION_MEMBER_CODE) member of some breakdown dimension
 *   (85004NED's RegioS, 82291NED's CaribischNederland), else →
 *   region-unavailable. A non-region-coded member with the same title (a
 *   birth country "Nederland") never counts as the place.
 * - A dimension where exactly ONE such member matches must be answered with
 *   that member or 'anders'. A dimension where SEVERAL match (look-alike
 *   places, e.g. "Groningen (PV)/(ES)/(ET)") must be 'anders' — any member
 *   pick, even a matching one, is a silent choice between different places
 *   (follow-up ruling). 'niet_genoemd' or a non-matching member would
 *   silently answer about the total or a different place. Each of these is a
 *   plain TableParseValidationError (the output contradicts itself).
 */
function checkRegionsOnRegionlessTable(
  result: TableParseResult,
  input: TableParseSchema,
  outputText: string,
): void {
  if (result.regionScope !== null) {
    throw new TableParseRegionUnavailableError(
      `table-parse asked about the region class '${result.regionScope}' on table '${input.tableId}', which ` +
        `has no region/geo-like dimension`,
      outputText,
    );
  }

  for (const region of result.regions) {
    const key = normalizeRegionName(region.name);
    const listing: { dim: TableParseBreakdown; matchCodes: string[] }[] = [];
    for (const dim of input.breakdowns) {
      const matchCodes = dim.members
        .filter((m) => REGION_MEMBER_CODE.test(m.code) && memberPlaceKey(m.title) === key)
        .map((m) => m.code);
      if (matchCodes.length > 0) listing.push({ dim, matchCodes });
    }
    if (listing.length === 0) {
      throw new TableParseRegionUnavailableError(
        `table-parse named region '${region.name}' on table '${input.tableId}', which has no ` +
          `region/geo-like dimension and no offered region-coded breakdown member with that name`,
        outputText,
      );
    }
    for (const { dim, matchCodes } of listing) {
      const choice = result.breakdowns[dim.name]!;
      if (choice.kind === 'other') continue;
      if (choice.kind === 'member' && matchCodes.length === 1 && choice.code === matchCodes[0]) continue;
      const got = choice.kind === 'member' ? `member '${choice.code}'` : `'${TABLE_PARSE_NOT_NAMED}'`;
      const required =
        matchCodes.length === 1
          ? `the matching member '${matchCodes[0]}' or '${TABLE_PARSE_OTHER}'`
          : `'${TABLE_PARSE_OTHER}' — ${matchCodes.length} members match (${matchCodes.join(', ')}), so any single ` +
            `pick is a silent choice between different places`;
      throw new TableParseValidationError(
        `table-parse named region '${region.name}', which is a member of dimension '${dim.name}', but answered ` +
          `that dimension with ${got} — it must be ${required}`,
        outputText,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Prompt — static and date-free (ADR 012 hash-stability), Dutch, mirroring
// buildMeasureFitSystemPrompt's structure and tone.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Je bent een parseer-hulp voor checkdecijfers.nl, een dienst die vragen beantwoordt met officiële CBS-cijfers. Je krijgt de VOLLEDIGE VRAAG van een gebruiker (Nederlands) en de VOLLEDIGE OPZET van ÉÉN CBS-tabel: de beschikbare maten, de aangeboden uitsplitsingen (met hun leden), de beschikbare periode-precisies en of de tabel regio's kent. Voor maat en uitsplitsingen kies je UITSLUITEND uit deze lijsten — verzin nooit een code, een lid of een dimensienaam die niet is aangeboden. Regio's en de gevraagde periode geef je altijd zoals de vraag ze zelf noemt (zie REGIO'S en PERIODE) — dat is GEEN keuze uit een aangeboden lijst.

MAAT
- Kies precies één measureCode, LETTERLIJK overgenomen uit de matenlijst (inclusief hoofd-/kleine letters), OF antwoord 'geen'.
- Let op wat voor soort cijfer de vraag nodig heeft: een stand of totaal aantal op een moment ("hoeveel zijn er"), een in- of uitstroom of verandering ("hoeveel kwamen erbij"), een prijs, een index, een percentage. Een maat die het verkeerde soort cijfer meet, beantwoordt de vraag NIET.
- Antwoord 'geen' wanneer geen enkele maat het gevraagde soort cijfer meet. Een eerlijke afwijzing is beter dan een maat die er alleen qua onderwerp op lijkt.
- Maten kunnen gegroepeerd zijn (zie "groep:" bij de maat); de groep vertelt bij welke populatie of grootheid de maat hoort — twee maten met dezelfde titel in een verschillende groep meten dus iets anders.

UITSPLITSINGEN
Voor ELKE aangeboden uitsplitsing (dimensie) geef je precies één keuze, met exact de gegeven dimensienaam:
- Een ledencode, LETTERLIJK overgenomen uit de ledenlijst van DIE dimensie, wanneer de vraag precies dat ene lid noemt of er overduidelijk naar verwijst.
- 'niet_genoemd' wanneer de vraag helemaal niets zegt over deze dimensie.
- 'anders' wanneer de vraag wél iets zegt over deze dimensie, maar dat niet precies één aangeboden lid is:
  - het genoemde staat niet in de aangeboden ledenlijst. Let op: lange ledenlijsten zijn voor je ingekort (dit staat erbij als "ingekort: N van M") — het genoemde lid kan dus bestaan maar simpelweg niet in jouw lijst staan;
  - MEERDERE leden passen bij wat de vraag noemt (bijvoorbeeld "ouderen" over meerdere leeftijdsklassen);
  - de vraag vergelijkt of zoekt over de leden heen ("welke leeftijdsgroep had de meeste …", "per geslacht").
  Kies in al die gevallen 'anders' — nooit het totaal en nooit één lid dat er toevallig op lijkt.
Elke aangeboden dimensie komt precies één keer voor in je antwoord.

REGIO'S
Noem ALTIJD elke plaats die de vraag noemt, precies zoals de gebruiker haar schreef, elk met een soort (land, landsdeel, provincie, gemeente, of onbekend als het type niet duidelijk is uit de vraag) — OOK wanneer deze tabel helemaal geen regio's kent. Dit is geen keuze uit een lijst: de code bepaalt zelf of de genoemde plaats op deze tabel kan, en wijst de vraag anders eerlijk af. Het is NOOIT aan jou om een genoemde plaats daarom weg te laten of de vraag te negeren — een weggelaten plaats zou hier lijken op een vraag over heel Nederland, terwijl de vraag over één plaats ging. Noemt de vraag geen enkele plaats, dan blijft dit veld leeg. Verzin nooit een plaats die de vraag niet noemt, en gebruik nooit een CBS-code — codes horen alleen bij maten en leden.
Staat een genoemde plaats zelf als lid in een aangeboden uitsplitsing (bijvoorbeeld een dimensie met provincies, regio's of gemeenten), dan noem je haar hier ÉN kies je voor die dimensie dat lid. Passen meerdere leden bij de genoemde plaats (bijvoorbeeld "Groningen (PV)", "Groningen (ES)" en "Groningen (ET)"), of noemt de vraag meerdere plaatsen uit dezelfde dimensie, kies dan voor die dimensie 'anders'.

REGIOKLASSE
regionScope vul je ALLEEN wanneer de vraag gaat over een hele klasse van regio's in plaats van over genoemde plaatsen: "per provincie", "elke/alle provincies", "welke provincie …" → "all_provincies"; "per landsdeel", "alle landsdelen" → "all_landsdelen"; "per gemeente", "alle gemeenten", "welke gemeente …" zonder genoemde provincie → "all_gemeenten"; "de gemeenten in {provincie}", "welke gemeente in {provincie} …" → "gemeenten_in_provincie", met die provincie als enige regio. Vul de klasse OOK in wanneer deze tabel geen regio's kent — de code bepaalt of de klasse kan. Som nooit zelf de leden van een klasse op als regio's. In elke andere vraag is regionScope null.

PERIODE
Geef de periode ALTIJD exact met de precisie die de vraag zelf noemt — OOK wanneer die precisie niet voorkomt in de lijst "Beschikbare periode-precisies". Pas de gevraagde periode nooit aan naar een precisie die wel beschikbaar is (bijvoorbeeld een genoemd kwartaal afronden op een jaar, omdat alleen jaren beschikbaar zijn) — de code bepaalt zelf of en hoe die precisie beantwoord kan worden. Voorbeelden van het format:
- Genoemd jaar → {"kind":"year","year":JJJJ}; genoemd kwartaal → {"kind":"quarter","year":JJJJ,"quarter":1..4}; genoemde maand → {"kind":"month","year":JJJJ,"month":1..12}.
- "van JJJJ tot en met JJJJ" (hele jaren) → {"kind":"year_range","fromYear":...,"toYear":...}.
- Expliciete dag- of maandgrenzen ("van 1 januari 2022 tot en met 31 december 2022") → {"kind":"date_range","from":{...},"to":{...},"toInclusive":...}: kopieer dag, maand en jaar precies zoals geschreven (dag null wanneer er geen dag genoemd wordt); toInclusive is true bij "tot en met"/"t/m"; bij een kale "tot" is toInclusive true wanneer de grens alleen een maand noemt, en false wanneer de grens een dag noemt.
- "sinds JJJJ"/"vanaf JJJJ" zonder genoemd einde → {"kind":"since","year":JJJJ,"quarter":null,"month":null}; een genoemde startmaand of -kwartaal vult month/quarter in plaats van null.
- "de afgelopen/laatste N jaar/kwartalen/maanden" met N van 2 of meer → {"kind":"last_n","unit":"year"|"quarter"|"month","n":N}; het enkelvoud ("het afgelopen jaar", "de afgelopen maand") is juist {"kind":"relative","unit":...,"offset":-1}.
- "nu vergeleken met N {eenheid} geleden" → {"kind":"now_vs_ago","unit":...,"amount":N}.
- "groeide/steeg/daalde ... in JJJJ, met hoeveel" → {"kind":"change_over_year","year":JJJJ}.
- "vorige maand"/"vorig kwartaal"/"vorig jaar" → {"kind":"relative","unit":...,"offset":-1}: offset is een negatief getal, -1 is de vorige periode.
- 'latest' alleen bij een expliciet heden-signaal ("nu", "op dit moment", tegenwoordige tijd); 'none' wanneer de vraag helemaal geen periodesignaal bevat.
Je kent de datum van vandaag niet — reken relatieve periodes nooit zelf om naar een absoluut jaar.

OVERIG
- derivation: 'none' voor een gewone opvraging, 'difference' voor een expliciete veranderingsvraag met bedrag, 'max' voor een vraag naar het hoogste/meeste, 'series' voor een ontwikkeling over een periode.
- confidence is een getal tussen 0 en 1 en moet eerlijk zijn: hoog alleen bij een duidelijke, ondubbelzinnige match tussen de vraag en je keuzes.
- reading: één korte Nederlandse zin die je keuzes samenvat.
- version is altijd 2.

Antwoord uitsluitend met JSON volgens het opgegeven schema.`;

export function buildTableParseSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

/** Per-measure description budget in the prompt — mirrors onboarding-fit
 * .ts's DESCRIPTION_MAX / the measure-fit condense approach. */
const DESCRIPTION_MAX = 240;

/** Fix round 1 (task review, MINOR): a legend for the grain codes shown in
 * "Beschikbare periode-precisies" — the model otherwise sees bare CBS grain
 * codes with no stated meaning. */
const GRAIN_LABEL: Record<PeriodGrain, string> = { JJ: 'jaar', KW: 'kwartaal', MM: 'maand' };

function condense(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > DESCRIPTION_MAX ? `${flat.slice(0, DESCRIPTION_MAX)}…` : flat;
}

/** The user-turn payload: the full question, the table's identity, its
 * numbered measure list, every offered breakdown (with its members and a
 * truncation note when the pre-filter cut it), the available period grains,
 * and whether the table has regions at all. Metadata + the offered menu
 * only — never a data cell (R1). */
export function serializeTableParseInput(question: string, input: TableParseSchema): string {
  const measureLines = input.measures.map((m, i) => {
    const blurb = condense(m.description);
    return (
      `${i + 1}. measureCode=${m.code} | eenheid=${displayUnit(m)}\n` +
      `   titel: ${m.title}` +
      (m.groupPath.length > 0 ? `\n   groep: ${m.groupPath.join(' › ')}` : '') +
      (blurb ? `\n   omschrijving: ${blurb}` : '')
    );
  });

  const breakdownLines = input.breakdowns.map((b) => {
    const truncNote = b.truncated ? ` (ingekort: ${b.members.length} van ${b.totalMembers})` : '';
    const body =
      b.members.length > 0
        ? b.members.map((m) => `    ${m.code} — ${m.title}`).join('\n')
        : '    (geen leden aangeboden)';
    return `- dimensie=${b.name} | titel: ${b.title}${truncNote}\n${body}`;
  });

  const grains =
    input.periodGrains.length > 0
      ? input.periodGrains.map((g) => `${g} (${GRAIN_LABEL[g]})`).join(', ')
      : '(geen)';
  const regionsLine = input.hasRegions
    ? "Regio's: deze tabel kent regio's."
    : "Regio's: deze tabel kent geen regio's.";

  return (
    `Volledige vraag van de gebruiker: ${JSON.stringify(question)}\n` +
    `Tabel: ${input.tableId} — ${input.title}\n\n` +
    `Maten in deze tabel:\n${measureLines.join('\n')}\n\n` +
    `Uitsplitsingen in deze tabel:\n` +
    `${input.breakdowns.length > 0 ? breakdownLines.join('\n') : '(geen)'}\n\n` +
    `Beschikbare periode-precisies: ${grains}\n` +
    regionsLine
  );
}

export interface TableParseOptions {
  client: LlmClient;
  model?: string;
  maxTokens?: number;
}

export function buildTableParseRequest(
  question: string,
  input: TableParseSchema,
  options: Pick<TableParseOptions, 'model' | 'maxTokens'> = {},
): LlmRequest {
  return {
    model: options.model ?? TABLE_PARSE_MODEL,
    // Small JSON output (a handful of codes/choices + confidence + one Dutch
    // sentence); 1024 mirrors measureFit's headroom reasoning — a max_tokens
    // stop throws in the harness, never a fabrication.
    maxTokens: options.maxTokens ?? 1024,
    temperature: 0,
    system: buildTableParseSystemPrompt(),
    question: serializeTableParseInput(question, input),
    jsonSchema: tableParseJsonSchema(),
  };
}

/** The call's audit metadata (final-review F9) — mirrors parseQuestion
 * keeping the response's model + usage next to its outcome, plus the
 * request hash (the replay-fixture key) and the raw output text, so step 5
 * can log exactly which request/response produced a parse. */
export interface TableParseAudit {
  requestHash: string;
  model: string;
  usage: LlmUsage;
  outputText: string;
}

export interface TableParseOutcome {
  result: TableParseResult;
  audit: TableParseAudit;
}

/**
 * The table-scoped parse: turns a reader's question, read against ONE
 * table's own closed menu, into a validated TableParseResult plus the
 * call's audit metadata. Throws TableParseValidationError (or one of its
 * subclasses) on malformed, off-allowlist or unservable output — never a
 * partial result (principle c); the error carries the raw output text.
 */
export async function tableParse(
  question: string,
  input: TableParseSchema,
  options: TableParseOptions,
): Promise<TableParseOutcome> {
  const request = buildTableParseRequest(question, input, options);
  const response = await options.client.complete(request);
  const result = validateTableParseOutput(response.outputText, input);
  return {
    result,
    audit: {
      requestHash: requestHash(request),
      model: response.model,
      usage: response.usage,
      outputText: response.outputText,
    },
  };
}
