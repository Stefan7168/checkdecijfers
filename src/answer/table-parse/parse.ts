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
// menu. `measureCode` must be a real measure code or 'geen'; every offered
// breakdown dimension gets exactly one choice — a real, OFFERED member code,
// 'niet_genoemd' (the question says nothing about that dimension), or
// 'anders' (the question names something in that dimension that is not in
// the offered list — most often because the pre-filter cut it, never because
// the model may repair it into a guess). Anything else throws
// TableParseValidationError — never a partial result (principle c).
import { z } from 'zod';
import type { LlmClient, LlmRequest } from '../llm/client.ts';
import { oneOfToAnyOf } from '../llm/json-schema.ts';
import { periodSpecSchema, regionTermSchema } from '../intent/schema.ts';
import type { PeriodSpec, RegionTerm } from '../intent/types.ts';
import type { IntentDerivation, PeriodGrain } from '../../query/types.ts';
import type { TableParseSchema } from './input.ts';

/** Cheap tier (same reasoning as MEASURE_FIT_MODEL/TABLE_RERANK_MODEL): a
 * closed choice over a supplied menu is the easy shape; the principle-(c)
 * risk is contained structurally (the hard allowlist below), not by model
 * size. Escalation ladder Haiku → Sonnet is a one-line change, triggered
 * only by a measured accuracy miss — never speculative. */
export const TABLE_PARSE_MODEL = 'claude-haiku-4-5';

/** Documentation constant — the re-record is forced by the prompt BYTES
 * being hashed, not by this number (mirrors MEASURE_FIT_PROMPT_VERSION). */
export const TABLE_PARSE_PROMPT_VERSION = 1;

/** Bumped whenever the output contract shape changes (forces a fixture
 * re-record) — mirrors MEASURE_FIT_SCHEMA_VERSION. */
export const TABLE_PARSE_SCHEMA_VERSION = 1;

/** The literal the model answers when no measure in the table answers the
 * question. Kept out of the measure allowlist check by construction. */
export const TABLE_PARSE_MEASURE_NONE = 'geen';

/** The literal for "the question says nothing about this dimension". */
export const TABLE_PARSE_NOT_NAMED = 'niet_genoemd';

/** The literal for "the question names something in this dimension, but it
 * is not in the OFFERED member list" — exists because of the deterministic
 * pre-filter (Task 2): a long member list is cut down by text match, so the
 * member the reader actually named may be missing from what the model saw.
 * The bridge (step 5) must turn this into a clarifying question for that
 * dimension, NEVER into the dimension's grand total — a silent total where
 * the reader named a subgroup would be a wrong answer about a different
 * population (principle c). */
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

/**
 * Parses + validates the model's output text against ONE table's own closed
 * menu (`input`, from Task 2's buildTableParseSchema). Throws
 * TableParseValidationError — never a partial result — on invalid JSON, a
 * schema violation, confidence outside 0..1, an unknown/invented measure
 * code, an unknown/missing/duplicated breakdown dimension, a member code not
 * in that dimension's OFFERED list (including a real member the pre-filter
 * cut), or region terms on a table with no region/geo-like dimension.
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

  // --- regions: only meaningful when the table has any ---------------------
  if (!input.hasRegions && data.regions.length > 0) {
    throw new TableParseValidationError(
      `table-parse named region(s) (${data.regions.map((r) => r.name).join(', ')}) on table ` +
        `'${input.tableId}', which has no region/geo-like dimension`,
      outputText,
    );
  }

  // --- period grain availability: a signal, never a throw -------------------
  const grain = requiredGrain(data.period);
  const periodGrainUnavailable = grain !== null && !input.periodGrains.includes(grain);

  return {
    measureCode,
    breakdowns,
    period: data.period,
    periodGrainUnavailable,
    regions: data.regions,
    derivation: data.derivation,
    confidence: data.confidence,
    reading: data.reading,
  };
}

// ---------------------------------------------------------------------------
// Prompt — static and date-free (ADR 012 hash-stability), Dutch, mirroring
// buildMeasureFitSystemPrompt's structure and tone.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `Je bent een parseer-hulp voor checkdecijfers.nl, een dienst die vragen beantwoordt met officiële CBS-cijfers. Je krijgt de VOLLEDIGE VRAAG van een gebruiker (Nederlands) en de VOLLEDIGE OPZET van ÉÉN CBS-tabel: de beschikbare maten, de aangeboden uitsplitsingen (met hun leden), de beschikbare periode-precisies en of de tabel regio's kent. Vertaal de vraag naar een keuze uit UITSLUITEND deze lijsten. Verzin nooit een code, een lid, een dimensienaam of een regio die niet is aangeboden.

MAAT
- Kies precies één measureCode, LETTERLIJK overgenomen uit de matenlijst (inclusief hoofd-/kleine letters), OF antwoord 'geen'.
- Let op wat voor soort cijfer de vraag nodig heeft: een stand of totaal aantal op een moment ("hoeveel zijn er"), een in- of uitstroom of verandering ("hoeveel kwamen erbij"), een prijs, een index, een percentage. Een maat die het verkeerde soort cijfer meet, beantwoordt de vraag NIET.
- Antwoord 'geen' wanneer geen enkele maat het gevraagde soort cijfer meet. Een eerlijke afwijzing is beter dan een maat die er alleen qua onderwerp op lijkt.

UITSPLITSINGEN
Voor ELKE aangeboden uitsplitsing (dimensie) geef je precies één keuze, met exact de gegeven dimensienaam:
- Een ledencode, LETTERLIJK overgenomen uit de ledenlijst van DIE dimensie, wanneer de vraag dat lid noemt of er overduidelijk naar verwijst.
- 'niet_genoemd' wanneer de vraag helemaal niets zegt over deze dimensie.
- 'anders' wanneer de vraag wél iets noemt binnen deze dimensie, maar dat niet in de aangeboden ledenlijst staat. Let op: lange ledenlijsten zijn voor je ingekort (dit staat erbij als "ingekort: N van M") — het genoemde lid kan dus bestaan maar simpelweg niet in jouw lijst staan. Kies dan 'anders', nooit het totaal en nooit een ander lid dat er toevallig op lijkt.
Elke aangeboden dimensie komt precies één keer voor in je antwoord.

REGIO'S
Alleen wanneer de tabel regio's kent, mag je regio's noemen: plaatsnamen precies zoals de gebruiker ze schreef, elk met een soort (land, landsdeel, provincie, gemeente, of onbekend als het type niet duidelijk is uit de vraag). Nooit een CBS-code — codes horen alleen bij maten en leden. Kent de tabel geen regio's, dan blijft dit veld leeg: verzin nooit een regio-uitsplitsing die er niet is.

PERIODE
Geef de periode in het gevraagde format: een genoemd jaar, kwartaal of maand; een jaarbereik; expliciete datumgrenzen; "sinds"/"vanaf" met een open einde; "de afgelopen N jaar/kwartalen/maanden"; "nu vergeleken met N geleden"; een verandering binnen een genoemd jaar; "vorige maand/vorig kwartaal/vorig jaar"; 'latest' alleen bij een expliciet heden-signaal ("nu", "op dit moment", tegenwoordige tijd); of 'none' wanneer de vraag geen periodesignaal bevat. Je kent de datum van vandaag niet — reken relatieve periodes nooit zelf om naar een absoluut jaar.

OVERIG
- derivation: 'none' voor een gewone opvraging, 'difference' voor een expliciete veranderingsvraag met bedrag, 'max' voor een vraag naar het hoogste/meeste, 'series' voor een ontwikkeling over een periode.
- confidence is een getal tussen 0 en 1 en moet eerlijk zijn: hoog alleen bij een duidelijke, ondubbelzinnige match tussen de vraag en je keuzes.
- reading: één korte Nederlandse zin die je keuzes samenvat.
- version is altijd 1.

Antwoord uitsluitend met JSON volgens het opgegeven schema.`;

export function buildTableParseSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

/** Per-measure description budget in the prompt — mirrors onboarding-fit
 * .ts's DESCRIPTION_MAX / the measure-fit condense approach. */
const DESCRIPTION_MAX = 240;

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
      `${i + 1}. measureCode=${m.code} | eenheid=${m.unit || 'onbekend'}\n` +
      `   titel: ${m.title}` +
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

  const grains = input.periodGrains.length > 0 ? input.periodGrains.join(', ') : '(geen)';
  const regionsLine = input.hasRegions
    ? "Regio's: deze tabel kent regio's."
    : "Regio's: deze tabel kent geen regio's.";

  return (
    `Volledige vraag van de gebruiker: "${question}"\n` +
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

/**
 * The table-scoped parse: turns a reader's question, read against ONE
 * table's own closed menu, into a validated TableParseResult. Throws
 * TableParseValidationError on malformed or off-allowlist output — never a
 * partial result (principle c).
 */
export async function tableParse(
  question: string,
  input: TableParseSchema,
  options: TableParseOptions,
): Promise<TableParseResult> {
  const request = buildTableParseRequest(question, input, options);
  const response = await options.client.complete(request);
  return validateTableParseOutput(response.outputText, input);
}
