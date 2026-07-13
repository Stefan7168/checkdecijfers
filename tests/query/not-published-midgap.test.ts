// #134(b) — the too-OLD vs MID-GAP not_published split, pinned END TO END
// against real ingested data through the real runQuery/diagnoseMissing path.
//
// Why a dedicated file with its own db: every committed fixture series is
// gap-free at its native grain, so no fixture can naturally produce a genuine
// same-grain mid-gap not_published (a period CBS never published, sitting
// BETWEEN two served periods). The adversarial review of #134(b) (2026-07-13)
// showed that without such a case, the `tooOld` guard's discriminating
// comparison (`requestedKey < periodKey(earliest)`) could be weakened to just
// `earliest !== null` with the whole suite staying green — a future
// "simplification" would then ship a WRONG retry chip on a real mid-gap with no
// CI signal. This test closes that gap: it surgically deletes one interior year
// from an isolated ingest to create a true mid-gap, and asserts the refusal
// carries NO boundary (stays prose-only), while a too-old ask on the same
// series DOES carry the earliest-served floor. Isolated db ⇒ no cross-test
// contamination.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runQuery } from '../../src/query/index.ts';
import type { StructuredIntent } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

let db: Db;
let close: () => Promise<void>;

/** The interior year we hole out of the CPI series (fixture spans 2010..2025). */
const MID_GAP_YEAR = '2017JJ00';
/** A year older than the whole CPI series — the too-old floor is 2010. */
const TOO_OLD_YEAR = '1900JJ00';
const EARLIEST_SERVED = '2010JJ00';

function cpi(codes: string[]): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
    period: { kind: 'codes', codes },
    derivation: 'none',
  };
}

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
  // Sanity: the interior year is genuinely served BEFORE we hole it — otherwise
  // this test would silently assert nothing if the fixture ever drops 2017.
  const before = await runQuery(db, cpi([MID_GAP_YEAR]));
  if (!before.ok) {
    throw new Error(`fixture precondition: CPI ${MID_GAP_YEAR} must be served before holing it`);
  }
  // Surgically remove the interior year: drop its time-dimension LABEL (so the
  // period reads as not_published, not no_data) and its observations. Deleting
  // by period_code alone targets only this year across the CPI table.
  const cpiTable = (
    await db.query(`select table_id from canonical_measures where key = 'cpi_yearly_inflation'`)
  ).rows[0]?.table_id as string;
  await db.query(`delete from observations where table_id = $1 and period_code = $2`, [cpiTable, MID_GAP_YEAR]);
  await db.query(`delete from dimension_labels where table_id = $1 and code = $2`, [cpiTable, MID_GAP_YEAR]);
}, 300_000);

afterAll(async () => {
  await close();
});

describe('#134(b) not_published classification — end to end through diagnoseMissing', () => {
  it('a MID-GAP not_published (interior year, requested >= earliest) carries NO boundary — stays prose-only', async () => {
    const outcome = await runQuery(db, cpi([MID_GAP_YEAR]));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('not_published');
    // The load-bearing assertion: the too-old guard must NOT fire for a period
    // that sits at/after our earliest served period. A guard weakened to
    // `earliest !== null` would wrongly set nearestAlternative to 2010 here.
    expect(outcome.refusal.nearestAlternative).toBeUndefined();
  });

  it('a TOO-OLD not_published (before earliest) DOES carry the earliest-served floor as the boundary', async () => {
    const outcome = await runQuery(db, cpi([TOO_OLD_YEAR]));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('not_published');
    expect(outcome.refusal.nearestAlternative).toBe(EARLIEST_SERVED);
  });

  it('the hole is surgical: a neighbouring served year still answers (2016)', async () => {
    const outcome = await runQuery(db, cpi(['2016JJ00']));
    expect(outcome.ok).toBe(true);
  });
});
