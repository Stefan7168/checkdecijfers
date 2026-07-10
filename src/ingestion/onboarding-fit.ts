// WP27 stage C — the measure-fit gate (ADR 027 D1/D2/D4, brief § Stage C):
// BEFORE the job spends the expensive ingest on a candidate table, a
// metadata-only check asks "does this table actually contain a measure that
// answers this question?". Mirrors the rerank-*.ts trio (prompt + schema +
// validator + version constants) in one module: the model does a
// schema-constrained closed choice over the table's OWN measure codes plus
// 'geen' — it can reject, but it can never invent a measure (the hard
// allowlist, principle a / R3 spirit).
//
// R1/R8: this module only ever sees fetchTableSchema metadata (titles, units,
// descriptions) — never observation cells. The delivered number still comes
// exclusively from ingested, validated cells via the audited pipeline.
//
// Also home to amendment A3's DETERMINISTIC deliverability pre-checks
// (owner-approved 2026-07-08, ADR 027 § Amendments): they run BEFORE any LLM
// call, from metadata the job already fetches, and catch what no model can
// see from a measure list — v1-undeliverable table shapes.
import type { LlmClient, LlmRequest } from '../answer/llm/client.ts';
import type { CbsCode, CbsTableSchema } from '../cbs-adapter/types.ts';
import { parsePeriodCode } from './periods.ts';
import { z } from 'zod';

/** Small/fast tier (ADR 027 D4, same reasoning as TABLE_RERANK_MODEL): a
 * closed choice over a supplied list is the easy shape; the principle-(c)
 * risk is contained structurally (allowlist + threshold + try-next-candidate
 * + the delivery gate), not by model size. Escalation ladder Haiku → Sonnet
 * is a one-line change, triggered ONLY by a measured accuracy miss. */
export const MEASURE_FIT_MODEL = 'claude-haiku-4-5';

/** Documentation constant (the re-record is forced by the prompt BYTES being
 * hashed, not by this number) — mirrors RERANK_PROMPT_VERSION. */
export const MEASURE_FIT_PROMPT_VERSION = 1;

/** Bumped whenever the output contract shape changes (forces a fixture
 * re-record) — mirrors RERANK_SCHEMA_VERSION. */
export const MEASURE_FIT_SCHEMA_VERSION = 1;

/** The literal the model answers when no measure in the table answers the
 * question. Kept out of the allowlist check by construction. */
export const MEASURE_FIT_NONE = 'geen';

/** Acceptance threshold — CALIBRATED 2026-07-10 (WP27 stage D, supervised):
 * kept at 0.8, same "calibrated, not moved" outcome as the finder's session-25
 * calibration. Measured on benchmark/measurefit-labelled-set.json (6/6
 * correct, live Haiku record): correct-accept floor 0.95 (uniform across all
 * three accept cases — margin 0.15 above this threshold); the wrong-code
 * ceiling is UNMEASURED (the model made zero wrong picks on the seed set), so
 * raising the threshold would be a guess, not a calibration. Failure direction
 * is safe both ways: a too-strict threshold advances to the next candidate and
 * at worst ends in an honest refund (never a wrong table served, principle c);
 * a hypothetical wrong accept still faces the independent delivery gate
 * (fit_note is diagnostics-only, defense in depth). Full measurements:
 * benchmark/measurefit-calibration-report.json. */
export const DEFAULT_MEASURE_FIT_CONFIG = {
  acceptThreshold: 0.8,
};

export class MeasureFitValidationError extends Error {
  readonly outputText: string;

  constructor(message: string, outputText: string) {
    super(message);
    this.name = 'MeasureFitValidationError';
    this.outputText = outputText;
  }
}

/** The validated verdict. `measureCode === null` means the model answered
 * 'geen' — no measure in this table answers the question. */
export interface MeasureFitResult {
  measureCode: string | null;
  /** Model confidence 0..1 in the verdict (range-checked in code). */
  confidence: number;
  /** One short Dutch sentence explaining the verdict — recorded as the row's
   * fit_note diagnostics on acceptance; never rendered to the user. */
  reading: string;
}

/** The injectable fit seam the job consumes (tests inject a stub, exactly
 * like RerankFn / OnboardingFinderDeps.rerank — routing is provable without
 * the LLM harness). Production is a closure over measureFit(client). */
export type MeasureFitFn = (question: string, schema: CbsTableSchema) => Promise<MeasureFitResult>;

const measureFitSchema = z.strictObject({
  version: z.literal(MEASURE_FIT_SCHEMA_VERSION),
  /** A measure code copied verbatim from the supplied list, or 'geen'. */
  measureCode: z.string(),
  /** Confidence 0..1 in the verdict (range-checked in code). */
  confidence: z.number(),
  /** One short Dutch sentence explaining the verdict. */
  reading: z.string(),
});

/** Same generation path as rerank-schema.ts for consistency. */
export function measureFitJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(measureFitSchema) as Record<string, unknown>;
}

/**
 * Parses + validates the model's output against the table's own measure
 * codes. Throws MeasureFitValidationError (never a partial result) on invalid
 * JSON, schema violation, confidence outside 0..1, or — the hard allowlist —
 * a measureCode that is neither 'geen' nor one of `measureCodes`. The
 * job records a throw as 'errored' and advances to the next candidate
 * (ADR 027 D2b) — a malformed verdict is never a fit and never a misfit.
 */
export function validateMeasureFitOutput(outputText: string, measureCodes: string[]): MeasureFitResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new MeasureFitValidationError(
      `measure-fit output is not valid JSON: ${(error as Error).message}`,
      outputText,
    );
  }
  const result = measureFitSchema.safeParse(parsed);
  if (!result.success) {
    throw new MeasureFitValidationError(
      `measure-fit output violates the schema: ${result.error.message}`,
      outputText,
    );
  }
  const data = result.data;

  if (!Number.isFinite(data.confidence) || data.confidence < 0 || data.confidence > 1) {
    throw new MeasureFitValidationError(
      `measure-fit confidence ${data.confidence} is outside 0..1`,
      outputText,
    );
  }

  if (data.measureCode === MEASURE_FIT_NONE) {
    return { measureCode: null, confidence: data.confidence, reading: data.reading };
  }
  if (!measureCodes.includes(data.measureCode)) {
    throw new MeasureFitValidationError(
      `measure-fit chose measure code '${data.measureCode}' which is NOT in the table's ` +
        `measure list (${measureCodes.join(', ') || '<empty>'}) and is not '${MEASURE_FIT_NONE}' ` +
        `— the model may not invent a measure`,
      outputText,
    );
  }
  return { measureCode: data.measureCode, confidence: data.confidence, reading: data.reading };
}

/** Per-measure description budget in the prompt — a table can carry dozens of
 * measures with paragraph-length CBS descriptions; cap tokens while keeping
 * enough text to distinguish stock vs flow vs rate. */
const DESCRIPTION_MAX = 240;

// Static + date-free (ADR 012 hash-stability), exactly like the rerank prompt.
// NOTE "version is altijd 1" refers to the OUTPUT schema's version literal
// (MEASURE_FIT_SCHEMA_VERSION, validated by z.literal) — NOT to
// MEASURE_FIT_PROMPT_VERSION above. Changing either side alone breaks every
// fit check.
const SYSTEM_PROMPT = `Je bent een controle-hulp voor checkdecijfers.nl, een dienst die vragen beantwoordt met officiële CBS-cijfers. Je krijgt de VOLLEDIGE VRAAG van een gebruiker (Nederlands) en de MATENLIJST van één CBS-tabel (code, titel, eenheid en omschrijving per maat). Beoordeel of één van deze maten de vraag direct kan beantwoorden.

Regels:
- Kies precies één measureCode, LETTERLIJK overgenomen uit de lijst (inclusief hoofd-/kleine letters), OF antwoord 'geen'. Verzin nooit een code die niet in de lijst staat.
- Let op wat voor soort cijfer de vraag nodig heeft: een stand of totaal aantal op een moment ("hoeveel mensen zitten er in ..."), een in- of uitstroom of verandering ("hoeveel kwamen erbij"), een prijs, een index, een percentage. Een maat die het verkeerde soort cijfer meet (bijvoorbeeld instroom terwijl de vraag om het totale aantal vraagt), beantwoordt de vraag NIET.
- Antwoord 'geen' wanneer geen enkele maat het gevraagde soort cijfer meet. Een eerlijke afwijzing is beter dan een maat die er alleen qua onderwerp op lijkt — de dienst probeert daarna een andere tabel.
- Geef bij twijfel tussen een totaalmaat en een deelmaat (een uitsplitsing naar leeftijd, geslacht of iets dergelijks) de voorkeur aan de totaalmaat.
- confidence is een getal tussen 0 en 1 en moet eerlijk zijn: hoog alleen bij een duidelijke, ondubbelzinnige match tussen wat de vraag vraagt en wat de maat meet. Ook een 'geen'-antwoord krijgt een eerlijke confidence.
- reading: één korte Nederlandse zin die je oordeel uitlegt.
- version is altijd 1.

Antwoord uitsluitend met JSON volgens het opgegeven schema.`;

export function buildMeasureFitSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

/** Collapses CBS's multi-line descriptions to a single trimmed, budgeted line
 * (same shape as rerank-prompt.ts's condense). */
function condense(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > DESCRIPTION_MAX ? `${flat.slice(0, DESCRIPTION_MAX)}…` : flat;
}

/** The user-turn payload: the full question + the table's identity + its
 * numbered measure list. Metadata only (R1). */
export function serializeMeasureList(question: string, schema: CbsTableSchema): string {
  const lines = schema.measures.map((m, i) => {
    const blurb = condense(m.description);
    return (
      `${i + 1}. measureCode=${m.code} | eenheid=${m.unit || 'onbekend'}\n` +
      `   titel: ${m.title}` +
      (blurb ? `\n   omschrijving: ${blurb}` : '')
    );
  });
  return (
    `Volledige vraag van de gebruiker: "${question}"\n` +
    `Tabel: ${schema.tableId} — ${schema.title}\n\nMaten in deze tabel:\n${lines.join('\n')}`
  );
}

export interface MeasureFitOptions {
  client: LlmClient;
  model?: string;
  maxTokens?: number;
}

export function buildMeasureFitRequest(
  question: string,
  schema: CbsTableSchema,
  options: Pick<MeasureFitOptions, 'model' | 'maxTokens'> = {},
): LlmRequest {
  return {
    model: options.model ?? MEASURE_FIT_MODEL,
    // Small JSON output (code + confidence + one Dutch sentence); 1024
    // mirrors the rerank's headroom reasoning — a max_tokens stop throws in
    // the harness, the job records 'errored' and tries the next candidate
    // (fail-safe, never a fabrication).
    maxTokens: options.maxTokens ?? 1024,
    temperature: 0,
    system: buildMeasureFitSystemPrompt(),
    question: serializeMeasureList(question, schema),
    jsonSchema: measureFitJsonSchema(),
  };
}

/**
 * The fit check: does this table contain a measure that answers the question?
 * Throws MeasureFitValidationError on malformed or off-allowlist output — the
 * job catches it, records 'errored' and advances to the next candidate, so a
 * fit failure is never a wrong table (principle c).
 */
export async function measureFit(
  question: string,
  schema: CbsTableSchema,
  options: MeasureFitOptions,
): Promise<MeasureFitResult> {
  const request = buildMeasureFitRequest(question, schema, options);
  const response = await options.client.complete(request);
  return validateMeasureFitOutput(
    response.outputText,
    schema.measures.map((m) => m.code),
  );
}

// ---------------------------------------------------------------------------
// Amendment A3 — deterministic deliverability pre-checks (owner-approved
// 2026-07-08). Run BEFORE any LLM call; either failure means the candidate is
// 'undeliverable' (a verdict — groups with 'geen', advances to the next
// candidate), never an error.
// ---------------------------------------------------------------------------

/** A3(a): v1 can only deliver tables whose dimensions are time-only. Any
 * breakdown or geo dimension means the ingest stores no dims='{}' rows and
 * the vocabulary registers ZERO measures — the ACTUAL live bijstand failure
 * (#111): a measure-honest fit would accept the table and the row would still
 * die at delivery. A table with no time dimension at all can never resolve a
 * period, so it fails too. */
export function hasOnlyTimeDimensions(schema: CbsTableSchema): boolean {
  return (
    schema.dimensions.length > 0 && schema.dimensions.every((d) => d.kind === 'TimeDimension')
  );
}

/** A3(b) trigger: does the question name a bare calendar year ("… in 2023
 * …")? Such a question resolves to a JJ period, and requireGrain('JJ')
 * honestly refuses when the table publishes only months/quarters. */
export function questionNamesBareYear(questionText: string): boolean {
  return /\b(19|20)\d{2}\b/.test(questionText);
}

/** A3(b): the candidate's period code list must contain at least one
 * whole-year (JJ) code for a bare-year question to be answerable from it. */
export function hasYearlyPeriodCodes(codes: CbsCode[]): boolean {
  return codes.some((c) => parsePeriodCode(c.code)?.grain === 'JJ');
}
