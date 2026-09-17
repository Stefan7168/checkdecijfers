// The Pro monthly-allowance bucket ledger (migration 030, open-questions
// #205) — append-only, structurally isolated from credit_transactions (see
// migration 030's own header comment for why). Balance for a given grant =
// SUM(delta) WHERE user_id AND grant_id match; there is no mutable counter.
import type { Db } from '../db/types.ts';

export interface BucketLedgerEntry {
  id: number;
}

export async function getBucketBalance(db: Db, userId: string, grantId: string): Promise<number> {
  const { rows } = await db.query(
    'select coalesce(sum(delta), 0) as balance from pro_bucket_ledger where user_id = $1 and grant_id = $2',
    [userId, grantId],
  );
  return Number(rows[0]!.balance);
}

/** Idempotent per stripeInvoiceId — a retried invoice.paid webhook delivery
 * is a no-op, never a double grant. */
export async function grantBucket(
  db: Db,
  userId: string,
  grantId: string,
  credits: number,
  stripeInvoiceId: string,
): Promise<BucketLedgerEntry | null> {
  const { rows } = await db.query(
    `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, stripe_invoice_id, note)
     values ($1, $2, $3, 'grant', $4, 'pro monthly allowance grant')
     on conflict (stripe_invoice_id) where reason = 'grant' do nothing
     returning id`,
    [userId, grantId, credits, stripeInvoiceId],
  );
  const row = rows[0];
  return row === undefined ? null : { id: Number(row.id) };
}

/** Idempotent per (userId, requestId) — a repeated client request is a
 * no-op, mirroring credit_transactions' debit functions exactly. Does NOT
 * check balance itself (mirrors debitQuestion's own contract) — see
 * ledger.ts's splitDebit, which reads getBucketBalance first. */
export async function debitBucket(
  db: Db,
  userId: string,
  grantId: string,
  requestId: string,
  credits: number,
  note: string,
): Promise<BucketLedgerEntry | null> {
  const { rows } = await db.query(
    `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, request_id, note)
     values ($1, $2, $3, 'debit', $4, $5)
     on conflict (user_id, request_id) where reason = 'debit' do nothing
     returning id`,
    [userId, grantId, -credits, requestId, note],
  );
  const row = rows[0];
  return row === undefined ? null : { id: Number(row.id) };
}

/** Idempotent per debitEntryId — a repeated compensation call for the same
 * debit is a no-op, mirroring credit_transactions.compensate() exactly.
 * Looks up the debit's own grant_id so the refund lands back in the SAME
 * grant it was taken from, even if a different grant is current by now. */
export async function compensateBucket(
  db: Db,
  userId: string,
  debitEntryId: number,
  credits: number,
): Promise<BucketLedgerEntry | null> {
  const { rows } = await db.query(
    `insert into pro_bucket_ledger (user_id, grant_id, delta, reason, related_entry_id, note)
     select user_id, grant_id, $2, 'compensation', id, 'pro allowance refund'
     from pro_bucket_ledger where id = $1 and user_id = $3
     on conflict (related_entry_id) where reason = 'compensation' do nothing
     returning id`,
    [debitEntryId, credits, userId],
  );
  const row = rows[0];
  return row === undefined ? null : { id: Number(row.id) };
}

/** #246 fix (session 109, open-questions #246): batched net-cost lookup for
 * src/billing/history.ts's getQuestionHistory and src/threads/index.ts's
 * getThreadRows, whose displayed cost caption previously read ONLY
 * credit_transactions — a fully or partially Pro-bucket-funded turn showed
 * null or an under-reported number, since splitDebit (this ledger's own
 * writer) puts the bucket-funded portion of a debit HERE, never in
 * credit_transactions.
 *
 * `requestIds` is the caller's full candidate set for one page of rows: for
 * each audit row, that means its own plain request_id (the base
 * question/onboarding debit's bucket id, splitDebit's default
 * `bucketRequestId`) PLUS every derived add-on id
 * (`deriveAddonRequestId(requestId, 'websearch' | 'dataset')`, ledger.ts) —
 * pro_bucket_ledger has no per-action `reason` column (only 'grant' |
 * 'debit' | 'compensation'), so a websearch/dataset add-on's bucket leg can
 * ONLY be found by recomputing the id it was written under, never by
 * filtering a reason column the way credit_transactions can. One round trip
 * for the whole page rather than one query per row.
 *
 * Returns a Map from request_id -> net credits charged (a positive number,
 * or 0 if fully refunded) for every id in `requestIds` that has a committed
 * 'debit' row. An id with NO entry in the map has NO bucket debit at all —
 * the caller must treat that as "this table has nothing to say about this
 * id" (0 contribution, no claim about existence), never coerce a missing
 * key to a cost of 0 for existence purposes, or a fully-ledger-funded turn
 * would look indistinguishable from a bucket debit that happens to net to 0
 * after a full refund.
 *
 * Scoped to `userId` (mirrors every other cross-ledger read in this
 * codebase — defense in depth, and pro_bucket_ledger's own
 * one-debit-per-request unique index is itself only unique WITHIN a
 * user_id, so an unscoped match could in principle read another user's
 * row). `pro_bucket_ledger_one_debit_per_request` (migration 030)
 * guarantees at most one 'debit' row per (user_id, request_id), and
 * `pro_bucket_ledger_one_compensation_per_debit` guarantees at most one
 * 'compensation' row per debit — so, unlike credit_transactions (where ONE
 * request_id can carry two debits under two different `reason`s, e.g.
 * question_cost + websearch_cost sharing an id, netted with a SUM), each
 * candidate id here maps to at most one debit and at most one compensation;
 * no GROUP BY/SUM is needed for that reason, only for batching the whole
 * candidate set into one query. */
export async function getBucketNetCosts(
  db: Db,
  userId: string,
  requestIds: readonly string[],
): Promise<Map<string, number>> {
  if (requestIds.length === 0) return new Map();
  const { rows } = await db.query(
    `select
       d.request_id as request_id,
       (-d.delta) - coalesce(
         (select sum(c.delta) from pro_bucket_ledger c where c.related_entry_id = d.id and c.reason = 'compensation'),
         0
       ) as net
     from pro_bucket_ledger d
     where d.user_id = $1
       and d.reason = 'debit'
       and d.request_id = any($2::uuid[])`,
    [userId, requestIds],
  );
  const result = new Map<string, number>();
  for (const row of rows) {
    result.set(String(row.request_id), Number(row.net));
  }
  return result;
}
