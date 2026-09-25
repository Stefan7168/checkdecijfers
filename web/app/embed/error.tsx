// #319 (session 128): the shared route-segment error boundary for every
// route under app/embed/ — today that's the two public, no-auth embed
// pages, `/embed/[token]` (CBS, ADR 041) and `/embed/own/[publicId]`
// (own-data, ADR 057). Neither route wraps its DB reads in a try/catch
// (both deliberately follow the CBS route's own precedent, explained in
// each file's own header comment, of letting a thrown error propagate to
// Next's route-level error boundary) — before this file, that meant an
// uncaught error rendered Next's raw, unstyled error page INSIDE whatever
// third-party page had this route in an `<iframe>`. This file makes that
// case render something neutral and on-brand instead.
//
// Next.js requires an `error.tsx` route-segment boundary to be a Client
// Component (it re-renders on the client to catch an error that occurred
// during server rendering too) — see
// https://nextjs.org/docs/app/api-reference/file-conventions/error and the
// two page files' own header comments for the broader mechanism.
//
// Never renders `error.message` or `error.digest`: a DB error's message can
// carry connection strings, query fragments, or row content, and this page
// is shown to an anonymous visitor of a THIRD PARTY's site — the same
// "never leak internals" posture the own-data route's own style-lookup
// catch block already takes (see that file's header comment, "C1"). There
// is deliberately nothing here for a fabrication guard to check: the
// message below names no number, no source, no table — it is the same
// fixed sentence regardless of what broke.
'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { isLang, t, type Lang } from '../../lib/i18n/messages.ts';

// Shared with both page files' own "not available" `<main>` — same classes,
// same layout, so a reader who hits either page (a redacted/unpublished
// chart, THIS error boundary, or the CBS route's own inline branch) sees
// one consistent shape, not two different-looking "something's wrong" pages.
function ErrorMessage({ lang }: { lang: Lang }) {
  return (
    <main className="flex min-h-[200px] items-center justify-center p-4 text-sm text-muted-foreground">
      {t(lang, 'embed.error.unavailable')}
    </main>
  );
}

// `useSearchParams` works fine inside a Client Component error boundary —
// both embed page files are already `force-dynamic` (per-request, never
// statically prerendered), and this boundary itself only ever mounts in
// response to a real thrown error, never during a static build pass — but
// Next still recommends wrapping any `useSearchParams` call in `<Suspense>`
// so only this small part of the tree can suspend. The fallback renders the
// SAME message in the default language ('nl', matching both page files' own
// `isLang(query.lang) ? query.lang : 'nl'` default) rather than a blank
// screen or a spinner, so a reader never sees an unstyled gap while this
// resolves.
function LangAwareMessage() {
  const searchParams = useSearchParams();
  const rawLang = searchParams.get('lang');
  const lang: Lang = isLang(rawLang) ? rawLang : 'nl';
  return <ErrorMessage lang={lang} />;
}

export default function EmbedError(_props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Suspense fallback={<ErrorMessage lang="nl" />}>
      <LangAwareMessage />
    </Suspense>
  );
}
