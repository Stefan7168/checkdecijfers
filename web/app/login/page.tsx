import { LoginForm } from './login-form.tsx';
import { SiteHeader } from '../../components/site-header.tsx';

export default function LoginPage() {
  // WP135 (ADR 033 ⟨A5⟩): flag off ⇒ byte-identical to today (no header); flag
  // on ⇒ the STRIPPED header (wordmark only — /login is public, no balance/menu).
  const showShell = process.env.WORKSPACE_ENABLED === '1';
  return (
    <>
      {showShell ? <SiteHeader stripped /> : null}
      <div className="mx-auto flex h-dvh w-full max-w-md flex-col justify-center gap-4 p-4">
        <h1 className="text-lg font-semibold">Inloggen — Check de Cijfers</h1>
        <p className="text-sm text-zinc-500">
          Vul je e-mailadres in; je krijgt een inloglink toegestuurd. Geen wachtwoord nodig.
        </p>
        <LoginForm />
      </div>
    </>
  );
}
