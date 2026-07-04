// Server Component boundary: only Server Components may export the runtime
// segment config (ADR 018 decision 4) — 'nodejs' is already Next's default,
// set explicitly as insurance since the DB pool (pg) and the pinned-CA
// filesystem read cannot run on the Edge runtime.
export const runtime = 'nodejs';
// Measured live latency (WP11): median 6.5s, max ~14s. 30s leaves margin for
// LLM API variance without approaching Hobby-tier ceilings.
export const maxDuration = 30;

import { redirect } from 'next/navigation';
import {
  getActionClassPrice,
  getBalance,
  getQuestionHistory,
  getSignupGrantCredits,
} from '../backend/billing/index.ts';
import { Dashboard } from '../components/dashboard.tsx';
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
  // simplePrice + signupGrantCredits: live pricing-config reads (ADR 006 --
  // the #69 warning threshold and #76 explainer copy must track the tables,
  // never a hardcoded number).
  const [balance, history, simplePrice, signupGrantCredits] = await Promise.all([
    getBalance(db, userId),
    getQuestionHistory(db, userId),
    getActionClassPrice(db, 'simple'),
    getSignupGrantCredits(db),
  ]);

  return (
    <Dashboard
      initialBalance={balance}
      simplePrice={simplePrice}
      signupGrantCredits={signupGrantCredits}
      history={<QuestionHistory items={history} />}
    />
  );
}
