// #252 fix (session 110 UX audit pass 3, row 2): `syncDateLabel` used to
// live in source-badge.tsx, a `'use client'` component. answer-proof.ts
// imported it from there to render the proof panel's own `syncedAt` field —
// but answer-proof.ts runs from server-only call sites (replay-assemble.ts,
// question-history.tsx, app/actions.ts), and importing a client-directive
// module into a server path throws at runtime in Next's RSC/server-action
// boundary (vitest's jsdom environment never sees this: it loads both files
// as plain modules with no client/server distinction, so the bug shipped
// with green tests). This module is the plain, directive-free home for the
// shared logic so BOTH source-badge.tsx (a client component) and
// answer-proof.ts (a server-only leaf) can import it without either one
// crossing the other's boundary.
//
// Kept intentionally tiny (no React, no i18n, no source registry) — see
// chart-download.tsx's own `syncDateForFilename`, which already keeps a
// local copy rather than importing source-badge.tsx for the same reason
// this file now exists to fix.

/** The measured date part of an ISO sync timestamp, or null when absent or
 * unparseable — never a guessed or reformatted date (principle c). */
export function syncDateLabel(syncedAt: string | null | undefined): string | null {
  if (!syncedAt) return null;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(syncedAt);
  return match ? match[0] : null;
}
