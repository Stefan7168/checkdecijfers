// Credit balance + pack purchase (WP13, ADR 006 seams 2-4). Server Component:
// balance and pack list are read directly, no client round-trip needed.
import { redirect } from 'next/navigation';
import { getActivePacks, getBalance } from '../../backend/billing/index.ts';
import { currentUserId } from '../../lib/current-user.ts';
import { getDb } from '../../lib/db.ts';
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

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">Credits — Check de Cijfers</h1>
      <p className="text-sm text-zinc-700">
        Je huidige saldo: <strong>{balance}</strong> credits.
      </p>
      {purchase === 'success' ? (
        <p className="text-sm text-green-700">
          Betaling gelukt — je credits worden bijgeschreven zodra Stripe de betaling bevestigt.
        </p>
      ) : null}
      {purchase === 'cancelled' ? <p className="text-sm text-zinc-500">Betaling geannuleerd.</p> : null}
      <div className="flex flex-col gap-3">
        {packs.map((pack) => (
          <div key={pack.id} className="flex items-center justify-between rounded border border-zinc-300 p-3">
            <span className="text-sm">{pack.label}</span>
            <BuyButton packId={pack.id} />
          </div>
        ))}
      </div>
    </div>
  );
}
