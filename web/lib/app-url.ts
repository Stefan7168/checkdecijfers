// The app's public origin, shared by every surface that writes an absolute
// link to itself: the embed dialog's iframe `src`, the Share link, the
// share-preview image URL in the embed page's metadata (round 2, session
// 144 — a Server Component cannot import a constant from a 'use client'
// module, hence this plain module). See chart-embed-dialog.tsx for why the
// default is the future domain and production sets NEXT_PUBLIC_APP_URL.
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://checkdecijfers.nl';
