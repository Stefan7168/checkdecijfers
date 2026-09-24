// Own-data publish (ADR 057, session 127, Task 6) — the Publish button +
// dialog on the own-data chart card. Mirrors chart-embed-dialog.tsx's own
// structural discipline (a small local trigger Button that lifts an open
// boolean, mounting the dialog body only while open) but talks to a plainer
// server surface: no Pro/live/reading-alternate machinery, just publish/
// update/unpublish over Task 3's three Server Actions.
//
// Dialog shell: the raw ui/dialog.tsx primitives directly (Dialog/
// DialogContent/DialogTitle) — the SAME Base UI Dialog chart-edit-modal.tsx
// already proved out under this project's jsdom/vitest setup (role="dialog",
// Escape-to-close, focus-trap/restore), not ChartEditModal itself: this
// dialog has no chart-preview pane to show alongside its controls (no
// `chartSlot`), so the two-column shell chart-edit-modal.tsx adds would be
// pure unused chrome here.
//
// i18n: like chart-embed-dialog.tsx, this file resolves copy via the plain
// `t(lang, key)` function against the explicit `lang` prop UserChartCard
// hands down (the card's OWN chart-display language, `chartLang` there) —
// never the ambient `useT()` LangProvider hook — so a bare `render()` in a
// test behaves identically to production.
'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  getOwnChartPublication,
  publishOwnChart,
  unpublishOwnChart,
  type PublishFailure,
} from '../app/own-chart-publish-actions.ts';
import { t, type Lang, type MessageKey } from '../lib/i18n/messages.ts';
import { PUBLICATION_SOURCE_LINE_MAX_CLIENT } from '../lib/publication-source-line.ts';
import { APP_URL, buildEmbedResizeScript, EMBED_DEFAULT_HEIGHT_PX } from './chart-embed-dialog.tsx';
import { Button } from './ui/button.tsx';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog.tsx';
import { Input } from './ui/input.tsx';

export type OwnEmbedColour = 'light' | 'dark' | 'auto';

const COLOUR_OPTIONS: readonly OwnEmbedColour[] = ['light', 'dark', 'auto'];
const COLOUR_LABEL_KEY: Record<OwnEmbedColour, MessageKey> = {
  light: 'ownChart.publish.colourLight',
  dark: 'ownChart.publish.colourDark',
  auto: 'ownChart.publish.colourAuto',
};

// The iframe's own `title` attribute — no per-chart title reaches this
// button (its interface is deliberately just `{ turnId, lang, getLog }`,
// spec §2/Task 6), so a plain, constant one stands in, exactly like a
// generic document title would. Never interpolates anything the reader
// typed (the source-line field) — see `escapeHtmlAttribute` below for why
// that would matter if it ever did.
const EMBED_TITLE = 'checkdecijfers.nl — your chart';

/** HTML-attribute-escapes a string for use inside a double-quoted attribute
 * value in the generated embed snippet. Unlike chart-embed-dialog.tsx's own
 * `buildEmbedCode` (whose `title` is always a CBS `tableId` — digits and
 * letters only, never reader-controlled), own-data's embed title sits next
 * to reader-authored fields (the source line) on the same card, so this
 * file escapes defensively even though `EMBED_TITLE` above is a constant
 * today — the exported function's own contract (Task 6 brief) requires it. */
function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildOwnEmbedUrl(publicId: string, opts: { lang: Lang; theme: OwnEmbedColour }): string {
  const params = new URLSearchParams({ lang: opts.lang, theme: opts.theme });
  return `${APP_URL}/embed/own/${publicId}?${params.toString()}`;
}

export function buildOwnEmbedCode(publicId: string, opts: { lang: Lang; theme: OwnEmbedColour }, title: string): string {
  const url = buildOwnEmbedUrl(publicId, opts);
  const iframe = `<iframe src="${url}" width="100%" height="${EMBED_DEFAULT_HEIGHT_PX}" title="${escapeHtmlAttribute(title)}" loading="lazy" style="border:0" data-checkdecijfers-embed="${publicId}"></iframe>`;
  return `${iframe}\n${buildEmbedResizeScript(publicId)}`;
}

/** The failure→copy mapping (Task 6 brief): `disabled`/`unavailable` share
 * one line (both mean "nothing this reader did wrong, try later"); every
 * remaining reason not called out individually (`forbidden`/
 * `unauthenticated`/`error`) is the generic catch-all — none of those three
 * should ever surface to a signed-in author publishing their OWN chart in
 * practice, but the copy stays honest rather than silent if one ever does. */
function failureKeyFor(reason: PublishFailure): MessageKey {
  switch (reason) {
    case 'disabled':
    case 'unavailable':
      return 'ownChart.publish.failureDisabled';
    case 'limit':
      return 'ownChart.publish.failureLimit';
    case 'changed':
      return 'ownChart.publish.failureChanged';
    case 'invalid':
      return 'ownChart.publish.failureInvalid';
    case 'forbidden':
    case 'unauthenticated':
    case 'error':
      return 'ownChart.publish.failureGeneric';
  }
}

interface Publication {
  publicId: string;
  sourceLine: string | null;
}

export function OwnChartPublishButton({
  turnId,
  lang,
  getLog,
}: {
  turnId: number;
  lang: Lang;
  /** The card's own current, serialized command log (`serializeHistory
   * (history)` at the call site) — read fresh on every publish/update click,
   * never cached, so an update always sends what the author sees right now. */
  getLog: () => unknown[];
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Button ref={triggerRef} type="button" variant="ghost" size="xs" onClick={() => setOpen(true)}>
        {t(lang, 'ownChart.publish.trigger')}
      </Button>
      {open ? (
        <OwnChartPublishDialog
          turnId={turnId}
          lang={lang}
          getLog={getLog}
          onClose={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

function OwnChartPublishDialog({
  turnId,
  lang,
  getLog,
  onClose,
}: {
  turnId: number;
  lang: Lang;
  getLog: () => unknown[];
  onClose: () => void;
}) {
  const [publication, setPublication] = useState<Publication | null | 'loading'>('loading');
  const [sourceLine, setSourceLine] = useState('');
  const [embedLang, setEmbedLang] = useState<Lang>(lang);
  const [colour, setColour] = useState<OwnEmbedColour>('light');
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<PublishFailure | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);
  const sourceLineId = useId();

  // Fires once per mount (this component only exists while the dialog is
  // open, mirroring ChartEmbedDialog's own "once per mount IS once per
  // open" reasoning) — a fresh open always re-checks the current published
  // state rather than trusting a stale closure from a previous open.
  useEffect(() => {
    let cancelled = false;
    getOwnChartPublication(turnId)
      .then((row) => {
        if (cancelled) return;
        setPublication(row);
        setSourceLine(row?.sourceLine ?? '');
      })
      .catch(() => {
        // A rejected Server Action promise must not leave the dialog stuck
        // on "loading" forever — same posture as ChartEmbedDialog's own
        // catch branch. Collapses to "not published"; the author can still
        // retry Publish, which will surface a real failure reason if one
        // exists.
        if (cancelled) return;
        setPublication(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- turnId is the only input that should ever re-trigger this fetch.
  }, [turnId]);

  async function runPublish() {
    setSubmitting(true);
    setFailure(null);
    const trimmed = sourceLine.trim();
    const result = await publishOwnChart(turnId, getLog(), trimmed);
    setSubmitting(false);
    if (result.ok) {
      setPublication({ publicId: result.publicId, sourceLine: trimmed === '' ? null : trimmed });
      setCopiedLink(false);
      setCopiedCode(false);
    } else {
      setFailure(result.reason);
    }
  }

  async function runUnpublish() {
    setUnpublishing(true);
    const result = await unpublishOwnChart(turnId);
    setUnpublishing(false);
    setConfirmingUnpublish(false);
    if (result.ok) {
      setPublication(null);
      setFailure(null);
      setSourceLine('');
    }
  }

  const published = publication !== 'loading' ? publication : null;
  const failureText = failure === null ? null : t(lang, failureKeyFor(failure));

  return (
    <Dialog
      open
      onOpenChange={(next: boolean) => {
        if (!next) onClose();
      }}
    >
      <DialogContent aria-modal="true" closeLabel={t(lang, 'common.close')} className="max-w-md">
        <DialogTitle>{t(lang, 'ownChart.publish.dialogTitle')}</DialogTitle>

        {publication === 'loading' ? (
          <p className="text-xs text-muted-foreground">{t(lang, 'ownChart.publish.loading')}</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t(lang, 'ownChart.publish.disclosure')}</p>

            <div>
              <label htmlFor={sourceLineId} className="text-xs text-muted-foreground">
                {t(lang, 'ownChart.publish.sourceLineLabel')}
              </label>
              <Input
                id={sourceLineId}
                value={sourceLine}
                maxLength={PUBLICATION_SOURCE_LINE_MAX_CLIENT}
                placeholder={t(lang, 'ownChart.publish.sourceLinePlaceholder')}
                onChange={(e) => setSourceLine(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t(lang, 'ownChart.publish.sourceLineHelper')}</p>
            </div>

            <fieldset>
              <legend className="text-xs text-muted-foreground">{t(lang, 'ownChart.publish.languageLabel')}</legend>
              <label className="mr-3 text-xs">
                <input type="radio" name="own-publish-lang" checked={embedLang === 'nl'} onChange={() => setEmbedLang('nl')} />{' '}
                {t(lang, 'chart.panel.languageNl')}
              </label>
              <label className="text-xs">
                <input type="radio" name="own-publish-lang" checked={embedLang === 'en'} onChange={() => setEmbedLang('en')} />{' '}
                {t(lang, 'chart.panel.languageEn')}
              </label>
            </fieldset>

            <fieldset>
              <legend className="text-xs text-muted-foreground">{t(lang, 'ownChart.publish.colourLabel')}</legend>
              {COLOUR_OPTIONS.map((c) => (
                <label key={c} className="mr-3 text-xs">
                  <input type="radio" name="own-publish-colour" checked={colour === c} onChange={() => setColour(c)} />{' '}
                  {t(lang, COLOUR_LABEL_KEY[c])}
                </label>
              ))}
            </fieldset>

            {failureText !== null ? <p className="text-xs text-destructive">{failureText}</p> : null}

            {published === null ? (
              <div className="flex justify-end">
                <Button type="button" size="sm" disabled={submitting} onClick={() => void runPublish()}>
                  {t(lang, 'ownChart.publish.publishCta')}
                </Button>
              </div>
            ) : (
              <>
                <div>
                  <label className="text-xs text-muted-foreground">{t(lang, 'ownChart.publish.linkLabel')}</label>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={buildOwnEmbedUrl(published.publicId, { lang: embedLang, theme: colour })} />
                    <Button
                      type="button"
                      size="sm"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(buildOwnEmbedUrl(published.publicId, { lang: embedLang, theme: colour }));
                          setCopiedLink(true);
                        } catch {
                          // Clipboard unavailable/refused — the visible link
                          // field above is the manual-copy fallback.
                        }
                      }}
                    >
                      {copiedLink ? t(lang, 'ownChart.publish.copyLinkCopied') : t(lang, 'ownChart.publish.copyLink')}
                    </Button>
                  </div>
                </div>

                <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
                  {buildOwnEmbedCode(published.publicId, { lang: embedLang, theme: colour }, EMBED_TITLE)}
                </pre>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          buildOwnEmbedCode(published.publicId, { lang: embedLang, theme: colour }, EMBED_TITLE),
                        );
                        setCopiedCode(true);
                      } catch {
                        // Same fallback posture as the link copy above.
                      }
                    }}
                  >
                    {copiedCode ? t(lang, 'ownChart.publish.copyCodeCopied') : t(lang, 'ownChart.publish.copyCode')}
                  </Button>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={() => void runPublish()}>
                    {t(lang, 'ownChart.publish.updateButton')}
                  </Button>
                  {confirmingUnpublish ? (
                    <>
                      <p className="w-full text-xs text-muted-foreground">{t(lang, 'ownChart.publish.unpublishConfirm')}</p>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingUnpublish(false)}>
                        {t(lang, 'ownChart.publish.unpublishConfirmCancel')}
                      </Button>
                      <Button type="button" variant="destructive" size="sm" disabled={unpublishing} onClick={() => void runUnpublish()}>
                        {t(lang, 'ownChart.publish.unpublishConfirmYes')}
                      </Button>
                    </>
                  ) : (
                    <Button type="button" variant="destructive" size="sm" onClick={() => setConfirmingUnpublish(true)}>
                      {t(lang, 'ownChart.publish.unpublishButton')}
                    </Button>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
