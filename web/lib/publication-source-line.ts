// Own-data publish (ADR 057, session 127, Task 3 fix round 1) — pulled out
// of own-chart-publish-actions.ts: Next's server-boundary check rejects any
// non-async export from a 'use server' module at `next build` time (bare
// `tsc` and CI's web job don't catch it), and `normalizeSourceLine` is a
// plain synchronous function. This module has NO imports from backend/db
// and no other server-only dependency, so it is safe to import from
// anywhere, including eventually client code.
//
// PUBLICATION_SOURCE_LINE_MAX_CLIENT mirrors PUBLICATION_SOURCE_LINE_MAX in
// web/backend/attachments/publications.ts — not imported directly because
// that module pulls in `node:crypto` (via its own `newPublicId` helper) and
// a `Db` type import, which this file must stay free of. Kept in sync by
// publication-source-line.test.ts's own equality assertion against that
// module's real export.
export const PUBLICATION_SOURCE_LINE_MAX_CLIENT = 120;

/** Strips ASCII control characters (incl. DEL) and the Unicode bidi
 * embedding/override (U+202A–U+202E) and isolate (U+2066–U+2069) controls —
 * B5: those can visually reorder the public "Bron: …" line so it reads as
 * something other than what was typed — trims, then applies the
 * empty-string-is-null and length rules (spec §3.2 step 4). Non-string,
 * non-nullish input (e.g. a number) fails rather than being coerced. */
export function normalizeSourceLine(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false };
  // eslint-disable-next-line no-control-regex -- deliberately stripping control chars
  const stripped = raw.replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, '').trim();
  if (stripped === '') return { ok: true, value: null };
  if (stripped.length > PUBLICATION_SOURCE_LINE_MAX_CLIENT) return { ok: false };
  return { ok: true, value: stripped };
}
