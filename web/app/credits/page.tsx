// Credit balance + pack purchase (WP13, ADR 006 seams 2-4). Server Component:
// balance and pack list are read directly, no client round-trip needed.
import { redirect } from 'next/navigation';
import { getActivePacks, getBalance } from '../../backend/billing/index.ts';
import { currentUserId } from '../../lib/current-user.ts';
import { getDb } from '../../lib/db.ts';
import { SiteHeader } from '../../components/site-header.tsx';
import { BuyButton } from './buy-button.tsx';

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
  const [balance, packs] = await Promise.all([getBalance(db, userId), getActivePacks(db)]);
  const { purchase } = await searchParams;

  // WP135 (ADR 033 ⟨A5⟩): the shell rides the SAME WORKSPACE_ENABLED flag as the
  // workspace. Flag off ⇒ NO header, byte-identical to today; flag on ⇒ the
  // site header like every other authenticated page.
  const showShell = process.env.WORKSPACE_ENABLED === '1';

  return (
    <>
      {showShell ? <SiteHeader balance={balance} /> : null}
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-lg">Credits — Check de Cijfers</h1>
      <p className="text-sm text-ink-soft">
        Je huidige saldo: <strong className="tnum">{balance}</strong> credits.
      </p>
      {purchase === 'success' ? (
        <p className="text-sm text-ok">
          Betaling gelukt — je credits worden bijgeschreven zodra Stripe de betaling bevestigt.
        </p>
      ) : null}
      {purchase === 'cancelled' ? <p className="text-sm text-ink-muted">Betaling geannuleerd.</p> : null}
      <div className="flex flex-col gap-3">
        {packs.map((pack) => (
          <div
            key={pack.id}
            className="flex items-center justify-between rounded-lg border border-line bg-paper-raised p-3"
          >
            <span className="text-sm text-ink tnum">{pack.label}</span>
            <BuyButton packId={pack.id} />
          </div>
        ))}
        </div>
      </div>
    </>
  );
}
