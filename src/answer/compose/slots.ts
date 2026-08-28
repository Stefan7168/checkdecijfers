// #162 — number-free phrasing via typed slots (ADR-DRAFT
// docs/session-briefs/2026-07-19-adr-draft-slot-filling.md, HERMETIC HALF).
//
// The inversion of the see-and-echo risk model: the phrasing LLM writes the
// body with typed placeholders ({waarde1}, {periode1}, {verschil1}) and ZERO
// digits; deterministic code fills the slots AFTER phrasing from the validated
// result, through the SAME formatters the template rung already proves
// (displayValueUnit / displayDifferenceUnit / provisionalSuffix). A fabricated
// digit is then not caught — it is unrepresentable (R3 becomes structural on
// this path; the legacy validator still runs on the filled body as a belt).
//
// EXPERIMENT STATUS: additive, behind `SLOT_PHRASING_ENABLED` (OFF by
// default, and off in production). Flag off ⇒ byte-identical pipeline —
// proven by test. The §6 A/B (blind pairwise phrasing judge + owner
// read-back) has NOT run; this module is the mechanism only. Do not flip the
// flag outside an owner-supervised session.
import type { DerivationRecord, ResultCell, ValidatedResult } from '../../query/index.ts';
import type { LlmRequest } from '../llm/client.ts';
import { normalizeForScan } from './format.ts';
import { PHRASING_MODEL, TREND_WORD_BY_DIRECTION } from './prompt.ts';
import { displayDifferenceUnit, displayValueUnit, provisionalSuffix } from './template.ts';
import { baseRegionLabel, mentions, splitSentences, wordFormProblems } from './validate.ts';
import type { AnswerValidationReport, SlotBinding } from './types.ts';

/** Bump when the slot prompt's structure or rules change meaningfully —
 * recorded as the answer's promptVersion when the slot rung wrote the body
 * (its own numbering, independent of the legacy COMPOSE_PROMPT_VERSION; the
 * `slotPhrasing` envelope key is what marks the rung). */
export const SLOT_COMPOSE_PROMPT_VERSION = 1;

// ---------------------------------------------------------------------------
// The slot context — one pure function of the ValidatedResult
// ---------------------------------------------------------------------------
//
// Everything the slot pipeline needs — the closed menu, the fill strings, the
// R1/R8 slot map, and the R9 placeholder-level binding demands — derives HERE
// and nowhere else, so compose-time filling and R8 reconstruction can never
// drift: reconstruct re-derives this context from the STORED result and
// re-fills the stored raw body through it.

/** R9 demands for one value-bearing slot, mirrored from the legacy
 * checkBinding semantics at placeholder level (ADR-draft §1 rule v). */
export interface SlotDemand {
  /** Period slots of which ≥1 must share every sentence the slot appears in
   * (a cell slot when >1 distinct periods: exactly its own; a verschil slot:
   * its source cells' period slots). Empty = no same-sentence period demand. */
  sentencePeriodSlots: string[];
  /** Period slots that must each appear SOMEWHERE in the body when this slot
   * is used (a verschil slot names BOTH its periods — legacy parity). */
  bodyPeriodSlots: string[];
  /** Region label that must share every sentence the slot appears in (cell
   * slots when >1 distinct regions); null = no demand. */
  sentenceRegionLabel: string | null;
}

export interface SlotContext {
  /** The closed menu, in payload order: waarde* (per non-null cell, cell
   * order), periode* (per distinct periodCode, first-appearance order),
   * verschil* (per difference/direction derivation, derivations order). */
  menu: string[];
  /** slot id → the deterministic fill string (template-rung formatters). */
  fills: Map<string, string>;
  /** The R1/R8 slot map, in menu order — what the audit record stores. */
  bindings: SlotBinding[];
  /** The waarde- and verschil-slot ids — rule (iii)'s "≥1 value slot" set. */
  valueSlots: string[];
  /** Per value-bearing slot: its R9 binding demands. */
  demands: Map<string, SlotDemand>;
  /** Single-axis whole-body demands (legacy checkBinding's dataShown branch):
   * apply as soon as ANY value slot is used. */
  globalBodyPeriodSlot: string | null;
  globalBodyRegionLabel: string | null;
  /** Lookups for the payload builder. */
  valueSlotByResultId: Map<string, string>;
  periodSlotByResultId: Map<string, string>;
  derivationSlotByIndex: Map<number, string>;
}

function derivationSourceIds(d: DerivationRecord): string[] {
  switch (d.kind) {
    case 'difference':
      return [d.subtrahendResultId, d.minuendResultId];
    case 'direction':
      return [d.firstResultId, d.lastResultId];
    default:
      return [];
  }
}

export function buildSlotContext(result: ValidatedResult): SlotContext {
  const cells = result.cells;
  const cellsById = new Map(cells.map((c) => [c.resultId, c]));
  const distinctPeriods = new Set(cells.map((c) => c.periodCode)).size;
  const distinctRegions = new Set(cells.map((c) => c.regionCode)).size;

  const fills = new Map<string, string>();
  const demands = new Map<string, SlotDemand>();
  const valueSlotByResultId = new Map<string, string>();
  const periodSlotByResultId = new Map<string, string>();
  const derivationSlotByIndex = new Map<number, string>();

  // Period slots: one per distinct periodCode, first-appearance order (cells
  // are ordered period-ascending), filled with the verbatim ingested
  // periodLabel — the never-re-derived discipline (ADR-draft §1). The binding
  // records the FIRST cell carrying the period (deterministic).
  const periodSlotByCode = new Map<string, { slot: string; cell: ResultCell }>();
  for (const cell of cells) {
    if (!periodSlotByCode.has(cell.periodCode)) {
      const slot = `periode${periodSlotByCode.size + 1}`;
      periodSlotByCode.set(cell.periodCode, { slot, cell });
      fills.set(slot, cell.periodLabel);
    }
    periodSlotByResultId.set(cell.resultId, periodSlotByCode.get(cell.periodCode)!.slot);
  }

  // Value slots: sequential over the NON-NULL cells (null-cell results skip
  // the LLM entirely — compose.ts's hasNullCells guard — so on the live path
  // every cell gets a slot; the filter is the defensive belt for reconstruct
  // runs against tampered records).
  const valueBindings: SlotBinding[] = [];
  let valueCount = 0;
  for (const cell of cells) {
    if (cell.value === null) continue;
    valueCount += 1;
    const slot = `waarde${valueCount}`;
    valueSlotByResultId.set(cell.resultId, slot);
    // R10 + R11 structural: value + unit through the template rung's proven
    // formatter, the registry-worded provisional marking appended by code.
    fills.set(slot, `${displayValueUnit(cell.value, cell.decimals, cell.unit)}${provisionalSuffix(cell)}`);
    valueBindings.push({ slot, kind: 'value', resultId: cell.resultId, derivationIndex: null });
    demands.set(slot, {
      sentencePeriodSlots: distinctPeriods > 1 ? [periodSlotByResultId.get(cell.resultId)!] : [],
      bodyPeriodSlots: [],
      sentenceRegionLabel:
        distinctRegions > 1 && cell.regionLabel !== null ? baseRegionLabel(cell.regionLabel) : null,
    });
  }

  const periodBindings: SlotBinding[] = [...periodSlotByCode.values()].map(({ slot, cell }) => ({
    slot,
    kind: 'period',
    resultId: cell.resultId,
    derivationIndex: null,
  }));

  // Verschil slots: one per difference/direction derivation (the value-
  // bearing kinds), in derivations order. A max derivation gets NO slot of
  // its own — its value IS the winner cell's value by construction, so the
  // payload points it at the winner's waarde slot. first_last and
  // unit_expansion carry no body value either.
  const verschilBindings: SlotBinding[] = [];
  let verschilCount = 0;
  result.derivations.forEach((d, index) => {
    if (d.kind !== 'difference' && d.kind !== 'direction') return;
    verschilCount += 1;
    const slot = `verschil${verschilCount}`;
    derivationSlotByIndex.set(index, slot);
    const value = d.kind === 'difference' ? d.value : d.netChange;
    // Decimals from the later/last source cell (the template's renderDifference
    // uses the minuend's) — same-measure cells share decimals in practice.
    const refCell = cellsById.get(d.kind === 'difference' ? d.minuendResultId : d.lastResultId);
    const decimals = refCell?.decimals ?? cells[0]?.decimals ?? 0;
    // R11 structural for derived values too: a derivation computed from a
    // provisional source cell carries the marking in its own rendering, so the
    // same-sentence rule holds wherever the model places the slot.
    const provisionalSource = derivationSourceIds(d)
      .map((id) => cellsById.get(id))
      .find((c) => c?.provisional === true);
    fills.set(
      slot,
      `${displayDifferenceUnit(Math.abs(value), decimals, d.unit)}${provisionalSource ? provisionalSuffix(provisionalSource) : ''}`,
    );
    verschilBindings.push({ slot, kind: 'derivation', resultId: null, derivationIndex: index });
    const sourcePeriodSlots = [
      ...new Set(
        derivationSourceIds(d)
          .map((id) => periodSlotByResultId.get(id))
          .filter((s): s is string => s !== undefined),
      ),
    ];
    demands.set(slot, {
      sentencePeriodSlots: sourcePeriodSlots,
      bodyPeriodSlots: sourcePeriodSlots,
      sentenceRegionLabel: null,
    });
  });

  const bindings = [...valueBindings, ...periodBindings, ...verschilBindings];
  const firstCell = cells[0];
  return {
    menu: bindings.map((b) => b.slot),
    fills,
    bindings,
    valueSlots: [...valueBindings, ...verschilBindings].map((b) => b.slot),
    demands,
    globalBodyPeriodSlot:
      distinctPeriods === 1 && firstCell !== undefined
        ? (periodSlotByResultId.get(firstCell.resultId) ?? null)
        : null,
    globalBodyRegionLabel:
      distinctRegions === 1 && firstCell !== undefined && firstCell.regionLabel !== null
        ? baseRegionLabel(firstCell.regionLabel)
        : null,
    valueSlotByResultId,
    periodSlotByResultId,
    derivationSlotByIndex,
  };
}

// ---------------------------------------------------------------------------
// The slot payload (R2, stronger: no values at all) and the request
// ---------------------------------------------------------------------------

/** Digit-free unit descriptor for the payload. The filler renders the REAL
 * unit verbatim (R10 structural); the model only needs the semantic kind —
 * and digit-bearing factor/index-base strings ('x 1 000', '2015=100') stay
 * out so they can never be echoed into a digit reject. */
function unitKind(unit: string): string {
  const trimmed = unit.trim();
  if (trimmed === '%') return 'procent';
  if (/\d/.test(trimmed)) return 'factor';
  return trimmed;
}

function differenceUnitKind(unit: string): string {
  return unit.trim() === '%' ? 'procentpunt' : unitKind(unit);
}

const PERIOD_KIND_BY_GRAIN: Record<string, string> = { JJ: 'jaar', KW: 'kwartaal', MM: 'maand' };

/** The R2 slot payload — the ONLY fields the model ever sees on this path.
 * NO cell value, NO derivation value, NO period label reaches the model in
 * any form: the digit-bearing fields of the legacy PhrasingPayload are
 * replaced by slot ids + digit-free metadata (ADR-draft §1). definitionLabel
 * and periodSemantics stay (semantic metadata ABOUT the values, R2-allowed);
 * the zero-digit output rule keeps any digit they may carry out of the body. */
export interface SlotPhrasingPayload {
  shape: string;
  definitionLabel: string | null;
  periodSemantics: string | null;
  cells: {
    slot: string;
    periodSlot: string;
    /** 'jaar' | 'kwartaal' | 'maand' — preposition guidance, digit-free. */
    periodKind: string;
    regionLabel: string | null;
    unitKind: string;
    /** Number-noun agreement metadata (the ADR-draft's Dutch-grammar
     * mitigation): false exactly when the value is 1 or -1. */
    plural: boolean;
    provisional: boolean;
  }[];
  derivations: (
    | {
        kind: 'difference' | 'direction';
        explicit: boolean;
        slot: string;
        unitKind: string;
        direction: 'up' | 'down' | 'flat';
        trendWord: string;
        monotonic?: boolean;
        /** BOTH source period slots — rule 4 tells the model to name them. */
        periodSlots: string[];
      }
    | { kind: 'max'; explicit: boolean; slot?: string; winnerRegion?: string }
    | { kind: 'first_last'; explicit: boolean; firstPeriodSlot?: string; lastPeriodSlot?: string }
  )[];
  /** The closed menu — nothing else is legal (rule ii's whitelist). */
  slots: string[];
}

export function buildSlotPhrasingPayload(result: ValidatedResult, context: SlotContext): SlotPhrasingPayload {
  const cellsById = new Map(result.cells.map((c) => [c.resultId, c]));
  return {
    shape: result.shape,
    definitionLabel: result.attribution.definitionLabel,
    periodSemantics: result.attribution.periodSemantics,
    cells: result.cells
      .filter((cell) => cell.value !== null)
      .map((cell) => ({
        slot: context.valueSlotByResultId.get(cell.resultId)!,
        periodSlot: context.periodSlotByResultId.get(cell.resultId)!,
        periodKind: PERIOD_KIND_BY_GRAIN[cell.grain] ?? 'periode',
        regionLabel: cell.regionLabel === null ? null : baseRegionLabel(cell.regionLabel),
        unitKind: unitKind(cell.unit),
        plural: cell.value !== null && Math.abs(cell.value) !== 1,
        provisional: cell.provisional,
      })),
    // unit_expansion records are display-only and NEVER serialized to the
    // model (ADR 031 D3) — same filter as the legacy payload.
    derivations: result.derivations
      .map((d, index) => ({ d, index }))
      .filter(({ d }) => d.kind !== 'unit_expansion')
      .map(({ d, index }) => {
        switch (d.kind) {
          case 'difference': {
            const direction = d.value > 0 ? ('up' as const) : d.value < 0 ? ('down' as const) : ('flat' as const);
            return {
              kind: d.kind,
              explicit: d.explicit,
              slot: context.derivationSlotByIndex.get(index)!,
              unitKind: differenceUnitKind(d.unit),
              direction,
              trendWord: TREND_WORD_BY_DIRECTION[direction],
              periodSlots: derivationSourceIds(d)
                .map((id) => context.periodSlotByResultId.get(id))
                .filter((s): s is string => s !== undefined),
            };
          }
          case 'direction':
            return {
              kind: d.kind,
              explicit: d.explicit,
              slot: context.derivationSlotByIndex.get(index)!,
              unitKind: differenceUnitKind(d.unit),
              direction: d.direction,
              trendWord: TREND_WORD_BY_DIRECTION[d.direction],
              monotonic: d.monotonic,
              periodSlots: derivationSourceIds(d)
                .map((id) => context.periodSlotByResultId.get(id))
                .filter((s): s is string => s !== undefined),
            };
          case 'max': {
            const winner = cellsById.get(d.winnerResultId);
            return {
              kind: d.kind,
              explicit: d.explicit,
              // The winner's value already has a slot — the max derivation
              // points at it rather than minting a duplicate.
              slot: context.valueSlotByResultId.get(d.winnerResultId),
              winnerRegion: winner?.regionLabel ? baseRegionLabel(winner.regionLabel) : undefined,
            };
          }
          case 'first_last': {
            const first = cellsById.get(d.firstResultId);
            const last = cellsById.get(d.lastResultId);
            return {
              kind: d.kind,
              explicit: d.explicit,
              firstPeriodSlot: first === undefined ? undefined : context.periodSlotByResultId.get(first.resultId),
              lastPeriodSlot: last === undefined ? undefined : context.periodSlotByResultId.get(last.resultId),
            };
          }
          /* v8 ignore next 2 — unreachable: unit_expansion is filtered above */
          default:
            throw new Error('unreachable');
        }
      }),
    slots: context.menu,
  };
}

/** Rules mirror the slot validator one-to-one (the legacy prompt/validator
 * discipline): everything validateSlotBody rejects, the prompt forbids. */
export function buildSlotSystemPrompt(): string {
  return [
    'Je schrijft voor checkdecijfers.nl het antwoord op een cijfervraag, in het Nederlands, op basis van een blok GEVALIDEERDE GEGEVENS (JSON). De getallen en periodes zelf zijn vervangen door benoemde invulvelden (placeholders); na jouw tekst vult gecontroleerde code de echte waarden in.',
    '',
    'Verplichte regels:',
    "1. Schrijf NOOIT een cijfer (0-9) — ook geen jaartal, datum of aantal. Elke waarde en elke periode noem je UITSLUITEND via een placeholder uit het veld 'slots', letterlijk in accolades: {waarde1}, {periode1}, {verschil1}.",
    "2. Gebruik alleen placeholders die in 'slots' staan, exact zoals ze daar staan — verzin er geen en verander de naam niet.",
    "3. Schrijf hoeveelheden ook nooit in woorden — geen telwoorden ('twee', 'tien'), geen schaalwoorden ('duizend', 'miljoen', 'miljard'), geen breuken of veelvouden ('kwart', 'helft', 'anderhalf', 'dubbel', 'verdubbeld').",
    "4. Noem in dezelfde zin als elke waarde-placeholder ({waarde…} of {verschil…}) de bijbehorende periode-placeholder (veld 'periodSlot') en, indien aanwezig, de regio (regionLabel, exact zoals gegeven). Bij een {verschil…}: noem BEIDE periode-placeholders uit het veld 'periodSlots' in het antwoord, waarvan minstens één in dezelfde zin als de {verschil…}.",
    "5. De eenheid wordt automatisch bij elk ingevuld getal geplaatst; schrijf zelf geen eenheid, procent-teken of factor bij een placeholder. Bij unitKind 'aantal' mag direct na de placeholder een passend zelfstandig naamwoord staan (bijvoorbeeld '{waarde1} inwoners'; het veld 'plural' zegt of dat enkelvoud of meervoud is).",
    "6. Een stijging/daling/'meeste'/'meer dan' mag je alleen beweren als het blok 'derivations' die richting of ranking expliciet bevat (direction, difference of max). Volg het veld 'trendWord'. Is de richting 'down', gebruik dan altijd een dalingswoord in dezelfde zin als de bijbehorende {verschil…}. Bij monotonic=false: zeg dat de reeks niet in een rechte lijn bewoog.",
    "7. Waarden met provisional=true krijgen automatisch de markering '(voorlopig cijfer)' bij het invullen; schrijf die markering niet zelf.",
    '8. Begin een zin bij voorkeur niet met een placeholder.',
    "9. Voeg GEEN bronvermelding, definitie- of licentieregel toe — die worden automatisch toegevoegd. Geen inleiding ('Hier is…'), geen mening, geen duiding buiten de gegeven gegevens. Lengte: 1 tot 4 zinnen.",
  ].join('\n');
}

const SLOT_RETRY_SUFFIX = [
  '',
  'STRENGER: een eerdere poging bevatte een cijfer, een telwoord, een onbekende placeholder of een claim die de controle niet doorstond.',
  "Gebruik UITSLUITEND placeholders uit 'slots' (letterlijk, in accolades), schrijf geen enkel cijfer of telwoord, noem bij elke waarde-placeholder de periode-placeholder in dezelfde zin, en laat elke zin weg die je niet één-op-één op het informatieblok kunt terugvoeren.",
].join('\n');

export interface SlotPhrasingRequestOptions {
  model?: string;
  maxTokens?: number;
  /** True for the single regeneration attempt — a stricter prompt, and a
   * different fixture hash, so replay distinguishes the two attempts. */
  strict?: boolean;
}

export function buildSlotPhrasingRequest(
  result: ValidatedResult,
  options: SlotPhrasingRequestOptions = {},
): LlmRequest {
  const payload = buildSlotPhrasingPayload(result, buildSlotContext(result));
  return {
    model: options.model ?? PHRASING_MODEL,
    maxTokens: options.maxTokens ?? 1024,
    system: buildSlotSystemPrompt() + (options.strict ? SLOT_RETRY_SUFFIX : ''),
    question: `GEVALIDEERDE GEGEVENS (waarden en periodes als placeholders):\n${JSON.stringify(payload, null, 2)}\n\nSchrijf nu het antwoord, met placeholders.`,
    thinking: 'disabled',
  };
}

// ---------------------------------------------------------------------------
// Pre-fill validation (ADR-draft §1's deterministic rules on the RAW body)
// ---------------------------------------------------------------------------

const PLACEHOLDER_TOKEN = /\{([^{}]*)\}/g;

/** The pre-fill gate over the model's raw placeholder body. Fail-closed like
 * the legacy validator: a problem costs one regeneration and then the
 * template. The rules, per ADR-draft §1: (ii) every {…} token ∈ the closed
 * menu, malformed braces reject; (i) zero digits outside valid placeholders
 * (NFKC-normalized — slot ids carry digits, so the tokens are masked first);
 * (iv) the Dutch number/scale word-form rejection stays (slots stop digits,
 * not 'zeventien miljoen'); (iii) ≥1 value slot (the no-value-shown guard,
 * moved pre-fill); (v) R9 binding at placeholder level — a pure string check
 * on slot tokens, no Dutch parsing needed. Rule (vi) — direction/comparison
 * words — deliberately does NOT run here: it stays as-is on the FILLED body,
 * via the full legacy validator belt (compose.ts). */
export function validateSlotBody(rawBody: string, context: SlotContext): AnswerValidationReport {
  const problems: string[] = [];
  const body = normalizeForScan(rawBody);
  const menuSet = new Set(context.menu);

  // (ii) unknown placeholders.
  for (const match of body.matchAll(PLACEHOLDER_TOKEN)) {
    if (!menuSet.has(match[1]!)) {
      problems.push(`SLOT: onbekende placeholder '${match[0]}' — alleen het gesloten slots-menu is toegestaan`);
    }
  }
  // Mask the KNOWN placeholders (same-length, index-preserving), then any
  // leftover brace is malformed ('{waarde1' unclosed, nesting, a stray '}').
  const masked = body.replace(PLACEHOLDER_TOKEN, (m, name: string) =>
    menuSet.has(name) ? ' '.repeat(m.length) : m,
  );
  if (/[{}]/.test(masked)) {
    problems.push("SLOT: losse of misvormde accolade — placeholders moeten exact '{naam}' uit het menu zijn");
  }
  // (i) zero digits outside valid placeholders — the structural core.
  for (const match of masked.matchAll(/\d+(?:[.,]\d+)*/g)) {
    problems.push(`SLOT: cijfer '${match[0]}' in de ruwe tekst — waarden en periodes mogen alleen via placeholders (R3, structureel)`);
  }
  // (iv) word forms — shared verbatim with the legacy validator.
  problems.push(...wordFormProblems(masked));

  // (iii) ≥1 value slot used.
  const usedValueSlots = context.valueSlots.filter((slot) => body.includes(`{${slot}}`));
  if (usedValueSlots.length === 0) {
    problems.push('SLOT: geen enkele waarde-placeholder gebruikt — een antwoord zonder het gevraagde cijfer is geen antwoord (R3)');
  }

  // (v) R9 binding, placeholder-level.
  const sentences = splitSentences(body);
  for (const slot of usedValueSlots) {
    const demand = context.demands.get(slot);
    if (demand === undefined) continue;
    for (const sentence of sentences) {
      if (!sentence.text.includes(`{${slot}}`)) continue;
      if (
        demand.sentencePeriodSlots.length > 0 &&
        !demand.sentencePeriodSlots.some((p) => sentence.text.includes(`{${p}}`))
      ) {
        problems.push(
          `SLOT-R9: {${slot}} staat niet in één zin met zijn periode-placeholder (${demand.sentencePeriodSlots.map((p) => `{${p}}`).join('/')})`,
        );
      }
      if (demand.sentenceRegionLabel !== null && !mentions(sentence.text, demand.sentenceRegionLabel)) {
        problems.push(`SLOT-R9: {${slot}} staat niet in één zin met de regio waar hij bij hoort (${demand.sentenceRegionLabel})`);
      }
    }
    for (const p of demand.bodyPeriodSlots) {
      if (!body.includes(`{${p}}`)) {
        problems.push(`SLOT-R9: de periode-placeholder {${p}} waarop {${slot}} is gebaseerd ontbreekt in het antwoord`);
      }
    }
  }
  if (usedValueSlots.length > 0) {
    if (context.globalBodyPeriodSlot !== null && !body.includes(`{${context.globalBodyPeriodSlot}}`)) {
      problems.push(`SLOT-R9: het antwoord noemt de periode-placeholder {${context.globalBodyPeriodSlot}} nergens`);
    }
    if (context.globalBodyRegionLabel !== null && !mentions(body, context.globalBodyRegionLabel)) {
      problems.push(`SLOT-R9: het antwoord noemt de regio '${context.globalBodyRegionLabel}' nergens`);
    }
  }

  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// The filler
// ---------------------------------------------------------------------------

/** Deterministic slot filling: every valid placeholder is replaced by its
 * pre-computed fill string (template-rung formatters — R10/R11 structural).
 * Callers pass the SCAN-NORMALIZED raw body that validateSlotBody approved
 * (compose.ts normalizes once at the rung entry; normalizeForScan is
 * idempotent, so R8 re-fills of the stored rawBody are byte-stable). An
 * unknown token is left in place — validation has already rejected such a
 * body, and on the reconstruct path a tampered token then fails the
 * byte-identity check loudly rather than being silently repaired. */
export function fillSlots(rawBody: string, context: SlotContext): string {
  return rawBody.replace(PLACEHOLDER_TOKEN, (whole, name: string) => context.fills.get(name) ?? whole);
}
