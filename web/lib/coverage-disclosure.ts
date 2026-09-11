// WP-E (journey programme, 2026-09-12, phase 3 R4): the coverage disclosure
// shown to the visitor — "which sources are built in" — built from the SAME
// registry read as llms.txt (`buildCoverageReport`, src/registry/coverage.ts)
// but as a serialisable object for a React prop instead of a text file, and
// with its OWN 30-min TTL cache + reset test seam (a sibling of
// web/lib/llms-txt.ts's cache, not a reuse of it — the two surfaces render
// different shapes from the same source and must be able to evolve/fail
// independently; llms-txt.ts's own inflight/cache pair stays untouched).
//
// Honesty rules (principle c, mirrored from llms-txt.ts):
//  - only `status: 'active'` tables are included — a `needs_review` table is
//    quarantined from the answer path, so listing it here would over-claim.
//  - `syncedOn` is the MEASURED `cbs_tables.last_sync_at` date, never a
//    cadence promise; null when the table has never synced.
//  - `example` is one genuinely answerable question per table, built from
//    the SAME building blocks the refusal composer uses
//    (src/answer/respond/refusals.ts: freshestForCanonical + periodCodeToNl)
//    — never invented copy. A table with no freshest period gets no example.
//  - stale-over-nothing on a DB failure (llms-txt.ts precedent); null only
//    when a build has never once succeeded.
import { buildCoverageReport } from '../backend/registry/coverage.ts';
import { CANONICAL_MEASURES } from '../backend/registry/defaults.ts';
import { freshestForCanonical } from '../backend/query/run.ts';
import { periodCodeToNl } from '../backend/answer/respond/period-nl.ts';
import { getDb } from './db.ts';

const TTL_MS = 30 * 60 * 1000;

export interface CoverageDisclosureTable {
  id: string;
  title: string;
  /** 'YYYY-MM-DD', or null if this table has never synced. */
  syncedOn: string | null;
  concepts: string[];
  /** One click-to-fill example question, or null when the table's freshest
   * period is unknown (never a guessed/invented example — principle c). */
  example: string | null;
}

export interface CoverageDisclosure {
  tables: CoverageDisclosureTable[];
}

let cache: { at: number; body: CoverageDisclosure } | null = null;
let inflight: Promise<CoverageDisclosure | null> | null = null;

/** Test seam: reset the module-scope cache between cases. */
export function resetCoverageDisclosureCache(): void {
  cache = null;
  inflight = null;
}

function dateOnly(iso: string | null): string | null {
  if (iso === null) return null;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(iso);
  return match ? match[0] : null;
}

/** One answerable example per table, reusing exactly the building blocks
 * refusals.ts's exampleQuestionNl uses (the registry's everyday term + the
 * measure's own freshest loaded period) — never invented. Two frames:
 * the inflation measure keeps refusals.ts's proven "Wat was de inflatie in
 * {periode}?"; every other measure gets the article-free "Wat zijn de
 * cijfers over {term} in {periode}?" — Dutch articles (de/het) are not in
 * the registry, so "Wat was de {term}" reads as broken Dutch for most
 * tables ("Wat was de inwoners…"; review finding, session 97). The example
 * stays Dutch in the English UI: the pipeline parses Dutch (CLAUDE.md
 * language carve-out). Picks the first canonical measure registered for
 * the table that has a freshest period; a table with none gets no example
 * (principle c). */
async function exampleForTable(tableId: string): Promise<string | null> {
  const candidates = CANONICAL_MEASURES.filter((m) => m.tableId === tableId);
  for (const measure of candidates) {
    const freshest = await freshestForCanonical(getDb(), measure.key);
    if (freshest === null) continue;
    const subject = measure.everydayTerms[0] ?? measure.definitionLabel;
    const period = periodCodeToNl(freshest.periodCode);
    return measure.key === 'cpi_yearly_inflation'
      ? `Wat was de ${subject} in ${period}?`
      : `Wat zijn de cijfers over ${subject} in ${period}?`;
  }
  return null;
}

async function buildDisclosure(): Promise<CoverageDisclosure> {
  const report = await buildCoverageReport(getDb());
  const served = report.tables.filter((t) => t.status === 'active');
  const tables = await Promise.all(
    served.map(async (table) => ({
      id: table.id,
      title: table.title,
      syncedOn: dateOnly(table.lastSyncAt),
      concepts: table.measures.map((m) => m.label),
      example: await exampleForTable(table.id),
    })),
  );
  return { tables };
}

/** The cached coverage disclosure, or null when no build has ever succeeded. */
export async function loadCoverageDisclosure(): Promise<CoverageDisclosure | null> {
  if (cache !== null && Date.now() - cache.at < TTL_MS) return cache.body;
  if (inflight === null) {
    inflight = (async () => {
      try {
        const body = await buildDisclosure();
        cache = { at: Date.now(), body };
        return body;
      } catch (err) {
        console.warn('[coverage-disclosure] coverage unavailable, serving previous version if any:', err);
        // Stale-over-nothing; cache untouched so the next request retries.
        return cache?.body ?? null;
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}
