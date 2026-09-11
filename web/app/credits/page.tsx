// Credit balance + pack purchase (WP13, ADR 006 seams 2-4). Server Component:
// balance and pack list are read directly, no client round-trip needed.
import { redirect } from 'next/navigation';
import {
  getActionClassPrice,
  getActivePacks,
  getBalance,
  getSignupGrantCredits,
} from '../../backend/billing/index.ts';
import type { CreditPack } from '../../backend/billing/index.ts';
import { currentUserId } from '../../lib/current-user.ts';
import { getDb } from '../../lib/db.ts';
import { getLang } from '../../lib/i18n/server.ts';
import { t } from '../../lib/i18n/messages.ts';
import { SiteHeader } from '../../components/site-header.tsx';
import { BuyButton } from './buy-button.tsx';

/** R10 (experience-improvement-plan, session 96): how many ordinary ('simple')
 * questions a pack is good for — floor, not round, so the number never
 * overpromises (same convention as account-panel.tsx's grantQuestions).
 * Exported for direct unit testing (pure, no component/render needed). */
export function questionsInPack(pack: CreditPack, simplePrice: number): number {
  return simplePrice > 0 ? Math.floor(pack.credits / simplePrice) : 0;
}

/** The €-per-question a pack implies, formatted "€X" (whole euros) or
 * "€X.XX" (a fraction) — never hardcoded, always priceCents/questions.
 * null when the pack buys fewer than one question (nothing honest to
 * divide by). Takes the already-computed `questions` (questionsInPack)
 * rather than re-deriving it, so a caller needing both numbers computes
 * questionsInPack exactly once. */
export function pricePerQuestionLabel(pack: CreditPack, questions: number): string | null {
  if (questions === 0) return null;
  const euros = pack.priceCents / 100 / questions;
  return Number.isInteger(euros) ? `€${euros}` : `€${euros.toFixed(2)}`;
}

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ purchase?: string }>;
}) {
  const userId = await currentUserId();
  if (userId === null) {
    redirect('/login');
  }

  const db = getDb();
  const [balance, packs, simplePrice, signupGrantCredits] = await Promise.all([
    getBalance(db, userId),
    getActivePacks(db),
    getActionClassPrice(db, 'simple'),
    getSignupGrantCredits(db),
  ]);
  const { purchase } = await searchParams;
  const lang = await getLang();
  // #76 explainer (account-panel.tsx convention): "roughly what the grant
  // buys" — floor() understates rather than overpromises.
  const grantQuestions = simplePrice > 0 ? Math.floor(signupGrantCredits / simplePrice) : null;

  // WP135 (ADR 033 ⟨A5⟩): the shell rides the SAME WORKSPACE_ENABLED flag as the
  // workspace. Flag off ⇒ NO header, byte-identical to today; flag on ⇒ the
  // site header like every other authenticated page.
  const showShell = process.env.WORKSPACE_ENABLED === '1';

  return (
    <>
      {showShell ? <SiteHeader balance={balance} /> : null}
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-lg">{t(lang, 'credits.pageHeading')}</h1>
      <p className="text-sm text-muted-foreground">
        {t(lang, 'credits.balancePrefix')} <strong className="tnum">{balance}</strong> {t(lang, 'credits.creditsWord')}
      </p>
      {/* R2 item 3 / R10 (experience-improvement-plan, session 96): the #76
        * explainer, previously reachable only on the dormant AccountPanel/
        * Dashboard path — restored here since /credits is not dormant. */}
      <p className="text-xs text-muted-foreground">
        {grantQuestions === null
          ? t(lang, 'account.explainerNoQuestions', { grant: signupGrantCredits, price: simplePrice })
          : t(lang, 'account.explainerWithQuestions', {
              grant: signupGrantCredits,
              price: simplePrice,
              questions: grantQuestions,
            })}
      </p>
      <p className="text-xs text-muted-foreground">{t(lang, 'credits.neverExpire')}</p>
      {purchase === 'success' ? (
        <p className="text-sm text-success">{t(lang, 'credits.purchaseSuccess')}</p>
      ) : null}
      {purchase === 'cancelled' ? <p className="text-sm text-muted-foreground">{t(lang, 'credits.purchaseCancelled')}</p> : null}
      <div className="flex flex-col gap-3">
        {packs.map((pack) => {
          const questions = questionsInPack(pack, simplePrice);
          const perQuestion = pricePerQuestionLabel(pack, questions);
          return (
          <div
            key={pack.id}
            className="flex items-center justify-between rounded-lg border border-border bg-card p-3"
          >
            <span className="flex flex-col">
              <span className="text-sm text-foreground tnum">{pack.label}</span>
              {perQuestion !== null ? (
                <span className="text-xs text-muted-foreground tnum">
                  {t(lang, 'credits.packQuestions', { questions, perQuestion })}
                </span>
              ) : null}
            </span>
            <BuyButton packId={pack.id} />
          </div>
          );
        })}
        </div>
      </div>
    </>
  );
}
