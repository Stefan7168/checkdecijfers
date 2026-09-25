// ADR 057 (session 127): the store for published own-data charts. Every
// function probes for the table first and returns its "absent" value when
// migration 036 has not been applied yet — the chart_edits deploy-order
// precedent (src/chart/edits-store.ts). Never catch a SQL error here: callers
// run some of these inside withTransaction, where a caught error leaves the
// transaction aborted.
import { randomBytes } from 'node:crypto';
import type { Db } from '../db/types.ts';

export const PUBLIC_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const MAX_PUBLICATIONS_PER_USER = 50;
export const PUBLICATION_SOURCE_LINE_MAX = 120;

export interface PublicationRow {
  id: number;
  publicId: string;
  userId: string;
  datasetId: number;
  datasetTurnId: number;
  log: unknown[];
  sourceLine: string | null;
  createdAt: string;
  updatedAt: string;
}

export function newPublicId(): string {
  return randomBytes(16).toString('base64url');
}

export function isPublicIdShape(s: unknown): s is string {
  return typeof s === 'string' && PUBLIC_ID_PATTERN.test(s);
}

export async function publicationsTablePresent(db: Db): Promise<boolean> {
  const { rows } = await db.query(`select to_regclass('public.published_user_charts') as t`);
  return rows[0]?.t != null;
}

function iso(v: unknown): string {
  return typeof v === 'string' ? v : new Date(v as Date).toISOString();
}

function toRow(r: Record<string, unknown>): PublicationRow {
  return {
    id: Number(r.id),
    publicId: r.public_id as string,
    userId: r.user_id as string,
    datasetId: Number(r.dataset_id),
    datasetTurnId: Number(r.dataset_turn_id),
    log: Array.isArray(r.log) ? (r.log as unknown[]) : [],
    sourceLine: (r.source_line as string | null) ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

const COLUMNS = 'id, public_id, user_id, dataset_id, dataset_turn_id, log, source_line, created_at, updated_at';

export async function upsertPublication(
  db: Db,
  input: { userId: string; datasetId: number; datasetTurnId: number; log: unknown[]; sourceLine: string | null },
): Promise<{ publicId: string } | null> {
  if (!(await publicationsTablePresent(db))) return null;
  const { rows } = await db.query(
    `insert into published_user_charts (public_id, user_id, dataset_id, dataset_turn_id, log, source_line)
     values ($1, $2::uuid, $3, $4, $5::jsonb, $6)
     on conflict (dataset_turn_id, user_id) do update
       set log = excluded.log, source_line = excluded.source_line, updated_at = now()
     returning public_id`,
    [newPublicId(), input.userId, input.datasetId, input.datasetTurnId, JSON.stringify(input.log), input.sourceLine],
  );
  return { publicId: rows[0]!.public_id as string };
}

export async function getPublicationByPublicId(db: Db, publicId: string): Promise<PublicationRow | null> {
  if (!isPublicIdShape(publicId)) return null;
  if (!(await publicationsTablePresent(db))) return null;
  const { rows } = await db.query(`select ${COLUMNS} from published_user_charts where public_id = $1`, [publicId]);
  return rows.length === 0 ? null : toRow(rows[0] as Record<string, unknown>);
}

export async function getPublicationForTurn(db: Db, userId: string, turnId: number): Promise<PublicationRow | null> {
  if (!(await publicationsTablePresent(db))) return null;
  const { rows } = await db.query(
    `select ${COLUMNS} from published_user_charts where dataset_turn_id = $1 and user_id = $2::uuid`,
    [turnId, userId],
  );
  return rows.length === 0 ? null : toRow(rows[0] as Record<string, unknown>);
}

export async function deletePublicationForTurn(db: Db, userId: string, turnId: number): Promise<boolean> {
  if (!(await publicationsTablePresent(db))) return false;
  const { rows } = await db.query(
    `delete from published_user_charts where dataset_turn_id = $1 and user_id = $2::uuid returning id`,
    [turnId, userId],
  );
  return rows.length > 0;
}

export async function countPublications(db: Db, userId: string): Promise<number> {
  if (!(await publicationsTablePresent(db))) return 0;
  const { rows } = await db.query(`select count(*)::int as n from published_user_charts where user_id = $1::uuid`, [userId]);
  return Number(rows[0]!.n);
}

/** The GDPR leg: called by retention.ts's redactTurnsForDatasets inside the
 * SAME transaction as the turn redaction, so file deletion, account deletion
 * and the 2-year purge all kill the public link. */
export async function deletePublicationsForTurns(db: Db, turnIds: number[]): Promise<number> {
  if (turnIds.length === 0) return 0;
  if (!(await publicationsTablePresent(db))) return 0;
  const { rows } = await db.query(
    `delete from published_user_charts where dataset_turn_id = any($1::bigint[]) returning id`,
    [turnIds],
  );
  return rows.length;
}
