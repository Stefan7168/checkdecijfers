// Insights AI phrasing (session 94 owner ask): turns the deterministic
// findings from insights.ts's scoreFindings into short, punchy, journalist-
// angled sentences — via the SAME digit-free slot-filling mechanism ADR-
// draft (answer/compose/slots.ts) proved for the core answer pipeline: the
// model writes placeholder prose with ZERO digits, deterministic code fills
// the real numbers afterward, so a fabricated number is not caught — it is
// UNREPRESENTABLE. This module reuses format.ts's/validate.ts's generic,
// already-hardened digit-scan and word-form checks directly rather than
// rebuilding them; it does NOT reuse ValidatedResult-coupled machinery
// (checkBinding, buildAllowedNumbers) since a chart finding has no query
// cells/derivations to bind against — a finding's OWN slots are its whole
// closed menu.
//
// Per-finding, not whole-batch: one finding's sentence failing validation
// does not cost the others their AI phrasing — only the still-missing
// findings are retried (ONE stricter round), and whatever remains missing
// after that simply has no entry in the returned map. The caller (chart-
// insights-actions.ts) never treats an absent entry as an error: the
// caller's own deterministic template caption (chart-insights.ts, built
// BEFORE this ever runs) is the R3 floor for that finding.
import { z } from 'zod';
import type { FindingKind, ScoredFinding } from './insights.ts';
import type { LlmCallOptions, LlmRequest, LlmUsage } from '../answer/llm/client.ts';
import { findNumericTokens, normalizeForScan } from '../answer/compose/format.ts';
import { mentions, wordFormProblems } from '../answer/compose/validate.ts';
import { PHRASING_MODEL } from '../answer/compose/prompt.ts';

export const INSIGHTS_PROMPT_VERSION = 1;

interface FindingSlots {
  valueSlot: string;
  periodSlot: string;
  fromValueSlot?: string;
  fromPeriodSlot?: string;
}

function isJump(kind: FindingKind): boolean {
  return kind === 'jumpUp' || kind === 'jumpDown';
}

function slotsFor(finding: ScoredFinding): FindingSlots {
  return {
    valueSlot: `waarde-${finding.id}`,
    periodSlot: `periode-${finding.id}`,
    ...(isJump(finding.kind)
      ? { fromValueSlot: `waarde-van-${finding.id}`, fromPeriodSlot: `periode-van-${finding.id}` }
      : {}),
  };
}

function ownSlotSet(slots: FindingSlots): Set<string> {
  return new Set([slots.valueSlot, slots.periodSlot, slots.fromValueSlot, slots.fromPeriodSlot].filter((s): s is string => s !== undefined));
}

/** Digit-free unit descriptor for the payload — mirrors slots.ts's own
 * unitKind(): the model gets the SEMANTIC kind, never a digit-bearing unit
 * string (a factor like 'x 1 000' could otherwise be echoed as a fabricated
 * number). The real unit is attached by fillFinding below, structurally. */
function unitKind(unit: string): string {
  const trimmed = unit.trim();
  if (trimmed === '%') return 'procent';
  if (/\d/.test(trimmed)) return 'factor';
  return trimmed;
}

interface InsightFindingPayload {
  id: string;
  kind: FindingKind;
  seriesLabel: string | null;
  unitKind: string;
  valueSlot: string;
  periodSlot: string;
  fromValueSlot?: string;
  fromPeriodSlot?: string;
}

export interface InsightPhrasePayload {
  findings: InsightFindingPayload[];
  slots: string[];
}

export function buildInsightPhrasePayload(findings: ScoredFinding[]): InsightPhrasePayload {
  const payloadFindings = findings.map((f) => {
    const slots = slotsFor(f);
    return {
      id: f.id,
      kind: f.kind,
      seriesLabel: f.multiSeries ? f.seriesLabel : null,
      unitKind: unitKind(f.unit),
      ...slots,
    };
  });
  return { findings: payloadFindings, slots: payloadFindings.flatMap((f) => [f.valueSlot, f.periodSlot, f.fromValueSlot, f.fromPeriodSlot].filter((s): s is string => s !== undefined)) };
}

function buildSystemPrompt(): string {
  return [
    'Je schrijft voor checkdecijfers.nl korte, pakkende zinnen over opvallende punten in een grafiek — bedoeld voor een journalist die op zoek is naar iets om over te berichten.',
    "Per item in het veld 'findings' schrijf je PRECIES ÉÉN zin. De waarden en periodes zelf zijn vervangen door benoemde invulvelden (placeholders); na jouw tekst vult gecontroleerde code de echte waarden in.",
    '',
    'Verplichte regels:',
    "1. Schrijf NOOIT een cijfer (0-9) — geen jaartal, datum of aantal. Noem een waarde of periode UITSLUITEND via de placeholder uit de eigen velden van dat item ('valueSlot', 'periodSlot', en bij kind 'jumpUp'/'jumpDown' ook 'fromValueSlot'/'fromPeriodSlot'), letterlijk in accolades.",
    "2. Gebruik voor een finding UITSLUITEND DIENS EIGEN placeholders — nooit die van een andere finding uit de lijst.",
    "3. Noem in de zin altijd de periode-placeholder ('periodSlot'); bij kind 'jumpUp'/'jumpDown' noem ook 'fromPeriodSlot' (de periode waarvandaan de verandering ging).",
    "4. Als 'seriesLabel' niet null is, noem die naam ergens in de zin, exact zoals gegeven.",
    "5. Schrijf hoeveelheden nooit in woorden — geen telwoorden ('twee', 'tien'), geen schaalwoorden ('duizend', 'miljoen', 'miljard'), geen breuken of veelvouden.",
    "6. De eenheid wordt automatisch bij elk ingevuld getal geplaatst; schrijf zelf geen eenheid of procent-teken.",
    "7. Kind 'jumpUp'/'recordHigh' is een stijging/hoog punt, 'jumpDown'/'recordLow' een daling/laag punt — laat dat in de toon van de zin doorklinken zonder een richting te beweren die niet uit 'kind' volgt.",
    '8. Puur de constatering — geen inleiding, geen mening, geen bronvermelding. Eén zin, aantrekkelijk voor een nieuwsbericht.',
    "9. Antwoord met EXACT één entry per finding-id uit het blok GEGEVENS — geen ontbrekende, geen verzonnen ids.",
  ].join('\n');
}

const RETRY_SUFFIX = [
  '',
  'STRENGER: een eerdere poging bevatte een cijfer, telwoord, onbekende placeholder, of miste een verplichte placeholder.',
  'Gebruik UITSLUITEND de placeholders van elke finding zelf (letterlijk, in accolades), schrijf geen enkel cijfer of telwoord.',
].join('\n');

const insightResponseSchema = z.strictObject({
  insights: z.array(z.strictObject({ id: z.string(), text: z.string() })),
});

export function insightResponseJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(insightResponseSchema) as Record<string, unknown>;
}

export interface InsightPhraseRequestOptions {
  model?: string;
  maxTokens?: number;
  strict?: boolean;
}

export function buildInsightPhraseRequest(findings: ScoredFinding[], options: InsightPhraseRequestOptions = {}): LlmRequest {
  const payload = buildInsightPhrasePayload(findings);
  return {
    model: options.model ?? PHRASING_MODEL,
    maxTokens: options.maxTokens ?? Math.min(2048, 512 + 128 * findings.length),
    temperature: 0,
    system: buildSystemPrompt() + (options.strict ? RETRY_SUFFIX : ''),
    question: `GEGEVENS (waarden en periodes als placeholders):\n${JSON.stringify(payload, null, 2)}\n\nSchrijf nu de zinnen, met placeholders.`,
    jsonSchema: insightResponseJsonSchema(),
    thinking: 'disabled',
  };
}

/** The pre-fill gate over ONE finding's raw placeholder sentence — mirrors
 * validateSlotBody's rules (answer/compose/slots.ts), scoped to a single
 * finding's own closed menu instead of a whole-answer one: (i) zero digits
 * outside a valid placeholder, (ii) every placeholder ∈ this finding's own
 * menu, (iii) no malformed braces, (iv) the Dutch number/scale word-form
 * rejection (shared verbatim with the legacy validator), (v) the value slot
 * and every period slot this finding declares must appear, (vi) a declared
 * seriesLabel must be mentioned. */
function validateFindingText(text: string, slots: FindingSlots, seriesLabel: string | null): string[] {
  const problems: string[] = [];
  const body = normalizeForScan(text);
  const ownSlots = ownSlotSet(slots);

  for (const match of body.matchAll(/\{([^{}]*)\}/g)) {
    if (!ownSlots.has(match[1]!)) problems.push(`onbekende placeholder '${match[0]}'`);
  }
  const masked = body.replace(/\{([^{}]*)\}/g, (m, name: string) => (ownSlots.has(name) ? ' '.repeat(m.length) : m));
  if (/[{}]/.test(masked)) problems.push("losse of misvormde accolade — placeholders moeten '{naam}' zijn");
  for (const match of masked.matchAll(/\d+(?:[.,]\d+)*/g)) {
    problems.push(`cijfer '${match[0]}' buiten een placeholder`);
  }
  problems.push(...wordFormProblems(masked));

  if (!body.includes(`{${slots.valueSlot}}`)) problems.push('waarde-placeholder ontbreekt');
  if (!body.includes(`{${slots.periodSlot}}`)) problems.push('periode-placeholder ontbreekt');
  if (slots.fromValueSlot !== undefined && !body.includes(`{${slots.fromValueSlot}}`)) {
    problems.push('vorige-waarde-placeholder ontbreekt');
  }
  if (slots.fromPeriodSlot !== undefined && !body.includes(`{${slots.fromPeriodSlot}}`)) {
    problems.push('vorige-periode-placeholder ontbreekt');
  }
  if (seriesLabel !== null && !mentions(body, seriesLabel)) {
    problems.push(`reeksnaam '${seriesLabel}' wordt niet genoemd`);
  }
  return problems;
}

/** Deterministic fill: the SAME {value} {unit} convention chart-insights.ts's
 * own template captions already use (not answer/compose/template.ts's
 * displayValueUnit — a different, answer-prose-specific convention). */
function fillFinding(text: string, finding: ScoredFinding, slots: FindingSlots): string {
  const provisional = finding.provisional ? ' (voorlopig cijfer)' : '';
  const fills = new Map<string, string>([
    [slots.valueSlot, `${finding.formattedValue} ${finding.unit}${provisional}`],
    [slots.periodSlot, finding.periodLabel],
  ]);
  if (slots.fromValueSlot !== undefined) fills.set(slots.fromValueSlot, `${finding.fromFormattedValue ?? ''} ${finding.unit}`);
  if (slots.fromPeriodSlot !== undefined) fills.set(slots.fromPeriodSlot, finding.fromPeriodLabel ?? '');
  return text.replace(/\{([^{}]*)\}/g, (whole, name: string) => fills.get(name) ?? whole);
}

function parseResponse(outputText: string): { id: string; text: string }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    return [];
  }
  const result = insightResponseSchema.safeParse(parsed);
  return result.success ? result.data.insights : [];
}

export type ComposeInsightsOptions = LlmCallOptions;

export interface ComposeInsightsResult {
  /** finding id -> phrased, filled sentence. Absent id = no AI phrasing
   * survived validation for that finding; the caller keeps its own
   * deterministic caption. */
  phrased: Map<string, string>;
  model: string | null;
  usage: LlmUsage;
}

/** One attempt over a SUBSET of findings (used for both the first pass over
 * everything and the retry over just what's still missing): call the LLM,
 * validate + fill each returned entry independently, return only the ones
 * that passed. Never throws — an API error yields an empty result, same as
 * a validation failure, so the caller's floor always holds. */
async function attemptPhrasing(
  findings: ScoredFinding[],
  options: ComposeInsightsOptions,
  strict: boolean,
  usage: LlmUsage,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (findings.length === 0) return out;
  const byId = new Map(findings.map((f) => [f.id, f]));
  try {
    const response = await options.client.complete(
      buildInsightPhraseRequest(findings, { model: options.model, maxTokens: options.maxTokens, strict }),
    );
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    for (const entry of parseResponse(response.outputText)) {
      const finding = byId.get(entry.id);
      if (finding === undefined) continue; // invented id — ignored, not fatal to the rest
      const slots = slotsFor(finding);
      const problems = validateFindingText(entry.text, slots, finding.multiSeries ? finding.seriesLabel : null);
      if (problems.length > 0) continue;
      out.set(entry.id, fillFinding(normalizeForScan(entry.text.trim()), finding, slots));
    }
  } catch {
    // API error / network failure: return whatever this attempt already
    // found (nothing, on the first exception) — fail closed to the caller's
    // template floor, never throw.
  }
  return out;
}

/** The R3-style ladder for Insights: one LLM pass over every finding, then
 * ONE stricter retry over only the findings still missing a valid sentence.
 * Whatever remains missing after that has no entry — the deterministic
 * template caption (chart-insights.ts) already covers it. */
export async function composeInsights(findings: ScoredFinding[], options: ComposeInsightsOptions): Promise<ComposeInsightsResult> {
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  if (findings.length === 0) return { phrased: new Map(), model: null, usage };

  const first = await attemptPhrasing(findings, options, false, usage);
  const missing = findings.filter((f) => !first.has(f.id));
  if (missing.length === 0) return { phrased: first, model: options.model ?? PHRASING_MODEL, usage };

  const retried = await attemptPhrasing(missing, options, true, usage);
  return { phrased: new Map([...first, ...retried]), model: options.model ?? PHRASING_MODEL, usage };
}
