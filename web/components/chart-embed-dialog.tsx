// Task 4 (spec Part B1, session 92 design doc): the footer "Insluiten"/
// "Embed" button and its pop-up dialog — the reader-facing half of the
// embed feature (Task 1's signed token, Task 2's createEmbedCode action,
// Task 3's ChartView embedMode). Mounted at the marked point in chart.tsx's
// footer, gated exactly like ChartDownloadMenu (Download's own sibling
// button in the same row).
//
// i18n: this file translates via the plain `t(lang, key)` function, NOT the
// `useT()` context hook — mirroring chart.tsx's own convention (every
// `t(chartLang, …)` call in that file) and ChartDownloadMenu's identical
// `lang` prop (chart-download.tsx). chart.tsx already resolves `chartLang`
// itself and passes it down explicitly to this component's sibling
// (`<ChartDownloadMenu lang={chartLang} … />`), so there is no ambient
// LangProvider dependency here — a bare `render()` in a test behaves
// identically to production. `lang` is this component's OWN chrome
// language; `embedLang` (state, below) is a SEPARATE, independently
// switchable field — which language the GENERATED EMBED renders in — merely
// seeded from `lang` as a sensible default.
//
// Dialog shell: shadcn's `add dialog` (Base UI-backed, same registry as the
// session-90 dropdown-menu precedent) was tried first per the plan, smoke
// -tested against this project's jsdom/vitest setup, and works cleanly
// (role="dialog", Escape-to-close, and focus-trap/restore all verified) —
// ONE local fix was needed: the generated web/components/ui/dialog.tsx
// imported its own Button via the `@/components/ui/button` tsconfig path
// alias, which tsc/Next resolve but Vite/vitest do not (no
// vite-tsconfig-paths plugin, no resolve.alias here) — repointed to the
// relative `./button.tsx` instead (see that import site's own comment in
// ui/dialog.tsx). Correction (fix round, opus review): this is NOT an
// existing convention — it is the FIRST cross-ui/-file relative import in
// the repo; every other ui/*.tsx file imports only `cn` from the real npm
// package plus external packages. No hand-rolled modal was needed as a
// result.
//
// Task 3 (chart-visual-embed-pass, session 101): `ChartEmbedDialog` no
// longer renders `Dialog`/`DialogContent` itself — its content now mounts
// inside the shared `ChartEditModal` shell (chart-edit-modal.tsx), which
// wraps this SAME Base UI Dialog primitive and adds the chart-on-the-left/
// controls-on-the-right split pane, mirroring the Style editor. Everything
// above about the primitive itself (jsdom/vitest compatibility, the
// relative-import fix) still applies — it now lives one layer up.
'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createEmbedCode, startProSubscriptionCheckout } from '../app/embed-actions.ts';
import { trackChartStyleEvent } from '../lib/chart-usage-client.ts';
import { t, type Lang, type MessageKey } from '../lib/i18n/messages.ts';
import { ChartEditModal } from './chart-edit-modal.tsx';
import { Button } from './ui/button.tsx';

// Exported (final review, Important #1): chart.tsx's own embed-footer
// backlink needs this SAME resolved origin — before this fix it hardcoded
// `https://checkdecijfers.nl` directly, which currently resolves to
// Namecheap's parked nameservers, not this app (production is
// `https://checkdecijfers.vercel.app`; the real domain isn't even confirmed
// yet, docs/open-questions.md #7) — making every embed's only outbound link
// dead on arrival. One shared constant means the iframe `src` this dialog
// generates and the backlink `href` chart.tsx renders can never disagree.
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://checkdecijfers.nl';

type ColourOption = 'light' | 'dark' | 'auto';
type ChartTypeOption = 'as-shown' | 'default';

const COLOUR_OPTIONS: readonly ColourOption[] = ['light', 'dark', 'auto'];
const COLOUR_LABEL_KEY: Record<ColourOption, MessageKey> = {
  light: 'chart.embed.colourLight',
  dark: 'chart.embed.colourDark',
  auto: 'chart.embed.colourAuto',
};

const CHART_TYPE_OPTIONS: readonly ChartTypeOption[] = ['as-shown', 'default'];
const CHART_TYPE_LABEL_KEY: Record<ChartTypeOption, MessageKey> = {
  'as-shown': 'chart.embed.chartTypeAsShown',
  default: 'chart.embed.chartTypeDefault',
};

function buildEmbedCode(
  token: string,
  opts: { lang: Lang; colour: ColourOption; chartType: ChartTypeOption; currentForm: string | null; live: boolean },
  title: string,
): string {
  const params = new URLSearchParams({ lang: opts.lang, theme: opts.colour });
  if (opts.chartType === 'as-shown' && opts.currentForm) params.set('form', opts.currentForm);
  if (opts.live) params.set('live', '1');
  return `<iframe src="${APP_URL}/embed/${token}?${params.toString()}" width="100%" height="440" title="${title}" loading="lazy" style="border:0"></iframe>`;
}

export function ChartEmbedButton({
  auditId,
  tableId,
  lang,
  currentForm = null,
  open,
  onOpenChange,
  chartSlot,
  disabled = false,
}: {
  auditId: number;
  tableId: string;
  lang: Lang;
  /** The chart's currently-displayed form (e.g. 'line'/'bar'), for the
   * "As shown" option — null when the caller doesn't track it, in which
   * case "As shown" degrades to the spec's own default (same as omitting
   * `form` from the query string). */
  currentForm?: string | null;
  // Task 3 (chart-visual-embed-pass): controlled, mirroring
  // ChartConfigPanel's own open/onOpenChange contract — chart.tsx lifts this
  // into its shared `openPanel` state so Style/Story/Embed share one slot.
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The live chart canvas + legend, lifted from chart.tsx — rendered inside
   * the embed modal's left pane, mirroring the Style editor's chartSlot. */
  chartSlot: ReactNode;
  /** #254 Task 6 addendum: true while a non-primary reading is selected. An
   * embed always republishes the PRIMARY reading (the stored audit row
   * carries no reading selection — `/embed/[token]` has no chartAlternates
   * concept at all, deliberately out of scope for this feature), but the
   * dialog's live preview shows whatever is currently on screen — which,
   * once a reader can switch readings, could be an alternate. Without this,
   * a reader could switch to an alternate, click Embed, see the alternate's
   * own data in the preview, and copy code believing it publishes THAT —
   * when it always publishes the primary instead. Same disabled-with-a-
   * reason convention as chart.tsx's own Lijn/Vlak/Liggend tabs and story
   * lock: `disabled` + `title` (pointer) + `aria-describedby` (screen
   * reader/keyboard) pointing at a co-located `sr-only` reason span, both
   * owned entirely by this component so the caller only ever passes the one
   * boolean. */
  disabled?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const disabledReasonId = useId();

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        title={disabled ? t(lang, 'chart.embed.readingDisabledReason') : undefined}
        aria-describedby={disabled ? disabledReasonId : undefined}
        onClick={() => onOpenChange(true)}
      >
        {t(lang, 'chart.embed.trigger')}
      </Button>
      {disabled ? (
        <span id={disabledReasonId} className="sr-only">
          {t(lang, 'chart.embed.readingDisabledReason')}
        </span>
      ) : null}
      {open ? (
        <ChartEmbedDialog
          auditId={auditId}
          tableId={tableId}
          lang={lang}
          currentForm={currentForm}
          chartSlot={chartSlot}
          onClose={() => {
            onOpenChange(false);
            triggerRef.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

function ChartEmbedDialog({
  auditId,
  tableId,
  lang,
  currentForm,
  chartSlot,
  onClose,
}: {
  auditId: number;
  tableId: string;
  lang: Lang;
  currentForm: string | null;
  chartSlot: ReactNode;
  onClose: () => void;
}) {
  const [result, setResult] = useState<{ token: string; pro: boolean } | 'loading' | 'unavailable'>('loading');
  const [embedLang, setEmbedLang] = useState<Lang>(lang);
  const [colour, setColour] = useState<ColourOption>('light');
  const [chartType, setChartType] = useState<ChartTypeOption>('as-shown');
  const [live, setLive] = useState(false);
  const [copied, setCopied] = useState(false);
  // Session 101 (open-questions #237(b)/#205): the Pro pitch is visible to
  // everyone. Task 11 gives the click a real branch: PRO_SUBSCRIPTIONS_ENABLED
  // on → startProSubscriptionCheckout() redirects to a real Stripe Checkout
  // session (a charge, a real upgrade); off (or the fail-safe
  // not-signed-in case, below) → the original interest-only click count
  // (`pro_upgrade_click`, the same anonymous chart_style_usage counter every
  // other event here uses), never a charge. Local-only state: a fresh
  // dialog open always shows the CTA again, exactly like `copied` above
  // never persisting either.
  const [upgradeClicked, setUpgradeClicked] = useState(false);
  // Task 11: a slow Checkout-session round trip (network + Stripe) must not
  // look like a dead click before window.location.href takes over.
  const [checkingOut, setCheckingOut] = useState(false);
  const liveSwitchId = useId();
  const liveReasonId = useId();

  // Fires exactly once per mount (this component only EXISTS while the
  // dialog is open — ChartEmbedButton conditionally mounts it — so "once per
  // mount" IS "once per open"), matching every other *_open counter
  // (story_open, panel_open) elsewhere in chart.tsx.
  useEffect(() => {
    let cancelled = false;
    createEmbedCode(auditId)
      .then((r) => {
        if (cancelled) return;
        setResult(r.ok ? { token: r.token, pro: r.pro } : 'unavailable');
      })
      .catch(() => {
        // A rejected Server Action promise (e.g. Next's
        // UnrecognizedActionError, per chat.tsx's own precedent for this
        // failure mode) must not leave the dialog stuck on "loading"
        // forever with an unhandled rejection — collapse to the same
        // terminal 'unavailable' state the `{ ok: false }` branch already
        // uses above.
        if (cancelled) return;
        setResult('unavailable');
      });
    trackChartStyleEvent('embed_open');
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auditId is the only input that should ever re-trigger this fetch.
  }, [auditId]);

  const code =
    result === 'loading' || result === 'unavailable'
      ? null
      : buildEmbedCode(
          result.token,
          { lang: embedLang, colour, chartType, currentForm, live },
          `checkdecijfers.nl — ${tableId}`,
        );

  return (
    <ChartEditModal open onClose={onClose} title={t(lang, 'chart.embed.dialogTitle')} chartSlot={chartSlot}>
      <p className="text-sm text-muted-foreground">{t(lang, 'chart.embed.dialogExplain')}</p>

      {result === 'loading' ? <p className="text-xs text-muted-foreground">{t(lang, 'chart.embed.loading')}</p> : null}
      {result === 'unavailable' ? <p className="text-xs text-destructive">{t(lang, 'chart.embed.unavailable')}</p> : null}

      {code !== null && result !== 'loading' && result !== 'unavailable' ? (
        <>
          <fieldset>
            <legend className="text-xs text-muted-foreground">{t(lang, 'chart.embed.languageLabel')}</legend>
            <label className="mr-3 text-xs">
              <input type="radio" name="embed-lang" checked={embedLang === 'nl'} onChange={() => setEmbedLang('nl')} />{' '}
              {t(lang, 'chart.panel.languageNl')}
            </label>
            <label className="text-xs">
              <input type="radio" name="embed-lang" checked={embedLang === 'en'} onChange={() => setEmbedLang('en')} />{' '}
              {t(lang, 'chart.panel.languageEn')}
            </label>
          </fieldset>

          <fieldset>
            <legend className="text-xs text-muted-foreground">{t(lang, 'chart.embed.colourLabel')}</legend>
            {COLOUR_OPTIONS.map((c) => (
              <label key={c} className="mr-3 text-xs">
                <input type="radio" name="embed-colour" checked={colour === c} onChange={() => setColour(c)} />{' '}
                {t(lang, COLOUR_LABEL_KEY[c])}
              </label>
            ))}
          </fieldset>

          <fieldset>
            <legend className="text-xs text-muted-foreground">{t(lang, 'chart.embed.chartTypeLabel')}</legend>
            {CHART_TYPE_OPTIONS.map((ct) => (
              <label key={ct} className="mr-3 text-xs">
                <input type="radio" name="embed-type" checked={chartType === ct} onChange={() => setChartType(ct)} />{' '}
                {t(lang, CHART_TYPE_LABEL_KEY[ct])}
              </label>
            ))}
          </fieldset>

          <div className="flex items-center gap-2">
            <input
              role="switch"
              type="checkbox"
              id={liveSwitchId}
              checked={live}
              disabled={!result.pro}
              aria-describedby={!result.pro ? liveReasonId : undefined}
              onChange={(e) => setLive(e.target.checked)}
            />
            <label htmlFor={liveSwitchId} className="text-xs">
              {t(lang, 'chart.embed.liveLabel')}
            </label>
            {!result.pro ? (
              <span id={liveReasonId} className="text-xs text-muted-foreground">
                {t(lang, 'chart.embed.liveProOnly')} {t(lang, 'chart.embed.proPrice')}
              </span>
            ) : null}
          </div>

          {!result.pro ? (
            <div>
              {upgradeClicked ? (
                <p className="text-xs text-muted-foreground">{t(lang, 'chart.embed.proUpgradeThanks')}</p>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={checkingOut}
                  onClick={async () => {
                    setCheckingOut(true);
                    const result = await startProSubscriptionCheckout();
                    if (result.ok) {
                      window.location.href = result.url;
                      return; // navigating away; no need to reset checkingOut
                    }
                    // Flag off, not signed in (shouldn't happen — this
                    // dialog only mounts for a signed-in embed creator,
                    // but fail safe), or a transient Stripe/checkout
                    // failure (`checkout_failed` — review fix round) —
                    // every non-ok reason falls through identically to
                    // the original interest-tracking behaviour, never
                    // leaves the button stuck disabled. See the
                    // `upgradeClicked` declaration above.
                    setCheckingOut(false);
                    trackChartStyleEvent('pro_upgrade_click');
                    setUpgradeClicked(true);
                  }}
                >
                  {t(lang, 'chart.embed.proUpgradeCta')}
                </Button>
              )}
            </div>
          ) : null}

          <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-xs">{code}</pre>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(code);
                  // embed_copy counts a real, successful copy only —
                  // mirrors chart.tsx's own default_saved/default_forgotten
                  // precedent, which fires its tracking call solely inside
                  // the `if (r.ok)` branch of a fallible operation, never
                  // unconditionally after it. Both lines below must stay
                  // inside this try, after the await above succeeds.
                  setCopied(true);
                  trackChartStyleEvent('embed_copy');
                } catch {
                  // Clipboard API unavailable/refused — the visible <pre>
                  // above is the manual-copy fallback; a caught failure
                  // just means the button doesn't flip to "Copied!" and
                  // embed_copy does not fire. Nothing further to do here.
                }
              }}
            >
              {copied ? t(lang, 'chart.embed.copyCodeCopied') : t(lang, 'chart.embed.copyCode')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {t(lang, 'chart.embed.close')}
            </Button>
          </div>
        </>
      ) : null}
    </ChartEditModal>
  );
}
