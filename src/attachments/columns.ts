// "Eigen data" attachments tier — shared column-lookup helpers. Extracted
// (code-review finding, session 84) after execute.ts and chart.ts were each
// found to carry byte-identical private copies of these two functions — the
// exact per-caller-drift failure mode the #203 precedent (instruct/schema.ts's
// file header) warns about for a different function.
import type { ColumnProfile, DatasetProfile } from './types.ts';

export function columnById(profile: DatasetProfile, id: string): ColumnProfile {
  const column = profile.columns.find((c) => c.id === id);
  if (column === undefined) {
    // instruct/schema.ts's allowlist already guarantees this never happens
    // for a validated instruction — a defensive check, not a user-facing path.
    throw new Error(`internal: column id '${id}' not found in profile (should have been validated)`);
  }
  return column;
}

export function columnIndex(id: string): number {
  return Number.parseInt(id.slice(1), 10);
}
