// Server Component boundary: only Server Components may export the runtime
// segment config (ADR 018 decision 4) — 'nodejs' is already Next's default,
// set explicitly as insurance since the DB pool (pg) and the pinned-CA
// filesystem read cannot run on the Edge runtime.
export const runtime = 'nodejs';
// Measured live latency (WP11): median 6.5s, max ~14s. 30s leaves margin for
// LLM API variance without approaching Hobby-tier ceilings.
export const maxDuration = 30;

import { Chat } from '../components/chat.tsx';

export default function Home() {
  return <Chat />;
}
