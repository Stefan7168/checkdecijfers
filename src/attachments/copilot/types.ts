// The own-data chart co-pilot (session 113, co-pilot phase 2, ADR 056) —
// the tier's pure-leaf vocabulary: what the client may offer, what the model
// may ask for, and what it answers with.
//
// THE BOUNDARY THIS FILE GUARDS. `CopilotCapabilities` arrives from the
// browser (the chart panel says what THIS chart can do right now) and is
// enum-checked against the two `as const` lists below BEFORE any of it
// reaches the prompt — an unknown form/key/template is dropped, never
// echoed back to the model, which is what stops a browser-supplied string
// from becoming prompt text. Neither list may ever grow past what
// web/lib/chart-presentation.ts's `sanitizeOverrides` and
// web/lib/chart-templates.ts's `CHART_TEMPLATES` accept: the chat is a
// SECOND doorway onto the same command vocabulary, not a wider one
// ("no chat-only capability"), pinned by tests/attachments/copilot-schema.test.ts.
import type { viewCommandSchema } from './schema.ts';
import type { z } from 'zod';
import type { ChartInstruction } from '../types.ts';

export interface CopilotCapabilities {
  forms: ('line' | 'area' | 'bar' | 'hbar' | 'table')[];
  /** ⊆ PRESENTATION_KEYS. */
  presentationKeys: string[];
  /** ⊆ TEMPLATE_IDS. */
  templates: string[];
  lang: 'nl' | 'en';
}

export const COPILOT_FORMS = ['line', 'area', 'bar', 'hbar', 'table'] as const;

/** The style keys the chat may patch — a SUBSET of ChartPresentation's own
 * keys: `valueLabels`, `language`, `frameBackground`, `frameInset` and
 * `frameAspect` are deliberately absent (they are either honesty-locked
 * per form, set by the language switch, or need a colour/ratio choice a
 * chat turn cannot make safely). Adding one here also means adding it to
 * copilot/schema.ts's patchSchema — the cross-check test fails otherwise —
 * and regenerating both LLM fixture sets (the note under TEMPLATE_IDS). */
export const PRESENTATION_KEYS = [
  'lineWidth',
  'markers',
  'grid',
  'xLabels',
  'axisLines',
  'zeroBaseline',
  'areaFill',
  // Phase 5b's donut — pie form only (resolvePresentation offers it nowhere
  // else); chat-reachable since co-pilot phase 6 Task 1 (#301).
  'pieHole',
  'seriesColors',
  'fontFamily',
  'framePadding',
  'frameCorners',
  'frameShadow',
] as const;

// BOTH lists above and below reach the model: `capabilities.presentationKeys`
// and `capabilities.templates` (these lists, filtered per chart) are embedded
// in the co-pilot prompt text (prompt.ts), and PRESENTATION_KEYS also shapes
// patchSchema, part of the structured-output JSON schema. So widening EITHER
// shifts the request hash every recorded LLM fixture is keyed on
// (tests/fixtures/llm/**) and the real-browser e2e stops matching. That
// needs NO model spend: `npm run chart-copilot:fixtures` and
// `npm run attachments:fixtures` rebuild every fixture offline from the
// hand-authored cases — whose own capabilities lists must first be updated
// to what the browser now sends (the llm-stub matches byte for byte).
// Session 120's two reverts (#301 pieHole, #275 the house styles) assumed a
// live re-record was needed; it was not (co-pilot phase 6, Task 1).
export const TEMPLATE_IDS = [
  'standard',
  'classic',
  'newsroom',
  'presentation',
  'social',
  'minimal',
  'warm',
  'earth',
  // Session 120 (#275): the five house styles, in CHART_TEMPLATES order;
  // chat-reachable by name since co-pilot phase 6 Task 1.
  'salmon',
  'studio',
  'broadsheet',
  'autumn',
  'brutalist',
] as const;

/** The model's own shape: view commands expressed in LABELS (it never sees
 * a series key or a row ref). copilot/map.ts turns these into key-based
 * commands by lookup against the executed chart. */
export type CopilotViewCommand = z.infer<typeof viewCommandSchema>;

export interface CopilotOutput {
  version: 1;
  /** The FULL new instruction when the DATA should change, else null. */
  instruction: ChartInstruction | null;
  view: CopilotViewCommand[];
  refused: {
    request: string;
    reason: 'not_available' | 'not_on_this_chart' | 'needs_click';
    control: 'notes' | 'style' | 'data' | 'form' | 'none';
  }[];
  confidence: number;
  /** SERVER-SIDE AUDIT ONLY, same rule as ChartInstruction.reading — free
   * prose partly fed by untrusted CSV headers. Never serialized to a
   * client-facing shape. */
  reading: string;
}

/** Enum-checks whatever the browser claimed this chart can do (flow step
 * 2). Anything off-list is DROPPED silently — never echoed into the prompt,
 * never surfaced as an error: a stale tab offering a removed key is a
 * client-version mismatch, not a user mistake. */
export function sanitizeCapabilities(raw: unknown): CopilotCapabilities {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(value: unknown, allowed: readonly T[]): T[] =>
    Array.isArray(value) ? [...new Set(value.filter((v): v is T => allowed.includes(v as T)))] : [];
  return {
    forms: pick(o.forms, COPILOT_FORMS) as CopilotCapabilities['forms'],
    presentationKeys: pick(o.presentationKeys, PRESENTATION_KEYS),
    templates: pick(o.templates, TEMPLATE_IDS),
    lang: o.lang === 'en' ? 'en' : 'nl',
  };
}
