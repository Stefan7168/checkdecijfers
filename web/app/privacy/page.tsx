// /privacy — WP-B (journey programme phase 3 R5.1/R5.4,
// docs/superpowers/plans/2026-09-12-journey-programme.md). Public, LLM-free
// Server Component drawn from docs/04-architecture.md's GDPR section and
// docs/05-data-rules.md's retention rules: what is stored (questions +
// answers as an audit trail, account e-mail), retention (2 years for
// account rows, 90 days for anonymous-trial rows — ADR 036 D4/#181),
// self-service deletion (Account menu), that questions transit an LLM
// provider (Anthropic) to be parsed and phrased — never the raw CBS
// statistics, Stripe as payment processor, no analytics cookies (only the
// session cookie), and a contact placeholder the owner fills in. Marked
// with a visible draft note (decision 9). Same shell as /credits.
import { getLang } from '../../lib/i18n/server.ts';
import { t } from '../../lib/i18n/messages.ts';
import { SiteHeader } from '../../components/site-header.tsx';

export default async function PrivacyPage() {
  const lang = await getLang();
  const showShell = process.env.WORKSPACE_ENABLED === '1';

  return (
    <>
      {showShell ? <SiteHeader /> : null}
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4">
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          {t(lang, 'trust.draftNote')}
        </p>
        <h1 className="text-2xl text-foreground">{t(lang, 'privacy.heading')}</h1>

        <section>
          <h2 className="text-lg text-foreground">{t(lang, 'privacy.storedHeading')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, 'privacy.storedBody')}</p>
        </section>

        <section>
          <h2 className="text-lg text-foreground">{t(lang, 'privacy.retentionHeading')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, 'privacy.retentionBody')}</p>
        </section>

        <section>
          <h2 className="text-lg text-foreground">{t(lang, 'privacy.llmHeading')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, 'privacy.llmBody')}</p>
        </section>

        <section>
          <h2 className="text-lg text-foreground">{t(lang, 'privacy.paymentHeading')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, 'privacy.paymentBody')}</p>
        </section>

        <section>
          <h2 className="text-lg text-foreground">{t(lang, 'privacy.cookiesHeading')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, 'privacy.cookiesBody')}</p>
        </section>

        <section>
          <h2 className="text-lg text-foreground">{t(lang, 'privacy.contactHeading')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, 'privacy.contactBody')}</p>
        </section>
      </div>
    </>
  );
}
