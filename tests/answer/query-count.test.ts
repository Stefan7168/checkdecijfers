// A cost tripwire: how many database round-trips one deterministic turn costs.
//
// WHY (architecture review 2026-07-25, Q5, and [#176](docs/open-questions.md)).
// Per-request DB work has grown across four consecutive work packages and
// nothing anywhere measures it. That matters more here than in most products:
// production runs against Supabase's free-tier SESSION pooler, whose
// 15-connection ceiling has already produced one live degradation (#173,
// 2026-07-25), and the two WP26 mechanisms both add queries per request on a
// path that is about to be switched on for everyone.
//
// WHAT THIS IS AND IS NOT. It is NOT a correctness test — every number below
// may legitimately change. It is a tripwire: the numbers are measured, and a
// diff that moves one has to say so out loud in review instead of discovering
// it in a pooler alarm months later. When a number changes because you meant
// it to, update it in the same commit and say why in the message.
//
// Scope is the DETERMINISTIC half of a turn — intent resolution plus the query
// — because that is the half that runs identically every time. Billing, audit
// writes and the LLM calls sit outside it and have their own seams.
//
// WHAT THE MEASURED NUMBERS SAY (2026-07-25, and the reason to keep them):
//
//   fully specified, region + period      12   ← the majority path
//   national-only measure, fully specified 8   ← the cheapest real turn
//   region ambiguous, flags OFF            8   ← today: exits to a clarification
//   region ambiguous, flags ON            12   ← the flip: defaults and SERVES
//   both axes open, flags ON              13   ← the most expensive shape
//
// The flag flip therefore adds four statements to a region-ambiguous turn. That
// is a real cost against a 15-connection ceiling (#173) — but it is not a pure
// loss: those four replace an entire second round trip from the user, who today
// has to answer a clarification and pay for the follow-up turn. The number to
// watch is not this one; it is that a FULLY-SPECIFIED turn costs the same with
// the flags on as off, which the last test pins.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db, QueryResultRow } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { isResolutionFailure, resolveCandidate } from '../../src/answer/intent/resolve.ts';
import type { RawCandidate } from '../../src/answer/intent/types.ts';
import { runQuery } from '../../src/query/index.ts';

let base: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db: base, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

/** Counts every statement the caller issues, including inside a transaction.
 *
 * Precision, since the numbers below are the point: the counted path
 * (`src/answer/intent/` + `src/query/`) contains no `withTransaction` call
 * today, and the driver's own BEGIN/COMMIT would not be counted even if it
 * did. So these are application statements, not a full count of what the
 * pooler sees. The transaction wrapping is there so the pin keeps working if
 * the path ever grows one. */
function countingDb(inner: Db): { db: Db; statements: string[] } {
  const statements: string[] = [];
  const wrap = (target: Db): Db => ({
    async query(text: string, params?: unknown[]): Promise<{ rows: QueryResultRow[] }> {
      statements.push(text.trim().split('\n')[0]!.trim());
      return target.query(text, params);
    },
    withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return target.withTransaction((tx) => fn(wrap(tx)));
    },
  });
  return { db: wrap(inner), statements };
}

const REFERENCE_DATE = '2026-08-15';

function candidate(partial: Partial<RawCandidate> & { canonicalKey: string }): RawCandidate {
  return {
    regions: null,
    period: { kind: 'none' },
    derivation: 'none',
    confidence: 0.95,
    reading: 'test candidate',
    ...partial,
  };
}

/** One deterministic turn: resolve the candidate, then run the query it
 * produced (a resolution failure ends the turn — that IS the clarification). */
async function statementsFor(
  raw: RawCandidate,
  answerFirstEnabled: boolean,
): Promise<{ count: number; statements: string[]; served: boolean }> {
  const { db, statements } = countingDb(base);
  const resolution = await resolveCandidate(db, raw, REFERENCE_DATE, { answerFirstEnabled });
  if (isResolutionFailure(resolution)) {
    return { count: statements.length, statements, served: false };
  }
  const outcome = await runQuery(db, resolution.intent, { answerFirstEnabled });
  return { count: statements.length, statements, served: outcome.ok };
}

const AMSTERDAM: RawCandidate['regions'] = [{ name: 'Amsterdam', kind: 'gemeente' }];

describe('the deterministic half of a turn costs a pinned number of statements', () => {
  it('the majority path: region named, period named', async () => {
    const { count, served } = await statementsFor(
      candidate({
        canonicalKey: 'population_on_1_january',
        regions: AMSTERDAM,
        period: { kind: 'year', year: 2024 },
      }),
      false,
    );
    expect(served).toBe(true);
    expect(count).toBe(12);
  });

  it('flags off, region ambiguous — the shape #176 was found on', async () => {
    const { count, served } = await statementsFor(
      candidate({
        canonicalKey: 'population_on_1_january',
        period: { kind: 'year', year: 2024 },
      }),
      false,
    );
    expect(served).toBe(false); // today's clarification
    expect(count).toBe(8);
  });

  it('flags on, region ambiguous — what the flip adds on this shape', async () => {
    const { count, served } = await statementsFor(
      candidate({
        canonicalKey: 'population_on_1_january',
        period: { kind: 'year', year: 2024 },
      }),
      true,
    );
    expect(served).toBe(true); // the national default answers
    expect(count).toBe(12);
  });

  it('flags on, BOTH axes open — the most expensive defaulted shape', async () => {
    const { count, served } = await statementsFor(
      candidate({ canonicalKey: 'population_on_1_january' }),
      true,
    );
    expect(served).toBe(true);
    expect(count).toBe(13);
  });

  it('a national-only measure, fully specified — the cheapest real turn', async () => {
    const { count, served } = await statementsFor(
      candidate({ canonicalKey: 'cpi_yearly_inflation', period: { kind: 'year', year: 2024 } }),
      false,
    );
    expect(served).toBe(true);
    expect(count).toBe(8);
  });
});

describe('what the flag flip costs, stated as a difference', () => {
  it('turning the flags on does not change the cost of a fully-specified turn', async () => {
    // The pin that matters most for the go-live: the majority of turns name
    // both axes, and for them the flip must be free. A regression here would
    // multiply across every request, not just the defaulted ones.
    const spec = candidate({
      canonicalKey: 'population_on_1_january',
      regions: AMSTERDAM,
      period: { kind: 'year', year: 2024 },
    });
    const off = await statementsFor(spec, false);
    const on = await statementsFor(spec, true);
    expect(on.count).toBe(off.count);
  });
});
