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
// WHAT THE MEASURED NUMBERS SAY (2026-07-25, re-measured 2026-07-26; +1 to
// every SERVED number 2026-08-27 session 66, #110 — see the note below):
//
//   fully specified, region + period       12   ← the majority path
//   national-only measure, fully specified  8   ← the cheapest real turn
//   no region named, flags OFF              8   ← exits to a clarification
//   no region named, flags ON              12   ← the flip: defaults and SERVES
//   both axes open, flags ON               13   ← the most expensive shape
//   NAMED ambiguous region, click OFF       3   ← #176, after the fix
//   NAMED ambiguous region, click ON        4   ← the cost of building a chip
//
// #110 (2026-08-27, session 66): the on-demand table eviction/TTL feature
// added ONE statement to every SERVED turn — runQuery's touchLastQueriedAt
// bump (src/query/run.ts), which stamps the resolved table's last-use clock
// for the eviction GC. The debounce (writes only when >1 day stale) bounds
// ROW CHURN, not ROUND-TRIP COUNT: the check-and-maybe-update is one SQL
// statement either way, so this +1 lands on every served answer, every time,
// not just once a day — the connection-pooler cost this file exists to watch
// (#173) is paid per request, same as the WP26 flags above it. Rows that
// never reach runQuery (a clarification exit, an unmatched topic) are
// unaffected — hence the flags-OFF/no-region row above stays 8, unchanged.
// ⚠ #195/#196 FIX, 2026-09-03 (session 72): "every served turn" above means
// exactly that now, not "every runQuery call" — a SERVABILITY DRY-RUN
// (`echoServability`, the probe primitive every follow-up/comparison chip and
// alternate-reading check funnels through) passes `probe: true` and no longer
// carries this statement at all. Every number in the table above is a SERVED
// path (`resolveCandidate` + a plain `runQuery`, never a dry-run) and was
// unaffected by that change. The `#197 step 3` describe below measures
// dry-runs specifically; see its own header.
// ⚠ #196 FOLLOW-UP, 2026-09-03 (session 73, the review of PR #121): −1 on
// EVERY served number above (13→12, 9→8, 13→12, 14→13; re-measured). runQuery's
// observations fetch now LEFT-JOINs the period labels (dimension_labels) and
// the retained cells' batch dates (ingestion_batches) into the one statement,
// so the later label read is gone from every successful runQuery — labels
// come from the same snapshot as the cells, which is what closed the
// eviction race for good (a table evicted between the two reads used to
// leave raw period codes in the served sentence). The registry re-read the
// staleness check made AFTER the query (respond.ts, outside this file's
// scope) is gone too — it reads the cadence the query resolved with — and is
// pinned in tests/answer/respond-staleness.test.ts. Clarification exits
// (8, 3, 4) never reach the fetch and are unchanged.
//
// The flag flip therefore adds four statements to a turn that named no region.
// That is a real cost against a 15-connection ceiling (#173) — but it is not a
// pure loss: those four replace an entire second round trip from the user, who
// today has to answer a clarification and pay for the follow-up turn. The
// number to watch is not this one; it is that a FULLY-SPECIFIED turn costs the
// same with the flags on as off, which the last test pins.
//
// ⚠ A CORRECTION, 2026-07-26 (session 60). The two middle rows above used to be
// labelled "region ambiguous", and the test on the flags-OFF one claimed to be
// "the shape #176 was found on". Both were WRONG, and wrong in the way that
// matters: those cases pass `regions: null`, which returns ok early at
// resolve.ts:166 and NEVER enters the failure branch #176 is about. Their
// `served: false` comes from the query layer, not from a region ambiguity. So
// the #176 fix moved none of those numbers, and a session that "verified" the
// fix against this file as it stood would have proved nothing — a no-op gate
// would have stayed just as green. #176's real shape is a NAMED ambiguous
// region ("Hoeveel inwoners had Utrecht in 2024?"), which is the last two rows,
// added with the fix and mutation-checked against a removed gate.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db, QueryResultRow } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { isResolutionFailure, resolveCandidate } from '../../src/answer/intent/resolve.ts';
import type { RawCandidate, RawParse } from '../../src/answer/intent/types.ts';
import { buildAnswerChips } from '../../src/answer/respond/suggestions.ts';
import { respondToQuestion } from '../../src/answer/respond/index.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import { echoServability, runQuery, INTENT_SCHEMA_VERSION } from '../../src/query/index.ts';
import type { StructuredIntent } from '../../src/query/index.ts';

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
 * the path ever grows one.
 *
 * `statements` holds each statement's FULL trimmed text (not just a label) —
 * #195's `set last_queried_at` pins below match against it — so it also
 * doubles as a content probe, not merely a counter. */
/** #195 pins: the touchLastQueriedAt statements among a turn's statements —
 * matched on the SET clause, which the #196 skip-locked rewrite of the WHERE
 * clause (session 73) leaves untouched. */
function lastQueriedTouches(statements: string[]): string[] {
  return statements.filter((s) => /set last_queried_at/i.test(s));
}

function countingDb(inner: Db): { db: Db; statements: string[] } {
  const statements: string[] = [];
  const wrap = (target: Db): Db => ({
    async query(text: string, params?: unknown[]): Promise<{ rows: QueryResultRow[] }> {
      statements.push(text.trim());
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
  clickOptionsEnabled = false,
): Promise<{ count: number; statements: string[]; served: boolean }> {
  const { db, statements } = countingDb(base);
  const resolution = await resolveCandidate(db, raw, REFERENCE_DATE, {
    answerFirstEnabled,
    clickOptionsEnabled,
  });
  if (isResolutionFailure(resolution)) {
    return { count: statements.length, statements, served: false };
  }
  const outcome = await runQuery(db, resolution.intent, { answerFirstEnabled });
  return { count: statements.length, statements, served: outcome.ok };
}

const AMSTERDAM: RawCandidate['regions'] = [{ name: 'Amsterdam', kind: 'gemeente' }];
/** Bare "Utrecht" — gemeente GM0344 vs provincie PV26. THE region-ambiguous
 * shape: `resolveRegions` fails with `optionCodes`, which is the only branch
 * that reaches the #176 work. A question that names NO region does not come
 * near it (resolve.ts:166 returns ok early). */
const AMBIGUOUS_UTRECHT: RawCandidate['regions'] = [{ name: 'Utrecht', kind: 'onbekend' }];

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

  it('flags off, NO region named — exits to a clarification', async () => {
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

  it('flags on, NO region named — what the flip adds on this shape', async () => {
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

  // ---- The #176 shape. Everything above names no region at all; only these
  // two reach the failure branch that #176 is about.
  it('a NAMED ambiguous region, click options OFF — the #176 saving', async () => {
    const { count, served } = await statementsFor(
      candidate({
        canonicalKey: 'population_on_1_january',
        regions: AMBIGUOUS_UTRECHT,
        period: { kind: 'year', year: 2024 },
      }),
      false,
    );
    expect(served).toBe(false); // "Utrecht (gemeente) of Utrecht (PV)?"
    expect(count).toBe(3);
  });

  it('a NAMED ambiguous region, click options ON — what a chip costs to build', async () => {
    // The SAME turn with the flag that consumes the intents. The difference
    // between this and the test above is exactly the work #176 removed from
    // the flag-off path; if these two ever converge, either the gate stopped
    // gating or the chips stopped being built.
    const { count, served } = await statementsFor(
      candidate({
        canonicalKey: 'population_on_1_january',
        regions: AMBIGUOUS_UTRECHT,
        period: { kind: 'year', year: 2024 },
      }),
      false,
      true,
    );
    expect(served).toBe(false);
    expect(count).toBe(4);
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

// #197 step 3 (session 70, 2026-09-02): the follow-up chip builder is the
// largest per-request grower since #176 — every dry-run is a full runQuery.
//
// ⚠ #195/#196 FIX, 2026-09-03 (session 72). Every number below DROPPED by
// exactly its row's dry-run count: `echoServability` (dry-run.ts) now calls
// runQuery with `probe: true`, and runQuery skips the #110 touchLastQueriedAt
// statement entirely on a probe (src/query/run.ts) — a dry-run whose result is
// always discarded must not warm the table for the eviction GC (#195's
// finding). Re-measured with the real fixture db and the real echoServability:
//
//   regional single answer (Amsterdam 2024)   21 statements / 3 dry-runs   flag OFF and ON   (was 27, then 24)
//   national-only measure (CPI 2024)           8 / 2  OFF   →   12 / 3  ON                    (was 12 → 18, then 10 → 15)
//
// ⚠ #196 FOLLOW-UP, 2026-09-03 (session 73): −1 per SUCCESSFUL dry-run again —
// the period-label read folded into runQuery's fetch (file header), so every
// servable probe is one statement shorter. Re-measured.
//
// Why the first row does not move between flag OFF/ON: the cap (MAX_SUGGESTIONS
// = 3) stops the roster after three survivors, and with the flag on the region
// comparison takes the slot the region variant used to take — one dry-run for
// one. Only a shape with a free slot (a national-only measure: no region
// comparison) spends the extra dry-run for the period comparison. The worst
// case is a roster where the early generators FAIL their dry-runs (each
// failure costs a dry-run and frees no slot): still 8 dry-runs flag ON vs 6
// OFF (unchanged — a FAILED dry-run never reached the touch line either,
// before or after this fix, since resolveIntent's own refusals never reached
// it); not pinned here because it needs a stub check, and the tripwire is
// about the real path.
describe('#197 step 3: what the comparison chips cost per answered turn', () => {
  async function chipStatements(
    intent: StructuredIntent,
    clickOptions: boolean,
  ): Promise<{ count: number; statements: string[] }> {
    const result = await runQuery(base, intent);
    if (!result.ok) throw new Error('fixture intent not servable');
    const { db, statements } = countingDb(base);
    await buildAnswerChips(intent, result, (candidate) => echoServability(db, candidate), { clickOptions });
    return { count: statements.length, statements };
  }
  const amsterdam: StructuredIntent = {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: { kind: 'canonical', key: 'population_on_1_january' },
    regions: ['GM0363'],
    period: { kind: 'codes', codes: ['2024JJ00'] },
    derivation: 'none',
  };
  const cpi: StructuredIntent = {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
    period: { kind: 'codes', codes: ['2024JJ00'] },
    derivation: 'none',
  };

  it('a regional single answer: the flag changes nothing — the comparison takes the region variant\'s slot', async () => {
    expect((await chipStatements(amsterdam, false)).count).toBe(21);
    expect((await chipStatements(amsterdam, true)).count).toBe(21);
  });

  it('a national-only measure: the flag adds exactly one dry-run (the period comparison fills the free slot)', async () => {
    expect((await chipStatements(cpi, false)).count).toBe(8);
    expect((await chipStatements(cpi, true)).count).toBe(12);
  });

  // #195: the dry-run primitive itself never bumps the eviction clock — zero
  // `set last_queried_at` statements anywhere in a chip build, even the
  // worst-case roster (comparisons on, every generator tried).
  it('#195: building chips spends zero last_queried_at bumps — every dry-run is a probe', async () => {
    const { statements } = await chipStatements(amsterdam, true);
    const touches = lastQueriedTouches(statements);
    expect(touches).toEqual([]);
  });
});

// #195 (session 72): the other half of the pin — a real served answer must
// still bump the clock exactly once. Never zero (the touch is real demand for
// the eviction GC) and never more than once, even though the SAME turn also
// builds follow-up chips behind the scenes (each of those chip dry-runs is a
// full runQuery, but every one of them is a probe — see the describe above).
// CannedClient + a single high-confidence candidate mirrors the pattern in
// tests/answer/comparison-chips.test.ts; the answer client throws (forces the
// template rung) — neither client's behavior affects chip building, which
// never calls an LLM.
describe('#195: a served respondToQuestion turn bumps last_queried_at exactly once', () => {
  class CannedClient implements LlmClient {
    private readonly raw: RawParse;
    constructor(raw: RawParse) {
      this.raw = raw;
    }
    async complete(): Promise<LlmResponse> {
      return {
        outputText: JSON.stringify(this.raw),
        model: 'stub',
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
  }
  class ThrowingClient implements LlmClient {
    async complete(): Promise<LlmResponse> {
      throw new Error('LLM call attempted on a path that must be deterministic');
    }
  }
  const AMSTERDAM_2024: RawParse = {
    version: 3,
    kind: 'data_query',
    candidates: [
      {
        canonicalKey: 'population_on_1_january',
        regions: [{ name: 'Amsterdam', kind: 'gemeente' }],
        period: { kind: 'year', year: 2024 },
        derivation: 'none',
        confidence: 0.95,
        reading: 'bevolking van Amsterdam in 2024',
      },
    ] as never,
    unmatchedMeasureTerm: null,
    nearestCanonicalKeys: [],
    note: null,
  };

  it('exactly one set last_queried_at statement per turn — the served answer, none of its follow-up-chip dry-runs', async () => {
    const { db, statements } = countingDb(base);
    const response = await respondToQuestion(db, 'Hoeveel inwoners had Amsterdam in 2024?', {
      intentClient: new CannedClient(AMSTERDAM_2024),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
    });
    if (response.kind !== 'answer') throw new Error(`expected an answer, got ${response.kind}: ${response.text}`);
    const touches = lastQueriedTouches(statements);
    expect(touches).toHaveLength(1);
  });
});
