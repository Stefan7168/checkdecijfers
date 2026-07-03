// docs/05-data-rules.md staleness row: "Table past its expected update
// cadence" — two branches, both clock-injected (never the wall clock):
//   - covered historical period: served WITH a warning (AnswerResponse
//     .stalenessWarning), never a refusal.
//   - the question implies recency ("nu", "vandaag", "meest recente"): the
//     refusal branch (respond.ts's 'staleness' RefusalReason).
// This module only computes whether a result IS stale and builds the Dutch
// warning text; the branching decision is respond.ts's job (it also needs
// parse.impliedRecency, which this module has no reason to see).
import type { ValidatedResult } from '../../query/index.ts';
import { readUpdateCadence } from '../../registry/read.ts';
import type { Db } from '../../db/types.ts';

export interface StalenessCheck {
  stale: boolean;
  /** Dutch, names the sync date and the expected cadence — null when fresh. */
  warning: string | null;
}

/** **Assumption** (mirrored in docs/open-questions.md): cadence strings are
 * prefix-matched case-insensitively against the registry's free-text
 * `update_cadence` column (src/ingestion/registry-seed.ts, e.g. "monthly
 * (~22 days after each month)", "yearly (next CBS update Q2 2027)") — the
 * column is human-readable, not a closed enum, so a prefix match is the
 * honest reading. Thresholds are a 1.5x margin over the nominal cadence
 * (monthly ~31d -> 47d, quarterly ~92d -> 138d, yearly ~366d -> 549d),
 * owner-tunable constants, not measured from real publication-delay data.
 * An unrecognized or absent cadence never triggers staleness (null = no
 * expectation to violate) — silence about cadence must not become a refusal
 * neither this repo's docs nor the owner asked for. */
export function maxAgeDaysForCadence(cadence: string | null): number | null {
  if (!cadence) return null;
  const normalized = cadence.trim().toLowerCase();
  if (normalized.startsWith('monthly')) return 47;
  if (normalized.startsWith('quarterly')) return 138;
  if (normalized.startsWith('yearly')) return 549;
  return null;
}

function floorDaysBetween(earlierIso: string, laterIso: string): number {
  const earlier = new Date(earlierIso).getTime();
  const later = new Date(laterIso).getTime();
  return Math.floor((later - earlier) / (24 * 60 * 60 * 1000));
}

/** Dutch words for a cadence prefix, for the warning text. Mirrors the same
 * prefixes maxAgeDaysForCadence recognizes. */
function cadenceWordsNl(cadence: string): string {
  const normalized = cadence.trim().toLowerCase();
  if (normalized.startsWith('monthly')) return 'maandelijks';
  if (normalized.startsWith('quarterly')) return 'per kwartaal';
  if (normalized.startsWith('yearly')) return 'jaarlijks';
  return cadence;
}

/** docs/05 staleness row, both branches: stale iff the floor of days between
 * the table's last sync and the injected reference date STRICTLY EXCEEDS the
 * cadence's max-age threshold (boundary: age == maxAge is NOT stale — a
 * mutation-test lesson, ADR 012's discipline applied here too). */
export async function checkStaleness(
  db: Db,
  result: ValidatedResult,
  referenceDate: string,
): Promise<StalenessCheck> {
  const cadence = await readUpdateCadence(db, result.attribution.tableId);
  const maxAgeDays = maxAgeDaysForCadence(cadence);
  if (maxAgeDays === null) return { stale: false, warning: null };

  // referenceDate is a YYYY-MM-DD "today"; compare against the sync instant
  // at end-of-day so a same-day sync never reads as stale.
  const referenceIso = `${referenceDate}T23:59:59.999Z`;
  const ageDays = floorDaysBetween(result.attribution.syncedAt, referenceIso);
  const stale = ageDays > maxAgeDays;
  if (!stale) return { stale: false, warning: null };

  const syncDate = result.attribution.syncedAt.slice(0, 10);
  const warning =
    `Let op: deze tabel wordt normaal ${cadenceWordsNl(cadence!)} bijgewerkt door CBS, ` +
    `maar onze laatste synchronisatie was op ${syncDate} — recentere cijfers kunnen inmiddels beschikbaar zijn.`;
  return { stale: true, warning };
}
