// CBS/Eurostat chart co-pilot server action (co-pilot phase 3, session 114,
// Task 3). Own tiny file, mirroring chart-headline-actions.ts /
// dataset-copilot-actions.ts: chart.tsx imports only this, never
// web/app/actions.ts's much larger graph.
//
// The client's OWN spec is accepted here (rawSpec, never re-fetched
// server-side) — the same trust posture draftChartHeadline already uses for
// the identical reason: the model only ever sees LABELS drawn from it
// (respondToCbsChartEdit → parseCbsCopilotReply), and every command it
// proposes is re-validated by the card's own acceptReply()/validateCommand
// against the spec it is about to draw, before anything is dispatched. A
// forged spec can at worst make the model propose a command that the real
// card then drops as invalid — it can never make an invalid command apply.
'use server';

import { AnthropicLlmClient } from '../backend/answer/llm/client.ts';
import { chartSpecSchema } from '../backend/chart/schema.ts';
import { respondToCbsChartEdit } from '../backend/chart/copilot/respond.ts';
import { chargeAndRunChartEdit } from '../backend/billing/chart-edit-gate.ts';
import type { GatedChartEditResponse } from '../backend/billing/types.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { reportError } from '../lib/error-report.ts';
import { isUuid } from '../lib/trial.ts';

const MAX_MESSAGE_LENGTH = 500;

function guardMessage(message: string): void {
  if (typeof message !== 'string' || message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`input rejected: not a string within ${MAX_MESSAGE_LENGTH} chars`);
  }
}

const MAX_REQUEST_ID_LENGTH = 100;

function guardRequestId(requestId: string): void {
  if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > MAX_REQUEST_ID_LENGTH || !isUuid(requestId)) {
    throw new Error('input rejected: malformed requestId');
  }
}

export type AdjustCbsChartOutcome = GatedChartEditResponse | { kind: 'unauthenticated' } | { kind: 'invalid_spec' };

/**
 * One credited CBS/Eurostat chart edit (ADR 056, co-pilot phase 3). Returns
 * the gate's own result: a `reply` (chart/copilot/types.ts's CbsCopilotReply)
 * carrying `commands` the CLIENT then re-validates against the chart before
 * dispatching any of them (chart.tsx's applyCopilotOutcome) — this action
 * never decides what is applied, and never writes audit_answers.
 */
export async function adjustCbsChart(
  rawSpec: unknown,
  message: string,
  requestId: string,
  rawCapabilities: unknown,
): Promise<AdjustCbsChartOutcome> {
  guardMessage(message);
  guardRequestId(requestId);

  const userId = await currentUserId();
  if (userId === null) {
    return { kind: 'unauthenticated' };
  }

  const parsed = chartSpecSchema.safeParse(rawSpec);
  if (!parsed.success) {
    return { kind: 'invalid_spec' };
  }
  const spec = parsed.data;

  try {
    return await chargeAndRunChartEdit(getDb(), userId, requestId, () =>
      respondToCbsChartEdit({
        spec,
        message,
        capabilities: rawCapabilities,
        llmOptions: { client: new AnthropicLlmClient() },
      }),
    );
  } catch (error) {
    console.error('adjustCbsChart failed:', error);
    await reportError('adjustCbsChart', error, { requestId, userId });
    throw error;
  }
}
