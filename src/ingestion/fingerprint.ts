// Schema fingerprint (docs/05-data-rules.md, validation check 1): a stable
// hash over the shape of a table's schema, so a CBS redesign (renamed/added/
// removed dimension or measure) is detected even when row content still
// looks plausible.
import { createHash } from 'node:crypto';
import type { CbsDimension } from '../cbs-adapter/types.ts';

// Units are deliberately NOT part of this hash. A unit or decimals change
// must surface at the unit-consistency stage (check 5) so the failure names
// the precise reason ("unit changed from X to Y"), not a generic fingerprint
// mismatch. docs/05 groups units together with schema redesign risk, but the
// batch fails either way — this split only sharpens which summary the owner
// reads.
export function computeFingerprint(dimensions: CbsDimension[], measureCodes: string[]): string {
  const canonical = {
    dimensions: [...dimensions]
      .map((d) => ({ name: d.name, kind: d.kind }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    measures: [...measureCodes].sort((a, b) => a.localeCompare(b)),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
