// WP-LOOK part (a2) (session 143, 2026-09-29, open-questions #351): the one
// token → stored chart lookup the embed route's METADATA and OPEN GRAPH IMAGE
// share. Same gates as the page itself (page.tsx keeps its own copy of these
// lines because it also needs the scatter / live-rerun / own-edits branches):
// a signed token, an existing audit record, an answer with a chart, not
// redacted. Anything else is `null` — the callers then render the neutral
// brand card / generic metadata, never an error and never a number.
import { isRedacted, loadAuditRecord } from '../../../backend/answer/audit/index.ts';
import { verifyEmbedToken } from '../../../backend/chart/embed-token.ts';
import { getChartHeadlinePublic } from '../../../backend/chart/headline-store.ts';
import type { ChartSpec } from '../../../backend/chart/types.ts';
import { getDb } from '../../../lib/db.ts';

export interface EmbedChart {
  spec: ChartSpec;
  /** The saved journalist headline (chart_headlines), if the reader drafted one. */
  headlineText: string | null;
}

export async function loadEmbedChart(token: string): Promise<EmbedChart | null> {
  const secret = process.env.EMBED_TOKEN_SECRET;
  if (!secret) return null;
  const auditId = verifyEmbedToken(token, secret);
  if (auditId === null) return null;
  const record = await loadAuditRecord(getDb(), auditId);
  if (record === null) return null;
  const response = record.response;
  if (response.kind !== 'answer' || response.chart === null || response.chart === undefined || isRedacted(response)) {
    return null;
  }
  const headlineText = await getChartHeadlinePublic(getDb(), auditId);
  return { spec: response.chart, headlineText };
}
