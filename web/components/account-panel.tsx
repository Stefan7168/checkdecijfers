// User dashboard right-hand panel: credit balance + a link to the existing
// /credits page (pack list + Stripe checkout, WP13) rather than duplicating
// that UI here. WP19 adds the low-balance warning (open-questions #69) and
// the credits-economy explainer (#76, owner-placed: directly under the
// "Credits kopen" button). Every number here arrives as a prop read live
// from the pricing tables by the page (ADR 006: prices are config, never
// hardcoded in copy) -- so the warning threshold and the explainer track a
// price or grant change automatically.
import Link from 'next/link';

export function AccountPanel({
  balance,
  simplePrice,
  signupGrantCredits,
}: {
  balance: number;
  /** The live 'simple' action-class price (getActionClassPrice). */
  simplePrice: number;
  /** The live signup grant (getSignupGrantCredits). */
  signupGrantCredits: number;
}) {
  // Owner-decided threshold (#69): warn exactly when the balance still covers
  // one more simple question but not two. Below that, the existing
  // insufficient_credits refusal takes over -- deliberately no banner there.
  const lowBalance = simplePrice > 0 && balance >= simplePrice && balance < simplePrice * 2;
  // "Roughly what the grant buys": clarifications cost less than a simple
  // question, so floor() plus "zo'n" understates rather than overpromises.
  const grantQuestions = simplePrice > 0 ? Math.floor(signupGrantCredits / simplePrice) : null;

  return (
    <div className="flex flex-col gap-3 rounded border border-zinc-200 p-4">
      <div>
        <p className="text-xs text-zinc-500">Saldo</p>
        <p className="text-2xl font-semibold">{balance} credits</p>
      </div>
      {lowBalance ? (
        <p role="status" className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Je saldo is bijna op — er is nog genoeg voor één vraag.
        </p>
      ) : null}
      <Link
        href="/credits"
        className="rounded bg-blue-600 px-4 py-2 text-center text-sm font-medium text-white"
      >
        Credits kopen
      </Link>
      <p className="text-xs text-zinc-500">
        {`Bij aanmelding krijg je eenmalig ${signupGrantCredits} credits. Een gewone vraag kost ${simplePrice} credits` +
          (grantQuestions === null
            ? '.'
            : ` — ${signupGrantCredits} credits zijn dus goed voor zo'n ${grantQuestions} vragen.`)}
      </p>
    </div>
  );
}
