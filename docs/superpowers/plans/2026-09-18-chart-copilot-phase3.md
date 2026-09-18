# Chart co-pilot phase 3 — the CBS/Eurostat chat doorway

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under a CBS/Eurostat chart card the reader can type "Pas deze grafiek aan" and the chart changes form, zoom window, hidden/highlighted series, style, template, title/caption, or gets a note at a plotted point — **selection only**, one cheap-tier call, every command re-validated by deterministic code, never a number through the model; a request for OTHER data ("en Amsterdam erbij") is recognised and handed to the existing follow-up question path, and when the follow-up answer's chart is compatible with the card the new card is labelled "Grafiek uitgebreid" and mounts wearing the previous card's form and look.

**Architecture:** (1) A new backend directory `src/chart/copilot/` mirrors `src/attachments/copilot/` one for one (types, schema, prompt, parse, map, text-guard, respond) but with a SELECTION-ONLY schema: no instruction field, and one boolean `dataRequest` the model sets when the message asks for other data. The prompt sees series labels and period labels only; `map.ts` turns labels into `s${index}` keys and period CODES by lookup against the spec; the digit guard's allowed set is the `ChartSpec`'s own `formattedValue`/`periodLabel`/`periodCode`/title/unit strings. (2) Billing: a new sibling gate `src/billing/chart-edit-gate.ts` (the dataset-gate pattern, hot path untouched) reserves the existing `clarification` action-class price through the existing `question_cost` debit with its own fresh requestId — NO new ledger reason, NO new action class, NO migration; an `edit` reply keeps the debit, anything else refunds in full; compensation passes `auditAnswerId: null`. **A chart edit never writes `audit_answers`**; the applied commands are persisted only as `source: 'chat'` entries in the card's existing `chart_edits` log (phase 1); the reply text/refusals are not stored (recorded as an open question). (3) The browser side reuses the phase-2 pieces unchanged: `ChartCopilotInput`, `acceptReply`/`validateCommand`, `refusalLine`; a new `cbsCapabilities` + `cbsExampleChips` in `web/lib/chart-capabilities.ts`; a new `web/app/chart-copilot-actions.ts` server action that parses the client-sent spec with `chartSpecSchema` (the `draftChartHeadline` precedent) and runs the gate. (4) `chart.tsx` mounts the input under the caption/notes slot, gated exactly like the history actions (`!embedMode && !inStage && signedIn && embed?.auditId`, story lock disables), and gets an optional `onAskFollowUp(message)` prop that `chat.tsx`/`visual-dock.tsx` thread from `sendText`; a `dataRequest` reply shows one chip "Stel als vervolgvraag" that sends the reader's ORIGINAL message through that prop. (5) "Grafiek uitgebreid": when an answer arrives while a previous message in the same thread has a chart with the same `attribution.tableId`, `unit`, `kind` and `dims`, `chat.tsx` marks the new message `extendsPrevious: true`; the card shows the badge and seeds `initialFormOverride` + `initialPresentation` from the previous card's last saved state (the `chart_edits` log's own `ChartDocState`, read through the existing `fetchChartEdits`). No series merging (open question).

**Tech Stack:** TypeScript, React 19, Next.js server actions, Recharts, zod 4, vitest (+ RTL/jsdom in `web/`, PGlite in the root), Playwright hermetic harness (`web/e2e`, `scripts/dev-harness`), Anthropic structured outputs via `LlmRequest.jsonSchema`.

**Spec:** [docs/superpowers/specs/2026-09-17-chart-copilot-design.md](../specs/2026-09-17-chart-copilot-design.md) §3.1–3.3, §5 phase 3, §6. ADR [056](../../decisions/056-chart-copilot.md). Phase-2 plan (the pattern to mirror): [2026-09-18-chart-copilot-phase2.md](2026-09-18-chart-copilot-phase2.md). Kickoff: [session-briefs/2026-09-18-session-114-kickoff.md](../../session-briefs/2026-09-18-session-114-kickoff.md).

## Global Constraints

- **CBS/Eurostat = selection only, never computation (R1/R6/R11).** No field of the model-facing schema carries a number or a value; the prompt payload carries labels only (series labels, period labels, form/style/template vocabularies, lang). `windowSpec()` and every projection in `chart.tsx` stay untouched.
- **A chart edit never writes `audit_answers`** (spec §6). It writes: one `question_cost` ledger debit (+ a compensation on refund) and, via the card's existing debounced save, `chart_edits` entries with `source: 'chat'`. Nothing else.
- **Own data stays exactly as built.** No file under `src/attachments/` or `web/components/user-chart.tsx` changes. `ChartCopilotInput`, `chart-copilot-reply.ts`, `chart-commands.ts` change only where a task below says so (additive, phase-2 tests stay green).
- **No chat-only capability**: every command kind the CBS chat can emit (`setForm`, `setSeriesView`, `setPeriodRange`, `setPresentation`, `applyTemplate`, `resetPresentation`, `setTitle`, `setCaption`, `addNote`) already has a `data-command-kind` control on `ChartView`; the contract test pins it.
- **Cheapest mechanism first:** one cheap-tier call (`claude-haiku-4-5`, temperature 0) per chat edit; zero for the three example chips, Undo, Retry-free actions; the follow-up chip sends the reader's own words (no rewrite by the model).
- **No migration, no DDL, no new secret.** Price class reused: `clarification` (10 credits today). Ledger reason reused: `question_cost`.
- **Copy:** every new interface string gets an `nl` AND an `en` entry in `web/lib/i18n/messages.ts`; Dutch first; no `chart.*` string contains a digit except `chart.copilot.cost` (existing). Backend-built reply text is English (#206 precedent), one sentence, digit-free.
- **Repo is public. Never name the competitor** ("Competitor G", docs only).
- **Commits:** one commit per task on the task's worktree branch; the SESSION merges to `main` and pushes after the full verification block, never a subagent. Messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. A subagent must NOT push, must NOT open a PR, must NOT run `npm run db:migrate`, must NOT call a real model.
- **Run tests from the right folder, in the FOREGROUND, reading the exit code:** web `cd web && npx vitest run <file>`; root `npx vitest run <file>`; typecheck `cd web && npm run typecheck` and root `npm run typecheck`. No summary printed = a killed run = a failure. Playwright only in the main checkout, only by the session.
- Follow each file's existing comment style (why-comments, session tag "session 114"); keep new comments short.

---

## File structure

| File | Responsibility |
|---|---|
| `src/chart/copilot/types.ts` (new) | `CbsCopilotCapabilities`, `CBS_COPILOT_FORMS`, `PRESENTATION_KEYS`/`TEMPLATE_IDS` (re-exported from `src/attachments/copilot/types.ts` — one vocabulary), `sanitizeCbsCapabilities`, `CbsCopilotOutput`, `CbsCopilotReply`. |
| `src/chart/copilot/schema.ts` (new) | zod schema of the model output (selection-only view commands + `dataRequest`), `cbsCopilotOutputJsonSchema()` (oneOf→anyOf), `validateCbsCopilotOutput`. |
| `src/chart/copilot/prompt.ts` (new) | `CBS_COPILOT_PROMPT_VERSION = 1`, system prompt, `serializeCbsCopilotRequest`. |
| `src/chart/copilot/parse.ts` (new) | `CBS_COPILOT_MODEL`, `buildCbsCopilotRequest`, `parseCbsCopilotReply` (throws `CbsCopilotFailure` carrying usage). |
| `src/chart/copilot/text-guard.ts` (new) | `unplottedDigits(text, spec: ChartSpec)`, `stripDigits`. |
| `src/chart/copilot/map.ts` (new) | `mapCbsCopilotOutput(output, spec)` → `{ commands, refused }` (labels → `s${i}` keys / period codes). |
| `src/chart/copilot/respond.ts` (new) | `respondToCbsChartEdit(input)` → `CbsCopilotReply` (pure of the db; one model call). |
| `src/billing/chart-edit-gate.ts` (new) | `chargeAndRunChartEdit(db, userId, requestId, run)` → `GatedChartEditResponse`. |
| `web/lib/chart-capabilities.ts` (modify) | `cbsCapabilities`, `cbsExampleChips`. |
| `web/app/chart-copilot-actions.ts` (new) | Server action `adjustCbsChart(rawSpec, message, requestId, rawCapabilities)`. |
| `web/components/chart-copilot-input.tsx` (modify) | `CopilotReply.followUp?: string \| null` + the "Stel als vervolgvraag" chip; `onAskFollowUp?` prop. |
| `web/components/chart.tsx` (modify) | Mount `ChartCopilotInput` (gated), `onAskFollowUp` + `extendsPrevious` props, the "Grafiek uitgebreid" badge. |
| `web/components/chat.tsx`, `web/components/visual-dock.tsx`, `web/lib/dock-visuals.ts` (modify) | Thread `onAskFollowUp` (= `sendText`) and `extendsPrevious` to the card; compute `extendsPrevious` per answer message. |
| `web/lib/i18n/messages.ts` (modify) | New `chart.copilot.*` keys (nl + en). |
| `scripts/chart-copilot-fixtures.ts`, `tests/fixtures/chart-copilot/cases.ts` (new), `package.json` (modify) | Hand-authored LLM fixtures built with the real request builder; `chart-copilot:fixtures` (offline) and `chart-copilot:record` (live, owner). |
| `web/e2e/cbs-copilot.spec.ts` (new) | The real-browser proof, zero model calls. |
| Tests | root: `tests/chart/copilot-{schema,map,text-guard,respond}.test.ts`, `tests/billing/chart-edit-gate.test.ts`, `tests/chart/copilot-fixtures.test.ts`; web: `web/lib/chart-capabilities.test.ts` (extend), `web/components/chart-copilot-cbs.test.tsx` (new), `web/components/chart-commands-contract.test.tsx` (extend), `web/components/chat.test.tsx` (extend). |

**Execution order and parallelism** (max two implementers at once, disjoint files, two worktrees; the session merges in order): wave A = Task 1 (backend) ∥ Task 2 (web lib + i18n); wave B = Task 3 (server action + card + chat) ∥ Task 4 (fixtures generator + fixtures test); wave C = Task 5 (Playwright proof, main checkout, session-run). Task 6 (docs) is the session's own.

---

### Task 1: The backend — schema, prompt, guard, map, respond, gate

**Files:**
- Create: `src/chart/copilot/types.ts`, `schema.ts`, `prompt.ts`, `parse.ts`, `text-guard.ts`, `map.ts`, `respond.ts`; `src/billing/chart-edit-gate.ts`
- Modify: `src/billing/types.ts` (add `GatedChartEditResponse`)
- Test: `tests/chart/copilot-schema.test.ts`, `tests/chart/copilot-text-guard.test.ts`, `tests/chart/copilot-map.test.ts`, `tests/chart/copilot-respond.test.ts`, `tests/billing/chart-edit-gate.test.ts`

**Read first:** every file in `src/attachments/copilot/` (the pattern, comments included), `src/billing/dataset-gate.ts`, `src/billing/gate.ts`, `src/chart/types.ts`, `tests/attachments/copilot-{schema,map,text-guard,respond}.test.ts`, `tests/billing/dataset-gate.test.ts`.

**Interfaces (produces):**

```ts
// src/chart/copilot/types.ts
export { PRESENTATION_KEYS, TEMPLATE_IDS } from '../../attachments/copilot/types.ts';
export const CBS_COPILOT_FORMS = ['line', 'area', 'bar', 'hbar', 'table'] as const;
export interface CbsCopilotCapabilities {
  forms: ('line' | 'area' | 'bar' | 'hbar' | 'table')[];
  presentationKeys: string[]; // ⊆ PRESENTATION_KEYS
  templates: string[];        // ⊆ TEMPLATE_IDS
  /** true only when the card offers the Vanaf/Tot zoom (line kind, >1 period). */
  zoom: boolean;
  lang: 'nl' | 'en';
}
export function sanitizeCbsCapabilities(raw: unknown): CbsCopilotCapabilities;
export type CbsViewCommand = z.infer<typeof cbsViewCommandSchema>; // from schema.ts
export interface CbsCopilotOutput {
  version: 1;
  view: CbsViewCommand[];
  /** The message asks for OTHER data (another region/period/measure, a computation, a comparison) — not a view change. */
  dataRequest: boolean;
  refused: { request: string; reason: 'not_available' | 'not_on_this_chart' | 'needs_click'; control: 'notes' | 'style' | 'form' | 'none' }[];
  confidence: number;
  reading: string; // server-side audit only, never returned to a client
}
/** What the server action returns inside the gate. `commands` are CopilotCommand-shaped
 * (src/attachments/types.ts's CopilotCommand minus setInstruction) so the client's
 * acceptReply() takes them unchanged. */
export type CbsCopilotReply =
  | { kind: 'edit'; text: string; commands: CopilotCommand[]; refused: CopilotRefusal[]; dataRequest: boolean; llmCalls: LlmCallInfo[] }
  | { kind: 'clarification'; text: string; llmCalls: LlmCallInfo[] }
  | { kind: 'refusal'; text: string; reason: 'empty_message' | 'internal'; llmCalls: LlmCallInfo[] };
export interface LlmCallInfo { model: string; promptVersion: number; inputTokens: number; outputTokens: number }
```

```ts
// src/chart/copilot/schema.ts
export const CBS_COPILOT_SCHEMA_VERSION = 1;
export const cbsPatchSchema = patchSchema;               // re-exported from attachments/copilot/schema.ts — ONE style vocabulary
export const cbsViewCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('setForm'), form: z.enum(['line', 'area', 'bar', 'hbar', 'table']) }),
  z.strictObject({ kind: z.literal('setSeriesView'), hiddenLabels: z.array(z.string()), highlightedLabel: z.string().nullable() }),
  z.strictObject({ kind: z.literal('setPeriodRange'), fromLabel: z.string().nullable(), toLabel: z.string().nullable() }), // both null = clear the zoom
  z.strictObject({ kind: z.literal('setPresentation'), patch: cbsPatchSchema }),
  z.strictObject({ kind: z.literal('applyTemplate'), templateId: z.string() }),
  z.strictObject({ kind: z.literal('resetPresentation') }),
  z.strictObject({ kind: z.literal('setTitle'), title: z.string().nullable() }),
  z.strictObject({ kind: z.literal('setCaption'), caption: z.string().nullable() }),
  z.strictObject({ kind: z.literal('addNote'), seriesLabel: z.string(), periodLabel: z.string(), text: z.string() }),
]);
export const cbsCopilotOutputSchema = z.strictObject({
  version: z.literal(1), view: z.array(cbsViewCommandSchema), dataRequest: z.boolean(),
  refused: z.array(z.strictObject({ request: z.string(), reason: z.enum(['not_available','not_on_this_chart','needs_click']), control: z.enum(['notes','style','form','none']) })),
  confidence: z.number(), reading: z.string(),
});
export function cbsCopilotOutputJsonSchema(): Record<string, unknown>; // oneOfToAnyOf(z.toJSONSchema(...)) — pin "no oneOf survives"
export class CbsCopilotValidationError extends Error { constructor(message: string, public readonly outputText: string) }
export function validateCbsCopilotOutput(outputText: string): CbsCopilotOutput; // JSON.parse + safeParse + confidence 0..1
```

```ts
// src/chart/copilot/prompt.ts
export const CBS_COPILOT_PROMPT_VERSION = 1;
export function buildCbsCopilotSystemPrompt(): string;
export interface CbsChartLabels { title: string; unit: string; kind: 'line' | 'bar'; seriesLabels: string[]; periodLabels: string[] }
export function serializeCbsCopilotRequest(chart: CbsChartLabels, capabilities: CbsCopilotCapabilities, message: string): string;
// src/chart/copilot/parse.ts
export const CBS_COPILOT_MODEL = 'claude-haiku-4-5';
export function chartLabels(spec: ChartSpec): CbsChartLabels; // periodLabels in spec order, de-duplicated; NEVER a value
export function buildCbsCopilotRequest(spec: ChartSpec, capabilities: CbsCopilotCapabilities, message: string, options?: { model?: string; maxTokens?: number }): LlmRequest; // maxTokens 1024, temperature 0
export class CbsCopilotFailure extends Error { constructor(public readonly cause: CbsCopilotValidationError, public readonly usage: LlmUsage, public readonly model: string) }
export function parseCbsCopilotReply(spec: ChartSpec, capabilities: CbsCopilotCapabilities, message: string, options: LlmCallOptions): Promise<{ output: CbsCopilotOutput; usage: LlmUsage; model: string }>;
// src/chart/copilot/text-guard.ts
export function unplottedDigits(text: string, spec: ChartSpec): string[]; // allowed = digit runs of every point's formattedValue, periodLabel, periodCode + spec.title + spec.unit + attribution.coveredPeriods.from/to
export function stripDigits(text: string): string;
// src/chart/copilot/map.ts
export function mapCbsCopilotOutput(output: CbsCopilotOutput, spec: ChartSpec, capabilities: CbsCopilotCapabilities, noteIdSuffix?: string): { commands: CopilotCommand[]; refused: CopilotRefusal[] };
// src/chart/copilot/respond.ts
export const MIN_CBS_COPILOT_CONFIDENCE = 0.8; // same value as attachments/respond.ts's MIN_INSTRUCTION_CONFIDENCE — import it, do not redeclare
export interface RespondToCbsChartEditInput { spec: ChartSpec; message: string; capabilities: unknown; llmOptions: LlmCallOptions }
export function respondToCbsChartEdit(input: RespondToCbsChartEditInput): Promise<CbsCopilotReply>;
// src/billing/chart-edit-gate.ts
export async function chargeAndRunChartEdit(db: Db, userId: string, requestId: string, run: () => Promise<CbsCopilotReply>): Promise<GatedChartEditResponse>;
// src/billing/types.ts (add)
export type GatedChartEditResponse =
  | { kind: 'ok'; reply: CbsCopilotReply; netCost: number }
  | { kind: 'insufficient_credits'; balance: number; required: number }
  | { kind: 'duplicate_request' };
```

**Behaviour rules (implement exactly):**

- `prompt.ts` system prompt: copy the structure of `src/attachments/copilot/prompt.ts`'s SYSTEM_PROMPT but (a) drop every INSTRUCTION rule and the `instruction` field, (b) describe the chart as "an OFFICIAL statistics chart whose data cannot be changed here", (c) add `dataRequest`: *"Set dataRequest to true — and leave view empty — when the message asks for different DATA: another region, country, period or measure, a total, average, difference, growth rate, or any comparison with data not on this chart. Never try to express a data change as a view change."* (d) `setPeriodRange` takes period LABELS copied literally from the CURRENT CHART's period labels, and only when CAPABILITIES.zoom is true; otherwise refuse with reason not_available and control form. (e) `addNote` anchors by `seriesLabel` + `periodLabel`. (f) A title/caption/note may only contain numbers visible on the chart. (g) `refused.control` has NO `data` value on this tier — a data request is `dataRequest: true`, not a refusal.
- `serializeCbsCopilotRequest` payload: `Chart: title="…" | unit="…" | kind=line\n- series labels: [a | b]\n- period labels: [2020 | 2021 | …]\n\nCapabilities:\n- forms=[…]\n- style keys=[…]\n- templates=[…]\n- zoom=true|false\n- lang=nl\n\nUser's message: "…"`. No `formattedValue`, no `value`, no `resultId`, no attribution sentence.
- `map.ts` mirrors `attachments/copilot/map.ts` rules 2–8 with these differences: no rule 1 (no instruction); `setForm` is refused (`not_available`, control `form`) when the form is not in `capabilities.forms`; `setPeriodRange` with both labels null → `{ kind: 'setPeriodRange', range: null }`; otherwise both labels must resolve to a `periodCode` via lookup over ALL points (first match in spec order), `from <= to` (localeCompare, the same order `allPeriodCodes` in chart.tsx uses — swap when reversed), `capabilities.zoom` must be true, else refuse `not_available`/`form`; `addNote` finds the point by `series.label === seriesLabel && point.periodLabel === periodLabel`, note = `{ id: \`chat-${point.resultId}-${n}${suffix}\`, resultId: point.resultId, periodLabel: point.periodLabel, seriesLabel: series.label, text }`; series keys are `s${index}` over `spec.series` (the chart.tsx `seriesMeta` convention). Model refusals (rule 8): a `control` value of `'data'` cannot occur (schema); keep the digit strip.
- `respond.ts` flow: empty message → `{ kind: 'refusal', reason: 'empty_message', text: 'Type what should change on the chart.' , llmCalls: [] }`; sanitize capabilities; one `parseCbsCopilotReply` call; `CbsCopilotFailure` → `{ kind: 'clarification', text: 'That did not come through as a chart change. Try naming the form, a series, a period, or the style.', llmCalls: [real usage] }`; confidence below threshold → the same clarification text; else `mapCbsCopilotOutput` → `{ kind: 'edit', text, commands, refused, dataRequest }` where `text` is: dataRequest → `'That asks for other data — ask it as a follow-up question and the answer gets its own chart.'`; else `commands.length === 0 && refused.length > 0` → `'Nothing could be applied.'`; else `commands.length === 1` → `'Applied one change.'`; else `'Applied several changes.'` (every string digit-free, English, #206).
- `chart-edit-gate.ts`: `required = getActionClassPrice(db, 'clarification')`; `reserveDebit(db, userId, requestId, required)` (the existing question-cost reservation — read `reserveDebit`'s signature and `ReserveDebitResult` in `src/billing/ledger.ts` first); `insufficient`/`duplicate` mapped like dataset-gate; `run()`; reply.kind `'edit'` keeps the debit (netCost = required); `'clarification'`/`'refusal'` → `compensateSplit(db, userId, split, required, null)`, netCost 0; a throw → full compensation then rethrow. Header comment must say why the `clarification` class is reused (no new action class = no migration; cheapest mechanism first; re-pricing is [#285](../../open-questions.md)).

**Tests (write each BEFORE its implementation, run red, implement, run green):**

- `tests/chart/copilot-schema.test.ts`: (1) `cbsCopilotOutputJsonSchema()` has no `oneOf` anywhere (JSON.stringify includes check); (2) `cbsPatchSchema` keys equal `PRESENTATION_KEYS` exactly; (3) every enum value of every patch key survives `sanitizeOverrides` (import from `web/lib/chart-presentation.ts` the way `tests/attachments/copilot-schema.test.ts` does); (4) `validateCbsCopilotOutput` rejects an `instruction` field (strictObject), rejects confidence 1.2, accepts a minimal valid object; (5) `sanitizeCbsCapabilities({ forms: ['line','pie'], presentationKeys: ['grid','bogus'], templates: ['newsroom'], zoom: 'yes', lang: 'fr' })` → `{ forms: ['line'], presentationKeys: ['grid'], templates: ['newsroom'], zoom: false, lang: 'nl' }`.
- `tests/chart/copilot-text-guard.test.ts`: build a `ChartSpec` with `chartSpecSchema`-valid shape (copy the `point`/`spec` factory from `tests/chart/build.test.ts` or `web/components/chart.test.tsx:87-125`); a title quoting a plotted `formattedValue` ("1.234") passes; "2024" (a periodLabel) passes; "99" fails with `['99']`; `stripDigits('Groei van 12%')` → `'Groei van %'`.
- `tests/chart/copilot-map.test.ts` over a two-series line spec (Amsterdam/Rotterdam, periods 2020–2022): `setSeriesView({hiddenLabels:['Rotterdam'], highlightedLabel:'Amsterdam'})` → `{ hiddenKeys: ['s1'], highlightedKey: 's0' }`; an unknown label → one `not_on_this_chart` refusal with control `form` and NO command; `setPeriodRange({fromLabel:'2021', toLabel:'2022'})` with `zoom:true` → `range: ['2021JJ00','2022JJ00']`; the same with `zoom:false` → refused `not_available`; reversed labels are swapped; `addNote` on a real point → `resultId` is that point's, id starts with `chat-`; `addNote` with text "99 procent" → refused `unplotted_number`; `setForm('hbar')` with `forms:['line','bar','table']` → refused `not_available`/`form`; `applyTemplate('newsroom')` → command; `applyTemplate('bogus')` → refused; a model refusal whose request contains an unplotted number is stripped, not dropped.
- `tests/chart/copilot-respond.test.ts` with a fake `LlmClient` (the `tests/attachments/copilot-respond.test.ts` pattern, but NO db): empty message → refusal, zero calls; a client returning `{version:1, view:[{kind:'setForm', form:'bar'}], dataRequest:false, refused:[], confidence:0.95, reading:'x'}` → `kind:'edit'`, one command, `text: 'Applied one change.'`, `llmCalls[0].promptVersion === CBS_COPILOT_PROMPT_VERSION`; confidence 0.5 → clarification; malformed JSON → clarification carrying the real usage; `dataRequest:true` → `kind:'edit'`, `dataRequest:true`, zero commands, the data-request text; assert the request the fake client received contains no `formattedValue` string of the spec (serialize the spec's values and check `request.question` does not include any of them).
- `tests/billing/chart-edit-gate.test.ts` (PGlite, copy the setup of `tests/billing/dataset-gate.test.ts`): an `edit` reply debits exactly the `clarification` price once with reason `question_cost`; a `refusal` reply ends at net 0 (one debit + one compensation); a thrown `run` compensates and rethrows; a second call with the same requestId returns `duplicate_request` and does not call `run`; insufficient balance returns `insufficient_credits` without calling `run`.

- [ ] **Step 1:** Write `tests/chart/copilot-schema.test.ts`, run `npx vitest run tests/chart/copilot-schema.test.ts` → fails (module missing).
- [ ] **Step 2:** Create `types.ts` + `schema.ts`; run → green.
- [ ] **Step 3:** Write `copilot-text-guard.test.ts` → red; create `text-guard.ts` → green.
- [ ] **Step 4:** Write `copilot-map.test.ts` → red; create `map.ts` → green.
- [ ] **Step 5:** Create `prompt.ts` + `parse.ts`; write `copilot-respond.test.ts` → red; create `respond.ts` → green.
- [ ] **Step 6:** Write `chart-edit-gate.test.ts` → red; add `GatedChartEditResponse` to `src/billing/types.ts`, create `chart-edit-gate.ts` → green.
- [ ] **Step 7:** `npm run typecheck` (root) clean; `npx vitest run tests/chart tests/billing tests/attachments` all green.
- [ ] **Step 8:** Commit: `feat(chart): CBS/Eurostat chart co-pilot backend — selection-only schema, label→key map, digit guard, respond, chart-edit billing gate (co-pilot phase 3, session 114)`.

---

### Task 2: Browser-side capabilities, example chips, copy

**Files:**
- Modify: `web/lib/chart-capabilities.ts`, `web/lib/i18n/messages.ts`
- Test: `web/lib/chart-capabilities.test.ts` (extend)

**Read first:** `web/lib/chart-capabilities.ts` (whole file), `web/lib/chart-capabilities.test.ts`, `web/lib/chart-view-state.ts` (`lineFormAllowed`/`areaFormAllowed`/`hbarFormAllowed`), `web/lib/i18n/messages.ts` lines 255–300 and 1335–1372 (the existing `chart.copilot.*` keys, nl and en).

**Interfaces (produces):**

```ts
// web/lib/chart-capabilities.ts (add; nothing existing changes)
import type { ChartSpec } from '../backend/chart/types.ts';
export function cbsCapabilities(input: {
  spec: Pick<ChartSpec, 'kind' | 'series'>;
  form: ChartForm;
  applicable: ReadonlySet<PresentationKey>;
  /** chart.tsx's own `zoomAvailable` (line kind, more than one period code). */
  zoomAvailable: boolean;
  lang: Lang;
}): CbsCopilotCapabilities; // type imported from '../backend/chart/copilot/types.ts'
export function cbsExampleChips(input: {
  spec: Pick<ChartSpec, 'kind' | 'series'>;
  state: Pick<ChartDocState, 'title' | 'hiddenKeys'>;
  zoomAvailable: boolean;
  lang: Lang;
}): ExampleChip[];
```

Rules: `cbsCapabilities.forms` = the same three predicates as `formsFor` (reuse it — it takes `PlottableSpec`, which `Pick<ChartSpec,'kind'|'series'>` satisfies structurally; check with typecheck, otherwise widen `formsFor`'s parameter type to `Pick<ChartSpec | UserChartSpec, 'kind'>`); `presentationKeys` = `PRESENTATION_KEYS ∩ applicable`; `templates` = all unless `form === 'table'`; `zoom = zoomAvailable`.
`cbsExampleChips`, exactly three, deterministic, digit-free, in this priority: (1) if `spec.series.length > 1` and some series is not hidden → `chart.copilot.example.spotlight` with the label of the series whose LAST non-null value is highest (copy `topSeriesLabel`'s logic over `ChartSpec` points: `value`, label `series.label`); (2) if `zoomAvailable` → `chart.copilot.example.lastYears` ("Alleen de laatste jaren" / "Only the last few years"); (3) `chart.copilot.example.addTitle`/`shorterTitle` per `state.title`; fill from `FALLBACK_KEYS` (`makeBar`, `hideGrid`) — but `makeBar` only when `spec.kind === 'line'` (a bar spec is already bars; use `hideGrid` then `chart.copilot.example.newsroomLook` "Geef het de nieuwsroom-look" / "Give it the newsroom look").

New i18n keys (nl / en), add next to the existing `chart.copilot.*` block in BOTH language maps:
- `chart.copilot.example.lastYears`: 'Alleen de laatste jaren' / 'Only the last few years'
- `chart.copilot.example.newsroomLook`: 'Geef het de nieuwsroom-look' / 'Give it the newsroom look'
- `chart.copilot.followUp`: 'Stel als vervolgvraag' / 'Ask as a follow-up question'
- `chart.copilot.followUpHint`: 'Dit vraagt om andere data. Als vervolgvraag krijgt het een eigen antwoord en grafiek.' / 'This asks for other data. As a follow-up it gets its own answer and chart.'
- `chart.copilot.cbsLocked`: 'De cijfers zelf veranderen hier niet: dit is een officiële grafiek. Vorm, periode, reeksen, opmaak en tekst wel.' / 'The figures themselves do not change here: this is an official chart. Form, period, series, style and text do.'
- `chart.extended.badge`: 'Grafiek uitgebreid' / 'Chart extended'
- `chart.extended.hint`: 'Vervolg op de vorige grafiek: dezelfde bron en eenheid, in dezelfde vorm en opmaak.' / 'Continues the previous chart: the same source and unit, in the same form and look.'
- `chart.copilot.reason.data_request` is NOT needed (dataRequest is not a refusal).

Tests to add in `web/lib/chart-capabilities.test.ts` (copy the file's existing fixture style): forms for a 2-series line spec are `['line','bar','table']`; a bar spec with one series offers `['line','bar','hbar','table']`; `templates` empty in table form; `zoom` mirrors the input; `cbsExampleChips` returns exactly three, all digit-free (`/\d/` on every label fails), spotlight chip names the top series, `makeBar` absent on a bar spec, `lastYears` present only when `zoomAvailable`; the i18n test that pins "no digit in any `chart.*` string" (find it with `grep -rn "chart\." web/lib/i18n/*.test.ts`) still passes.

- [ ] **Step 1:** Add the i18n keys (both maps) — `cd web && npx vitest run lib/i18n` green.
- [ ] **Step 2:** Write the new tests in `web/lib/chart-capabilities.test.ts` → red.
- [ ] **Step 3:** Implement `cbsCapabilities` + `cbsExampleChips` → green; `cd web && npm run typecheck` clean.
- [ ] **Step 4:** Commit: `feat(web): CBS chart co-pilot capabilities + example chips + copy (co-pilot phase 3, session 114)`.

---

### Task 3: The server action, the card, the follow-up hand-off, "Grafiek uitgebreid"

**Files:**
- Create: `web/app/chart-copilot-actions.ts`
- Modify: `web/components/chart-copilot-input.tsx`, `web/components/chart.tsx`, `web/components/chat.tsx`, `web/components/visual-dock.tsx`, `web/lib/dock-visuals.ts`
- Test: `web/components/chart-copilot-cbs.test.tsx` (new), `web/components/chart-commands-contract.test.tsx` (extend), `web/components/chat.test.tsx` (extend), `web/components/chart-copilot-input.test.tsx` (extend)

**Read first:** `web/app/chart-headline-actions.ts` (the spec-parse precedent), `web/app/dataset-copilot-actions.ts` (the guards), `web/components/user-chart.tsx` lines 536–672 (the reply flow to mirror), `web/components/chart.tsx` lines 1489–1640, 2040–2060, 2236–2262, 3596–3620, 4120–4150, 4420–4460; `web/components/chat.tsx` lines 349–420, 668–700, 860–900, 1340–1350; `web/components/visual-dock.tsx` 100–125; `web/lib/dock-visuals.ts`; `web/components/chart-commands-contract.test.tsx`; `web/components/chart-copilot-input.test.tsx`.

**Interfaces (produces):**

```ts
// web/app/chart-copilot-actions.ts ('use server')
export type AdjustCbsChartOutcome = GatedChartEditResponse | { kind: 'unauthenticated' } | { kind: 'invalid_spec' };
export async function adjustCbsChart(rawSpec: unknown, message: string, requestId: string, rawCapabilities: unknown): Promise<AdjustCbsChartOutcome>;
```
Guards, copied from `dataset-copilot-actions.ts`: message a string ≤ 500 chars, requestId a UUID; `currentUserId()` null → unauthenticated; `chartSpecSchema.safeParse(rawSpec)` failure → `invalid_spec`; then `chargeAndRunChartEdit(getDb(), userId, requestId, () => respondToCbsChartEdit({ spec, message, capabilities: rawCapabilities, llmOptions: { client: new AnthropicLlmClient() } }))`; errors → `reportError('adjustCbsChart', …)` then rethrow. Header comment: why the client's spec is accepted (the `draftChartHeadline` precedent: the model only ever sees LABELS from it, and every command is re-validated by the card against the spec it draws; a forged spec can at worst produce a command the real card drops).

```ts
// web/components/chart-copilot-input.tsx (additive)
export interface CopilotReply { …existing…; /** phase 3: the reader's original message when the reply said "this asks for other data"; the strip shows one chip that sends it as a follow-up. */ followUp?: string | null; }
export function ChartCopilotInput(props: { …existing…; onAskFollowUp?: (message: string) => void; /** phase 3: one sentence above the field explaining that figures do not change here (CBS tier only). */ lockedNote?: string | null; })
```
In `ReplyStrip`: when `reply.followUp` is a string and `onAskFollowUp` is given, render `<p className="mt-1.5 text-xs text-muted-foreground">{t('chart.copilot.followUpHint')}</p>` and a `Button variant="secondary" size="sm"` labelled `chart.copilot.followUp` that calls `onAskFollowUp(reply.followUp)`. `lockedNote` renders as `<p className="mb-1 text-xs text-muted-foreground">` above the form.

```ts
// web/components/chart.tsx (props added)
/** Phase 3: the thread's own send, so a "this asks for other data" reply can become a follow-up question in ONE click. Absent = no chip (gallery, embed, stage). */
onAskFollowUp?: (message: string) => void;
/** Phase 3: this answer's chart continues the previous card in the thread (same table, unit, kind, dims) — shows the "Grafiek uitgebreid" badge. */
extendsPrevious?: boolean;
```
Inside `ChartView`: `const copilotAvailable = editsKey !== null;` (the same gate as persistence — signed in, in-app, saved answer). State `copilotBusy/copilotReply/copilotError` and the functions `applyCopilotOutcome`, `sendToCopilot`, `replyIsUndoable`, `undoCopilotReply`, `copilotCanOpen`, `openCopilotTarget` are copied from `user-chart.tsx` 536–672 with these changes: no `edit`/`instruction`/`renderFailure`/cache; `adjustCbsChart(spec, message, crypto.randomUUID(), cbsCapabilities({ spec, form: activeForm, applicable: resolved.applicable, zoomAvailable, lang: chartLang }))`; outcome mapping: `unauthenticated` → `common.sessionExpired`; `duplicate_request` → `chart.copilot.error.duplicate`; `insufficient_credits` → `datasetChat.insufficientCredits` (existing key, same sentence); `invalid_spec` → `chart.copilot.error.failed`; `ok` → `reply = outcome.reply`; `kind !== 'edit'` → a reply with no chips; `edit` → `acceptReply(reply.commands, { spec, alternatesCount: alternates.length }, chartLang)`, dispatch each with `'chat'`, `followUp: reply.dataRequest ? message : null`, `turnId: null` (no vote on this tier — nothing stored to vote on), `netCost: outcome.netCost`. `openCopilotTarget`: `'style'` → open the Style panel (find the existing `setStyleOpen`/panel state in chart.tsx), `'form'` → focus the active form tab (`lineTabRef`/… exist), `'notes'` → focus the notes strip (add a ref on `notesNode`'s root if none), `'data'` never occurs (no data chip on this tier).
Mount: directly after `{notesNode}` at ~line 4145, `{copilotAvailable && state.form !== 'table' && !storyOpen ? <ChartCopilotInput lang={chartLang} busy={copilotBusy} examples={cbsExampleChips({ spec, state, zoomAvailable, lang: chartLang })} reply={copilotReply === null ? null : { ...copilotReply, canUndo: replyIsUndoable(copilotReply) }} error={copilotError} onSend={(m) => void sendToCopilot(m)} onUndoReply={undoCopilotReply} onRetry={(m) => void sendToCopilot(m)} onFeedback={async () => ({ ok: false })} onOpen={openCopilotTarget} canOpen={copilotCanOpen} onAskFollowUp={onAskFollowUp} lockedNote={t(chartLang, 'chart.copilot.cbsLocked')} /> : null}`. The strip renders OUTSIDE the export container (check where `chartContainerRef` closes — the notes strip is already outside it; mount beside it). In table form and while the story panel is open the input is not mounted (the same rule the notes strip follows).
Badge: when `extendsPrevious` is true and `!embedMode && !inStage`, render next to the title (find `titleEditable` / the heading row ~line 3535) a `<span title={t('chart.extended.hint')} className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{t('chart.extended.badge')}</span>`.

`chat.tsx`: add a pure helper (export it for the test) `export function extendsPreviousChart(messages: Message[], index: number): boolean` — true when `messages[index].chart` is non-null and some EARLIER message has a chart with equal `attribution.tableId`, `unit`, `kind` and deep-equal `dims` (JSON.stringify of a key-sorted copy). Pass `onAskFollowUp={(m) => void sendText(m)}` and `extendsPrevious={extendsPreviousChart(messages, i)}` to the inline `<ChartView>` (line ~1344). For the dock: add `onAskFollowUp?: (message: string) => void` and `extendsPrevious: boolean` to the dock visual item in `web/lib/dock-visuals.ts` (set where chat builds the dock list — grep `userChartEdit` for the spot) and pass both in `visual-dock.tsx`'s `<ChartView>`. The seeded look ("mounts wearing the previous card's form and look"): when `extendsPrevious`, chat passes `initialFormOverride` and `initialPresentation` read from the previous card's saved log — obtain them with `fetchChartEdits({ kind: 'answer', id: previousAuditId })` + `parseCommandLog` + a fold over `applyCommand` from `initialDocState(defaultFormFor(prevSpec))` (all existing exports); do this inside a small `useEffect` in chat.tsx keyed on the new message's index, storing `{ form, presentation }` in component state, and pass them only once resolved (before that the card mounts plainly — acceptable; the badge shows immediately). If `fetchChartEdits` returns `ok:false` or `log:null`, pass nothing.

**Tests:**
- `web/components/chart-copilot-cbs.test.tsx` (copy the mock block of `chart-commands-contract.test.tsx` verbatim, plus `vi.mock('../app/chart-copilot-actions.ts', () => copilotActions)` with `adjustCbsChart: vi.fn()`; mock `useChartStyle` the way `chart-edits-persistence.test.tsx` makes `signedIn` true): (1) signed in + `embed={{auditId: 7}}` → the group "Deze grafiek aanpassen via de chat" is in the document; without `embed` it is not; in `embedMode` it is not. (2) Send "verberg Rotterdam" with the action resolving `{ kind:'ok', netCost:10, reply:{ kind:'edit', text:'Applied one change.', commands:[{ kind:'setSeriesView', hiddenKeys:['s1'], highlightedKey:null }], refused:[], dataRequest:false, llmCalls:[] } }` → one `.recharts-line-curve` fewer is hard in jsdom, so assert instead: a chip button whose name starts with the series label describe text (`describeCommand`'s output for that command, compute it in the test) appears, and `saveChartEdits` is eventually called with a log whose last entry has `source:'chat'`. (3) A `dataRequest:true` reply → the "Stel als vervolgvraag" button appears and clicking it calls the `onAskFollowUp` prop with the original message. (4) A reply whose command names an unknown key `s9` → `dropped` line "Eén onderdeel kon niet worden toegepast." and no dispatch. (5) `extendsPrevious` → the badge "Grafiek uitgebreid" renders; absent otherwise.
- `chart-commands-contract.test.tsx`: add the assertion that every kind `cbsViewCommandSchema` can produce (map its `kind` literals → command kinds: `setPeriodRange`, `setSeriesView`, `setForm`, `setPresentation`, `applyTemplate`, `resetPresentation`, `setTitle`, `setCaption`, `addNote`) has a `data-command-kind` control on the rendered `ChartView` — import the schema from `../backend/chart/copilot/schema.ts` and read `options` literal values.
- `chat.test.tsx`: `extendsPreviousChart` — two answers on the same table/unit/kind/dims → true for the second; differing `unit` → false; a user message in between does not matter.
- `chart-copilot-input.test.tsx`: `followUp` renders the chip and forwards the message; `lockedNote` renders.

- [ ] **Step 1:** Write the `chart-copilot-input.test.tsx` additions → red; extend the component → green.
- [ ] **Step 2:** Create `chart-copilot-actions.ts`; `cd web && npm run typecheck` clean.
- [ ] **Step 3:** Write `chart-copilot-cbs.test.tsx` → red; wire `chart.tsx` → green; `chart.test.tsx`, `chart-history-ui.test.tsx`, `chart-edits-persistence.test.tsx`, `chart-headline-ui.test.tsx` still green.
- [ ] **Step 4:** Extend `chart-commands-contract.test.tsx` → green.
- [ ] **Step 5:** `chat.tsx`/dock threading + `extendsPreviousChart` + its test → green; `chat.test.tsx`, `chat-workspace.test.tsx`, `workspace.test.tsx`, `visual-dock` tests green.
- [ ] **Step 6:** `cd web && npm run typecheck && npx vitest run` — everything green.
- [ ] **Step 7:** Commit: `feat(web): 'Pas deze grafiek aan' on the CBS card — server action, reply flow, follow-up hand-off, 'Grafiek uitgebreid' badge (co-pilot phase 3, session 114)`.

---

### Task 4: Hand-authored LLM fixtures for the CBS tier

**Files:**
- Create: `scripts/chart-copilot-fixtures.ts`, `tests/fixtures/chart-copilot/cases.ts`, `tests/chart/copilot-fixtures.test.ts`
- Modify: `package.json` (scripts `chart-copilot:fixtures`, `chart-copilot:record`)
- Generated: `tests/fixtures/llm/chart-copilot/<hash>.json` (three files)

**Read first:** `scripts/attachments-fixtures.ts` (whole), `tests/fixtures/attachments/cases.ts`, `tests/attachments/fixtures.test.ts`, `web/e2e/chart-copilot.spec.ts` lines 1–30 (the `!!intent` harness question that produces the Amsterdam + Rotterdam 2020–2024 population chart), `src/answer/llm/client.ts` (`RecordingLlmClient`, `requestHash`, `RecordedFixture`).

**The spec the cases run against** must be the EXACT spec the harness draws for that `!!intent` question, because the Playwright proof (Task 5) sends the card's real spec. Produce it deterministically: the root test helper that builds the chart for a stored answer — find how `tests/chart/build.test.ts` or `tests/answer/*` build a `ChartSpec` from the seeded fixture data (`grep -rn "buildChartSpec(" tests | head`), and reproduce the population_on_1_january / GM0363+GM0599 / 2020JJ00–2024JJ00 chart with the same seeded rows the harness database gets (`scripts/dev-harness/pglite-preload.mjs` + `tests/helpers/*` — read them). If that proves impossible in under an hour, STOP and report: the fallback is a `cases.ts` that stores the spec as a JSON literal captured once from the harness (`scripts/dev-harness/ask.mjs` prints the answer envelope) — say which route you took.

Three cases, `capabilities` written out by hand the way `LINE_CAPABILITIES` is (forms `['line','bar','table']`, presentation keys = everything but `areaFill`, all templates, `zoom: true`, lang `nl`):
1. `hide-rotterdam`: message `'verberg Rotterdam'` → `view: [{ kind:'setSeriesView', hiddenLabels:['Rotterdam'], highlightedLabel:null }]`, `dataRequest:false`, confidence 0.95.
2. `bars-and-title`: message `'maak er staven van en geef het de kop Bevolking in twee steden'` → `view: [{ kind:'setForm', form:'bar' }, { kind:'setTitle', title:'Bevolking in twee steden' }]`, confidence 0.93.
3. `add-utrecht`: message `'en Utrecht erbij'` → `view: []`, `dataRequest:true`, confidence 0.9.

`scripts/chart-copilot-fixtures.ts` = `attachments-fixtures.ts` with `buildCaseRequest(kase) = buildCbsCopilotRequest(kase.spec, sanitizeCbsCapabilities(kase.capabilities), kase.message)` and `FIXTURES_DIR = tests/fixtures/llm/chart-copilot`; `--record` uses `RecordingLlmClient` exactly as there (owner-supervised, never from CI/subagents — you do NOT run `--record`). `tests/chart/copilot-fixtures.test.ts` = `tests/attachments/fixtures.test.ts`'s pattern: for every case the fixture file for its `requestHash` exists and its stored `response.outputText` parses through `validateCbsCopilotOutput` and equals the case's `output`.

- [ ] **Step 1:** Write `cases.ts` + the fixtures test → red (no files).
- [ ] **Step 2:** Write the script, add the two npm scripts, run `npm run chart-copilot:fixtures` → three files written; test green.
- [ ] **Step 3:** Run `npm run chart-copilot:fixtures` again → prints `unchanged` for all three (idempotent).
- [ ] **Step 4:** `npm run typecheck` clean. Commit: `test(chart): hand-authored LLM fixtures + chart-copilot:fixtures/record scripts (co-pilot phase 3, session 114)` — include the three generated JSON files.

---

### Task 5: The real-browser proof (session-run, main checkout only)

**Files:**
- Create: `web/e2e/cbs-copilot.spec.ts`

Pattern: `web/e2e/chart-copilot.spec.ts` (sign-in, `!!intent` question, the card locator) + `web/e2e/own-data-copilot.spec.ts` (the co-pilot group locator, chips, ⌘Z, reload). Walk: ask the `REGION_SERIES_INTENT` question → 2 curves → in the group "Deze grafiek aanpassen via de chat" type `verberg Rotterdam` → 1 curve, a chip whose name contains "Rotterdam" → ⌘Z → 2 curves → type `en Utrecht erbij` → the button "Stel als vervolgvraag" is visible; click it → a NEW user message "en Utrecht erbij" appears in the thread (the follow-up path answers from the harness's follow-up fixtures if one exists for that exact question; if the stub 400s, assert only that the user message was appended and an assistant message followed — read `scripts/dev-harness/llm-stub.mjs`'s miss behaviour first and assert what is honest) → reload → reopen the thread → the first card still shows 1 curve? NO — ⌘Z restored 2; assert 2 curves and the history's Undo button enabled (an edit was saved).

- [ ] **Step 1:** Write the spec.
- [ ] **Step 2:** `cd web && npx playwright test e2e/cbs-copilot.spec.ts` → green (harness starts automatically).
- [ ] **Step 3:** Commit: `test(e2e): CBS chart co-pilot real-browser proof, zero model calls (co-pilot phase 3, session 114)`.

---

### Task 6: Docs (the session's own)

ADR 056 "As built — phase 3" (the billing decision: `clarification` class + `question_cost`, no audit row; the `dataRequest` hand-off; no series merge); ADR 037 untouched; `docs/04-architecture.md` capability row; `docs/03-mvp-scope.md` phase-3 line; `docs/08-build-plan.md` header (phase 3 built; phases 4–5 next); `docs/RUNBOOK.md` § "chart-copilot:record" (owner step, after the API cap lifts 2026-10-01); `docs/open-questions.md` #285 (re-price the CBS chart edit with its own action class — needs a migration), #286 (the reply text/refusals of a CBS chart edit are not stored anywhere; store if usage warrants), #287 (series merge for "Grafiek uitgebreid" — today a badge + carried-over look only), #288 (`attachments:record` and `chart-copilot:record` blocked by the API cap until 2026-10-01); STATUS top block + archive; lessons; session-115 kickoff.
