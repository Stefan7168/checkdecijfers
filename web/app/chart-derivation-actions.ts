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
import { specCellsByResultId } from '../../src/chart/spec-cells.ts';
import type { DerivationRecord } from '../../src/query/types.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { reportError } from '../lib/error-report.ts';

const requestSchema = z.object({
  kind: z.literal('answer'),
  id: z.number().int().positive(),
});
const resultIdsSchema = z.array(z.string().min(1)).min(2).max(12);

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
    const record = await loadAuditRecord(getDb(), key.data.id);
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
    const result = calcKind === 'difference' ? deriveDifference(orderedCells) : deriveMean(orderedCells);
    return result.ok ? { ok: true, record: result.record } : { ok: false, reason: result.reason };
  } catch (e) {
    await reportError('requestChartDerivation', e, {});
    return { ok: false };
  }
}
