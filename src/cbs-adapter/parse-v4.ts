// Pure parsing functions from raw CBS OData v4 response JSON to the contract
// types in ./types.ts. Shared by the live adapter (odata-v4.ts) and the
// fixture replay (fixture-source.ts) — the point is that both paths exercise
// this exact code (ADR 003). Every required field is checked and throws a
// descriptive Error when absent (docs/05-data-rules.md: loud, never silent).
import type {
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
    return { name, kind: kind as CbsDimensionKind };
  });
}

/** Parses MeasureCodes: [{ Identifier, Title, Unit, Decimals }]. Decimals may be null — defaults to 0. */
export function parseMeasures(raw: unknown): CbsMeasure[] {
  const rows = asValueArray(raw, 'MeasureCodes');
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
    return { code, title, unit, decimals };
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
    return { code, title, dimensionGroup, status, index };
  });
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
