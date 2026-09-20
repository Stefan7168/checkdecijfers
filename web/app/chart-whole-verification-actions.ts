'use server';
// Chart co-pilot phase 5b (session 117, ADR 056, spec §11): the on-demand
// "verified whole" check behind the pie / stacked / 100%-stacked forms.
// Those forms draw a whole (a full circle, a full bar) the visible parts are
// claimed to add up to; this action is the ONE place that claim is checked
// against a real cell — the roster's own CBS-published parent total, read
// from OUR database (principle (b): never a live CBS call). It re-reads an
// ALREADY-AUDITED chart's own cells (the parts) and fetches exactly one more
// cell per period (the whole), then hands both to the pure check in
// src/query/whole-verification.ts. No new audit_answers row — like phase 4's
// difference/mean (chart-derivation-actions.ts, the file this one mirrors
// line for line), a view command, not a new answer. Nothing computed here is
// ever shown: the client plots only real cells either way (R5), and a
// refused period is simply not drawn (principle (c)).
//
// Checked independently per period (spec §11): a roster that verifies for
// most periods but whose newest total CBS has not published yet reports
// that one period as refused and every other as verified — the client omits
// exactly that period's stack (stacked / 100%-stacked) or refuses the whole
// form (pie, which only ever shows one period).
import { z } from 'zod';
import { isRedacted, loadAuditRecord } from '../../src/answer/audit/index.ts';
import { codesInGroups } from '../../src/query/region-set.ts';
import { parentCellRef, verifyPartsSumToWhole, type PartCell } from '../../src/query/whole-verification.ts';
import type { ResultCell } from '../../src/query/types.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { reportError } from '../lib/error-report.ts';

const requestSchema = z.object({
  kind: z.literal('answer'),
  id: z.number().int().positive(),
});
/** At most the widest window a chart can show — a region-set answer spans a
 * handful of periods, never sixty; the cap only bounds a malformed request. */
const periodCodesSchema = z.array(z.string().min(1)).min(1).max(60);

/** One period's verdict. Three of the `verified: false` reasons are the pure
 * check's own (`VerifyOutcome`, src/query/whole-verification.ts); the
 * fourth, `incomplete_roster`, is this action's own and is decided BEFORE
 * any arithmetic, from the audit row's stored roster coverage (final-review
 * fix, I1 — see the check below). The client maps each to its own
 * digit-free message key. */
export type WholePeriodOutcome =
  | { verified: true }
  | { verified: false; reason: 'withheld_member' | 'sum_mismatch' | 'missing_whole' | 'incomplete_roster' };

export type WholeVerificationOutcome =
  | { ok: true; periods: Record<string, WholePeriodOutcome> }
  | { ok: false; reason?: string };

export async function requestWholeVerification(rawKey: unknown, rawPeriodCodes: unknown): Promise<WholeVerificationOutcome> {
  try {
    const userId = await currentUserId();
    if (userId === null) return { ok: false };
    const key = requestSchema.safeParse(rawKey);
    if (!key.success) return { ok: false, reason: 'only a CBS/Eurostat chart can be verified this way' };
    const periodCodes = periodCodesSchema.safeParse(rawPeriodCodes);
    if (!periodCodes.success) return { ok: false };
    const db = getDb();
    const record = await loadAuditRecord(db, key.data.id);
    // Ownership + redaction check — the SAME check chart-derivation-actions.ts
    // and embed-actions.ts apply to this identical client-supplied-auditId
    // shape (session 115's real-bug-fix pattern, written in from the start
    // here rather than found late by a review). Without it, `id` is fully
    // guessable and the per-period verdicts below would let any signed-in
    // user probe which table/roster/period ANOTHER user's account asked
    // about — exactly what GDPR redaction exists to prevent.
    if (record === null || record.userId !== userId || isRedacted(record.response)) {
      return { ok: false, reason: 'this answer is not available' };
    }
    if (record.response.kind !== 'answer') return { ok: false, reason: 'this answer has no chart to verify' };
    // `chart` can be `undefined` (not `null`) on certain rows — same `?? null`
    // tolerance as the precedent's minor final-review fix.
    const spec = record.response.chart ?? null;
    if (spec === null) return { ok: false, reason: 'this answer has no chart to verify' };
    // Never trust the client's own idea of the roster: the scope is read
    // back from the STORED spec, and a chart built from anything but a
    // real region class (regionScope null / absent on pre-5b rows) has no
    // whole to verify — refuse, never guess a parent (principle (c)).
    const scope = spec.regionScope ?? null;
    if (scope === null) return { ok: false, reason: 'this chart was not built from a complete set of regions' };
    const parentRef = parentCellRef(scope);
    if (parentRef === null) return { ok: false, reason: 'this set of regions has no published total to check against' };

    // Final-review fix (I1): the roster must be COMPLETE before its parts can
    // be claimed to be the whole. A member with no observation row at all
    // (as opposed to a withheld one, which survives as a null-valued part
    // and trips `withheld_member` below) contributes no cell and no series —
    // it is simply absent, so the sum check cannot see it, and the only
    // thing between an incomplete roster and a false "verified" would be
    // the rounding tolerance. That is safe for provinces (the smallest is
    // ~2% of the national total) but NOT for gemeenten-in-provincie, where
    // a small municipality sits well inside max(0.5, 0.5%). The answer's
    // own prose already discloses such a gap ("Van 1 gemeente hebben wij
    // geen cijfer", src/answer/compose/format.ts); the chart card must not
    // contradict it with "Gecontroleerd". Same rule as deriveRegionRanking
    // (src/query/derivations.ts): a claim over an incomplete set is a claim
    // the data cannot support. The coverage is the audit row's OWN
    // `regionSet` (#253, src/query/run.ts), computed when the answer was
    // built and stored with it — present only on region-set answers, so a
    // missing key is read as "no coverage recorded" and refused too, never
    // assumed complete (principle (c)). Every requested period is refused:
    // the roster is one roster, whichever period is shown.
    const coverage = record.response.result.regionSet ?? null;
    if (coverage === null || !coverage.complete) {
      return { ok: true, periods: Object.fromEntries(periodCodes.data.map((p) => [p, { verified: false, reason: 'incomplete_roster' } as const])) };
    }

    // The parts: the chart's own already-verified cells at each requested
    // period — looked up in the audit row's OWN ResultCells by resultId (R1),
    // never rebuilt from the spec's display strings. Every part must be on
    // this chart, and every part must share one table/measure/dims (the
    // builder already refuses mixed coordinates; re-checked here because the
    // whole is fetched at exactly those coordinates).
    const cellByResultId = new Map<string, ResultCell>(record.response.result.cells.map((c) => [c.resultId, c]));
    const partsByPeriod = new Map<string, ResultCell[]>();
    for (const periodCode of periodCodes.data) {
      const parts: ResultCell[] = [];
      for (const s of spec.series) {
        for (const p of s.points) {
          if (p.periodCode !== periodCode) continue;
          const cell = cellByResultId.get(p.resultId);
          if (cell === undefined) return { ok: false, reason: 'one of those points is not on this chart' };
          parts.push(cell);
        }
      }
      if (parts.length === 0) return { ok: false, reason: 'one of those periods is not on this chart' };
      partsByPeriod.set(periodCode, parts);
    }
    const allParts = Array.from(partsByPeriod.values()).flat();
    const first = allParts[0]!;
    const dimsJson = JSON.stringify(first.dims);
    if (allParts.some((c) => c.tableId !== first.tableId || c.measure !== first.measure || JSON.stringify(c.dims) !== dimsJson)) {
      return { ok: false, reason: 'the parts of this chart do not share one table, measure and coordinates' };
    }

    // The whole's region code: a literal code (a province's own cell for a
    // gemeenten-in-provincie roster) or the single code of a CBS dimension
    // GROUP on this table's geo dimension (the 'NL' national total), read
    // through the SAME `codesInGroups` query region-set.ts resolves rosters
    // with. Anything but exactly one code is "no verifiable whole" for every
    // requested period — reported as `missing_whole`, the reader-facing
    // truth (there is no total to check against), never a crash.
    const wholeRegionCode = await resolveWholeRegionCode(db, first.tableId, parentRef);
    if (wholeRegionCode === null) {
      return { ok: true, periods: Object.fromEntries(periodCodes.data.map((p) => [p, { verified: false, reason: 'missing_whole' } as const])) };
    }

    // ONE statement, ONE snapshot for every requested period's whole (the
    // #196 convention runQuery follows for the parts themselves) — the same
    // coordinate columns runQuery's own fetch selects on.
    const { rows } = await db.query(
      `select period_code, value, decimals, value_attribute
         from observations
        where table_id = $1 and measure = $2 and dims = $3::jsonb
          and region_code = $4 and period_code = any($5::text[])`,
      [first.tableId, first.measure, dimsJson, wholeRegionCode, periodCodes.data],
    );
    const wholeByPeriod = new Map<string, PartCell>();
    for (const row of rows) {
      wholeByPeriod.set(String(row.period_code), {
        value: row.value == null ? null : toNumber(row.value),
        decimals: toNumber(row.decimals),
        valueAttribute: String(row.value_attribute),
      });
    }

    const periods: Record<string, WholePeriodOutcome> = {};
    for (const [periodCode, parts] of partsByPeriod) {
      periods[periodCode] = verifyPartsSumToWhole(parts, wholeByPeriod.get(periodCode) ?? null);
    }
    return { ok: true, periods };
  } catch (e) {
    await reportError('requestWholeVerification', e, {});
    return { ok: false };
  }
}

/** The region code the roster's whole lives at, or null when this table
 * cannot name exactly one. A 'code' ref is used as-is (it came from the
 * stored scope, which region-set.ts verified as a real province of this
 * table when the answer was built); a 'group' ref is resolved on the
 * table's own geo dimension (cbs_tables.expected_dimensions, the same
 * lookup resolve.ts makes), and must yield exactly ONE code — zero means
 * the table publishes no such total, two or more means the group is not
 * the single-cell total this check assumes. */
async function resolveWholeRegionCode(
  db: ReturnType<typeof getDb>,
  tableId: string,
  ref: NonNullable<ReturnType<typeof parentCellRef>>,
): Promise<string | null> {
  if (ref.kind === 'code') return ref.code;
  const { rows } = await db.query('select expected_dimensions from cbs_tables where id = $1', [tableId]);
  const raw = rows[0]?.expected_dimensions;
  const expected = (raw == null ? [] : typeof raw === 'string' ? JSON.parse(raw) : raw) as { name: string; kind: string }[];
  const geoDimension = expected.find((d) => d.kind === 'GeoDimension')?.name ?? null;
  if (geoDimension === null) return null;
  const codes = await codesInGroups(db, tableId, geoDimension, [ref.group]);
  return codes.length === 1 ? codes[0]! : null;
}

/** Same strictness as run.ts's own `toNumber`: a non-numeric value in a
 * numeric column is a data bug that must surface, never a silent NaN. */
function toNumber(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`non-numeric value from the database: ${String(value)}`);
  return n;
}
