import { getLang } from '../../lib/i18n/server.ts';
import { t } from '../../lib/i18n/messages.ts';
import { LoginForm } from './login-form.tsx';
import { SiteHeader } from '../../components/site-header.tsx';

// WP135 cosmetic residual (open-questions #135, found at the session-42
// go-live): this page was statically PRERENDERED, so the WORKSPACE_ENABLED
// read below was frozen at build time — where the flag isn't set — and the
// stripped header never rendered in production. Render per request instead
// (the flag is a runtime env; /login traffic is negligible).
export const dynamic = 'force-dynamic';

// WP218 phase 4 (#219): Server Component, so it takes lang from getLang()
// directly rather than useT().
export default async function LoginPage() {
  const lang = await getLang();
  // WP135 (ADR 033 ⟨A5⟩): flag off ⇒ byte-identical to today (no header); flag
  // on ⇒ the STRIPPED header (wordmark only — /login is public, no balance/menu).
  const showShell = process.env.WORKSPACE_ENABLED === '1';
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {showShell ? <SiteHeader stripped /> : null}
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-4">
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">{t(lang, 'login.pageHeading')}</h1>
            <p className="text-sm text-muted-foreground">{t(lang, 'login.pageBody')}</p>
          </div>
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
