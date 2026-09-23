'use server';
// Chart co-pilot phase 4 (session 115, ADR 056, spec §9): re-runs a
// registered derivation (difference/mean) over an ALREADY-AUDITED chart's
// own cells, on demand. No CBS fetch, no new audit_answers row — the source
// cells were already fetched and verified once, when this chart's answer
// was first built; this only re-applies deterministic math to them (R5).
// CBS/Eurostat charts only (kind: 'answer') — an own-data chart already has
// its own aggregate/derive vocabulary (setInstruction, phase 2) and has no
// audit row for this to re-read.
import { z } from 'zod';
import { isRedacted, loadAuditRecord } from '../../src/answer/audit/index.ts';
import { deriveDifference, deriveMean } from '../../src/query/derivations.ts';
import { findEurostatWindowBreaks } from '../../src/query/window-breaks.ts';
import { EUROSTAT_SOURCE_KEY, sourceKeyForTableId } from '../../src/sources/registry.ts';
import { specCellsByResultId } from '../../src/chart/spec-cells.ts';
import type { DerivationRecord } from '../../src/query/types.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { reportError } from '../lib/error-report.ts';

const requestSchema = z.object({
  kind: z.literal('answer'),
  id: z.number().int().positive(),
});
// #292(b): distinct ids only — a repeated point would make a difference an
// automatic 0 and weigh a point twice in a mean; refused, never computed.
const resultIdsSchema = z.array(z.string().min(1)).min(2).max(12).refine((ids) => new Set(ids).size === ids.length);

// #316: the stable, translated refusal for a break BETWEEN the two compared
// periods (never on either endpoint itself — deriveDifference's own
// cell-level checkNoSeriesBreak already catches that case now that
// specCellsByResultId carries tableId/status). Mapped to NL/EN copy by
// KNOWN_DERIVATION_REFUSAL_KEYS (web/components/chart.tsx) — kept LITERAL so
// the chart-derivation-refusals.test.ts drift guard can pin it.
const EUROSTAT_WINDOW_BREAK_REASON = 'a Eurostat break in series lies between these points';
// Fail-closed (#316 requirement 2): the window lookup needs the query's
// measure, which a chart spec does not itself carry (unlike tableId/dims) —
// it is read back from the audited result's own cells by resultId. When it
// cannot be found for a Eurostat spec, this refuses rather than silently
// skip the break check; not mapped in KNOWN_DERIVATION_REFUSAL_KEYS, so a
// reader sees the generic fallback message — this should not happen for a
// well-formed audit row.
const EUROSTAT_MEASURE_UNDETERMINED_REASON =
  'cannot determine the Eurostat measure for this pair of points — refusing rather than skip the break check';

export type RequestChartDerivationResponse = { ok: true; record: DerivationRecord } | { ok: false; reason?: string };

export async function requestChartDerivation(
  rawKey: unknown,
  calcKind: 'difference' | 'mean',
  rawResultIds: unknown,
): Promise<RequestChartDerivationResponse> {
  try {
    const userId = await currentUserId();
    if (userId === null) return { ok: false };
    const key = requestSchema.safeParse(rawKey);
    if (!key.success) return { ok: false, reason: 'only a CBS/Eurostat chart can be re-derived this way' };
    const resultIds = resultIdsSchema.safeParse(rawResultIds);
    if (!resultIds.success) return { ok: false };
    const db = getDb();
    const record = await loadAuditRecord(db, key.data.id);
    // Ownership + redaction check — same as embed-actions.ts's createEmbedCode
    // for the identical client-supplied-auditId shape. Without this, `id` is
    // fully guessable (buildResultId is deterministic from public CBS
    // vocabulary), and the distinct refusal strings below would let any
    // signed-in user probe which table/region/period ANOTHER user's account
    // asked about — exactly what GDPR redaction exists to prevent.
    if (record === null || record.userId !== userId || isRedacted(record.response)) {
      return { ok: false, reason: 'this answer is not available' };
    }
    // Minor fix (final review): `record.response.chart` can be `undefined`
    // (not `null`) on certain rows — the old `=== null` check missed that
    // case and fell through to the generic catch/reportError path below
    // instead of this honest, specific refusal message.
    const spec = (record.response.kind === 'answer' ? record.response.chart : null) ?? null;
    if (spec === null) return { ok: false, reason: 'this answer has no chart to derive from' };
    const cellsByResultId = specCellsByResultId(spec);
    const cells = resultIds.data.map((id) => cellsByResultId.get(id));
    if (cells.some((c) => c === undefined)) return { ok: false, reason: 'one of those points is not on this chart' };
    const orderedCells = (cells as NonNullable<(typeof cells)[number]>[])
      // Code review finding (fix round 3): `deriveDifference` (src/query/derivations.ts)
      // documents and relies on its two cells arriving period-ordered —
      // `cells[0]` is treated as "earlier", `cells[1]` as "later", and the
      // returned value is `later.value - earlier.value`. This action built
      // `cells` straight from the CLIENT-supplied resultIds array (chart.tsx
      // sends [firstClickedResultId, secondClickedResultId]), with no sort —
      // a reader clicking the later period first would silently get a
      // sign-flipped difference. Sorting by periodCode here, once, fixes it
      // for both calcKinds (a no-op for `mean`, which is order-independent).
      .slice()
      .sort((a, b) => (a.periodCode < b.periodCode ? -1 : a.periodCode > b.periodCode ? 1 : 0));
    // #316: a Eurostat break BETWEEN the two compared periods is invisible to
    // deriveDifference's own cell-level check (it only ever sees these two
    // endpoints) — the same whole-window lookup run.ts's own query path uses
    // for a Eurostat difference (ADR 048 D5b, ruling R8) must run here too,
    // over the SAME two periods, before the mechanical subtraction. Mean
    // stays unguarded (ruling R6: a mean is not a cross-period comparison).
    // CBS specs never reach this block (their cells carry no tableId, or a
    // non-Eurostat one) — no query, byte-identical to before this change.
    if (calcKind === 'difference' && orderedCells.length === 2) {
      const [earlier, later] = orderedCells as [(typeof orderedCells)[number], (typeof orderedCells)[number]];
      if (
        earlier.tableId !== undefined &&
        earlier.regionCode === later.regionCode &&
        sourceKeyForTableId(earlier.tableId) === EUROSTAT_SOURCE_KEY
      ) {
        // Fix round 1 (#316): `null` here means "table with no geo dimension"
        // (run.ts: `regionCode: q.geoDimension ? regionCode : null`), NOT
        // "undetermined" — resolve.ts's own default/sentinel for such a
        // table's regionCodes is `['']` (used verbatim as the stored
        // `observations.region_code`), so this mirrors that convention
        // instead of refusing every geo-less Eurostat difference outright.
        const regionCode = earlier.regionCode ?? '';
        const resultCells = record.response.kind === 'answer' ? record.response.result.cells : [];
        const measure =
          resultCells.find((c) => c.resultId === earlier.resultId)?.measure ??
          resultCells.find((c) => c.resultId === later.resultId)?.measure;
        if (measure === undefined) {
          return { ok: false, reason: EUROSTAT_MEASURE_UNDETERMINED_REASON };
        }
        const windowBreaks = await findEurostatWindowBreaks(db, {
          tableId: earlier.tableId,
          measure,
          dims: spec.dims,
          regionCodes: [regionCode],
          periodCodes: [earlier.periodCode, later.periodCode],
        });
        if (windowBreaks.size > 0) {
          return { ok: false, reason: EUROSTAT_WINDOW_BREAK_REASON };
        }
      }
    }
    const result = calcKind === 'difference' ? deriveDifference(orderedCells) : deriveMean(orderedCells);
    return result.ok ? { ok: true, record: result.record } : { ok: false, reason: result.reason };
  } catch (e) {
    await reportError('requestChartDerivation', e, {});
    return { ok: false };
  }
}
