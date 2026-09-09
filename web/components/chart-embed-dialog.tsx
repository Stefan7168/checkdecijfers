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
// relative `./button.tsx` all sibling ui/*.tsx files already use. No
// hand-rolled modal was needed as a result.
'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createEmbedCode } from '../app/embed-actions.ts';
import { trackChartStyleEvent } from '../lib/chart-usage-client.ts';
import { t, type Lang, type MessageKey } from '../lib/i18n/messages.ts';
import { Button } from './ui/button.tsx';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog.tsx';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://checkdecijfers.nl';

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
}: {
  auditId: number;
  tableId: string;
  lang: Lang;
  /** The chart's currently-displayed form (e.g. 'line'/'bar'), for the
   * "As shown" option — null when the caller doesn't track it, in which
   * case "As shown" degrades to the spec's own default (same as omitting
   * `form` from the query string). */
  currentForm?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Button ref={triggerRef} type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t(lang, 'chart.embed.trigger')}
      </Button>
      {open ? (
        <ChartEmbedDialog
          auditId={auditId}
          tableId={tableId}
          lang={lang}
          currentForm={currentForm}
          onClose={() => {
            setOpen(false);
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
  onClose,
}: {
  auditId: number;
  tableId: string;
  lang: Lang;
  currentForm: string | null;
  onClose: () => void;
}) {
  const [result, setResult] = useState<{ token: string; pro: boolean } | 'loading' | 'unavailable'>('loading');
  const [embedLang, setEmbedLang] = useState<Lang>(lang);
  const [colour, setColour] = useState<ColourOption>('light');
  const [chartType, setChartType] = useState<ChartTypeOption>('as-shown');
  const [live, setLive] = useState(false);
  const [copied, setCopied] = useState(false);
  const liveSwitchId = useId();
  const liveReasonId = useId();

  // Fires exactly once per mount (this component only EXISTS while the
  // dialog is open — ChartEmbedButton conditionally mounts it — so "once per
  // mount" IS "once per open"), matching every other *_open counter
  // (story_open, panel_open) elsewhere in chart.tsx.
  useEffect(() => {
    let cancelled = false;
    createEmbedCode(auditId).then((r) => {
      if (cancelled) return;
      setResult(r.ok ? { token: r.token, pro: r.pro } : 'unavailable');
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
    <Dialog
      open
      onOpenChange={(next: boolean) => {
        if (!next) onClose();
      }}
    >
      <DialogContent aria-modal="true" className="sm:max-w-md">
        <DialogTitle>{t(lang, 'chart.embed.dialogTitle')}</DialogTitle>
        <DialogDescription>{t(lang, 'chart.embed.dialogExplain')}</DialogDescription>

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
                  {t(lang, 'chart.embed.liveProOnly')}
                </span>
              ) : null}
            </div>

            <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-xs">{code}</pre>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(code);
                  } catch {
                    // Clipboard API unavailable/refused — the visible <pre>
                    // above is the manual-copy fallback; nothing further to
                    // do here.
                  }
                  setCopied(true);
                  trackChartStyleEvent('embed_copy');
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
      </DialogContent>
    </Dialog>
  );
}
