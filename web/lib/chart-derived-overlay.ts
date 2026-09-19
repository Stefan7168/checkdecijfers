// Chart co-pilot phase 4: orchestrates resolving each pending
// DerivedOverlayRequest (the command-log "recipe") into its real
// DerivationRecord via the server action — never storing the resolved
// number in the command log itself (spec §9's command-log rule). The
// requester is injected so this stays testable without mocking a Server
// Action module.
import type { DerivationRecord } from '../../src/query/types.ts';
import type { DerivedOverlayRequest } from './chart-commands.ts';
import type { RequestChartDerivationResponse } from '../app/chart-derivation-actions.ts';

export async function resolveDerivedOverlays(
  requests: DerivedOverlayRequest[],
  requester: (calcKind: 'difference' | 'mean', resultIds: string[]) => Promise<RequestChartDerivationResponse>,
): Promise<{ resolvedMap: Map<string, DerivationRecord>; refusals: Map<string, string> }> {
  const resolvedMap = new Map<string, DerivationRecord>();
  const refusals = new Map<string, string>();
  const settled = await Promise.all(requests.map(async (r) => [r.id, await requester(r.calcKind, r.resultIds)] as const));
  for (const [id, response] of settled) {
    if (response.ok) {
      resolvedMap.set(id, response.record);
    } else {
      refusals.set(id, response.reason || 'Unknown error');
    }
  }
  return { resolvedMap, refusals };
}
