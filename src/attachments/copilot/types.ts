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
//
// Own-data wiring of the CBS tier's co-pilot phase 6 primitives
// (ADR 056/src/chart/copilot/): `addGoalLine.value` is this tier's one
// deliberate exception to "the model never carries a value" — a reader-set
// target is not a plotted value, so map.ts stores it only when it equals,
// numerically, a number the reader's own message spells out
// (text-guard.ts's goalLineValueInMessage — not merely the same digits).
import type { viewCommandSchema } from './schema.ts';
import type { z } from 'zod';
import type { ChartInstruction } from '../types.ts';

export interface CopilotCapabilities {
  forms: (
    | 'line'
    | 'area'
    | 'bar'
    | 'hbar'
    | 'table'
    | 'dumbbell'
    | 'slope'
    | 'heatmap'
    | 'pie'
    | 'stacked'
    | 'stacked100'
  )[];
  /** ⊆ PRESENTATION_KEYS. */
  presentationKeys: string[];
  /** ⊆ TEMPLATE_IDS. */
  templates: string[];
  /** True only when this chart's current FORM can draw an overlay at all —
   * `form === 'line' || form === 'area'` (web/lib/chart-capabilities.ts's
   * `ownDataCapabilities`), the same predicate the CBS tier's own `overlays`
   * field uses (src/chart/copilot/types.ts's CbsCopilotCapabilities).
   * Unlike the rest of this bag, it is NOT mentioned in the prompt text (a
   * byte change there would re-hash every fixture): it is enforced ONLY at
   * copilot/map.ts's addDerivedOverlay case, checked FIRST, before any
   * series/x-label lookup — so a bar/table chart's chat can still be ASKED
   * for an overlay, it just comes back refused instead of silently storing
   * a command that renders nothing and cannot be removed. */
  overlays: boolean;
  /** The reader's own current hidden/dimmed series, as `s${index}` keys —
   * open-questions #309, mirrors the CBS tier's own field
   * (src/chart/copilot/types.ts's CbsCopilotCapabilities). `setDimmed`
   * answers in LABELS the model itself chose to name, and the model is
   * never TOLD which series the reader already hid or dimmed by clicking
   * the legend (telling it would mean printing this in the prompt text, a
   * byte change that re-hashes every fixture — the same trade-off
   * `overlays` above already makes). So copilot/map.ts's setDimmed case
   * reads these to MERGE the command's own named keys onto the reader's
   * existing state instead of replacing the whole set: a series the chat
   * did not mention keeps whatever state it already had. Empty (never
   * absent, same convention as every other field here) when nothing is
   * currently hidden/dimmed. Never serialized into the prompt (prompt.ts's
   * serializeCopilotRequest does not read either field). */
  currentHiddenKeys: string[];
  currentDimmedKeys: string[];
  lang: 'nl' | 'en';
}

// Widened 5 -> 11 (Task 5, plan 2026-09-22): the six chart-fit/verified-whole
// forms Tasks 1-4 already made the own-data PANEL render (dumbbell, slope,
// heatmap, pie, stacked, stacked100) now reach the chat too. Same order as
// the CBS tier's own CBS_COPILOT_FORMS (src/chart/copilot/types.ts) and the
// scorer's own fixed order (chart-fit.ts). Widening this list is a
// prompt-byte change on two counts (this array is embedded in the prompt via
// `capabilities.forms`, AND `setForm`'s schema enum in schema.ts must match)
// — COPILOT_PROMPT_VERSION was bumped alongside this, and
// `npm run attachments:fixtures` was re-run (offline, no spend) so every
// recorded fixture's request hash matches what the widened prompt now sends.
export const COPILOT_FORMS = [
  'line',
  'area',
  'bar',
  'hbar',
  'table',
  'dumbbell',
  'slope',
  'heatmap',
  'pie',
  'stacked',
  'stacked100',
] as const;

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
  // #309: no fixed allowlist to check against (a series key is chart-
  // specific, not enum-fixed like a form or style key) — just the `s${n}`
  // shape the browser's own key convention always produces, deduplicated.
  const pickKeys = (value: unknown): string[] =>
    Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && /^s\d+$/.test(v)))] : [];
  return {
    forms: pick(o.forms, COPILOT_FORMS) as CopilotCapabilities['forms'],
    presentationKeys: pick(o.presentationKeys, PRESENTATION_KEYS),
    templates: pick(o.templates, TEMPLATE_IDS),
    overlays: o.overlays === true,
    currentHiddenKeys: pickKeys(o.currentHiddenKeys),
    currentDimmedKeys: pickKeys(o.currentDimmedKeys),
    lang: o.lang === 'en' ? 'en' : 'nl',
  };
}
