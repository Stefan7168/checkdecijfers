// Auto-generated registry vocabulary for an on-demand-onboarded table (WP16
// sub-part 2, ADR 026, design §3.6). After the fetch job registers + syncs a
// discovered table, this derives canonical_measures rows from the ingested CBS
// measure metadata so the delivery re-run can actually resolve a question
// against the new table.
//
// SAFETY (design §8 risk 1): this NEVER produces a number. It only inserts
// vocabulary rows; the delivery re-run then flows through the FULL existing
// pipeline (parse → resolve → query → validate → compose → audit). A bad
// vocabulary row can only yield a refusal/clarification → refund, never a wrong
// figure — the delivery-must-answer gate (§0.4) is the containment. R10 spirit:
// definition labels are CBS's OWN measure titles, verbatim, never invented.
//
// v1 SCOPE (recorded as a deviation in the HANDOFF): only measures whose
// ingested observations sit at the EMPTY coordinate (dims = {}) are registered.
// A measure that exists only at a non-'totaal' sub-coordinate cannot be
// answered under a {} default without guessing which sub-code is the "total"
// (principle c) — so it is skipped here rather than registered to a
// coordinate that would dead-end in a refund. The delivery-must-answer gate
// makes this honest: an un-registerable measure simply isn't offered.
import type { Db } from '../db/types.ts';
import type { OnboardedMeasure } from '../answer/intent/prompt.ts';
import type { CanonicalMeasure } from '../registry/types.ts';

/** Key prefix for auto-onboarded canonical measures — namespaced by table +
 * measure so it can never collide with a curated Phase-0 key (design §3.6). */
export function onboardedKey(tableId: string, measureCode: string): string {
  return `onboarded:${tableId}:${measureCode}`;
}

interface UnitMeta {
  unit: string;
  decimals: number;
  title: string;
  /** Verbatim CBS measure blurb, when captured at ingest (#115 lever b). */
  description?: string;
}

/**
 * Distil a CBS measure `Description` into the definition the answer shows,
 * WITHOUT rewriting a single word (principle a — CBS's own text or nothing):
 *   1. keep the WHOLE blurb — NEVER drop a block. The real definition (and its
 *      scale) can live in a LATER block after a short preamble, e.g.
 *      consumentenvertrouwen opens "Indicator van het Consumentenvertrouwen. Dit
 *      is de oorspronkelijke, niet-gecorrigeerde reeks.\n\nDe indicator kan een
 *      waarde aannemen van -100 tot +100 ...". An earlier "first block only" cut
 *      dropped exactly that substance — caught in live verification (#115). CBS
 *      may append related-concept glossary blocks too; keeping them is verbatim
 *      CBS text and better than risking the definition itself.
 *   2. drop a leading line that merely echoes the measure title (CBS often opens
 *      with the title verbatim, e.g. "Uitgesproken faillissementen\nHet aantal
 *      ...") — it would read as a stutter next to the answer's own subject.
 *   3. collapse internal whitespace/newlines to single spaces so it renders as
 *      one flowing paragraph.
 * Returns null when nothing usable remains (no blurb, or it was only the title
 * echo) — the composer then omits the "Definitie:" line entirely.
 */
export function cleanCbsDefinition(description: string, title: string): string | null {
  // Trailing sentence punctuation is ignored when matching against the title, so
  // a leading line like "Consumentenvertrouwen." is still recognized as the title
  // echo and stripped (review finding: exact equality missed a punctuated echo).
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '').trim().toLowerCase();
  const lines = description
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length > 1 && norm(lines[0]!) === norm(title)) {
    lines.shift();
  }
  const cleaned = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0 || norm(cleaned) === norm(title)) return null;
  return cleaned;
}

/** What one measure looks like in the ingested observations of a table: which
 * grains it has AT THE EMPTY COORDINATE, whether the table has a geo axis, and
 * whether ANY row for this measure sits at dims = {}. Only measures with an
 * empty-coordinate presence are registerable (see v1 scope above). */
interface MeasureShape {
  measure: string;
  grains: ('JJ' | 'KW' | 'MM')[];
  hasEmptyDims: boolean;
  regional: boolean;
}

async function measureShapes(db: Db, tableId: string): Promise<MeasureShape[]> {
  // Grains present at the empty coordinate (dims = {}), per measure — this is
  // exactly the coordinate resolve.ts's availableGrains/latestPeriod query when
  // default_coordinates and canonical dims are both empty.
  const grainRows = await db.query(
    `select measure, period_grain
       from observations
      where table_id = $1 and dims = '{}'::jsonb
      group by measure, period_grain`,
    [tableId],
  );
  const grainsByMeasure = new Map<string, Set<'JJ' | 'KW' | 'MM'>>();
  for (const r of grainRows.rows) {
    const m = r.measure as string;
    let set = grainsByMeasure.get(m);
    if (!set) {
      set = new Set();
      grainsByMeasure.set(m, set);
    }
    set.add(r.period_grain as 'JJ' | 'KW' | 'MM');
  }

  // Does this table carry a geo dimension at all? (For the prompt's regio line
  // and — future — regional onboarding. v1 registers measures at dims={} only;
  // a geo table's non-national rows aren't offered under a {} default.)
  const geoRow = await db.query(
    `select expected_dimensions from cbs_tables where id = $1`,
    [tableId],
  );
  const expected = geoRow.rows[0]?.expected_dimensions;
  const dims = (typeof expected === 'string' ? JSON.parse(expected) : expected) as
    | { name: string; kind: string }[]
    | undefined;
  const regional = (dims ?? []).some((d) => d.kind === 'GeoDimension');

  // Every measure the units metadata names — even those with NO empty-dims
  // presence, so the caller can log which were skipped.
  const unitsRow = await db.query(`select units from cbs_tables where id = $1`, [tableId]);
  const unitsRaw = unitsRow.rows[0]?.units;
  const units = (typeof unitsRaw === 'string' ? JSON.parse(unitsRaw) : unitsRaw) as
    | Record<string, UnitMeta>
    | undefined;

  const shapes: MeasureShape[] = [];
  for (const measure of Object.keys(units ?? {})) {
    const grains = [...(grainsByMeasure.get(measure) ?? new Set<'JJ' | 'KW' | 'MM'>())].sort();
    shapes.push({
      measure,
      grains,
      hasEmptyDims: grains.length > 0,
      regional,
    });
  }
  return shapes;
}

export interface RegisterVocabularyInput {
  tableId: string;
  /** The unmatched topic term the finder matched on — added to every
   * registered measure's everydayTerms so the parser maps the user's word onto
   * a key. */
  topicTerm: string;
}

export interface RegisterVocabularyResult {
  /** The onboarded measures registered — passed to the delivery re-run as the
   * parser's extra vocabulary (empty → nothing to answer, delivery refunds). */
  onboarded: OnboardedMeasure[];
  /** Measure codes skipped because they had no empty-coordinate presence
   * (v1 scope). Diagnostic only. */
  skippedMeasures: string[];
}

/**
 * Inserts a canonical_measures row per registerable measure of `tableId`, and
 * ensures cbs_tables.default_coordinates is a concrete {} (the resolver joins
 * on it and treats null as {} already, but an explicit {} keeps the row honest
 * about "no incidental totaal coordinate pinned"). Idempotent: re-running for
 * the same table upserts the same rows (ON CONFLICT (key)), so a job retry
 * after a partial run is safe.
 *
 * Returns the OnboardedMeasure list for the delivery prompt. NEVER reads or
 * writes an observation value.
 */
export async function registerOnboardingVocabulary(
  db: Db,
  input: RegisterVocabularyInput,
): Promise<RegisterVocabularyResult> {
  const { tableId, topicTerm } = input;
  const shapes = await measureShapes(db, tableId);

  const unitsRow = await db.query(`select units from cbs_tables where id = $1`, [tableId]);
  const unitsRaw = unitsRow.rows[0]?.units;
  const units = (typeof unitsRaw === 'string' ? JSON.parse(unitsRaw) : unitsRaw) as
    | Record<string, UnitMeta>
    | undefined;

  const onboarded: OnboardedMeasure[] = [];
  const skippedMeasures: string[] = [];

  // Pin default_coordinates to an explicit {} so the resolver's
  // default_coordinates ∪ canonical.dims merge is a well-defined {} (the
  // answerable empty-coordinate shape). Never overwrites a real pin — an
  // onboarded table has none by construction (the registry-defaults apply step
  // only runs for the curated Phase-0 set).
  await db.query(
    `update cbs_tables set default_coordinates = coalesce(default_coordinates, '{}'::jsonb), updated_at = now()
      where id = $1`,
    [tableId],
  );

  for (const shape of shapes) {
    if (!shape.hasEmptyDims) {
      skippedMeasures.push(shape.measure);
      continue;
    }
    const meta = units?.[shape.measure];
    // CBS's own title is the short label / sentence subject (R10 spirit —
    // verbatim, never invented). Fall back to the code if the units metadata
    // lacks a title.
    const title = meta?.title ?? shape.measure;
    // The REAL definition (its meaning + any scale) is CBS's own measure blurb,
    // distilled to its first block — shown as the answer's "Definitie:" line
    // (#115 lever b). null when CBS published no usable blurb → the composer
    // omits the line rather than repeating the title (the old circular case).
    const definitionText = cleanCbsDefinition(meta?.description ?? '', title);
    const key = onboardedKey(tableId, shape.measure);
    const canonical: CanonicalMeasure = {
      key,
      tableId,
      measure: shape.measure,
      measureTitle: title,
      dims: {},
      definitionLabel: title,
      definitionText,
      // The user's own term + the CBS title give the parser two handles onto
      // this key. Deduped, non-empty.
      everydayTerms: [...new Set([topicTerm, title].filter((t) => t.length > 0))],
    };

    await db.query(
      // everyday_terms UNIONS with what an earlier onboarding of the same
      // table already learned (first-occurrence order kept, so re-running with
      // the SAME term is byte-stable): a re-onboard from a NEW synonym must
      // ADD that synonym, never erase the old one — a plain
      // `excluded.everyday_terms` overwrite silently unlearned the previous
      // term, so the previously-answerable phrasing regressed (#112).
      `insert into canonical_measures
         (key, table_id, measure, measure_title, dims, definition_label, definition_text, everyday_terms, alternates, notes, updated_at)
       values ($1, $2, $3, $4, '{}'::jsonb, $5, $6, $7, null, $8, now())
       on conflict (key) do update set
         table_id = excluded.table_id,
         measure = excluded.measure,
         measure_title = excluded.measure_title,
         dims = excluded.dims,
         definition_label = excluded.definition_label,
         definition_text = excluded.definition_text,
         everyday_terms = (
           select array_agg(t order by ord)
             from (
               select distinct on (t) t, ord
                 from unnest(canonical_measures.everyday_terms || excluded.everyday_terms)
                      with ordinality as u(t, ord)
                order by t, ord
             ) dedup
         ),
         notes = excluded.notes,
         updated_at = now()`,
      [
        key,
        tableId,
        shape.measure,
        title,
        title,
        definitionText,
        canonical.everydayTerms,
        `on-demand onboarded from topic "${topicTerm}" (WP16 sub-part 2)`,
      ],
    );

    onboarded.push({ measure: canonical, grains: shape.grains, regional: shape.regional });
  }

  return { onboarded, skippedMeasures };
}

/**
 * Read-only counterpart of registerOnboardingVocabulary: loads EVERY
 * previously-onboarded measure (key prefix 'onboarded:') back into the
 * OnboardedMeasure shape the intent parser's `extraCanonicalMeasures` channel
 * expects — so a fresh LIVE chat turn recognizes an already-onboarded topic
 * and answers it at the normal question price instead of re-triggering the
 * full 100-credit onboarding flow (#112, the go-live money bug).
 *
 * Grains and the regional flag are re-derived from the SAME sources
 * registration used (observations at the empty coordinate; the table's
 * expected_dimensions) — measured from ingested data, never guessed. A
 * measure whose empty-coordinate observations have since disappeared (e.g. a
 * narrower re-sync) is skipped, mirroring registration's own "an
 * un-registerable measure simply isn't offered" rule — offering it would
 * only dead-end in a refusal.
 *
 * Ordering is pinned (by key) so the rendered prompt bytes are deterministic
 * for a given registry state. Returns [] when nothing is onboarded — the
 * caller then passes an empty extra list and the prompt stays byte-identical
 * to the calibrated Phase-0 one.
 */
export async function loadOnboardedVocabulary(db: Db): Promise<OnboardedMeasure[]> {
  const { rows } = await db.query(
    `select key, table_id, measure, measure_title, definition_label, definition_text, everyday_terms
       from canonical_measures
      where key like 'onboarded:%'
      order by key`,
  );
  if (rows.length === 0) return [];

  const tableIds = [...new Set(rows.map((r) => String(r.table_id)))];

  const grainRows = await db.query(
    `select table_id, measure, period_grain
       from observations
      where table_id = any($1) and dims = '{}'::jsonb
      group by table_id, measure, period_grain`,
    [tableIds],
  );
  const grainsByTableMeasure = new Map<string, Set<'JJ' | 'KW' | 'MM'>>();
  for (const r of grainRows.rows) {
    const k = `${r.table_id} ${r.measure}`;
    let set = grainsByTableMeasure.get(k);
    if (!set) {
      set = new Set();
      grainsByTableMeasure.set(k, set);
    }
    set.add(r.period_grain as 'JJ' | 'KW' | 'MM');
  }

  const dimRows = await db.query(
    `select id, expected_dimensions from cbs_tables where id = any($1)`,
    [tableIds],
  );
  const regionalByTable = new Map<string, boolean>();
  for (const r of dimRows.rows) {
    const expected = r.expected_dimensions;
    const dims = (typeof expected === 'string' ? JSON.parse(expected) : expected) as
      | { name: string; kind: string }[]
      | undefined;
    regionalByTable.set(String(r.id), (dims ?? []).some((d) => d.kind === 'GeoDimension'));
  }

  const onboarded: OnboardedMeasure[] = [];
  for (const row of rows) {
    const tableId = String(row.table_id);
    const grains = [
      ...(grainsByTableMeasure.get(`${tableId} ${row.measure}`) ?? new Set<'JJ' | 'KW' | 'MM'>()),
    ].sort();
    if (grains.length === 0) continue; // no empty-coordinate presence anymore — not offerable
    onboarded.push({
      measure: {
        key: String(row.key),
        tableId,
        measure: String(row.measure),
        measureTitle: String(row.measure_title),
        dims: {},
        definitionLabel: String(row.definition_label),
        definitionText: row.definition_text === null ? null : String(row.definition_text),
        everydayTerms: (row.everyday_terms as string[]) ?? [],
      },
      grains,
      regional: regionalByTable.get(tableId) ?? false,
    });
  }
  return onboarded;
}
