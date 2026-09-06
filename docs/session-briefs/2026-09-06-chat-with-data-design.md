# Session brief — "chat with your data" design (#201 / #202)

**Date:** 2026-09-06 (session 84). **Status:** DRAFT — all 9 §8 owner decisions resolved (2026-09-06, same session); nothing built yet. Next: ADR promotion + pre-build adversarial review (see the update note before §0).
**Provenance:** produced by a Fable 5 planning agent (`effort: max`, 115 tool calls, ~458k tokens,
15 min), spawned per the owner's request ("spawn a Fable 5 ULTRACODE agent to create the overall
plan"). Reviewed by the session model before being written here: ADR numbering (037 is next free,
after 036-anonymous-trial-pot), migration numbering (026/027 are next free, after 025), git tip
(`01a4502`), and the five "critical files" it cites were all independently verified against the
repo, not taken on the agent's word (project's evidence-verification rule). The rest of the plan's
factual claims (file contents, line ranges, architectural precedents) come from the agent's own
tool use and have **not** been independently re-verified line-by-line — that is exactly what the
plan's own WP202-0 "pre-build adversarial review" phase is for, before any code is written.

**Origin of the ask:** open-questions [#201](../open-questions.md) (Google Sheets as a data source)
and [#202](../open-questions.md) (drop a link/file into the chat box), both recorded 2026-09-05,
sharpened through a same-session brainstorming conversation into: *click a data source → chat with
the data → generate a chart → refine the chart by chatting*, with two hard constraints from the
owner: **(H1)** the LLM only emits a structured, checkable instruction — deterministic code renders
the chart from the stored data, never the LLM; **(H2)** a chart built from user data must be
visibly and structurally impossible to confuse with an official CBS chart.

**Update (2026-09-06, same session):** the owner read back all 9 §8 points in chat, one at a
time. All resolved — see §8 below for the decisions as recorded. One new item surfaced during the
read-back (a possible future monthly subscription tier) and was parked as its own future item, not
folded into this design — see the note at the top of §8. **Next step:** promote to
`docs/decisions/037-...md` + a frozen executor brief + the pre-build adversarial review (per the
plan's own §5 WP202-0), still pending. **No execution/build agents have been dispatched.**

---

<!-- BEGIN PLAN -->

# ADR-DRAFT 037 — "Eigen data": file/link attachments, a dataset-scoped chat, and unverified user-data charts (#201 / #202)

**Status:** DRAFT — planning output only (session 84, 2026-09-06; repo tip `01a4502`, the disabled placeholder buttons). Not accepted, nothing built. Promotion path per house rule: owner read-back on the numbered open points (§8) → frozen executor brief → pre-build adversarial review (the WP27/WP30b/WP129+130 pattern) → build on a branch + PR (#118(b): money path + new personal-data store).

**Scope of this draft:** makes the first two placeholder buttons in `web/components/chat.tsx` (lines 951–982) real — **"Bestand uploaden"** and **"Link toevoegen"**. **"Databron verbinden" (Google Sheets / OAuth connectors) stays a disabled placeholder** — out of scope, blocked on OAuth *data-scope grants + refresh-token storage*, which do not exist. (One doc-freshness note for the #201 row: accounts *do* exist since WP13/WP28 — magic link + Google *login*, ADR 028; what is missing is Google *Sheets-scope* authorization and token storage, not user accounts. **Assumption** — confirm the row's "no accounts" wording was shorthand for that.)

---

## 0. The plan in plain language (for the owner)

1. A user uploads a CSV/spreadsheet (later: links a web page, later: a PDF). We store the file **and** a cleaned-up table extracted from it, on the user's account, deletable by the user.
2. That upload opens its own conversation ("Eigen data: verkoop-2024.csv") in the existing sidebar. In it the user asks for charts: "maak een lijngrafiek van omzet per jaar", "alleen 2020–2023", "vergelijk kolom A en B".
3. **The AI only translates the request into a small, checkable instruction** ("x = kolom Jaar, y = kolom Omzet, filter Jaar 2020..2023, type = lijn"). It may only name columns and values that actually exist in the file — anything else is rejected by code before it can do anything. **Then plain code draws the chart from the stored rows.** The AI never writes, repeats or computes a number that lands on a chart. This is principle (a) applied to the user's own data.
4. Every user-data chart is visibly and structurally different from a CBS chart: a permanent **"Eigen data · niet door checkdecijfers geverifieerd"** badge, a dashed frame, no CBS source badge/StatLine link, no "CC BY 4.0" line, and the same disclaimer baked into any downloaded PNG/SVG. It can never be mistaken for, or mixed into, an official CBS chart.
5. Nothing in the existing CBS pipeline changes: zero prompt bytes, the benchmark stays 14/14 + 6/6 + 0 fabricated by construction, and the CBS chat's message envelope stays byte-identical (ADR 033 D4 pins untouched).
6. Costs ride the existing credit ledger with its own reason and its own price rows (like the +10 web add-on). **Decided (§8 Q1):** CSV upload is free; each dataset-chat turn costs credits, sized near the web add-on. Exact numbers still open. No subscription-tier gate — that idea was raised and parked separately (see §8).
7. Uploaded files and everything derived from them are personal data: they join the existing delete-my-history button, get a **per-file delete** button, and are purged on the existing monthly retention job — from day one, in the same transaction as the rest.
8. Recommended first slice: CSV/TSV upload → dataset chat → line/bar charts with filters, on a flag (`ATTACHMENTS_ENABLED`), supervised go-live. Web links + XLSX next, PDF after that (PDF needs AI-assisted reading, so it gets extra verification and a stronger badge).

---

## 1. Context (verified against the code, not assumed)

- **The precedent pattern is ADR 032 / `src/websearch/`.** A `WebSection` rides the audit envelope as an additive field, stored verbatim, replayed on reconstruction, never re-derived, and its text never enters `response.text`, any validator input, `attribution`, chart data, conversation context or benchmark scoring (`src/websearch/types.ts` header; `src/websearch/attach.ts`; `tests/websearch/attach.test.ts` pins; `reconstruct.ts` checks (a)–(d)). Money is a separate idempotent ledger debit (`websearch_cost`, migration 018) reserved inside the pipeline and settled on the final gated object (`web/app/actions.ts` `settleWebAddon`). The module was created as its own ADR-001 boundary precisely because it is a structurally separated capability.
- **Charts are declarative specs + dumb renderers** (ADR 007/014): `buildChartSpec` in `src/chart/build.ts` is the only producer of chart data; `ChartSpec` (`src/chart/types.ts`) is CBS-shaped (`resultId`, `attribution.tableId`, `license: 'CC BY 4.0'`), validated by a `strictObject` zod schema (`src/chart/schema.ts`); `web/components/chart.tsx` binds every displayed string via `data-label-for` and refuses unknown schema versions; `ChartDownloadMenu` bakes `attributionText` into exports.
- **Threads** (ADR 033): `chat_threads` has no text columns; rows are `audit_answers` (nullable `thread_id`); titles are derived at read time; replay is deterministic (`src/threads/replay.ts` + `web/lib/replay-assemble.ts`); the dock derives tabs from messages (`web/lib/dock-visuals.ts`); the whole CBS message envelope is byte-identity-pinned.
- **GDPR** (#14/#120/#181): one enforcement module `src/answer/audit/retention.ts` (`redactMatchingRows` runs feedback-delete → audit redaction → pending-request redaction in ONE transaction; `deleteUserQuestionHistory` binds `user_id`; `purgeExpiredQuestionHistory` runs two windows), scheduled by `runRetentionPurge` (`retention-job.ts`) via the monthly cron, now enforcing (`GDPR_PURGE_APPLY=1`). ADR 033: "every new store of question-derived text must be inside the redaction scope from day one."
- **LLM harness**: one seam `src/answer/llm/client.ts` (`LlmClient`, `AnthropicLlmClient`, `ReplayLlmClient`, `RecordingLlmClient`; `LlmRequest.jsonSchema` via `z.toJSONSchema`), per-role named model constants (`INTENT_MODEL`, `TABLE_RERANK_MODEL`, `SEMANTIC_CHECK_MODEL`, `MEASURE_FIT_MODEL` = `claude-haiku-4-5`; `PHRASING_MODEL`, `WEBSEARCH_MODEL` = `claude-sonnet-5`). **The closest precedent for "LLM picks from a supplied closed list, code enforces the allowlist" is `src/catalog/rerank-schema.ts` `validateRerankOutput`** (throws on any id not in the shortlist; sanitizes alternatives).
- **Hosting facts that shape uploads**: Vercel **Hobby** (RUNBOOK line 108; daily-only crons; the Server Action route has `maxDuration = 90`, `web/app/page.tsx`); Supabase **free tier** (15 session-mode pooler clients — `MAX_POOL_CLIENTS_PER_PROCESS = 2` in `src/db/client.ts`; Data API disabled entirely per RUNBOOK). **No file-storage code exists anywhere** (no Supabase Storage, no upload libs; `web/package.json` has only next/react/recharts/supabase/pg/stripe/zod/anthropic). Hermetic CI runs on PGlite (ADR 009) — anything not in Postgres needs a fake behind an interface.
- **UI**: no component library (ADR 008 as-built note, #204); hand-rolled Tailwind on the `docs/12-huisstijl.md` tokens (`web/app/globals.css`).

The owner's two hard constraints (session 83) restated as invariants: **(H1)** the LLM emits a *structured instruction*; deterministic code renders from the *stored rows*; no LLM-emitted value may reach a chart. **(H2)** user-data charts are visually and structurally distinguishable from CBS charts and never carry CBS chrome.

---

## 2. Decisions (proposed)

### D1 — A second, structurally separate trust tier: "Eigen data" (the ADR 032 shape, end to end)

User-supplied data (file, link, later PDF) lives in its own tier with its own honesty model: **provenance + disclaimer + deterministic rendering from stored rows**, never the CBS public claim. Concretely, the separation is *structural*, not stylistic:

- It **never enters the CBS pipeline**: no user-data text or values in the intent/compose/clarify prompts, validators, `Attribution`, `ChartSpec`, `ConversationContext`, `audit_answers`, or the benchmark. The dataset chat is a **different action, different envelope, different table, different renderer**.
- **Never mixed**: a chart is either all-CBS (`ChartSpec`) or all-user (`UserChartSpec`). "Compare my column with CBS inflation" is refused in v1 with an honest explanation and a suggestion to ask the CBS chat. (Same rule as "web findings never enter charts", ADR 032.) Revisit only as its own ADR.
- **Not an ADR 030 source.** A user dataset has no registry, no canonical measures, no period grammar, no verification gate; registering it in `SOURCES` would let it flow into the validated waist. It is an *augmentation tier*, like websearch — which is exactly why #201's analysis said "not a WP30c variant".

*Rejected:* (a) treating an upload as a temporary ADR 030 source (would launder unverified data into the "every number traceable to an official cell" claim); (b) a new `ComposedResponse` kind (touches the pinned envelope, the manifest test, `reconstruct.ts`, the benchmark scorer — all CBS-shaped; every reader would need a new branch for no benefit); (c) LLM-free only (buttons for column pickers — safe but abandons the "chat with the data" ask; kept as the *fallback chips*, see D8).

### D2 — Module placement: a new top-level `src/attachments/` (ADR 001 boundary), pure-leaf discipline

```
src/attachments/
  types.ts          # PURE LEAF (no SDK/db imports): UserDataset, DatasetProfile, ColumnProfile,
                    # ChartInstruction, UserChartSpec, DatasetTurnEnvelope, USER_CHART_SPEC_VERSION,
                    # USER_DATA_DISCLAIMER constants. Imported by web code via web/backend/attachments/types.ts.
  limits.ts         # all caps as named constants (file bytes, rows, cols, cell chars, points, quota)
  ingest/
    csv.ts          # deterministic RFC4180 parser; delimiter/decimal sniffing (see D5)
    xlsx.ts         # WP202b — library decision at build (D5)
    html.ts         # WP202b — fetch with SSRF guards + <table> extraction
    pdf.ts          # WP202c — text extraction + LLM-assisted structuring + verbatim-token verification
    profile.ts      # rows → DatasetProfile (types, ranges, distincts, numeric-format detection)
    numbers.ts      # deterministic cell → number parsing under a per-column NumberFormat
  store.ts          # SQL for user_datasets / dataset_turns (bound user_id everywhere; the src/threads discipline)
  file-store.ts     # FileStore interface + PostgresFileStore (bytea) — D4
  instruct/
    prompt.ts       # DATASET_INSTRUCT_PROMPT + _VERSION (Dutch); the ONLY new prompt bytes in WP202a
    schema.ts       # zod ChartInstruction schema → JSON schema; validateInstruction() allowlist (rerank-schema pattern)
    parse.ts        # buildInstructRequest(profile, previousInstruction, question) + DATASET_INSTRUCT_MODEL
  execute.ts        # (dataset, instruction) → selected rows/points — pure, deterministic, NO arithmetic in v1
  chart.ts          # buildUserChartSpec(dataset, instruction) — the ONLY producer of user-chart data
  respond.ts        # the turn orchestration: pre-checks → parse → validate → threshold → execute → envelope; templates
  audit.ts          # writeTurn (before show, fail-closed), reconstructDatasetTurn (R8 analog), redaction sentinel
  retention.ts      # deleteUserDatasets(userId) / purgeExpiredDatasets(cutoff) legs + count (⟨F2⟩ shared WHERE)
  index.ts          # server barrel (constructs nothing SDK-side; actions.ts imports AnthropicLlmClient itself)
```

`src/billing/` gains sibling functions only (D12). `src/chart/` is untouched except one **type-only** generalization in `web/components/chart.tsx` (D11). `web/` gains `components/dataset-chat.tsx`, `components/user-chart.tsx`, `lib/dataset-message.ts` (pure leaf), `lib/dataset-visuals.ts`, `app/dataset-actions.ts`.

*Rejected:* folding into `src/chart/` (would blur the one-producer rule for CBS specs) or `src/threads/` (threads store *when*, never *what*).

### D3 — Data model (migrations 026 + 027, FILE-ONLY until the supervised apply)

**`user_datasets`** (migration 026) — one row per upload/link:

| column | type | notes |
|---|---|---|
| `id` | bigint identity PK | |
| `user_id` | uuid NOT NULL, guarded FK → `auth.users` (the migration 019 DO-block) | account-only; the trial never reaches this |
| `source_kind` | text CHECK in ('file_csv','file_xlsx','url_html','file_pdf') | |
| `display_name` | text | file name or URL host+path (user text → redactable) |
| `source_url` | text NULL | for `url_html` |
| `mime_sniffed` | text | content-sniffed, never the client's claim |
| `byte_size` | int | quota accounting |
| `content_sha256` | text | provenance + dedupe hint |
| `file_bytes` | bytea NULL | D4 (nulled on redaction/purge) |
| `cells` | jsonb | `string[][]` verbatim raw cell text (header row included); the system of record for charting |
| `profile` | jsonb | `DatasetProfile` (D6) incl. per-column `numberFormat` decisions |
| `extraction` | jsonb NULL | WP202c: the LLM extraction record (model, prompt version, per-cell `verified` flags) — recorded, never re-derived |
| `status` | text CHECK in ('ready','needs_decision','failed','redacted') | `needs_decision` = ambiguous numeric format / sheet choice pending |
| `created_at`, `redacted_at` | timestamptz | |

Indexes: `(user_id, created_at desc)`; partial index on `status <> 'redacted'` for quota sums.

**`dataset_turns`** (migration 026) — one row per dataset-chat response (the R8 analog):

| column | notes |
|---|---|
| `id`, `user_id` uuid, `dataset_id` FK → user_datasets, `thread_id` FK → chat_threads (no ON DELETE — redact-not-delete posture), `request_id` uuid | |
| `kind` text CHECK in ('chart','clarification','refusal') | |
| `question` text | verbatim |
| `envelope` jsonb NOT NULL | the full `DatasetTurnEnvelope`, verbatim (authoritative snapshot) |
| `final_text` text | promoted = `envelope.text`; reconstruction asserts equality |
| `instruction` jsonb NULL | promoted `ChartInstruction` (recorded LLM output, never re-derived) |
| `chart_emitted` boolean | |
| `prompt_versions` jsonb, `llm_calls` jsonb, `input_tokens`, `output_tokens`, `latency_ms` | same telemetry shape as `audit_answers` |
| `created_at` | |

**`chat_threads.dataset_id`** bigint NULL FK → `user_datasets(id)` (additive; NULL = a CBS thread — every existing row untouched). A dataset thread is created **eagerly with the dataset** (unlike ADR 033's lazy CBS threads): the upload itself is the first meaningful event, and the profile card (D8) is the first message. Sidebar title = `user_datasets.display_name` (redacted ⇒ filtered out, the D1/D2 posture preserved: `chat_threads` still stores no text).

**Migration 027 (ledger widening, byte-for-byte the migration 018 shape):** reason CHECK + delta-sign + request-id-scope CHECKs gain `'dataset_cost'`; `credit_transactions_one_dataset_per_request` partial unique index; the compensation trigger function re-created with the widened allowlist (`question_cost`, `onboarding_cost`, `websearch_cost`, `dataset_cost`); `action_class_prices` CHECK gains `'dataset_ingest'` and `'dataset_turn'`. No `source_tag` change: dataset turns are **not** `audit_answers` rows.

*Rejected:* storing turns in `audit_answers` with a new kind/source_tag (see D1(b)); a separate `dataset_threads` table (duplicates sidebar/resume/busy-guard machinery for no gain; the additive column reuses `validateThreadOwnership`, `ThreadSidebar`, `Workspace.selectThread`).

### D4 — File bytes: Postgres `bytea` behind a `FileStore` interface in v1; Supabase Storage is the recorded upgrade

Evaluation (the brief asked for a justification, not an assumption):

| option | GDPR delete in the same transaction | hermetic CI (PGlite) | new secrets / policies | size headroom | vendor lock-in |
|---|---|---|---|---|---|
| **Postgres `bytea` (chosen v1)** | yes — one `UPDATE … set file_bytes = null` inside `redactMatchingRows`' transaction | yes (PGlite supports bytea) | none | free-tier DB is 500 MB (**verify at build**) — bounded by per-user quota | none (ADR 002) |
| Supabase Storage (private bucket) | **no** — object deletes are a second system; needs an outbox/sweep (`storage.objects` SQL deletes orphan the S3 object) | no — needs a fake behind the interface | **yes**: a service-role key for the purge cron (new Vercel secret + RUNBOOK rotation) or user-JWT-scoped RLS policies on `storage.objects` (DDL on a Supabase-managed schema) | 1 GB free, 50 MB/file (**verify**); browser-direct uploads bypass Vercel's body cap | Supabase-specific access model |
| Vercel Blob | no (same outbox problem) | no | token | paid beyond free allotment | Vercel-specific |

The product only *needs the extracted cells* to chart; the original bytes serve re-extraction, download-back and provenance. Bytes are therefore secondary, small (≤ 4 MB, D5) and single-user today. `bytea` keeps the "one enforcement point" retention guarantee literally true and CI hermetic, at zero new operational surface. `FileStore { put(userId, datasetId, bytes): Promise<void>; get(...): Promise<Uint8Array|null>; delete(...) }` is the seam; `PostgresFileStore` is the only implementation in v1.

**Revisit triggers (recorded):** total stored bytes > ~100 MB, a second real user, or the need for files > 4 MB → implement `SupabaseStorageFileStore` + browser-direct signed uploads + the delete outbox, in its own reviewed WP.

### D5 — Ingest pipeline: deterministic first, caps everywhere, ambiguity is asked not guessed

Common shape (all types): **untrusted bytes → sniff → parse → `cells: string[][]` → `profile` → store → thread + profile card**. Synchronous inside the Server Action for v1 (CSV parse is sub-second; HTML fetch and PDF+LLM fit a 45 s budget inside the 90 s route ceiling, the websearch precedent). The async job pattern (`pending_table_requests` claim/reclaim, ADR 026) is the recorded upgrade if PDF ever exceeds the budget.

- **CSV/TSV (WP202a, zero dependencies):** own RFC 4180 parser (`;`/`,`/tab sniffed by consistency across the first N lines; quotes; CRLF; BOM stripped — the dialect facts already recorded in `web/lib/csv.ts`). First non-empty row = header (v1 limitation, documented; "de koppen staan op rij 3" correction is WP202d). Caps in `limits.ts`: **4 MB file** (Next Server Action body limit is ~1 MB by default and must be raised via the `serverActions.bodySizeLimit` config key; Vercel functions cap request bodies at 4.5 MB — **Assumption: verify both against the installed Next 16 docs per `web/CLAUDE.md`**), **10,000 rows, 50 columns, 200 chars/cell, 40 chars/header**. Header/cell text is untrusted: rendered as React-escaped plain text only (the `WebSectionView` stance), never markdown.
- **Numbers (the parsing-level principle (c)):** `profile.ts` classifies each column as `year` (4-digit ints 1900–2100), `date` (ISO `YYYY-MM-DD` / `YYYY-MM`), `number`, `text`. For numeric columns it decides a `numberFormat` deterministically: any cell with both `.` and `,` → the last separator is decimal; only `,` → decimal comma; only `.` where every dotted cell has exactly three digits after the dot → **`ambiguous`** ("1.234" is 1234 nl or 1.234 en). An ambiguous column blocks charting until the user answers a two-chip question on the profile card ("Punt is duizendtal" / "Punt is decimaalteken") — stored on the profile, never guessed. Per-cell `decimals` (from the raw text) are kept so display via the shared `formatValueNl` never rounds.
- **XLSX (WP202b):** parsed server-side to the same `cells` shape; multiple non-empty sheets → ask which one (a `needs_decision` dataset with sheet chips). **Library decision at build**, recorded here as an open point (§8 Q5): `exceljs` (npm, MIT) vs SheetJS (`xlsx` on npm is a frozen community build; check advisories with `npm audit` before choosing). A zip-based format needs a decompressed-size/cell-count cap regardless.
- **Web page (WP202b):** server-side fetch with SSRF guards (http(s) only; resolve DNS and reject loopback/private/link-local/metadata ranges *per redirect hop*, ≤ 3 redirects; ports 80/443 only; 15 s timeout; 5 MB body cap; identifying `User-Agent`), then deterministic `<table>` extraction (`htmlparser2`, no DOM, no script execution); the largest well-formed table becomes the dataset, others are offered as chips. No table → refuse honestly in WP202b ("geen tabel gevonden op deze pagina"); LLM-assisted structuring of page text rides WP202c's PDF path. Store `fetched_at` + hash: the dataset is a **snapshot** ("opgehaald op {datum}"), never re-fetched at chart time — principle (b)'s "ingest once, serve from our store" applied to user content. **CBS URLs are redirected to the official path:** a `opendata.cbs.nl` / StatLine table URL is recognised deterministically and answered with "dit is een officiële CBS-tabel — stel je vraag in de CBS-chat (of laat ons de tabel ophalen)", never scraped into the unverified tier (that would strip verified data of its verification and bypass ADR 003).
- **PDF (WP202c, fast-follow):** text layer via `pdf-parse` (no OCR; scanned PDFs refuse: "geen tekstlaag"). Structuring is LLM-assisted on the cheap tier (`DATASET_EXTRACT_MODEL = 'claude-haiku-4-5'`, escalation ladder Haiku → Sonnet on a *measured* miss, the TABLE_RERANK_MODEL discipline) — **with a deterministic verbatim-token belt**: every numeric cell the model emits must occur verbatim (after `normalizeForScan`) in the PDF's own token stream; a cell that does not is stored as `null` with reason `'niet teruggevonden in de brontekst'` and is never chartable. The extraction is **recorded, never re-derived** (the `webSection` rule), the user confirms a preview before the dataset becomes `ready`, and every chart from it carries the stronger badge "automatisch uitgelezen uit PDF". This is the one place LLM output *is* the data source, which is exactly why it is last, belted, previewed and labelled.

### D6 — The closed vocabulary: `DatasetProfile` is what the LLM sees; the instruction is a closed multiple-choice (the `validateRerankOutput` pattern)

This is the hard sub-problem: intent parsing over an arbitrary, previously unknown schema, versus the CBS parser's closed registry vocabulary. The answer is to **manufacture a closed vocabulary per dataset, deterministically, at ingest time**, and let the model choose only from it:

```jsonc
// DatasetProfile (stored; the ONLY dataset content that reaches a prompt — R2 analog)
{ "columns": [
    { "id": "c0", "header": "Jaar",     "type": "year",   "min": 2015, "max": 2023, "nulls": 0 },
    { "id": "c1", "header": "Gemeente", "type": "text",   "distinct": ["Amsterdam","Rotterdam","Utrecht"], "distinctTruncated": false },
    { "id": "c2", "header": "Omzet (x 1.000 euro)", "type": "number", "numberFormat": "nl", "min": 120.5, "max": 9800, "sample": ["120,5","9.800"] }
  ],
  "rowCount": 27 }
```

Sample values and ranges are needed so the model can express filters ("alleen 2020–2023"), but **nothing the model emits about them is ever a chart value** — see D7. Distinct lists are capped (e.g. 50) and marked truncated; text cells are length-capped.

```ts
// ChartInstruction v1 (src/attachments/types.ts) — the model's whole output surface
interface ChartInstruction {
  version: 1;
  kind: 'line' | 'bar';
  x: ColumnId;                          // must be a profile column id
  y: ColumnId[];                        // 1..4 columns of type 'number'|'year' (validated)
  seriesBy: ColumnId | null;            // a 'text' column → one series per distinct value (cap 8)
  filters: Array<
    | { column: ColumnId; op: 'in'; values: string[] }            // values ⊆ profile distinct values
    | { column: ColumnId; op: 'between'; from: number; to: number } // numeric/year only; inside [min,max]
  >;
  sort: { by: 'x' | ColumnId; direction: 'asc' | 'desc' } | null; // bar charts only
  limit: number | null;                 // top-N after sort, cap 50
  confidence: number;                   // 0..1; threshold applied by deterministic code (R7 analog)
  reading: string;                      // one Dutch sentence — audit/diagnostic ONLY, never rendered in v1
  unsupported: null | { reason: 'aggregation' | 'computation' | 'compare_with_cbs' | 'not_chartable' | 'other'; detail: string };
}
```

`validateInstruction(outputText, profile)` (`instruct/schema.ts`) throws `InstructionValidationError` on: invalid JSON, schema violation, **any column id not in the profile**, a `y` that is not numeric, an `in` value not in the distinct list, a `between` outside the column's real range, `line` on a non-ordered x, caps exceeded, confidence outside 0..1. A throw is routed to a clarification, never to a chart — a validation failure can only cost a turn, never produce a wrong picture. Range checks and allowlists live in code, not in the JSON schema (structured outputs allow neither per-request enums nor min/max — the `intent/schema.ts` note).

**Model tier (explicit, per the delegation cost-tier rule):** `DATASET_INSTRUCT_MODEL = 'claude-haiku-4-5'` — a schema-forced multiple-choice over a supplied list, the same shape as `TABLE_RERANK_MODEL`/`INTENT_MODEL`; `temperature: 0` (Haiku's proven config; a Sonnet escalation needs `thinking: 'disabled'` and threshold co-calibration, the #172 lesson). Calls go through the shared `LlmClient` harness so CI replays committed fixtures (`tests/fixtures/llm/attachments/`, `npm run attachments:record`/`:eval` on the `intent-eval.ts` pattern) with a labelled case set `benchmark/attachments-cases.json` for threshold calibration (ADR 012 procedure). Recorded in ADR 004 as a fourth confined role (and, in WP202c, extraction as a fifth).

*Rejected:* (a) free-form "write the chart config" prompting — no allowlist, the model could invent columns; (b) letting the model see the full rows — R2's whole point; (c) a purely deterministic keyword matcher — fails on exactly the paraphrases users type; (d) `reading` rendered to the user — the only LLM prose surface in the tier, and one that can carry digits; kept off the screen in v1.

### D7 — Where the hard constraint (H1) is enforced: `execute.ts` + `buildUserChartSpec`, and nowhere else can a chart value originate

The boundary, stated as code shape so an implementation agent cannot miss it:

1. `parse.ts` returns **only** a validated `ChartInstruction` (column ids, enumerated values, ranges, kind). It has no path to return a number for display.
2. `executeInstruction(dataset, instruction)` is a **pure function over `dataset.cells`**: apply filters → group by `seriesBy` → order (line: by typed x ascending, always; bar: by `sort`) → `limit` → **cap points** (e.g. 500; beyond that: an honest refusal "te veel punten — filter eerst", never silent omission). **v1 performs no arithmetic**: no sums, means, percentages, differences. Every plotted `value` is `parseNumber(rawCell, column.numberFormat)` of one stored cell.
3. `buildUserChartSpec` (the *only* producer of `UserChartSpec`, mirroring `buildChartSpec`'s one-producer rule) copies each selected cell into a `UserChartPoint { rowRef: 'r17:c2', xKey, xLabel (the raw x cell text), value, formattedValue: formatValueNl(value, cell.decimals), sourceText: rawCell }` — the shared Dutch formatter, so display never rounds or reformats beyond localisation (R3/R10 analog). Empty/unparseable cells stay in the spec as `value: null` with `reason: 'leeg in bron' | 'geen getal: "n.v.t."'` (R11's null-with-reason analog: a renderer must show a gap, never skip).
4. The web renderer (`UserChartView`) may compute layout only; every visible number is a spec string bound to its `rowRef` via `data-label-for` (R6 analog).
5. **Reconstruction (D9) re-runs steps 2–3 from the stored instruction + stored cells and requires byte-identical specs** — so a drifted builder, a hand-edited row, or a tampered spec fails loudly.

Consequence (worth saying to the owner plainly): the model *can* pick the wrong column or filter — a wrong *selection*, visibly labelled with the file's own headers and filter values, and correctable in the next turn. It *cannot* produce a wrong *value*: no code path exists from model output to a plotted number. The reply text is a deterministic template (D8), so there is no R3 surface in the tier at all in v1. Registered aggregations ("som per gemeente"), if ever wanted, are WP202d: deterministic functions registered like `src/query/derivations.ts`, marked "bewerking", with their source `rowRef`s listed (R5 analog) — and `unsupported.reason = 'aggregation'` refuses them honestly until then.

### D8 — The dataset-chat loop and iterative refinement (ADR 021's structured-context pattern, no chat history in prompts)

Turn = `askDataset(datasetId, threadId, text, requestId, rawState)` (`web/app/dataset-actions.ts`, a sibling of `askQuestion`, reusing `guardLength`/`guardRequestId`/`currentUserId`):

1. Ownership: dataset **and** thread must belong to the caller (bound parameters; `validateThreadOwnership` + a `validateDatasetOwnership` twin); `status = 'ready'` else the profile-card decision chips are re-offered.
2. `rawState` = the client-held `{ datasetId, lastInstruction }` from the previous chart turn (the `ConversationContext`/`PendingClarification` posture): **revalidated server-side against the profile** through the same `validateInstruction` allowlist; any failure drops it (fail closed to a standalone parse). Never previous question/reply text.
3. Billing reserve (D12), then deterministic pre-checks (empty; a CBS-comparison ask → `compare_with_cbs` refusal template; "download"/"exporteer" → the export button hint, zero LLM).
4. One Haiku call with `{ profile, previous_instruction | null, question }`; merge rules in the prompt mirror `FOLLOWUP_MODE_SECTION`: the previous instruction is the referent for continuations ("maak er een staafdiagram van", "alleen 2020–2023", "voeg kolom B toe"); inherit only what the question leaves unstated; never override a stated axis; a self-contained question parses fresh.
5. Threshold (**calibrated**, provisional 0.8 like the finder): confident → chart; below, or `unsupported` set, or validation throw → **clarification with concrete, deterministic options** built from the profile (the actual column headers / distinct values), one round; still unclear → refusal-with-guidance. Templates only (`respond.ts`), zero LLM prose — the ADR 015 rule reused.
6. Execute + build spec (D7); write the turn (D9); return `DatasetTurnEnvelope`; the client appends a `DatasetChatMessage` and a new dock tab. Each refinement yields a **new chart message and tab**; earlier charts stay (the owner's "multiple charts from one upload").

The **profile card** (first assistant message, deterministic, zero LLM) shows what was read — "245 rijen, 6 kolommen: Jaar (jaartal 2015–2023), Gemeente (tekst, 3 waarden), Omzet (getal)…" — plus **suggestion chips generated from the profile** ("Lijngrafiek van Omzet per Jaar", "Staafdiagram van Omzet per Gemeente"), the #75 fill-don't-send convention. A clicked chip that goes out unedited is taken by a **deterministic click-path** (no LLM call — the WP26 take-path shape; the chip carries its pre-built `ChartInstruction`). Presentation-only toggles (line ↔ bar where the x-type allows, series show/hide) are **zero-LLM buttons on the chart**, reusing the ADR 033 D4 precedent that toggles are client state over an unchanged spec (WP202d).

*Rejected:* raw chat history in the prompt (#41/ADR 021, forbidden); re-parsing every turn without the previous instruction (loses "make it a bar chart"); an LLM-written reply sentence (reintroduces an R3 surface for zero product value in v1 — the chart is the answer).

### D9 — Envelope, audit-before-show, reconstruction, redaction (R8 analog, its own record)

```ts
// DatasetTurnEnvelope (pure leaf) — stored verbatim in dataset_turns.envelope
type DatasetTurnEnvelope =
  | { schemaVersion: 1; kind: 'chart'; question: string; text: string /* template */; instruction: ChartInstruction;
      chart: UserChartSpec; state: { datasetId: number; lastInstruction: ChartInstruction } }
  | { schemaVersion: 1; kind: 'clarification'; question: string; text: string; options: string[];
      instruction: ChartInstruction | null; reason: 'low_confidence' | 'validation' | 'ambiguous_format' | ... }
  | { schemaVersion: 1; kind: 'refusal'; question: string; text: string; reason: 'aggregation' | 'compare_with_cbs' | 'too_many_points' | 'not_chartable' | 'internal' | ...; guidance: string | null };
```

- **Stored before shown** (`audit.ts` `writeTurn`): the action returns only after the insert commits; an insert failure withholds the chart and returns the `internal` refusal (fail-closed, `persistOrFailClosed`'s rule), and the reserve is refunded.
- **Reconstruction** (`reconstructDatasetTurn(row)`, wired into `scripts/verify-audit-rows.ts` as a second report): `final_text === envelope.text`; `text` re-derives byte-identically from the template over `instruction` + profile; `chart` re-derives byte-identically via `buildUserChartSpec(dataset, instruction)` over the *stored* cells; `instruction` and any `extraction` are **recorded-not-rederived** (the `webSection`/`semanticCheck` category); the spec re-parses through a `strictObject` zod schema (`userChartSpecSchema`).
- A **manifest test** for `DatasetTurnEnvelope`/`UserChartSpec` keys (the `envelope-key-manifest.test.ts` pattern) so a new field cannot land without an R8 decision; presence grammar per `docs/13` (present-only for anything behind a flag).
- **Redaction sentinel** (owned by `attachments/audit.ts` like `retention.ts` owns `redactedResponse`): `{ schemaVersion: 1, kind, question: REDACTED_QUESTION_TEXT, text: REDACTED_QUESTION_TEXT, redacted: true }`; `instruction` nulled; `redactionIntegrityReport` gains a twin.

### D10 — Threads and the surface: a dataset thread is a `chat_threads` row with `dataset_id`; `DatasetChat` is a separate component; the dock is shared

- `listThreads` (`src/threads/index.ts`) gains a second correlated subselect for the title (`user_datasets.display_name` where `t.dataset_id is not null`, filtered when redacted) and returns `ThreadSummary.kind?: 'cbs' | 'dataset'` (additive). `ThreadSidebar` renders a paperclip prefix and "Eigen data:" for dataset threads (copy for owner review).
- `loadMyThread` dispatches: `dataset_id` NULL → today's replay, byte-identical; else `loadDatasetThread` → `replayDatasetTurns(rows)` (deterministic; **zero LLM**) → `DatasetChatMessage[]` + the last chart turn's `state` as the resumed refinement referent (revalidated).
- `Workspace` mounts **`DatasetChat`** (new file) instead of `Chat` when the handoff carries a dataset thread. `chat.tsx` changes in exactly one place: the two placeholder buttons become enabled when an optional `attachments` prop is present (presence-driven, the `websearch` prop pattern) with `onUploadFile`/`onAddLink` callbacks; prop absent ⇒ **byte-identical** to today (the ADR 033 D4 pins hold; add a flag-off rendering pin).
- Upload UI without a component library: a hidden `<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values">` triggered by the button; "Link toevoegen" toggles an inline row (input per huisstijl rule 6 + "Ophalen" button) — no modal. Busy copy: "Bestand wordt gelezen…" / "Pagina wordt opgehaald…". On success the workspace calls `selectThread(newThreadId)` — the "nested, scoped" feel: the user is now inside that file's conversation; the sidebar is the way back.
- Dock: `DockVisual` gains `userChart: UserChartSpec | null` (additive), `deriveDatasetVisuals(messages)` labels tabs "Eigen grafiek n", and `VisualDock` gains one branch rendering `UserChartView`. Below `lg`, user charts render inline in the dataset chat exactly like CBS charts do in the CBS chat (D4 symmetry).
- The trial (`trial-chat.tsx`) never renders the buttons; the actions require `currentUserId()` — account-only by construction.

### D11 — Visual/structural distinction (H2): a distinct spec type, a distinct renderer chrome, distinct exports

- **Type-level:** `UserChartSpec` is a separate type — `schemaVersion: 1`, literal `origin: 'user_dataset'`, literal `trust: 'unverified'`, `provenance: { datasetId, sourceKind, displayName, sourceUrlHost | null, capturedAt, contentSha256 }`, `xHeader`/`yHeaders` verbatim, `unit: null` (never inferred — a header like "Omzet (x 1.000 euro)" is shown verbatim as the header, not parsed into a unit; U10), `disclaimerLine: USER_DATA_DISCLAIMER` ("Eigen data van de gebruiker — niet door checkdecijfers geverifieerd."). It **cannot** parse as a `ChartSpec` (`chartSpecSchema` is `strictObject`; no `attribution`, no `license`), and `ChartView` refuses it — the mis-render is impossible, not merely styled away.
- **Renderer:** `web/components/user-chart.tsx` `UserChartView` reuses the exported pure helpers from `chart.tsx` (`buildRows`, `yAxisDomain`, `valueLabelPlan`, `AxisTick`, `ChartTooltip`, `seriesStyle` — the session-79 `ChartSmallMultiples` precedent) over an adapter mapping points to the helpers' row shape (`resultId := rowRef`, `periodCode := xKey`). One **type-only** change in `chart.tsx`: the helpers accept a minimal `PlottableSpec` interface instead of the full `ChartSpec` (no runtime change, CBS output byte-identical, existing tests unchanged). `ChartView` itself is untouched.
- **Chrome (huisstijl tokens only):** container `rounded-lg border-2 border-dashed border-line-strong bg-paper-raised`; a persistent badge top-left `bg-warn-soft text-warn text-xs font-medium` reading **"Eigen data · niet geverifieerd"** (warn is the semantic token for warnings — a sanctioned use); heading "Eigen data: {displayName}" (serif per rule 1); footer = the provenance line ("Uit bestand verkoop-2024.csv, geüpload op 2026-09-06 · 27 rijen") + the disclaimer line, **no `SourceBadge`, no StatLine link, no "CC BY 4.0", no "Bron: CBS StatLine"**; series palette shared (colour-blind safety is a property of the tokens, not of trust). PDF-derived datasets add "automatisch uitgelezen uit PDF".
- **Exports:** `ChartDownloadMenu` is reused with `attributionText = "{disclaimerLine} · checkdecijfers.nl"` so a PNG/SVG can never leave without the disclaimer; the table view and a "Download als CSV" of the *selected* rows carry the same preamble line (CSV-injection prefixes `= + - @` escaped on export).
- **Everywhere else:** dock tab "Eigen grafiek n", sidebar prefix, the message bubble's own "Eigen data" pill, and the eventual "Jouw grafieken" gallery (#159) grouping user charts under their own heading (WP202d).

### D12 — Cost mechanism (the amounts are the owner's; the mechanism is the WP129+130 one)

- New ledger reason **`dataset_cost`** (migration 027) with sibling primitives in `src/billing/ledger.ts` — `debitDataset` / `reserveDatasetDebit` (idempotent per `(user, request)`, per-user advisory lock) — and `compensate` unchanged; `gate.ts` and every existing ledger function **byte-untouched** (the WP16/WP129 rule: never parameterise the hot path).
- Two price rows in `ACTION_CLASS_PRICES`: **`dataset_ingest`** (charged per successful ingest; refunded if extraction fails or the user abandons a `needs_decision` dataset — settlement on the ingest action) and **`dataset_turn`** (per dataset-chat turn; settlement mirrors `chargeAndRun`: a chart keeps the debit, a clarification compensates down to the flat `clarification` price, a refusal/throw refunds in full). A `src/billing/dataset-gate.ts` `chargeAndRunDataset` sibling implements that, typed on the dataset envelope. **Assumption:** the owner may want deterministic CSV ingest to cost 0 and only LLM-assisted (PDF/HTML-unstructured) ingest to cost credits — the two-row mechanism supports either without code change (ADR 006: prices are config).
- Balance/history surfaces: `getQuestionHistory` (`src/billing/history.ts`) and `getThreadRows`' credits join both enumerate debit reasons by hand — the recurring "hardcoded debit-reason list" blind spot (lessons-learned). Dataset turns are not `audit_answers` rows, so the dashboard needs a `UNION` over `dataset_turns` (own request_id) or the balance moves with no history line. In scope for WP202a's done-definition; the pre-send cost line in `DatasetChat` reads the live price rows like `ChatPricing` does.
- Pricing consequences to state on the cost line (honest, like ⟨W4⟩): a turn transiently holds `dataset_turn`; an ingest holds `dataset_ingest`; no CBS `simple` debit is involved in a dataset thread.

### D13 — GDPR/retention from day one (the #14/#120 machinery, extended structurally)

- **Scope:** `user_datasets` (name, URL, bytes, cells, profile, extraction) and `dataset_turns` (question, envelope, instruction) are personal data — and uploaded files may contain **third parties'** personal data (a journalist's spreadsheet of names). Both tables are inside the redaction scope on the first commit that creates them.
- **Self-service:** `deleteMyQuestionHistory` already redacts everything; `redactMatchingRows` gains a generic `extraLegs: { sql; params; guardTable?: string }[]` parameter (rather than a 4th and 5th named argument) so `deleteUserDatasets(userId)` runs **in the same transaction**: `dataset_turns` → the D9 sentinel (skeleton kept: id, user_id, thread_id, request_id, created_at, kind — the "verwijderde vraag" placeholder posture with cost still visible); `user_datasets` → `file_bytes = null, cells = '[]', profile = '{}', extraction = null, display_name = REDACTED, source_url = null, status = 'redacted'` (row kept: the thread FK and quota history stay consistent; nothing references the ledger, so a hard DELETE would also be legal — redact keeps the sidebar/placeholder behaviour uniform). Guarded on `to_regclass` only during the deploy window (a check, not a catch), like the feedback leg.
- **Per-dataset delete (recommended in v1, §8 Q3):** "Verwijder dit bestand" in the dataset thread — the same leg scoped `where id = $2 and user_id = $1`, redacting the dataset **and** its turns. This is the first real need for ADR 033's deferred per-thread deletion ("I uploaded the wrong file" is a far stronger expectation than for a chat), and it satisfies that residual for dataset threads. Cross-user pins as in `tests/threads/threads.test.ts`.
- **Purge:** `runRetentionPurge` gains a `datasets` leg (count + purge sharing ONE `WHERE` fragment, the ⟨F2⟩ rule; `RetentionPurgeSummary.datasets`; carry-what-committed on partial failure). Window: **DECIDED (§8 Q2, 2026-09-06):** the #14 two-year account window for `cells`/`profile`/turns; a **shorter, 90-day** window for raw `file_bytes` only (the #181 "retention without purpose" reasoning — bytes serve re-extraction/download, not the chart record) — a second cutoff in the same fragment.
- **Chart images:** exports are client-side blobs (nothing stored). Redacted turns replay as one placeholder, so a redacted dataset's tabs vanish on resume (the ⟨A7⟩ posture).
- **DPA/disclosure:** dataset headers/samples (and, in WP202c, PDF text) transit the LLM provider — the docs/04 GDPR item 3 seam widens from "user questions" to "user-uploaded content"; the privacy-policy line (#14(d), still pending) must say so before external users. Also an in-UI notice near the upload button (copy for owner review) advising against uploading bijzondere persoonsgegevens.

### D14 — Rollout: `ATTACHMENTS_ENABLED`, FILE-ONLY migrations, supervised go-live, branch + PR

The WP129/WP135 dormancy pattern: `page.tsx` reads the flag and passes `attachments: { enabled: true, ingestPrice, turnPrice }` to `Workspace` → `Chat` (buttons enabled) and `DatasetChat`; flag off ⇒ buttons stay the disabled placeholders (byte-identical, pinned), no action constructs the LLM client or touches the new tables (deploy-order-safe), the sidebar query still runs its title subselect only when `dataset_id is not null` (all NULL pre-go-live). Migrations 026/027 apply only in the owner-supervised window (grants/RLS live-check per RUNBOOK; the guarded `auth.users` FK verified there — CI is blind to it, ⟨A2⟩). Kill switch = unset the flag. Core-product + money path ⇒ branch + PR + owner review (#118(b)) unless built owner-present.

---

## 3. Invariants at stake

**Untouched by construction (pins to add where a new seam exists):** R1–R11 for CBS answers (no CBS pipeline code changes; zero prompt bytes in `intent/`/`compose/`/`clarify`/`followup`; all fixtures replay unchanged); the benchmark's 14/14 + 6/6 + 0 fabricated gate; ADR 032 separation (web section never in charts — and now: user data never in `ChartSpec`); ADR 033 D4 byte-identity of the CBS message envelope (flag-off pin on the two buttons); ledger conservation (`gate.ts` untouched; new debits reversible only via `compensate`); cross-user isolation (every new read/write binds `user_id`).

**The user-data tier's own invariants (U-rows), with their R-analogs — to be added to `docs/05-data-rules.md` as a new section like the websearch one:**

| U | Invariant | R analog | Verified by (new tests, `tests/attachments/` + web) |
|---|---|---|---|
| U1 | Every plotted value traces to one stored cell (`rowRef` = row index + column id) | R1 | spec test: each point's `value` equals `parseNumber(cells[row][col])`; swapped-row mutation test fails |
| U2 | The instruction prompt receives only the `DatasetProfile` (headers, types, capped distincts/samples, ranges) + the previous *validated* instruction + the question — never full rows, never prior chat text | R2 | serialized-request pin (no cell beyond the profile's capped samples; no prior question text) |
| U3 | No LLM-emitted number can reach a chart or the reply text: the instruction carries selectors only; reply text is a deterministic template | R3 | type-level (instruction has no value fields) + a pin that the envelope `text` is template output; digit-scan of templates against profile/instruction only |
| U4 | Provenance + disclaimer are in the spec and always rendered; no CBS attribution/badge/license on a user chart | R4 | rendering test: badge + disclaimer present, `SourceBadge`/"CC BY" absent; export markup contains the disclaimer |
| U5 | v1 computes nothing; any aggregation refuses with `unsupported.reason='aggregation'`; future aggregations are registered functions marked "bewerking" with source rowRefs | R5 | executor has no arithmetic path (test enumerates ops); refusal template pin |
| U6 | `buildUserChartSpec` is the only producer; the renderer computes layout only; every visible numeric string is a spec string bound via `data-label-for` | R6 | jsdom render: every numeric token appears in the spec; binding test |
| U7 | Off-allowlist column/value, out-of-range filter, low confidence, `unsupported` → clarification/refusal with profile-derived options; never a best guess; one round | R7 | validator throw suite (the rerank-schema test shape); threshold calibration set replayed hermetically |
| U8 | Turn written before shown; fail-closed to `internal` refusal + refund; `chart`/`text` re-derive byte-identically from stored instruction + cells; `instruction`/`extraction` recorded-not-rederived; sentinel-shape check for redacted rows | R8 | audit tests incl. tamper cases; manifest test for the envelope keys |
| U9 | Axis/series labels are the file's own headers and cell texts verbatim (no rewording) | R9 | spec pins |
| U10 | Units are never inferred; the header is shown verbatim; `unit: null` | R10 | schema literal + render pin |
| U11 | Empty/unparseable cells stay in the spec as `null` with a reason and render as gaps, never omitted; ambiguous numeric formats block charting until the user decides | R11 | parser/profile fixtures (`;`/`,`/tab, decimal comma, `1.234` ambiguity, BOM, quoted fields, blanks, "n.v.t.") |

**Separation pins (the ADR 032 list, transposed):** user-data text/values never appear in any CBS prompt request (serialized-prompt scan over the CBS harness with a dataset thread active), never in `audit_answers`, never in `ChartSpec` (a `UserChartSpec` fails `chartSpecSchema`), never in `ConversationContext`; a dataset thread's state never becomes a CBS turn's context and vice versa; the benchmark constructs no attachments machinery; CBS URLs are never ingested as user data.

---

## 4. Security notes for the executor brief

Type-then-size guards on every Server Action argument (the `guardLength` lesson: a `.length` check alone passes an array); content sniffing over extension/MIME; caps from `limits.ts` applied before parsing; header/cell text rendered as escaped plain text only; SSRF guard as in D5 with per-hop re-validation; no script execution on HTML; zip-bomb caps for XLSX; `dataset_id`/`thread_id` coerced like `coerceThreadId` and ownership-checked before any read; per-user quota (e.g. 25 datasets / 50 MB — owner-tunable constants) checked before ingest; errors to `error_log` by request id, never content (`error_log`'s no-personal-data invariant); `console.error` per path (the websearch go-live lesson: silent failures were undiagnosable).

---

## 5. Phased build plan (docs/08 register; smallest useful slice first)

### WP202-0 — Design freeze (this draft → ADR 037), owner interview, adversarial review
**Scope:** owner read-back on §8; promote to `docs/decisions/037-user-data-attachments.md`; frozen executor brief in `docs/session-briefs/`; pre-build multi-lens review (lenses: H1 boundary, GDPR/cross-user, R8-analog/replay, UI byte-identity, money path, upload security/SSRF, LLM allowlist). **Done:** all interview points answered; review amendments folded into the brief.

### WP202a — "Eigen data v1": CSV/TSV upload → dataset chat → deterministic line/bar charts with filters (the smallest useful slice)
**Scope:** migrations 026 + 027 (file-only); `src/attachments/` per D2 with `ingest/csv.ts`, `profile.ts`, `numbers.ts`, `file-store.ts` (bytea), `instruct/*`, `execute.ts`, `chart.ts`, `respond.ts`, `audit.ts`, `retention.ts`; billing siblings + `dataset-gate.ts` + two price rows; `threads` additive `kind`/title subselect + `loadDatasetThread`; `web/app/dataset-actions.ts` (`ingestFile`, `askDataset`, `decideDatasetFormat`, `deleteMyDataset`); `DatasetChat`, `UserChartView`, `dataset-message.ts`, `dataset-visuals.ts`, dock branch, sidebar marks; the two buttons wired behind `attachments` prop; flag; fixtures + `attachments:record/eval`; `tests/attachments/` + `npm run test:attachments` + CI step; history UNION; docs. **Explicitly not in a:** XLSX, links, PDF, aggregations, header-row correction, presentation toggles.
**Invariants:** U1–U11, the separation pins, ledger conservation, cross-user pins, ADR 033 D4 flag-off byte-identity.
**Design decisions:** D3–D14 as written; instruction threshold provisional 0.8 pending calibration on a labelled set of ≥ 25 real Dutch phrasings over ≥ 3 fixture datasets (long, wide, messy); no LLM prose.
**Done means:** full verification block green (typechecks ×2, all suites incl. the new one, benchmark 14/14 + 6/6 + 0 fabricated unchanged, real `next build`); flag-off proven byte-identical; calibration measured and recorded (accuracy, clarify rate, zero validator-passing wrong-value cases by construction); GDPR legs pinned (self-service + per-dataset + purge, same-transaction, ⟨F2⟩ count equivalence); `verify-audit-rows` covers `dataset_turns`; docs updated (§7); PR for owner review; supervised go-live per RUNBOOK section "WP202 eigen data".

### WP202b — "Link toevoegen" (HTML tables) + XLSX
**Scope:** `ingest/html.ts` with the SSRF guard module (unit-tested against private-range/redirect fixtures), `<table>` extraction, multi-table chips, CBS-URL redirect; `ingest/xlsx.ts` after the library decision (§8 Q5), multi-sheet decision chips, decompression caps; `source_kind` values already in the CHECK. **Invariants:** as a; plus "snapshot, never re-fetched" and "CBS URLs never enter the tier". **Done:** fixtures for both; SSRF suite; the second button real; docs.

### WP202c — PDF (LLM-assisted structuring with a verbatim-token belt and user confirmation)
**Scope:** `ingest/pdf.ts` (`pdf-parse`), `DATASET_EXTRACT_MODEL` (Haiku; ladder recorded), extraction recorded on `user_datasets.extraction`, per-cell verbatim verification, preview/confirm step before `ready`, stronger badge, ADR 004 fifth role. **Invariants:** U1–U11 plus "unverified extracted cells are never chartable" and "extraction is recorded-not-rederived". **Done:** a fixture PDF set with known tables; a mutation test proving a fabricated cell is rejected; owner read of 5 real PDFs.

### WP202d — Refinement extras
Presentation toggles (line ↔ bar, series hide) as zero-LLM chart buttons; header-row correction; registered aggregations (sum/mean per group) marked "bewerking" (R5 analog) if the owner wants them; user charts in `/geschiedenis` and the #159 gallery under their own heading; optional Supabase Storage `FileStore` if the D4 trigger fires.

---

## 6. Trade-offs accepted

- The model can mis-*select* (wrong column/filter); the design makes that visible (headers and filter values are shown verbatim) and correctable, and makes mis-*valuing* impossible. This is the same asymmetry ADR 004 accepts for CBS intents.
- No arithmetic in v1 means some natural asks ("totaal per jaar") are refused honestly with the reason and a path (upload a totals column, or wait for WP202d). Refusing is cheaper than one wrong sum in a product whose premise is "never guess".
- First-row-as-header and the 4 MB/10,000-row caps are limitations, stated in the profile card, not hidden.
- Postgres `bytea` grows the database; bounded by quotas and a stated upgrade path.
- A second envelope/table/reconstruction path duplicates *shape*, not code, of the CBS audit machinery — the price of never touching the pinned CBS envelope.

---

## 7. Docs to update in the same change (so no doc lags)

ADR 037 (new); ADR 001 module list (+ `attachments/`); ADR 004 (fourth/fifth confined roles); ADR 008/033 as-built notes (the `attachments` prop, dataset threads); `docs/05-data-rules.md` (new "User-supplied data — structurally outside R1–R11" section with the U-table and separation pins, retention paragraph); `docs/09-pricing.md` (two rows + net-cost table); `docs/13` (the second envelope and its presence grammar); `docs/04-architecture.md` (capability rows, GDPR write-point list: now audit_answers, pending_table_requests, user_datasets, dataset_turns); `docs/03-mvp-scope.md` non-goals table (owner pull-forward row; Google Sheets stays out); `docs/06-roadmap.md` feature pool; RUNBOOK (`ATTACHMENTS_ENABLED`, migrations 026/027 supervised steps, quota constants, no new secrets in v1); open-questions #201/#202 rows (+ new rows for §8); `/systeemoverzicht`'s hand-written status labels; STATUS/archive.

---

## 8. Open questions and assumptions (never presented as settled)

**Owner decisions — ALL RESOLVED 2026-09-06 (session 84, read back in chat, one at a time)**

1. **Prices — mechanism DECIDED, exact numbers still open:** free CSV/TSV ingest (no AI work happens there, so nothing to charge for); pay-per-turn in credits for each dataset-chat question, sized near the +10 web add-on (exact number not yet set); a future LLM-assisted ingest (PDF/HTML) would charge on ingest too, since that step is real AI work. **No subscription-tier gate** — raised during this read-back, parked separately (see the tracked item below), does not block this feature. *(The two-price-row mechanism is independent of the exact numbers.)*
2. **Retention windows — DECIDED:** 2 years for `cells`/`profile`/turns (the existing #14 account-retention default); the raw uploaded file (`file_bytes`) is purged sooner, after **90 days** — it only serves re-extraction/download, not the chart record itself.
3. **Per-file delete in v1 — DECIDED: yes.** Ships in WP202a ("Verwijder dit bestand" in the dataset thread). Also settles ADR 033's per-thread-delete residual for dataset threads.
4. **PDF in v1 or fast-follow — DECIDED: fast-follow (WP202c).** Not in the first release.
5. **XLSX in the first slice or the second — DECIDED: second batch, with web links (WP202b).** v1 copy: "Excel? Sla op als CSV — XLSX volgt."
6. **Copy — DECIDED: use as proposed, verbatim.** Badge "Eigen data · niet geverifieerd"; disclaimer "Eigen data van de gebruiker — niet door checkdecijfers geverifieerd."; chart tab name "Eigen grafiek n". (The upload privacy notice advising against *bijzondere persoonsgegevens* still needs its own copy pass at build time — not reviewed in this round.)
7. **Ever combine user data with CBS data in one chart? — DECIDED: never, for v1.** Confirms D1's original design. A safer "side-by-side, never computed across" shape was sketched as the only way to do this at all without breaking the traceability invariants, then the owner explicitly deferred the whole question: **"these are edge cases for later."** Not designed further now; revisit only as its own future ADR.
8. **History/gallery integration — DECIDED: yes, in v1.** Dataset charts appear in the existing `/geschiedenis` page from day one — confirms the `UNION` over `dataset_turns` already scoped into WP202a's done-definition (D12), rather than deferring it to WP202d.
9. **Caps/quota — DECIDED: accept as proposed.** 4 MB file, 10,000 rows, 50 columns, 500 points per chart, 25 datasets / 50 MB per user. Plain config constants — adjustable later without a schema change.

**New tracked item (not part of this design, surfaced during the Q1 read-back):** the owner wants attachments/premium features eventually gated behind a **monthly recurring subscription**. This reverses the explicit "no subscription" decision in [ADR 006](decisions/006-auth-billing-seams.md) and [ADR 020](decisions/020-credit-ledger-and-billing-gate.md) (one-time Stripe Checkout purchases only) and touches billing schema, Stripe integration, and gating logic across the whole product — a bigger change than this feature. **Parked as its own future brainstorm + ADR revision** (see open-questions for the tracking row). Attachments v1 ships on the existing one-time-credit mechanism and does not depend on it.

**Assumptions the session marks inline (verify at build)**
- Next 16 Server Action body-size config key and Vercel's 4.5 MB request cap (per `web/CLAUDE.md`: read the installed docs, never memory).
- Supabase free-tier DB size (500 MB) and Storage limits (1 GB / 50 MB per file) — only relevant to the D4 trigger.
- PGlite `bytea` round-trip via the `Db` interface (Buffer/Uint8Array) — pin in the migration-026 test.
- `htmlparser2` / `pdf-parse` / the XLSX library: license and advisory status at build (`npm audit`), bundle impact on `web/` (server-only imports; never through the client-bundled leaf).
- The 0.8 instruction threshold is a placeholder until calibrated; a Sonnet escalation of `DATASET_INSTRUCT_MODEL` requires threshold co-calibration (#172 lesson).
- "No accounts" in the #201 row means no Sheets-scope OAuth, not no auth (ADR 028 exists).

---

### Critical Files for Implementation
- `/Users/amity/Documents/Check de Cijfers/src/websearch/attach.ts` (with `src/websearch/types.ts`) — the separation/attach/settlement shape every new seam copies
- `/Users/amity/Documents/Check de Cijfers/src/catalog/rerank-schema.ts` — the closed-choice allowlist validator `validateInstruction` mirrors
- `/Users/amity/Documents/Check de Cijfers/src/chart/build.ts` (with `src/chart/types.ts`, `web/components/chart.tsx`) — the one-producer builder and the helper exports `UserChartView` reuses
- `/Users/amity/Documents/Check de Cijfers/web/app/actions.ts` — guards, billing reserve/settle, thread attach, `deleteMyQuestionHistory`/`loadMyThread` the dataset actions parallel
- `/Users/amity/Documents/Check de Cijfers/src/answer/audit/retention.ts` (with `retention-job.ts`, `migrations/018_websearch_ledger.sql`, `migrations/019_chat_threads.sql`) — the same-transaction redaction legs and the migration patterns to extend

<!-- END PLAN -->
