// Task 3a (docs/session-briefs plan "regional statistics part 1"): a strict,
// fail-closed reader of CBS's PROSE period notes.
//
// R11 (docs/05-data-rules.md) requires every served cell to state whether CBS
// calls it Definitief, Voorlopig or NaderVoorlopig. Almost every CBS table
// states this as a machine `Status` field on the Perioden code list, which
// `checkPeriodParsing` (src/ingestion/validate.ts) and the pipeline's
// `periodStatusByCode` lookup (src/ingestion/pipeline.ts) already handle. A
// small number of tables (70072ned is the first, Task 3) instead publish
// `Status: null` for every period and state provisionality in PROSE inside
// the period code's own `Description`:
//
//   "De cijfers in deze tabel zijn definitief tenzij is aangegeven in de
//   toelichting bij 'perioden' of 'onderwerp' dat ze voorlopig of nader
//   voorlopig zijn."
//
// with each period's Description then listing topics under
// "Uitkomsten zijn voorlopig over:" / "Uitkomsten zijn nader voorlopig over:".
//
// This module turns that prose into a per-(period, measure) status via the
// existing #251 per-cell status hook (`CbsObservationRow.status`,
// src/cbs-adapter/types.ts) — it never invents a status: every shape CBS's
// note does not conform to is a loud `{ ok: false, summary }` naming the
// period and the offending text (principle (c): never guess). The 70072ned
// `periodNoteStatus` config itself, and the pipeline wiring that calls
// `parsePeriodNotes`, are added by Task 3 / this task's pipeline.ts change
// respectively — this file is the generic, table-agnostic mechanism only.

import type { CbsCode } from '../cbs-adapter/types.ts';

/** A CBS publication status, as R11 / `isProvisionalStatus` expect it. */
type PublicationStatus = 'Definitief' | 'Voorlopig' | 'NaderVoorlopig';

export interface PeriodNoteStatusConfig {
  /** normalizeHeading(heading) → the served measure codes that heading
   * covers ([] = a known heading covering none of our served measures — kept
   * so CBS revisiting the note's wording doesn't newly trip rule 3). Every
   * code listed here must be in the table's served measure set (rule 5). */
  headings: Record<string, string[]>;
}

const SECTION_HEADERS: Record<string, PublicationStatus> = {
  'uitkomsten zijn voorlopig over:': 'Voorlopig',
  'uitkomsten zijn nader voorlopig over:': 'NaderVoorlopig',
};

/**
 * Normalizes one heading line from a CBS period note so both current-style
 * lines ("Nabijheid voorzieningen") and old-style bulleted lines
 * ("- uitkeringsontvangers;") land on the same key: trim, strip a leading
 * "-" bullet marker and the whitespace after it, strip one trailing ";" or
 * ".", collapse internal whitespace runs to a single space, lowercase.
 */
export function normalizeHeading(line: string): string {
  let s = line.trim();
  if (s.startsWith('-')) {
    s = s.slice(1).replace(/^\s+/, '');
  }
  s = s.replace(/[;.]$/, '');
  s = s.replace(/\s+/g, ' ');
  return s.trim().toLowerCase();
}

export type PeriodNoteParse =
  | { ok: true; statusOf(periodCode: string, measure: string): PublicationStatus }
  | { ok: false; summary: string };

/**
 * Parses every period's `Description` prose into a per-(period, measure)
 * status. See the module doc comment above for the shape CBS publishes and
 * this file's header comment for the enforced rules (task brief rules 1-7).
 */
export function parsePeriodNotes(
  periodCodes: CbsCode[],
  config: PeriodNoteStatusConfig,
  servedCodes: string[],
): PeriodNoteParse {
  // Rule 5: a config error (a heading naming a code we don't even serve) is
  // checked ONCE, up front, independent of any period's note content.
  const servedSet = new Set(servedCodes);
  for (const [heading, codes] of Object.entries(config.headings)) {
    for (const measureCode of codes) {
      if (!servedSet.has(measureCode)) {
        return {
          ok: false,
          summary:
            `periodNoteStatus config error: heading "${heading}" names measure code "${measureCode}", ` +
            `which is not in this table's served measure set.`,
        };
      }
    }
  }

  // Per period, the set of served measures each section covers.
  const perPeriodStatus = new Map<string, Map<string, PublicationStatus>>();

  for (const period of periodCodes) {
    // Rule 6: a period note is read ONLY when CBS has not (yet) supplied a
    // machine status for it — if it has, the config is now stale.
    if (period.status != null) {
      return {
        ok: false,
        summary:
          `CBS now publishes a machine-readable status for ${period.code}; ` +
          `remove the periodNoteStatus config and use it.`,
      };
    }

    const description = period.description;
    if (description === undefined || description.trim().length === 0) {
      // Rule 7 (last sentence): no note at all -> every measure Definitief.
      continue;
    }

    const measureStatus = new Map<string, PublicationStatus>();
    let currentSection: PublicationStatus | null = null;

    for (const rawLine of description.split(/\r\n|\r|\n/)) {
      const trimmed = rawLine.trim();
      if (trimmed.length === 0) continue;

      if (trimmed.endsWith(':')) {
        const status = SECTION_HEADERS[trimmed.toLowerCase()];
        if (status === undefined) {
          return {
            ok: false,
            summary: `${period.code}: unrecognised section header "${trimmed}" in CBS's period note.`,
          };
        }
        currentSection = status;
        continue;
      }

      // Rule 2: any non-empty line before the first recognised section
      // header means the note doesn't follow the structure this reader
      // understands.
      if (currentSection === null) {
        return {
          ok: false,
          summary:
            `${period.code}: unrecognised note structure — content before any recognised section ` +
            `header: "${trimmed}".`,
        };
      }

      // Rule 3: the heading must be one we've reviewed.
      const normalized = normalizeHeading(trimmed);
      const codesForHeading = config.headings[normalized];
      if (codesForHeading === undefined) {
        return {
          ok: false,
          summary:
            `${period.code}: CBS names a topic we have not reviewed: "${normalized}"; add it to the ` +
            `70072ned periodNoteStatus map after checking whether it covers a served figure.`,
        };
      }

      for (const measureCode of codesForHeading) {
        // Rule 4: the same served measure covered by both sections in one
        // period is a contradiction CBS's note itself would never intend.
        const existing = measureStatus.get(measureCode);
        if (existing !== undefined && existing !== currentSection) {
          return {
            ok: false,
            summary:
              `${period.code}: measure "${measureCode}" is covered by both the Voorlopig and ` +
              `NaderVoorlopig sections of CBS's period note.`,
          };
        }
        measureStatus.set(measureCode, currentSection);
      }
    }

    perPeriodStatus.set(period.code, measureStatus);
  }

  const statusOf = (periodCode: string, measure: string): PublicationStatus => {
    // Rule 7: the section status if a heading of that period covers the
    // measure, else CBS's stated default, Definitief.
    return perPeriodStatus.get(periodCode)?.get(measure) ?? 'Definitief';
  };

  return { ok: true, statusOf };
}
