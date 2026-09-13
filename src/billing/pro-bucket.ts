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
