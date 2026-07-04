// User dashboard right-hand panel: credit balance + a link to the existing
// /credits page (pack list + Stripe checkout, WP13) rather than duplicating
// that UI here. A plain container -- more widgets slot in as siblings later,
// nothing stubbed out ahead of being designed.
import Link from 'next/link';

export function AccountPanel({ balance }: { balance: number }) {
  return (
    <div className="flex flex-col gap-3 rounded border border-zinc-200 p-4">
      <div>
        <p className="text-xs text-zinc-500">Saldo</p>
        <p className="text-2xl font-semibold">{balance} credits</p>
      </div>
      <Link
        href="/credits"
        className="rounded bg-blue-600 px-4 py-2 text-center text-sm font-medium text-white"
      >
        Credits kopen
      </Link>
    </div>
  );
}
