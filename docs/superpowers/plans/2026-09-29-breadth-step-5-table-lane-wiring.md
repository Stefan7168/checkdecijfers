# Breadth step 5 — wire the table lane into chat (dark behind `TABLE_LANE_ENABLED`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A question the curated lane cannot place, for which the existing table finder is confident, is answered in the
same chat from a slice of that CBS table: the chat shows "CBS-tabel ophalen…", a job outside the request registers the
table's layout, parses the question against that one table, resolves the breakdowns (CBS total stated, or a button
question), fetches + validates + stores just the needed cells, and writes an audited answer into the conversation.
Normal question price, charged only on an answer. Dark behind `TABLE_LANE_ENABLED` (off in production); zero AI spend
(hermetic stub clients — the parser's recording run stays owner-supervised after 2026-10-01).

**Architecture:** Request path (`web/app/actions.ts`): the curated pipeline runs unchanged; when it returns the finder's
`onboarding_pending` / `onboarding_already_pending` routing and the flag is on, the action reserves the normal question
price, inserts a `table_lane_requests` row (migration 038, FILE-ONLY) and kicks `/api/table-lane-job` via `after()`; the
client polls `pollTableLane(rowId)`. The job (`src/ingestion/table-lane-job.ts`) runs `planTableLane` (a pure-ish
tagged-outcome wrapper over builder → parse → bridge → resolver → period/region resolution → slice request), then
`ensureSlice` (never under the shared lock), then `respondTableLane` (existing `respondToIntent` with a hand-built
explicit-target `ParseOutcome`, the eurostat-explorer precedent), audits, attaches to the thread, and settles the debit in
the same transaction as the row's terminal status. Button replies go through `replyToTableLane(rowId, choice)`, which
matches against the stored `dimension_labels` (ALL members) before creating a child row.

**Tech stack:** TypeScript (Node 24, `--experimental-strip-types` style `.ts` imports), vitest, PGlite hermetic DB
(ADR 009), Next.js App Router server actions + route handlers, zod.

**Spec:** [docs/superpowers/specs/2026-09-28-breadth-any-cbs-table-design.md](../specs/2026-09-28-breadth-any-cbs-table-design.md)
(D1–D8, §4 step 5); ADR [062](../../decisions/062-breadth-table-lane-slice-cache.md) (as built — steps 2, 3, 4, 4b; "open
points (step 5)"); design items [#336](../../open-questions.md) (1)–(10) and [#339](../../open-questions.md) (5)–(11).

## Global Constraints

- Branch `breadth-step-5` (already created from `main` @ `e8aedbe5`). Implementers **never** push, merge, open a PR,
  touch `.env`, use `git stash`, call a real LLM, run `--record`, touch a live DB, or edit an applied migration
  (001–036). Migration 037 is FILE-ONLY and unapplied — do not edit it either; new DDL goes in **038** only.
- **Curated lane byte-identical:** the curated parser prompts/fixtures, the benchmark run, and every existing response
  for a flag-off request stay unchanged. `src/answer/respond/respond.ts`, `src/answer/intent/*` behaviour must not change;
  new code is additive. With `TABLE_LANE_ENABLED` unset, `askQuestion` behaves exactly as today (existing tests prove it).
- **Principle (a):** the LLM never produces a number. The table parse returns codes/choices only; every code is checked
  against the table's own stored lists (already done by `validateTableParseOutput` + `namedFromParse`; this plan adds the
  region and period checks against `dimension_labels`).
- **Principle (b) / D5:** CBS is only contacted inside the job (route handler), never in a server action. The request
  path reads only our DB. Answers are composed only from stored, validated cells (`runQuery` over `slice_fetches`-covered
  cells).
- **Principle (c) / D7:** every non-happy branch is a typed refusal or a question — never a default that is not CBS's own
  unique total / `Waarde` member / the national member. Rulings to paste verbatim into implementer briefs:
  - "`measureCode === null` ('geen') is refused BEFORE `namedFromParse` is ever called."
  - "`periodGrainUnavailable === true` is a refusal, not a warning."
  - "`confidence < DEFAULT_TABLE_PARSE_CONFIG.acceptThreshold` is a refusal (reason `table_lane_unsure`), never a guess."
  - "An `anders` choice becomes a question for that dimension's FULL member list, never the total."
  - "A typed reply to a breakdown question is matched against ALL members of that dimension from `dimension_labels`
    (normalized exact title match, or exact code); no match → the same question again, free; never a nearest match."
- **Never call `ensureSlice` / `fetchSlice` / `registerSchemaOnly` while holding resolveIntent's shared per-table lock**
  (self-deadlock, #336 (1)). The job calls them strictly before `runQuery`.
- **Money:** normal question price (`getActionClassPrice(db,'simple')`, via the same debit primitive `chargeAndRun` uses
  — `reserveDebit` with `QUESTION_DEBIT`, Pro bucket included; NOT the onboarding debit). Settlement exactly like
  `chargeAndRun` (`src/billing/gate.ts`): answer → keep; clarification → `compensateSplit` down to the `clarification`
  price; refusal, failure, or give-up → `compensate` in full. Settlement happens **in the same transaction** that sets the
  row's terminal status (`done` / `failed`), so a row can never be terminal and unsettled, or settled twice. The routing
  turn itself (the curated `onboarding_pending` refusal) stays free as today (chargeAndRun already refunds it).
- **Audit (R8):** every job outcome (answer, clarification, refusal incl. `table_lane_failed`) writes exactly one
  `audit_answers` row (`source_tag 'user'`, the row's `request_id`/`user_id`/`thread_id`), fail-closed as today. The
  envelope carries a new present-only key `tableLane` (see Task 3); `tests/audit/envelope-key-manifest.test.ts` updated.
  The table parse is recorded in `llm_calls` with a new role `'table_parse'`.
- **Copy:** interface strings nl + en in `web/lib/i18n/messages.ts`. Backend refusal/question texts: Dutch templates,
  plus the deterministic English templates the existing `english: NonAnswerEnglish` path uses. Progress text (spec D5):
  nl "CBS-tabel ophalen…", en "Fetching the CBS table…". Over-budget text: nl "Dit duurt langer dan normaal. Het antwoord
  verschijnt in dit gesprek zodra het klaar is.", en "This is taking longer than usual. The answer will appear in this
  conversation as soon as it is ready."
- **Flag:** `TABLE_LANE_ENABLED === '1'` read by one helper `tableLaneEnabled(): boolean` in `web/lib/table-lane.ts`
  (outside the `'use server'` file, same reason as `web/lib/english-answers.ts`).
- 8 GB machine: run ONE vitest file at a time, in the foreground. Never background a test/build command.
- Commit per task with the message given; end each commit message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Settled design choices (engineering defaults — mirrored in open-questions by Task 8)

1. **CBS unreachable with a cached slice (#336 (3)):** when `ensureSlice` fails at stage `fetch` and a `slice_fetches`
   row for the same filter key has `checked_at` within the last **24 hours**, answer from it (the answer's date is that
   row's `checked_at`, as the query layer already shows). Otherwise refuse `cbs_unreachable`. **Assumption** — 24 h
   mirrors the daily sync of curated tables.
2. **Older CBS `Modified` (#336 (9)):** retry `ensureSlice` once after 2 s; a second failure refuses `cbs_unreachable`.
3. **Lock timeout (#336 (2)):** the 180 s lock timeout stays; it lands on the job, not the request. The client's polling
   budget message covers slow jobs.
4. **Stale job rows:** a `running` row older than 5 minutes is reclaimed; `attempts` ≤ 2; the third failure finalizes
   the row `failed` with an audited refusal `table_lane_failed` + full refund (it lands in the thread — no silent drop).
5. **"Nederland" on a national-only table (#339 (5)):** a region term whose normalized name is `nederland` / `heel
   nederland` on a table with no geo / geo-like dimension and no region-coded breakdown member is dropped **only when**
   the table's title does not contain "Caribisch"; otherwise refuse `region_unavailable`. Recorded as a stated
   selection line "Regio: Nederland (landelijke tabel)".
6. **Regions (#339 (8)):** geo and geo-like dimensions are treated alike: named places match on
   `normalizeRegionName(baseLabel(label))` over that dimension's `dimension_labels`, filtered by the place kind
   (`placeKindAllowsCode`); 0 matches → refuse `region_unknown`; > 1 → a button question over the matches (same shape as a
   breakdown question). No place named → the dimension's single `NL…` member (stated as "Uitgangspunt: <dim>:
   Nederland"); none or several → button question. A table with BOTH a geo/geo-like dimension AND region-coded breakdown
   members refuses a question that names a place (`region_unavailable`) — rare, and the safe side.
7. **Region classes** ("per provincie", `regionScope !== null`): refused in step 5 (`table_lane_region_class`), wording
   asks to name a place. Tracked as a follow-up row.
8. **Periods (#339 (9)):** a table-lane period resolver over the time dimension's stored codes supports `year`,
   `quarter`, `month`, `year_range`, `since`, `last_n`, `latest`, and `none` (→ latest period at the coarsest grain the
   table has, stated as "Uitgangspunt: Perioden: <label>"). Other kinds refuse `table_lane_period_unsupported`. A grain
   the table lacks refuses (strict; no fallback). A period code not in the list refuses `not_published`-style
   (`table_lane_period_missing`, names the latest available period code — a code, never a value).
9. **Selection note:** the answer never relies on the model's prose to say which breakdown it shows. A deterministic
   note under the answer lists every fixed breakdown coordinate: named ones "Selectie: <dim>: <member>" and defaults
   "Uitgangspunt: <dim>: <member>" (CBS titles verbatim), carried in `tableLane.selectionNote` and rendered by the client.
   It is not part of the answer text (so member titles with digits never meet the verbatim-number check).
10. **Follow-ups in a thread (spec step 5, "follow-ups reuse the table"):** Task 7 — the client sends the previous
    table-lane row id; on a curated miss the request path reuses that row's table (skipping the finder), and the parse
    input gains one optional line with the previous question. This changes parser prompt bytes → version 3, BEFORE the
    recording run.

---

### Task 1: Migration 038 + the request store (reserve, claim, reclaim, finish-and-settle, poll read)

**Files:**
- Create: `migrations/038_table_lane_requests.sql`
- Create: `src/ingestion/table-lane-store.ts`
- Test: `tests/ingestion/table-lane-store.test.ts`
- Read first (patterns): `migrations/012_*.sql` (pending_table_requests), `src/ingestion/onboarding-store.ts`
  (`claimOnePending` with `FOR UPDATE SKIP LOCKED`, reclaim), `src/ingestion/onboarding-trigger.ts`, `src/billing/gate.ts`,
  `src/billing/ledger.ts` (`reserveDebit`, `QUESTION_DEBIT`, `compensate`, `compensateSplit`), how the hermetic test DB
  applies migrations (ADR 009 helper used by `tests/ingestion/slice-cache*.test.ts`).

**Interfaces:**
- Produces:
  ```ts
  export type TableLaneStatus = 'pending' | 'running' | 'done' | 'failed';
  export interface TableLaneChoice { dimension: string; code: string }
  export interface TableLaneRow {
    id: number; userId: string; requestId: string; threadId: number | null; lang: 'nl' | 'en';
    question: string; tableId: string; finderConfidence: number;
    parentId: number | null;            // set for a button reply / follow-up
    previousQuestion: string | null;    // Task 7: follow-up context
    choices: TableLaneChoice[];         // accumulated reader answers to breakdown/region questions
    status: TableLaneStatus; attempts: number; debitTransactionId: number;
    auditId: number | null; outcomeKind: 'answer' | 'clarification' | 'refusal' | null;
    createdAt: Date; startedAt: Date | null; finishedAt: Date | null; failureSummary: string | null;
  }
  export type CreateTableLaneResult =
    | { kind: 'created'; row: TableLaneRow }
    | { kind: 'duplicate'; row: TableLaneRow }        // same (user_id, request_id) — idempotent
    | { kind: 'insufficient'; balance: number; required: number };
  export async function createTableLaneRequest(db: Db, input: {
    userId: string; requestId: string; threadId: number | null; lang: 'nl' | 'en'; question: string;
    tableId: string; finderConfidence: number; parentId?: number | null; previousQuestion?: string | null;
    choices?: TableLaneChoice[];
  }): Promise<CreateTableLaneResult>;
  export async function claimTableLaneRequest(db: Db, now?: Date): Promise<TableLaneRow | null>;
  export async function finishTableLaneRequest(db: Db, rowId: number, outcome:
    | { kind: 'answer' | 'clarification' | 'refusal'; auditId: number | null }
    | { kind: 'failed'; summary: string; auditId: number | null }): Promise<void>;
  export async function releaseForRetry(db: Db, rowId: number, summary: string): Promise<void>;
  export async function readTableLaneRequest(db: Db, rowId: number, userId: string): Promise<TableLaneRow | null>;
  export const TABLE_LANE_STALE_MS = 5 * 60 * 1000;
  export const TABLE_LANE_MAX_ATTEMPTS = 2;
  ```

**Migration 038** (header comment: FILE-ONLY until the owner applies it with `npm run db:migrate`, together with 037):
```sql
create table table_lane_requests (
  id bigserial primary key,
  user_id text not null,
  request_id text not null,
  thread_id bigint references chat_threads(id) on delete set null,
  lang text not null check (lang in ('nl','en')),
  question text not null,
  table_id text not null,
  finder_confidence double precision not null,
  parent_id bigint references table_lane_requests(id) on delete set null,
  previous_question text,
  choices jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  attempts integer not null default 0,
  debit_transaction_id bigint not null,
  audit_id bigint references audit_answers(id) on delete set null,
  outcome_kind text check (outcome_kind in ('answer','clarification','refusal')),
  failure_summary text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (user_id, request_id)
);
create index table_lane_requests_open on table_lane_requests (status, created_at) where status in ('pending','running');
```
Check before finalizing: the exact type of `chat_threads.id`, `audit_answers.id`, and `credit_transactions.id` (match
them), whether `user_id` elsewhere is `text` or `uuid` (match `pending_table_requests.user_id`), and whether the ledger's
`request_id` CHECK / unique indexes accept a question debit whose request id is the row's `request_id` (it is the same
request id the routing turn's `chargeAndRun` already debited AND refunded — so derive the table-lane debit's ledger
request id with `deriveAddonRequestId(requestId, 'table-lane')` to avoid the idempotency collision; verify against
`reserveDebit`'s idempotency index). If the ledger's reason CHECK needs no change (reuse `QUESTION_COST`), 038 touches no
ledger constraint — preferred. Add 038 to whatever list/probe the test DB helper and `db:migrate` use (follow how 037 was
added). Retention: add `table_lane_requests` to the GDPR purge in the same way `pending_table_requests` is handled
(grep `pending_table_requests` in `src/` retention code) — rows older than the audit retention are deleted.

**Behaviour to test (hermetic, each a test):**
1. `createTableLaneRequest` debits the `simple` price via `reserveDebit` semantics (balance drops by 20; Pro bucket used
   when present — copy one existing Pro-bucket test setup from `tests/billing/`), inserts a `pending` row with
   `debit_transaction_id` set; returns `created`.
2. Same `(userId, requestId)` twice → second returns `duplicate` with the same row, one debit only.
3. Balance below price → `insufficient`, no row, no debit.
4. Row insert failure after the debit (simulate by a thread id that violates the FK) → the debit is compensated, the
   error is rethrown.
5. `claimTableLaneRequest` returns the oldest `pending` row, sets `running`, `started_at`, `attempts + 1`; two concurrent
   claims never return the same row (`FOR UPDATE SKIP LOCKED`).
6. A `running` row with `started_at` older than `TABLE_LANE_STALE_MS` is reclaimable when `attempts < TABLE_LANE_MAX_ATTEMPTS`.
7. `finishTableLaneRequest` answer → row `done`, `outcome_kind 'answer'`, no refund; clarification → `compensateSplit` to
   the clarification price (net 10); refusal → full `compensate` (net 0); failed → `status 'failed'`, full refund,
   `failure_summary` stored. Status + settlement in ONE transaction (assert: a thrown compensation leaves the row
   `running`).
8. `finishTableLaneRequest` on an already-terminal row throws and settles nothing (no double refund).
9. `readTableLaneRequest` returns null for another user's row.

- [ ] Write the tests (red), the migration, then the store (green). Run `npx vitest run tests/ingestion/table-lane-store.test.ts`, then `npx tsc --noEmit`.
- [ ] Commit: `feat(table-lane): migration 038 + request store with debit/settlement (breadth step 5)`

---

### Task 2: `planTableLane` — the one tagged-outcome wrapper (#339 (6))

**Files:**
- Create: `src/answer/table-lane/plan.ts`, `src/answer/table-lane/periods.ts`, `src/answer/table-lane/regions.ts`
- Modify: `src/query/breakdowns.ts` — export `toQuestion` (unchanged body) so callers get a full `BreakdownQuestion`
  (#339 (7))
- Test: `tests/answer/table-lane-plan.test.ts`, `tests/answer/table-lane-periods.test.ts`, `tests/answer/table-lane-regions.test.ts`
- Fixtures: reuse `tests/fixtures/tableparse/schemas/*.json` (metadata + code lists of 10 real tables) — read how
  `tests/answer/table-parse*.test.ts` loads them. The LLM is a stub `LlmClient` returning a hand-written JSON output
  (never a real call).

**Interfaces:**
- Consumes: `buildTableParseSchema`, `tableParse`, `DEFAULT_TABLE_PARSE_CONFIG`, the four typed errors (`src/answer/table-parse/`),
  `namedFromParse` (bridge), `resolveBreakdowns`, `classifyDimension`, `toQuestion`, `BreakdownQuestion`,
  `StatedDefault` (`src/query/breakdowns.ts`), `SliceRequest`, `SLICE_MAX_CELLS` (`src/ingestion/slice-cache.ts`),
  `StructuredIntent` (`src/query/types.ts`), `normalizeRegionName`, `baseLabel` (`src/answer/intent/resolve.ts`),
  `placeKindAllowsCode`, `readerPlaceKinds`, `REGION_MEMBER_CODE` (`src/answer/table-parse/places.ts`),
  `parsePeriodCode` (wherever `input.ts` imports it from).
- Produces:
  ```ts
  export type TableLaneRefusalReason =
    | 'table_lane_ineligible'        // TableParseIneligibleTableError, or registerSchemaOnly refused (Task 4)
    | 'table_lane_no_measure'        // parse 'geen'
    | 'table_lane_unsure'            // confidence below threshold, or TableParseValidationError / AmbiguousMeasure
    | 'table_lane_period_unsupported'
    | 'table_lane_period_grain'      // periodGrainUnavailable, or the resolver finds the grain absent
    | 'table_lane_period_missing'
    | 'table_lane_region_class'
    | 'region_unknown'
    | 'region_unavailable'           // TableParseRegionUnavailableError, the Caribisch/geo+coded-member rules
    | 'table_lane_too_large'         // slice > SLICE_MAX_CELLS
    | 'cbs_unreachable'              // Task 4 only
    | 'table_lane_failed';           // Task 4 only (give-up)
  export interface TableLaneSelection { named: StatedDefault[]; defaults: StatedDefault[] }
  export type TableLanePlan =
    | { kind: 'refuse'; reason: TableLaneRefusalReason; detail: string; latestPeriodCode?: string;
        parse: TableParseResult | null; parseAudit: TableParseAudit | null }
    | { kind: 'ask'; question: BreakdownQuestion; parse: TableParseResult; parseAudit: TableParseAudit;
        offered: TableParseSchema }
    | { kind: 'fetch'; slice: SliceRequest; intent: StructuredIntent; selection: TableLaneSelection;
        parse: TableParseResult; parseAudit: TableParseAudit; offered: TableParseSchema };
  export interface TableLaneTable {
    schema: CbsTableSchema;                        // live CBS metadata (groupPath included) — fetched by the job
    codeLists: Record<string, CbsCode[]>;          // same source; period codes carry status
  }
  export async function planTableLane(input: {
    question: string; previousQuestion: string | null; table: TableLaneTable;
    choices: TableLaneChoice[];                    // reader answers from earlier button rounds (Task 1 type)
    referenceDate: string;                         // YYYY-MM-DD
    client: LlmClient;
  }): Promise<TableLanePlan>;
  export function selectionNote(sel: TableLaneSelection, lang: 'nl' | 'en'): string | null;
  // periods.ts
  export type TablePeriodResolution =
    | { ok: true; codes: string[]; defaulted: { code: string; label: string } | null }
    | { ok: false; reason: 'table_lane_period_unsupported' | 'table_lane_period_grain' | 'table_lane_period_missing';
        detail: string; latestPeriodCode?: string };
  export function resolveTablePeriod(spec: PeriodSpec, timeCodes: CbsCode[], referenceDate: string): TablePeriodResolution;
  // regions.ts
  export type TableRegionResolution =
    | { ok: true; coordinates: Record<string, string[]>; defaults: StatedDefault[]; named: StatedDefault[] }
    | { ok: false; question: BreakdownQuestion }
    | { ok: false; reason: 'region_unknown' | 'region_unavailable' | 'table_lane_region_class'; detail: string };
  export function resolveTableRegions(input: {
    terms: RegionTerm[]; regionScope: RegionScopeKind | null; table: TableLaneTable;
    regionDims: BreakdownDimension[];              // the geo / geo_like dims, members from codeLists
    hasRegionCodedBreakdownMember: boolean;
    choices: TableLaneChoice[];
  }): TableRegionResolution;
  ```
  (Import `TableLaneChoice` from `src/ingestion/table-lane-store.ts` — or, if that import would make `src/answer` depend on
  `src/ingestion` in a direction the repo forbids, move the type to `src/answer/table-lane/types.ts` and have the store
  import it. Check existing import directions with `grep -rn "from '../../ingestion" src/answer | head`.)

**Order inside `planTableLane` (each step's failure is the plan's outcome; later steps never run):**
1. `buildTableParseSchema(schema, codeLists, question)` — `TableParseIneligibleTableError` → `refuse table_lane_ineligible`.
2. `tableParse(questionForParse, offered, {client})` where `questionForParse` is `question` (Task 7 adds the previous
   question through the parser's own input, not here). `TableParseRegionUnavailableError` → `refuse region_unavailable`;
   any other `TableParseValidationError` (incl. `TableParseAmbiguousMeasureError`) → `refuse table_lane_unsure`
   (parseAudit null, `detail` = error message). Any other error propagates (Task 4 treats it as a retryable failure).
3. `result.confidence < DEFAULT_TABLE_PARSE_CONFIG.acceptThreshold` → `refuse table_lane_unsure`.
4. `result.measureCode === null` → `refuse table_lane_no_measure` (BEFORE `namedFromParse`).
5. `result.periodGrainUnavailable` → `refuse table_lane_period_grain`.
6. `result.regionScope !== null` → `refuse table_lane_region_class`.
7. Apply `choices` for breakdown dimensions: a choice whose dimension is an offered breakdown overrides that dimension's
   parse choice as `{kind:'member', code}` (the choice was already validated against ALL members by Task 5's reply
   action; re-check here against `codeLists` and throw on a mismatch — a caller bug, not a reader ambiguity).
8. `namedFromParse(result', offered, fullDims)` — `{ok:false, askDimension}` → `ask` with `toQuestion(fullDim)` (the FULL
   member list; the client shows the first 12 and accepts typed replies for the rest).
9. `resolveBreakdowns(allDims, named)` — `{ok:false, question}` → `ask`. Check `callerDimensions` ⊆ {time dim, geo /
   geo-like dims}; anything else throws.
10. `resolveTableRegions(...)` (rules 5–7 of "Settled design choices") — question → `ask`; failure → `refuse`.
11. `resolveTablePeriod(result.period, codeLists[timeDim], referenceDate)` — failure → `refuse` with its reason;
    `defaulted` → added to `selection.defaults` as `{dimension: timeDim, dimensionTitle, code, memberTitle: label}`.
12. Build `slice: SliceRequest` = `{ measures: [measureCode], members: {<every non-time dim>: [code(s)]}, periods: codes }`;
    cell count = product of list lengths; `> SLICE_MAX_CELLS` → `refuse table_lane_too_large`.
13. Build `intent: StructuredIntent` = `{ schemaVersion: 1, target: { kind: 'explicit', tableId, measure: measureCode,
    dims: <breakdown + margins coordinates> }, ...(regionCodes.length ? { regions: regionCodes } : {}), period:
    <'codes' for a code list, 'range' for a contiguous range>, derivation: result.derivation }`. Check how `resolveIntent`
    maps `regions` onto a table's region dimension for explicit targets (it looks up the `GeoDimension` via
    `expected_dimensions`); for a **geo-like** dimension (kind `Dimension`) put the region code into `dims` instead of
    `regions`. Write a test for each.

`resolveTablePeriod` rules: codes come from the time dimension (`parsePeriodCode` gives grain + year + sub-period);
unreadable codes ignored. `year/quarter/month` → that code if present at the grain, else `table_lane_period_missing`
(detail + `latestPeriodCode` = latest code at that grain) — grain absent → `table_lane_period_grain`. `year_range` →
every JJ code in range (none → missing). `since` → from the start code to the latest at that grain. `last_n` → the n
latest at that grain. `latest` → the latest code at the finest grain the question implies (none → coarsest available).
`none` → latest at the coarsest grain (JJ if present), `defaulted` set. Every other kind → `table_lane_period_unsupported`.
Latest = max by (year, sub-period). Sanity: years 1800–2100 else `table_lane_period_unsupported`.

**Tests (at least):** every refusal branch of the order above (one test each, stub LLM output crafted per case); a
confident parse on a no-breakdown fixture → `fetch` with the exact slice + intent; an unnamed breakdown with a unique
total → `fetch` with a stated default; a breakdown without a total → `ask` with the FULL member list (`totalOptions`
equal to the dimension size); an `anders` choice → `ask`, never the total; a `choices` entry resolves a previously asked
dimension; a named place on a geo table → region code; two matches → `ask`; "Nederland" on a national-only table → no
region, selection line; "Nederland" on a table titled with "Caribisch" → `refuse region_unavailable`; geo-like
dimension → code in `dims`; slice over 2,000 cells → `table_lane_too_large`; `selectionNote` nl/en exact strings.

- [ ] Tests red → implement → green (one file at a time); `npx tsc --noEmit`; existing `tests/answer/table-parse*.test.ts`
  and `tests/query/breakdowns*.test.ts` still green.
- [ ] Commit: `feat(table-lane): planTableLane — one tagged outcome over parse, breakdowns, regions, periods (breadth step 5)`

---

### Task 3: `respondTableLane` — audited responses from a plan (answer / question / refusal)

**Files:**
- Create: `src/answer/table-lane/respond.ts`, `src/answer/table-lane/templates.ts`
- Modify: `src/answer/respond/types.ts` (add the optional `tableLane?: TableLaneEnvelope` on `AnswerResponse`,
  `ClarificationResponse`, `RefusalResponse`; add the new values to `RefusalReason`), `src/answer/audit/types.ts`
  (`LlmCallRecord.role` gains `'table_parse'`), `src/answer/audit/write.ts` / `reconstruct.ts` only as needed to accept
  and re-verify the new key, the English non-answer templates (wherever `NonAnswerEnglish` templates live).
- Test: `tests/answer/table-lane-respond.test.ts`, `tests/audit/envelope-key-manifest.test.ts` (update),
  `tests/audit/table-lane-reconstruct.test.ts`

**Interfaces:**
- Consumes: `TableLanePlan`, `selectionNote` (Task 2); `respondToIntent`, `toClarificationResponse`,
  `toRefusalResponse` (`src/answer/respond/respond.ts` — read their current signatures), `buildAuditRow`,
  `insertAuditRecord` / `persistOrFailClosed` (`src/answer/audit/`), `runQuery`.
- Produces:
  ```ts
  export interface TableLaneEnvelope {
    version: 1;
    rowId: number;
    tableId: string;
    finderConfidence: number;
    parse: TableParseResult | null;
    parseAudit: TableParseAudit | null;       // requestHash, model, usage, outputText (#339 (11))
    offeredMenuHash: string | null;           // sha256 of serializeTableParseInput's menu part — reproducible
    selectionNote: string | null;
    sliceFilterKey: string | null;
    question: BreakdownQuestion | null;       // present on a clarification
    fromCachedSlice: boolean;                 // settled choice 1 (CBS unreachable, cache < 24 h)
  }
  export async function respondTableLane(db: Db, input: {
    row: TableLaneRow; plan: TableLanePlan; fetch: { ok: true; filterKey: string; fromCache: boolean } | null;
    refusalOverride?: { reason: 'cbs_unreachable' | 'table_lane_failed'; detail: string };
    referenceDate: string; respondOptions: AuditedRespondOptions;   // compose client, semantic check, lang/translate
  }): Promise<AuditedResponse>;
  ```

**Behaviour:**
- `plan.kind === 'fetch'` with `fetch.ok`: build the eurostat-explorer-style minimal `ParseOutcome` (copy
  `buildParseOutcome` from `web/lib/eurostat-explorer.ts` into this module with the note text
  `'table-lane: intent built from a validated table-scoped parse (breadth step 5)'`, model = `parseAudit.model`, usage =
  `parseAudit.usage`), call `respondToIntent(db, row.question, parseOutcome, options)` exactly as the audited entry
  points do (read `respond-audited.ts` to reuse its `persistOrFailClosed`/audit path — the goal is: same answer checks,
  same audit write, same English attach; do NOT fork the composition). Attach `tableLane` to whatever response comes
  back (an answer, or the query layer's refusal such as `no_data`). The audit row records the parse in `llm_calls`
  (`role 'table_parse'`, model, tokens) and `table_ids` includes the table.
- `plan.kind === 'ask'`: a `ClarificationResponse` whose text is the Dutch template "Welke <dimensionTitle> bedoelt u?"
  (en "Which <dimensionTitle> do you mean?"), `options` = the first 12 member titles, `suggestions` same; `pending` is a
  rescue-only carrier (read `isRescuePending` in respond.ts — typed text on it is treated as a fresh question, so a
  stale client can never merge a table-lane question through the curated LLM merge); `tableLane.question` = the full
  `BreakdownQuestion`. When `totalOptions > 12` the text adds "(of typ een andere naam uit de lijst van <n>)" / "(or type
  another name from the list of <n>)".
- `plan.kind === 'refuse'` or `refusalOverride`: a `RefusalResponse` with the new reason and a Dutch template per reason
  in `templates.ts` (plain, no numbers; `table_lane_period_missing` may name `latestPeriodCode`'s readable label — a
  period, never a value) + English templates. Wording examples (final wording in the template file, reviewed):
  - `table_lane_no_measure`: "In CBS-tabel <title> staat geen cijfer dat precies bij deze vraag past."
  - `table_lane_unsure`: "Ik weet niet zeker welk cijfer uit CBS-tabel <title> u bedoelt. Kunt u de vraag specifieker stellen?"
  - `cbs_unreachable`: "CBS is op dit moment niet bereikbaar, dus ik kan dit cijfer nu niet ophalen. Probeer het later opnieuw."
  - `table_lane_failed`: "Het ophalen van deze CBS-tabel is niet gelukt. U betaalt hier niets voor."
- Every response kind is audited once (fail-closed rules unchanged); `AuditedResponse.auditId` returned.

**Tests:** answer path over a PGlite DB with a registered slice-cache table + stored slice (reuse the step-2 test
helpers that seed `slice_fetches` + observations) → an `answer` with `tableLane.selectionNote`, audit row present,
`llm_calls` contains `table_parse`; a plan `ask` → clarification with 12 options + `tableLane.question.totalOptions`;
each refusal reason → template text (nl + en); envelope manifest updated and green; reconstruct re-verifies a table-lane
answer row (tamper test: altering `tableLane.selectionNote` or a cell fails reconstruction if the existing reconstruct
covers envelope integrity — follow `onboarding-reconstruct.test.ts`); a flag-independent curated answer's envelope has
NO `tableLane` key (present-only).

- [ ] Tests red → implement → green; `npx vitest run tests/audit/envelope-key-manifest.test.ts`; `npx tsc --noEmit`.
- [ ] Commit: `feat(table-lane): audited answer/question/refusal from a plan (breadth step 5)`

---

### Task 4: The job — `runTableLaneJob` + route + kick + daily sweep

**Files:**
- Create: `src/ingestion/table-lane-job.ts`, `web/app/api/table-lane-job/route.ts`, `web/lib/table-lane-kick.ts`
- Modify: `web/app/api/onboarding-cron/route.ts` (after the onboarding job, also call `runTableLaneJob` once so stragglers
  finish daily), `web/vercel.json` only if a function config is needed for the new route (`maxDuration = 300` exported
  from the route file, like onboarding-cron)
- Test: `tests/ingestion/table-lane-job.test.ts`, `web/tests/table-lane-route.test.ts` (auth 503/401/200, same as the
  onboarding-cron route test)

**Interfaces:**
- Consumes: Task 1 store, Task 2 `planTableLane`, Task 3 `respondTableLane`, `registerSchemaOnly`, `ensureSlice`,
  `CbsSource` (`getTableSchema` / code-list methods — read `src/cbs-adapter/types.ts`), `attachOrCreateThread`
  (`src/threads/index.ts`).
- Produces:
  ```ts
  export interface TableLaneJobDeps {
    db: Db; source: CbsSource; parseClient: LlmClient;
    respondOptions: (lang: 'nl' | 'en') => AuditedRespondOptions;   // compose/semantic/translate clients from the route
    referenceDate: string; now?: () => Date; sleep?: (ms: number) => Promise<void>;
    budgetMs?: number;                                             // default 240_000 — stop claiming new rows after this
  }
  export interface TableLaneJobSummary { processed: number; answered: number; asked: number; refused: number; failed: number }
  export async function runTableLaneJob(deps: TableLaneJobDeps): Promise<TableLaneJobSummary>;
  export async function kickTableLaneJob(deps?: KickDeps): Promise<void>;   // web/lib/table-lane-kick.ts, copy of kickOnboardingJob
  ```

**Per claimed row (loop until no row or budget spent):**
1. `registerSchemaOnly(db, source, row.tableId)`; `ok:false` → plan-less refusal `table_lane_ineligible` (reason `registered_as_full`
   can't occur — the finder never routes a held table; if it does, refuse the same way).
2. Load the table's live CBS schema + code lists from `source` (the same calls `registerSchemaOnly` makes; if it exposes
   them, reuse — do not fetch twice when avoidable).
3. `planTableLane({question: row.question, previousQuestion: row.previousQuestion, table, choices: row.choices,
   referenceDate, client: parseClient})`.
4. `fetch` → `ensureSlice(db, source, tableId, plan.slice)` (no lock held). `ok:false` at stage `fetch`: sleep 2 s,
   retry once; still failing → if `slice_fetches` has the filter key with `checked_at > now - 24h` → proceed with
   `fromCache: true`; else refusal `cbs_unreachable`. `ok:false` at any other stage (validation / quarantine / request)
   → refusal `table_lane_ineligible` with the summary as detail.
5. `respondTableLane(...)`; then `attachOrCreateThread(db, row.userId, row.threadId, auditId)` when `row.threadId` is
   set or when the row's parent chain started a thread (read how actions.ts decides to create a thread and mirror it:
   the table-lane answer must land in the same thread as the question).
6. `finishTableLaneRequest(db, row.id, {kind, auditId})` — settlement per Global Constraints.
7. Any thrown error in 1–5: `attempts < TABLE_LANE_MAX_ATTEMPTS` → `releaseForRetry`; else audited refusal
   `table_lane_failed` + `finishTableLaneRequest(..., {kind:'failed', ...})`. Log one line per failure
   (`console.error('table-lane-job: …')`) — never the question text (GDPR: log row id + table id only).

**Route:** `GET` with `CRON_SECRET` (503 unset, 401 wrong) exactly like `onboarding-cron`; constructs
`ODataV4Source`, `AnthropicLlmClient` for the parse (the parser's own model constant is inside `tableParse`), and
`respondOptions(lang)` built the same way the onboarding-cron route builds its delivery options plus
`englishAnswerOptions(lang)`. Returns the summary as JSON. `export const maxDuration = 300`.

**Tests (hermetic, fake `CbsSource` from the step-2 slice-cache tests + stub LLM):** happy path new table → registered,
slice stored, answer audited, row `done`, net cost 20; second question same slice → `ensureSlice` cached, still answers;
ask path → clarification, net 10; each refusal → net 0 and audited; CBS fetch failure twice with a fresh cached slice →
answer with `fromCachedSlice: true`; with no cache → `cbs_unreachable`, net 0; parse client throws twice →
`table_lane_failed`, row `failed`, refunded, audited; budget reached → stops claiming; stale running row reclaimed;
a test that asserts `ensureSlice` is never called inside an open transaction holding `pg_advisory_xact_lock_shared`
(spy on the db: no shared-lock statement between `ensureSlice` start and end).

- [ ] Tests red → implement → green (one file at a time); `npx tsc --noEmit`; `cd web && npx tsc --noEmit`.
- [ ] Commit: `feat(table-lane): job runner, route, kick and daily sweep (breadth step 5)`

---

### Task 5: Request path — route to the table lane, poll, button/typed replies

**Files:**
- Create: `web/lib/table-lane.ts` (`tableLaneEnabled()`, `TableLaneOutcome` types, the pure matcher
  `matchBreakdownReply`)
- Modify: `web/app/actions.ts` (`askQuestion` routing, new actions `pollTableLane`, `replyToTableLane`)
- Test: `web/tests/table-lane-actions.test.ts` (follow how existing `web/tests/*actions*.test.ts` mock the session /
  db — read one first), `web/tests/table-lane-match.test.ts`

**Interfaces:**
- Consumes: Task 1 store (`createTableLaneRequest`, `readTableLaneRequest`), `kickTableLaneJob` (Task 4), `after` from
  `next/server`, the existing `askQuestion` internals.
- Produces (client contract):
  ```ts
  // AskOutcome gains: tableLane: { rowId: number } | null   (null on every non-table-lane outcome)
  export type PollTableLaneOutcome =
    | { status: 'pending' | 'running' }
    | { status: 'done'; gated: GatedResponse; threadId: number | null }   // gated.kind 'ok', netCost from settlement
    | { status: 'gone' };                                                  // not this user's row / unknown id
  export async function pollTableLane(rowId: number): Promise<PollTableLaneOutcome>;
  export type ReplyTableLaneChoice = { code: string } | { text: string };
  export type ReplyTableLaneOutcome =
    | { kind: 'started'; rowId: number }
    | { kind: 'no_match' }                                                 // free, nothing created
    | { kind: 'insufficient_credits'; balance: number; required: number }
    | { kind: 'gone' };
  export async function replyToTableLane(rowId: number, choice: ReplyTableLaneChoice, requestId: string): Promise<ReplyTableLaneOutcome>;
  export function matchBreakdownReply(reply: string, members: { code: string; title: string }[]): { code: string } | null;
  ```

**Behaviour:**
- `askQuestion`: after the existing `chargeAndRun` returns, if `tableLaneEnabled()` and the gated response is a
  refusal with reason `onboarding_pending` or `onboarding_already_pending` and `onboarding.tableId` is set → do NOT run
  `maybeTriggerOnboarding`; call `createTableLaneRequest` (requestId, threadId validated as today, lang from `getLang()`,
  `finderConfidence = onboarding.confidence`), `after(() => kickTableLaneJob())`, and return the routing turn's
  `AskOutcome` with `tableLane: { rowId }`, the routing refusal's text replaced by nothing the client shows (the client
  renders a progress bubble for `tableLane` instead — Task 6), and **the routing audit row NOT attached to the thread**
  (skip `attachOrCreateThread` for it; the job attaches the answer). `insufficient` → return the existing
  `insufficient_credits` shape. Flag off → today's code path, byte-identical.
- `pollTableLane(rowId)`: session user required; `readTableLaneRequest(db, rowId, userId)`; `done` → read
  `audit_answers.response` for `auditId` and return `{kind:'ok', netCost, response, auditId}` (netCost = the row's
  debit minus its compensations — read how `chargeAndRun` computes `netCost` and reuse a ledger helper if one exists;
  otherwise sum the ledger rows for the debit). `failed` → the same (the failure refusal is audited). Unknown → `gone`.
- `replyToTableLane(rowId, choice, requestId)`: the row must be this user's, `done`, `outcome_kind 'clarification'`, and
  its audit envelope's `tableLane.question` present. `{code}` must be one of the dimension's members in
  `dimension_labels` (ALL members, not just the 12 shown); `{text}` → `matchBreakdownReply` over ALL members from
  `dimension_labels` (normalize: trim, lowercase, collapse whitespace, strip diacritics; exact title match or exact code;
  a title matching several members → no match). No match → `{kind:'no_match'}` (free). Match → `createTableLaneRequest`
  with `parentId: rowId`, `question: parent.question`, `previousQuestion: parent.previousQuestion`, `choices:
  [...parent.choices, {dimension, code}]`, same thread, new request id → kick → `{kind:'started', rowId}`.

**Tests:** flag off → `askQuestion` outcome identical to today for an onboarding-routed question (snapshot the outcome
before/after the change); flag on → row created, 20 debited, `tableLane.rowId` set, onboarding offer NOT minted, routing
audit row not attached to the thread; poll pending/done/gone/other-user; reply by code (member beyond the first 12
accepted), by exact typed title, by ambiguous title (no match), by unknown text (no match, no debit); reply on a row that
is not an open clarification → `gone`; `matchBreakdownReply` unit tests incl. diacritics and case.

- [ ] Tests red → implement → green; `cd web && npx tsc --noEmit`; run `web/tests/*actions*.test.ts` files one at a time.
- [ ] Commit: `feat(table-lane): route curated misses to the table lane; poll and reply actions (breadth step 5)`

---

### Task 6: Chat UI — progress bubble, polling, breakdown buttons, typed replies, selection note

**Files:**
- Modify: `web/components/chat.tsx` (keep additions in a new component file where possible), `web/lib/chat-message.ts`
  (`ChatMessage.tableLane?: { rowId: number; phase: 'fetching' | 'slow' } | null` and
  `ChatMessage.tableLaneQuestion?: { rowId: number; question: BreakdownQuestion } | null`), `web/lib/replay-assemble.ts`
  (resume: a stored table-lane answer shows its selection note; a stored table-lane question shows as plain text without
  buttons — like carriers, never restored), `web/lib/i18n/messages.ts`
- Create: `web/components/table-lane-progress.tsx` (poller), `web/components/table-lane-question.tsx` (buttons + hint)
- Test: `web/tests/table-lane-progress.test.tsx`, `web/tests/table-lane-question.test.tsx`, `web/tests/chat-message*.test.ts`
  (extend)

**Behaviour:**
- On an `AskOutcome` with `tableLane`, append a progress bubble ("CBS-tabel ophalen…") with the existing
  `AnswerSkeleton` look. `TableLaneProgress` polls `pollTableLane(rowId)` every 2 s for 60 s, then every 15 s up to 10
  minutes; after 60 s it shows the over-budget text (Global Constraints); `done` → replace the bubble with the normal
  message built from `gated` exactly as a direct `askQuestion` answer is built (reuse the existing outcome→message
  function); `gone` or 10 minutes → a plain info line (nl "Het antwoord is nog niet klaar. Het verschijnt in dit gesprek
  zodra het er is.", en equivalent). Stop polling on unmount.
- A `done` clarification whose `response.tableLane.question` is set renders `TableLaneQuestion`: up to 12 buttons (member
  titles, CBS order) using the existing chip `PILL` class; a click calls `replyToTableLane(rowId, {code})`; when
  `totalOptions > 12` a hint line (nl "Staat uw keuze er niet bij? Typ de naam.", en "Not listed? Type the name."). While
  that question is the latest message, the text box sends through `replyToTableLane(rowId, {text})` instead of
  `askQuestion`; `no_match` → an info line (nl "Die naam staat niet in de lijst van deze tabel. Kies een knop of typ de
  naam precies zoals CBS hem noemt.", en equivalent) and the question stays open; `started` → a new progress bubble.
- Answers with `response.tableLane.selectionNote` show the note in a small muted line under the answer text (same styling
  as existing caption/footnote text — find one in `chat.tsx`).
- All strings via `messages.ts` (nl + en). No new colours.

**Tests:** progress component polls on the schedule (fake timers), swaps in the answer, shows the slow text after 60 s,
stops on unmount; question component renders 12 buttons max, click calls the action with the code, hint shown only when
`totalOptions > 12`; chat-message helpers map a `tableLane` answer's note; replay renders a stored table-lane answer with
its note and a stored table-lane question without buttons.

- [ ] Tests red → implement → green (one file at a time); `cd web && npx tsc --noEmit`; `cd web && npx next build`
  (foreground, solo).
- [ ] Commit: `feat(table-lane): chat progress, breakdown buttons and typed replies (breadth step 5)`

---

### Task 7: Follow-ups reuse the table (parser input v3, before the recording run)

**Files:**
- Modify: `src/answer/table-parse/parse.ts` (`serializeTableParseInput(question, input, previousQuestion?: string | null)`
  adds, only when present, a line `Vorige vraag in dit gesprek: "<previousQuestion>"` before the question; the system
  prompt gains one rule: "Is er een vorige vraag, lees de nieuwe vraag dan als vervolg daarop: wat de nieuwe vraag niet
  noemt (onderwerp, periode, plaats, uitsplitsing), neem je over uit de vorige vraag." — bump
  `TABLE_PARSE_PROMPT_VERSION` to 3; schema version unchanged), `tableParse` options gain `previousQuestion`,
  `src/answer/table-lane/plan.ts` (pass it through), `web/app/actions.ts` (`askQuestion` accepts an optional
  `rawTableLaneFollowUp?: unknown` = the previous row id; on a curated miss with the flag on and a valid, owned, `done`
  row whose `outcome_kind === 'answer'`: create a row for the SAME table with `previousQuestion = parent.question`,
  skipping the finder), `web/components/chat.tsx` (send the latest table-lane answer's row id with the next question),
  `benchmark/tableparse-labelled-set.json` (+4 follow-up cases: "en voor vrouwen?", "en in 2020?", "en in Utrecht?", a
  follow-up that changes topic → expected `geen`), `scripts/tableparse-eval.ts` (pass `previousQuestion` from the case).
- Test: `tests/answer/table-parse*.test.ts` (prompt bytes / serialization pinned: without a previous question the
  serialized input is byte-identical to version 2's; the system prompt changed only by the one rule), plan + actions
  tests for the follow-up routing (a curated HIT still wins — the follow-up link is only used on a curated miss; another
  user's row id → ignored; a row whose outcome was a refusal → ignored).

- [ ] Tests red → implement → green; `npm run tableparse:eval -- --dry-run` (zero spend) and record the new estimated
  token total in the commit message.
- [ ] Commit: `feat(table-lane): follow-ups reuse the table; parser prompt v3 (breadth step 5)`

---

### Task 8: Docs to measured state

**Files:** `docs/decisions/062-breadth-table-lane-slice-cache.md` ("As built — step 5"), `docs/04-architecture.md`
(capability row), `docs/open-questions.md` (#336: items 1, 2, 3, 5, 6, 9, 10 → resolved/how; #339: 5–9, 11 → done, 10
stays for the recording run; #338 unchanged; NEW rows: region classes in the table lane, the 24 h cached-slice
assumption, geo + region-coded member tables refused, the unsupported period kinds refused, and spec D6's "old
100-credit flow stays as a fallback for tables the table lane cannot serve" — NOT wired in step 5: with the flag on, a
table the lane cannot serve is refused free; measure in step 6 whether the fallback is worth wiring), `docs/RUNBOOK.md` (migration 038
with 037; `TABLE_LANE_ENABLED`; the job route + manual kick with `curl -H "Authorization: Bearer $CRON_SECRET"`; how to
read a stuck row; the recording run now includes the follow-up cases and prompt v3), `docs/08-build-plan.md`, spec
status line, `docs/05-data-rules.md` only if an invariant's wording needs the table lane named (check R4/R8/R9).

- [ ] Grep for old framing: `grep -rn "not wired\|never called the AI\|step 5" docs/ | grep -v status-archive` — fix
  every stale hit.
- [ ] Commit: `docs: breadth step 5 — table lane wired dark (ADR 062 as built, #336/#339, RUNBOOK)`

---

## After the tasks (session, not implementers)

- Final whole-branch review (most capable tier), fix wave, then the full verification block
  (`scripts/verify-block.sh`, detached + solo) + `/code-review` LOW, merge to `main`, CI green, prod 200.
- Owner steps after 2026-10-01 (unchanged order): apply 037 + 038 → recording run (now 39 cases, prompt v3) →
  calibration (#338) → step 6 benchmark → flip `TABLE_LANE_ENABLED`.
