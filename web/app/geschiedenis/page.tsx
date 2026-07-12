// WP135 (ADR 033 D6/⟨A5⟩): "Geschiedenis" — the question history moved out of
// the Dashboard, behind the site nav (the #74 "mijn aanvragen" seam lives here
// later, out of scope now). The QuestionHistory server component is MOVED, not
// rewritten. The route ships DARK: while WORKSPACE_ENABLED is off it redirects
// to / (no new surface reachable pre-flip); flag on ⇒ auth-guarded, with the
// site header like every other authenticated page.
export const runtime = 'nodejs';

import { redirect } from 'next/navigation';
import { getBalance, getQuestionHistory } from '../../backend/billing/index.ts';
import { QuestionHistory } from '../../components/question-history.tsx';
import { SiteHeader } from '../../components/site-header.tsx';
import { currentUserId } from '../../lib/current-user.ts';
import { getDb } from '../../lib/db.ts';

export default async function GeschiedenisPage() {
  if (process.env.WORKSPACE_ENABLED !== '1') {
    redirect('/');
  }
  const userId = await currentUserId();
  if (userId === null) {
    redirect('/login');
  }
  const db = getDb();
  const [balance, history] = await Promise.all([
    getBalance(db, userId),
    // Same master-switch guard as page.tsx: while ONBOARDING_ENABLED is unset,
    // the read never touches the not-yet-migrated pending_table_requests table.
    getQuestionHistory(db, userId, { includeOnboarding: process.env.ONBOARDING_ENABLED === '1' }),
  ]);
  return (
    <>
      <SiteHeader balance={balance} />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <h1 className="text-lg font-semibold">Geschiedenis — Check de Cijfers</h1>
        <QuestionHistory items={history} />
      </div>
    </>
  );
}
