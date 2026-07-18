// #170(1) "make the guarantee visible": the source badge — one compact pill
// showing WHERE a number comes from (source + table id) and HOW FRESH our
// copy is (the MEASURED last-sync date, same YYYY-MM-DD form the R4 sentence
// shows — never a cadence promise like "wekelijks bijgewerkt", which would be
// aspirational wording the sketch explicitly rules out). Rendered from
// envelope/registry data only (R2: nothing here ever reaches an LLM prompt);
// the deep link reuses the pinned #86 builder so the badge cannot drift from
// the tested URL shape. One component for BOTH chat answers and charts
// (Ontdek included) — R4's "every source rides the one badge format".
import { resolveSource, sourceKeyForTableId } from '../backend/sources/registry.ts';
import { sourceTableUrl } from '../lib/statline.ts';

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

/** The measured date part of an ISO sync timestamp, or null when absent or
 * unparseable — never a guessed or reformatted date (principle c). */
export function syncDateLabel(syncedAt: string | null | undefined): string | null {
  if (!syncedAt) return null;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(syncedAt);
  return match ? match[0] : null;
}

export function SourceBadge({ tableId, source, syncedAt }: SourceBadgeProps) {
  // An old/minimal replay envelope can lack a table id — render nothing
  // rather than a badge pointing nowhere (principle c: never guess).
  if (tableId === '') return null;
  const key = source ?? sourceKeyForTableId(tableId);
  const info = resolveSource(key);
  const date = syncDateLabel(syncedAt);
  const text = `${info.displayName} ${tableId}${date ? ` · gesynchroniseerd ${date}` : ''}`;
  const url = sourceTableUrl(key, tableId);
  const pill =
    'inline-flex items-center gap-1 rounded-full bg-paper-sunken px-2 py-0.5 text-xs text-ink-soft';
  if (url === null) return <span className={pill}>{text}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Bekijk bij ${info.attributionLabel}`}
      className={`${pill} underline-offset-2 hover:underline`}
    >
      {text}
      <span aria-hidden="true">↗</span>
    </a>
  );
}
