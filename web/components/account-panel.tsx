// User dashboard right-hand panel: credit balance + a link to the existing
// /credits page (pack list + Stripe checkout, WP13) rather than duplicating
// that UI here. WP19 adds the low-balance warning (open-questions #69) and
// the credits-economy explainer (#76, owner-placed: directly under the
// "Credits kopen" button). Every number here arrives as a prop read live
// from the pricing tables by the page (ADR 006: prices are config, never
// hardcoded in copy) -- so the warning threshold and the explainer track a
// price or grant change automatically.
import Link from 'next/link';
import { DeleteHistoryButton } from './delete-history-button.tsx';

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
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-paper-raised p-4">
      <div>
        <p className="text-xs text-ink-muted">Saldo</p>
        {/* WP23 (#91): tabular figures — digits align, FT/NRC-style. */}
        <p className="font-display tnum text-2xl font-semibold">{balance} credits</p>
      </div>
      {lowBalance ? (
        <p role="status" className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          Je saldo is bijna op — er is nog genoeg voor één vraag.
        </p>
      ) : null}
      <Link
        href="/credits"
        className="rounded-md bg-accent px-4 py-2 text-center text-sm font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Credits kopen
      </Link>
      <p className="text-xs text-ink-muted">
        {`Bij aanmelding krijg je eenmalig ${signupGrantCredits} credits. Een gewone vraag kost ${simplePrice} credits` +
          (grantQuestions === null
            ? '.'
            : ` — ${signupGrantCredits} credits zijn dus goed voor zo'n ${grantQuestions} vragen.`)}
      </p>
      {/* #14 (GDPR self-service deletion): own row, visually separated from
        * the buy-credits flow above -- a destructive account action, not
        * part of the purchase funnel. */}
      <div className="border-t border-line pt-3">
        <DeleteHistoryButton />
      </div>
    </div>
  );
}
