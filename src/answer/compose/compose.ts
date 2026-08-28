// WP7 orchestrator: ValidatedResult → ComposedAnswer.
//
// The R3 fail-closed ladder: one LLM attempt → blocking validator → one
// stricter regeneration → validator → deterministic template. Any API error
// or refusal on the LLM path drops straight down the ladder — the pipeline
// never throws an answer away and never serves an unvalidated one.
//
// Attribution (R4), the definition statement (canonical-default transparency)
// and the CC BY derived-data marking (R5) are assembled HERE, from validated
// fields, after the body is settled — no LLM output can add, alter or drop
// them.
import type { ValidatedResult } from '../../query/index.ts';
import { DERIVED_DATA_MARKING } from '../../query/index.ts';
import type { LlmCallOptions, LlmUsage } from '../llm/client.ts';
import { applyUnitExpansions } from './expand.ts';
import {
  buildAlternatesLine,
  buildAssumptionLine,
  buildAttributionLine,
  buildDefinitionLine,
  normalizeForScan,
} from './format.ts';
import { buildPhrasingRequest, COMPOSE_PROMPT_VERSION, PHRASING_MODEL } from './prompt.ts';
import { runSemanticCheck, type SemanticCheckOptions, type SemanticCheckOutcome } from './semantic-check.ts';
import {
  buildSlotContext,
  buildSlotPhrasingRequest,
  fillSlots,
  SLOT_COMPOSE_PROMPT_VERSION,
  validateSlotBody,
} from './slots.ts';
import { renderTemplateBody } from './template.ts';
import { validateAnswerBody } from './validate.ts';
import type { AnswerSource, ComposeAttempt, ComposedAnswer, SemanticCheckRecord, SlotPhrasingRecord } from './types.ts';
import { ANSWER_SCHEMA_VERSION, SLOT_PHRASING_SCHEMA_VERSION } from './types.ts';

export interface ComposeOptions extends LlmCallOptions {
  /** #144 (ADR 034): the additive, reject-only semantic checker. Absent = off
   * (benchmark, tests, CLI — zero behavior and zero envelope-byte changes).
   * When present, an LLM body that passed the deterministic validator but
   * leaned on a residual-prone exemption gets one cheap-tier second read; a
   * fabricated verdict drops down the SAME R3 ladder (regenerate, then
   * template). The checker can only reject — never approve (principle a). */
  semanticCheck?: SemanticCheckOptions;
  /** WP26 mechanism A (ADR 024): skip the LLM rungs entirely and compose from
   * the deterministic template. Set ONLY by the clicked/matched clarification
   * take-path, where ADR 024 requires "no LLM call at all": the reading was
   * chosen by the USER from pre-verified options, so there is nothing left to
   * interpret — and a template body is valid by construction (R3's floor),
   * injection-free and provider-outage-proof. The honest trade is that a
   * clicked answer reads plainer than a phrased one. Absent everywhere else →
   * the full R3 ladder, byte-identical. */
  templateOnly?: boolean;
  /** #162 (ADR-DRAFT slot-filling, hermetic half): the `SLOT_PHRASING_ENABLED`
   * experiment flag. Absent/false (benchmark, tests, CLI, and production —
   * the default) → the see-and-echo ladder above, byte-identical. True → the
   * slot rung REPLACES the two see-and-echo LLM rungs: the model writes a
   * digit-free placeholder body, deterministic code fills the slots, and the
   * template stays the unchanged floor. `templateOnly` wins over this flag
   * (ADR 024's "no LLM call at all" is absolute), and `semanticCheck` is
   * deliberately NOT run on slot bodies — both #140/#141 residual shapes need
   * a digit the model cannot emit on this path (ADR-draft §2); the checker
   * stays wired for the legacy pipeline only. */
  slotPhrasing?: boolean;
}

function assemble(result: ValidatedResult, rawBody: string, source: AnswerSource, extras: {
  model: string | null;
  usage: LlmUsage;
  attempts: ComposeAttempt[];
  /** #144: the checker's verdict on THIS served body — the key is only
   * serialized when the checker actually ran its gate (feature on, LLM body),
   * so pre-feature envelopes stay byte-identical (A1). */
  semanticCheck?: SemanticCheckRecord;
  /** #162: the prompt version that was in play — the slot rung passes its own
   * constant; absent (every legacy path) = COMPOSE_PROMPT_VERSION, so
   * flag-off envelopes stay byte-identical. */
  promptVersion?: number;
  /** #162: the raw placeholder body + slot map when the slot rung wrote the
   * served body — present-only (A1), like semanticCheck. */
  slotPhrasing?: SlotPhrasingRecord;
}): ComposedAnswer {
  // #125a (ADR 031 D4): once the body is settled — validated LLM prose or the
  // by-construction-valid template — splice the registered unit expansions in
  // ("390,2 x 1000 (= 390.200)"). The helper re-validates the spliced body and
  // falls back to the untouched one on any doubt; the SPLICED body is what
  // gets stored, so R8 reconstruction re-validates exactly what was shown.
  const body = applyUnitExpansions(rawBody, result);
  // The "Definitie:" line — built by the single shared source of truth in
  // format.ts (buildDefinitionLine), which audit/reconstruct.ts also uses to
  // RE-DERIVE it for R8 verification, so the two can never drift (#115 review).
  // It prefers a real captured CBS definition (definitionText, lever b) and
  // otherwise falls back to the short definitionLabel with the circular-title
  // suppression (lever a).
  const definitionLine = buildDefinitionLine(result);
  // #39: the alternate-reading disclosure, directly AFTER the definition it
  // qualifies — the reader sees which reading was used, then that others
  // exist. Same single-builder discipline as the lines above:
  // audit/reconstruct.ts re-derives it through buildAlternatesLine, so the
  // shown disclosure and the audited one can never drift.
  const alternatesLine = buildAlternatesLine(result);
  // WP26 mechanism B (ADR 024): the defaulted-axis disclosure, FIRST among the
  // structural lines — it qualifies what the body just said, so the reader
  // meets it before the definition and the source. audit/reconstruct.ts
  // re-assembles in this exact order; changing it here without changing it
  // there breaks R8 for every defaulted answer.
  const assumptionLine = buildAssumptionLine(result);
  const markingLine = result.derivations.length > 0 ? `— ${DERIVED_DATA_MARKING}` : null;
  const attribution = buildAttributionLine(result);
  const text = [
    body,
    '',
    ...(assumptionLine ? [assumptionLine] : []),
    ...(definitionLine ? [definitionLine] : []),
    ...(alternatesLine ? [alternatesLine] : []),
    ...(markingLine ? [markingLine] : []),
    attribution,
  ].join('\n');
  return {
    schemaVersion: ANSWER_SCHEMA_VERSION,
    source,
    body,
    // Present-only: an answer with no defaulted axis serializes no key, so
    // every pre-WP26 and flag-off envelope stays byte-identical.
    ...(assumptionLine !== null ? { assumptionLine } : {}),
    definitionLine,
    // #39: present-only, same discipline — no alternates, no key.
    ...(alternatesLine !== null ? { alternatesLine } : {}),
    markingLine,
    attributionLine: attribution,
    text,
    model: extras.model,
    promptVersion: extras.promptVersion ?? COMPOSE_PROMPT_VERSION,
    usage: extras.usage,
    attempts: extras.attempts,
    validation: validateAnswerBody(body, result),
    ...(extras.semanticCheck !== undefined ? { semanticCheck: extras.semanticCheck } : {}),
    ...(extras.slotPhrasing !== undefined ? { slotPhrasing: extras.slotPhrasing } : {}),
  };
}

// ---------------------------------------------------------------------------
// #162 (ADR-DRAFT slot-filling, hermetic half) — the slot rung
// ---------------------------------------------------------------------------
//
// The NEW FIRST RUNG of the R3 ladder when `slotPhrasing` is on (ADR-draft
// §3): slot-phrase → (reject: digits / unknown slot / missing slot /
// word-form / R9) → one strict retry → the EXISTING template rung, unchanged,
// as the floor. The model writes a body with typed placeholders and zero
// digits (validateSlotBody, the §1 pre-fill rules); deterministic code fills
// the slots through the template rung's proven formatters (fillSlots — R10
// unit adjacency and R11 provisional marking become filler-owned, structural);
// and the FILLED body still passes the full legacy R3/R9/R10/R11 validator as
// a belt (§2: by construction it cannot find an unbacked digit — the numbers
// were never model output — but direction/comparison words are still the
// model's own prose and can genuinely fail here, fail-closed).
//
// The #144 semantic checker is deliberately NOT called on this path: both
// residual shapes it exists for (#140 metadata echo, #141 temporal marker)
// need the MODEL to emit a digit, which this path makes unrepresentable
// (ADR-draft §2). Null-cell results never reach this rung (composeAnswer's
// hasNullCells guard) and `templateOnly` wins outright.
async function composeViaSlots(
  result: ValidatedResult,
  options: ComposeOptions,
  usage: LlmUsage,
  attempts: ComposeAttempt[],
): Promise<ComposedAnswer> {
  const context = buildSlotContext(result);
  for (const strict of [false, true]) {
    const kind = strict ? ('llm_retry' as const) : ('llm' as const);
    try {
      const request = buildSlotPhrasingRequest(result, {
        model: options.model,
        maxTokens: options.maxTokens,
        strict,
      });
      const response = await options.client.complete(request);
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;
      // Normalized ONCE here: the stored rawBody, the pre-fill validation and
      // the fill all see the same canonical text (normalizeForScan is
      // idempotent, so the R8 re-fill of the stored rawBody is byte-stable).
      const rawBody = normalizeForScan(response.outputText.trim());
      const slotValidation = validateSlotBody(rawBody, context);
      if (!slotValidation.ok) {
        attempts.push({ kind, ok: false, problems: slotValidation.problems, error: null });
        continue;
      }
      const body = fillSlots(rawBody, context);
      // The §2 belt: the filled body through the FULL legacy validator. The
      // filler's own numbers pass by construction (template formatters);
      // direction words, comparisons and equality claims are still judged.
      const validation = validateAnswerBody(body, result);
      if (!validation.ok) {
        attempts.push({ kind, ok: false, problems: validation.problems, error: null });
        continue;
      }
      attempts.push({ kind, ok: true, problems: [], error: null });
      return assemble(result, body, kind, {
        model: response.model,
        usage,
        attempts,
        promptVersion: SLOT_COMPOSE_PROMPT_VERSION,
        slotPhrasing: { schemaVersion: SLOT_PHRASING_SCHEMA_VERSION, rawBody, slots: context.bindings },
      });
    } catch (error) {
      attempts.push({
        kind,
        ok: false,
        problems: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  // Fail closed: the SAME unchanged template floor (no slotPhrasing record —
  // a template body has no raw placeholder form; the slot prompt version is
  // recorded as the one that was in play, flag-on only).
  return assemble(result, renderTemplateBody(result), 'template', {
    model: null,
    usage,
    attempts,
    promptVersion: SLOT_COMPOSE_PROMPT_VERSION,
  });
}

export async function composeAnswer(result: ValidatedResult, options: ComposeOptions): Promise<ComposedAnswer> {
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  const attempts: ComposeAttempt[] = [];

  // Results with null-valued cells skip the LLM entirely: the honest answer
  // is the CBS reason, which the template states deterministically — an LLM
  // adds phrasing risk to an answer that contains no number to phrase.
  const hasNullCells = result.cells.some((c) => c.value === null);

  if (!hasNullCells && options.templateOnly !== true) {
    // #162: flag on → the slot rung replaces the two see-and-echo LLM rungs
    // below (same template floor). Flag off/absent → byte-identical ladder.
    if (options.slotPhrasing === true) {
      return composeViaSlots(result, options, usage, attempts);
    }
    for (const strict of [false, true]) {
      const kind = strict ? ('llm_retry' as const) : ('llm' as const);
      try {
        const request = buildPhrasingRequest(result, {
          model: options.model,
          maxTokens: options.maxTokens,
          strict,
        });
        const response = await options.client.complete(request);
        usage.inputTokens += response.usage.inputTokens;
        usage.outputTokens += response.usage.outputTokens;
        const body = response.outputText.trim();
        const validation = validateAnswerBody(body, result);
        if (!validation.ok) {
          attempts.push({ kind, ok: false, problems: validation.problems, error: null });
          continue;
        }
        // #144 (ADR 034): the semantic second pass — only when configured, and
        // runSemanticCheck itself only calls the LLM when the body leaned on a
        // residual-prone exemption (most answers skip the call). A rejection
        // takes the SAME ladder rung a deterministic failure would; the
        // verdict is stored only with the body it cleared. The check runs on
        // the SPLICED body — the exact string assemble() stores as
        // answer.body (applyUnitExpansions is deterministic and idempotent:
        // its double-render belt skips an already-present figure) — so R8 can
        // re-derive the suspect list from the stored row byte-exactly.
        let check: SemanticCheckOutcome | null = null;
        if (options.semanticCheck) {
          check = await runSemanticCheck(applyUnitExpansions(body, result), result, options.semanticCheck);
          usage.inputTokens += check.usage.inputTokens;
          usage.outputTokens += check.usage.outputTokens;
          if (check.reject) {
            attempts.push({ kind, ok: false, problems: check.problems, error: null });
            continue;
          }
        }
        attempts.push({ kind, ok: true, problems: validation.problems, error: null });
        return assemble(result, body, kind, {
          model: response.model,
          usage,
          attempts,
          ...(check !== null ? { semanticCheck: check.record } : {}),
        });
      } catch (error) {
        attempts.push({
          kind,
          ok: false,
          problems: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Fail closed: the deterministic template (R3).
  return assemble(result, renderTemplateBody(result), 'template', {
    model: null,
    usage,
    attempts,
  });
}

export { PHRASING_MODEL };
