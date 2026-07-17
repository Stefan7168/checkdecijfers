import { LoginForm } from './login-form.tsx';
import { SiteHeader } from '../../components/site-header.tsx';

export default function LoginPage() {
  // WP135 (ADR 033 ⟨A5⟩): flag off ⇒ byte-identical to today (no header); flag
  // on ⇒ the STRIPPED header (wordmark only — /login is public, no balance/menu).
  const showShell = process.env.WORKSPACE_ENABLED === '1';
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      {showShell ? <SiteHeader stripped /> : null}
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-4">
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-paper-raised p-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">Inloggen — Check de Cijfers</h1>
            <p className="text-sm text-ink-soft">
              Vul je e-mailadres in; je krijgt een inloglink toegestuurd. Geen wachtwoord nodig.
            </p>
          </div>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
