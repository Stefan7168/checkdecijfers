// ADR 041 / spec Part B3 "Live" mode (Task 6): re-running a STORED
// StructuredIntent through the live query pipeline, days or weeks after it
// was first minted. `AuditRecord.intent` is typed `unknown | null` on purpose
// (src/answer/audit/types.ts: a "promoted" copy of freeform envelope JSON) —
// this module is the ONE place in the codebase that trusts it enough to call
// runQuery, so parseStoredIntent below validates it defensively BY HAND, the
// same style web/app/chart-style-actions.ts's own parseBrandApplied already
// established (never a bare cast; every field's type, and every
// discriminated union's `kind`, checked explicitly; any shape surprise
// returns null rather than throwing) — not a new zod schema; none exists for
// StructuredIntent yet and this plan doesn't add one.
//
// The design spec's own "WP26 click-take precedent" only established that a
// StructuredIntent minted MOMENTS AGO within the same turn is safe to feed
// straight into runQuery; it never covered loading one back out of a
// days-old audit row. No "load a stored intent and re-run it live" function
// existed anywhere in this codebase before this file (confirmed by direct
// code search) — rerunLive below is genuinely new, defensive code, not an
// extension of an existing pattern.
//
// rerunLive turns EVERY failure mode — a malformed/absent stored intent, a
// thrown error, a refusal outcome — into the same `null` signal, so the
// embed route's fallback-to-frozen logic is a single `if (spec === null)`
// check, never a try/catch the route itself has to reason about.
import { buildChartSpec } from './build.ts';
import type { ChartSpec } from './types.ts';
import { INTENT_SCHEMA_VERSION, runQuery } from '../query/index.ts';
import type { IntentDerivation, IntentPeriod, IntentTarget, StructuredIntent } from '../query/index.ts';
import type { Db } from '../db/types.ts';
import type { AuditRecord } from '../answer/audit/types.ts';

/** IntentTarget's 'explicit' member's optional `dims` — validated as a
 * plain, non-array object of string values whenever it is present at all
 * (an explicit `null` is treated as malformed, not "absent": a stored row
 * that serialized `dims: null` is a shape surprise, not an omission). */
function isValidDims(v: unknown): v is Record<string, string> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return Object.values(v).every((x) => typeof x === 'string');
}

function isValidTarget(v: unknown): v is IntentTarget {
  if (typeof v !== 'object' || v === null) return false;
  const t = v as Record<string, unknown>;
  if (t.kind === 'canonical') {
    return typeof t.key === 'string' && t.key.length > 0;
  }
  if (t.kind === 'explicit') {
    if (typeof t.tableId !== 'string' || t.tableId.length === 0) return false;
    if (typeof t.measure !== 'string' || t.measure.length === 0) return false;
    if (t.dims !== undefined && !isValidDims(t.dims)) return false;
    return true;
  }
  return false;
}

function isValidPeriod(v: unknown): v is IntentPeriod {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  if (p.kind === 'codes') {
    return (
      Array.isArray(p.codes) && p.codes.length > 0 && p.codes.every((c) => typeof c === 'string' && c.length > 0)
    );
  }
  if (p.kind === 'range') {
    return typeof p.from === 'string' && p.from.length > 0 && typeof p.to === 'string' && p.to.length > 0;
  }
  return false;
}

const VALID_DERIVATIONS: readonly IntentDerivation[] = ['none', 'difference', 'max', 'series'];

function isValidRegions(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Hand-rolled runtime validator for a STORED, untyped `AuditRecord.intent` —
 * the defensive style `web/app/chart-style-actions.ts`'s `parseBrandApplied`
 * already established in this codebase. Structural/type-level checks only
 * (right shape, right primitive types, right enum membership): it
 * deliberately does NOT re-validate business rules runQuery already owns
 * (whether a period code is a real CBS period, whether a canonical key
 * exists in the registry, whether a region is valid for a table) — those
 * stay `invalid_intent`/`table_not_registered`/etc. refusals inside runQuery
 * itself, exactly as they would for a freshly parsed intent. Any shape this
 * function has not explicitly recognized returns `null`; it never throws.
 */
export function parseStoredIntent(raw: unknown): StructuredIntent | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  if (r.schemaVersion !== INTENT_SCHEMA_VERSION) return null;

  const target = r.target;
  if (!isValidTarget(target)) return null;

  const period = r.period;
  if (!isValidPeriod(period)) return null;

  const derivation = r.derivation;
  if (typeof derivation !== 'string' || !VALID_DERIVATIONS.includes(derivation as IntentDerivation)) return null;

  const regions = r.regions;
  if (regions !== undefined && !isValidRegions(regions)) return null;

  return {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target,
    period,
    derivation: derivation as IntentDerivation,
    ...(regions !== undefined ? { regions } : {}),
  };
}

/**
 * Re-runs a stored audit row's intent through the LIVE query pipeline and
 * rebuilds its chart spec — the "Live" branch of the public embed route
 * (spec Part B3). Returns `null` on ANY failure: a malformed/absent stored
 * intent, a thrown error from runQuery (e.g. the database is unreachable), or
 * a refusal outcome (the table was evicted, the period is no longer
 * servable, an unknown canonical key, etc.) — the caller's fallback-to-frozen
 * logic never needs to distinguish these; a stale-but-honest frozen chart is
 * always the safe default over a broken or blank live one. Also returns
 * `null` when runQuery succeeds but the result shape carries no chart
 * (buildChartSpec's own 'single'/'derived' → null rule, ADR 014) — the exact
 * same case a freshly-produced answer already handles.
 *
 * `{ probe: true }` (src/query/run.ts's #195 discipline): a live embed
 * re-render is never a billed/served turn, so it must not bump the table's
 * `last_queried_at` eviction anchor — the same "only a DELIVERABLE read
 * counts as demand" rule dry-run.ts's echoServability already follows.
 *
 * `options.lang` mirrors the route's own resolved language
 * (web/lib/i18n/messages.ts's `Lang`, reproduced here as a bare 'nl' | 'en'
 * literal rather than imported: ⟨A3⟩'s mandatory layering rule —
 * src/threads/replay.ts's own header comment, "web/backend -> ../src means
 * src code cannot import web/lib/*" — forbids a src/ file from reaching into
 * web/lib). It is accepted only for call-site symmetry with the route
 * (`rerunLive(getDb(), record, { lang })`) and is never actually read here:
 * buildChartSpec's output, like every src/chart string, is unconditionally
 * Dutch regardless of the caller's language (build.ts's own file header).
 */
export async function rerunLive(
  db: Db,
  record: AuditRecord,
  options: { lang: 'nl' | 'en' },
): Promise<ChartSpec | null> {
  const intent = parseStoredIntent(record.intent);
  if (intent === null) return null;

  try {
    const outcome = await runQuery(db, intent, { probe: true });
    if (!outcome.ok) return null;
    return buildChartSpec(outcome);
  } catch {
    return null;
  }
}
