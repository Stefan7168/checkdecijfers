// Intent resolution: StructuredIntent -> ResolvedQuery (validated CBS
// coordinates) or a typed refusal. Everything here is deterministic reads of
// the registry (cbs_tables, canonical_measures, dimension_labels) — no
// observation data yet, no LLM anywhere (WP5, docs/08-build-plan.md).
//
// Ordering: structural validity first (an intent that can never be valid),
// then registry resolution (table, measure, dims, regions), then slice
// compatibility. Period *availability* is a data question, not an intent
// question — a well-formed request for an unpublished period resolves fine
// here and refuses with the right kind (freshness / not_published) in run.ts.
import type { CbsSlice } from '../cbs-adapter/types.ts';
import type { Db } from '../db/types.ts';
import { parsePeriodCode, type ParsedPeriod } from '../ingestion/periods.ts';
import type {
  AttributionAlternate,
  IntentDerivation,
  PeriodGrain,
  QueryRefusal,
  StructuredIntent,
} from './types.ts';
import { INTENT_SCHEMA_VERSION } from './types.ts';

/** WP26 mechanism B (ADR 024, safelist entry 1): the CBS code for the national
 * total. Not a heuristic pick among places — a specific, existing row, which is
 * exactly what makes it the clean side of the decision-2 line. `run.ts`'s
 * freshestForCanonical already uses this convention; it lives here so the
 * default and the freshness lookup can never drift apart. */
export const NATIONAL_REGION_CODE = 'NL01' as const;

/** WP26 (ADR 024): per-call switches for the answer-first defaults. Absent
 * (benchmark, tests, CLI, and production until the owner flips the flag) ⇒ the
 * query layer behaves exactly as it did before WP26. */
export interface QueryOptions {
  /** `ANSWER_FIRST_ENABLED`: allow the structurally-determined defaults on the
   * safelisted axes (region today, period with B-period). Never widens WHICH
   * axes may default — that list is code, not configuration. */
  answerFirstEnabled?: boolean;
  /** #195/#196 (session 72): this call is a SERVABILITY DRY-RUN, never a
   * served read — the caller discards every value and shows the user
   * nothing from it (dry-run.ts's echoServability, the servability-probe
   * primitive follow-up chips / comparison chips / alternate-reading checks
   * all funnel through). `true` ⇒ runQuery skips the `last_queried_at`
   * usage bump entirely: a table that is only ever probed and never
   * actually delivers an answer must not read as "in demand" to the
   * eviction GC (src/ingestion/eviction.ts) — that was #195's finding, a
   * probe-inflated warmth that defeated the TTL's own premise. Absent/false
   * ⇒ byte-identical to pre-#195 behavior (every existing caller). */
  probe?: boolean;
}

export interface ResolvedQuery {
  intent: StructuredIntent;
  /** WP26 mechanism B: true when no region was named and we answered with the
   * NATIONAL total instead of asking. Travels onto the ValidatedResult so the
   * disclosure sentence is built from validated state and re-derives at audit
   * time (R8), never from a re-decided policy. */
  regionDefaulted: boolean;
  tableId: string;
  measure: string;
  measureTitle: string;
  /** Merged, validated non-geo/non-period coordinates. */
  dims: Record<string, string>;
  /** Labels for the merged dims — R9 binding data, fetched once here. */
  dimLabels: Record<string, string>;
  /** Validated region codes in intent order; [''] for tables without a geo
   * dimension (matching observations.region_code's '' convention). */
  regionCodes: string[];
  regionLabels: Record<string, string>;
  geoDimension: string | null;
  timeDimension: string;
  /** Fully enumerated period codes, ascending. */
  periodCodes: string[];
  grain: PeriodGrain;
  derivation: IntentDerivation;
  definitionLabel: string | null;
  definitionText: string | null;
  /** #39: the non-chosen alternate readings recorded on the resolved canonical
   * measure (canonical_measures.alternates) — [] for explicit targets and for
   * canonical measures without any. Read from the SAME registry row
   * definitionLabel comes from, so the disclosure can never name an alternate
   * the chosen default does not actually have. */
  alternates: AttributionAlternate[];
  table: {
    title: string;
    version: number;
    lastSyncAt: string | null;
    updateCadence: string | null;
    slice: CbsSlice | null;
    periodSemantics: Record<string, string> | null;
  };
}

export type ResolveOutcome = { ok: true; resolved: ResolvedQuery } | QueryRefusal;

function refuse(
  intent: StructuredIntent,
  kind: QueryRefusal['refusal']['kind'],
  message: string,
  extra?: Partial<QueryRefusal['refusal']>,
): QueryRefusal {
  return { ok: false, refusal: { kind, message, ...extra }, intent };
}

function parseJsonb<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

/** CBS metadata carries stray whitespace (double spaces inside measure
 * titles, trailing spaces on table titles — wire quirks like docs/07's code
 * padding). Codes are trimmed at parse time; human-readable titles/labels are
 * normalized here, at the presentation seam, so attribution matches how the
 * frozen answer key and docs record them. Whitespace-only — never touches
 * content. */
export function normalizeLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim();
}

/** Sortable key for parsed periods of one grain. */
export function periodKey(p: ParsedPeriod): number {
  return p.year * 100 + (p.index ?? 0);
}

/** True when the (deduplicated) codes form a gap-free run at their grain —
 * false the moment any period between first and last is absent. The #64
 * enumeration gate (run.ts + chart/build.ts): a plain 'none' selection of
 * NON-contiguous periods ("in 2020 en in 2022") is an explicit enumeration,
 * and neither trend pre-registration nor a connected line may imply the
 * unseen periods in the hole. Mixed/unparseable grains return false —
 * fail toward claiming less, never more. */
export function contiguousPeriodCodes(codes: string[]): boolean {
  const unique = [...new Set(codes)];
  if (unique.length < 2) return true;
  const parsed: ParsedPeriod[] = [];
  for (const code of unique) {
    const p = parsePeriodCode(code);
    if (!p || p.grain !== (parsed[0]?.grain ?? p.grain)) return false;
    parsed.push(p);
  }
  parsed.sort((a, b) => periodKey(a) - periodKey(b));
  const full = enumeratePeriods(parsed[0]!, parsed[parsed.length - 1]!);
  return full.length === parsed.length;
}

/** Enumerates the inclusive range from..to at one grain, ascending. */
export function enumeratePeriods(from: ParsedPeriod, to: ParsedPeriod): string[] {
  const codes: string[] = [];
  if (from.grain === 'JJ') {
    for (let y = from.year; y <= to.year; y++) codes.push(`${y}JJ00`);
    return codes;
  }
  const maxIndex = from.grain === 'KW' ? 4 : 12;
  let year = from.year;
  let index = from.index ?? 1;
  const endKey = periodKey(to);
  while (year * 100 + index <= endKey) {
    codes.push(`${year}${from.grain}${String(index).padStart(2, '0')}`);
    index++;
    if (index > maxIndex) {
      index = 1;
      year++;
    }
  }
  return codes;
}

async function fetchLabels(
  db: Db,
  tableId: string,
  dimension: string,
  codes: string[],
): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const result = await db.query(
    'select code, label from dimension_labels where table_id = $1 and dimension = $2 and code = any($3::text[])',
    [tableId, dimension, codes],
  );
  return new Map(result.rows.map((r) => [r.code as string, normalizeLabel(r.label as string)]));
}

interface TableRow {
  title: string;
  version: number;
  status: 'active' | 'needs_review';
  needsReviewReason: string | null;
  lastSyncAt: string | null;
  /** #196 (session 73): free-text registry cadence, threaded to the result. */
  updateCadence: string | null;
  expectedDimensions: { name: string; kind: string }[];
  defaultCoordinates: Record<string, string>;
  periodSemantics: Record<string, string> | null;
  slice: CbsSlice | null;
  units: Record<string, { unit: string; decimals: number; title: string }>;
}

async function fetchTable(db: Db, tableId: string): Promise<TableRow | null> {
  const result = await db.query('select * from cbs_tables where id = $1', [tableId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    title: normalizeLabel(row.title as string),
    version: Number(row.version),
    status: row.status as TableRow['status'],
    needsReviewReason: (row.needs_review_reason as string | null) ?? null,
    lastSyncAt: row.last_sync_at == null ? null : new Date(row.last_sync_at as string | Date).toISOString(),
    updateCadence: (row.update_cadence as string | null) ?? null,
    expectedDimensions: parseJsonb(row.expected_dimensions, []),
    defaultCoordinates: parseJsonb(row.default_coordinates, {}),
    periodSemantics: parseJsonb(row.period_semantics, null),
    slice: parseJsonb(row.slice, null),
    units: parseJsonb(row.units, {}),
  };
}

/** Lexicographic compare, matching sliceToFilter's `Perioden ge 'code'`
 * semantics (CBS period codes sort correctly as strings). */
function belowPeriodFloor(periodCode: string, floor: string | undefined): boolean {
  return floor !== undefined && periodCode < floor;
}

export async function resolveIntent(
  db: Db,
  intent: StructuredIntent,
  options: QueryOptions = {},
): Promise<ResolveOutcome> {
  // --- Structural validity -------------------------------------------------
  if (intent.schemaVersion !== INTENT_SCHEMA_VERSION) {
    return refuse(intent, 'invalid_intent', `unsupported intent schemaVersion ${intent.schemaVersion}; this query layer speaks version ${INTENT_SCHEMA_VERSION}`);
  }

  let parsedPeriods: { code: string; parsed: ParsedPeriod }[];
  if (intent.period.kind === 'codes') {
    if (intent.period.codes.length === 0) {
      return refuse(intent, 'invalid_intent', 'period.codes is empty', { axis: 'period' });
    }
    const parsed: { code: string; parsed: ParsedPeriod }[] = [];
    for (const code of intent.period.codes) {
      const p = parsePeriodCode(code);
      if (!p) return refuse(intent, 'invalid_intent', `"${code}" is not a CBS period code`, { axis: 'period' });
      parsed.push({ code, parsed: p });
    }
    const grains = new Set(parsed.map((p) => p.parsed.grain));
    if (grains.size > 1) {
      return refuse(intent, 'invalid_intent', `period codes mix grains (${[...grains].join(', ')}) — one grain per question`, { axis: 'period' });
    }
    if (new Set(parsed.map((p) => p.code)).size !== parsed.length) {
      return refuse(intent, 'invalid_intent', 'period.codes contains duplicates', { axis: 'period' });
    }
    parsedPeriods = [...parsed].sort((a, b) => periodKey(a.parsed) - periodKey(b.parsed));
  } else {
    const from = parsePeriodCode(intent.period.from);
    const to = parsePeriodCode(intent.period.to);
    if (!from || !to) {
      return refuse(intent, 'invalid_intent', `period range endpoint is not a CBS period code (from="${intent.period.from}", to="${intent.period.to}")`, { axis: 'period' });
    }
    if (from.grain !== to.grain) {
      return refuse(intent, 'invalid_intent', `period range mixes grains (${from.grain}..${to.grain})`, { axis: 'period' });
    }
    if (periodKey(from) > periodKey(to)) {
      return refuse(intent, 'invalid_intent', `period range runs backwards (${intent.period.from} > ${intent.period.to})`, { axis: 'period' });
    }
    parsedPeriods = enumeratePeriods(from, to).map((code) => ({
      code,
      parsed: parsePeriodCode(code)!,
    }));
  }
  const grain = parsedPeriods[0]!.parsed.grain;
  const periodCodes = parsedPeriods.map((p) => p.code);

  const regions = intent.regions ?? [];
  if (new Set(regions).size !== regions.length) {
    return refuse(intent, 'invalid_intent', 'regions contains duplicates', { axis: 'region' });
  }

  // --- Derivation arity (structural: can never be satisfied) ---------------
  // Phase 0 supports one varying axis per question: several periods at one
  // place, or several regions at one period — never both (**Assumption**,
  // mirrored in docs/open-questions.md; revisit with WP6 if a benchmark-shaped
  // question needs it).
  if (periodCodes.length > 1 && regions.length > 1) {
    return refuse(intent, 'invalid_intent', 'several regions AND several periods in one question is not supported (one varying axis per question)');
  }
  switch (intent.derivation) {
    case 'difference':
      if (periodCodes.length !== 2) {
        return refuse(intent, 'invalid_intent', `derivation "difference" needs exactly 2 periods, got ${periodCodes.length}`, { axis: 'derivation' });
      }
      if (regions.length > 1) {
        return refuse(intent, 'invalid_intent', 'derivation "difference" compares periods at one place — several regions given', { axis: 'derivation' });
      }
      break;
    case 'max':
      if (periodCodes.length !== 1 || regions.length < 2) {
        return refuse(intent, 'invalid_intent', `derivation "max" needs exactly 1 period and at least 2 regions, got ${periodCodes.length} period(s) and ${regions.length} region(s)`, { axis: 'derivation' });
      }
      break;
    case 'series':
      if (periodCodes.length < 2) {
        return refuse(intent, 'invalid_intent', `derivation "series" needs a multi-period selection, got ${periodCodes.length} period(s)`, { axis: 'derivation' });
      }
      break;
    case 'none':
      break;
    default:
      return refuse(intent, 'invalid_intent', `unknown derivation kind "${(intent as { derivation: string }).derivation}"`, { axis: 'derivation' });
  }

  // --- Target resolution ----------------------------------------------------
  let tableId: string;
  let measure: string;
  let semanticDims: Record<string, string>;
  let explicitDims: Record<string, string>;
  let definitionLabel: string | null;
  let definitionText: string | null;
  let alternates: AttributionAlternate[];
  if (intent.target.kind === 'canonical') {
    // definition_text (the real CBS blurb, #115 lever b, migration 014) is read
    // ONLY for on-demand-onboarded keys. This keeps the HOT seed-table path off
    // the new column entirely: a curated Phase-0 key never selects it, so the
    // dominant answer path cannot break if 014 is not yet applied (deploy-order
    // safe — the #114 class the review flagged). And the read is self-consistent:
    // an `onboarded:` key can only EXIST once onboarding-vocab.ts inserted it,
    // which requires the column — so this branch never hits a missing column.
    const onboarded = intent.target.key.startsWith('onboarded:');
    const cols = onboarded
      ? 'table_id, measure, measure_title, dims, definition_label, definition_text, alternates'
      : 'table_id, measure, measure_title, dims, definition_label, alternates';
    const result = await db.query(
      `select ${cols} from canonical_measures where key = $1`,
      [intent.target.key],
    );
    const row = result.rows[0];
    if (!row) {
      return refuse(intent, 'invalid_intent', `unknown canonical measure key "${intent.target.key}" — not in the registry's alias list`, { axis: 'measure' });
    }
    tableId = row.table_id as string;
    measure = row.measure as string;
    semanticDims = parseJsonb(row.dims, {});
    explicitDims = {};
    definitionLabel = row.definition_label as string;
    definitionText = onboarded ? ((row.definition_text as string | null) ?? null) : null;
    // #39: the alternates recorded on this SAME registry row. Defensive over
    // the JSONB shape (the registry writes it, but a row is forever): only
    // entries with a real label survive — a malformed entry is dropped, never
    // rendered (fail toward claiming less).
    alternates = parseJsonb<AttributionAlternate[]>(row.alternates, []).filter(
      (a): a is AttributionAlternate =>
        a != null && typeof a.label === 'string' && a.label.trim().length > 0,
    );
  } else {
    tableId = intent.target.tableId;
    measure = intent.target.measure;
    semanticDims = {};
    explicitDims = intent.target.dims ?? {};
    definitionLabel = null;
    definitionText = null;
    // Explicit targets chose their own coordinates — there is no registry
    // default whose non-chosen readings need disclosing.
    alternates = [];
  }

  // --- #196 (structural follow-up): from here on, every read is scoped to
  // `tableId`, and every one of them must not TEAR against a concurrent
  // `tables:evict --apply` of this exact table (src/ingestion/eviction.ts).
  // fetchTable, the per-dimension fetchLabels calls and the answer-first
  // national-default probe below are several SEPARATE autocommit statements
  // (no shared snapshot), so an eviction committing in any gap between them
  // used to surface as a fabricated table_not_registered/invalid_intent
  // instead of the honest "evicted mid-flight" outcome.
  //
  // The fix: a per-table Postgres advisory lock, taken SHARED here and
  // EXCLUSIVE by eviction's per-table transaction (evictStaleTables,
  // src/ingestion/eviction.ts) — "eviction yields to an in-flight read"
  // by construction, the direction the row #196 recorded and justified over a
  // marked-for-eviction grace state: a lock composes with the existing
  // per-table eviction transaction for free (advisory locks are already
  // transaction-scoped, no new schema, no new state machine), multiple
  // concurrent reads of the SAME table never block each other (SHARED —
  // eviction is the only EXCLUSIVE acquirer), and it needs no migration.
  // Wrapping the rest of this function in one transaction is what lets the
  // lock, which is transaction-scoped, span every read below instead of being
  // acquired and instantly released by its own autocommit statement.
  //
  // Why NOT the canonical_measures lookup above: `tableId` isn't known until
  // it returns, so there is nothing to lock yet — but that single statement
  // cannot itself be torn (Postgres MVCC), so it either sees the row fully
  // (pre-eviction, or eviction still uncommitted — see below) or fully misses
  // it (eviction already committed before this call even started, a cold
  // "unknown canonical measure key" — an honest fact, not a race artifact).
  return db.withTransaction(async (tx): Promise<ResolveOutcome> => {
    // #196: SHARED so concurrent reads of the same popular table never queue
    // behind each other; eviction's EXCLUSIVE acquisition (same key,
    // hashtext(tableId)) cannot proceed while any read holds this, and this
    // cannot proceed while eviction holds its EXCLUSIVE — matching the
    // codebase's existing pg_advisory_xact_lock(hashtext($1)) convention
    // (src/ingestion/pipeline.ts, src/billing/ledger.ts, trial-pot.ts,
    // onboarding-trigger.ts).
    //
    // #196 review round 2 — the coupling this key convention creates,
    // analyzed explicitly (a HIGH review of PR #128 found it disclosed only
    // for eviction.ts, not for the OTHER pre-existing EXCLUSIVE acquirer of
    // this exact key): src/ingestion/pipeline.ts's manual `ingest sync
    // --rebaseline` ALSO takes `pg_advisory_xact_lock(hashtext(tableId))`
    // (EXCLUSIVE, pipeline.ts's `if (rebaselined)` branch) inside its own
    // per-table transaction. Both
    // eviction and a rebaseline are therefore lock PEERS of this SHARED
    // acquisition, not just eviction — while either holds the EXCLUSIVE lock
    // on a table's key, a resolveIntent call for that SAME table waits here.
    // Confirmed harmless in the exact way eviction already was: `--rebaseline`
    // is CLI-only (src/ingestion/cli.ts's `--rebaseline` flag; the onboarding
    // cron's own `syncTable` call, src/ingestion/onboarding.ts:202, passes no
    // options and so never rebaselines) — manual and supervised, never
    // cron-driven, same as eviction.
    //
    // No lock_timeout, matching every advisory-lock acquisition in this
    // codebase except pipeline.ts's OWN 180s bound on ACQUIRING its exclusive
    // lock (pipeline.ts's `set local lock_timeout`, just above its own
    // acquisition) — that bound protects ITS OWN connection from
    // outliving the onboarding cron's 300s ceiling; it says nothing about how
    // long a call waiting ON that lock, like this one, may wait once
    // acquisition succeeds and the rebaseline's transaction is open. This is
    // a deliberate, not an accidental, omission: web/lib/deadline.ts
    // documents this codebase's live policy in so many words — a bounded
    // wait is applied to the two ANONYMOUS read paths only (the trial gate,
    // the Ontdek chart build; both already wrap their whole call in a 5 s
    // `withDeadline`, independently of any DB-level lock, so they degrade
    // regardless of what happens here) and is "deliberately NOT applied to
    // the paid path... those are exactly the money-path semantics the unset
    // timeout protects" — this resolveIntent call is that same paid path.
    // Adding a lock_timeout here would need new error handling with no
    // established pattern to follow (every existing advisory-lock caller in
    // this codebase — eviction.ts, billing/ledger.ts, trial-pot.ts,
    // onboarding-trigger.ts — relies on the same unbounded wait), so it stays
    // out of THIS surgical fix rather than being added speculatively without
    // its own tests. Both EXCLUSIVE acquirers are rare, manual, operator-
    // initiated actions (never cron), so an unbounded wait here is the same
    // accepted, bounded-by-operator-behavior risk eviction already carried —
    // now explicitly extended to cover pipeline.ts's rebaseline lock too.
    // Pinned: tests/query/resolve-eviction-race.test.ts's source-pin describe
    // block asserts pipeline.ts's rebaseline acquisition uses this identical
    // hashtext(tableId) key, so the two can never silently drift apart.
    await tx.query('select pg_advisory_xact_lock_shared(hashtext($1))', [tableId]);

    const table = await fetchTable(tx, tableId);
    if (!table) {
      // A canonical target only ever gets here via a canonical_measures row
      // THIS call already read successfully a moment ago (the `!row` branch
      // above returns before reaching this point) — and canonical_measures
      // rows cannot outlive their table's cbs_tables row under normal
      // operation (eviction deletes canonical_measures BEFORE cbs_tables, in
      // the same FK-safe transaction, src/ingestion/eviction.ts). So a
      // canonical target finding no table HERE, under the lock we now hold,
      // is provably the eviction we were racing — never a table that simply
      // never existed. Same kind and wording run.ts's own race window already
      // uses (tests/query/eviction-race.test.ts), so both windows read
      // identically to the caller. Explicit targets carry no such prior
      // evidence (no earlier read established this table ever existed), so
      // table_not_registered stays their answer, unchanged from before this
      // fix (pinned: tests/query/query.test.ts "an unregistered table
      // refuses as out of loaded scope").
      //
      // #196 review round 2 — **Assumption**, made explicit (open-questions
      // #196, mirrored there): this is a deliberate asymmetry with run.ts's
      // diagnoseMissing, which is target-kind-agnostic and returns
      // table_evicted for the identical race regardless of how the target
      // was named. It is safe ONLY because every explicit target actually
      // reachable in production names a PINNED table: src/chart/curated.ts
      // is the sole caller that ever constructs one (the alternate-reading
      // toggle, over the SAME table its primary canonical reading already
      // resolved — see the comment at its call site), and every curated
      // chart definition resolves to a table from the hand-curated pinned
      // seed set (`src/ingestion/registry-seed.ts`'s `SEED_TABLES`, pinned by
      // migration `025_table_eviction_lifecycle.sql`), which eviction.ts's own WHERE
      // clause exempts by construction (`cbs_tables.pinned = false`) — so an
      // explicit target can structurally never race an eviction at all
      // today, and this branch's table_not_registered is never actually
      // reachable via the #196 race, only via a genuinely-unregistered id.
      // Pinned: tests/chart/curated.test.ts asserts every curated chart's
      // resolved table carries `pinned = true`. If a future explicit-target
      // caller ever names a non-pinned (on-demand-onboarded) table, this
      // branch would need the SAME canonical-target treatment above — that
      // "prior evidence" would then exist via that caller's own earlier read,
      // same as the canonical branch's reasoning already documents.
      if (intent.target.kind === 'canonical') {
        return refuse(
          intent,
          'table_evicted',
          `table "${tableId}" was evicted while this query was in flight — it is no longer registered; the next question about it goes through the on-demand fetch again`,
          { axis: 'measure' },
        );
      }
      return refuse(intent, 'table_not_registered', `table "${tableId}" is not registered — out of the loaded Phase 0 scope`, { axis: 'measure' });
    }
    if (table.status === 'needs_review') {
      return refuse(intent, 'table_quarantined', `table "${tableId}" is quarantined pending review (${table.needsReviewReason ?? 'reason not recorded'}) — not served until it passes validation again`);
    }

    const measureMeta = table.units[measure];
    if (!measureMeta) {
      return refuse(intent, 'invalid_intent', `measure "${measure}" does not exist on table "${tableId}"`, { axis: 'measure' });
    }

    // --- Dimensions ------------------------------------------------------------
    const geoDimension = table.expectedDimensions.find((d) => d.kind === 'GeoDimension')?.name ?? null;
    const timeDimension = table.expectedDimensions.find((d) => d.kind === 'TimeDimension')?.name ?? 'Perioden';
    const plainDimensions = table.expectedDimensions.filter((d) => d.kind === 'Dimension').map((d) => d.name);

    // default (totaal) coordinates < canonical semantic dims < explicit dims
    const dims: Record<string, string> = { ...table.defaultCoordinates, ...semanticDims, ...explicitDims };
    for (const dim of Object.keys(dims)) {
      if (!plainDimensions.includes(dim)) {
        return refuse(intent, 'invalid_intent', `"${dim}" is not a dimension of table "${tableId}" (has: ${plainDimensions.join(', ') || 'none'})`, { axis: 'measure' });
      }
    }
    const unpinned = plainDimensions.filter((d) => dims[d] === undefined);
    const dimLabels: Record<string, string> = {};
    for (const [dim, code] of Object.entries(dims)) {
      const labels = await fetchLabels(tx, tableId, dim, [code]);
      const label = labels.get(code);
      if (label === undefined) {
        return refuse(intent, 'invalid_intent', `code "${code}" does not exist in dimension "${dim}" of table "${tableId}"`, { axis: 'measure' });
      }
      dimLabels[dim] = label;
    }

    // --- Regions ----------------------------------------------------------------
    let regionCodes: string[] = [''];
    let regionLabels: Record<string, string> = {};
    let regionMissing = false;
    let regionDefaulted = false;
    let effectiveIntent = intent;
    if (geoDimension) {
      if (regions.length === 0) {
        // WP26 mechanism B-region (ADR 024, safelist entry 1, owner-approved
        // session 23 + re-read session 56): a question that names no place, on a
        // measure that HAS a national figure, gets the national figure — with the
        // assumption said out loud and a one-click correction — instead of a
        // clarification round the user has to pay for.
        //
        // The default is allowed only because the NL total is a specific EXISTING
        // row, not a pick among competing places. So we check that it exists for
        // THIS measure at THIS coordinate before defaulting; when it does not, we
        // fall through to the clarification exactly as before. There is no branch
        // in which a national figure is invented.
        //
        // Deliberately NOT checked here: whether the requested PERIOD exists. A
        // missing period has its own honest refusal (freshness / not_published),
        // identical to what an explicitly-named region would get — the default
        // concerns the region axis and nothing else.
        //
        // A 'max' comparison cannot reach here at all: the derivation-arity check
        // above already refuses a max with fewer than two named regions, so a
        // comparison set is never defaulted. Verified, not assumed — pinned in
        // tests/answer/answer-first-region.test.ts.
        const nationalRow =
          options.answerFirstEnabled === true
            ? await tx.query(
                `select 1 from observations
                 where table_id = $1 and measure = $2 and dims = $3::jsonb and region_code = $4
                 limit 1`,
                [tableId, measure, JSON.stringify(dims), NATIONAL_REGION_CODE],
              )
            : null;
        if (nationalRow !== null && nationalRow.rows.length > 0) {
          const labels = await fetchLabels(tx, tableId, geoDimension, [NATIONAL_REGION_CODE]);
          const label = labels.get(NATIONAL_REGION_CODE);
          if (label !== undefined) {
            regionCodes = [NATIONAL_REGION_CODE];
            regionLabels = { [NATIONAL_REGION_CODE]: label };
            regionDefaulted = true;
            // R8: record the query we actually RAN, not the one we were asked.
            // The audit row, the intent hash and the reconstruction all read this
            // object, so the defaulted region is visible in every one of them.
            effectiveIntent = { ...intent, regions: [NATIONAL_REGION_CODE] };
          }
        }
        if (!regionDefaulted) regionMissing = true;
      } else {
        const labels = await fetchLabels(tx, tableId, geoDimension, regions);
        const unknown = regions.filter((r) => !labels.has(r));
        if (unknown.length > 0) {
          return refuse(intent, 'invalid_intent', `region code(s) ${unknown.join(', ')} do not exist in dimension "${geoDimension}" of table "${tableId}"`, { axis: 'region' });
        }
        regionCodes = [...regions];
        regionLabels = Object.fromEntries(regions.map((r) => [r, labels.get(r)!]));
      }
    } else if (regions.length > 0) {
      return refuse(intent, 'invalid_intent', `table "${tableId}" has no regional dimension, but the intent names region(s) ${regions.join(', ')}`, { axis: 'region' });
    }

    // --- Clarification: ALL unresolved user-facing axes in ONE refusal ----------
    // docs/05's failure table requires the single clarification round to cover
    // every unresolved axis at once (combined presets) — so this refusal must
    // name them all, never just the first one hit (principle c: no axis is ever
    // defaulted silently).
    if (unpinned.length > 0 || regionMissing) {
      const axes: ('measure' | 'region')[] = [];
      const parts: string[] = [];
      if (unpinned.length > 0) {
        axes.push('measure');
        parts.push(`dimension(s) ${unpinned.join(', ')} carry no coordinate (materially different readings exist)`);
      }
      if (regionMissing) {
        axes.push('region');
        parts.push(`no region is named (table is regional: ${geoDimension})`);
      }
      return refuse(intent, 'needs_clarification', `table "${tableId}": ${parts.join('; and ')} — these must be chosen, never defaulted silently`, { axis: axes[0], axes });
    }

    // --- Slice compatibility (docs/05: "outside the loaded slice" is its own
    // refusal, distinct from "not published by CBS") -----------------------------
    const slice = table.slice;
    if (slice) {
      for (const [dim, pinned] of Object.entries(slice.dimensionEquals ?? {})) {
        if (dims[dim] !== undefined && dims[dim] !== pinned) {
          return refuse(intent, 'outside_loaded_slice', `dimension "${dim}" is only loaded at coordinate "${pinned}" (asked: "${dims[dim]}") — CBS publishes more, but it is outside our ingested slice`, { axis: 'measure', nearestAlternative: pinned });
        }
      }
      for (const [dim, prefixes] of Object.entries(slice.dimensionPrefixes ?? {})) {
        if (dim === geoDimension) {
          for (const region of regionCodes) {
            if (!prefixes.some((p) => region.startsWith(p))) {
              return refuse(intent, 'outside_loaded_slice', `region "${region}" is outside the loaded slice of table "${tableId}" (loaded: ${prefixes.map((p) => `${p}…`).join(', ')})`, { axis: 'region' });
            }
          }
        } else if (dims[dim] !== undefined && !prefixes.some((p) => dims[dim]!.startsWith(p))) {
          return refuse(intent, 'outside_loaded_slice', `dimension "${dim}" coordinate "${dims[dim]}" is outside the loaded slice of table "${tableId}" (loaded: ${prefixes.map((p) => `${p}…`).join(', ')})`, { axis: 'measure' });
        }
      }
      for (const { code } of parsedPeriods) {
        if (belowPeriodFloor(code, slice.periodFloor)) {
          return refuse(intent, 'outside_loaded_slice', `period ${code} is before the loaded slice of table "${tableId}" (loaded from ${slice.periodFloor}) — CBS publishes earlier periods, but they are outside our ingested slice`, { axis: 'period', nearestAlternative: slice.periodFloor });
        }
      }
    }

    return {
      ok: true,
      resolved: {
        intent: effectiveIntent,
        regionDefaulted,
        tableId,
        measure,
        measureTitle: normalizeLabel(measureMeta.title),
        dims,
        dimLabels,
        regionCodes,
        regionLabels,
        geoDimension,
        timeDimension,
        periodCodes,
        grain,
        derivation: intent.derivation,
        definitionLabel,
        definitionText,
        alternates,
        table: {
          title: table.title,
          version: table.version,
          lastSyncAt: table.lastSyncAt,
          updateCadence: table.updateCadence,
          slice,
          periodSemantics: table.periodSemantics,
        },
      },
    };
  });
}
