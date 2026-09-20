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
 * copilot/schema.ts's patchSchema — the cross-check test fails otherwise. */
export const PRESENTATION_KEYS = [
  'lineWidth',
  'markers',
  'grid',
  'xLabels',
  'axisLines',
  'zeroBaseline',
  'areaFill',
  'seriesColors',
  'fontFamily',
  'framePadding',
  'frameCorners',
  'frameShadow',
] as const;

// Session 120 (open-questions #275): the five house styles built into
// web/lib/chart-templates.ts (CHART_TEMPLATES) are deliberately NOT added
// here yet. `capabilities.templates` (this list, filtered) is embedded
// directly in the co-pilot's LLM prompt text (see prompt.ts) — widening it
// shifts every recorded fixture's request hash for any non-table-form
// request, breaking real-browser e2e (the CI mock-fixture server can no
// longer match the request) exactly like #301's `pieHole` did. Re-add the
// five once fixtures can be re-recorded (real LLM spend, blocked by the
// Anthropic workspace usage cap until 2026-10-01) — see #275.
export const TEMPLATE_IDS = [
  'standard',
  'classic',
  'newsroom',
  'presentation',
  'social',
  'minimal',
  'warm',
  'earth',
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
