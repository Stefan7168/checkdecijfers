// Pure parsing functions from raw CBS OData v4 response JSON to the contract
// types in ./types.ts. Shared by the live adapter (odata-v4.ts) and the
// fixture replay (fixture-source.ts) — the point is that both paths exercise
// this exact code (ADR 003). Every required field is checked and throws a
// descriptive Error when absent (docs/05-data-rules.md: loud, never silent).
import type {
  CbsCatalogEntry,
  CbsCode,
  CbsDimension,
  CbsDimensionKind,
  CbsMeasure,
  CbsObservationRow,
} from './types.ts';

const VALID_DIMENSION_KINDS: ReadonlySet<string> = new Set([
  'Dimension',
  'TimeDimension',
  'GeoDimension',
]);

function asValueArray(raw: unknown, resource: string): unknown[] {
  if (raw === null || typeof raw !== 'object' || !('value' in raw)) {
    throw new Error(`CBS ${resource} response is missing a 'value' array`);
  }
  const value = (raw as { value: unknown }).value;
  if (!Array.isArray(value)) {
    throw new Error(`CBS ${resource} response 'value' is not an array`);
  }
  return value;
}

function requireString(row: Record<string, unknown>, field: string, resource: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`CBS ${resource} row is missing required field '${field}': ${JSON.stringify(row)}`);
  }
  return value;
}

/** A string field that may be absent/null/empty — returns null in those cases,
 *  never throws. For catalog metadata where a missing blurb or status is a
 *  tolerable gap, not a corrupt row (unlike the required-field discipline). A
 *  non-string wire value is treated as absent (null), not silently stringified —
 *  "tolerable gap" semantics, never a silent reshape of unexpected data. */
export function optionalString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (typeof value !== 'string') return null;
  return value.length === 0 ? null : value;
}

/** Parses Dimensions: [{ Identifier, Title, Kind }]. */
export function parseDimensions(raw: unknown): CbsDimension[] {
  const rows = asValueArray(raw, 'Dimensions');
  return rows.map((entry) => {
    const row = entry as Record<string, unknown>;
    const name = requireString(row, 'Identifier', 'Dimensions');
    const kind = requireString(row, 'Kind', 'Dimensions');
    if (!VALID_DIMENSION_KINDS.has(kind)) {
      throw new Error(
        `CBS Dimensions row for '${name}' has unrecognized Kind '${kind}' (expected Dimension, TimeDimension or GeoDimension)`,
      );
    }
    // breadth step 3, Task 1: CBS's own 'Title' verbatim; '' when absent
    // (never guessed — principle c). Not required (unlike Identifier/Kind):
    // a missing title degrades the resolver's stated-default wording, it
    // does not corrupt the row.
    const title = optionalString(row, 'Title') ?? '';
    return { name, kind: kind as CbsDimensionKind, title };
  });
}

/** One CBS MeasureGroups row: `{ Id, Title, ParentId }` (Description/Index
 *  exist on the wire but are not needed to resolve a groupPath). */
export interface CbsMeasureGroup {
  id: string;
  title: string;
  parentId: string | null;
}

/** Parses MeasureGroups: [{ Id, Title, ParentId }]. `[]` when the table
 *  publishes none (an HTTP 404 or an empty list both normalize to this by
 *  the time they reach here — see odata-v4.ts / fixture-source.ts). Throws
 *  on a malformed document; the live adapter catches that and degrades to
 *  "groups unavailable" (final-review I2), the fixture source does not. */
export function parseMeasureGroups(raw: unknown): CbsMeasureGroup[] {
  const rows = asValueArray(raw, 'MeasureGroups');
  return rows.map((entry) => {
    const row = entry as Record<string, unknown>;
    const id = requireString(row, 'Id', 'MeasureGroups');
    const title = requireString(row, 'Title', 'MeasureGroups');
    const parentIdRaw = row.ParentId;
    const parentId =
      parentIdRaw === null || parentIdRaw === undefined ? null : String(parentIdRaw);
    return { id, title, parentId };
  });
}

/**
 * Resolves one measure's `MeasureGroupId` into a root -> leaf title path by
 * walking `ParentId` up to the root. Real CBS groups do nest (measured:
 * 86116NED has 2- and 3-level paths, e.g. "Personeel en ICT › Toegang tot
 * ICT-systeem van buitenaf › Biedt toegang tot"; 80590ned's do not). Never
 * throws (principle c: a missing or cyclic reference is a CBS-side data
 * quirk to degrade past, not a corrupt row to reject) —
 * - no `groupId` (measure has no group) -> `[]`.
 * - `groupId` not found in `groupsById` -> `[]` (the walk stops before it
 *   resolves anything).
 * - an ancestor `ParentId` not found -> the path stops there (whatever was
 *   resolved so far, root -> leaf).
 * - a `ParentId` cycle -> stops at the first repeated id.
 */
function resolveGroupPath(
  groupId: string | null,
  groupsById: ReadonlyMap<string, CbsMeasureGroup>,
): string[] {
  if (groupId === null) return [];
  const titles: string[] = [];
  const seen = new Set<string>();
  let current: string | null = groupId;
  while (current !== null) {
    if (seen.has(current)) break; // cycle guard: stop at the first repeat
    seen.add(current);
    const group = groupsById.get(current);
    if (!group) break; // dangling reference: stop with whatever resolved so far
    titles.unshift(group.title);
    current = group.parentId;
  }
  return titles;
}

/** Parses MeasureCodes: [{ Identifier, Title, Unit, Decimals, MeasureGroupId? }].
 *  Decimals may be null — defaults to 0. `groups` (breadth step 4b, Task 1) —
 *  the table's own parsed MeasureGroups, used to resolve each measure's
 *  `MeasureGroupId` into a root -> leaf `groupPath`; defaults to `[]` (every
 *  measure gets `groupPath: []`) so an existing bare call keeps working. */
export function parseMeasures(raw: unknown, groups: CbsMeasureGroup[] = []): CbsMeasure[] {
  const rows = asValueArray(raw, 'MeasureCodes');
  const groupsById = new Map(groups.map((g) => [g.id, g]));
  return rows.map((entry) => {
    const row = entry as Record<string, unknown>;
    const code = requireString(row, 'Identifier', 'MeasureCodes').trim();
    const title = requireString(row, 'Title', 'MeasureCodes');
    const unit = requireString(row, 'Unit', 'MeasureCodes');
    const decimalsRaw = row.Decimals;
    if (decimalsRaw !== null && decimalsRaw !== undefined && typeof decimalsRaw !== 'number') {
      throw new Error(
        `CBS MeasureCodes row for '${code}' has non-numeric Decimals: ${JSON.stringify(decimalsRaw)}`,
      );
    }
    const decimals = decimalsRaw === null || decimalsRaw === undefined ? 0 : decimalsRaw;
    const description = optionalString(row, 'Description') ?? '';
    const dataType = optionalString(row, 'DataType') ?? '';
    const measureGroupId = optionalString(row, 'MeasureGroupId');
    const groupPath = resolveGroupPath(measureGroupId, groupsById);
    return { code, title, unit, decimals, description, dataType, groupPath };
  });
}

/** Parses a {Dim}Codes response: [{ Identifier, Title, DimensionGroupId?, Status?, Index? }]. */
export function parseCodes(raw: unknown): CbsCode[] {
  const rows = asValueArray(raw, '{Dim}Codes');
  return rows.map((entry) => {
    const row = entry as Record<string, unknown>;
    const code = requireString(row, 'Identifier', '{Dim}Codes').trim();
    const title = requireString(row, 'Title', '{Dim}Codes');
    const dimensionGroup =
      row.DimensionGroupId === null || row.DimensionGroupId === undefined
        ? null
        : String(row.DimensionGroupId);
    const status =
      row.Status === null || row.Status === undefined ? null : String(row.Status);
    const indexRaw = row.Index;
    if (indexRaw !== null && indexRaw !== undefined && typeof indexRaw !== 'number') {
      throw new Error(
        `CBS {Dim}Codes row for '${code}' has non-numeric Index: ${JSON.stringify(indexRaw)}`,
      );
    }
    const index = indexRaw === null || indexRaw === undefined ? null : indexRaw;
    // Task 3a: `description` is set ONLY when CBS's Description is non-empty
    // after trim, so every existing parsed-code equality (tables that never
    // use it) stays byte-identical.
    const descriptionRaw = optionalString(row, 'Description');
    const description =
      descriptionRaw !== null && descriptionRaw.trim().length > 0 ? descriptionRaw : undefined;
    return description !== undefined
      ? { code, title, dimensionGroup, status, index, description }
      : { code, title, dimensionGroup, status, index };
  });
}

/**
 * Parses one Datasets catalog page into entries + the next page link (or null).
 * Wire shape: [{ Identifier, Title, Description?, Status?, DatasetType?,
 * Language?, Modified? }]. Identifier + Title are required (a row without them
 * is corrupt and throws, loud never silent); everything else is tolerated-when-
 * absent metadata. The Identifier is NEVER trimmed/normalized — it is the exact
 * id the data endpoints require and its casing is load-bearing (quirk #1).
 */
export function parseCatalogPage(
  raw: unknown,
): { entries: CbsCatalogEntry[]; nextLink: string | null } {
  const rows = asValueArray(raw, 'Datasets');
  const entries = rows.map((entry) => {
    const row = entry as Record<string, unknown>;
    const tableId = requireString(row, 'Identifier', 'Datasets');
    const title = requireString(row, 'Title', 'Datasets');
    return {
      tableId,
      title,
      summary: optionalString(row, 'Description') ?? '',
      status: optionalString(row, 'Status'),
      datasetType: optionalString(row, 'DatasetType'),
      language: optionalString(row, 'Language'),
      modified: optionalString(row, 'Modified'),
    };
  });

  const rawObj = raw as Record<string, unknown>;
  const nextLinkRaw = rawObj['@odata.nextLink'];
  const nextLink = typeof nextLinkRaw === 'string' ? nextLinkRaw : null;

  return { entries, nextLink };
}

/**
 * Parses one Observations page into rows + the next page link (or null).
 * `dimensionNames` (from Dimensions, in table order) drives which fields on
 * each row are read as coordinates — every coordinate value is trimmed
 * (catalog quirk #2: v3-sourced code padding).
 */
export function parseObservationsPage(
  raw: unknown,
  dimensionNames: string[],
): { rows: CbsObservationRow[]; nextLink: string | null } {
  const entries = asValueArray(raw, 'Observations');
  const rows = entries.map((entry) => {
    const row = entry as Record<string, unknown>;
    const measure = requireString(row, 'Measure', 'Observations').trim();

    const coordinates: Record<string, string> = {};
    for (const dim of dimensionNames) {
      coordinates[dim] = requireString(row, dim, 'Observations').trim();
    }

    const valueRaw = row.Value;
    if (valueRaw !== null && typeof valueRaw !== 'number') {
      throw new Error(
        `CBS Observations row for measure '${measure}' has non-numeric Value: ${JSON.stringify(valueRaw)}`,
      );
    }
    const value: number | null = valueRaw === undefined ? null : valueRaw;

    const valueAttributeRaw = row.ValueAttribute;
    const valueAttribute =
      valueAttributeRaw === null || valueAttributeRaw === undefined
        ? 'None'
        : String(valueAttributeRaw);

    const stringValueRaw = row.StringValue;
    const stringValue =
      stringValueRaw === null || stringValueRaw === undefined ? null : String(stringValueRaw);

    return { measure, coordinates, value, valueAttribute, stringValue };
  });

  const rawObj = raw as Record<string, unknown>;
  const nextLinkRaw = rawObj['@odata.nextLink'];
  const nextLink = typeof nextLinkRaw === 'string' ? nextLinkRaw : null;

  return { rows, nextLink };
}
