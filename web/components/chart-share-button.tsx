'use client';
// WP-LOOK part (a) (session 142, 2026-09-29, ADR 063): the card's "Share"
// action — the owner's fifth button (open-questions #346). Cheapest viable
// mechanism (CLAUDE.md conventions): no new route, no schema, no AI call —
// it copies a link to the chart's PUBLIC embed page (`/embed/<token>`, the
// same signed token `ChartEmbedButton` already mints via `createEmbedCode`),
// which is a complete standalone page with the chart, its source line and
// the "Frozen on …" footer. Gated exactly like Embed by the caller: only for
// a saved answer (`embed.auditId`), never in table form / small multiples /
// embed or stage mode, and disabled while a non-primary reading is shown
// (the token republishes the PRIMARY audit row, #254).
//
// The button announces its own outcome in place (aria-live) instead of a
// toast: "Link copied", or the reason it did not work. Every string is a
// digit-free catalogue string (the whole-card digit scan, R6/#254, is
// unaffected).
import { Check, Link2 } from 'lucide-react';
import { UTILITY_ACTION_BUTTON_CLASS, UTILITY_ACTION_LABEL_CLASS } from '../lib/chart-action-row.ts';
import { useEffect, useState } from 'react';
import { createEmbedCode } from '../app/embed-actions.ts';
import { t, type Lang } from '../lib/i18n/messages.ts';
import { APP_URL } from './chart-embed-dialog.tsx';
import { Button } from './ui/button.tsx';

type ShareStatus = 'idle' | 'busy' | 'copied' | 'failed' | 'signIn';

/** The public page URL for a share link — `theme=auto` so the page follows
 * the reader's own device, the chart form as shown (the embed route
 * structurally refuses `form=table` and falls back to the spec's default,
 * so a table never leaks through here either). */
export function buildShareUrl(token: string, opts: { lang: Lang; form: string | null }): string {
  const params = new URLSearchParams({ lang: opts.lang, theme: 'auto' });
  if (opts.form) params.set('form', opts.form);
  return `${APP_URL}/embed/${token}?${params.toString()}`;
}

/** WP-LOOK part (a2) round 2 (session 144): the picture a Share link unfurls
 * with, as a file — the same route the embed page's metadata points at
 * (app/embed/[token]/preview/route.tsx), with the shown form and the
 * download flag that makes the browser save it instead of showing it. */
export function buildSharePreviewDownloadUrl(token: string, form: string | null): string {
  const params = new URLSearchParams({ download: '1' });
  if (form) params.set('form', form);
  return `${APP_URL}/embed/${token}/preview?${params.toString()}`;
}

export function ChartShareButton({
  auditId,
  lang,
  currentForm,
  disabled = false,
}: {
  auditId: number;
  lang: Lang;
  currentForm: string | null;
  /** True while a non-primary reading is selected (same rule as Embed). */
  disabled?: boolean;
}) {
  const [status, setStatus] = useState<ShareStatus>('idle');

  useEffect(() => {
    if (status !== 'copied' && status !== 'failed' && status !== 'signIn') return;
    const id = setTimeout(() => setStatus('idle'), 3000);
    return () => clearTimeout(id);
  }, [status]);

  async function share(): Promise<void> {
    setStatus('busy');
    try {
      const r = await createEmbedCode(auditId);
      if (!r.ok) {
        setStatus(r.reason === 'unauthenticated' ? 'signIn' : 'failed');
        return;
      }
      await navigator.clipboard.writeText(buildShareUrl(r.token, { lang, form: currentForm }));
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  }

  const label =
    status === 'copied'
      ? t(lang, 'chart.share.copied')
      : status === 'failed'
        ? t(lang, 'chart.share.failed')
        : status === 'signIn'
          ? t(lang, 'chart.share.signIn')
          : t(lang, 'chart.share.trigger');

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => void share()}
      disabled={disabled || status === 'busy'}
      title={disabled ? t(lang, 'chart.embed.readingDisabledReason') : t(lang, 'chart.share.hint')}
      aria-live="polite"
      data-slot="chart-share"
      className={UTILITY_ACTION_BUTTON_CLASS}
    >
      {/* Round 2 (session 143): the word collapses to sr-only below the
        * action row's 32rem width (web/lib/chart-action-row.ts) — so the
        * "copied" confirmation also shows as a tick in the icon, not only
        * in the (then invisible) word. aria-live still announces it. */}
      {status === 'copied' ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
      <span className={UTILITY_ACTION_LABEL_CLASS} data-slot="chart-action-label">
        {label}
      </span>
    </Button>
  );
}
