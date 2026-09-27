// translateStalenessWarning — mirrors src/answer/respond/staleness.ts.
//
// Moved out of lines.ts (#296 part 2 Task 7, which re-exports it unchanged)
// into this import-free leaf so the web layer can translate a scatter
// answer's staleness lines at RENDER time (English for a scatter is derived
// from the stored Dutch, never stored — spec D7) without pulling lines.ts's
// query-barrel graph into the client bundle.

/** Inverse of staleness.ts's private cadenceWordsNl, for the three cadence
 * prefixes maxAgeDaysForCadence recognizes ('monthly'/'quarterly'/'yearly',
 * the registry's own English cadence text) — an unrecognized Dutch cadence
 * word (a shape checkStaleness itself never produces, but this function is
 * defensive per the task brief) makes the whole warning untranslatable. */
const CADENCE_EN: Record<string, string> = {
  maandelijks: 'monthly',
  'per kwartaal': 'quarterly',
  jaarlijks: 'yearly',
};

/** The warning's subject: the one-measure "deze tabel", or the scatter's
 * named table "de tabel {tableId} ({measureTitle})" (staleness.ts
 * namedTableNl; the title part is absent when the result had no cells). The
 * title match is greedy up to the LAST ") wordt normaal", so a measure title
 * that itself ends in a parenthesis ("… (euro)") stays whole. */
const SUBJECT = '(deze tabel|de tabel (\\S+)(?: \\((.+)\\))?)';

const STALENESS_PLAIN_RE = new RegExp(
  `^Let op: ${SUBJECT} wordt normaal (.+?) bijgewerkt door CBS, maar onze laatste synchronisatie was op (\\d{4}-\\d{2}-\\d{2}) — recentere cijfers kunnen inmiddels beschikbaar zijn\\.$`,
);
const STALENESS_RETAINED_RE = new RegExp(
  `^Let op: ${SUBJECT} wordt normaal (.+?) bijgewerkt door CBS, maar een deel van deze cijfers is door CBS sinds (\\d{4}-\\d{2}-\\d{2}) niet opnieuw bevestigd — recentere cijfers kunnen inmiddels beschikbaar zijn\\.$`,
);

/** The English name of the measure a NAMED warning is about, from the
 * caller's own context (a scatter card knows its axes) — or null when it has
 * no English name for it, which makes the warning untranslatable (never a
 * Dutch title inside English text). */
export type NamedMeasureEn = (tableId: string, measureTitle: string | null) => string | null;

/** "this table" / "table {id} ({English measure})", or null when the named
 * subject can't be rendered in English. */
function subjectEn(match: RegExpExecArray, namedMeasureEn: NamedMeasureEn | undefined): string | null {
  if (match[1] === 'deze tabel') return 'this table';
  // The named shape exists only on scatter answers, whose English is built at
  // render time with a resolver; without one it stays untranslatable, exactly
  // as before the named shape existed.
  if (namedMeasureEn === undefined) return null;
  const tableId = match[2]!;
  const title = match[3] ?? null;
  if (title === null) return `table ${tableId}`;
  const measure = namedMeasureEn(tableId, title);
  return measure === null ? null : `table ${tableId} (${measure})`;
}

/** Translates a `StalenessCheck.warning` string built by
 * src/answer/respond/staleness.ts's `checkStaleness`. Null when `dutch`
 * doesn't match either of the two known shapes, names a cadence word
 * `CADENCE_EN` has no entry for, or names a table (the scatter's
 * `namedTable` form) that `namedMeasureEn` can't name in English — never a
 * guess (principle c). One-measure callers pass no resolver: their
 * behaviour is byte-identical to before the named form existed. */
export function translateStalenessWarning(dutch: string, namedMeasureEn?: NamedMeasureEn): string | null {
  const plain = STALENESS_PLAIN_RE.exec(dutch);
  if (plain) {
    const subject = subjectEn(plain, namedMeasureEn);
    const cadenceEn = CADENCE_EN[plain[4]!];
    if (subject === null || cadenceEn === undefined) return null;
    return (
      `Note: CBS normally updates ${subject} ${cadenceEn}, but our last sync was on ${plain[5]} — ` +
      `more recent figures may now be available.`
    );
  }
  const retained = STALENESS_RETAINED_RE.exec(dutch);
  if (retained) {
    const subject = subjectEn(retained, namedMeasureEn);
    const cadenceEn = CADENCE_EN[retained[4]!];
    if (subject === null || cadenceEn === undefined) return null;
    return (
      `Note: CBS normally updates ${subject} ${cadenceEn}, but part of these figures has not been reconfirmed ` +
      `by CBS since ${retained[5]} — more recent figures may now be available.`
    );
  }
  return null;
}
