// Credit balance + pack purchase (WP13, ADR 006 seams 2-4). Server Component:
// balance and pack list are read directly, no client round-trip needed.
import { redirect } from 'next/navigation';
import { getActionClassPrice, getActivePacks, getBalance, getSignupGrantCredits } from '../../backend/billing/index.ts';
import { currentUserId } from '../../lib/current-user.ts';
import { getDb } from '../../lib/db.ts';
import { getLang } from '../../lib/i18n/server.ts';
import { t } from '../../lib/i18n/messages.ts';
import { SiteHeader } from '../../components/site-header.tsx';
import { BuyButton } from './buy-button.tsx';

// R10 (journey WP-C): the pack list gets a per-pack "≈ N gewone vragen" and
// a €/question line. Both computed HERE, server-side, from the pack's own
// priceCents/credits and the LIVE 'simple' action-class price — never a
// client recomputation (CLAUDE.md: the client never recomputes a cost or
// balance) and never hardcoded (ADR 006). floor() understates rather than
// overpromises, mirroring account-panel.tsx's grantQuestions convention.
// The number format follows the page language rather than being pinned to
// nl-NL: an English reader gets en-GB grouping/decimals for the same euro
// amount. Currency stays EUR — the price itself is not language-dependent.
const EUR_FORMATS = {
  nl: new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }),
  en: new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR' }),
} as const;

// Row 7 (session 110 UX audit): plain integer counts (a pack's own credits,
// the "≈N questions" line) get the same per-language grouping as the euro
// amounts above — nl-NL's "25.000" vs. en-GB's "25,000" — instead of one
// long unseparated digit run.
const COUNT_FORMATS = {
  nl: new Intl.NumberFormat('nl-NL'),
  en: new Intl.NumberFormat('en-GB'),
} as const;

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ purchase?: string; pro?: string }>;
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
  const { purchase, pro } = await searchParams;
  const lang = await getLang();
  const eurFormat = EUR_FORMATS[lang];
  const countFormat = COUNT_FORMATS[lang];

  // WP135 (ADR 033 ⟨A5⟩): the shell rides the SAME WORKSPACE_ENABLED flag as the
  // workspace. Flag off ⇒ NO header, byte-identical to today; flag on ⇒ the
  // site header like every other authenticated page.
  const showShell = process.env.WORKSPACE_ENABLED === '1';

  // #76 explainer, reused verbatim from account-panel.tsx (the floor()
  // convention: clarifications cost less than a simple question, so
  // understating "roughly what the grant buys" is the honest direction).
  const grantQuestions = simplePrice > 0 ? Math.floor(signupGrantCredits / simplePrice) : null;

  return (
    <>
      {showShell ? <SiteHeader balance={balance} /> : null}
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-lg">{t(lang, 'credits.pageHeading')}</h1>
      <p className="text-sm text-muted-foreground">
        {t(lang, 'credits.balancePrefix')} <strong className="tnum">{balance}</strong> {t(lang, 'credits.creditsWord')}
      </p>
      <p className="text-xs text-muted-foreground">
        {grantQuestions === null
          ? t(lang, 'account.explainerNoQuestions', { grant: signupGrantCredits, price: simplePrice })
          : t(lang, 'account.explainerWithQuestions', {
              grant: signupGrantCredits,
              price: simplePrice,
              questions: grantQuestions,
            })}
      </p>
      {purchase === 'success' ? (
        <p className="text-sm text-success">{t(lang, 'credits.purchaseSuccess')}</p>
      ) : null}
      {purchase === 'cancelled' ? <p className="text-sm text-muted-foreground">{t(lang, 'credits.purchaseCancelled')}</p> : null}
      {/* Task 11 (#205): the Pro subscription Checkout's own success/cancel
        * pair (web/lib/purchase.ts's proSuccessUrl/proCancelledUrl), on a
        * SEPARATE `pro` query param so it can never collide with the
        * one-time credit-pack flow's `purchase` param above — same inline,
        * no-client-state pattern as that pair, just its own copy. */}
      {pro === 'success' ? <p className="text-sm text-success">{t(lang, 'credits.proSuccess')}</p> : null}
      {pro === 'cancelled' ? <p className="text-sm text-muted-foreground">{t(lang, 'credits.proCancelled')}</p> : null}
      <div className="flex flex-col gap-3">
        {packs.map((pack) => {
          // A pack's own questions/€-per-question, from ITS priceCents/credits
          // and the live simple price — never the balance, never a hardcoded
          // number. simplePrice <= 0 (a misconfigured price row) suppresses
          // both lines rather than dividing by zero or showing a lie.
          const packQuestions = simplePrice > 0 ? Math.floor(pack.credits / simplePrice) : null;
          const pricePerQuestion = packQuestions !== null && packQuestions > 0 ? pack.priceCents / 100 / packQuestions : null;
          // Row 7: the pack's own price/credits line and (row 13) the Buy
          // button's accessible name are both built from the SAME two
          // pre-formatted values — never the DB-stored `label` (a fixed
          // Dutch string) and never a bare, unformatted number.
          const priceFormatted = eurFormat.format(pack.priceCents / 100);
          const creditsFormatted = countFormat.format(pack.credits);
          const packLabel = t(lang, 'credits.packLabel', { price: priceFormatted, credits: creditsFormatted });
          const buyAriaLabel = t(lang, 'credits.buyAriaLabel', { price: priceFormatted, credits: creditsFormatted });
          return (
            <div
              key={pack.id}
              className="flex items-center justify-between rounded-lg border border-border bg-card p-3"
            >
              <div className="flex flex-col">
                <span className="text-sm text-foreground tnum">{packLabel}</span>
                {packQuestions !== null ? (
                  <span className="text-xs text-muted-foreground tnum">
                    {t(lang, 'credits.packQuestions', { n: countFormat.format(packQuestions) })}
                    {pricePerQuestion !== null
                      ? ` · ${t(lang, 'credits.packPricePerQuestion', { price: eurFormat.format(pricePerQuestion) })}`
                      : ''}
                  </span>
                ) : null}
              </div>
              <BuyButton packId={pack.id} packDescription={buyAriaLabel} />
            </div>
          );
        })}
        </div>
        <p className="text-xs text-muted-foreground">{t(lang, 'credits.neverExpires')}</p>
      </div>
    </>
  );
}
