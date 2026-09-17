// #170(1) "make the guarantee visible": the source badge — one compact pill
// showing WHERE a number comes from (source + table id) and HOW FRESH our
// copy is (the MEASURED last-sync date, same YYYY-MM-DD form the R4 sentence
// shows — never a cadence promise like "wekelijks bijgewerkt", which would be
// aspirational wording the sketch explicitly rules out). Rendered from
// envelope/registry data only (R2: nothing here ever reaches an LLM prompt);
// the deep link reuses the pinned #86 builder so the badge cannot drift from
// the tested URL shape. One component for BOTH chat answers and charts
// (Ontdek included) — R4's "every source rides the one badge format".
//
// WP218 phase 4 (#219): only ever rendered from client components
// (chart.tsx, chat.tsx, user-chart.tsx) -- 'use client' + useT(), same as
// any other leaf under those boundaries. `sourceLinkLabel(key)` (the title
// attribute) is unlisted lib copy this sweep doesn't touch -- see the task
// report.
'use client';

import { resolveSource, sourceKeyForTableId } from '../backend/sources/registry.ts';
import { useT } from '../lib/i18n/lang-provider.tsx';
import { sourceLinkLabel, sourceTableUrl } from '../lib/statline.ts';
// #252 fix (session 110 UX audit pass 3, row 2): the actual definition now
// lives in the plain, directive-free web/lib/sync-date.ts so a server-only
// module (answer-proof.ts) can use it without importing this 'use client'
// component — re-exported here so this component's own JSX below and
// source-badge.test.tsx's existing `import { syncDateLabel } from
// './source-badge.tsx'` both keep working unchanged.
import { syncDateLabel } from '../lib/sync-date.ts';

export interface SourceBadgeProps {
  tableId: string;
  /** Source-registry key when the envelope carries one (answers); omit to
   * derive it from the table id (charts — ChartAttribution has no source
   * field; prefix-derivation is ADR 030's own id→source rule). */
  source?: string;
  /** ISO timestamp of OUR last successful sync; null/absent (old stored
   * envelopes) renders the badge without a date — shown is measured only. */
  syncedAt?: string | null;
}

export { syncDateLabel };

export function SourceBadge({ tableId, source, syncedAt }: SourceBadgeProps) {
  const t = useT();
  // An old/minimal replay envelope can lack a table id — render nothing
  // rather than a badge pointing nowhere (principle c: never guess).
  if (tableId === '') return null;
  const key = source ?? sourceKeyForTableId(tableId);
  const info = resolveSource(key);
  const date = syncDateLabel(syncedAt);
  const text = `${info.displayName} ${tableId}${date ? ` · ${t('sourceBadge.syncedLabel', { date })}` : ''}`;
  const url = sourceTableUrl(key, tableId);
  const pill =
    'inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground';
  if (url === null) return <span className={pill}>{text}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={sourceLinkLabel(key)}
      className={`${pill} underline-offset-2 hover:underline`}
    >
      {text}
      <span aria-hidden="true">↗</span>
    </a>
  );
}
