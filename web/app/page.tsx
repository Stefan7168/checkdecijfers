// Server Component boundary: only Server Components may export the runtime
// segment config (ADR 018 decision 4) — 'nodejs' is already Next's default,
// set explicitly as insurance since the DB pool (pg) and the pinned-CA
// filesystem read cannot run on the Edge runtime.
export const runtime = 'nodejs';
// Measured live latency (WP11): median 6.5s, max ~14s. 30s leaves margin for
// LLM API variance without approaching Hobby-tier ceilings.
export const maxDuration = 30;

import { redirect } from 'next/navigation';
import { getBalance, getQuestionHistory } from '../backend/billing/index.ts';
import { AccountPanel } from '../components/account-panel.tsx';
import { Chat } from '../components/chat.tsx';
import { QuestionHistory } from '../components/question-history.tsx';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';

export default async function Home() {
  // Belt-and-suspenders (WP13 precedent, /credits/page.tsx): proxy.ts already
  // redirects unauthenticated visits away from "/", but a proxy matcher is
  // an optimistic check, never the authorization boundary for the balance/
  // history reads below.
  const userId = await currentUserId();
  if (userId === null) {
    redirect('/login');
  }

  const db = getDb();
  const [balance, history] = await Promise.all([getBalance(db, userId), getQuestionHistory(db, userId)]);

  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 p-4 lg:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-6">
        <Chat />
        <QuestionHistory items={history} />
      </div>
      <AccountPanel balance={balance} />
    </div>
  );
}
