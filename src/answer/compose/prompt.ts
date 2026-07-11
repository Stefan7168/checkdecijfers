// The answer-phrasing prompt (R2): built HERE and nowhere else, typed to
// accept a ValidatedResult only — no raw rows, no ingested table, and
// deliberately NOT the user's question text either (ADR 004: "the prompt
// contains only validated results and metadata"). Keeping user-typed text out
// of the phrasing prompt also closes the prompt-injection surface; the
// validator would catch fabricated numbers anyway, but not letting them in is
// cheaper than catching them.
//
// Numbers are handed over PRE-FORMATTED in Dutch (format.ts) and the model is
// told to copy the strings — it never formats, rounds or computes (R3).
import type { ValidatedResult } from '../../query/index.ts';
import type { LlmRequest } from '../llm/client.ts';
import { formatValueNl } from './format.ts';
import { nullReasonText } from './template.ts';
import { baseRegionLabel } from './validate.ts';

/** Mid-tier model for phrasing per ADR 004 ("model per task"); concrete ID is
 * an implementation-time choice (ADR 013), revisited via ADR 004's triggers.
 * Sonnet 5 rejects non-default sampling params (no temperature 0) and runs
 * adaptive thinking unless disabled — hence temperature omitted and
 * thinking: 'disabled' below; determinism comes from the replay fixtures and
 * correctness from the validator, not from sampling. */
export const PHRASING_MODEL = 'claude-sonnet-5';

/** Bump when the prompt's structure or rules change meaningfully — recorded
 * in the audit record (R8, WP10) and in every fixture.
 * v2 (2026-07-03): rules mirror the adversarial-review validator fixes — no
 * number words of any kind (cardinals included), unit DIRECTLY after each
 * value, both periods named with a change/difference value, '(voorlopig
 * cijfer)' in the same sentence as the value, decline word required when a
 * negative change is stated as a positive number.
 * v3 (2026-07-03): the digits-for-counts rule got its own numbered rule with
 * a good/bad example — the first v2 live run showed the model writing 'de
 * twee gemeenten'/'de vier G4-gemeenten' (B10/B14 fell to template). */
export const COMPOSE_PROMPT_VERSION = 3;

const TREND_WORD_BY_DIRECTION = { up: 'stijging', down: 'daling', flat: 'gelijk gebleven' } as const;

/** The R2 payload — the ONLY fields the model ever sees. The whitelist test
 * in tests/answer walks this structure; adding a field here without updating
 * that test fails CI, which is the point. */
export interface PhrasingPayload {
  shape: string;
  definitionLabel: string | null;
  periodSemantics: string | null;
  cells: {
    periodLabel: string;
    regionLabel: string | null;
    value: string | null;
    /** Why value is null, in Dutch — only present for null cells (R11). */
    nullReason?: string;
    unit: string;
    provisional: boolean;
  }[];
  derivations: {
    kind: string;
    explicit: boolean;
    value?: string;
    /** The unit word prose must attach to this derived value — 'procentpunt'
     * for differences over %-levels (R10). */
    unit?: string;
    direction?: 'up' | 'down' | 'flat';
    trendWord?: string;
    monotonic?: boolean;
    winnerRegion?: string;
    firstPeriodLabel?: string;
    lastPeriodLabel?: string;
  }[];
}

export function buildPhrasingPayload(result: ValidatedResult): PhrasingPayload {
  const byId = new Map(result.cells.map((c) => [c.resultId, c]));
  const decimals = result.cells[0]?.decimals ?? 0;
  const differenceUnit = (unit: string) => (unit.trim() === '%' ? 'procentpunt' : unit);

  return {
    shape: result.shape,
    definitionLabel: result.attribution.definitionLabel,
    periodSemantics: result.attribution.periodSemantics,
    cells: result.cells.map((cell) => ({
      periodLabel: cell.periodLabel,
      regionLabel: cell.regionLabel === null ? null : baseRegionLabel(cell.regionLabel),
      value: cell.value === null ? null : formatValueNl(cell.value, cell.decimals),
      ...(cell.value === null ? { nullReason: nullReasonText(cell.valueAttribute) } : {}),
      unit: cell.unit,
      provisional: cell.provisional,
    })),
    // unit_expansion records are display-only and NEVER serialized to the
    // model (ADR 031 D3): the model must not phrase the expansion itself
    // (double-render risk, and rule 3 forbids it converting units), and the
    // filter keeps every payload byte-identical to the pre-#125a form — so
    // every recorded LLM fixture keeps its request hash and replays.
    derivations: result.derivations
      .filter((d): d is Exclude<typeof d, { kind: 'unit_expansion' }> => d.kind !== 'unit_expansion')
      .map((d) => {
      switch (d.kind) {
        case 'difference':
          return {
            kind: d.kind,
            explicit: d.explicit,
            value: formatValueNl(Math.abs(d.value), decimals),
            unit: differenceUnit(d.unit),
            direction: d.value > 0 ? ('up' as const) : d.value < 0 ? ('down' as const) : ('flat' as const),
            trendWord: TREND_WORD_BY_DIRECTION[d.value > 0 ? 'up' : d.value < 0 ? 'down' : 'flat'],
          };
        case 'max': {
          const winner = byId.get(d.winnerResultId);
          return {
            kind: d.kind,
            explicit: d.explicit,
            value: formatValueNl(d.value, decimals),
            unit: d.unit,
            winnerRegion: winner?.regionLabel ? baseRegionLabel(winner.regionLabel) : undefined,
          };
        }
        case 'direction':
          return {
            kind: d.kind,
            explicit: d.explicit,
            value: formatValueNl(Math.abs(d.netChange), decimals),
            unit: differenceUnit(d.unit),
            direction: d.direction,
            trendWord: TREND_WORD_BY_DIRECTION[d.direction],
            monotonic: d.monotonic,
          };
        case 'first_last': {
          const first = byId.get(d.firstResultId);
          const last = byId.get(d.lastResultId);
          return {
            kind: d.kind,
            explicit: d.explicit,
            firstPeriodLabel: first?.periodLabel,
            lastPeriodLabel: last?.periodLabel,
          };
        }
      }
    }),
  };
}

/** Rules mirror the validator one-to-one (version history at
 * COMPOSE_PROMPT_VERSION): everything the validator rejects, the prompt
 * forbids — the model that follows the prompt passes on the first attempt. */
export function buildComposeSystemPrompt(): string {
  return [
    'Je schrijft voor checkdecijfers.nl het antwoord op een cijfervraag, in het Nederlands, op basis van een blok GEVALIDEERDE CIJFERS (JSON).',
    '',
    'Verplichte regels:',
    "1. Gebruik getallen UITSLUITEND door de tekst uit het veld 'value' letterlijk over te nemen (zelfde cijfers, zelfde punten en komma's). Nooit zelf rekenen, afronden, omrekenen, optellen of schatten.",
    "2. Schrijf hoeveelheden altijd in cijfers, nooit in woorden — geen telwoorden ('twee', 'tien', 'zeshonderd'), geen schaalwoorden ('duizend', 'miljoen', 'miljard'), geen breuken of veelvouden ('kwart', 'helft', 'anderhalf', 'dubbel', 'verdubbeld').",
    "2b. Dat geldt OOK voor aantallen regio's of periodes: schrijf 'de 2 gemeenten' en 'de 4 gemeenten' — NOOIT 'de twee gemeenten' of 'de vier gemeenten'.",
    "3. Zet de eenheid uit het veld 'unit' DIRECT achter elk getal, letterlijk. Bij unit 'aantal' mag in plaats daarvan een passend zelfstandig naamwoord (bijvoorbeeld 'inwoners'). Eenheden met een factor zoals 'x 1 000' of '1 000 euro' altijd letterlijk direct achter het getal — nooit uitschrijven of omrekenen.",
    "4. Niveaus in % zijn procenten; een VERSCHIL tussen twee %-waarden heet 'procentpunt' (het veld 'unit' van de derivation geeft dit aan). Verwissel die twee nooit.",
    "5. Noem in dezelfde zin als elk getal de periode (periodLabel) en, indien aanwezig, de regio (regionLabel) waar het bij hoort. Bij een verschil- of veranderingswaarde: noem BEIDE periodes in dezelfde zin. Gebruik regionamen exact zoals gegeven.",
    "6. Een stijging/daling/'meeste'/'meer dan' mag je alleen beweren als het blok 'derivations' die richting of ranking expliciet bevat (direction, difference of max). Volg het veld 'trendWord'. Is de richting 'down' en noem je de waarde als positief getal, gebruik dan altijd een dalingswoord in dezelfde zin. Bij monotonic=false: zeg dat de reeks niet in een rechte lijn bewoog, en koppel een tussentijdse stijging of daling altijd aan het jaartal waarin die plaatsvond.",
    "7. Markeer elke waarde met provisional=true met '(voorlopig cijfer)', direct achter de waarde, in dezelfde zin.",
    "8. Waarden met value=null: noem geen getal, noem de reden uit 'nullReason'.",
    "9. Voeg GEEN bronvermelding, definitie- of licentieregel toe — die worden automatisch toegevoegd. Geen inleiding ('Hier is…'), geen mening, geen duiding buiten de gegeven cijfers. Lengte: 1 tot 4 zinnen.",
  ].join('\n');
}

const RETRY_SUFFIX = [
  '',
  'STRENGER: een eerdere poging bevatte een getal, eenheid of claim die de cijfercontrole niet doorstond.',
  "Kopieer elke waarde LETTERLIJK uit het veld 'value', zet de eenheid er direct naast, en laat elke zin weg die je niet één-op-één op het informatieblok kunt terugvoeren.",
].join('\n');

export interface PhrasingRequestOptions {
  model?: string;
  maxTokens?: number;
  /** True for the single R3 regeneration attempt — a stricter prompt, and a
   * different fixture hash, so replay distinguishes the two attempts. */
  strict?: boolean;
}

export function buildPhrasingRequest(result: ValidatedResult, options: PhrasingRequestOptions = {}): LlmRequest {
  const payload = buildPhrasingPayload(result);
  return {
    model: options.model ?? PHRASING_MODEL,
    maxTokens: options.maxTokens ?? 1024,
    system: buildComposeSystemPrompt() + (options.strict ? RETRY_SUFFIX : ''),
    question: `GEVALIDEERDE CIJFERS:\n${JSON.stringify(payload, null, 2)}\n\nSchrijf nu het antwoord.`,
    thinking: 'disabled',
  };
}
