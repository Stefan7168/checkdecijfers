// Five ordered validation-pipeline checks (docs/05-data-rules.md, "Validation
// pipeline"). Each stage is a pure function: given fetched CBS data and the
// registry's current expectations, decide pass/fail. Failures are loud —
// every summary is plain language naming the offending items (dimension
// names, codes, measures, counts) so a non-developer owner can read what
// went wrong without opening a database console.
import type { CbsCode, CbsDimension, CbsMeasure, CbsObservationRow } from '../cbs-adapter/types.ts';
import { decimalsOf } from './decimals.ts';
import { computeFingerprint } from './fingerprint.ts';
import { parsePeriodCode } from './periods.ts';
import type { FailureStage } from './types.ts';

export type StageResult = { ok: true } | { ok: false; stage: FailureStage; summary: string };

/** cbs_tables.units shape: { [measureCode]: { unit, decimals, title, description? } }.
 * `description` is the verbatim CBS measure blurb (#115 lever b); like `title`
 * it is descriptive metadata — checkUnitConsistency below compares unit/decimals
 * only, so enriching it never trips the validation gate on re-sync. */
export type RegistryUnits = Record<
  string,
  { unit: string; decimals: number; title: string; description?: string }
>;

/** dimension_labels rows relevant to one table, keyed for lookup. */
export interface StoredLabel {
  dimension: string;
  code: string;
}

// ---------------------------------------------------------------------------
// 1. schema_fingerprint
// ---------------------------------------------------------------------------

export function checkSchemaFingerprint(
  fetchedDimensions: CbsDimension[],
  fetchedMeasureCodes: string[],
  expectedDimensions: { name: string; kind: string }[],
  registrySchemaFingerprint: string | null,
): StageResult {
  const fetchedSorted = [...fetchedDimensions]
    .map((d) => ({ name: d.name, kind: d.kind as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const expectedSorted = [...expectedDimensions].sort((a, b) => a.name.localeCompare(b.name));

  if (fetchedSorted.length !== expectedSorted.length) {
    return {
      ok: false,
      stage: 'schema_fingerprint',
      summary:
        `The table now has ${fetchedSorted.length} dimension(s) ` +
        `(${fetchedSorted.map((d) => d.name).join(', ') || 'none'}), ` +
        `but the registry expects ${expectedSorted.length} ` +
        `(${expectedSorted.map((d) => d.name).join(', ') || 'none'}). ` +
        `This looks like a CBS table redesign.`,
    };
  }
  for (let i = 0; i < fetchedSorted.length; i++) {
    const fetched = fetchedSorted[i]!;
    const expected = expectedSorted[i]!;
    if (fetched.name !== expected.name || fetched.kind !== expected.kind) {
      return {
        ok: false,
        stage: 'schema_fingerprint',
        summary:
          `Dimension "${expected.name}" (kind ${expected.kind}) is expected but the table now has ` +
          `"${fetched.name}" (kind ${fetched.kind}) instead. This looks like a CBS table redesign.`,
      };
    }
  }

  if (registrySchemaFingerprint != null) {
    const computed = computeFingerprint(fetchedDimensions, fetchedMeasureCodes);
    if (computed !== registrySchemaFingerprint) {
      return {
        ok: false,
        stage: 'schema_fingerprint',
        summary:
          `The table's schema fingerprint no longer matches what was recorded at registration ` +
          `(dimensions or measure codes changed shape). This looks like a CBS table redesign.`,
      };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// 2. row_plausibility
// ---------------------------------------------------------------------------

export function checkRowPlausibility(
  rows: CbsObservationRow[],
  registryUnits: RegistryUnits,
  lastRowCount: number | null,
  rowCountTolerance: number,
): StageResult {
  const rowCount = rows.length;
  if (rowCount === 0) {
    return {
      ok: false,
      stage: 'row_plausibility',
      summary: 'The sync fetched 0 rows. An empty table is not plausible; refusing to ingest.',
    };
  }

  if (lastRowCount != null && lastRowCount > 0) {
    const relativeChange = Math.abs(rowCount - lastRowCount) / lastRowCount;
    if (relativeChange > rowCountTolerance) {
      return {
        ok: false,
        stage: 'row_plausibility',
        summary:
          `Row count changed from ${lastRowCount} to ${rowCount} ` +
          `(${(relativeChange * 100).toFixed(1)}%), which is outside the allowed tolerance of ` +
          `${(rowCountTolerance * 100).toFixed(0)}%. This could be a truncated sync or a CBS change.`,
      };
    }
  }

  const duplicates = checkDuplicateCells(rows);
  if (!duplicates.ok) return duplicates;

  const measureCodesPresent = new Set(rows.map((r) => r.measure));
  const missingMeasures = Object.keys(registryUnits).filter((code) => !measureCodesPresent.has(code));
  if (missingMeasures.length > 0) {
    return {
      ok: false,
      stage: 'row_plausibility',
      summary: `No rows at all were fetched for measure code(s): ${missingMeasures.join(', ')}.`,
    };
  }

  const nullsAndStrings = checkNullsAndStrings(rows);
  if (!nullsAndStrings.ok) return nullsAndStrings;

  return { ok: true };
}

// The row_plausibility pieces that do not depend on the registry's row-count
// history or on every registered measure being present — shared, not copied,
// by checkRowPlausibility above (whole-table sync) and the slice cache
// (src/ingestion/slice-cache.ts, breadth step 2 Task 4), where a narrow
// per-question slice legitimately carries only some measures and has no
// "previous row count" to compare against. Extracted verbatim: same
// summaries, same order, so checkRowPlausibility's behaviour is unchanged.

function checkDuplicateCells(rows: CbsObservationRow[]): StageResult {
  // Duplicate cells (same measure + full coordinates twice) would corrupt the
  // upsert; an overlapping or double-fetched page must fail here, loudly.
  const seenKeys = new Set<string>();
  const duplicates: string[] = [];
  for (const row of rows) {
    const key = `${row.measure}\u0000${JSON.stringify(row.coordinates)}`;
    if (seenKeys.has(key)) {
      duplicates.push(`measure ${row.measure} at ${JSON.stringify(row.coordinates)}`);
    } else {
      seenKeys.add(key);
    }
  }
  if (duplicates.length > 0) {
    return {
      ok: false,
      stage: 'row_plausibility',
      summary:
        `${duplicates.length} cell(s) were fetched more than once (identical measure and ` +
        `coordinates) — either a corrupted or overlapping fetch, or CBS publishing several values ` +
        `under the same measure code (seen in 70072ned's v4 feed, ADR 061). Refusing rather than picking one. ` +
        `Examples: ${duplicates.slice(0, 3).join('; ')}.`,
    };
  }

  return { ok: true };
}

function checkNullsAndStrings(rows: CbsObservationRow[]): StageResult {
  // Null-with-CBS-reason rows (ValueAttribute other than 'None' on a null
  // Value) are valid rows, not failures (docs/05). Only null values that
  // carry NO reason (ValueAttribute 'None') are a data-quality problem.
  const badNulls: CbsObservationRow[] = [];
  const badStrings: CbsObservationRow[] = [];
  for (const row of rows) {
    if (row.value === null && row.valueAttribute === 'None') {
      badNulls.push(row);
    }
    if (row.stringValue !== null) {
      badStrings.push(row);
    }
  }

  if (badNulls.length > 0) {
    const examples = badNulls
      .slice(0, 5)
      .map((r) => `measure ${r.measure} at ${JSON.stringify(r.coordinates)}`)
      .join('; ');
    return {
      ok: false,
      stage: 'row_plausibility',
      summary:
        `${badNulls.length} row(s) have a null value with no CBS reason attached ` +
        `(ValueAttribute 'None'). Examples: ${examples}.`,
    };
  }

  if (badStrings.length > 0) {
    const examples = badStrings
      .slice(0, 5)
      .map((r) => `measure ${r.measure} at ${JSON.stringify(r.coordinates)} = "${r.stringValue}"`)
      .join('; ');
    return {
      ok: false,
      stage: 'row_plausibility',
      summary:
        `${badStrings.length} row(s) carry a non-null string value, which is unexpected for this ` +
        `table set. Examples: ${examples}.`,
    };
  }

  return { ok: true };
}

/**
 * row_plausibility for a slice-cache fetch: duplicate cells, reason-less
 * nulls and string values, in that order — exactly checkRowPlausibility's
 * own checks minus the empty-fetch refusal, the row-count tolerance and the
 * every-measure-present rule (a slice may legitimately return 0 rows or only
 * some measures: a requested cell CBS does not publish is a recorded "no
 * cell", not an error).
 */
export function checkSliceRowPlausibility(rows: CbsObservationRow[]): StageResult {
  const duplicates = checkDuplicateCells(rows);
  if (!duplicates.ok) return duplicates;
  return checkNullsAndStrings(rows);
}

// ---------------------------------------------------------------------------
// 3. period_parsing
// ---------------------------------------------------------------------------

export function checkPeriodParsing(
  rows: CbsObservationRow[],
  periodDimensionName: string,
  fetchedPeriodCodes: CbsCode[],
): StageResult {
  const distinctCodes = new Set<string>();
  for (const row of rows) {
    const code = row.coordinates[periodDimensionName];
    if (code !== undefined) distinctCodes.add(code);
  }

  const unparseable: string[] = [];
  for (const code of distinctCodes) {
    if (parsePeriodCode(code) === null) unparseable.push(code);
  }

  if (unparseable.length > 0) {
    return {
      ok: false,
      stage: 'period_parsing',
      summary: `${unparseable.length} period code(s) could not be parsed: ${unparseable.slice(0, 10).join(', ')}.`,
    };
  }

  // Every observed period must be in the published period list AND carry a
  // publication status — status is required per observation (invariant R11);
  // defaulting a missing one would be a guess (principle (c)).
  const statusByCode = new Map<string, string | null>();
  for (const code of fetchedPeriodCodes) statusByCode.set(code.code, code.status);

  // Task 3a (#251 per-cell status hook): a period whose MACHINE status is
  // null is acceptable iff every row in that period already carries a
  // per-cell `status` (set by the pipeline BEFORE this check runs, from
  // either an adapter's own per-cell statuses or, for CBS, a
  // `periodNoteStatus` prose-note reader — src/ingestion/period-note-status.ts).
  // A statusless period with even one row lacking a per-cell status is still
  // the loud failure below: nothing here defaults a missing status.
  const needsPerCellCheck = new Set<string>();
  for (const code of distinctCodes) {
    if (statusByCode.has(code) && statusByCode.get(code) == null) needsPerCellCheck.add(code);
  }
  const perCellStatusOk = new Map<string, boolean>();
  for (const code of needsPerCellCheck) perCellStatusOk.set(code, true);
  for (const row of rows) {
    const code = row.coordinates[periodDimensionName];
    if (code === undefined || !needsPerCellCheck.has(code)) continue;
    const hasStatus = typeof row.status === 'string' && row.status.trim().length > 0;
    if (!hasStatus) perCellStatusOk.set(code, false);
  }

  const unpublished: string[] = [];
  const statusless: string[] = [];
  for (const code of distinctCodes) {
    if (!statusByCode.has(code)) {
      unpublished.push(code);
    } else if (statusByCode.get(code) == null && !perCellStatusOk.get(code)) {
      statusless.push(code);
    }
  }

  if (unpublished.length > 0) {
    return {
      ok: false,
      stage: 'period_parsing',
      summary:
        `${unpublished.length} period code(s) appear in the data but not in the table's ` +
        `published period list: ${unpublished.slice(0, 10).join(', ')}.`,
    };
  }
  if (statusless.length > 0) {
    return {
      ok: false,
      stage: 'period_parsing',
      summary:
        `${statusless.length} period(s) carry no publication status ` +
        `(Definitief/Voorlopig/NaderVoorlopig): ${statusless.slice(0, 10).join(', ')}. ` +
        `Every ingested value must state whether it is provisional; refusing to guess.`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// 4. dimension_mapping
// ---------------------------------------------------------------------------

export function checkDimensionMapping(
  rows: CbsObservationRow[],
  fetchedDimensions: CbsDimension[],
  registryUnits: RegistryUnits,
  storedLabels: StoredLabel[],
  fetchedCodesByDimension: Record<string, CbsCode[]>,
  acceptNewCodes: boolean,
): StageResult {
  const storedByDim = new Map<string, Set<string>>();
  for (const label of storedLabels) {
    let set = storedByDim.get(label.dimension);
    if (!set) {
      set = new Set();
      storedByDim.set(label.dimension, set);
    }
    set.add(label.code);
  }

  // Every observation coordinate must resolve: measure codes against
  // registry units, every other dimension coordinate against stored labels.
  const unknownMeasures = new Set<string>();
  const unknownByDim = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!(row.measure in registryUnits)) unknownMeasures.add(row.measure);
    for (const dim of fetchedDimensions) {
      const code = row.coordinates[dim.name];
      if (code === undefined) continue;
      const known = storedByDim.get(dim.name);
      if (!known || !known.has(code)) {
        let set = unknownByDim.get(dim.name);
        if (!set) {
          set = new Set();
          unknownByDim.set(dim.name, set);
        }
        set.add(code);
      }
    }
  }

  if (unknownMeasures.size > 0) {
    return {
      ok: false,
      stage: 'dimension_mapping',
      summary: `Observation(s) use measure code(s) not in the registry: ${[...unknownMeasures].join(', ')}.`,
    };
  }
  if (unknownByDim.size > 0 && !acceptNewCodes) {
    const parts = [...unknownByDim.entries()].map(
      ([dim, codes]) => `${dim}: ${[...codes].slice(0, 10).join(', ')}`,
    );
    return {
      ok: false,
      stage: 'dimension_mapping',
      summary:
        `Observation(s) use dimension code(s) not yet mapped in dimension_labels — ${parts.join('; ')}. ` +
        `New codes appear via reviewed mapping updates, not silently.`,
    };
  }

  // Also: fetched code lists vs stored labels. Codes present in fetched
  // lists but absent from stored labels fail unless acceptNewCodes.
  const newCodesByDim = new Map<string, string[]>();
  for (const [dim, codes] of Object.entries(fetchedCodesByDimension)) {
    const known = storedByDim.get(dim) ?? new Set<string>();
    const missing = codes.map((c) => c.code).filter((code) => !known.has(code));
    if (missing.length > 0) newCodesByDim.set(dim, missing);
  }

  if (newCodesByDim.size > 0 && !acceptNewCodes) {
    const parts = [...newCodesByDim.entries()].map(
      ([dim, codes]) => `${dim}: ${codes.slice(0, 10).join(', ')}`,
    );
    return {
      ok: false,
      stage: 'dimension_mapping',
      summary:
        `CBS now publishes code(s) not yet in our dimension_labels — ${parts.join('; ')}. ` +
        `New codes appear via reviewed mapping updates, not silently.`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// 5. unit_consistency
// ---------------------------------------------------------------------------

export function checkUnitConsistency(fetchedMeasures: CbsMeasure[], registryUnits: RegistryUnits): StageResult {
  const fetchedByCode = new Map(fetchedMeasures.map((m) => [m.code, m]));
  const problems: string[] = [];

  for (const [code, registered] of Object.entries(registryUnits)) {
    const fetched = fetchedByCode.get(code);
    if (!fetched) {
      problems.push(`measure ${code} (registered unit "${registered.unit}") is no longer published by CBS`);
      continue;
    }
    if (fetched.unit !== registered.unit || fetched.decimals !== registered.decimals) {
      problems.push(
        `measure ${code}: registry has unit "${registered.unit}" (${registered.decimals} decimals), ` +
          `CBS now publishes unit "${fetched.unit}" (${fetched.decimals} decimals)`,
      );
    }
  }
  for (const code of fetchedByCode.keys()) {
    if (!(code in registryUnits)) {
      const fetched = fetchedByCode.get(code)!;
      problems.push(`measure ${code} (unit "${fetched.unit}") is new and not yet in the registry`);
    }
  }

  if (problems.length > 0) {
    return {
      ok: false,
      stage: 'unit_consistency',
      summary: `Unit/measure mismatch vs. the registry: ${problems.join('; ')}.`,
    };
  }

  return { ok: true };
}

/**
 * #357 (a), for a source whose decimals are learned from observed values, never stated (Eurostat;
 * `SourceInfo.decimalsFromObservedValues`): every fetched value must carry AT MOST the registered number of
 * decimals. A value with more means the registration saw fewer decimals than the source now publishes — a real
 * change in how the unit is published. It fails `unit_consistency` (the caller quarantines the table for review)
 * and nothing is stored: the value is never rounded to fit, and the registered decimals are never raised
 * silently. Fewer decimals than registered is normal (JSON drops trailing zeros: 2.50 arrives as 2.5) and passes.
 * A null value (not published, confidential) carries nothing to check.
 */
export function checkObservedDecimals(rows: CbsObservationRow[], registryUnits: RegistryUnits): StageResult {
  const problems: string[] = [];
  let count = 0;
  for (const row of rows) {
    if (row.value === null) continue;
    // An unregistered measure is not this check's to judge (the request validation refuses it first).
    if (!Object.hasOwn(registryUnits, row.measure)) continue;
    const registered = registryUnits[row.measure]!;
    const carried = decimalsOf(row.value);
    if (carried <= registered.decimals) continue;
    count++;
    if (problems.length < 3) {
      problems.push(
        `measure ${row.measure} at ${JSON.stringify(row.coordinates)}: ${row.value} carries ${carried} decimals, ` +
          `registered with ${registered.decimals}`,
      );
    }
  }
  if (count === 0) return { ok: true };
  return {
    ok: false,
    stage: 'unit_consistency',
    summary:
      `${count} fetched value(s) carry more decimals than the table was registered with — the source now publishes ` +
      'more precision than the registration observed, so nothing is stored or rounded until the table is reviewed ' +
      `and re-registered. Examples: ${problems.join('; ')}.`,
  };
}
