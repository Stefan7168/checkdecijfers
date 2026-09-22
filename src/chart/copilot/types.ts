// The CBS/Eurostat chart co-pilot (session 114, co-pilot phase 3, ADR 056) —
// the tier's pure-leaf vocabulary. Mirrors src/attachments/copilot/types.ts,
// with the data-change field removed entirely: this tier is
// SELECTION-ONLY (R1/R6/R11 — no field carries a data value, and the model
// never proposes a different table/region/period/measure; the one bare
// number, co-pilot phase 6's addGoalLine.value, is a reader-set target
// that map.ts stores only when it equals, numerically, a number the
// reader's own message spells out). A request for OTHER data sets
// `dataRequest: true` instead, and is handed to the existing
// follow-up-question path — never expressed as a view command.
//
// PRESENTATION_KEYS/TEMPLATE_IDS are RE-EXPORTED, not redeclared: "no
// chat-only capability" means this tier can never offer a style key or
// template the own-data tier does not — one vocabulary, one place it is
// defined, pinned by tests/chart/copilot-schema.test.ts.
import type { z } from 'zod';
import { PRESENTATION_KEYS, TEMPLATE_IDS } from '../../attachments/copilot/types.ts';
import type { CopilotCommand, CopilotRefusal } from '../../attachments/types.ts';
import type { cbsViewCommandSchema } from './schema.ts';

export { PRESENTATION_KEYS, TEMPLATE_IDS };

/** Phase 5 (chart-fit scorer, session 116): the three trailing shapes are
 * THIS tier's only — the own-data tier's COPILOT_FORMS stays at five until
 * user-chart.tsx can draw them (plan Global Constraints). Phase 5b
 * (verified-whole, session 117): pie/stacked/stacked100 join, also this
 * tier's only — they need a CBS-verified region roster, which an own-data
 * chart never has. */
export const CBS_COPILOT_FORMS = ['line', 'area', 'bar', 'hbar', 'table', 'dumbbell', 'slope', 'heatmap', 'pie', 'stacked', 'stacked100'] as const;

export interface CbsCopilotCapabilities {
  forms: (typeof CBS_COPILOT_FORMS)[number][];
  /** ⊆ PRESENTATION_KEYS. */
  presentationKeys: string[];
  /** ⊆ TEMPLATE_IDS. */
  templates: string[];
  /** true only when the card offers the Vanaf/Tot zoom (line kind, more
   * than one period code) — advisory only, same role as the rest of this
   * bag: it narrows what the model is TOLD this chart offers, never what
   * copilot/map.ts is willing to apply. */
  zoom: boolean;
  /** Co-pilot phase 6 final review (fix wave, #310): true only when the
   * card's own difference/mean overlay buttons are mounted right now —
   * `form === 'line' || form === 'area'` (web/lib/chart-capabilities.ts's
   * `cbsCapabilities`), the SAME test chart.tsx's own button row gates on.
   * Unlike `zoom`, this is NOT mentioned in the prompt text (a byte change
   * there re-hashes every fixture): it is enforced ONLY at copilot/map.ts's
   * addDerivedOverlay case, so a bar/pie/stacked chart's chat can still be
   * ASKED for an overlay, it just comes back refused instead of silently
   * storing a command that renders nothing. */
  overlays: boolean;
  lang: 'nl' | 'en';
}

/** The model's own shape: view commands expressed in LABELS (it never sees
 * a series key or a period code). copilot/map.ts turns these into `s${i}`
 * keys and period codes by lookup against the executed spec. */
export type CbsViewCommand = z.infer<typeof cbsViewCommandSchema>;

export interface CbsCopilotOutput {
  version: 1;
  view: CbsViewCommand[];
  /** true when the message asks for different DATA — another region,
   * country, period or measure, or a total, average, difference, growth
   * rate or comparison that needs data NOT on this chart — never expressed
   * as a view command. A calculation over points that ARE already on this
   * chart is NOT a data request: the average of one plotted series, or the
   * difference between two of that series' own periods, is an
   * addDerivedOverlay view command instead (prompt.ts's SYSTEM_PROMPT;
   * fixed alongside this comment, co-pilot phase 6 final review — this
   * comment used to describe the OLDER prompt wording, from before that
   * fix, which routed an on-chart average/difference to dataRequest too).
   * When true, `view` is empty. */
  dataRequest: boolean;
  refused: {
    request: string;
    reason: 'not_available' | 'not_on_this_chart' | 'needs_click';
    /** No 'data' value on this tier — a data request is `dataRequest:
     * true`, not a refusal (schema.ts's narrower enum). */
    control: 'notes' | 'style' | 'form' | 'none';
  }[];
  confidence: number;
  /** SERVER-SIDE AUDIT ONLY, never serialized to a client-facing shape. */
  reading: string;
}

export interface LlmCallInfo {
  model: string;
  promptVersion: number;
  inputTokens: number;
  outputTokens: number;
}

/** What the server action returns inside the gate. `commands` are
 * CopilotCommand-shaped (src/attachments/types.ts's CopilotCommand, minus
 * setInstruction — this tier never emits one) so the client's own
 * acceptReply() takes them unchanged. */
export type CbsCopilotReply =
  | {
      kind: 'edit';
      text: string;
      commands: CopilotCommand[];
      refused: CopilotRefusal[];
      dataRequest: boolean;
      llmCalls: LlmCallInfo[];
    }
  | { kind: 'clarification'; text: string; llmCalls: LlmCallInfo[] }
  | { kind: 'refusal'; text: string; reason: 'empty_message' | 'internal'; llmCalls: LlmCallInfo[] };

/** Enum-checks whatever the browser claimed this chart can do. Anything
 * off-list is DROPPED silently — never echoed into the prompt, never
 * surfaced as an error: a stale tab offering a removed key is a
 * client-version mismatch, not a user mistake (the own-data tier's own
 * sanitizeCapabilities rule, applied here). */
export function sanitizeCbsCapabilities(raw: unknown): CbsCopilotCapabilities {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(value: unknown, allowed: readonly T[]): T[] =>
    Array.isArray(value) ? [...new Set(value.filter((v): v is T => allowed.includes(v as T)))] : [];
  return {
    forms: pick(o.forms, CBS_COPILOT_FORMS) as CbsCopilotCapabilities['forms'],
    presentationKeys: pick(o.presentationKeys, PRESENTATION_KEYS),
    templates: pick(o.templates, TEMPLATE_IDS),
    zoom: o.zoom === true,
    overlays: o.overlays === true,
    lang: o.lang === 'en' ? 'en' : 'nl',
  };
}
